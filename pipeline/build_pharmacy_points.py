#!/usr/bin/env python3
"""
Build pharmacy overlay GeoJSON points from NHS BSA Consolidated Pharmaceutical List.

Data source: NHS BSA Open Data — "Consolidated Pharmaceutical List"
  CKAN package: https://opendata.nhsbsa.net/dataset/240d142d-df82-4e97-b051-12371519e4e1
  Licence: Open Government Licence v3.0 — free, no API key required
  Coverage: England only (Scotland/Wales covered separately)

Geocoding: postcodes.io bulk API (100 postcodes per request), free, no key needed.

Output: data/model/transit/pharmacy_overlay_points.geojson.gz
  Properties per feature: name, ods_code, post_code, weekly_total

Filters applied:
  - CONTRACT_TYPE == 'Community'  (excludes online-only "Distance Selling" and Appliance
    Contractors that have no physical walk-in premises)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import time
import urllib.request
from pathlib import Path

from paths import MODEL_TRANSIT_DIR, ensure_pipeline_dirs

# ── NHS BSA CKAN package ID for bulk download ──────────────────────────────
BSA_CKAN_API = "https://opendata.nhsbsa.net/api/3/action/package_show?id=240d142d-df82-4e97-b051-12371519e4e1"
POSTCODES_IO_BULK = "https://api.postcodes.io/postcodes"

# GB bounding box sanity check
LON_MIN, LON_MAX = -8.2, 2.0
LAT_MIN, LAT_MAX = 49.8, 56.0  # England + southern Scotland


def get_latest_csv_url() -> str:
    """Query NHS BSA CKAN API and return the download URL for the most recent quarterly file."""
    req = urllib.request.Request(BSA_CKAN_API, headers={"User-Agent": "valuemap-uk/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    resources = data["result"]["resources"]
    # Resources are in chronological order; last one is most recent
    csv_resources = [r for r in resources if r.get("format", "").upper() == "CSV"]
    if not csv_resources:
        raise ValueError("No CSV resources found in NHS BSA pharmacy package")
    latest = csv_resources[-1]
    print(f"  Latest resource: {latest.get('name', '?')}")
    return latest["url"]


def download_pharmacy_csv(url: str) -> str:
    """Download the pharmacy list CSV and return as string."""
    print(f"  Downloading from {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "valuemap-uk/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    print(f"  Downloaded {len(raw) / 1e6:.2f} MB")
    return raw.decode("utf-8", errors="replace")


def parse_pharmacy_csv(csv_text: str) -> list[dict]:
    """Parse pharmacy CSV, filter to Community contract type, return records."""
    records: list[dict] = []
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        contract_type = (row.get("CONTRACT_TYPE") or "").strip()
        if contract_type != "Community":
            continue
        ods_code    = (row.get("PHARMACY_ODS_CODE_F_CODE") or "").strip()
        name        = (row.get("PHARMACY_TRADING_NAME") or row.get("ORGANISATION_NAME") or "").strip()
        postcode    = (row.get("POST_CODE") or "").strip().upper().replace(" ", "")
        weekly_str  = (row.get("WEEKLY_TOTAL") or "").strip()
        if not postcode:
            continue
        weekly: float | None = None
        try:
            weekly = float(weekly_str)
        except (ValueError, TypeError):
            pass
        records.append({
            "ods_code":     ods_code,
            "name":         name,
            "postcode_raw": postcode,
            "weekly_total": weekly,
        })
    return records


def geocode_postcodes(postcodes: list[str]) -> dict[str, tuple[float, float]]:
    """
    Bulk geocode a list of postcodes via postcodes.io.
    Returns dict of normalised_postcode → (lon, lat).
    Batches in groups of 100; retries once on failure.
    """
    result: dict[str, tuple[float, float]] = {}
    batch_size = 100
    total = len(postcodes)
    done = 0

    for i in range(0, total, batch_size):
        batch = postcodes[i : i + batch_size]
        payload = json.dumps({"postcodes": batch}).encode()
        req = urllib.request.Request(
            POSTCODES_IO_BULK,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "valuemap-uk/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
        except Exception as e:
            print(f"  Warning: batch {i // batch_size + 1} failed ({e}), retrying once...")
            time.sleep(2)
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.loads(r.read())
            except Exception as e2:
                print(f"  Batch failed permanently: {e2}")
                continue

        for item in data.get("result") or []:
            if item is None:
                continue
            res = item.get("result")
            if not res:
                continue
            pc  = str(res.get("postcode") or "").upper().replace(" ", "")
            lon = res.get("longitude")
            lat = res.get("latitude")
            if pc and lon is not None and lat is not None:
                result[pc] = (float(lon), float(lat))

        done += len(batch)
        if (i // batch_size) % 10 == 0:
            print(f"  Geocoded {done}/{total} postcodes ...")
        time.sleep(0.1)  # be polite

    return result


def build_geojson(records: list[dict], geo: dict[str, tuple[float, float]]) -> tuple[list[dict], int, int]:
    features: list[dict] = []
    geocoded = 0
    skipped = 0
    for rec in records:
        pc = rec["postcode_raw"]
        coords = geo.get(pc)
        if not coords:
            # Try with space normalisation
            pc_spaced = pc[:-3] + " " + pc[-3:] if len(pc) >= 5 else pc
            pc_spaced_norm = pc_spaced.upper().replace(" ", "")
            coords = geo.get(pc_spaced_norm)
        if not coords:
            skipped += 1
            continue
        lon, lat = coords
        # GB bounds check
        if not (LON_MIN <= lon <= LON_MAX) or not (LAT_MIN <= lat <= LAT_MAX):
            skipped += 1
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "name":         rec["name"],
                "ods_code":     rec["ods_code"],
                "post_code":    rec["postcode_raw"],
                "weekly_total": rec["weekly_total"],
            },
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, 7), round(lat, 7)],
            },
        })
        geocoded += 1
    return features, geocoded, skipped


def write_geojson_gz(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"type": "FeatureCollection", "features": features}
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  Written {len(features):,} features → {path} ({path.stat().st_size / 1024:.0f} KB)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build pharmacy overlay GeoJSON from NHS BSA data")
    p.add_argument(
        "--output",
        default=str(MODEL_TRANSIT_DIR / "pharmacy_overlay_points.geojson.gz"),
        help="Output path for pharmacy GeoJSON.gz",
    )
    p.add_argument(
        "--csv-url",
        default=None,
        help="Direct NHS BSA CSV URL (if not set, auto-detected via CKAN API)",
    )
    return p.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()

    print("Step 1: Locate latest NHS BSA Consolidated Pharmaceutical List...")
    csv_url = args.csv_url
    if not csv_url:
        csv_url = get_latest_csv_url()

    print("Step 2: Download CSV...")
    csv_text = download_pharmacy_csv(csv_url)

    print("Step 3: Parse + filter (Community pharmacies only)...")
    records = parse_pharmacy_csv(csv_text)
    print(f"  Community pharmacies found: {len(records):,}")

    print("Step 4: Geocode postcodes via postcodes.io...")
    unique_postcodes = list({r["postcode_raw"] for r in records})
    print(f"  Unique postcodes to geocode: {len(unique_postcodes):,}")
    geo = geocode_postcodes(unique_postcodes)
    print(f"  Successfully geocoded: {len(geo):,} postcodes")

    print("Step 5: Build GeoJSON features...")
    features, geocoded, skipped = build_geojson(records, geo)
    print(f"  Features built: {geocoded:,}")
    print(f"  Skipped (no geocode or out of bounds): {skipped:,}")

    print("Step 6: Write output...")
    write_geojson_gz(Path(args.output), features)
    print("Pharmacy overlay generation complete.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Build GP surgery overlay GeoJSON points from NHS Organisation Data Service (ODS).

Data source: NHS England ODS REST API (no auth required)
  https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations
  Role RO177 = GP Practice, Status=Active
  Licence: Open Government Licence v3.0 — free, no API key required
  Coverage: England only

Geocoding: postcodes.io bulk API (100 postcodes per request), free, no key needed.

Output: data/model/transit/gp_surgery_overlay_points.geojson.gz
  Properties per feature: name, ods_code, post_code

Filters applied:
  - Status == 'Active' — excludes closed and dormant practices
"""
from __future__ import annotations

import argparse
import gzip
import json
import time
import urllib.request
import requests
from pathlib import Path

from paths import MODEL_TRANSIT_DIR, ensure_pipeline_dirs

# ── NHS ODS REST API ───────────────────────────────────────────────────────
ODS_API_BASE = "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations"
ODS_API_LIMIT = 1000  # max page size supported by the API
POSTCODES_IO_BULK = "https://api.postcodes.io/postcodes"

# GB bounding box sanity check
LON_MIN, LON_MAX = -8.2, 2.0
LAT_MIN, LAT_MAX = 49.8, 56.0  # England + southern Scotland


def fetch_gp_practices_from_api() -> list[dict]:
    """
    Fetch all active GP practices from the NHS ODS REST API.
    Uses RO177 (GP Practice) role, paginates in batches of 1000.
    Returns list of dicts with keys: ods_code, name, postcode_raw.
    """
    records: list[dict] = []
    offset = 0
    page = 0
    session = requests.Session()
    while True:
        params: dict = {"PrimaryRoleId": "RO177", "Status": "Active", "Limit": ODS_API_LIMIT}
        if offset > 0:
            params["Offset"] = offset
        try:
            r = session.get(ODS_API_BASE, params=params, timeout=30)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"  Warning: page {page} (offset {offset}) failed ({e}), retrying once...")
            time.sleep(3)
            r = session.get(ODS_API_BASE, params=params, timeout=30)
            r.raise_for_status()
            data = r.json()

        orgs = data.get("Organisations") or []
        if not orgs:
            break

        for org in orgs:
            postcode = str(org.get("PostCode") or "").strip().upper().replace(" ", "")
            if not postcode:
                continue
            records.append({
                "ods_code": str(org.get("OrgId") or "").strip(),
                "name": str(org.get("Name") or "").strip(),
                "postcode_raw": postcode,
            })

        page += 1
        if page % 5 == 0:
            print(f"  Fetched {len(records):,} practices so far (page {page}) ...")

        if len(orgs) < ODS_API_LIMIT:
            break  # last page

        offset += ODS_API_LIMIT
        time.sleep(0.2)  # be polite to the API

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
            pc = str(res.get("postcode") or "").upper().replace(" ", "")
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
                "name": rec["name"],
                "ods_code": rec["ods_code"],
                "post_code": rec["postcode_raw"],
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
    p = argparse.ArgumentParser(description="Build GP surgery overlay GeoJSON from NHS ODS epraccur data")
    p.add_argument(
        "--output",
        default=str(MODEL_TRANSIT_DIR / "gp_surgery_overlay_points.geojson.gz"),
        help="Output path for GP surgery GeoJSON.gz",
    )
    return p.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()

    print("Step 1: Fetch active GP practices from NHS ODS REST API...")
    records = fetch_gp_practices_from_api()
    print(f"  Active GP practices found: {len(records):,}")

    print("Step 2: Geocode postcodes via postcodes.io...")
    unique_postcodes = list({r["postcode_raw"] for r in records})
    print(f"  Unique postcodes to geocode: {len(unique_postcodes):,}")
    geo = geocode_postcodes(unique_postcodes)
    print(f"  Successfully geocoded: {len(geo):,} postcodes")

    print("Step 3: Build GeoJSON features...")
    features, geocoded, skipped = build_geojson(records, geo)
    print(f"  Features built: {geocoded:,}")
    print(f"  Skipped (no geocode or out of bounds): {skipped:,}")

    print("Step 4: Write output...")
    write_geojson_gz(Path(args.output), features)
    print("GP surgery overlay generation complete.")


if __name__ == "__main__":
    main()

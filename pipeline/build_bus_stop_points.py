#!/usr/bin/env python3
"""
Build bus stop and metro/tram overlay GeoJSON points from NaPTAN live API.

Data source: NaPTAN (National Public Transport Access Nodes)
  URL: https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv
  Licence: Open Government Licence v3.0 — free, no API key required

Stop types used:
  BCT  — on-street bus stops (main bus layer)
  BCS  — off-street bus/coach bays (supplement)
  TMU  — tram/metro/underground station entrances (metro/tram layer)
  PLT  — metro/tram platforms (supplement to TMU)

Outputs:
  data/model/transit/bus_stop_overlay_points.geojson.gz   (BCT + BCS)
  data/model/transit/metro_tram_overlay_points.geojson.gz (TMU + PLT)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import urllib.request
from pathlib import Path

from paths import MODEL_TRANSIT_DIR, ensure_pipeline_dirs

NAPTAN_URL = "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv"

BUS_STOP_TYPES   = {"BCT", "BCS"}
METRO_TRAM_TYPES = {"TMU", "PLT"}

# GB bounding box sanity check
LON_MIN, LON_MAX = -8.2, 2.0
LAT_MIN, LAT_MAX = 49.8, 60.9


def download_naptan(url: str) -> str:
    """Download NaPTAN CSV and return as string."""
    print(f"Downloading NaPTAN from {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "valuemap-uk/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    print(f"  Downloaded {len(raw) / 1e6:.1f} MB")
    return raw.decode("utf-8", errors="replace")


def parse_naptan(csv_text: str) -> tuple[list[dict], list[dict]]:
    """
    Parse NaPTAN CSV, return (bus_features, metro_tram_features) as GeoJSON feature lists.
    """
    bus_features: list[dict] = []
    metro_tram_features: list[dict] = []
    skipped = 0

    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        status    = (row.get("Status") or "").strip()
        stop_type = (row.get("StopType") or "").strip()
        if status != "active":
            continue
        if stop_type not in (BUS_STOP_TYPES | METRO_TRAM_TYPES):
            continue

        lon_str = (row.get("Longitude") or "").strip()
        lat_str = (row.get("Latitude")  or "").strip()
        if not lon_str or not lat_str:
            skipped += 1
            continue
        try:
            lon = float(lon_str)
            lat = float(lat_str)
        except ValueError:
            skipped += 1
            continue

        # GB bounds check
        if not (LON_MIN <= lon <= LON_MAX) or not (LAT_MIN <= lat <= LAT_MAX):
            skipped += 1
            continue

        name      = (row.get("CommonName") or "").strip()
        atco_code = (row.get("ATCOCode")   or "").strip()
        if not name and not atco_code:
            skipped += 1
            continue

        feature = {
            "type": "Feature",
            "properties": {
                "name":      name,
                "atco_code": atco_code,
                "stop_type": stop_type,
            },
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, 7), round(lat, 7)],
            },
        }

        if stop_type in BUS_STOP_TYPES:
            bus_features.append(feature)
        else:
            metro_tram_features.append(feature)

    return bus_features, metro_tram_features


def write_geojson_gz(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"type": "FeatureCollection", "features": features}
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  Written {len(features):,} features → {path} ({path.stat().st_size / 1e6:.1f} MB)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build bus stop and metro/tram overlay GeoJSON from NaPTAN")
    p.add_argument("--url", default=NAPTAN_URL, help="NaPTAN CSV download URL")
    p.add_argument(
        "--bus-output",
        default=str(MODEL_TRANSIT_DIR / "bus_stop_overlay_points.geojson.gz"),
        help="Output path for bus stop GeoJSON.gz",
    )
    p.add_argument(
        "--metro-output",
        default=str(MODEL_TRANSIT_DIR / "metro_tram_overlay_points.geojson.gz"),
        help="Output path for metro/tram GeoJSON.gz",
    )
    return p.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()

    csv_text = download_naptan(args.url)
    bus_features, metro_features = parse_naptan(csv_text)

    print(f"Bus stops (BCT+BCS): {len(bus_features):,}")
    print(f"Metro/tram (TMU+PLT): {len(metro_features):,}")

    bus_path   = Path(args.bus_output)
    metro_path = Path(args.metro_output)

    write_geojson_gz(bus_path, bus_features)
    write_geojson_gz(metro_path, metro_features)
    print("Bus stop and metro/tram overlay generation complete.")


if __name__ == "__main__":
    main()

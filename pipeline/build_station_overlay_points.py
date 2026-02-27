#!/usr/bin/env python3
"""
Build train station overlay GeoJSON points from the raw GB stations GeoJSON.

Input:  data/raw/Stations/GB train stations.json  (GeoJSON FeatureCollection)
Output: data/model/stations/station_overlay_points.geojson.gz

The raw file already contains WGS84 coordinates so no geocoding is needed.
Each output feature retains: name, code, owner.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from paths import (
    MODEL_STATIONS_DIR,
    RAW_STATIONS_DIR,
    ensure_pipeline_dirs,
)

RAW_STATIONS_FILE = RAW_STATIONS_DIR / "GB train stations.json"


def load_raw_features(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected GeoJSON object, got {type(payload)}")
    features = payload.get("features") or []
    return [f for f in features if isinstance(f, dict)]


def build_geojson(raw_features: list[dict]) -> tuple[dict, int]:
    out_features: list[dict] = []
    skipped = 0

    for raw in raw_features:
        geom = raw.get("geometry") or {}
        if geom.get("type") != "Point":
            skipped += 1
            continue
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            skipped += 1
            continue
        lon = float(coords[0])
        lat = float(coords[1])
        if not (-11 <= lon <= 3) or not (49 <= lat <= 62):
            # Outside GB bounding box — skip
            skipped += 1
            continue

        props = raw.get("properties") or {}
        name = str(props.get("name") or "").strip()
        code = str(props.get("code") or "").strip().upper()
        owner = str(props.get("owner") or "").strip()

        if not name:
            skipped += 1
            continue

        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": name,
                    "code": code,
                    "owner": owner,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 8), round(lat, 8)],
                },
            }
        )

    return {"type": "FeatureCollection", "features": out_features}, skipped


def write_geojson_gz(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build train station overlay GeoJSON from raw GB stations file")
    p.add_argument("--input", default=str(RAW_STATIONS_FILE), help="Input raw GeoJSON path")
    p.add_argument("--output", default=str(MODEL_STATIONS_DIR / "station_overlay_points.geojson.gz"), help="Output GeoJSON .gz path")
    return p.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    print(f"Loading raw stations from: {input_path}")
    raw_features = load_raw_features(input_path)
    print(f"Raw features loaded: {len(raw_features)}")

    geojson, skipped = build_geojson(raw_features)
    features = geojson["features"]

    write_geojson_gz(output_path, geojson)

    print(f"Skipped: {skipped}")
    print(f"Output features: {len(features)}")
    print(f"Written to: {output_path}")


if __name__ == "__main__":
    main()

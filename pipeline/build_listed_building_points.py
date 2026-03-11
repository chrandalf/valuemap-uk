"""
Build listed building overlay GeoJSON points from MHCLG Planning Data.

Source: https://files.planning.data.gov.uk/dataset/listed-building.csv
        (Open Government Licence v3.0)

Output: data/model/transit/listed_building_overlay_points.geojson.gz

Properties per feature: name, grade, reference, doc_url
  grade: "I" | "II*" | "II"
"""

import argparse
import csv
import gzip
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCE_URL = "https://files.planning.data.gov.uk/dataset/listed-building.csv"

HERE = Path(__file__).parent
MODEL_TRANSIT_DIR = HERE / "data" / "model" / "transit"

# Rough GB bounds for sanity check
LON_MIN, LON_MAX = -8.2, 2.0
LAT_MIN, LAT_MAX = 49.8, 60.9

_POINT_RE = re.compile(r"POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)")


def download_csv() -> str:
    print(f"Downloading listed building data from {SOURCE_URL} ...")
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "valuemap-uk/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    size_mb = len(raw) / 1e6
    print(f"  Downloaded {size_mb:.1f} MB")
    return raw.decode("utf-8", errors="replace")


def parse_csv(csv_text: str) -> list[dict]:
    features: list[dict] = []
    reader = csv.DictReader(io.StringIO(csv_text))
    skipped_no_point = 0
    skipped_bounds = 0
    skipped_ended = 0

    for row in reader:
        # Skip withdrawn/demolished listings
        if row.get("end-date", "").strip():
            skipped_ended += 1
            continue

        point_wkt = (row.get("point") or "").strip()
        if not point_wkt:
            skipped_no_point += 1
            continue

        m = _POINT_RE.match(point_wkt)
        if not m:
            skipped_no_point += 1
            continue

        lon = float(m.group(1))
        lat = float(m.group(2))

        if not (LON_MIN <= lon <= LON_MAX) or not (LAT_MIN <= lat <= LAT_MAX):
            skipped_bounds += 1
            continue

        name = (row.get("name") or "").strip()
        grade = (row.get("listed-building-grade") or "").strip()
        reference = (row.get("reference") or "").strip()
        doc_url = (row.get("documentation-url") or "").strip()

        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "grade": grade,
                "reference": reference,
                "doc_url": doc_url,
            },
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, 6), round(lat, 6)],
            },
        })

    print(f"  Parsed {len(features):,} features")
    if skipped_ended:
        print(f"  Skipped {skipped_ended:,} ended/withdrawn listings")
    if skipped_no_point:
        print(f"  Skipped {skipped_no_point:,} with no point coordinates")
    if skipped_bounds:
        print(f"  Skipped {skipped_bounds:,} outside GB bounds")

    # Grade summary
    from collections import Counter
    grade_counts = Counter(f["properties"]["grade"] for f in features)
    for g, count in sorted(grade_counts.items()):
        print(f"  Grade {g or '(unknown)':5s}: {count:,}")

    return features


def write_geojson_gz(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fc = {"type": "FeatureCollection", "features": features}
    raw = json.dumps(fc, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(raw)
    size_mb = path.stat().st_size / 1e6
    print(f"Wrote {len(features):,} features → {path} ({size_mb:.2f} MB gz)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build listed building overlay GeoJSON from MHCLG Planning Data")
    parser.add_argument(
        "--output",
        default=str(MODEL_TRANSIT_DIR / "listed_building_overlay_points.geojson.gz"),
        help="Output path for listed building GeoJSON.gz",
    )
    args = parser.parse_args()

    print("Step 1: Download CSV ...")
    csv_text = download_csv()

    print("Step 2: Parse and build GeoJSON ...")
    features = parse_csv(csv_text)

    if not features:
        print("ERROR: No features built — aborting.", file=sys.stderr)
        sys.exit(1)

    print("Step 3: Write output ...")
    write_geojson_gz(Path(args.output), features)
    print("Done.")


if __name__ == "__main__":
    main()

"""
Build Airbnb holiday let overlay GeoJSON points from Inside Airbnb.

Source: Inside Airbnb (insideairbnb.com)
Licence: Creative Commons Attribution 4.0 International (CC BY 4.0)
Attribution required: "Data sourced from Inside Airbnb (insideairbnb.com)"

Coverage: Major UK cities only — London, Greater Manchester, Edinburgh, Bristol.
Rural/coastal holiday let concentrations are NOT represented; the overlay
is most useful for assessing short-term rental density in urban areas.

Only "Entire home/apt" listings are included — private rooms and hotel rooms
are excluded as they are not standalone holiday lets.

Output: MODEL_TRANSIT_DIR / holiday_let_overlay_points.geojson.gz

Properties per feature:
  name        — listing name (truncated to 80 chars)
  city        — source city label
  room_type   — always "Entire home/apt"
  price       — nightly price string (may be empty)
  min_nights  — minimum nights
  reviews     — total review count
  host_count  — number of listings by the same host (>1 = professional operator)
  availability — days available per year (0-365)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from paths import MODEL_TRANSIT_DIR, ensure_pipeline_dirs  # noqa: E402

# GB bounding box sanity check
LON_MIN, LON_MAX = -8.2, 2.0
LAT_MIN, LAT_MAX = 49.8, 60.9

NAME_MAX_LEN = 80

# Inside Airbnb UK city sources — summary listings (small CSV, lat/lon included)
# URL pattern: http://data.insideairbnb.com/united-kingdom/{region}/{city}/{date}/visualisations/listings.csv
# Dates must match a published snapshot — check insideairbnb.com/get-the-data/ for current dates.
CITIES: list[dict] = [
    {"label": "London",             "region": "england", "city": "london",            "date": "2025-09-14"},
    {"label": "Greater Manchester", "region": "england", "city": "greater-manchester", "date": "2025-09-26"},
    {"label": "Edinburgh",          "region": "scotland","city": "edinburgh",          "date": "2025-09-21"},
    {"label": "Bristol",            "region": "england", "city": "bristol",            "date": "2025-09-26"},
]

DOWNLOAD_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "http://insideairbnb.com/get-the-data/",
}


def download_city(city_cfg: dict) -> str:
    url = (
        f"http://data.insideairbnb.com/united-kingdom"
        f"/{city_cfg['region']}/{city_cfg['city']}/{city_cfg['date']}"
        f"/visualisations/listings.csv"
    )
    print(f"  Downloading {city_cfg['label']} from {url} ...")
    req = urllib.request.Request(url, headers=DOWNLOAD_HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    print(f"    Downloaded {len(data) / 1024:.0f} KB")
    return data.decode("utf-8", errors="replace")


def parse_city(csv_text: str, label: str) -> list[dict]:
    """Parse a summary listings CSV, returning GeoJSON features for entire-home lets."""
    features: list[dict] = []
    skipped_type = 0
    skipped_coords = 0

    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        room_type = (row.get("room_type") or "").strip()
        if room_type != "Entire home/apt":
            skipped_type += 1
            continue

        try:
            lat = float(row.get("latitude") or "")
            lon = float(row.get("longitude") or "")
        except (ValueError, TypeError):
            skipped_coords += 1
            continue

        if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
            skipped_coords += 1
            continue

        name = (row.get("name") or "").strip()
        if len(name) > NAME_MAX_LEN:
            name = name[:NAME_MAX_LEN].rstrip() + "…"

        price = (row.get("price") or "").strip()
        try:
            min_nights = int(row.get("minimum_nights") or 0)
        except (ValueError, TypeError):
            min_nights = 0
        try:
            reviews = int(row.get("number_of_reviews") or 0)
        except (ValueError, TypeError):
            reviews = 0
        try:
            host_count = int(row.get("calculated_host_listings_count") or 1)
        except (ValueError, TypeError):
            host_count = 1
        try:
            availability = int(row.get("availability_365") or 0)
        except (ValueError, TypeError):
            availability = 0

        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                "properties": {
                    "name": name,
                    "city": label,
                    "price": price,
                    "min_nights": min_nights,
                    "reviews": reviews,
                    "host_count": host_count,
                    "availability": availability,
                },
            }
        )

    print(f"    {label}: {len(features)} entire-home lets  "
          f"(skipped {skipped_type} non-entire-home, {skipped_coords} bad coords)")
    return features


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build holiday let (Airbnb) overlay GeoJSON from Inside Airbnb"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=MODEL_TRANSIT_DIR / "holiday_let_overlay_points.geojson.gz",
        help="Output path for the GeoJSON.gz file",
    )
    args = parser.parse_args()

    ensure_pipeline_dirs()

    all_features: list[dict] = []

    print("Downloading Inside Airbnb city data ...")
    for city_cfg in CITIES:
        try:
            csv_text = download_city(city_cfg)
            features = parse_city(csv_text, city_cfg["label"])
            all_features.extend(features)
        except Exception as exc:
            print(f"  WARNING: Failed to download {city_cfg['label']}: {exc}")
            print(f"  Skipping city and continuing.")

    print(f"\nTotal features: {len(all_features):,}")

    geojson = {
        "type": "FeatureCollection",
        "features": all_features,
    }

    print(f"Writing output to {args.output} ...")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(geojson, separators=(",", ":")).encode("utf-8")
    with gzip.open(args.output, "wb", compresslevel=6) as f:
        f.write(encoded)

    size_mb = args.output.stat().st_size / 1024 / 1024
    print(f"Wrote {len(all_features):,} features → {args.output} ({size_mb:.2f} MB gz)")
    print("Done.\n")
    print("Attribution: Data sourced from Inside Airbnb (insideairbnb.com) — CC BY 4.0")


if __name__ == "__main__":
    main()

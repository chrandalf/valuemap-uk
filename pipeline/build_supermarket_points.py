#!/usr/bin/env python3
"""
Build supermarket overlay GeoJSON points from OpenStreetMap via Overpass API.

OSM tags used:
  shop=supermarket    — full-size supermarkets (Tesco, Sainsbury's, ASDA, etc.)
  shop=convenience    — convenience stores (Tesco Express, Co-op, Spar, etc.)

Both types are included as a "food access" proximity signal — for most people the
nearest food shop is a convenience store, not a full supermarket.

Data source: OpenStreetMap contributors via Overpass API
Licence: ODbL (Open Database Licence) — https://opendatacommons.org/licenses/odbl/

Output: data/model/transit/supermarket_overlay_points.geojson.gz
  Properties per feature: name, shop (supermarket|convenience), brand
"""
from __future__ import annotations

import argparse
import gzip
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from paths import MODEL_SUPERMARKET_OVERLAY_POINTS, ensure_pipeline_dirs

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

LON_MIN, LON_MAX = -8.2, 2.0
LAT_MIN, LAT_MAX = 49.8, 61.0

GB_CHUNKS: list[tuple[float, float, float, float]] = [
    (49.8, -6.5,  51.5,  1.8),
    (51.5, -3.0,  52.5,  1.8),
    (52.5, -5.5,  53.5,  0.2),
    (53.5, -5.5,  54.5, -0.5),
    (54.5, -3.5,  55.5, -1.0),
    (55.5, -6.5,  57.0, -1.0),
    (57.0, -7.5,  58.5, -1.5),
    (58.5, -7.0,  61.0, -0.5),
    (49.8, -8.2,  55.0, -6.5),
    (51.2, -5.5,  52.5, -3.0),
    (52.5, -8.2,  55.0, -5.5),
]


def overpass_query_chunk(bbox: tuple[float, float, float, float]) -> list[dict]:
    south, west, north, east = bbox
    bbox_str = f"{south},{west},{north},{east}"
    query = f"""
[out:json][timeout:60];
(
  node["shop"="supermarket"]({bbox_str});
  way["shop"="supermarket"]({bbox_str});
  node["shop"="convenience"]({bbox_str});
  way["shop"="convenience"]({bbox_str});
);
out center tags;
"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        OVERPASS_URL, data=data, headers={"User-Agent": "valuemap-uk/1.0"}
    )
    with urllib.request.urlopen(req, timeout=75) as resp:
        raw = resp.read()
    return json.loads(raw).get("elements", [])


def element_coords(el: dict) -> tuple[float, float] | None:
    if el["type"] == "node":
        return el.get("lon"), el.get("lat")
    c = el.get("center", {})
    lon, lat = c.get("lon"), c.get("lat")
    if lon is None or lat is None:
        return None
    return lon, lat


def build_features(elements: list[dict]) -> list[dict]:
    features: list[dict] = []
    seen_ids: set[str] = set()
    for el in elements:
        uid = f"{el['type']}_{el['id']}"
        if uid in seen_ids:
            continue
        seen_ids.add(uid)

        coords = element_coords(el)
        if coords is None:
            continue
        lon, lat = coords
        if not (LON_MIN <= lon <= LON_MAX) or not (LAT_MIN <= lat <= LAT_MAX):
            continue

        tags: dict = el.get("tags", {})
        name = (tags.get("name") or "").strip()
        shop = tags.get("shop", "supermarket")
        brand = (tags.get("brand") or tags.get("brand:en") or "").strip()

        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "shop": shop,
                "brand": brand,
            },
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, 7), round(lat, 7)],
            },
        })
    return features


def write_geojson_gz(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"type": "FeatureCollection", "features": features}
    with gzip.open(str(path), "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  Written {len(features):,} features → {path} ({path.stat().st_size / 1024:.0f} KB)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build supermarket overlay GeoJSON from OSM Overpass")
    p.add_argument("--output", default=str(MODEL_SUPERMARKET_OVERLAY_POINTS))
    p.add_argument("--pause", type=float, default=3.0, help="Seconds between Overpass calls")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    ensure_pipeline_dirs()
    output_path = Path(args.output)

    all_features: list[dict] = []
    for i, chunk in enumerate(GB_CHUNKS):
        print(f"  Chunk {i + 1}/{len(GB_CHUNKS)}: bbox={chunk} ...", end=" ", flush=True)
        retries = 3
        for attempt in range(retries):
            try:
                elements = overpass_query_chunk(chunk)
                feats = build_features(elements)
                print(f"{len(feats)} shops")
                all_features.extend(feats)
                break
            except Exception as exc:
                if attempt < retries - 1:
                    wait = args.pause * (attempt + 2)
                    print(f"ERROR ({exc}), retrying in {wait:.0f}s...")
                    time.sleep(wait)
                else:
                    print(f"FAILED after {retries} attempts: {exc}")
        time.sleep(args.pause)

    seen_coords: set[tuple[float, float]] = set()
    deduped: list[dict] = []
    for f in all_features:
        c = tuple(f["geometry"]["coordinates"])
        if c not in seen_coords:
            seen_coords.add(c)
            deduped.append(f)

    print(f"\n  Total: {len(deduped):,} food shops (from {len(all_features):,} raw)")
    write_geojson_gz(output_path, deduped)


if __name__ == "__main__":
    main()

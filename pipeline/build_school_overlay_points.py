#!/usr/bin/env python3
"""
Build school overlay GeoJSON points from postcode-scored school rows.

Input:  school_postcode_scores_202425_mainstream.csv (or compatible)
Output: school_overlay_points.geojson.gz + optional postcode coord cache JSON

Uses postcodes.io batch lookup with a local cache to avoid repeated geocoding.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import re
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

MISSING = {"", "na", "np", "ne", "supp", "null", "x", "z", "c"}


def normalize_postcode_key(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").upper()).strip()


def to_float(value: Optional[str]) -> Optional[float]:
    text = (value or "").strip()
    if not text:
        return None
    if text.lower() in MISSING:
        return None
    if text.endswith("%"):
        text = text[:-1].strip()
    try:
        return float(text)
    except ValueError:
        return None


def read_cache(path: Path) -> Dict[str, Dict[str, object]]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_cache(path: Path, payload: Dict[str, Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def batch(iterable: List[str], size: int) -> List[List[str]]:
    return [iterable[i : i + size] for i in range(0, len(iterable), size)]


def fetch_postcodes_batch(keys: List[str], timeout: int = 40) -> Dict[str, Dict[str, object]]:
    url = "https://api.postcodes.io/postcodes"
    payload = {"postcodes": keys}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        parsed = json.loads(resp.read().decode("utf-8"))

    out: Dict[str, Dict[str, object]] = {}
    for item in parsed.get("result") or []:
        query = normalize_postcode_key(item.get("query") or "")
        result = item.get("result")
        if not query:
            continue
        if not result:
            out[query] = {"ok": False}
            continue
        lon = result.get("longitude")
        lat = result.get("latitude")
        if lon is None or lat is None:
            out[query] = {"ok": False}
            continue
        out[query] = {
            "ok": True,
            "postcode": result.get("postcode"),
            "longitude": float(lon),
            "latitude": float(lat),
        }
    return out


def load_rows(path: Path, min_quality: float) -> List[dict]:
    rows: List[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            postcode_key = normalize_postcode_key(row.get("postcode_key") or row.get("postcode") or "")
            if not postcode_key:
                continue

            quality = to_float(row.get("quality_score"))
            if quality is None:
                continue
            if quality < min_quality:
                continue

            rows.append(
                {
                    "urn": (row.get("urn") or row.get("school_urn") or "").strip(),
                    "school_name": (row.get("school_name") or "").strip(),
                    "town": (row.get("town") or "").strip(),
                    "postcode": (row.get("postcode") or "").strip().upper(),
                    "postcode_key": postcode_key,
                    "outcode": (row.get("outcode") or "").strip(),
                    "quality_score": quality,
                    "quality_band": (row.get("quality_band") or "").strip(),
                    "score_confidence": (row.get("score_confidence") or "").strip(),
                    "att8": to_float(row.get("att8")),
                    "em95": to_float(row.get("em95")),
                    "ebaps": to_float(row.get("ebaps")),
                    "ebacc_enter": to_float(row.get("ebacc_enter")),
                    "pupils": to_float(row.get("pupils")),
                    "mainstream_like": int(float(row.get("mainstream_like") or 0)),
                }
            )
    return rows


def build_geojson(rows: List[dict], coords: Dict[str, Dict[str, object]], good_threshold: float) -> dict:
    features = []
    for row in rows:
        c = coords.get(row["postcode_key"])
        if not c or not c.get("ok"):
            continue
        lon = c.get("longitude")
        lat = c.get("latitude")
        if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
            continue

        quality_score = float(row["quality_score"])
        feature = {
            "type": "Feature",
            "properties": {
                "urn": row["urn"],
                "school_name": row["school_name"],
                "town": row["town"],
                "postcode": row["postcode"] or c.get("postcode") or row["postcode_key"],
                "postcode_key": row["postcode_key"],
                "outcode": row["outcode"],
                "quality_score": round(quality_score, 6),
                "quality_band": row["quality_band"],
                "score_confidence": row["score_confidence"],
                "is_good": quality_score >= good_threshold,
                "att8": row["att8"],
                "em95": row["em95"],
                "ebaps": row["ebaps"],
                "ebacc_enter": row["ebacc_enter"],
                "pupils": row["pupils"],
                "mainstream_like": row["mainstream_like"],
            },
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}


def write_geojson_gz(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build school overlay GeoJSON points from postcode score CSV")
    p.add_argument("--input", required=True, help="Input school postcode score CSV")
    p.add_argument("--output", default="public/data/school_overlay_points.geojson.gz", help="Output GeoJSON .gz path")
    p.add_argument("--cache", default="public/data/school_postcode_coords_cache.json", help="Postcode coordinate cache JSON path")
    p.add_argument("--batch-size", type=int, default=100, help="Postcodes.io batch size (max 100)")
    p.add_argument("--pause-ms", type=int, default=40, help="Pause between API batches")
    p.add_argument("--good-threshold", type=float, default=0.60, help="Quality score threshold for good schools")
    p.add_argument("--min-quality", type=float, default=0.0, help="Optional filter to keep only rows >= this quality")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    cache_path = Path(args.cache).resolve()

    rows = load_rows(input_path, min_quality=args.min_quality)
    all_postcodes = sorted({row["postcode_key"] for row in rows if row["postcode_key"]})

    cache = read_cache(cache_path)
    missing = [pc for pc in all_postcodes if pc not in cache]

    batch_size = max(1, min(100, int(args.batch_size)))
    pause_secs = max(0, int(args.pause_ms)) / 1000

    for i, chunk in enumerate(batch(missing, batch_size), start=1):
        try:
            fetched = fetch_postcodes_batch(chunk)
            cache.update(fetched)
        except Exception:
            for pc in chunk:
                cache.setdefault(pc, {"ok": False})
        if pause_secs > 0:
            time.sleep(pause_secs)
        if i % 20 == 0:
            print(f"Geocoding batch {i}, cached={len(cache)}")

    write_cache(cache_path, cache)

    geojson = build_geojson(rows, cache, good_threshold=float(args.good_threshold))
    write_geojson_gz(output_path, geojson)

    features = geojson.get("features") or []
    good_count = sum(1 for f in features if f.get("properties", {}).get("is_good") is True)
    print(f"Input scored rows: {len(rows)}")
    print(f"Unique postcodes: {len(all_postcodes)}")
    print(f"GeoJSON features: {len(features)}")
    print(f"Good schools: {good_count}")


if __name__ == "__main__":
    main()

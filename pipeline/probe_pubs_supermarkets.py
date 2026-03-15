#!/usr/bin/env python3
"""
Probe Overpass API (OpenStreetMap) for UK pubs and supermarkets.

Queries two small bounding boxes (central London, central Manchester) to:
  - Verify data availability and coverage
  - Show realistic field names and values
  - Estimate record density per km²
  - Print sample rows

Run:  python pipeline/probe_pubs_supermarkets.py
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from typing import Any

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "valuemap-uk/1.0 (probe)", "Accept-Encoding": "gzip"}

# ── Sample bounding boxes (south,west,north,east) ────────────────────────────
SAMPLE_AREAS = {
    "Central London": (51.495, -0.145, 51.525,  0.005),   # ~3×2 km
    "Central Manchester": (53.469, -2.255, 53.490, -2.215),  # ~2×1.5 km
    "Central Edinburgh": (55.940, -3.225, 55.960, -3.175),   # ~2×1.3 km
    "Central Bristol": (51.445, -2.620, 51.465, -2.580),     # ~2×1.3 km
}

# ── OSM tag groups to probe ───────────────────────────────────────────────────
TAG_GROUPS = {
    "pub / bar": [
        ('amenity', 'pub'),
        ('amenity', 'bar'),
    ],
    "supermarket": [
        ('shop', 'supermarket'),
    ],
    "convenience store": [
        ('shop', 'convenience'),
    ],
}

def overpass_query(bbox: tuple[float, float, float, float], tag_filters: list[tuple[str, str]]) -> list[dict]:
    """Run an Overpass query for nodes/ways with the given tags inside bbox."""
    south, west, north, east = bbox
    bbox_str = f"{south},{west},{north},{east}"

    # Build union of tag matches across nodes and ways
    filters = ""
    for key, val in tag_filters:
        filters += f'  node["{key}"="{val}"]({bbox_str});\n'
        filters += f'  way["{key}"="{val}"]({bbox_str});\n'

    query = f"""
[out:json][timeout:30];
(
{filters}
);
out center tags;
"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": "valuemap-uk/1.0 (probe)"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read()
    result = json.loads(raw)
    return result.get("elements", [])


def lat_lon(el: dict) -> tuple[float, float]:
    """Extract lat/lon from a node or a way (via 'center')."""
    if el["type"] == "node":
        return el["lat"], el["lon"]
    c = el.get("center", {})
    return c.get("lat", 0), c.get("lon", 0)


def summarise(elements: list[dict], group_name: str, area_name: str) -> None:
    print(f"\n  [{group_name}] in {area_name} — {len(elements)} features")
    if not elements:
        print("    (none found)")
        return

    # Print first 5 samples
    for el in elements[:5]:
        tags: dict = el.get("tags", {})
        la, lo = lat_lon(el)
        name = tags.get("name", "(unnamed)")
        brand = tags.get("brand", tags.get("brand:en", ""))
        addr  = ", ".join(filter(None, [
            tags.get("addr:housenumber", ""),
            tags.get("addr:street", ""),
            tags.get("addr:city", tags.get("addr:town", "")),
        ]))
        extra = {}
        for k in ("amenity", "shop", "cuisine", "real_ale", "opening_hours", "phone", "website"):
            if k in tags:
                extra[k] = tags[k]
        line = f"    • {name}"
        if brand:
            line += f" [{brand}]"
        if addr:
            line += f" | {addr}"
        line += f" | ({la:.4f},{lo:.4f})"
        if extra:
            line += f" | {extra}"
        print(line)

    if len(elements) > 5:
        print(f"    ... and {len(elements) - 5} more")

    # Show all unique tag keys present
    all_keys: set[str] = set()
    for el in elements:
        all_keys.update(el.get("tags", {}).keys())
    useful_keys = sorted(k for k in all_keys if not k.startswith("source") and not k.startswith("note"))
    print(f"    Tag keys seen: {useful_keys}")


def estimate_uk_total(count_per_sample: dict[str, int]) -> None:
    """Very rough extrapolation to GB-wide count."""
    # London sample bbox ~3km×2km = 6 km²
    # GB land area ~229,850 km²  (but built-up area ~16,000 km² for amenities)
    # Use sample density × built-up area as rough ceiling
    BUILT_UP_KM2 = 16_000
    # London bbox km²
    import math
    def bbox_km2(s, w, n, e):
        lat_km = (n - s) * 111.32
        lon_km = (e - w) * 111.32 * math.cos(math.radians((s + n) / 2))
        return lat_km * lon_km

    for area_name, (bbox, counts) in count_per_sample.items():
        area = bbox_km2(*bbox)
        print(f"\n  Density in {area_name} ({area:.1f} km²):")
        for group, n in counts.items():
            density = n / area
            est = int(density * BUILT_UP_KM2)
            print(f"    {group:25s} {n:4d} features → {density:.1f}/km² → ~{est:,} estimated UK-wide")


def main() -> None:
    print("=" * 70)
    print("Overpass API probe — UK pubs & supermarkets")
    print("=" * 70)

    sample_counts: dict[str, tuple[Any, dict[str, int]]] = {}

    for area_name, bbox in SAMPLE_AREAS.items():
        print(f"\n{'─' * 60}")
        print(f"Area: {area_name}  bbox={bbox}")
        counts: dict[str, int] = {}

        for group_name, tags in TAG_GROUPS.items():
            try:
                elements = overpass_query(bbox, tags)
                summarise(elements, group_name, area_name)
                counts[group_name] = len(elements)
                time.sleep(1.5)  # be polite to Overpass
            except Exception as exc:
                print(f"  [{group_name}] ERROR: {exc}")
                counts[group_name] = 0

        sample_counts[area_name] = (bbox, counts)

    # Density + UK projection from London sample only
    print(f"\n{'=' * 70}")
    print("Density estimates (London sample → GB built-up area projection)")
    estimate_uk_total({"Central London": sample_counts["Central London"]})

    print(f"\n{'=' * 70}")
    print("Summary: record counts across sample areas")
    header = f"{'Area':<25}" + "".join(f"{g:<25}" for g in TAG_GROUPS)
    print(f"  {header}")
    for area_name, (_, counts) in sample_counts.items():
        row = f"{area_name:<25}" + "".join(f"{counts.get(g, 0):<25}" for g in TAG_GROUPS)
        print(f"  {row}")

    print("\nConclusion:")
    print("  OpenStreetMap via Overpass API — free, no key needed.")
    print("  Licence: ODbL (Open Database Licence) — compatible with open data projects.")
    print("  Full GB query: use bounding box (49.8,-8.2,60.9,2.0) with area size limit,")
    print("  or split by region to avoid server limits (~10k nodes per call).")


if __name__ == "__main__":
    main()

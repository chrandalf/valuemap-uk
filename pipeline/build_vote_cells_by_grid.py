#!/usr/bin/env python3
import argparse
import gzip
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from pyproj import Transformer
from paths import (
    MODEL_VOTE_BLOCKS_MAP_GEOJSON,
    MODEL_VOTE_DIR,
    PUBLIC_DATA_DIR,
    ensure_pipeline_dirs,
)


@dataclass
class VoteValues:
    pct_progressive: float
    pct_conservative: float
    pct_popular_right: float
    constituency: Optional[str]


@dataclass
class PolygonPart:
    outer: List[Tuple[float, float]]
    holes: List[List[Tuple[float, float]]]


@dataclass
class PolygonRecord:
    bbox: Tuple[float, float, float, float]
    parts: List[PolygonPart]
    values: VoteValues


def load_json_maybe_gz(path: Path):
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def point_in_ring(lon: float, lat: float, ring: List[Tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) if (yj - yi) != 0 else 1e-18) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_polygon_parts(lon: float, lat: float, parts: List[PolygonPart]) -> bool:
    for part in parts:
        if not point_in_ring(lon, lat, part.outer):
            continue
        in_hole = any(point_in_ring(lon, lat, hole) for hole in part.holes)
        if not in_hole:
            return True
    return False


def ring_bbox(ring: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def merge_bbox(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]):
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def parse_vote_polygons(vote_geojson: dict) -> List[PolygonRecord]:
    records: List[PolygonRecord] = []
    for feature in vote_geojson.get("features", []):
        props = feature.get("properties", {})
        geom = feature.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates")
        if gtype not in {"Polygon", "MultiPolygon"} or not coords:
            continue

        values = VoteValues(
            pct_progressive=float(props.get("pct_progressive", 0) or 0),
            pct_conservative=float(props.get("pct_conservative", 0) or 0),
            pct_popular_right=float(props.get("pct_popular_right", 0) or 0),
            constituency=props.get("constituency") or props.get("PCON24NM"),
        )

        polygon_sets = [coords] if gtype == "Polygon" else coords
        parts: List[PolygonPart] = []
        bbox: Optional[Tuple[float, float, float, float]] = None

        for poly in polygon_sets:
            if not poly:
                continue
            outer = [(float(x), float(y)) for x, y in poly[0]]
            holes = [[(float(x), float(y)) for x, y in ring] for ring in poly[1:]]
            parts.append(PolygonPart(outer=outer, holes=holes))
            outer_bbox = ring_bbox(outer)
            bbox = outer_bbox if bbox is None else merge_bbox(bbox, outer_bbox)

        if parts and bbox is not None:
            records.append(PolygonRecord(bbox=bbox, parts=parts, values=values))

    return records


def build_tile_index(polygons: List[PolygonRecord], tile_deg: float) -> Dict[Tuple[int, int], List[int]]:
    index: Dict[Tuple[int, int], List[int]] = {}
    for idx, poly in enumerate(polygons):
        min_lon, min_lat, max_lon, max_lat = poly.bbox
        x0 = math.floor(min_lon / tile_deg)
        x1 = math.floor(max_lon / tile_deg)
        y0 = math.floor(min_lat / tile_deg)
        y1 = math.floor(max_lat / tile_deg)
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                index.setdefault((tx, ty), []).append(idx)
    return index


def match_polygon(
    lon: float,
    lat: float,
    polygons: List[PolygonRecord],
    tile_index: Dict[Tuple[int, int], List[int]],
    tile_deg: float,
) -> Optional[PolygonRecord]:
    tx = math.floor(lon / tile_deg)
    ty = math.floor(lat / tile_deg)
    candidate_ids = tile_index.get((tx, ty), [])

    for idx in candidate_ids:
        poly = polygons[idx]
        min_lon, min_lat, max_lon, max_lat = poly.bbox
        if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
            continue
        if point_in_polygon_parts(lon, lat, poly.parts):
            return poly
    return None


def build_vote_cells(
    vote_geojson_path: Path,
    grid_rows_path: Path,
    output_path: Path,
    grid_meters: int,
    tile_deg: float,
):
    vote_geojson = load_json_maybe_gz(vote_geojson_path)
    rows = load_json_maybe_gz(grid_rows_path)

    polygons = parse_vote_polygons(vote_geojson)
    tile_index = build_tile_index(polygons, tile_deg)
    transformer = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)

    output_rows = []
    misses = 0

    for row in rows:
        gx = int(row["gx"])
        gy = int(row["gy"])
        cx = gx + grid_meters / 2
        cy = gy + grid_meters / 2
        lon, lat = transformer.transform(cx, cy)

        poly = match_polygon(lon, lat, polygons, tile_index, tile_deg)
        if not poly:
            misses += 1
            continue

        output_rows.append(
            {
                "gx": gx,
                "gy": gy,
                "pct_progressive": poly.values.pct_progressive,
                "pct_conservative": poly.values.pct_conservative,
                "pct_popular_right": poly.values.pct_popular_right,
                "constituency": poly.values.constituency,
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(output_path, "wt", encoding="utf-8") as f:
        json.dump(output_rows, f, separators=(",", ":"))

    print(
        f"wrote {len(output_rows):,} vote cells to {output_path} "
        f"(misses: {misses:,}, total rows: {len(rows):,})"
    )


def parse_args():
    parser = argparse.ArgumentParser(description="Build compact vote-by-cell artifacts from constituency vote polygons.")
    parser.add_argument("--vote-geojson", default=str(MODEL_VOTE_BLOCKS_MAP_GEOJSON), help="Path to ge2024_vote_blocks_map.geojson")
    parser.add_argument("--grid-rows", help="Path to grid_<size>_full.json.gz for a single grid")
    parser.add_argument("--grid-meters", type=int, choices=[1000, 5000, 10000, 25000], help="Grid size in meters")
    parser.add_argument("--output", help="Output .json.gz path for single-grid mode")
    parser.add_argument("--input-dir", default=str(PUBLIC_DATA_DIR), help="Directory containing grid_1km_full.json.gz etc (all-grid mode)")
    parser.add_argument("--output-dir", default=str(MODEL_VOTE_DIR), help="Output directory for vote_cells_<grid>.json.gz (all-grid mode)")
    parser.add_argument("--tile-deg", type=float, default=0.25, help="Spatial index tile size in degrees")
    return parser.parse_args()


def main():
    ensure_pipeline_dirs()
    args = parse_args()
    vote_geojson_path = Path(args.vote_geojson)

    single_mode = args.grid_rows and args.grid_meters and args.output
    all_mode = args.input_dir and args.output_dir

    if single_mode and all_mode:
        raise SystemExit("Use either single-grid args (--grid-rows, --grid-meters, --output) or all-grid args (--input-dir, --output-dir).")
    if not single_mode and not all_mode:
        raise SystemExit("Missing required arguments. Use single-grid mode or all-grid mode.")

    if single_mode:
        build_vote_cells(
            vote_geojson_path=vote_geojson_path,
            grid_rows_path=Path(args.grid_rows),
            output_path=Path(args.output),
            grid_meters=int(args.grid_meters),
            tile_deg=float(args.tile_deg),
        )
        return

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    jobs = [
        ("1km", 1000),
        ("5km", 5000),
        ("10km", 10000),
        ("25km", 25000),
    ]

    for label, meters in jobs:
        grid_rows_path = input_dir / f"grid_{label}_full.json.gz"
        output_path = output_dir / f"vote_cells_{label}.json.gz"
        build_vote_cells(
            vote_geojson_path=vote_geojson_path,
            grid_rows_path=grid_rows_path,
            output_path=output_path,
            grid_meters=meters,
            tile_deg=float(args.tile_deg),
        )


if __name__ == "__main__":
    main()

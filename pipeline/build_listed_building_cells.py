"""
build_listed_building_cells.py
─────────────────────────────
Aggregates listed building points into grid cells at four resolutions
(1km, 5km, 10km, 25km) and writes listed_building_cells_{grid}.json.gz.

Grading weights:
  Grade I    → 3 pts   (most significant)
  Grade II*  → 2 pts
  Grade II   → 1 pt (majority of buildings)

Each cell stores:
  gx, gy          – BNG grid origin (EPSG:27700)
  lb_score        – normalised heritage density 0–100 (99th-pct cap)
  lb_count        – total listed buildings in cell
  lb_grade1       – Grade I count
  lb_grade2s      – Grade II* count
  lb_grade2       – Grade II count
"""

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from pyproj import Transformer

# ── paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import MODEL_TRANSIT_DIR, MODEL_LISTED_BUILDING_CELLS_DIR

INPUT_FILE = MODEL_TRANSIT_DIR / "listed_building_overlay_points.geojson.gz"

GRIDS = {
    "1km":  1000,
    "5km":  5000,
    "10km": 10_000,
    "25km": 25_000,
}

GRADE_WEIGHTS = {
    "I":  3,
    "II*": 2,
    "II": 1,
}

# ── crs transformer (WGS84 → BNG) ───────────────────────────────────────────
_transformer = Transformer.from_crs("EPSG:4326", "EPSG:27700", always_xy=True)


def transform_wgs84_to_bng(lon: float, lat: float) -> tuple[float, float]:
    return _transformer.transform(lon, lat)  # returns (easting, northing)


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    MODEL_LISTED_BUILDING_CELLS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Reading {INPUT_FILE} …")
    with gzip.open(INPUT_FILE, "rt", encoding="utf-8") as f:
        fc = json.load(f)

    features = fc.get("features", [])
    print(f"  {len(features):,} features loaded")

    # For each grid size build: {(gx, gy): {"raw": int, "count": int, "g1": int, "g2s": int, "g2": int}}
    grid_cells: dict[str, dict[tuple[int, int], dict]] = {g: defaultdict(lambda: {"raw": 0, "count": 0, "g1": 0, "g2s": 0, "g2": 0}) for g in GRIDS}

    skip = 0
    for feat in features:
        geom = feat.get("geometry") or {}
        if geom.get("type") != "Point":
            skip += 1
            continue
        coords = geom.get("coordinates", [])
        if len(coords) < 2:
            skip += 1
            continue

        lon, lat = coords[0], coords[1]
        props = feat.get("properties") or {}
        grade_raw = str(props.get("grade") or "").strip()

        # Normalise grade string
        if grade_raw == "II*":
            grade = "II*"
        elif grade_raw == "I":
            grade = "I"
        else:
            grade = "II"  # default for "II" or anything unrecognised

        weight = GRADE_WEIGHTS[grade]

        try:
            e, n = transform_wgs84_to_bng(lon, lat)
        except Exception:
            skip += 1
            continue

        for grid_name, step in GRIDS.items():
            gx = int(e) // step * step
            gy = int(n) // step * step
            cell = grid_cells[grid_name][(gx, gy)]
            cell["raw"] += weight
            cell["count"] += 1
            if grade == "I":
                cell["g1"] += 1
            elif grade == "II*":
                cell["g2s"] += 1
            else:
                cell["g2"] += 1

    if skip:
        print(f"  Skipped {skip:,} features (no point geometry or bad coords)")

    # Write each grid file
    for grid_name, cells in grid_cells.items():
        if not cells:
            print(f"  [{grid_name}] no cells — skipping")
            continue

        raw_scores = np.array([v["raw"] for v in cells.values()], dtype=float)
        p99 = float(np.percentile(raw_scores, 99))
        if p99 == 0:
            p99 = 1.0  # avoid div-by-zero for degenerate input

        rows = []
        for (gx, gy), v in sorted(cells.items()):
            lb_score = min(100, round(v["raw"] / p99 * 100))
            rows.append({
                "gx": gx,
                "gy": gy,
                "lb_raw": v["raw"],
                "lb_score": lb_score,
                "lb_count": v["count"],
                "lb_grade1": v["g1"],
                "lb_grade2s": v["g2s"],
                "lb_grade2": v["g2"],
            })

        out_path = MODEL_LISTED_BUILDING_CELLS_DIR / f"listed_building_cells_{grid_name}.json.gz"
        json_bytes = json.dumps(rows, separators=(",", ":")).encode("utf-8")
        with gzip.open(out_path, "wb") as gz:
            gz.write(json_bytes)

        size_kb = out_path.stat().st_size / 1024
        print(f"  [{grid_name}] {len(rows):,} cells → {out_path.name}  ({size_kb:.1f} KB gz)")

    print("Done.")


if __name__ == "__main__":
    main()

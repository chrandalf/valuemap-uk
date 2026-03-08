#!/usr/bin/env python3
"""Build broadband speed cells from Ofcom OA-level coverage data.

Source: Ofcom Connected Nations Update — fixed broadband coverage ZIP
        (202507_fixed_broadband_coverage_r01.zip or similar)
        Place in pipeline/data/raw/broadband/

Join:   ONSPD postcode → OA21CD → BNG easting/northing → grid cells (1km/5km/10km/25km)

For each Output Area we compute:
  bb_avg_speed  — premises-weighted average max available download speed (Mbit/s)
  bb_pct_sfbb   — % of premises capable of SFBB+ (≥30 Mbit/s)
  bb_pct_fast   — % of premises capable of ultrafast (≥300 Mbit/s; proxy for fibre/cable)

Speed band midpoints used for bb_avg_speed:
  Band          Representative speed
  0–2 Mbit/s         1  Mbit/s
  2–5 Mbit/s         3.5
  5–10 Mbit/s        7.5
  10–30 Mbit/s      20
  30–300 Mbit/s    100   (urban median ~80-150 Mbit/s, 100 is conservative)
  ≥300 Mbit/s      500   (typical cable/FTTP; Ofcom performance data shows 500-900)

For each grid cell we aggregate all three metrics as postcode-count-weighted means.

Output: broadband_cells_{1km,5km,10km,25km}.json.gz
        Each row: {"gx": <int>, "gy": <int>, "bb_avg_speed": <float>,
                   "bb_pct_sfbb": <float>, "bb_pct_fast": <float>}
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import zipfile
from pathlib import Path

try:
    import paths
except ImportError:
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    import paths

# ------------------------------------------------------------------
# Speed band columns in the OA coverage CSV and representative speeds
# ------------------------------------------------------------------
BAND_COLS: list[tuple[str, float]] = [
    ("Number of premises with 0<2Mbit/s download speed",    1.0),
    ("Number of premises with 2<5Mbit/s download speed",    3.5),
    ("Number of premises with 5<10Mbit/s download speed",   7.5),
    ("Number of premises with 10<30Mbit/s download speed",  20.0),
    ("Number of premises with 30<300Mbit/s download speed", 100.0),
    ("Number of premises with >=300Mbit/s download speed",  500.0),
]

GRIDS: dict[str, int] = {"1km": 1000, "5km": 5000, "10km": 10000, "25km": 25000}


def snap(v: int, step: int) -> int:
    return (v // step) * step


def find_coverage_zip(raw_dir: Path) -> Path:
    """Locate the Ofcom fixed broadband coverage ZIP in raw_dir."""
    candidates = sorted(raw_dir.glob("*coverage*.zip"))
    if not candidates:
        raise FileNotFoundError(
            f"No coverage ZIP found in {raw_dir}. "
            "Download 202507_fixed_broadband_coverage_r01.zip (or similar) from "
            "https://www.ofcom.org.uk/research-and-data/telecoms-research/connected-nations "
            f"and place it in {raw_dir}/"
        )
    return candidates[0]


def load_oa_speeds(coverage_zip_path: Path) -> dict[str, float]:
    """Return {oa21cd: bb_avg_speed_Mbps} for all matched Output Areas.

    The OA coverage CSV is inside a nested ZIP inside the outer coverage ZIP.
    """
    print(f"  Opening coverage ZIP: {coverage_zip_path.name}")
    with zipfile.ZipFile(coverage_zip_path) as outer:
        # Find the nested OA coverage ZIP
        nested_names = [
            n for n in outer.namelist()
            if "oa_coverage" in n.lower() and n.endswith(".zip")
        ]
        if not nested_names:
            raise FileNotFoundError(
                f"Could not find OA coverage nested ZIP inside {coverage_zip_path}"
            )
        nested_name = nested_names[0]
        print(f"  Extracting nested ZIP: {nested_name}")
        with outer.open(nested_name) as nb:
            nested_bytes = nb.read()

    with zipfile.ZipFile(io.BytesIO(nested_bytes)) as inner:
        # Find the main OA coverage CSV (not the _res_ residential variant)
        csv_names = [
            n for n in inner.namelist()
            if n.endswith(".csv") and "res_coverage" not in n
        ]
        if not csv_names:
            raise FileNotFoundError("No OA coverage CSV found in nested ZIP")
        csv_name = csv_names[0]
        print(f"  Reading CSV: {csv_name}")

        # (oa21cd → {avg_speed, pct_sfbb, pct_fast})
        result: dict[str, dict[str, float]] = {}
        with inner.open(csv_name) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
            for row in reader:
                oa = row.get("output_area", "").strip()
                if not oa:
                    continue

                # Build weighted average and coverage % from premises counts
                weighted_sum = 0.0
                n_sum = 0
                n_sfbb = 0   # premises with ≥30 Mbit/s (30<300 + ≥300 bands)
                n_fast = 0   # premises with ≥300 Mbit/s
                for col, midpoint in BAND_COLS:
                    v_str = row.get(col, "").strip()
                    if v_str and v_str.isdigit():
                        n = int(v_str)
                        weighted_sum += n * midpoint
                        n_sum += n
                        if midpoint >= 30:
                            n_sfbb += n
                        if midpoint >= 300:
                            n_fast += n

                if n_sum > 0:
                    result[oa] = {
                        "avg_speed": weighted_sum / n_sum,
                        "pct_sfbb":  n_sfbb / n_sum * 100,
                        "pct_fast":  n_fast / n_sum * 100,
                    }

    print(f"  Loaded speeds for {len(result):,} Output Areas")
    return result


def build_grid_cells(
    oa_speeds: dict[str, dict[str, float]],
    onspd_path: Path,
) -> dict[str, dict[str, dict]]:
    """Single ONSPD pass: postcode → OA21CD → metrics → snap to all grid sizes.

    Returns {grid_name: {"gx_gy": {"gx": int, "gy": int,
                                    "sum": float, "sum_sfbb": float, "sum_fast": float, "n": int}}}
    """
    grids: dict[str, dict[str, dict]] = {g: {} for g in GRIDS}
    processed = 0
    matched = 0

    print(f"  Scanning ONSPD: {onspd_path.name}")
    with open(onspd_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            processed += 1

            oa = row.get("OA21CD", "").strip()
            if not oa:
                continue
            metrics = oa_speeds.get(oa)
            if metrics is None:
                continue

            east_str = row.get("EAST1M", "").strip()
            north_str = row.get("NORTH1M", "").strip()
            if not east_str or not north_str:
                continue
            try:
                e = int(float(east_str))
                n = int(float(north_str))
            except ValueError:
                continue
            if e <= 0 or n <= 0:
                continue

            matched += 1
            for grid_name, step in GRIDS.items():
                gx = snap(e, step)
                gy = snap(n, step)
                key = f"{gx}_{gy}"
                if key not in grids[grid_name]:
                    grids[grid_name][key] = {"gx": gx, "gy": gy, "sum": 0.0, "sum_sfbb": 0.0, "sum_fast": 0.0, "n": 0}
                cell = grids[grid_name][key]
                cell["sum"] += metrics["avg_speed"]
                cell["sum_sfbb"] += metrics["pct_sfbb"]
                cell["sum_fast"] += metrics["pct_fast"]
                cell["n"] += 1

    print(
        f"  Processed {processed:,} postcodes, "
        f"matched {matched:,} to broadband OA data "
        f"({matched / processed * 100:.1f}%)"
    )
    return grids


def main() -> None:
    paths.ensure_pipeline_dirs()

    coverage_zip = find_coverage_zip(paths.RAW_BROADBAND_DIR)
    onspd_path = paths.RAW_PROPERTY_DIR / "ONSPD_Online_latest_Postcode_Centroids_.csv"

    if not onspd_path.exists():
        raise FileNotFoundError(
            f"ONSPD file not found at {onspd_path}. "
            "Download from ONS and place in pipeline/data/raw/property/"
        )

    print("Step 1: Load OA coverage speeds")
    oa_speeds = load_oa_speeds(coverage_zip)

    print("Step 2: Build grid cells via ONSPD")
    grids = build_grid_cells(oa_speeds, onspd_path)

    print("Step 3: Write output files")
    paths.MODEL_BROADBAND_DIR.mkdir(parents=True, exist_ok=True)

    for grid_name in GRIDS:
        rows = [
            {
                "gx": cell["gx"],
                "gy": cell["gy"],
                "bb_avg_speed": round(cell["sum"]      / cell["n"], 1),
                "bb_pct_sfbb":  round(cell["sum_sfbb"] / cell["n"], 1),
                "bb_pct_fast":  round(cell["sum_fast"] / cell["n"], 1),
            }
            for cell in grids[grid_name].values()
            if cell["n"] > 0
        ]
        out_path = paths.MODEL_BROADBAND_DIR / f"broadband_cells_{grid_name}.json.gz"
        with gzip.open(out_path, "wt", encoding="utf-8") as fh:
            json.dump(rows, fh)
        print(f"  {grid_name}: {len(rows):,} cells → {out_path}")

    print("Done.")


if __name__ == "__main__":
    main()

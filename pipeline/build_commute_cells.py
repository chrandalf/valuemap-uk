"""
Build commute-distance grid cells from Census 2021 TS058 data.

Reads:
  RAW_CENSUS_COMMUTE_LSOA  – ts058_commute_lsoa21.csv  (one row per LSOA21)
  ONSPD                    – postcode → LSOA21CD + eastings/northings

Joins every postcode to its LSOA commute stats, snaps to 4 grid sizes, and
writes one gzipped JSON file per grid into MODEL_CENSUS_DIR:
  commute_cells_1km.json.gz
  commute_cells_5km.json.gz
  commute_cells_10km.json.gz
  commute_cells_25km.json.gz

Each file is a JSON array of objects:
  { "gx": <int>, "gy": <int>, "mean_dist_km": <float>, "pct_wfh": <float> }
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from paths import (
    MODEL_CENSUS_DIR,
    MODEL_CENSUS_COMMUTE_CELLS_TEMPLATE,
    RAW_CENSUS_COMMUTE_LSOA,
    RAW_PROPERTY_DIR,
    ensure_pipeline_dirs,
)

ONSPD_DEFAULT = RAW_PROPERTY_DIR / "ONSPD_Online_latest_Postcode_Centroids_.csv"

GRID_SIZES: list[tuple[str, int]] = [
    ("1km",  1_000),
    ("5km",  5_000),
    ("10km", 10_000),
    ("25km", 25_000),
]


# ── ONSPD loader ─────────────────────────────────────────────────────────────

def load_onspd_with_lsoa(path: Path) -> pd.DataFrame:
    """Return DataFrame with columns: pcds, lsoa21cd, east, north."""
    if not path.exists():
        raise FileNotFoundError(f"ONSPD file not found: {path}")

    # Probe headers
    header = pd.read_csv(path, nrows=0)
    cols = {c.lower().strip(): c for c in header.columns}

    pcds_col  = cols.get("pcds") or cols.get("pcd7") or cols.get("pcd")
    lsoa_col  = cols.get("lsoa21cd") or cols.get("lsoa11cd")
    east_col  = cols.get("east1m") or cols.get("eastings") or cols.get("x")
    north_col = cols.get("north1m") or cols.get("northings") or cols.get("y")

    if not all([pcds_col, lsoa_col, east_col, north_col]):
        missing = [n for n, c in [("pcds", pcds_col), ("lsoa21cd", lsoa_col),
                                   ("east1m", east_col), ("north1m", north_col)] if not c]
        raise RuntimeError(f"ONSPD missing expected columns: {missing}")

    wanted = [pcds_col, lsoa_col, east_col, north_col]
    frames: list[pd.DataFrame] = []

    for chunk in pd.read_csv(
        path,
        usecols=wanted,
        dtype={pcds_col: "string", lsoa_col: "string", east_col: "string", north_col: "string"},
        chunksize=500_000,
    ):
        chunk = chunk.rename(columns={
            pcds_col: "pcds",
            lsoa_col: "lsoa21cd",
            east_col: "east",
            north_col: "north",
        })
        chunk["east"]  = pd.to_numeric(chunk["east"],  errors="coerce")
        chunk["north"] = pd.to_numeric(chunk["north"], errors="coerce")
        chunk = chunk.dropna(subset=["pcds", "lsoa21cd", "east", "north"])
        chunk = chunk[chunk["lsoa21cd"].str.startswith(("E", "W"))]   # England & Wales only
        frames.append(chunk)

    if not frames:
        raise RuntimeError("No valid rows found in ONSPD after filtering")

    df = pd.concat(frames, ignore_index=True)
    print(f"  ONSPD rows (E+W): {len(df):,}")
    return df


# ── Grid snap + aggregate ────────────────────────────────────────────────────

BAND_COLS = ["mean_dist_km", "pct_wfh", "pct_lt5", "pct_5_10", "pct_10_20", "pct_20_60", "pct_60p"]
ROUND2 = ["pct_wfh", "pct_lt5", "pct_5_10", "pct_10_20", "pct_20_60", "pct_60p"]


def build_cells_for_grid(df_joined: pd.DataFrame, grid_m: int) -> list[dict]:
    """Snap postcodes to grid cells and compute per-cell mean commute stats."""
    df = df_joined.copy()
    df["gx"] = (df["east"]  // grid_m * grid_m).astype(int)
    df["gy"] = (df["north"] // grid_m * grid_m).astype(int)

    agg_spec = {col: (col, "mean") for col in BAND_COLS}
    agg = df.groupby(["gx", "gy"], as_index=False).agg(**agg_spec)

    agg["mean_dist_km"] = agg["mean_dist_km"].round(3)
    for col in ROUND2:
        agg[col] = agg[col].round(1)

    records = agg.to_dict(orient="records")
    return records


# ── Main ─────────────────────────────────────────────────────────────────────

def main(onspd_path: Path) -> None:
    ensure_pipeline_dirs()

    # 1. Load commute data
    if not RAW_CENSUS_COMMUTE_LSOA.exists():
        raise FileNotFoundError(
            f"Commute CSV not found: {RAW_CENSUS_COMMUTE_LSOA}\n"
            "Run fetch_commute_data.py first."
        )
    print(f"Loading commute data: {RAW_CENSUS_COMMUTE_LSOA}")
    raw = pd.read_csv(
        RAW_CENSUS_COMMUTE_LSOA,
        usecols=["geography_code", "total", "wfh", "lt_2km", "km2_5",
                 "km5_10", "km10_20", "km20_30", "km30_40", "km40_60",
                 "km60_plus", "mean_dist_km", "pct_wfh"],
        dtype={"geography_code": str},
    )
    # Compute LSOA-level band percentages (each 0-100 scale)
    tot = raw["total"].replace(0, float("nan"))
    raw["pct_lt5"]   = (raw["lt_2km"] + raw["km2_5"])                           / tot * 100
    raw["pct_5_10"]  =  raw["km5_10"]                                            / tot * 100
    raw["pct_10_20"] =  raw["km10_20"]                                           / tot * 100
    raw["pct_20_60"] = (raw["km20_30"] + raw["km30_40"] + raw["km40_60"])       / tot * 100
    raw["pct_60p"]   =  raw["km60_plus"]                                         / tot * 100
    df_commute = raw[["geography_code", "mean_dist_km", "pct_wfh",
                      "pct_lt5", "pct_5_10", "pct_10_20", "pct_20_60", "pct_60p"]]
    print(f"  Commute LSOAs: {len(df_commute):,}")

    # 2. Load ONSPD
    print(f"Loading ONSPD: {onspd_path}")
    df_onspd = load_onspd_with_lsoa(onspd_path)

    # 3. Join postcode → commute stats via LSOA21CD
    df_joined = df_onspd.merge(
        df_commute,
        left_on="lsoa21cd",
        right_on="geography_code",
        how="inner",
    )
    print(f"  Joined rows: {len(df_joined):,}")
    if df_joined.empty:
        raise RuntimeError("Join produced no rows – check LSOA column names in ONSPD")

    # 4. Build one file per grid size
    for grid_label, grid_m in GRID_SIZES:
        print(f"Building {grid_label} cells …", end=" ", flush=True)
        cells = build_cells_for_grid(df_joined, grid_m)
        print(f"{len(cells):,} cells")

        out_path = MODEL_CENSUS_DIR / MODEL_CENSUS_COMMUTE_CELLS_TEMPLATE.name.format(grid=grid_label)
        with gzip.open(out_path, "wt", encoding="utf-8") as f:
            json.dump(cells, f, separators=(",", ":"))
        size_kb = out_path.stat().st_size // 1024
        print(f"  → {out_path.name}  ({size_kb:,} KB)")

    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build commute grid cells from Census TS058 + ONSPD")
    parser.add_argument(
        "--onspd",
        default=str(ONSPD_DEFAULT),
        help="Path to ONSPD postcode centroid CSV",
    )
    args = parser.parse_args()
    main(onspd_path=Path(args.onspd).expanduser().resolve())

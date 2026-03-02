"""
Build crime-rate grid cells from the LSOA crime overlay.

Reads:
  MODEL_CRIME_OVERLAY  – crime_overlay_lsoa.geojson.gz
  ONSPD                – postcode → LSOA21CD + BNG eastings/northings

Joins every postcode to its LSOA crime stats, snaps to 4 grid sizes, and
writes one gzipped JSON file per grid into MODEL_CRIME_DIR:
  crime_cells_1km.json.gz
  crime_cells_5km.json.gz
  crime_cells_10km.json.gz
  crime_cells_25km.json.gz

Each file is a JSON array of objects:
  {
    "gx": <int>, "gy": <int>,
    "violent_rate":  <float>,   # annualised crimes per 1 000 residents
    "property_rate": <float>,
    "asb_rate":      <float>,
    "total_rate":    <float>,
    "crime_score":   <int>,     # 0-100, 100 = safest  (from weighted composite)
    "violent_score": <int>,
    "property_score":<int>,
    "asb_score":     <int>,
  }

Composite weight: violent×4 + property×1 + asb×0.3 (normalised by 5.3).
Scoring: inverse national percentile — cells with the LOWEST rate score 100.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from paths import (
    MODEL_CRIME_CELLS_TEMPLATE,
    MODEL_CRIME_DIR,
    MODEL_CRIME_OVERLAY,
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

# Composite weights
W_VIOLENT  = 4.0
W_PROPERTY = 1.0
W_ASB      = 0.3
W_TOTAL    = W_VIOLENT + W_PROPERTY + W_ASB  # 5.3


# ── LSOA crime loader ─────────────────────────────────────────────────────────

def load_lsoa_crime(path: Path) -> pd.DataFrame:
    """
    Parse crime_overlay_lsoa.geojson.gz and return a DataFrame with columns:
    lsoa_code, violent_crimes, property_crimes, asb_crimes, population, months.
    """
    if not path.exists():
        raise FileNotFoundError(
            f"Crime LSOA overlay not found: {path}\n"
            "Run build_crime_overlay.py first."
        )

    print(f"Loading LSOA crime overlay: {path}")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        gj = json.load(f)

    rows: list[dict] = []
    for feature in gj["features"]:
        p = feature["properties"]
        lsoa = p.get("lsoa_code") or p.get("lsoa21cd", "")
        if not lsoa:
            continue
        pop     = float(p.get("population") or 0)
        months  = float(p.get("months")    or 0)
        violent  = float(p.get("violent_crimes")  or 0)
        prop_c   = float(p.get("property_crimes") or 0)
        asb      = float(p.get("asb_crimes")      or 0)
        total    = float(p.get("total_crimes")     or 0)

        if months <= 0 or pop <= 0:
            continue

        rows.append({
            "lsoa_code": lsoa,
            "population": pop,
            "months": months,
            # annualise crime counts to a full year
            "violent_annual":  violent  / months * 12,
            "property_annual": prop_c   / months * 12,
            "asb_annual":      asb      / months * 12,
            "total_annual":    total    / months * 12,
        })

    df = pd.DataFrame(rows)
    print(f"  LSOA rows loaded: {len(df):,}")
    return df


# ── ONSPD loader ─────────────────────────────────────────────────────────────

def load_onspd_with_lsoa(path: Path) -> pd.DataFrame:
    """Return DataFrame with columns: pcds, lsoa21cd, east, north.
    England and Wales only (E/W prefix on lsoa21cd).
    """
    if not path.exists():
        raise FileNotFoundError(f"ONSPD file not found: {path}")

    header = pd.read_csv(path, nrows=0)
    cols = {c.lower().strip(): c for c in header.columns}

    pcds_col  = cols.get("pcds")    or cols.get("pcd7")     or cols.get("pcd")
    lsoa_col  = cols.get("lsoa21cd") or cols.get("lsoa11cd")
    east_col  = cols.get("east1m")  or cols.get("eastings") or cols.get("x")
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
        chunk = chunk[chunk["lsoa21cd"].str.startswith(("E", "W"))]
        frames.append(chunk)

    if not frames:
        raise RuntimeError("No valid rows found in ONSPD after filtering")

    df = pd.concat(frames, ignore_index=True)
    print(f"  ONSPD rows (E+W): {len(df):,}")
    return df


# ── Percentile scoring ────────────────────────────────────────────────────────

def invert_score_pct(series: pd.Series) -> pd.Series:
    """
    Rank-based inverse percentile: safest cell → 100, most dangerous → 0.
    Ties receive the same score (average rank).
    """
    ranks = series.rank(method="average")
    n = len(series)
    # pct rank 0→1 where 1 = highest rate (most dangerous)
    pct = (ranks - 1) / max(n - 1, 1)
    return ((1 - pct) * 100).round(1)


# ── Grid snap + aggregate ────────────────────────────────────────────────────

def build_cells_for_grid(df_joined: pd.DataFrame, grid_m: int) -> list[dict]:
    """
    Snap postcode points to a grid and compute per-cell crime rates + scores.

    df_joined must contain: east, north, population, violent_annual,
    property_annual, asb_annual, total_annual (one row per postcode).
    The crime columns are LSOA totals (same value for every postcode in the LSOA).
    We weight by the number of postcodes per LSOA to avoid double-counting —
    we do this by working with per-postcode fractional crime shares:
    each postcode carries (1 / n_postcodes_in_lsoa) of the LSOA's annual crimes.
    """
    # Fractional share: weight each postcode by 1/n_postcodes in its LSOA
    df = df_joined.copy()
    pc_per_lsoa = df.groupby("lsoa21cd")["pcds"].transform("count")
    df["frac"]  = 1.0 / pc_per_lsoa

    # Each postcode contributes a fraction of the LSOA's annual crimes
    for col in ("violent_annual", "property_annual", "asb_annual", "total_annual", "population"):
        df[f"{col}_frac"] = df[col] * df["frac"]

    df["gx"] = (df["east"]  // grid_m * grid_m).astype(int)
    df["gy"] = (df["north"] // grid_m * grid_m).astype(int)

    agg = df.groupby(["gx", "gy"], as_index=False).agg(
        violent_sum  =("violent_annual_frac",  "sum"),
        property_sum =("property_annual_frac", "sum"),
        asb_sum      =("asb_annual_frac",      "sum"),
        total_sum    =("total_annual_frac",     "sum"),
        population   =("population_frac",       "sum"),
    )

    # Rates per 1 000 residents
    pop = agg["population"].clip(lower=1)  # avoid div/0
    agg["violent_rate"]  = (agg["violent_sum"]  / pop * 1000).round(1)
    agg["property_rate"] = (agg["property_sum"] / pop * 1000).round(1)
    agg["asb_rate"]      = (agg["asb_sum"]      / pop * 1000).round(1)
    agg["total_rate"]    = (agg["total_sum"]     / pop * 1000).round(1)

    # Weighted composite rate (for overall crime_score)
    agg["weighted_rate"] = (
        agg["violent_rate"]  * W_VIOLENT +
        agg["property_rate"] * W_PROPERTY +
        agg["asb_rate"]      * W_ASB
    ) / W_TOTAL

    # Inverse-percentile scores
    agg["crime_score"]    = invert_score_pct(agg["weighted_rate"]).astype(int)
    agg["violent_score"]  = invert_score_pct(agg["violent_rate"]).astype(int)
    agg["property_score"] = invert_score_pct(agg["property_rate"]).astype(int)
    agg["asb_score"]      = invert_score_pct(agg["asb_rate"]).astype(int)

    keep = ["gx", "gy",
            "violent_rate", "property_rate", "asb_rate", "total_rate",
            "crime_score", "violent_score", "property_score", "asb_score"]
    records = agg[keep].to_dict(orient="records")
    return records


# ── Main ─────────────────────────────────────────────────────────────────────

def main(onspd_path: Path) -> None:
    ensure_pipeline_dirs()

    # 1. Load LSOA crime data
    df_crime = load_lsoa_crime(MODEL_CRIME_OVERLAY)

    # 2. Load ONSPD (postcode → lsoa21cd + BNG coords)
    print(f"Loading ONSPD: {onspd_path}")
    df_onspd = load_onspd_with_lsoa(onspd_path)

    # 3. Join: each postcode gets the crime stats of its LSOA
    df_joined = df_onspd.merge(
        df_crime,
        left_on="lsoa21cd",
        right_on="lsoa_code",
        how="inner",
    )
    print(f"  Joined rows (postcodes with crime data): {len(df_joined):,}")
    if df_joined.empty:
        raise RuntimeError("Join produced no rows – check LSOA code column names")

    # 4. Build one file per grid size
    for grid_label, grid_m in GRID_SIZES:
        print(f"Building {grid_label} cells …", end=" ", flush=True)
        cells = build_cells_for_grid(df_joined, grid_m)
        print(f"{len(cells):,} cells")

        out_path = MODEL_CRIME_DIR / MODEL_CRIME_CELLS_TEMPLATE.name.format(grid=grid_label)
        with gzip.open(out_path, "wt", encoding="utf-8") as f:
            json.dump(cells, f, separators=(",", ":"))
        size_kb = out_path.stat().st_size // 1024
        print(f"  → {out_path.name}  ({size_kb:,} KB)")

    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build crime grid cells from LSOA overlay + ONSPD"
    )
    parser.add_argument(
        "--onspd",
        default=str(ONSPD_DEFAULT),
        help="Path to ONSPD postcode centroid CSV",
    )
    args = parser.parse_args()
    main(onspd_path=Path(args.onspd).expanduser().resolve())

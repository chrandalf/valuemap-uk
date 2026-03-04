"""
Build crime-rate grid cells from the LSOA crime overlay.

Reads:
  MODEL_CRIME_OVERLAY  â€“ crime_overlay_lsoa.geojson.gz
  ONSPD                â€“ postcode â†’ LSOA21CD + BNG eastings/northings

Joins every postcode to its LSOA crime stats, snaps to 4 grid sizes, and
writes one gzipped JSON file per grid into MODEL_CRIME_DIR:
  crime_cells_1km.json.gz
  crime_cells_5km.json.gz
  crime_cells_10km.json.gz
  crime_cells_25km.json.gz

Each file is a JSON array of objects:
  {
    "gx": <int>, "gy": <int>,
    "violent_rate":  <float>,   # annualised crimes per 1,000 residents
    "property_rate": <float>,
    "asb_rate":      <float>,
    "total_rate":    <float>,
    # Absolute scores: national inverse-percentile (100 = safest in UK)
    "crime_score":    <int>,
    "violent_score":  <int>,
    "property_score": <int>,
    "asb_score":      <int>,
    # Relative (local-area blended) scores â€” weight shifts from national
    # to local neighbourhood as grid size shrinks (100 = safest locally)
    "crime_local_score":    <int>,
    "violent_local_score":  <int>,
    "property_local_score": <int>,
    "asb_local_score":      <int>,
  }

Composite weight: violentÃ—4 + propertyÃ—1 + asbÃ—0.3 (normalised by 5.3).
Absolute scoring: inverse national percentile â€” cells with the LOWEST rate score 100.
Local scoring: cells ranked within a spatial neighbourhood, blended with national score.
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

# Per-grid local-score config: how large a BNG window to use, and how much
# weight to give the local rank vs the national rank.
# At 25km, pure national (local adds no meaningful context over that scale).
LOCAL_CONFIG: dict[str, dict] = {
    "1km":  {"radius_m": 15_000, "local_weight": 0.85},
    "5km":  {"radius_m": 30_000, "local_weight": 0.60},
    "10km": {"radius_m": 60_000, "local_weight": 0.30},
    "25km": {"radius_m":       0, "local_weight": 0.00},
}


# â”€â”€ LSOA crime loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


# â”€â”€ ONSPD loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


# â”€â”€ Percentile scoring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def invert_score_pct(series: pd.Series) -> pd.Series:
    """
    Rank-based inverse percentile: safest cell â†’ 100, most dangerous â†’ 0.
    Ties receive the same score (average rank).
    """
    ranks = series.rank(method="average")
    n = len(series)
    pct = (ranks - 1) / max(n - 1, 1)
    return ((1 - pct) * 100).round(1)


def compute_local_pct(
    gx_arr: np.ndarray,
    gy_arr: np.ndarray,
    rate_arr: np.ndarray,
    radius_m: int,
) -> np.ndarray:
    """
    For each cell, compute its inverse-percentile rank within its spatial
    neighbourhood (a square window of side 2*radius_m centred on the cell).

    Returns an array of values 0â€“100 where 100 = safest in the local area.

    Uses sorted binary-search so the overall complexity is O(n log n + n*k)
    where k is the average neighbourhood size. No scipy required.
    """
    n = len(rate_arr)
    if radius_m <= 0 or n == 0:
        return np.full(n, 50.0)

    # Sort by gx for efficient range queries
    sorted_idx  = np.argsort(gx_arr, kind="stable")
    sorted_gx   = gx_arr[sorted_idx]
    sorted_gy   = gy_arr[sorted_idx]
    sorted_rate = rate_arr[sorted_idx]

    local_pct = np.empty(n, dtype=np.float64)

    for i in range(n):
        cx = gx_arr[i]
        cy = gy_arr[i]
        ri = rate_arr[i]

        # Slice cells within x-range using binary search
        lo = int(np.searchsorted(sorted_gx, cx - radius_m, side="left"))
        hi = int(np.searchsorted(sorted_gx, cx + radius_m, side="right"))

        if hi <= lo:
            local_pct[i] = 50.0
            continue

        # Filter by y-distance (square window)
        win_gy   = sorted_gy[lo:hi]
        win_rate = sorted_rate[lo:hi]
        mask     = np.abs(win_gy - cy) <= radius_m
        nbr_rates = win_rate[mask]
        k = len(nbr_rates)

        if k <= 1:
            local_pct[i] = 50.0
            continue

        # Fraction of neighbours with LOWER rate â†’ inverse rank (0 = best)
        lower = float(np.sum(nbr_rates < ri))
        equal = float(np.sum(nbr_rates == ri))
        rank  = lower + 0.5 * equal          # average-rank tie-breaking
        # Invert: low rate = high safety score
        local_pct[i] = (1.0 - rank / (k - 1)) * 100.0

    return local_pct


# â”€â”€ Grid snap + aggregate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def build_cells_for_grid(
    df_joined: pd.DataFrame,
    grid_m: int,
    grid_label: str,
) -> list[dict]:
    """
    Snap postcode points to a grid and compute per-cell crime rates, national
    scores, and blended local scores.
    """
    # Fractional share: weight each postcode by 1/n_postcodes in its LSOA
    df = df_joined.copy()
    pc_per_lsoa = df.groupby("lsoa21cd")["pcds"].transform("count")
    df["frac"]  = 1.0 / pc_per_lsoa

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

    # Rates per 1,000 residents (annualised)
    pop = agg["population"].clip(lower=1)
    agg["violent_rate"]  = (agg["violent_sum"]  / pop * 1000).round(1)
    agg["property_rate"] = (agg["property_sum"] / pop * 1000).round(1)
    agg["asb_rate"]      = (agg["asb_sum"]      / pop * 1000).round(1)
    agg["total_rate"]    = (agg["total_sum"]     / pop * 1000).round(1)

    # Weighted composite for overall score
    agg["weighted_rate"] = (
        agg["violent_rate"]  * W_VIOLENT +
        agg["property_rate"] * W_PROPERTY +
        agg["asb_rate"]      * W_ASB
    ) / W_TOTAL

    # â”€â”€ National (absolute) scores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    agg["crime_score"]    = invert_score_pct(agg["weighted_rate"]).astype(int)
    agg["violent_score"]  = invert_score_pct(agg["violent_rate"]).astype(int)
    agg["property_score"] = invert_score_pct(agg["property_rate"]).astype(int)
    agg["asb_score"]      = invert_score_pct(agg["asb_rate"]).astype(int)

    # â”€â”€ Local (relative) scores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    cfg = LOCAL_CONFIG[grid_label]
    radius_m     = cfg["radius_m"]
    local_weight = cfg["local_weight"]
    nat_weight   = 1.0 - local_weight

    if local_weight > 0.0:
        gx_arr = agg["gx"].values.astype(np.float64)
        gy_arr = agg["gy"].values.astype(np.float64)

        rate_cols = [
            ("weighted_rate", "crime_score",    "crime_local_score"),
            ("violent_rate",  "violent_score",  "violent_local_score"),
            ("property_rate", "property_score", "property_local_score"),
            ("asb_rate",      "asb_score",      "asb_local_score"),
        ]
        for rate_col, nat_col, local_col in rate_cols:
            local_pct = compute_local_pct(
                gx_arr, gy_arr, agg[rate_col].values.astype(np.float64), radius_m
            )
            blended = local_pct * local_weight + agg[nat_col].values * nat_weight
            agg[local_col] = np.round(blended).astype(int)
    else:
        # At 25km local == national
        agg["crime_local_score"]    = agg["crime_score"]
        agg["violent_local_score"]  = agg["violent_score"]
        agg["property_local_score"] = agg["property_score"]
        agg["asb_local_score"]      = agg["asb_score"]

    keep = [
        "gx", "gy",
        "violent_rate", "property_rate", "asb_rate", "total_rate",
        "crime_score",       "violent_score",       "property_score",       "asb_score",
        "crime_local_score", "violent_local_score", "property_local_score", "asb_local_score",
    ]
    return agg[keep].to_dict(orient="records")


# â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def main(onspd_path: Path) -> None:
    ensure_pipeline_dirs()

    # 1. Load LSOA crime data
    df_crime = load_lsoa_crime(MODEL_CRIME_OVERLAY)

    # 2. Load ONSPD (postcode â†’ lsoa21cd + BNG coords)
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
        raise RuntimeError("Join produced no rows â€“ check LSOA code column names")

    # 4. Build one file per grid size
    for grid_label, grid_m in GRID_SIZES:
        cfg = LOCAL_CONFIG[grid_label]
        radius_km = cfg["radius_m"] // 1000
        lw = int(cfg["local_weight"] * 100)
        print(
            f"Building {grid_label} cells "
            f"(local radius {radius_km}km, {lw}% local / {100-lw}% national) â€¦",
            end=" ", flush=True,
        )
        cells = build_cells_for_grid(df_joined, grid_m, grid_label)
        print(f"{len(cells):,} cells")

        out_path = MODEL_CRIME_DIR / MODEL_CRIME_CELLS_TEMPLATE.name.format(grid=grid_label)
        with gzip.open(out_path, "wt", encoding="utf-8") as f:
            json.dump(cells, f, separators=(",", ":"))
        size_kb = out_path.stat().st_size // 1024
        print(f"  â†’ {out_path.name}  ({size_kb:,} KB)")

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

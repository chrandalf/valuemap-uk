"""build_price_model.py — Ratio estimator for sparse 1mile cells.

For each 1mile cell × (property_type, new_build) combo:
  1. Map each 1mile cell to its parent 5km cell
  2. Collect historical years where BOTH have ≥ MIN_SALES sales
  3. Compute ratio_t = median_1mile_t / median_5km_t per year
  4. mean_ratio  = mean(ratio_t)
  5. ratio_cv    = std(ratio_t) / mean_ratio   (stability measure)
  6. estimated_median = mean_ratio × current_5km_median

If the 5km parent has insufficient history, climb to the 10km parent.

Confidence tiers (stored as model_confidence):
  2 = High  : n_years ≥ 4  AND ratio_cv < 0.15
  1 = Medium: n_years ≥ 2  AND ratio_cv < 0.30
  0 = Low   : fewer data or high variance — injected but treated with caution

NOTE on the 1mile parquet:
  The current grid_1mile_annual.parquet was built with years_back=1, giving at most
  2 historical snapshots per cell. This caps n_years at 2 and max confidence at Medium.
  Re-build with years_back=10 (matching the 5km/10km parquets) to unlock High confidence.

Output (per property_type × new_build combination):
  data/model/property/modelled_1mile_{PT}_{NB}.json.gz
  Schema per row:
    {gx, gy, estimated_median, model_confidence, n_years, ratio_cv}

Upload to R2:
  Run via upload_model_assets_to_r2.py (see include_model flag added there).
"""

from __future__ import annotations

import gzip
import gc
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL_PROPERTY = ROOT / "pipeline" / "data" / "model" / "property"

PROPERTY_TYPES = ["ALL", "D", "S", "T", "F"]
NEW_BUILDS = ["ALL", "Y", "N"]
MIN_SALES = 1          # include cells with just 1 sale — model estimate handles noise
MIN_CV_FLOOR = 1e-6  # avoid division by zero when all ratios are identical


def load_annual(grid_label: str) -> pd.DataFrame:
    path = MODEL_PROPERTY / f"grid_{grid_label}_annual.parquet"
    if not path.exists():
        print(f"  WARNING: {path} not found — skipping", file=sys.stderr)
        return pd.DataFrame()
    print(f"  Loading {path}  ({path.stat().st_size // 1024} KB)…")
    df = pd.read_parquet(path)
    df["end_month"] = pd.to_datetime(df["end_month"])
    return df


def confidence(n_years: int, ratio_cv: float) -> int:
    if n_years >= 4 and ratio_cv < 0.15:
        return 2
    if n_years >= 2 and ratio_cv < 0.30:
        return 1
    return 0


def dump_gz(path: Path, records: list[dict]) -> None:
    data = json.dumps(records, separators=(",", ":")).encode()
    with gzip.open(path, "wb") as f:
        f.write(data)
    kb = path.stat().st_size // 1024
    print(f"  → {path.name}  {len(records):,} rows  {kb} KB")


def build_for_combo(
    df_1mile: pd.DataFrame,
    df_5km: pd.DataFrame,
    df_10km: pd.DataFrame,
    property_type: str,
    new_build: str,
) -> list[dict]:
    """Return a list of modelled estimate rows for one (property_type, new_build) combo."""

    def filt(df: pd.DataFrame) -> pd.DataFrame:
        return df[
            (df["property_type"] == property_type) & (df["new_build"] == new_build)
        ].copy()

    pt1 = filt(df_1mile)
    pt5 = filt(df_5km)
    pt10 = filt(df_10km) if not df_10km.empty else pd.DataFrame()

    if pt1.empty or pt5.empty:
        return []

    # ── Identify column names ──────────────────────────────────────────────────
    gx1 = next(c for c in pt1.columns if c.startswith("gx_"))
    gy1 = next(c for c in pt1.columns if c.startswith("gy_"))
    gx5 = next(c for c in pt5.columns if c.startswith("gx_"))
    gy5 = next(c for c in pt5.columns if c.startswith("gy_"))

    # ── Derive parent grid coordinates from 1mile cell ───────────────────────────
    step5  = int(gx5.split("_")[1])   # e.g. 5000
    step10 = 10000

    pt1["pgx5"]  = (pt1[gx1] // step5)  * step5
    pt1["pgy5"]  = (pt1[gy1] // step5)  * step5
    pt1["pgx10"] = (pt1[gx1] // step10) * step10
    pt1["pgy10"] = (pt1[gy1] // step10) * step10

    # ── Current (latest) parent medians ───────────────────────────────────────
    latest_5 = pt5["end_month"].max()
    curr5 = (
        pt5[pt5["end_month"] == latest_5]
        .set_index([gx5, gy5])[["median_price_12m"]]
        .rename(columns={"median_price_12m": "cur5"})
    )

    curr10: pd.DataFrame | None = None
    if not pt10.empty:
        gx10 = next(c for c in pt10.columns if c.startswith("gx_"))
        gy10 = next(c for c in pt10.columns if c.startswith("gy_"))
        latest_10 = pt10["end_month"].max()
        curr10 = (
            pt10[pt10["end_month"] == latest_10]
            .set_index([gx10, gy10])[["median_price_12m"]]
            .rename(columns={"median_price_12m": "cur10"})
        )
    else:
        gx10 = gy10 = None

    # ── Historical 5km lookup (with enough sales) ─────────────────────────────
    hist5 = pt5[pt5["sales_12m"] >= MIN_SALES][[gx5, gy5, "end_month", "median_price_12m", "sales_12m"]].copy()
    hist5 = hist5.rename(columns={gx5: "pgx5", gy5: "pgy5", "median_price_12m": "med5"})

    # ── Filter 1mile rows to those with enough sales ────────────────────────────
    hist1 = pt1[pt1["sales_12m"] >= MIN_SALES].copy()

    # ── Merge 1mile rows with 5km parent (same end_month) ──────────────────────
    joined = hist1.merge(hist5, on=["end_month", "pgx5", "pgy5"], how="left")
    joined["ratio5"] = joined["median_price_12m"] / joined["med5"]
    # Sanity bounds — genuine local premiums are never 10× the surrounding median
    joined.loc[~joined["ratio5"].between(0.1, 10.0), "ratio5"] = np.nan

    # ── Historical 10km lookup (fallback) ─────────────────────────────────────
    hist10_merged: pd.DataFrame | None = None
    if not pt10.empty and gx10 and gy10:
        hist10 = pt10[pt10["sales_12m"] >= MIN_SALES][[gx10, gy10, "end_month", "median_price_12m"]].copy()
        hist10 = hist10.rename(columns={gx10: "pgx10", gy10: "pgy10", "median_price_12m": "med10"})
        hist10_merged = hist1.merge(hist10, on=["end_month", "pgx10", "pgy10"], how="left")
        hist10_merged["ratio10"] = hist10_merged["median_price_12m"] / hist10_merged["med10"]
        hist10_merged.loc[~hist10_merged["ratio10"].between(0.1, 10.0), "ratio10"] = np.nan

    # ── Pre-group hist10_merged by cell for O(1) lookups in the loop ─────────
    hist10_by_cell: dict | None = None
    if hist10_merged is not None:
        hist10_by_cell = {
            key: grp for key, grp in hist10_merged.groupby([gx1, gy1])
        }

    # ── Build estimate per 1mile cell ───────────────────────────────────────────
    results: list[dict] = []

    for (gx_val, gy_val), grp in joined.groupby([gx1, gy1]):
        gx_int = int(gx_val)
        gy_int = int(gy_val)
        pgx5_v = int(grp["pgx5"].iloc[0])
        pgy5_v = int(grp["pgy5"].iloc[0])
        pgx10_v = int(grp["pgx10"].iloc[0])
        pgy10_v = int(grp["pgy10"].iloc[0])

        # ── Try 5km ratio ──────────────────────────────────────────────────────
        valid5 = grp.dropna(subset=["ratio5"])
        if len(valid5) >= 2:
            ratios = valid5["ratio5"].values
            mean_r = float(np.mean(ratios))
            cv = float(np.std(ratios) / max(mean_r, MIN_CV_FLOOR))
            n_yrs = len(valid5)
            try:
                cur5_med = float(curr5.at[(pgx5_v, pgy5_v), "cur5"])
            except KeyError:
                cur5_med = np.nan
            if np.isfinite(cur5_med) and cur5_med > 0:
                results.append({
                    "gx": gx_int,
                    "gy": gy_int,
                    "estimated_median": int(round(mean_r * cur5_med)),
                    "model_confidence": confidence(n_yrs, cv),
                    "n_years": n_yrs,
                    "ratio_cv": round(cv, 3),
                })
                continue

        # ── Fallback to 10km ratio (O(1) dict lookup) ────────────────────────
        if hist10_by_cell is not None:
            grp10 = hist10_by_cell.get((gx_val, gy_val))
            if grp10 is not None:
                valid10 = grp10.dropna(subset=["ratio10"])
                if len(valid10) >= 2:
                    ratios = valid10["ratio10"].values
                    mean_r = float(np.mean(ratios))
                    cv = float(np.std(ratios) / max(mean_r, MIN_CV_FLOOR))
                    n_yrs = len(valid10)
                    if curr10 is not None:
                        try:
                            cur10_med = float(curr10.at[(pgx10_v, pgy10_v), "cur10"])
                        except KeyError:
                            cur10_med = np.nan
                        if np.isfinite(cur10_med) and cur10_med > 0:
                            results.append({
                                "gx": gx_int,
                                "gy": gy_int,
                                "estimated_median": int(round(mean_r * cur10_med)),
                                "model_confidence": confidence(n_yrs, cv),
                                "n_years": n_yrs,
                                "ratio_cv": round(cv, 3),
                            })

    # ── Fallback: cover all 1mile cells that appeared in pt1 but got no ratio estimate ─
    # Vectorised anti-join against already-estimated cells, then merge to parent medians.
    estimated_df = pd.DataFrame(results, columns=["gx", "gy"]) if results else pd.DataFrame(columns=["gx", "gy"])
    all_cells = pt1[[gx1, gy1]].drop_duplicates().copy()
    all_cells = all_cells.rename(columns={gx1: "gx", gy1: "gy"})
    all_cells["gx"] = all_cells["gx"].astype(int)
    all_cells["gy"] = all_cells["gy"].astype(int)
    if not estimated_df.empty:
        all_cells = all_cells.merge(estimated_df[["gx", "gy"]].drop_duplicates().assign(_est=True),
                                    on=["gx", "gy"], how="left")
        all_cells = all_cells[all_cells["_est"].isna()].drop(columns=["_est"])

    if not all_cells.empty:
        all_cells["pgx5"] = (all_cells["gx"] // step5) * step5
        all_cells["pgy5"] = (all_cells["gy"] // step5) * step5
        # Join to current 5km medians
        curr5_df = curr5.reset_index().rename(columns={gx5: "pgx5", gy5: "pgy5"})
        fb = all_cells.merge(curr5_df, on=["pgx5", "pgy5"], how="left")
        has5 = fb["cur5"].notna() & (fb["cur5"] > 0)
        fb5 = fb[has5][["gx", "gy", "cur5"]].copy()
        for rec in fb5.itertuples(index=False):
            results.append({"gx": int(rec.gx), "gy": int(rec.gy),
                            "estimated_median": int(round(float(rec.cur5))),
                            "model_confidence": 0, "n_years": 0, "ratio_cv": 0.0})
        # 10km fallback for cells whose 5km parent had no current median
        if curr10 is not None:
            gx10_col = next(c for c in curr10.index.names if c.startswith("gx_"))
            gy10_col = next(c for c in curr10.index.names if c.startswith("gy_"))
            curr10_df = curr10.reset_index().rename(columns={gx10_col: "pgx10", gy10_col: "pgy10"})
            fb_miss = fb[~has5].copy()
            fb_miss["pgx10"] = (fb_miss["gx"] // step10) * step10
            fb_miss["pgy10"] = (fb_miss["gy"] // step10) * step10
            fb10 = fb_miss.merge(curr10_df, on=["pgx10", "pgy10"], how="left")
            has10 = fb10["cur10"].notna() & (fb10["cur10"] > 0)
            fb10r = fb10[has10][["gx", "gy", "cur10"]].copy()
            for rec in fb10r.itertuples(index=False):
                results.append({"gx": int(rec.gx), "gy": int(rec.gy),
                                "estimated_median": int(round(float(rec.cur10))),
                                "model_confidence": 0, "n_years": 0, "ratio_cv": 0.0})

    return results


def run_combo(pt: str, nb: str) -> int:
    """Run a single (property_type, new_build) combo in-process with full cleanup."""
    df_1mile = load_annual("1mile")
    df_5km  = load_annual("5km")
    df_10km = load_annual("10km")
    rows = build_for_combo(df_1mile, df_5km, df_10km, pt, nb)
    n = len(rows)
    out_path = MODEL_PROPERTY / f"modelled_1mile_{pt}_{nb}.json.gz"
    dump_gz(out_path, rows)
    return n


def main() -> None:
    # Detect if running as a combo sub-invocation: python build_price_model.py --combo PT NB
    if len(sys.argv) == 4 and sys.argv[1] == "--combo":
        pt, nb = sys.argv[2], sys.argv[3]
        run_combo(pt, nb)
        return

    print("Building estimates (each combo in a fresh subprocess for memory isolation)…")
    total_rows = 0
    script = Path(__file__).resolve()
    python = sys.executable
    failed = []

    for pt in PROPERTY_TYPES:
        for nb in NEW_BUILDS:
            print(f"  {pt}/{nb}", end="  ", flush=True)
            import subprocess
            result = subprocess.run(
                [python, str(script), "--combo", pt, nb],
                capture_output=False,
                text=True,
            )
            if result.returncode != 0:
                print(f"FAILED (exit {result.returncode})")
                failed.append(f"{pt}/{nb}")
            else:
                out_path = MODEL_PROPERTY / f"modelled_1mile_{pt}_{nb}.json.gz"
                if out_path.exists():
                    total_rows += int(
                        __import__("json").loads(
                            __import__("gzip").decompress(out_path.read_bytes())
                        ).__len__()
                    )

    if failed:
        print(f"\nFailed combos: {failed}", file=sys.stderr)
        sys.exit(1)
    print(f"\nDone. Total estimated cells across all combos: {total_rows:,}")
    print(f"Output directory: {MODEL_PROPERTY}")


if __name__ == "__main__":
    main()

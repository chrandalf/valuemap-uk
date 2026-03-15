#!/usr/bin/env python3
"""
build_1mile_annual.py — produce grid_1mile_annual.parquet locally.

Loads the raw price-paid data (pp-2025.txt) and ONSPD, snaps transactions
to 1600m grid cells, then builds the annual median stacks needed by
build_price_model.py.

Output: data/model/property/grid_1mile_annual.parquet
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

# Reuse loaders from build_property_artifacts
from build_property_artifacts import (
    load_onspd,
    load_pp,
)
from paths import MODEL_PROPERTY_DIR, RAW_PROPERTY_DIR


# ── Inlined from build_grids.py (can't import — Kaggle top-level code) ──────

def _yearly_end_months(d_month_col: pd.Series, years_back: int):
    latest = d_month_col.max()
    end_months = [latest]
    cursor = latest - pd.DateOffset(years=1)
    min_month = d_month_col.min()
    while cursor >= min_month and len(end_months) < (years_back + 1):
        end_months.append(cursor)
        cursor -= pd.DateOffset(years=1)
    return end_months


def make_grid_annual_stack_levels(df, g, min_sales=3, years_back=10):
    gx, gy = f"gx_{g}", f"gy_{g}"
    d = df.dropna(subset=[gx, gy]).copy()
    d["month"] = pd.to_datetime(d["month"]).dt.to_period("M").dt.to_timestamp()
    end_months = _yearly_end_months(d["month"], years_back=years_back)
    parts = []
    for end_month in end_months:
        start_month = (end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
        w = d[(d["month"] >= start_month) & (d["month"] <= end_month)]
        a = (w.groupby([gx, gy, "property_type", "new_build"], as_index=False)
               .agg(median_price_12m=("price", "median"), sales_12m=("price", "size")))
        a["end_month"] = end_month
        parts.append(a)
        b = (w.groupby([gx, gy, "property_type"], as_index=False)
               .agg(median_price_12m=("price", "median"), sales_12m=("price", "size")))
        b["end_month"] = end_month; b["new_build"] = "ALL"
        parts.append(b)
        c = (w.groupby([gx, gy, "new_build"], as_index=False)
               .agg(median_price_12m=("price", "median"), sales_12m=("price", "size")))
        c["end_month"] = end_month; c["property_type"] = "ALL"
        parts.append(c)
        d_all = (w.groupby([gx, gy], as_index=False)
                   .agg(median_price_12m=("price", "median"), sales_12m=("price", "size")))
        d_all["end_month"] = end_month; d_all["property_type"] = "ALL"; d_all["new_build"] = "ALL"
        parts.append(d_all)
        print(f"  done: {end_month.date()} | window rows: {len(w):,}")
    out = pd.concat(parts, ignore_index=True)
    out["end_month"] = pd.to_datetime(out["end_month"]).dt.to_period("M").dt.to_timestamp()
    out["property_type"] = out["property_type"].astype(str)
    out["new_build"] = out["new_build"].astype(str)
    if min_sales > 1:
        out = out[out["sales_12m"] >= min_sales].copy()
    return out

GRID = 1600
YEARS_BACK_LOAD = 10  # load enough history for annual stacking
YEARS_BACK_ANNUAL = 1  # annual snapshots (matches Kaggle config for 1mile)
MIN_SALES = 1          # include cells with just 1 sale — model estimate handles noise


def main() -> None:
    pp_path = RAW_PROPERTY_DIR / "pp-2025.txt"
    onspd_path = RAW_PROPERTY_DIR / "ONSPD_Online_latest_Postcode_Centroids_.csv"
    out_path = MODEL_PROPERTY_DIR / "grid_1mile_annual.parquet"

    print(f"Loading ONSPD: {onspd_path}")
    onspd = load_onspd(onspd_path)
    print(f"  {len(onspd):,} postcodes")

    print(f"Loading PP data (last {YEARS_BACK_LOAD} years): {pp_path}")
    pp = load_pp(pp_path, years_back=YEARS_BACK_LOAD)
    print(f"  {len(pp):,} transactions")

    print("Joining PP to ONSPD …")
    df = pp.merge(onspd, on="postcode_key", how="inner")
    print(f"  {len(df):,} matched rows")

    # Snap to grid
    gx_col = f"gx_{GRID}"
    gy_col = f"gy_{GRID}"
    df[gx_col] = ((df["east"] // GRID) * GRID).astype("int64")
    df[gy_col] = ((df["north"] // GRID) * GRID).astype("int64")

    print(f"Building annual stack (years_back={YEARS_BACK_ANNUAL}) …")
    annual = make_grid_annual_stack_levels(
        df, g=GRID, min_sales=MIN_SALES, years_back=YEARS_BACK_ANNUAL
    )

    MODEL_PROPERTY_DIR.mkdir(parents=True, exist_ok=True)
    annual.to_parquet(out_path, index=False)
    print(f"Wrote {out_path}  ({out_path.stat().st_size // 1024} KB, {len(annual):,} rows)")


if __name__ == "__main__":
    main()

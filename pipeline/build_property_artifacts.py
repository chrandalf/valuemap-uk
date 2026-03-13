#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path
from typing import Iterable

import pandas as pd

from paths import MODEL_PROPERTY_DIR, RAW_EPC_DIR, RAW_PROPERTY_DIR, ensure_pipeline_dirs

GRID_SIZES = [1000, 5000, 10000, 25000]
DELTA_GRID_SIZES = [5000, 10000, 25000]
MEDIAN_YEARS_BACK_BY_GRID = {1000: 0, 5000: 5, 10000: 5, 25000: 5}
PPSF_YEARS_BACK_BY_GRID = {1000: 0, 5000: 5, 10000: 5, 25000: 5}
# 1km cells with fewer than this many transactions borrow their percentile shape
# from the parent 5km cell (scaled to the 1km cell's own median).
PERCENTILE_DIRECT_TX_THRESHOLD = 10
# Hard-coded last-resort ratios used when no parent 5km data is available.
DEFAULT_RATIOS: dict[str, float] = {"r25": 0.78, "r70": 1.24, "r90": 1.65}
SCOTLAND_DAILY_THRESHOLD = 50
SQFT_PER_M2 = 10.76391041671

PP_COLS = [
    "transaction_id",
    "price",
    "date",
    "postcode",
    "property_type",
    "new_build",
    "tenure",
    "paon",
    "saon",
    "street",
    "locality",
    "town_city",
    "district",
    "county",
    "ppd_category",
    "record_status",
]


def normalize_postcode_key(value: str) -> str:
    if value is None or pd.isna(value):
        return ""
    return re.sub(r"\s+", "", str(value).upper()).strip()


def derive_outcode(postcode: str) -> str:
    text = normalize_postcode_key(postcode)
    if not text:
        return ""
    match = re.match(r"^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$", text)
    if match:
        return match.group(1)
    return text[:-3] if len(text) > 3 else text


def normalize_paon(value: str) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value).upper().strip()
    text = re.sub(r"\s+", "", text)
    text = text.lstrip("0")
    return text


def parse_scot_date(series: pd.Series) -> pd.Series:
    text = series.astype("string").str.strip()
    dt = pd.to_datetime(text, format="%d-%m-%Y", errors="coerce")
    missing = dt.isna()
    if missing.any():
        dt.loc[missing] = pd.to_datetime(text.loc[missing], dayfirst=True, errors="coerce")
    return dt


def extract_paon_from_epc_address(addr: str) -> str:
    if addr is None or pd.isna(addr):
        return ""

    text = str(addr).strip().upper()

    match = re.search(r"^(FLAT|APT|APARTMENT|UNIT|ROOM)\b.*?,\s*([0-9]+[A-Z]?(?:-[0-9]+[A-Z]?)?)\b", text)
    if match:
        return match.group(2)

    match = re.match(r"^\s*([0-9]+[A-Z]?(?:-[0-9]+[A-Z]?)?)\b", text)
    if match:
        return match.group(1)

    return ""


def dump_json_gz(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def write_partitions(rows: list[dict], output_dir: Path, grid_label: str, metric: str) -> int:
    """Write rows partitioned by end_month / property_type / new_build.

    R2 key layout:  cells/{grid_label}/{metric}/{end_month}/{property_type}_{new_build}.json.gz
    Local mirror:   {output_dir}/cells/{grid_label}/{metric}/{end_month}/{property_type}_{new_build}.json.gz

    Returns the number of partition files written.
    """
    from collections import defaultdict

    buckets: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for r in rows:
        key = (r["end_month"], r["property_type"], r["new_build"])
        buckets[key].append(r)

    written = 0
    for (end_month, ptype, nb), partition_rows in buckets.items():
        part_dir = output_dir / "cells" / grid_label / metric / end_month
        part_path = part_dir / f"{ptype}_{nb}.json.gz"
        dump_json_gz(part_path, partition_rows)
        written += 1

    # Write a manifest listing all available partitions for this grid/metric
    manifest = {
        "grid": grid_label,
        "metric": metric,
        "partitions": [
            {
                "end_month": em,
                "property_type": pt,
                "new_build": nb,
                "row_count": len(pr),
            }
            for (em, pt, nb), pr in sorted(buckets.items())
        ],
    }
    manifest_path = output_dir / "cells" / grid_label / metric / "_manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))

    return written


def load_onspd(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"ONSPD input not found: {path}")

    header = pd.read_csv(path, nrows=0)
    cols = {c.lower().strip(): c for c in header.columns}

    postcode_col = cols.get("pcd7") or cols.get("pcds")
    east_col = cols.get("east1m") or cols.get("x")
    north_col = cols.get("north1m") or cols.get("y")

    if not postcode_col or not east_col or not north_col:
        raise RuntimeError("Unable to detect postcode/east/north columns in ONSPD")

    frames: list[pd.DataFrame] = []
    for chunk in pd.read_csv(
        path,
        usecols=[postcode_col, east_col, north_col],
        dtype={postcode_col: "string", east_col: "string", north_col: "string"},
        chunksize=500_000,
    ):
        chunk = chunk.rename(columns={postcode_col: "postcode", east_col: "east", north_col: "north"})
        chunk["postcode_key"] = chunk["postcode"].astype("string").map(normalize_postcode_key)
        chunk["east"] = pd.to_numeric(chunk["east"], errors="coerce")
        chunk["north"] = pd.to_numeric(chunk["north"], errors="coerce")
        chunk = chunk.dropna(subset=["postcode_key", "east", "north"])
        chunk = chunk[["postcode_key", "east", "north"]].drop_duplicates("postcode_key")
        frames.append(chunk)

    if not frames:
        raise RuntimeError("No valid rows found in ONSPD")

    out = pd.concat(frames, ignore_index=True)
    out = out.drop_duplicates("postcode_key")
    return out


def load_pp(path: Path, years_back: int) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"PP input not found: {path}")

    today = pd.Timestamp.today().normalize().date()
    cutoff = (pd.Timestamp.today().normalize() - pd.DateOffset(years=years_back)).date()
    frames: list[pd.DataFrame] = []

    for chunk in pd.read_csv(
        path,
        header=None,
        names=PP_COLS,
        usecols=["price", "date", "postcode", "paon", "property_type", "new_build", "record_status"],
        dtype={
            "price": "string",
            "date": "string",
            "postcode": "string",
            "paon": "string",
            "property_type": "string",
            "new_build": "string",
            "record_status": "string",
        },
        chunksize=500_000,
    ):
        chunk["date"] = pd.to_datetime(chunk["date"], errors="coerce")
        chunk = chunk[chunk["date"].notna()]
        chunk = chunk[chunk["record_status"].astype("string") == "A"]
        chunk = chunk[chunk["date"].dt.date >= cutoff]
        chunk = chunk[chunk["date"].dt.date <= today]

        if chunk.empty:
            continue

        chunk["price"] = pd.to_numeric(chunk["price"], errors="coerce")
        chunk = chunk[chunk["price"].notna() & (chunk["price"] > 0)]
        chunk["postcode_key"] = chunk["postcode"].astype("string").map(normalize_postcode_key)
        chunk = chunk[chunk["postcode_key"].astype("string").str.len() > 0]
        chunk["paon_key"] = chunk["paon"].astype("string").map(normalize_paon)
        chunk["month"] = chunk["date"].dt.to_period("M").dt.to_timestamp()
        chunk["property_type"] = chunk["property_type"].astype("string").fillna("ALL")
        chunk["new_build"] = chunk["new_build"].astype("string").fillna("ALL")

        frames.append(chunk[["price", "date", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"]])

    if not frames:
        raise RuntimeError("No valid rows found in PP file after filtering")

    return pd.concat(frames, ignore_index=True)


def load_scotland_properties(
    path: Path,
    years_back: int,
    anchor_month: pd.Timestamp | None = None,
    daily_threshold: int = SCOTLAND_DAILY_THRESHOLD,
) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"])

    today = pd.Timestamp.today().normalize()
    frames: list[pd.DataFrame] = []

    for chunk in pd.read_csv(
        path,
        usecols=["Postcode", "Date", "Price"],
        dtype={"Postcode": "string", "Date": "string", "Price": "string"},
        chunksize=500_000,
    ):
        chunk = chunk.rename(columns={"Postcode": "postcode", "Date": "date", "Price": "price"})
        chunk["date"] = parse_scot_date(chunk["date"])
        chunk = chunk[chunk["date"].notna()]
        chunk = chunk[chunk["date"] <= today]

        if chunk.empty:
            continue

        chunk["price"] = (
            chunk["price"]
            .astype("string")
            .str.replace(r"[^\d\.-]", "", regex=True)
            .replace("", pd.NA)
        )
        chunk["price"] = pd.to_numeric(chunk["price"], errors="coerce")
        chunk = chunk[chunk["price"].notna() & (chunk["price"] > 0)]

        if chunk.empty:
            continue

        chunk["postcode_key"] = chunk["postcode"].astype("string").map(normalize_postcode_key)
        chunk = chunk[chunk["postcode_key"].astype("string").str.len() > 0]
        chunk["month"] = chunk["date"].dt.to_period("M").dt.to_timestamp()

        chunk["property_type"] = "D"
        chunk["new_build"] = "N"
        chunk["paon_key"] = ""

        frames.append(chunk[["price", "date", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"]])

    if not frames:
        return pd.DataFrame(columns=["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"])

    scotland = pd.concat(frames, ignore_index=True)

    daily_counts = scotland.groupby(scotland["date"].dt.normalize()).size().sort_index()
    if daily_counts.empty:
        return pd.DataFrame(columns=["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"])

    busy_days = daily_counts[daily_counts >= max(1, int(daily_threshold))]
    if not busy_days.empty:
        end_date = busy_days.index.max()
    else:
        end_date = daily_counts.idxmax()

    start_date = end_date - pd.DateOffset(years=1)
    scotland = scotland[(scotland["date"] >= start_date) & (scotland["date"] <= end_date)].copy()
    if scotland.empty:
        return pd.DataFrame(columns=["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"])

    if anchor_month is not None and pd.notna(anchor_month):
        latest_month_start = pd.to_datetime(anchor_month).to_period("M").to_timestamp()
        latest_month_end = (latest_month_start + pd.offsets.MonthEnd(0)).normalize()
        days_in_latest_month = int(latest_month_end.day)
        orig_day = scotland["date"].dt.day.clip(upper=days_in_latest_month)
        scotland["date"] = pd.to_datetime(
            {
                "year": latest_month_start.year,
                "month": latest_month_start.month,
                "day": orig_day,
            }
        )

    scotland["month"] = scotland["date"].dt.to_period("M").dt.to_timestamp()
    return scotland[["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"]]


def load_epc_latest(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"EPC input not found: {path}")

    header = pd.read_csv(path, nrows=0)
    cols = {c.lower().strip(): c for c in header.columns}

    postcode_col = cols.get("postcode")
    address_col = cols.get("address1") or cols.get("address")
    floor_area_col = cols.get("total_floor_area")
    rooms_col = cols.get("number_habitable_rooms")
    inspection_col = cols.get("inspection_date")

    if not postcode_col or not address_col or not floor_area_col:
        raise RuntimeError("Unable to detect required EPC columns (postcode/address/total_floor_area)")

    usecols = [postcode_col, address_col, floor_area_col]
    if rooms_col:
        usecols.append(rooms_col)
    if inspection_col:
        usecols.append(inspection_col)

    frames: list[pd.DataFrame] = []
    for chunk in pd.read_csv(path, usecols=usecols, dtype="string", low_memory=False, chunksize=500_000):
        chunk = chunk.rename(
            columns={
                postcode_col: "postcode",
                address_col: "address",
                floor_area_col: "TOTAL_FLOOR_AREA",
                rooms_col: "NUMBER_HABITABLE_ROOMS" if rooms_col else "NUMBER_HABITABLE_ROOMS",
                inspection_col: "INSPECTION_DATE" if inspection_col else "INSPECTION_DATE",
            }
        )
        chunk["postcode_key"] = chunk["postcode"].map(normalize_postcode_key)
        chunk["paon_raw"] = chunk["address"].map(extract_paon_from_epc_address)
        chunk["paon_key"] = chunk["paon_raw"].map(normalize_paon)
        chunk["TOTAL_FLOOR_AREA"] = pd.to_numeric(chunk["TOTAL_FLOOR_AREA"], errors="coerce")
        if "NUMBER_HABITABLE_ROOMS" in chunk.columns:
            chunk["NUMBER_HABITABLE_ROOMS"] = pd.to_numeric(chunk["NUMBER_HABITABLE_ROOMS"], errors="coerce")
        else:
            chunk["NUMBER_HABITABLE_ROOMS"] = pd.NA
        if "INSPECTION_DATE" in chunk.columns:
            chunk["INSPECTION_DATE"] = pd.to_datetime(chunk["INSPECTION_DATE"], errors="coerce")
        else:
            chunk["INSPECTION_DATE"] = pd.NaT
        chunk = chunk[(chunk["postcode_key"].astype("string").str.len() > 0) & (chunk["paon_key"].astype("string").str.len() > 0)]
        frames.append(chunk[["postcode_key", "paon_key", "TOTAL_FLOOR_AREA", "NUMBER_HABITABLE_ROOMS", "INSPECTION_DATE"]])

    if not frames:
        return pd.DataFrame(columns=["postcode_key", "paon_key", "TOTAL_FLOOR_AREA", "NUMBER_HABITABLE_ROOMS", "INSPECTION_DATE"])

    epc = pd.concat(frames, ignore_index=True)
    epc = epc.sort_values("INSPECTION_DATE").drop_duplicates(subset=["postcode_key", "paon_key"], keep="last")
    return epc


def with_grid_cells(df: pd.DataFrame, onspd: pd.DataFrame) -> pd.DataFrame:
    merged = df.merge(onspd, on="postcode_key", how="inner")
    if merged.empty:
        raise RuntimeError("No PP rows matched to ONSPD postcodes")

    for g in GRID_SIZES:
        merged[f"gx_{g}"] = ((merged["east"] // g) * g).astype("int64")
        merged[f"gy_{g}"] = ((merged["north"] // g) * g).astype("int64")
        merged[f"cell_{g}"] = merged[f"gx_{g}"].astype("string") + "_" + merged[f"gy_{g}"].astype("string")

    return merged


def aggregate_segments(window: pd.DataFrame, g: int) -> pd.DataFrame:
    gx = f"gx_{g}"
    gy = f"gy_{g}"

    def _seg(grp_cols: list, extra: dict) -> pd.DataFrame:
        base = (
            window.groupby(grp_cols, as_index=False)
            .agg(median=("price", "median"), tx_count=("price", "size"))
        )
        perc = (
            window.groupby(grp_cols)["price"]
            .quantile([0.25, 0.7, 0.9])
            .unstack()
            .rename(columns={0.25: "p25", 0.7: "p70", 0.9: "p90"})
            .reset_index()[grp_cols + ["p25", "p70", "p90"]]
        )
        df = base.merge(perc, on=grp_cols, how="left")
        for col, val in extra.items():
            df[col] = val
        return df

    a = _seg([gx, gy, "property_type", "new_build"], {})
    b = _seg([gx, gy, "property_type"], {"new_build": "ALL"})
    c = _seg([gx, gy, "new_build"], {"property_type": "ALL"})
    d = _seg([gx, gy], {"property_type": "ALL", "new_build": "ALL"})

    out = pd.concat([a, b, c, d], ignore_index=True)
    return out[[gx, gy, "property_type", "new_build", "median", "tx_count", "p25", "p70", "p90"]]


def aggregate_segments_metric(window: pd.DataFrame, g: int, metric_col: str, out_metric_col: str) -> pd.DataFrame:
    gx = f"gx_{g}"
    gy = f"gy_{g}"

    a = (
        window.groupby([gx, gy, "property_type", "new_build"], as_index=False)
        .agg(**{out_metric_col: (metric_col, "median")}, tx_count=(metric_col, "size"))
    )

    b = (
        window.groupby([gx, gy, "property_type"], as_index=False)
        .agg(**{out_metric_col: (metric_col, "median")}, tx_count=(metric_col, "size"))
    )
    b["new_build"] = "ALL"

    c = (
        window.groupby([gx, gy, "new_build"], as_index=False)
        .agg(**{out_metric_col: (metric_col, "median")}, tx_count=(metric_col, "size"))
    )
    c["property_type"] = "ALL"

    d = (
        window.groupby([gx, gy], as_index=False)
        .agg(**{out_metric_col: (metric_col, "median")}, tx_count=(metric_col, "size"))
    )
    d["property_type"] = "ALL"
    d["new_build"] = "ALL"

    out = pd.concat([a, b, c, d], ignore_index=True)
    return out[[gx, gy, "property_type", "new_build", out_metric_col, "tx_count"]]


def compute_national_ratios(agg_5km: pd.DataFrame) -> dict[tuple[str, str], dict[str, float]]:
    """Compute national median-normalised percentile ratios grouped by (property_type, new_build).
    Used as a fallback when a 1km cell has no parent 5km data to borrow from.
    """
    if agg_5km.empty or "p25" not in agg_5km.columns:
        return {}
    valid = agg_5km[
        (agg_5km["tx_count"] >= PERCENTILE_DIRECT_TX_THRESHOLD) & (agg_5km["median"] > 0)
    ].copy()
    if valid.empty:
        return {}
    ratios: dict[tuple[str, str], dict[str, float]] = {}
    for (pt, nb), grp in valid.groupby(["property_type", "new_build"]):
        ratios[(str(pt), str(nb))] = {
            "r25": float((grp["p25"] / grp["median"]).median()),
            "r70": float((grp["p70"] / grp["median"]).median()),
            "r90": float((grp["p90"] / grp["median"]).median()),
        }
    return ratios


def apply_1km_percentile_borrowing(
    agg_1km: pd.DataFrame,
    agg_5km: pd.DataFrame,
    national_ratios: dict[tuple[str, str], dict[str, float]],
) -> pd.DataFrame:
    """For 1km cells with < PERCENTILE_DIRECT_TX_THRESHOLD sales, replace their
    directly-computed percentiles with values borrowed from the parent 5km cell
    (scaled by the 1km cell's median).  Falls back to national ratios when no
    parent 5km cell is available.
    """
    agg = agg_1km.copy()

    # Parent 5km grid coordinates for each 1km cell
    agg["_pgx"] = ((agg["gx_1000"] // 5000) * 5000).astype("int64")
    agg["_pgy"] = ((agg["gy_1000"] // 5000) * 5000).astype("int64")

    # Build ratio lookup from well-sampled 5km cells
    if not agg_5km.empty and "p25" in agg_5km.columns:
        valid_5km = agg_5km[
            (agg_5km["tx_count"] >= PERCENTILE_DIRECT_TX_THRESHOLD) & (agg_5km["median"] > 0)
        ].copy()
        if not valid_5km.empty:
            valid_5km["_r25"] = valid_5km["p25"] / valid_5km["median"]
            valid_5km["_r70"] = valid_5km["p70"] / valid_5km["median"]
            valid_5km["_r90"] = valid_5km["p90"] / valid_5km["median"]
            parent_df = valid_5km.rename(columns={"gx_5000": "_pgx", "gy_5000": "_pgy"})[
                ["_pgx", "_pgy", "property_type", "new_build", "_r25", "_r70", "_r90"]
            ]
        else:
            parent_df = pd.DataFrame(columns=["_pgx", "_pgy", "property_type", "new_build", "_r25", "_r70", "_r90"])
    else:
        parent_df = pd.DataFrame(columns=["_pgx", "_pgy", "property_type", "new_build", "_r25", "_r70", "_r90"])

    agg = agg.merge(parent_df, on=["_pgx", "_pgy", "property_type", "new_build"], how="left")

    # Track which rows matched a parent 5km cell before filling national fallbacks
    agg["_has_parent"] = agg["_r25"].notna()

    # Fill missing ratios from national_ratios (per type → ALL/ALL → hard-coded)
    missing_mask = agg["_r25"].isna()
    if missing_mask.any():
        def _nat(pt: str, nb: str) -> dict[str, float]:
            return (
                national_ratios.get((pt, nb))
                or national_ratios.get((pt, "ALL"))
                or national_ratios.get(("ALL", "ALL"))
                or DEFAULT_RATIOS
            )
        for idx in agg[missing_mask].index:
            r = _nat(str(agg.at[idx, "property_type"]), str(agg.at[idx, "new_build"]))
            agg.at[idx, "_r25"] = r["r25"]
            agg.at[idx, "_r70"] = r["r70"]
            agg.at[idx, "_r90"] = r["r90"]

    # Override percentiles for sparse cells
    needs_borrow = agg["tx_count"] < PERCENTILE_DIRECT_TX_THRESHOLD
    agg.loc[needs_borrow, "p25"] = (agg.loc[needs_borrow, "median"] * agg.loc[needs_borrow, "_r25"]).round()
    agg.loc[needs_borrow, "p70"] = (agg.loc[needs_borrow, "median"] * agg.loc[needs_borrow, "_r70"]).round()
    agg.loc[needs_borrow, "p90"] = (agg.loc[needs_borrow, "median"] * agg.loc[needs_borrow, "_r90"]).round()

    # Round direct percentiles too
    for col in ["p25", "p70", "p90"]:
        agg[col] = agg[col].round()

    # p_source flag
    agg["p_source"] = "direct"
    agg.loc[needs_borrow & agg["_has_parent"], "p_source"] = "parent"
    agg.loc[needs_borrow & ~agg["_has_parent"], "p_source"] = "national"

    agg = agg.drop(columns=["_pgx", "_pgy", "_r25", "_r70", "_r90", "_has_parent"], errors="ignore")
    return agg


def yearly_end_months(month_col: pd.Series, years_back: int) -> list[pd.Timestamp]:
    latest = month_col.max()
    end_months = [latest]
    cursor = latest - pd.DateOffset(years=1)
    min_month = month_col.min()
    while cursor >= min_month and len(end_months) < (years_back + 1):
        end_months.append(cursor)
        cursor -= pd.DateOffset(years=1)
    return end_months


def build_grid_outputs(df: pd.DataFrame, output_dir: Path, latest_end_month: pd.Timestamp) -> None:
    # Pre-compute 5km aggregate for the latest 12-month window.  Used to borrow
    # percentile shapes into 1km cells with < PERCENTILE_DIRECT_TX_THRESHOLD sales.
    latest_start = (latest_end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
    latest_window = df[(df["month"] >= latest_start) & (df["month"] <= latest_end_month)].copy()
    parent_5km_agg = aggregate_segments(latest_window, 5000) if not latest_window.empty else pd.DataFrame()
    national_ratios = compute_national_ratios(parent_5km_agg)

    for g in GRID_SIZES:
        years_back = MEDIAN_YEARS_BACK_BY_GRID.get(g, 0)
        end_months = yearly_end_months(df["month"], years_back=years_back)
        gx = f"gx_{g}"
        gy = f"gy_{g}"

        rows: list[dict] = []
        for end_month in end_months:
            start_month = (end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
            window = df[(df["month"] >= start_month) & (df["month"] <= end_month)].copy()
            if window.empty:
                continue

            agg = aggregate_segments(window, g)
            if g == 1000:
                agg = apply_1km_percentile_borrowing(agg, parent_5km_agg, national_ratios)
            end_month_str = pd.to_datetime(end_month).strftime("%Y-%m-%d")
            for r in agg.itertuples(index=False):
                row: dict = {
                    "gx": int(getattr(r, gx)),
                    "gy": int(getattr(r, gy)),
                    "end_month": end_month_str,
                    "property_type": str(r.property_type),
                    "new_build": str(r.new_build),
                    "median": float(r.median),
                    "tx_count": int(r.tx_count),
                }
                raw_p25 = getattr(r, "p25", None)
                if raw_p25 is not None and pd.notna(raw_p25):
                    row["p25"] = int(round(float(raw_p25)))
                    row["p70"] = int(round(float(getattr(r, "p70"))))
                    row["p90"] = int(round(float(getattr(r, "p90"))))
                if g == 1000:
                    row["p_source"] = str(getattr(r, "p_source", "direct"))
                rows.append(row)

        dump_json_gz(output_dir / f"grid_{g//1000}km_full.json.gz", rows)

        if g == 1000:
            # Build a compact percentile lookup for right-click lookups.
            # Format: { "gx_gy": [p25, p70, p90, src_int] }  src: 0=direct 1=parent 2=national
            # Only ALL/ALL rows from the latest end_month are included.
            latest_em = max((r["end_month"] for r in rows), default=None)
            src_map = {"direct": 0, "parent": 1, "national": 2}
            pct_lookup: dict = {}
            for r in rows:
                if r["end_month"] == latest_em and r["property_type"] == "ALL" and r["new_build"] == "ALL":
                    if "p70" in r:
                        pct_lookup[f"{r['gx']}_{r['gy']}"] = [
                            r.get("p25", 0), r.get("p70", 0), r.get("p90", 0),
                            src_map.get(r.get("p_source", "direct"), 0),
                        ]
            dump_json_gz(output_dir / "cells_1km_percentiles.json.gz", pct_lookup)
            print(f"  Percentile lookup written: {len(pct_lookup)} cells")
            # Strip percentile fields from partition rows to keep them lightweight
            _pct_keys = {"p25", "p70", "p90", "p_source"}
            partition_rows = [{k: v for k, v in r.items() if k not in _pct_keys} for r in rows]
        else:
            partition_rows = rows

        # Also write partitioned files
        grid_label = f"{g // 1000}km"
        n = write_partitions(partition_rows, output_dir, grid_label, metric="median")
        print(f"  Partitions written: {grid_label}/median -> {n} files")


def build_ppsf_outputs(df: pd.DataFrame, epc_latest: pd.DataFrame, output_dir: Path) -> None:
    if df.empty:
        for g in GRID_SIZES:
            dump_json_gz(output_dir / f"grid_{g//1000}km_ppsf_full.json.gz", [])
        return

    joined = df.merge(epc_latest, on=["postcode_key", "paon_key"], how="left")

    group_keys = ["postcode_key", "property_type", "new_build"]
    postcode_avgs = (
        joined.loc[joined["TOTAL_FLOOR_AREA"].notna()]
        .groupby(group_keys, as_index=False)
        .agg(avg_floor_area=("TOTAL_FLOOR_AREA", "mean"), avg_rooms=("NUMBER_HABITABLE_ROOMS", "mean"))
    )

    filled = joined.merge(postcode_avgs, on=group_keys, how="left")
    filled["TOTAL_FLOOR_AREA_FILLED"] = filled["TOTAL_FLOOR_AREA"].where(filled["TOTAL_FLOOR_AREA"].notna(), filled["avg_floor_area"])

    filled = filled[filled["TOTAL_FLOOR_AREA_FILLED"].notna() & (filled["TOTAL_FLOOR_AREA_FILLED"] > 0)].copy()
    if filled.empty:
        for g in GRID_SIZES:
            dump_json_gz(output_dir / f"grid_{g//1000}km_ppsf_full.json.gz", [])
        return

    filled["price_per_sqft"] = filled["price"] / (filled["TOTAL_FLOOR_AREA_FILLED"] * SQFT_PER_M2)
    filled = filled[filled["price_per_sqft"].notna()].copy()

    for g in GRID_SIZES:
        years_back = PPSF_YEARS_BACK_BY_GRID.get(g, 1)
        end_months = yearly_end_months(filled["month"], years_back=years_back)
        rows: list[dict] = []
        gx = f"gx_{g}"
        gy = f"gy_{g}"

        for end_month in end_months:
            start_month = (end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
            window = filled[(filled["month"] >= start_month) & (filled["month"] <= end_month)].copy()
            if window.empty:
                continue

            agg = aggregate_segments_metric(window, g, metric_col="price_per_sqft", out_metric_col="median_ppsf")
            agg = agg[agg["tx_count"] >= 3].copy()
            end_month_str = pd.to_datetime(end_month).strftime("%Y-%m-%d")

            for r in agg.itertuples(index=False):
                rows.append(
                    {
                        "gx": int(getattr(r, gx)),
                        "gy": int(getattr(r, gy)),
                        "end_month": end_month_str,
                        "property_type": str(r.property_type),
                        "new_build": str(r.new_build),
                        "median_ppsf": float(r.median_ppsf),
                        "tx_count": int(r.tx_count),
                    }
                )

        dump_json_gz(output_dir / f"grid_{g//1000}km_ppsf_full.json.gz", rows)

        # Also write partitioned files
        grid_label = f"{g // 1000}km"
        n = write_partitions(rows, output_dir, grid_label, metric="median_ppsf")
        print(f"  Partitions written: {grid_label}/median_ppsf -> {n} files")


def build_delta_outputs(df: pd.DataFrame, output_dir: Path, latest_end_month: pd.Timestamp) -> None:
    earliest_month = df["month"].min()
    earliest_end_month = (earliest_month + pd.DateOffset(months=11)).to_period("M").to_timestamp()
    if earliest_end_month > latest_end_month:
        earliest_end_month = earliest_month

    earliest_start = (earliest_end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
    latest_start = (latest_end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()

    early_window = df[(df["month"] >= earliest_start) & (df["month"] <= earliest_end_month)].copy()
    late_window = df[(df["month"] >= latest_start) & (df["month"] <= latest_end_month)].copy()

    earliest_str = earliest_end_month.strftime("%Y-%m-%d")
    latest_str = latest_end_month.strftime("%Y-%m-%d")
    years_delta = max(1, int(pd.to_datetime(latest_str).year - pd.to_datetime(earliest_str).year))

    for g in DELTA_GRID_SIZES:
        early = aggregate_segments(early_window, g).rename(columns={"median": "price_earliest", "tx_count": "sales_earliest"})
        late = aggregate_segments(late_window, g).rename(columns={"median": "price_latest", "tx_count": "sales_latest"})

        gx = f"gx_{g}"
        gy = f"gy_{g}"

        merged = early.merge(late, on=[gx, gy, "property_type", "new_build"], how="inner")
        if merged.empty:
            dump_json_gz(output_dir / f"deltas_overall_{g//1000}km.json.gz", [])
            continue

        merged["delta_gbp"] = merged["price_latest"] - merged["price_earliest"]
        merged["delta_pct"] = ((merged["price_latest"] / merged["price_earliest"]) - 1.0) * 100.0
        merged = merged.replace([float("inf"), float("-inf")], pd.NA).dropna(subset=["delta_pct"])

        rows = []
        for r in merged.itertuples(index=False):
            gxv = int(getattr(r, gx))
            gyv = int(getattr(r, gy))
            rows.append(
                {
                    gx: gxv,
                    gy: gyv,
                    "gx": gxv,
                    "gy": gyv,
                    f"cell_{g}": f"{gxv}_{gyv}",
                    "cell": f"{gxv}_{gyv}",
                    "property_type": str(r.property_type),
                    "new_build": str(r.new_build),
                    "price_earliest": float(r.price_earliest),
                    "sales_earliest": int(r.sales_earliest),
                    "end_month_earliest": earliest_str,
                    "price_latest": float(r.price_latest),
                    "sales_latest": int(r.sales_latest),
                    "end_month_latest": latest_str,
                    "delta_gbp": float(r.delta_gbp),
                    "delta_pct": float(r.delta_pct),
                    "years_delta": years_delta,
                }
            )

        dump_json_gz(output_dir / f"deltas_overall_{g//1000}km.json.gz", rows)


def build_postcode_indexes(onspd: pd.DataFrame, output_dir: Path) -> None:
    work = onspd.copy()
    work["outcode"] = work["postcode_key"].map(derive_outcode)

    for g in GRID_SIZES:
        gx = ((work["east"] // g) * g).astype("int64")
        gy = ((work["north"] // g) * g).astype("int64")
        cell = gx.astype("string") + "_" + gy.astype("string")
        tmp = pd.DataFrame({"cell": cell, "outcode": work["outcode"]})
        tmp = tmp.dropna(subset=["cell", "outcode"])

        index: dict[str, list[str]] = {}
        for cell_key, grp in tmp.groupby("cell"):
            index[str(cell_key)] = sorted(grp["outcode"].astype("string").str.upper().unique().tolist())

        dump_json_gz(output_dir / f"postcode_outcode_index_{g//1000}km.json.gz", index)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build property artifacts (grid, deltas, postcode indexes)")
    parser.add_argument("--pp", default=str(RAW_PROPERTY_DIR / "pp-2025.txt"), help="Path to PP data txt")
    parser.add_argument(
        "--scotland",
        default=str(RAW_PROPERTY_DIR / "Scotland_properties.csv"),
        help="Path to Scotland properties csv (optional)",
    )
    parser.add_argument(
        "--onspd",
        default=str(RAW_PROPERTY_DIR / "ONSPD_Online_latest_Postcode_Centroids_.csv"),
        help="Path to ONSPD postcode centroid csv",
    )
    parser.add_argument(
        "--epc",
        default=str(RAW_EPC_DIR / "epc_prop_all.csv"),
        help="Path to EPC properties csv",
    )
    parser.add_argument("--output-dir", default=str(MODEL_PROPERTY_DIR), help="Output directory for property artifacts")
    parser.add_argument("--years-back", type=int, default=10, help="Number of years of PP data to include")
    return parser.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()

    pp_path = Path(args.pp).expanduser().resolve()
    scotland_path = Path(args.scotland).expanduser().resolve()
    onspd_path = Path(args.onspd).expanduser().resolve()
    epc_path = Path(args.epc).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    onspd = load_onspd(onspd_path)
    epc_latest = load_epc_latest(epc_path)
    pp = load_pp(pp_path, years_back=max(1, int(args.years_back)))
    scotland = load_scotland_properties(
        scotland_path,
        years_back=max(1, int(args.years_back)),
        anchor_month=pp["month"].max(),
    )
    if not scotland.empty:
        pp = pd.concat([pp, scotland], ignore_index=True)
    merged = with_grid_cells(pp, onspd)

    latest_end_month = merged["month"].max()

    build_grid_outputs(merged, output_dir, latest_end_month)
    build_ppsf_outputs(merged, epc_latest, output_dir)
    build_delta_outputs(merged, output_dir, latest_end_month)
    build_postcode_indexes(onspd, output_dir)

    print(f"Built property artifacts in: {output_dir}")


if __name__ == "__main__":
    main()

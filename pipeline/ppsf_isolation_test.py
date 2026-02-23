#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path

import pandas as pd

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


def normalize_postcode(value: str) -> str:
    if value is None or pd.isna(value):
        return ""
    return re.sub(r"\s+", "", str(value).upper()).strip()


def normalize_paon(value: str) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value).upper().strip()
    text = re.sub(r"\s+", "", text)
    text = text.lstrip("0")
    return text


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


def load_pp(path: Path, years_back: int, max_rows: int) -> pd.DataFrame:
    cutoff = (pd.Timestamp.today().normalize() - pd.DateOffset(years=years_back)).date()
    frames: list[pd.DataFrame] = []
    kept = 0

    for chunk in pd.read_csv(
        path,
        header=None,
        names=PP_COLS,
        usecols=["price", "date", "postcode", "property_type", "new_build", "paon", "record_status"],
        dtype="string",
        chunksize=500_000,
    ):
        chunk["date"] = pd.to_datetime(chunk["date"], errors="coerce")
        chunk = chunk[chunk["date"].notna()]
        chunk = chunk[chunk["record_status"] == "A"]
        chunk = chunk[chunk["date"].dt.date >= cutoff]

        if chunk.empty:
            continue

        chunk["price"] = pd.to_numeric(chunk["price"], errors="coerce")
        chunk = chunk[chunk["price"].notna() & (chunk["price"] > 0)]

        chunk["pc_key"] = chunk["postcode"].map(normalize_postcode)
        chunk["paon_key"] = chunk["paon"].map(normalize_paon)
        chunk = chunk[(chunk["pc_key"].str.len() > 0) & (chunk["paon_key"].str.len() > 0)]

        chunk["month"] = chunk["date"].dt.to_period("M").dt.to_timestamp()
        chunk["property_type"] = chunk["property_type"].fillna("ALL")
        chunk["new_build"] = chunk["new_build"].fillna("ALL")

        cols = ["price", "month", "postcode", "property_type", "new_build", "pc_key", "paon_key"]
        trimmed = chunk[cols]
        frames.append(trimmed)
        kept += len(trimmed)

        if max_rows > 0 and kept >= max_rows:
            break

    if not frames:
        raise RuntimeError("No usable PP rows found for isolation test")

    out = pd.concat(frames, ignore_index=True)
    if max_rows > 0 and len(out) > max_rows:
        out = out.iloc[:max_rows].copy()
    return out


def load_epc_latest(path: Path) -> pd.DataFrame:
    epc = pd.read_csv(path, dtype="string", low_memory=False)

    addr_col = "address1" if "address1" in epc.columns else "ADDRESS"
    if "POSTCODE" not in epc.columns or addr_col not in epc.columns:
        raise RuntimeError("EPC missing required columns POSTCODE/ADDRESS")

    keep_cols = [c for c in ["POSTCODE", addr_col, "TOTAL_FLOOR_AREA", "NUMBER_HABITABLE_ROOMS", "INSPECTION_DATE"] if c in epc.columns]
    epc = epc[keep_cols].copy()

    epc["pc_key"] = epc["POSTCODE"].map(normalize_postcode)
    epc["paon_raw"] = epc[addr_col].map(extract_paon_from_epc_address)
    epc["paon_key"] = epc["paon_raw"].map(normalize_paon)
    epc["TOTAL_FLOOR_AREA"] = pd.to_numeric(epc.get("TOTAL_FLOOR_AREA"), errors="coerce")
    epc["NUMBER_HABITABLE_ROOMS"] = pd.to_numeric(epc.get("NUMBER_HABITABLE_ROOMS"), errors="coerce")
    epc["INSPECTION_DATE"] = pd.to_datetime(epc.get("INSPECTION_DATE"), errors="coerce")

    epc = epc[(epc["pc_key"].str.len() > 0) & (epc["paon_key"].str.len() > 0)].copy()
    epc = epc.sort_values("INSPECTION_DATE").drop_duplicates(["pc_key", "paon_key"], keep="last")

    return epc[["pc_key", "paon_key", "TOTAL_FLOOR_AREA", "NUMBER_HABITABLE_ROOMS", "INSPECTION_DATE"]]


def load_onspd_lookup(path: Path) -> pd.DataFrame:
    header = pd.read_csv(path, nrows=0)
    cols = {c.lower().strip(): c for c in header.columns}

    postcode_col = cols.get("pcd7") or cols.get("pcds")
    east_col = cols.get("east1m") or cols.get("x")
    north_col = cols.get("north1m") or cols.get("y")

    if not postcode_col or not east_col or not north_col:
        raise RuntimeError("ONSPD columns not found")

    out = pd.read_csv(
        path,
        usecols=[postcode_col, east_col, north_col],
        dtype={postcode_col: "string", east_col: "string", north_col: "string"},
    ).rename(columns={postcode_col: "postcode", east_col: "east", north_col: "north"})

    out["pc_key"] = out["postcode"].map(normalize_postcode)
    out["east"] = pd.to_numeric(out["east"], errors="coerce")
    out["north"] = pd.to_numeric(out["north"], errors="coerce")
    out = out.dropna(subset=["pc_key", "east", "north"]).drop_duplicates("pc_key")
    return out[["pc_key", "east", "north"]]


def aggregate_ppsf(window: pd.DataFrame, gx: str, gy: str) -> pd.DataFrame:
    a = window.groupby([gx, gy, "property_type", "new_build"], as_index=False).agg(
        median_ppsf=("price_per_sqft", "median"),
        tx_count=("price_per_sqft", "size"),
    )

    b = window.groupby([gx, gy, "property_type"], as_index=False).agg(
        median_ppsf=("price_per_sqft", "median"),
        tx_count=("price_per_sqft", "size"),
    )
    b["new_build"] = "ALL"

    c = window.groupby([gx, gy, "new_build"], as_index=False).agg(
        median_ppsf=("price_per_sqft", "median"),
        tx_count=("price_per_sqft", "size"),
    )
    c["property_type"] = "ALL"

    d = window.groupby([gx, gy], as_index=False).agg(
        median_ppsf=("price_per_sqft", "median"),
        tx_count=("price_per_sqft", "size"),
    )
    d["property_type"] = "ALL"
    d["new_build"] = "ALL"

    return pd.concat([a, b, c, d], ignore_index=True)


def yearly_end_months(month_series: pd.Series, years_back: int) -> list[pd.Timestamp]:
    latest = month_series.max()
    end_months = [latest]
    cursor = latest - pd.DateOffset(years=1)
    min_month = month_series.min()
    while cursor >= min_month and len(end_months) < (years_back + 1):
        end_months.append(cursor)
        cursor -= pd.DateOffset(years=1)
    return end_months


def main() -> None:
    parser = argparse.ArgumentParser(description="Isolated PPSF generation test (no pipeline side effects)")
    parser.add_argument("--pp", default="pipeline/data/raw/property/pp-2025.txt")
    parser.add_argument("--epc", default="pipeline/data/raw/epc/epc_prop_all.csv")
    parser.add_argument("--onspd", default="pipeline/data/raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv")
    parser.add_argument("--years-back", type=int, default=5)
    parser.add_argument("--max-rows", type=int, default=400000)
    parser.add_argument("--grid", type=int, default=25000)
    parser.add_argument("--snapshot-years", type=int, default=10)
    parser.add_argument("--out", default="pipeline/data/intermediate/property/ppsf_isolation_25km.json.gz")
    args = parser.parse_args()

    pp = load_pp(Path(args.pp), years_back=max(1, args.years_back), max_rows=max(0, args.max_rows))
    epc = load_epc_latest(Path(args.epc))
    onspd = load_onspd_lookup(Path(args.onspd))

    joined = pp.merge(epc, on=["pc_key", "paon_key"], how="left")
    direct_match = joined["TOTAL_FLOOR_AREA"].notna().mean()

    group_keys = ["postcode", "property_type", "new_build"]
    postcode_avgs = (
        joined.loc[joined["TOTAL_FLOOR_AREA"].notna()]
        .groupby(group_keys, as_index=False)
        .agg(avg_floor_area=("TOTAL_FLOOR_AREA", "mean"))
    )
    filled = joined.merge(postcode_avgs, on=group_keys, how="left")
    filled["TOTAL_FLOOR_AREA_FILLED"] = filled["TOTAL_FLOOR_AREA"].where(
        filled["TOTAL_FLOOR_AREA"].notna(),
        filled["avg_floor_area"],
    )
    filled_match = filled["TOTAL_FLOOR_AREA_FILLED"].notna().mean()

    with_area = filled[filled["TOTAL_FLOOR_AREA_FILLED"].notna() & (filled["TOTAL_FLOOR_AREA_FILLED"] > 0)].copy()
    with_area["price_per_sqft"] = with_area["price"] / (with_area["TOTAL_FLOOR_AREA_FILLED"] * SQFT_PER_M2)

    enriched = with_area.merge(onspd, on="pc_key", how="inner")
    g = int(args.grid)
    gx = f"gx_{g}"
    gy = f"gy_{g}"
    enriched[gx] = ((enriched["east"] // g) * g).astype("int64")
    enriched[gy] = ((enriched["north"] // g) * g).astype("int64")

    snapshot_months = yearly_end_months(enriched["month"], years_back=max(1, args.snapshot_years))
    parts: list[pd.DataFrame] = []
    total_window_rows = 0

    for end_month in snapshot_months:
        start_month = (end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
        window = enriched[(enriched["month"] >= start_month) & (enriched["month"] <= end_month)].copy()
        total_window_rows += len(window)
        if window.empty:
            continue
        ppsf = aggregate_ppsf(window, gx, gy)
        ppsf = ppsf[ppsf["tx_count"] >= 3].copy()
        ppsf["end_month"] = pd.to_datetime(end_month).strftime("%Y-%m-%d")
        parts.append(ppsf)

    if not parts:
        raise RuntimeError("No PPSF rows generated in isolation test")

    out_df = pd.concat(parts, ignore_index=True).rename(columns={gx: "gx", gy: "gy"})
    out_df = out_df[["gx", "gy", "end_month", "property_type", "new_build", "median_ppsf", "tx_count"]]
    out_df = out_df.dropna(subset=["gx", "gy", "median_ppsf"])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_path, "wt", encoding="utf-8") as handle:
        json.dump(out_df.to_dict(orient="records"), handle, ensure_ascii=False)

    print(f"pp_rows={len(pp)}")
    print(f"epc_rows={len(epc)}")
    print(f"direct_epc_match_rate={direct_match:.3f}")
    print(f"filled_floor_area_coverage={filled_match:.3f}")
    print(f"with_area_rows={len(with_area)}")
    print(f"snapshot_count={len(snapshot_months)} total_window_rows={total_window_rows} latest_end_month={snapshot_months[0].strftime('%Y-%m-%d')}")
    print(f"ppsf_rows={len(out_df)}")
    if len(out_df):
        print("ppsf_columns=", sorted(out_df.columns.tolist()))
        print("sample_row=", out_df.iloc[0].to_dict())
    print(f"wrote={out_path}")


if __name__ == "__main__":
    main()

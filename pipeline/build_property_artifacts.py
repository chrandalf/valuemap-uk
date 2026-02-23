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
PPSF_YEARS_BACK_BY_GRID = {1000: 1, 5000: 3, 10000: 3, 25000: 3}
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

        frames.append(chunk[["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"]])

    if not frames:
        raise RuntimeError("No valid rows found in PP file after filtering")

    return pd.concat(frames, ignore_index=True)


def load_scotland_properties(path: Path, years_back: int) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"])

    today = pd.Timestamp.today().normalize().date()
    cutoff = (pd.Timestamp.today().normalize() - pd.DateOffset(years=years_back)).date()
    frames: list[pd.DataFrame] = []

    for chunk in pd.read_csv(
        path,
        usecols=["Postcode", "Date", "Price"],
        dtype={"Postcode": "string", "Date": "string", "Price": "string"},
        chunksize=500_000,
    ):
        chunk = chunk.rename(columns={"Postcode": "postcode", "Date": "date", "Price": "price"})
        chunk["date"] = pd.to_datetime(chunk["date"], errors="coerce", dayfirst=True)
        chunk = chunk[chunk["date"].notna()]
        chunk = chunk[chunk["date"].dt.date >= cutoff]
        chunk = chunk[chunk["date"].dt.date <= today]

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

        frames.append(chunk[["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"]])

    if not frames:
        return pd.DataFrame(columns=["price", "month", "postcode", "postcode_key", "paon_key", "property_type", "new_build"])

    return pd.concat(frames, ignore_index=True)


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

    a = (
        window.groupby([gx, gy, "property_type", "new_build"], as_index=False)
        .agg(median=("price", "median"), tx_count=("price", "size"))
    )

    b = (
        window.groupby([gx, gy, "property_type"], as_index=False)
        .agg(median=("price", "median"), tx_count=("price", "size"))
    )
    b["new_build"] = "ALL"

    c = (
        window.groupby([gx, gy, "new_build"], as_index=False)
        .agg(median=("price", "median"), tx_count=("price", "size"))
    )
    c["property_type"] = "ALL"

    d = (
        window.groupby([gx, gy], as_index=False)
        .agg(median=("price", "median"), tx_count=("price", "size"))
    )
    d["property_type"] = "ALL"
    d["new_build"] = "ALL"

    out = pd.concat([a, b, c, d], ignore_index=True)
    return out[[gx, gy, "property_type", "new_build", "median", "tx_count"]]


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
    latest_start = (latest_end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
    latest_window = df[(df["month"] >= latest_start) & (df["month"] <= latest_end_month)].copy()

    end_month_str = latest_end_month.strftime("%Y-%m-%d")

    for g in GRID_SIZES:
        agg = aggregate_segments(latest_window, g)
        gx = f"gx_{g}"
        gy = f"gy_{g}"

        rows = []
        for r in agg.itertuples(index=False):
            rows.append(
                {
                    "gx": int(getattr(r, gx)),
                    "gy": int(getattr(r, gy)),
                    "end_month": end_month_str,
                    "property_type": str(r.property_type),
                    "new_build": str(r.new_build),
                    "median": float(r.median),
                    "tx_count": int(r.tx_count),
                }
            )

        dump_json_gz(output_dir / f"grid_{g//1000}km_full.json.gz", rows)


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
    scotland = load_scotland_properties(scotland_path, years_back=max(1, int(args.years_back)))
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

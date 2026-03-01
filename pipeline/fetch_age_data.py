"""
Fetch Census 2021 TS007A – Age by Five-Year Age Bands from the Nomis API.

Dataset : NM_2020_1 (TS007A)
Category: C2021_AGE_19 (19 values: Total + 18 five-year bands)
Geography: LSOA21 (TYPE151) – ~35,000 areas in England & Wales
Output  : RAW_CENSUS_AGE_LSOA  (pipeline/data/raw/census/ts007a_age_lsoa21.csv)

Outputs per LSOA (all percentages are 0–100 scale):
    geography_code
    total           – total usual residents
    age_0_4 … age_85p  – raw counts per 5-year band

    # Broad band percentages (% of total)
    pct_under_15    – 0–14  (toddlers + primary/secondary school)
    pct_15_24       – 15–24 (teens + young adults / students)
    pct_25_44       – 25–44 (prime family/career formation age)
    pct_45_64       – 45–64 (mid to older working age)
    pct_65_plus     – 65+   (retirement / older residents)

    mean_age        – population-weighted mean age (using band midpoints)
    age_score       – normalised 0–1 (0 = oldest nationally, 1 = youngest)
                      useful for the index: higher = younger community

The file is skipped if it already exists.  Delete to force a re-download.
After this script completes, df_wide is available in-memory for downstream use.
"""

from __future__ import annotations

import io
import math
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent))
from paths import RAW_CENSUS_AGE_LSOA, ensure_pipeline_dirs  # noqa: E402

# ── Config ────────────────────────────────────────────────────────────────────
DATASET   = "NM_2020_1"        # TS007A – Age by five-year bands
GEOGRAPHY = "TYPE151"          # 2021 LSOAs in England & Wales
MEASURES  = "20100"
PAGE_SIZE = 24_000
BASE_URL  = "https://www.nomisweb.co.uk/api/v01/dataset"

# Maps the Nomis display name → our internal short column name
BAND_NAME_MAP: dict[str, str] = {
    "Total":                    "total",
    "Aged 4 years and under":   "age_0_4",
    "Aged 5 to 9 years":        "age_5_9",
    "Aged 10 to 14 years":      "age_10_14",
    "Aged 15 to 19 years":      "age_15_19",
    "Aged 20 to 24 years":      "age_20_24",
    "Aged 25 to 29 years":      "age_25_29",
    "Aged 30 to 34 years":      "age_30_34",
    "Aged 35 to 39 years":      "age_35_39",
    "Aged 40 to 44 years":      "age_40_44",
    "Aged 45 to 49 years":      "age_45_49",
    "Aged 50 to 54 years":      "age_50_54",
    "Aged 55 to 59 years":      "age_55_59",
    "Aged 60 to 64 years":      "age_60_64",
    "Aged 65 to 69 years":      "age_65_69",
    "Aged 70 to 74 years":      "age_70_74",
    "Aged 75 to 79 years":      "age_75_79",
    "Aged 80 to 84 years":      "age_80_84",
    "Aged 85 years and over":   "age_85p",
}

# Midpoints used to estimate mean age
BAND_MIDPOINTS: dict[str, float] = {
    "age_0_4":   2.5,
    "age_5_9":   7.5,
    "age_10_14": 12.5,
    "age_15_19": 17.5,
    "age_20_24": 22.5,
    "age_25_29": 27.5,
    "age_30_34": 32.5,
    "age_35_39": 37.5,
    "age_40_44": 42.5,
    "age_45_49": 47.5,
    "age_50_54": 52.5,
    "age_55_59": 57.5,
    "age_60_64": 62.5,
    "age_65_69": 67.5,
    "age_70_74": 72.5,
    "age_75_79": 77.5,
    "age_80_84": 82.5,
    "age_85p":   90.0,   # open-ended – census median for 85+ is ~90
}

# Broad band groupings (list of raw band columns to sum)
BROAD_BANDS: dict[str, list[str]] = {
    "pct_under_15": ["age_0_4", "age_5_9", "age_10_14"],
    "pct_15_24":    ["age_15_19", "age_20_24"],
    "pct_25_44":    ["age_25_29", "age_30_34", "age_35_39", "age_40_44"],
    "pct_45_64":    ["age_45_49", "age_50_54", "age_55_59", "age_60_64"],
    "pct_65_plus":  ["age_65_69", "age_70_74", "age_75_79", "age_80_84", "age_85p"],
}


# ── Fetch helpers ─────────────────────────────────────────────────────────────

def fetch_record_count() -> int | None:
    url = (
        f"{BASE_URL}/{DATASET}.data.csv"
        f"?geography={GEOGRAPHY}"
        f"&measures={MEASURES}"
        f"&time=latest"
        f"&select=geography_code,c2021_age_19_name,obs_value,record_count"
        f"&RecordLimit=1"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.text))
    if "RECORD_COUNT" in df.columns and len(df):
        return int(df["RECORD_COUNT"].iloc[0])
    return None


def fetch_page(offset: int) -> pd.DataFrame:
    url = (
        f"{BASE_URL}/{DATASET}.data.csv"
        f"?geography={GEOGRAPHY}"
        f"&measures={MEASURES}"
        f"&time=latest"
        f"&select=geography_code,c2021_age_19_name,obs_value"
        f"&RecordLimit={PAGE_SIZE}"
        f"&RecordOffset={offset}"
        f"&ExcludeMissingValues=true"
    )
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return pd.read_csv(io.StringIO(resp.text))


# ── Wide-form builder ─────────────────────────────────────────────────────────

def build_wide(df_long: pd.DataFrame) -> pd.DataFrame:
    col = "c2021_age_19_name"
    df = df_long.copy()
    df.columns = df.columns.str.lower()
    df[col] = df[col].str.strip()
    df["band"] = df[col].map(BAND_NAME_MAP)

    # Drop any unmapped rows (shouldn't happen, but safety-first)
    df = df.dropna(subset=["band"])

    df_wide = df.pivot_table(
        index="geography_code",
        columns="band",
        values="obs_value",
        aggfunc="sum",
    ).reset_index()
    df_wide.columns.name = None

    # Ensure every expected column is present
    for b in BAND_NAME_MAP.values():
        if b not in df_wide.columns:
            df_wide[b] = 0

    total = df_wide["total"].replace(0, float("nan"))

    # Broad band percentages (0–100)
    for pct_col, bands in BROAD_BANDS.items():
        df_wide[pct_col] = df_wide[bands].sum(axis=1) / total * 100

    # Mean age from midpoints
    weighted_sum = sum(
        df_wide[band] * mid
        for band, mid in BAND_MIDPOINTS.items()
        if band in df_wide.columns
    )
    df_wide["mean_age"] = (weighted_sum / total).round(1)

    # Normalised age score: 0 = oldest nationally, 1 = youngest
    # Based on mean_age: invert and scale 0-1 across dataset
    mn = df_wide["mean_age"].min()
    mx = df_wide["mean_age"].max()
    if mx > mn:
        df_wide["age_score"] = ((mx - df_wide["mean_age"]) / (mx - mn)).round(4)
    else:
        df_wide["age_score"] = 0.5

    # Round percentages
    for col in BROAD_BANDS:
        df_wide[col] = df_wide[col].round(1)

    return df_wide


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> pd.DataFrame:
    ensure_pipeline_dirs()

    if RAW_CENSUS_AGE_LSOA.exists():
        print(f"Raw file already exists: {RAW_CENSUS_AGE_LSOA}")
        print("Skipping download.  Delete the file to force a re-download.")
        df_wide = pd.read_csv(RAW_CENSUS_AGE_LSOA, dtype={"geography_code": str})
        print(f"Loaded {len(df_wide):,} LSOAs × {df_wide.shape[1]} cols")
        return df_wide

    print("Probing record count …")
    total_records = fetch_record_count()
    if total_records:
        pages = math.ceil(total_records / PAGE_SIZE)
        print(f"Total records: {total_records:,}  →  {pages} page(s) of {PAGE_SIZE:,}")
    else:
        pages = 35
        print("Could not determine record count; will fetch up to 35 pages.")

    chunks: list[pd.DataFrame] = []
    offset = 0

    for page in range(pages):
        print(f"  Fetching page {page + 1}/{pages}  (offset={offset:,}) …", end=" ", flush=True)
        df_page = fetch_page(offset)
        if df_page.empty:
            print("empty – done")
            break
        chunks.append(df_page)
        print(f"{len(df_page):,} rows")
        offset += PAGE_SIZE
        if len(df_page) < PAGE_SIZE:
            break
        time.sleep(0.3)

    print("\nAssembling …")
    df_long = pd.concat(chunks, ignore_index=True)
    print(f"Long form: {df_long.shape[0]:,} rows × {df_long.shape[1]} cols")

    df_wide = build_wide(df_long)
    print(f"Wide form: {len(df_wide):,} LSOAs × {df_wide.shape[1]} cols")

    RAW_CENSUS_AGE_LSOA.parent.mkdir(parents=True, exist_ok=True)
    df_wide.to_csv(RAW_CENSUS_AGE_LSOA, index=False)
    print(f"\nSaved → {RAW_CENSUS_AGE_LSOA}")

    print("\n── Descriptive statistics ──")
    stat_cols = ["mean_age", "age_score", "pct_under_15", "pct_15_24",
                 "pct_25_44", "pct_45_64", "pct_65_plus"]
    print(df_wide[stat_cols].describe().round(2).to_string())

    print("\n── Ten youngest LSOAs (by mean_age) ──")
    print(df_wide.nsmallest(10, "mean_age")[["geography_code","mean_age","age_score",
          "pct_under_15","pct_15_24","pct_25_44","pct_65_plus"]].to_string(index=False))

    print("\n── Ten oldest LSOAs (by mean_age) ──")
    print(df_wide.nlargest(10, "mean_age")[["geography_code","mean_age","age_score",
          "pct_under_15","pct_15_24","pct_25_44","pct_65_plus"]].to_string(index=False))

    return df_wide


if __name__ == "__main__":
    df_wide = main()  # noqa: F841

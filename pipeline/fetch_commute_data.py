"""
Fetch Census 2021 TS058 – Distance Travelled to Work from the Nomis API.

Dataset : NM_2075_1 (TS058)
Geography: LSOA21 (TYPE151) – ~35,000 areas in England & Wales
Output   : RAW_CENSUS_COMMUTE_LSOA  (pipeline/data/raw/census/ts058_commute_lsoa21.csv)

The file is checked before downloading – if it already exists the download is
skipped and the file is loaded directly.  Census data changes at most once a year
so this keeps the pipeline fast on subsequent runs.

After this script completes, `df_wide` is available as the in-memory wide-form
DataFrame for immediate downstream use (e.g. piped into build_commute_cells.py).
"""

from __future__ import annotations

import io
import math
import sys
import time
from pathlib import Path

import pandas as pd
import requests

# Add pipeline dir to path so we can import paths.py
sys.path.insert(0, str(Path(__file__).parent))
from paths import RAW_CENSUS_COMMUTE_LSOA, ensure_pipeline_dirs  # noqa: E402

# ── Config ──────────────────────────────────────────────────────────────────
DATASET     = "NM_2075_1"
GEOGRAPHY   = "TYPE151"          # 2021 LSOAs within England
CATEGORIES  = "0,1,2,3,4,5,6,7,8,9,10"   # all distance bands incl. total
MEASURES    = "20100"            # observation value (count)
PAGE_SIZE   = 24000              # stay under 25,000 cell limit
BASE_URL    = "https://www.nomisweb.co.uk/api/v01/dataset"

BAND_NAME_MAP = {
    "Total: All usual residents aged 16 years and over in employment the week before the census": "total",
    "Less than 2km":              "lt_2km",
    "2km to less than 5km":      "km2_5",
    "5km to less than 10km":     "km5_10",
    "10km to less than 20km":    "km10_20",
    "20km to less than 30km":    "km20_30",
    "30km to less than 40km":    "km30_40",
    "40km to less than 60km":    "km40_60",
    "60km and over":             "km60_plus",
    "Works mainly from home":    "wfh",
    "Works mainly at an offshore installation, in no fixed place, or outside the UK": "offshore_other",
}

# ── Fetch helpers ────────────────────────────────────────────────────────────
def fetch_page(offset: int) -> pd.DataFrame:
    url = (
        f"{BASE_URL}/{DATASET}.data.csv"
        f"?geography={GEOGRAPHY}"
        f"&C2021_TTWDIST_11={CATEGORIES}"
        f"&measures={MEASURES}"
        f"&time=latest"
        f"&select=geography_code,c2021_ttwdist_11_name,obs_value"
        f"&RecordLimit={PAGE_SIZE}"
        f"&RecordOffset={offset}"
        f"&ExcludeMissingValues=true"
    )
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return pd.read_csv(io.StringIO(resp.text))


def fetch_record_count() -> int | None:
    """Single-row probe to read RECORD_COUNT."""
    url = (
        f"{BASE_URL}/{DATASET}.data.csv"
        f"?geography={GEOGRAPHY}"
        f"&C2021_TTWDIST_11={CATEGORIES}"
        f"&measures={MEASURES}"
        f"&time=latest"
        f"&select=geography_code,c2021_ttwdist_11_name,obs_value,record_count"
        f"&RecordLimit=1"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.text))
    if "RECORD_COUNT" in df.columns and len(df):
        return int(df["RECORD_COUNT"].iloc[0])
    return None


# ── Build wide DataFrame from long ──────────────────────────────────────────

MID_KM: dict[str, float] = {
    "lt_2km":         1.0,
    "km2_5":          3.5,
    "km5_10":         7.5,
    "km10_20":       15.0,
    "km20_30":       25.0,
    "km30_40":       35.0,
    "km40_60":       50.0,
    "km60_plus":     75.0,
    "wfh":            0.0,
    "offshore_other": 0.0,
}


def build_wide(df_long: pd.DataFrame) -> pd.DataFrame:
    col = "c2021_ttwdist_11_name"
    df_long = df_long.copy()
    df_long.columns = df_long.columns.str.lower()
    df_long[col] = df_long[col].str.strip()
    df_long["band"] = df_long[col].map(BAND_NAME_MAP).fillna(df_long[col])

    df_wide = df_long.pivot_table(
        index="geography_code",
        columns="band",
        values="obs_value",
        aggfunc="sum",
    ).reset_index()
    df_wide.columns.name = None

    # Ensure every band column is present
    for b in BAND_NAME_MAP.values():
        if b not in df_wide.columns:
            df_wide[b] = 0

    total = df_wide["total"].replace(0, float("nan"))

    df_wide["pct_short"] = (
        df_wide.get("lt_2km", 0) + df_wide.get("km2_5", 0) + df_wide.get("wfh", 0)
    ) / total * 100

    df_wide["pct_long"] = (
        df_wide.get("km30_40", 0) + df_wide.get("km40_60", 0) + df_wide.get("km60_plus", 0)
    ) / total * 100

    df_wide["pct_wfh"] = df_wide.get("wfh", 0) / total * 100

    weighted_sum = sum(df_wide.get(band, 0) * mid for band, mid in MID_KM.items())
    df_wide["mean_dist_km"] = (weighted_sum / total).round(3)
    df_wide["pct_short"]    = df_wide["pct_short"].round(2)
    df_wide["pct_long"]     = df_wide["pct_long"].round(2)
    df_wide["pct_wfh"]      = df_wide["pct_wfh"].round(2)

    return df_wide


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> pd.DataFrame:
    ensure_pipeline_dirs()

    # ── Skip download if raw file already exists ──────────────────────────
    if RAW_CENSUS_COMMUTE_LSOA.exists():
        print(f"Raw file already exists: {RAW_CENSUS_COMMUTE_LSOA}")
        print("Skipping download.  Delete the file to force a re-download.")
        df_wide = pd.read_csv(RAW_CENSUS_COMMUTE_LSOA, dtype={"geography_code": str})
        print(f"Loaded {len(df_wide):,} LSOAs × {df_wide.shape[1]} cols")
        return df_wide

    # ── Download from Nomis ────────────────────────────────────────────────
    print("Probing record count …")
    total_records = fetch_record_count()
    if total_records:
        pages = math.ceil(total_records / PAGE_SIZE)
        print(f"Total records: {total_records:,}  →  {pages} page(s) of {PAGE_SIZE:,}")
    else:
        pages = 25
        print("Could not determine record count; will fetch until page is empty.")

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
            break        # last partial page
        time.sleep(0.3)  # be polite to the API

    print("\nAssembling …")
    df_long = pd.concat(chunks, ignore_index=True)
    print(f"Long form: {df_long.shape[0]:,} rows × {df_long.shape[1]} cols")

    df_wide = build_wide(df_long)
    print(f"Wide form: {len(df_wide):,} LSOAs × {df_wide.shape[1]} cols")

    # ── Persist raw output ─────────────────────────────────────────────────
    RAW_CENSUS_COMMUTE_LSOA.parent.mkdir(parents=True, exist_ok=True)
    df_wide.to_csv(RAW_CENSUS_COMMUTE_LSOA, index=False)
    print(f"Saved → {RAW_CENSUS_COMMUTE_LSOA}")

    print("\nDescriptive stats:")
    print(df_wide[["pct_short", "pct_long", "pct_wfh", "mean_dist_km"]].describe().round(2).to_string())

    return df_wide


if __name__ == "__main__":
    df_wide = main()  # noqa: F841  (available for interactive / downstream use)

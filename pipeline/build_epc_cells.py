"""
build_epc_cells.py

Reads epc_enriched_all.csv.gz (built by build_epc_enriched.py), deduplicates to
one record per property, joins to ONSPD for grid coordinates, and produces two
sets of per-cell JSON files for the ValueMap API:

  epc_fuel_cells_{grid}.json.gz   – heating fuel mix per 1/5/10/25 km cell
  epc_age_cells_{grid}.json.gz    – property construction age bands per cell

Output location: pipeline/data/model/epc/

Usage (from repo root, with .venv-7 active):
    python pipeline/build_epc_cells.py

    # Explicit paths:
    python pipeline/build_epc_cells.py \
        --epc    pipeline/data/raw/epc/epc_enriched_all.csv.gz \
        --onspd  pipeline/data/raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv \
        --output pipeline/data/model/epc

Output JSON schema
──────────────────
epc_fuel_cells_{grid}.json.gz  — array of:
  {
    "gx": <int>,          BNG easting  of SW corner of cell
    "gy": <int>,          BNG northing of SW corner of cell
    "n":  <int>,          number of properties in the cell with a known fuel type
    "pct_gas":      <float>,   % with MAIN_FUEL = gas or gas_community
    "pct_electric": <float>,   % with MAIN_FUEL = electric / electric_community
    "pct_oil":      <float>,   % with MAIN_FUEL = oil
    "pct_lpg":      <float>,   % with MAIN_FUEL = lpg
    "pct_other":    <float>    % biomass / solid_fuel / heat_network / renewable / other / unknown
  }

epc_age_cells_{grid}.json.gz  — array of:
  {
    "gx": <int>,
    "gy": <int>,
    "n":  <int>,          number of properties in the cell with a known age band
    "pct_pre1900":   <float>,   % built before 1900
    "pct_1900_1950": <float>,   % built 1900–1949
    "pct_1950_1980": <float>,   % built 1950–1979
    "pct_1980_2000": <float>,   % built 1980–1999
    "pct_post2000":  <float>    % built 2000 or later
  }

Notes
─────
• Deduplication: latest inspection date per UPRN (where populated); falls back
  to latest per (postcode_key, paon_key) so records without a UPRN are still
  deduplicated the same way the existing pipeline does it.
• Minimum cell threshold: cells with fewer than MIN_PROPS properties are dropped
  to avoid noisy single-house signals.
• England, Wales and Scotland postcodes are all included (the enriched file
  sources from English/Welsh LAs only; Scotland will have no EPC rows).
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from paths import (
    MODEL_EPC_AGE_CELLS_TEMPLATE,
    MODEL_EPC_FUEL_CELLS_TEMPLATE,
    RAW_EPC_DIR,
    RAW_PROPERTY_DIR,
    ensure_pipeline_dirs,
)

# ── Constants ─────────────────────────────────────────────────────────────────

DEFAULT_EPC   = RAW_EPC_DIR / "epc_enriched_all.csv.gz"
DEFAULT_ONSPD = RAW_PROPERTY_DIR / "ONSPD_Online_latest_Postcode_Centroids_.csv"

GRID_SIZES: list[tuple[str, int]] = [
    ("1mile", 1_600),
    ("5km",  5_000),
    ("10km", 10_000),
    ("25km", 25_000),
]

# Drop cells with fewer than this many properties (reduces map noise)
MIN_PROPS = 5

# ── Fuel grouping ──────────────────────────────────────────────────────────────
# MAIN_FUEL values in the enriched file (after normalisation by build_epc_enriched.py)

def classify_fuel(fuel: str | None) -> str:
    """Map normalised MAIN_FUEL to one of: gas / electric / oil / lpg / other."""
    if pd.isna(fuel):
        return "other"
    f = str(fuel).strip().lower()
    if f in ("gas", "gas_community"):
        return "gas"
    if f in ("electric", "electric_community"):
        return "electric"
    if f == "oil":
        return "oil"
    if f == "lpg":
        return "lpg"
    return "other"   # biomass, solid_fuel, heat_network, renewable, other, unknown


# ── Age band parsing ────────────────────────────────────────────────────────────
# CONSTRUCTION_AGE_BAND examples from the raw data:
#   "England and Wales: before 1900"
#   "England and Wales: 1900-1929"
#   "England and Wales: 1967-1975"
#   "England and Wales: 2012 onwards"
#   "INVALID!"   → discard

_AGE_BAND_RE = re.compile(r"(\d{4})", re.IGNORECASE)
_PRE1900_RE  = re.compile(r"before\s+1900", re.IGNORECASE)
_ONWARDS_RE  = re.compile(r"(\d{4})\s+onwards", re.IGNORECASE)

def parse_age_band_start_year(band: str | None) -> int | None:
    """Return the start year for the age band, or None if unparseable."""
    if pd.isna(band):
        return None
    s = str(band).strip()
    if re.search(r"INVALID", s, re.IGNORECASE) or s in ("NO DATA!", "", "nan"):
        return None
    if _PRE1900_RE.search(s):
        return 1850   # sentinel for "before 1900"
    m = _ONWARDS_RE.search(s)
    if m:
        return int(m.group(1))
    m = _AGE_BAND_RE.search(s)
    if m:
        return int(m.group(1))
    return None

def classify_age_band(start_year: int | None) -> str | None:
    """Map start year to one of 5 user-facing bands, or None if unknown."""
    if start_year is None:
        return None
    if start_year < 1900:
        return "pre1900"
    if start_year < 1950:
        return "1900_1950"
    if start_year < 1980:
        return "1950_1980"
    if start_year < 2000:
        return "1980_2000"
    return "post2000"


# ── Postcode normalisation (mirrors build_property_artifacts.py) ───────────────

def normalize_postcode_key(value: str) -> str:
    if value is None or pd.isna(value):
        return ""
    return re.sub(r"\s+", "", str(value).upper()).strip()


def normalize_paon(value: str) -> str:
    if value is None or pd.isna(value):
        return ""
    text = re.sub(r"\s+", "", str(value).upper()).strip()
    return text.lstrip("0")


def extract_paon_from_epc_address(addr: str) -> str:
    if addr is None or pd.isna(addr):
        return ""
    text = str(addr).strip().upper()
    m = re.search(r"^(FLAT|APT|APARTMENT|UNIT|ROOM)\b.*?,\s*([0-9]+[A-Z]?(?:-[0-9]+[A-Z]?)?)\b", text)
    if m:
        return m.group(2)
    m = re.match(r"^\s*([0-9]+[A-Z]?(?:-[0-9]+[A-Z]?)?)\b", text)
    if m:
        return m.group(1)
    return ""


# ── Loaders ────────────────────────────────────────────────────────────────────

def load_onspd(path: Path) -> pd.DataFrame:
    """Return DataFrame: postcode_key, east (BNG m), north (BNG m)."""
    if not path.exists():
        raise FileNotFoundError(f"ONSPD not found: {path}")
    header = pd.read_csv(path, nrows=0)
    cols = {c.lower().strip(): c for c in header.columns}
    pc_col    = cols.get("pcds") or cols.get("pcd7") or cols.get("pcd")
    east_col  = cols.get("east1m") or cols.get("eastings") or cols.get("x")
    north_col = cols.get("north1m") or cols.get("northings") or cols.get("y")
    if not all([pc_col, east_col, north_col]):
        raise RuntimeError("Cannot detect postcode/east/north in ONSPD")

    frames: list[pd.DataFrame] = []
    for chunk in pd.read_csv(
        path,
        usecols=[pc_col, east_col, north_col],
        dtype={pc_col: "string", east_col: "string", north_col: "string"},
        chunksize=500_000,
    ):
        chunk = chunk.rename(columns={pc_col: "postcode", east_col: "east", north_col: "north"})
        chunk["postcode_key"] = chunk["postcode"].map(normalize_postcode_key)
        chunk["east"]  = pd.to_numeric(chunk["east"],  errors="coerce")
        chunk["north"] = pd.to_numeric(chunk["north"], errors="coerce")
        chunk = chunk.dropna(subset=["postcode_key", "east", "north"])
        chunk = chunk[chunk["postcode_key"].str.len() > 0]
        frames.append(chunk[["postcode_key", "east", "north"]].drop_duplicates("postcode_key"))

    df = pd.concat(frames, ignore_index=True)
    return df.drop_duplicates("postcode_key")


READ_COLS = [
    "POSTCODE", "ADDRESS1", "INSPECTION_DATE", "UPRN",
    "MAIN_FUEL", "MAINS_GAS_FLAG",
    "CONSTRUCTION_AGE_BAND",
]

def load_epc_enriched(path: Path) -> pd.DataFrame:
    """
    Stream-read the enriched EPC file, keep only columns needed for aggregation,
    and return a deduplicated DataFrame (one row per property).

    Deduplication strategy:
      1. Where UPRN is present → keep latest INSPECTION_DATE per UPRN.
      2. Remaining rows (no UPRN) → keep latest INSPECTION_DATE per
         (postcode_key, paon_key), mirroring the existing pipeline.
    """
    if not path.exists():
        raise FileNotFoundError(f"EPC enriched file not found: {path}")

    # Probe which columns actually exist (the file may be a gzip CSV)
    header = pd.read_csv(path, nrows=0, compression="infer")
    available = set(header.columns)
    usecols = [c for c in READ_COLS if c in available]
    missing  = [c for c in READ_COLS if c not in available]
    if missing:
        print(f"  WARNING: columns not found in enriched file (will be blank): {missing}")

    frames: list[pd.DataFrame] = []
    for chunk_num, chunk in enumerate(pd.read_csv(
        path,
        usecols=usecols,
        dtype="string",
        low_memory=False,
        compression="infer",
        chunksize=500_000,
    ), 1):
        print(f"  chunk {chunk_num:3d}  ({chunk_num * 500_000:,} rows scanned)", flush=True)
        # Ensure all expected columns exist
        for col in READ_COLS:
            if col not in chunk.columns:
                chunk[col] = pd.NA

        chunk["postcode_key"]  = chunk["POSTCODE"].map(normalize_postcode_key)
        chunk["paon_key"]      = chunk["ADDRESS1"].map(extract_paon_from_epc_address).map(normalize_paon)
        chunk["INSPECTION_DATE"] = pd.to_datetime(chunk["INSPECTION_DATE"], errors="coerce")
        chunk["uprn_clean"]    = chunk["UPRN"].astype("string").str.strip()

        chunk = chunk[chunk["postcode_key"].str.len() > 0]
        frames.append(chunk[[
            "postcode_key", "paon_key", "uprn_clean",
            "INSPECTION_DATE", "MAIN_FUEL", "MAINS_GAS_FLAG", "CONSTRUCTION_AGE_BAND",
        ]])

    if not frames:
        raise RuntimeError("No rows loaded from EPC enriched file")

    print(f"  Raw rows loaded: {sum(len(f) for f in frames):,}")
    df = pd.concat(frames, ignore_index=True)

    # ── Deduplication pass 1: by UPRN ─────────────────────────────────────────
    has_uprn = df["uprn_clean"].notna() & (df["uprn_clean"] != "") & (df["uprn_clean"] != "<NA>")
    with_uprn    = df[has_uprn].sort_values("INSPECTION_DATE")
    without_uprn = df[~has_uprn]

    with_uprn = with_uprn.drop_duplicates(subset=["uprn_clean"], keep="last")

    # ── Deduplication pass 2: remaining rows by postcode+paon ─────────────────
    without_uprn = without_uprn[without_uprn["paon_key"].str.len() > 0]
    without_uprn = without_uprn.sort_values("INSPECTION_DATE").drop_duplicates(
        subset=["postcode_key", "paon_key"], keep="last"
    )

    deduped = pd.concat([with_uprn, without_uprn], ignore_index=True)
    print(f"  After deduplication: {len(deduped):,} unique properties")
    return deduped


# ── Aggregation helpers ────────────────────────────────────────────────────────

def snap_to_grid(df: pd.DataFrame, onspd: pd.DataFrame, grid_m: int) -> pd.DataFrame:
    merged = df.merge(onspd, on="postcode_key", how="inner")
    merged["gx"] = ((merged["east"]  // grid_m) * grid_m).astype("int64")
    merged["gy"] = ((merged["north"] // grid_m) * grid_m).astype("int64")
    return merged


def build_fuel_cells(snapped: pd.DataFrame) -> list[dict]:
    df = snapped.copy()
    df["fuel_group"] = df["MAIN_FUEL"].map(classify_fuel)

    # Only keep rows where we have a meaningful fuel reading
    df = df[df["fuel_group"].notna()]

    agg = df.groupby(["gx", "gy", "fuel_group"]).size().unstack(fill_value=0)
    # Ensure all columns exist
    for col in ("gas", "electric", "oil", "lpg", "other"):
        if col not in agg.columns:
            agg[col] = 0

    agg["n"] = agg.sum(axis=1)
    agg = agg[agg["n"] >= MIN_PROPS]

    rows: list[dict] = []
    for (gx, gy), r in agg.iterrows():
        n = int(r["n"])
        rows.append({
            "gx": int(gx),
            "gy": int(gy),
            "n":  n,
            "pct_gas":      round(float(r.get("gas",      0)) / n * 100, 1),
            "pct_electric": round(float(r.get("electric", 0)) / n * 100, 1),
            "pct_oil":      round(float(r.get("oil",      0)) / n * 100, 1),
            "pct_lpg":      round(float(r.get("lpg",      0)) / n * 100, 1),
            "pct_other":    round(float(r.get("other",    0)) / n * 100, 1),
        })
    return rows


def build_age_cells(snapped: pd.DataFrame) -> list[dict]:
    df = snapped.copy()
    df["start_year"] = df["CONSTRUCTION_AGE_BAND"].map(parse_age_band_start_year)
    df["age_group"]  = df["start_year"].map(classify_age_band)

    # Drop rows with unknown age band
    df = df[df["age_group"].notna()]

    agg = df.groupby(["gx", "gy", "age_group"]).size().unstack(fill_value=0)
    for col in ("pre1900", "1900_1950", "1950_1980", "1980_2000", "post2000"):
        if col not in agg.columns:
            agg[col] = 0

    agg["n"] = agg.sum(axis=1)
    agg = agg[agg["n"] >= MIN_PROPS]

    rows: list[dict] = []
    for (gx, gy), r in agg.iterrows():
        n = int(r["n"])
        rows.append({
            "gx": int(gx),
            "gy": int(gy),
            "n":  n,
            "pct_pre1900":   round(float(r.get("pre1900",   0)) / n * 100, 1),
            "pct_1900_1950": round(float(r.get("1900_1950", 0)) / n * 100, 1),
            "pct_1950_1980": round(float(r.get("1950_1980", 0)) / n * 100, 1),
            "pct_1980_2000": round(float(r.get("1980_2000", 0)) / n * 100, 1),
            "pct_post2000":  round(float(r.get("post2000",  0)) / n * 100, 1),
        })
    return rows


# ── Main ───────────────────────────────────────────────────────────────────────

def main(epc_path: Path, onspd_path: Path, output_dir: Path) -> None:
    ensure_pipeline_dirs()
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading ONSPD: {onspd_path}")
    onspd = load_onspd(onspd_path)
    print(f"  ONSPD postcodes: {len(onspd):,}")

    print(f"\nLoading EPC enriched: {epc_path}")
    epc = load_epc_enriched(epc_path)

    # Join to ONSPD for coordinates — done once, then snapped per grid size
    epc_geo = epc.merge(onspd, on="postcode_key", how="inner")
    print(f"  Rows with coordinates: {len(epc_geo):,}")

    for grid_label, grid_m in GRID_SIZES:
        print(f"\n── {grid_label} ──────────────────────────────────────────────")

        snapped = epc_geo.copy()
        snapped["gx"] = ((snapped["east"]  // grid_m) * grid_m).astype("int64")
        snapped["gy"] = ((snapped["north"] // grid_m) * grid_m).astype("int64")

        # ── Fuel cells ────────────────────────────────────────────────────────
        fuel_rows = build_fuel_cells(snapped)
        fuel_path = output_dir / MODEL_EPC_FUEL_CELLS_TEMPLATE.name.replace("{grid}", grid_label)
        with gzip.open(fuel_path, "wt", encoding="utf-8") as f:
            json.dump(fuel_rows, f, separators=(",", ":"))
        print(f"  Fuel cells : {len(fuel_rows):>6,}  →  {fuel_path.name}  ({fuel_path.stat().st_size // 1024:,} KB)")

        # ── Age cells ─────────────────────────────────────────────────────────
        age_rows = build_age_cells(snapped)
        age_path = output_dir / MODEL_EPC_AGE_CELLS_TEMPLATE.name.replace("{grid}", grid_label)
        with gzip.open(age_path, "wt", encoding="utf-8") as f:
            json.dump(age_rows, f, separators=(",", ":"))
        print(f"  Age cells  : {len(age_rows):>6,}  →  {age_path.name}  ({age_path.stat().st_size // 1024:,} KB)")

    print("\nDone.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build per-cell EPC fuel & age aggregates")
    parser.add_argument("--epc",    default=str(DEFAULT_EPC),   help="Path to epc_enriched_all.csv.gz")
    parser.add_argument("--onspd",  default=str(DEFAULT_ONSPD), help="Path to ONSPD CSV")
    parser.add_argument("--output", default=str(MODEL_EPC_FUEL_CELLS_TEMPLATE.parent),
                        help="Output directory (default: pipeline/data/model/epc)")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    main(Path(args.epc), Path(args.onspd), Path(args.output))

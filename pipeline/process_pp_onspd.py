"""
Stream-processing script to filter Land Registry PPD and ONSPD postcode centroids
- Writes filtered PPD chunks to `data/pp_filtered/pp_filtered_*.parquet`
- Writes postcode list to `data/pp_postcodes.txt`
- Writes filtered ONSPD chunks to `data/ONSPD_filtered_*.parquet`

Run from repo root:
    python pipeline/process_pp_onspd.py

"""
from pathlib import Path
import pandas as pd
import gc

ROOT = Path.cwd()
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

PP_PATH = DATA / "pp-2025.txt"
ONSPD_PATH = DATA / "ONSPD_Online_latest_Postcode_Centroids_.csv"

# PPD schema (we only read a subset)
ALL_COLS = [
    "transaction_id", "price", "date", "postcode",
    "property_type", "new_build", "tenure",
    "paon", "saon", "street", "locality", "town_city",
    "district", "county", "ppd_category", "record_status"
]
USECOLS = ["transaction_id", "price", "date", "postcode", "property_type", "new_build", "record_status"]

# Keep last N years
YEARS_BACK = 5
CUTOFF = (pd.Timestamp.today().normalize() - pd.DateOffset(years=YEARS_BACK)).date()

OUT_PP_DIR = DATA / "pp_filtered"
OUT_PP_DIR.mkdir(exist_ok=True)
OUT_ONSPD_DIR = DATA

postcodes = set()

print(f"Processing PPD: {PP_PATH} -> {OUT_PP_DIR} (cutoff {CUTOFF})")
chunks_read = 0
chunks_kept = 0

for i, chunk in enumerate(pd.read_csv(
    PP_PATH,
    header=None,
    names=ALL_COLS,
    usecols=USECOLS,
    dtype={
        "transaction_id": "string",
        "postcode": "string",
        "property_type": "string",
        "new_build": "string",
        "record_status": "string",
        "price": "string",
    },
    chunksize=500_000,
)):
    chunks_read += 1
    # parse dates
    chunk["date"] = pd.to_datetime(chunk["date"], errors="coerce")
    chunk = chunk[chunk["date"].notna()]
    # keep only "A" records
    chunk = chunk[chunk["record_status"] == "A"]
    # last N years
    chunk = chunk[chunk["date"].dt.date >= CUTOFF]

    if chunk.empty:
        del chunk
        gc.collect()
        continue

    # normalize postcode (remove spaces, upper-case)
    chunk["postcode"] = chunk["postcode"].str.replace(r"\s+", "", regex=True).str.upper()

    # convert to efficient dtypes
    for c in ["property_type", "new_build", "record_status"]:
        chunk[c] = chunk[c].astype("category")

    # price to numeric then downcast
    chunk["price"] = pd.to_numeric(chunk["price"], errors="coerce")
    if chunk["price"].notna().all():
        chunk["price"] = chunk["price"].astype("int32")
    else:
        chunk["price"] = chunk["price"].astype("Float32")

    # month column for downstream grouping
    chunk["month"] = chunk["date"].dt.to_period("M").dt.to_timestamp()

    out_path = OUT_PP_DIR / f"pp_filtered_{i:04d}.parquet"
    chunk.to_parquet(out_path, index=False)

    # collect unique postcodes (keeps memory modest relative to full rows)
    postcodes.update(chunk["postcode"].dropna().unique().tolist())

    chunks_kept += len(list(out_path.read_bytes())) if out_path.exists() else 0
    print(f"Chunk {i}: kept {len(postcodes)} unique postcodes so far; wrote {out_path.name}")

    del chunk
    gc.collect()

# Save postcodes to file
pc_path = DATA / "pp_postcodes.txt"
with pc_path.open("w", encoding="utf-8") as f:
    for p in sorted(postcodes):
        f.write(p + "\n")

print(f"PP processing done. {len(postcodes)} unique postcodes saved to {pc_path}")

# Now filter ONSPD by postcode list
if not ONSPD_PATH.exists():
    print(f"ONSPD file {ONSPD_PATH} not found; skipping ONSPD filtering.")
else:
    print(f"Filtering ONSPD: {ONSPD_PATH} using {pc_path}")
    with pc_path.open("r", encoding="utf-8") as f:
        keep_postcodes = set([l.strip().upper() for l in f if l.strip()])

    cols = ["x","y","PCD7","PCD8","PCDS","DOINTR","DOTERM","EAST1M","NORTH1M"]

    for i, chunk in enumerate(pd.read_csv(
        ONSPD_PATH,
        names=cols,
        header=None,
        usecols=["PCD7","EAST1M","NORTH1M"],
        skiprows=1,
        dtype={"PCD7":"string","EAST1M":"string","NORTH1M":"string"},
        chunksize=500_000,
    )):
        # normalize
        chunk["PCD7"] = chunk["PCD7"].str.replace(r"\s+", "", regex=True).str.upper()
        mask = chunk["PCD7"].isin(keep_postcodes)
        chunk = chunk[mask]
        if chunk.empty:
            del chunk
            gc.collect()
            continue

        # numeric coords
        chunk["EAST1M"] = pd.to_numeric(chunk["EAST1M"], errors="coerce").astype("Float32")
        chunk["NORTH1M"] = pd.to_numeric(chunk["NORTH1M"], errors="coerce").astype("Float32")

        # rename
        chunk = chunk.rename(columns={"PCD7": "postcode", "EAST1M": "east", "NORTH1M": "north"})

        out_path = OUT_ONSPD_DIR / f"ONSPD_filtered_{i:03d}.parquet"
        chunk.to_parquet(out_path, index=False)
        print(f"ONSPD chunk {i}: wrote {out_path.name} ({len(chunk)} rows)")

        del chunk
        gc.collect()

    print("ONSPD filtering done.")

print("All done.")

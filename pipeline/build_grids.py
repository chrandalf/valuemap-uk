# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:49:19.907578Z","iopub.execute_input":"2026-02-05T10:49:19.907948Z","iopub.status.idle":"2026-02-05T10:50:48.185928Z","shell.execute_reply.started":"2026-02-05T10:49:19.907915Z","shell.execute_reply":"2026-02-05T10:50:48.184898Z"},"jupyter":{"outputs_hidden":false}}
import os, time, requests, gc
from pathlib import Path
URL = "http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-complete.txt"
##URL = "https://s3.eu-west-1.amazonaws.com/prod1.publicdata.landregistry.gov.uk/pp-2025.txt"
OUT = "pp-2025.txt"

def download_resume(url, out_path, retries=20, chunk_size=1024*1024):
    s = requests.Session()
    headers = {"User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity"}
    downloaded = os.path.getsize(out_path) if os.path.exists(out_path) else 0

    for attempt in range(1, retries + 1):
        try:
            h = headers.copy()
            if downloaded:
                h["Range"] = f"bytes={downloaded}-"

            with s.get(url, stream=True, headers=h, timeout=(30, 300)) as r:
                if r.status_code == 416:
                    print("Already complete.")
                    return
                r.raise_for_status()

                mode = "ab" if downloaded else "wb"
                with open(out_path, mode) as f:
                    last = time.time()
                    for chunk in r.iter_content(chunk_size=chunk_size):
                        if not chunk:
                            continue
                        f.write(chunk)
                        downloaded += len(chunk)
                        if time.time() - last > 2:
                            print(f"\rDownloaded {downloaded/1e6:,.1f} MB", end="")
                            last = time.time()

            print(f"\nDone: {out_path}")
            return

        except (requests.Timeout, requests.ConnectionError) as e:
            wait = min(2 ** attempt, 60)
            print(f"\nAttempt {attempt} failed: {e} | retrying in {wait}s (resume at {downloaded/1e6:,.1f} MB)")
            time.sleep(wait)

    raise RuntimeError("Failed after retries")

download_resume(URL, OUT)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:50:51.934082Z","iopub.execute_input":"2026-02-05T10:50:51.935138Z","iopub.status.idle":"2026-02-05T10:50:51.940571Z","shell.execute_reply.started":"2026-02-05T10:50:51.935069Z","shell.execute_reply":"2026-02-05T10:50:51.939318Z"},"jupyter":{"outputs_hidden":false}}
import os
print(os.getcwd())
print(os.listdir(".")[:50])

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:50:54.268660Z","iopub.execute_input":"2026-02-05T10:50:54.269024Z","iopub.status.idle":"2026-02-05T10:50:54.284631Z","shell.execute_reply.started":"2026-02-05T10:50:54.268993Z","shell.execute_reply":"2026-02-05T10:50:54.283592Z"},"jupyter":{"outputs_hidden":false}}
import os

for d in os.listdir("/kaggle/input"):
    p = f"/kaggle/input/{d}"
    print("\n==", p)
    print(os.listdir(p)[:50])

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:50:57.588431Z","iopub.execute_input":"2026-02-05T10:50:57.588884Z","iopub.status.idle":"2026-02-05T10:52:45.438082Z","shell.execute_reply.started":"2026-02-05T10:50:57.588842Z","shell.execute_reply":"2026-02-05T10:52:45.437166Z"},"jupyter":{"outputs_hidden":false}}
import pandas as pd

def resolve_pp_path() -> str:
    script_path = Path(__file__).resolve()
    repo_root = script_path.parent.parent
    candidates = [
        repo_root / "pipeline" / "data" / "pp-2025.txt",
        repo_root / "data" / "pp-2025.txt",
        Path("/kaggle/working/pp-2025.txt"),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    raise FileNotFoundError("pp-2025.txt not found in pipeline/data, data, or /kaggle/working")

path = resolve_pp_path()
print("Using transactions file:", path)
OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Full PPD schema (16 columns)
all_cols = [
    "transaction_id", "price", "date", "postcode",
    "property_type", "new_build", "tenure",
    "paon", "saon", "street", "locality", "town_city",
    "district", "county", "ppd_category", "record_status"
]

usecols = ["price", "date", "postcode", "property_type", "new_build", "record_status"]

cutoff = (pd.Timestamp.today().normalize() - pd.DateOffset(years=5)).date()

chunks = []
for chunk in pd.read_csv(
    path,
    header=None,
    names=all_cols,
    usecols=usecols,
    dtype={
        "postcode": "string",
        "property_type": "string",
        "new_build": "string",
        "record_status": "string",
    },
    chunksize=500_000
):
    # Parse dates for this chunk
    chunk["date"] = pd.to_datetime(chunk["date"], errors="coerce")
    chunk = chunk[chunk["date"].notna()]

    # Keep only "A" records (usual rule)
    chunk = chunk[chunk["record_status"] == "A"]

    # Last 5 years
    chunk = chunk[chunk["date"].dt.date >= cutoff]

    # Keep only columns needed downstream and compress dtypes early
    chunk["pc_key"] = chunk["postcode"].astype("string").str.replace(" ", "", regex=False).str.upper()
    chunk["month"] = chunk["date"].dt.to_period("M").dt.to_timestamp()
    chunk["price"] = pd.to_numeric(chunk["price"], errors="coerce", downcast="integer")
    chunk["property_type"] = chunk["property_type"].astype("category")
    chunk["new_build"] = chunk["new_build"].astype("category")
    chunk = chunk[["price", "date", "month", "pc_key", "property_type", "new_build"]]

    chunks.append(chunk)

df = pd.concat(chunks, ignore_index=True)

print("Rows kept:", len(df))
print("Date range:", df["date"].min().date(), "->", df["date"].max().date())

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:52:54.027700Z","iopub.execute_input":"2026-02-05T10:52:54.028070Z","iopub.status.idle":"2026-02-05T10:52:54.065845Z","shell.execute_reply.started":"2026-02-05T10:52:54.028038Z","shell.execute_reply":"2026-02-05T10:52:54.064824Z"},"jupyter":{"outputs_hidden":false}}
df.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:52:58.354160Z","iopub.execute_input":"2026-02-05T10:52:58.354625Z","iopub.status.idle":"2026-02-05T10:53:27.601785Z","shell.execute_reply.started":"2026-02-05T10:52:58.354582Z","shell.execute_reply":"2026-02-05T10:53:27.600843Z"},"jupyter":{"outputs_hidden":false}}
import pandas as pd

def download_file(url: str, out_path: Path, chunk_size: int = 1024 * 1024):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=(30, 600)) as r:
        r.raise_for_status()
        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
    return out_path

def resolve_postcode_centroids_csv() -> str:
    """
    Resolve the postcode centroid CSV path for local/Codespaces/Kaggle runs.

    Resolution order:
    1) POSTCODE_CENTROIDS_CSV env var (local file path)
    2) Existing local files in common locations
    3) Legacy Kaggle path
    4) Download from POSTCODE_CENTROIDS_URL env var into ./data/
    """
    script_path = Path(__file__).resolve()
    repo_root = script_path.parent.parent
    preferred_path = repo_root / "pipeline" / "data" / "ONSPD_Online_latest_Postcode_Centroids_.csv"

    # Sanity check: ensure we are in the expected project root
    if not (repo_root / "package.json").exists():
        raise FileNotFoundError(f"Unexpected project root: {repo_root} (package.json missing)")

    env_csv = os.getenv("POSTCODE_CENTROIDS_CSV")
    if env_csv:
        p = Path(env_csv)
        if not p.is_absolute():
            p = (repo_root / p).resolve()
        if p.exists():
            return str(p)

    candidates = [
        preferred_path,
        repo_root / "data" / "ONSPD_Online_latest_Postcode_Centroids_.csv",
        Path("/kaggle/input/postcode-eastnorth/ONSPD_Online_latest_Postcode_Centroids_.csv"),
    ]
    for p in candidates:
        if p.exists():
            return str(p)

    url = os.getenv("POSTCODE_CENTROIDS_URL")
    if url:
        print(f"Downloading postcode centroids from {url} -> {preferred_path}")
        download_file(url, preferred_path)
        return str(preferred_path)

    raise FileNotFoundError(
        "Postcode centroid CSV not found. "
        "Set POSTCODE_CENTROIDS_CSV to a local file or POSTCODE_CENTROIDS_URL to download it."
    )

path_east_north = resolve_postcode_centroids_csv()
print("Using postcode centroid CSV:", path_east_north)

cols = ["x", "y", "PCDS"]

df_en = pd.read_csv(
    path_east_north,    
    names=cols,
    header=None,
    usecols=cols,
    skiprows=1,
    dtype={
        "x": "string",
        "y": "string",
        "PCDS": "string",
    }
)

df_en.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:53:34.617969Z","iopub.execute_input":"2026-02-05T10:53:34.618348Z","iopub.status.idle":"2026-02-05T10:53:39.846574Z","shell.execute_reply.started":"2026-02-05T10:53:34.618316Z","shell.execute_reply":"2026-02-05T10:53:39.845526Z"},"jupyter":{"outputs_hidden":false}}
df_en["EAST1M"]  = pd.to_numeric(df_en["x"], errors="coerce")
df_en["NORTH1M"] = pd.to_numeric(df_en["y"], errors="coerce")

df_en = df_en.dropna(subset=["EAST1M","NORTH1M"]).copy()
df_en["EAST1M"] = df_en["EAST1M"].astype("float32")
df_en["NORTH1M"] = df_en["NORTH1M"].astype("float32")

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:53:42.914982Z","iopub.execute_input":"2026-02-05T10:53:42.915985Z","iopub.status.idle":"2026-02-05T10:53:54.002896Z","shell.execute_reply.started":"2026-02-05T10:53:42.915945Z","shell.execute_reply":"2026-02-05T10:53:54.001864Z"},"jupyter":{"outputs_hidden":false}}
GRID_SIZES = [1000, 5000, 10000, 25000]  # metres

for g in GRID_SIZES:
    df_en[f"gx_{g}"] = (df_en["EAST1M"] // g) * g
    df_en[f"gy_{g}"] = (df_en["NORTH1M"] // g) * g
    df_en[f"cell_{g}"] = (
        df_en[f"gx_{g}"].astype("Int64").astype(str) + "_" +
        df_en[f"gy_{g}"].astype("Int64").astype(str)
    )

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:54:15.147009Z","iopub.execute_input":"2026-02-05T10:54:15.148560Z","iopub.status.idle":"2026-02-05T10:54:15.879243Z","shell.execute_reply.started":"2026-02-05T10:54:15.148512Z","shell.execute_reply":"2026-02-05T10:54:15.878036Z"},"jupyter":{"outputs_hidden":false}}
# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:54:20.620829Z","iopub.execute_input":"2026-02-05T10:54:20.621231Z","iopub.status.idle":"2026-02-05T10:54:20.626788Z","shell.execute_reply.started":"2026-02-05T10:54:20.621200Z","shell.execute_reply":"2026-02-05T10:54:20.625764Z"},"jupyter":{"outputs_hidden":false}}
print("1km:",  df_en[["gx_1000", "gy_1000"]].drop_duplicates().shape[0])
print("5km:",  df_en[["gx_5000", "gy_5000"]].drop_duplicates().shape[0])
print("10km:", df_en[["gx_10000", "gy_10000"]].drop_duplicates().shape[0])
print("25km:", df_en[["gx_25000", "gy_25000"]].drop_duplicates().shape[0])

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:54:23.694576Z","iopub.execute_input":"2026-02-05T10:54:23.694900Z","iopub.status.idle":"2026-02-05T10:54:27.954634Z","shell.execute_reply.started":"2026-02-05T10:54:23.694871Z","shell.execute_reply":"2026-02-05T10:54:27.953561Z"},"jupyter":{"outputs_hidden":false}}
df_en["pc_key"] = df_en["PCDS"].astype("string").str.replace(" ", "", regex=False).str.upper()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T06:18:15.431091Z","iopub.execute_input":"2026-02-05T06:18:15.431501Z","iopub.status.idle":"2026-02-05T06:18:15.666443Z","shell.execute_reply.started":"2026-02-05T06:18:15.431466Z","shell.execute_reply":"2026-02-05T06:18:15.664087Z"},"jupyter":{"outputs_hidden":false}}
df_en.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:54:32.892196Z","iopub.execute_input":"2026-02-05T10:54:32.892609Z","iopub.status.idle":"2026-02-05T10:54:45.637849Z","shell.execute_reply.started":"2026-02-05T10:54:32.892571Z","shell.execute_reply":"2026-02-05T10:54:45.636488Z"},"jupyter":{"outputs_hidden":false}}
for g in [1000, 5000, 10000, 25000]:
    df_en[f"gx_{g}"] = ((df_en["EAST1M"] // g) * g).astype("int64")
    df_en[f"gy_{g}"] = ((df_en["NORTH1M"] // g) * g).astype("int64")
    df_en[f"cell_{g}"] = df_en[f"gx_{g}"].astype(str) + "_" + df_en[f"gy_{g}"].astype(str)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:54:52.021894Z","iopub.execute_input":"2026-02-05T10:54:52.022262Z","iopub.status.idle":"2026-02-05T10:55:04.310953Z","shell.execute_reply.started":"2026-02-05T10:54:52.022232Z","shell.execute_reply":"2026-02-05T10:55:04.309943Z"},"jupyter":{"outputs_hidden":false}}
lookup_cols = [
    "pc_key",
    "EAST1M", "NORTH1M",
    "gx_1000", "gy_1000", "cell_1000",
    "gx_5000", "gy_5000", "cell_5000",
    "gx_10000", "gy_10000", "cell_10000",
    "gx_25000", "gy_25000", "cell_25000",
]

lookup = df_en[lookup_cols].drop_duplicates("pc_key")

to_drop = [c for c in lookup_cols if c in df.columns and c != "pc_key"]
df = df.drop(columns=to_drop)

df = df.merge(lookup, on="pc_key", how="left")

# Release large lookup frames as soon as merge is done
del lookup
gc.collect()

# --- Postcode area (outcode) -> grid cell lookup tables (for UI drilldown) ---
# Keep only the outcode (part before the space) to reduce size.
postcode_lookup = df_en[[
    "PCDS",
    "cell_1000", "cell_5000", "cell_10000", "cell_25000",
]].copy()
postcode_lookup["outcode"] = (
    postcode_lookup["PCDS"].astype("string").str.strip().str.split(" ", n=1).str[0].str.upper()
)
postcode_lookup = postcode_lookup.dropna(subset=["outcode"]).drop_duplicates(
    ["outcode", "cell_1000", "cell_5000", "cell_10000", "cell_25000"]
)

# Save as parquet (compact, fast) and JSON (portable)
postcode_lookup_out_parquet = str(OUTPUT_DIR / "postcode_grid_outcode_lookup.parquet")
postcode_lookup_out_json = str(OUTPUT_DIR / "postcode_grid_outcode_lookup.json.gz")

postcode_lookup.to_parquet(postcode_lookup_out_parquet, index=False)

import json, gzip
with gzip.open(postcode_lookup_out_json, "wt", encoding="utf-8") as f:
    json.dump(postcode_lookup.where(pd.notnull(postcode_lookup), None).to_dict(orient="records"), f)

print("Wrote postcode lookup:", postcode_lookup_out_parquet, "rows:", len(postcode_lookup))

# df_en is no longer needed after lookup generation + merge
del postcode_lookup
del df_en
gc.collect()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:55:07.731960Z","iopub.execute_input":"2026-02-05T10:55:07.732310Z","iopub.status.idle":"2026-02-05T10:55:08.037267Z","shell.execute_reply.started":"2026-02-05T10:55:07.732280Z","shell.execute_reply":"2026-02-05T10:55:08.036215Z"},"jupyter":{"outputs_hidden":false}}
df[["pc_key", "EAST1M", "NORTH1M", "gx_25000", "gy_25000", "cell_25000"]].head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:55:11.495841Z","iopub.execute_input":"2026-02-05T10:55:11.496227Z","iopub.status.idle":"2026-02-05T10:55:12.844804Z","shell.execute_reply.started":"2026-02-05T10:55:11.496196Z","shell.execute_reply":"2026-02-05T10:55:12.843521Z"},"jupyter":{"outputs_hidden":false}}
# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:55:15.603005Z","iopub.execute_input":"2026-02-05T10:55:15.603394Z","iopub.status.idle":"2026-02-05T10:55:20.349462Z","shell.execute_reply.started":"2026-02-05T10:55:15.603364Z","shell.execute_reply":"2026-02-05T10:55:20.348451Z"},"jupyter":{"outputs_hidden":false}}
latest_month = df["month"].max()
# Keep only last 10 years (inclusive, aligned to month)
cutoff_month = (latest_month - pd.DateOffset(years=10)).to_period("M").to_timestamp()
df = df[df["month"] >= cutoff_month].copy()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:55:26.523449Z","iopub.execute_input":"2026-02-05T10:55:26.523802Z","iopub.status.idle":"2026-02-05T10:55:26.538891Z","shell.execute_reply.started":"2026-02-05T10:55:26.523771Z","shell.execute_reply":"2026-02-05T10:55:26.537874Z"},"jupyter":{"outputs_hidden":false}}
import pandas as pd

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
    """
    Returns ONE dataframe containing 4 levels:
      - TYPE+BUILD
      - TYPE+ALL
      - ALL+BUILD
      - ALL+ALL
    All use true medians (transaction-level) over trailing 12 months.
    """
    gx, gy = f"gx_{g}", f"gy_{g}"

    d = df.dropna(subset=[gx, gy]).copy()
    d["month"] = pd.to_datetime(d["month"]).dt.to_period("M").dt.to_timestamp()

    end_months = _yearly_end_months(d["month"], years_back=years_back)

    parts = []
    for end_month in end_months:
        start_month = (end_month - pd.DateOffset(months=11)).to_period("M").to_timestamp()
        w = d[(d["month"] >= start_month) & (d["month"] <= end_month)]

        # 1) TYPE + BUILD
        a = (w.groupby([gx, gy, "property_type", "new_build"], as_index=False)
               .agg(median_price_12m=("price", "median"),
                    sales_12m=("price", "size")))
        a["end_month"] = end_month
        parts.append(a)

        # 2) TYPE + ALL_BUILD
        b = (w.groupby([gx, gy, "property_type"], as_index=False)
               .agg(median_price_12m=("price", "median"),
                    sales_12m=("price", "size")))
        b["end_month"] = end_month
        b["new_build"] = "ALL"
        parts.append(b)

        # 3) ALL_TYPE + BUILD
        c = (w.groupby([gx, gy, "new_build"], as_index=False)
               .agg(median_price_12m=("price", "median"),
                    sales_12m=("price", "size")))
        c["end_month"] = end_month
        c["property_type"] = "ALL"
        parts.append(c)

        # 4) ALL_TYPE + ALL_BUILD
        d_all = (w.groupby([gx, gy], as_index=False)
                   .agg(median_price_12m=("price", "median"),
                        sales_12m=("price", "size")))
        d_all["end_month"] = end_month
        d_all["property_type"] = "ALL"
        d_all["new_build"] = "ALL"
        parts.append(d_all)

        print("done:", end_month.date(), "| window rows:", len(w))

    out = pd.concat(parts, ignore_index=True)

    # tidy
    out["end_month"] = pd.to_datetime(out["end_month"]).dt.to_period("M").dt.to_timestamp()
    out["property_type"] = out["property_type"].astype(str)
    out["new_build"] = out["new_build"].astype(str)

    if min_sales > 1:
        out = out[out["sales_12m"] >= min_sales].copy()

    return out

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:55:32.777391Z","iopub.execute_input":"2026-02-05T10:55:32.777811Z","iopub.status.idle":"2026-02-05T10:55:44.224520Z","shell.execute_reply.started":"2026-02-05T10:55:32.777777Z","shell.execute_reply":"2026-02-05T10:55:44.223589Z"},"jupyter":{"outputs_hidden":false}}
grid_25km_annual = make_grid_annual_stack_levels(
    df,
    g=25000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:55:50.349854Z","iopub.execute_input":"2026-02-05T10:55:50.350187Z","iopub.status.idle":"2026-02-05T10:56:01.955021Z","shell.execute_reply.started":"2026-02-05T10:55:50.350161Z","shell.execute_reply":"2026-02-05T10:56:01.954066Z"},"jupyter":{"outputs_hidden":false}}
grid_10km_annual = make_grid_annual_stack_levels(
    df,
    g=10000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:56:05.925574Z","iopub.execute_input":"2026-02-05T10:56:05.925903Z","iopub.status.idle":"2026-02-05T10:56:21.921453Z","shell.execute_reply.started":"2026-02-05T10:56:05.925875Z","shell.execute_reply":"2026-02-05T10:56:21.919843Z"},"jupyter":{"outputs_hidden":false}}
grid_5km_annual = make_grid_annual_stack_levels(
    df,
    g=5000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T11:38:31.184865Z","iopub.execute_input":"2026-02-05T11:38:31.189664Z","iopub.status.idle":"2026-02-05T11:38:44.470826Z","shell.execute_reply.started":"2026-02-05T11:38:31.189576Z","shell.execute_reply":"2026-02-05T11:38:44.469449Z"},"jupyter":{"outputs_hidden":false}}
grid_1km_annual = make_grid_annual_stack_levels(
    df,
    g=1000,
    min_sales=3,
    years_back=1   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T11:38:52.539283Z","iopub.execute_input":"2026-02-05T11:38:52.539963Z","iopub.status.idle":"2026-02-05T11:38:52.730436Z","shell.execute_reply.started":"2026-02-05T11:38:52.539929Z","shell.execute_reply":"2026-02-05T11:38:52.729134Z"},"jupyter":{"outputs_hidden":false}}
grid_1km_annual.to_parquet(str(OUTPUT_DIR / "grid_1km_annual.parquet"), index=False)
grid_5km_annual.to_parquet(str(OUTPUT_DIR / "grid_5km_annual.parquet"), index=False)
grid_10km_annual.to_parquet(str(OUTPUT_DIR / "grid_10km_annual.parquet"), index=False)
grid_25km_annual.to_parquet(str(OUTPUT_DIR / "grid_25km_annual.parquet"), index=False)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:58:33.489386Z","iopub.execute_input":"2026-02-05T10:58:33.489774Z","iopub.status.idle":"2026-02-05T10:59:06.948154Z","shell.execute_reply.started":"2026-02-05T10:58:33.489744Z","shell.execute_reply":"2026-02-05T10:59:06.946920Z"}}
import pandas as pd, json, gzip

d = grid_1km_annual.copy()

g = 1000
d = d.rename(columns={
    f"gx_{g}": "gx",
    f"gy_{g}": "gy",
    "median_price_12m": "median",
    "sales_12m": "tx_count",
})

# Normalize end_month to ISO format (YYYY-MM-DD) required for API filtering
d["end_month"] = pd.to_datetime(d["end_month"]).dt.strftime("%Y-%m-%d")

keep = ["gx","gy","end_month","property_type","new_build","median","tx_count"]
d = d[keep].dropna(subset=["gx","gy","median"]).copy()

out_path = str(OUTPUT_DIR / "grid_1km_full.json.gz")
with gzip.open(out_path, "wt", encoding="utf-8") as f:
    # JSON array (easy to parse/cached in worker)
    json.dump(d.to_dict(orient="records"), f)

print("Wrote:", out_path, "rows:", len(d))

# Extract and store metadata: available date ranges for each dataset
grid_metadata = {}
for grid_size, grid_annual in [
    (1000, grid_1km_annual),
    (5000, grid_5km_annual),
    (10000, grid_10km_annual),
    (25000, grid_25km_annual),
]:
    grid_label = f"{grid_size // 1000}km"
    earliest = pd.to_datetime(grid_annual["end_month"].min()).strftime("%Y-%m-%d")
    latest = pd.to_datetime(grid_annual["end_month"].max()).strftime("%Y-%m-%d")
    grid_metadata[grid_label] = {
        "earliest": earliest,
        "latest": latest,
        "available_months": int(grid_annual["end_month"].nunique())
    }

# Save metadata JSON
metadata_path = str(OUTPUT_DIR / "grid_metadata.json")
with open(metadata_path, "w") as f:
    json.dump(grid_metadata, f, indent=2)

print(f"\nGrid availability metadata:")
print(json.dumps(grid_metadata, indent=2))
print(f"Saved to {metadata_path}")


# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:59:19.568087Z","iopub.execute_input":"2026-02-05T10:59:19.568536Z","iopub.status.idle":"2026-02-05T10:59:22.362539Z","shell.execute_reply.started":"2026-02-05T10:59:19.568502Z","shell.execute_reply":"2026-02-05T10:59:22.361516Z"},"jupyter":{"outputs_hidden":false}}
g = 25000

start_month = pd.Timestamp("2025-01-01")
end_month   = pd.Timestamp("2025-12-01")

count = df[
    (df[f"gx_{g}"] == 500000) &
    (df[f"gy_{g}"] == 200000) &
    (df["property_type"] == "D") &
    (df["new_build"] == "Y") &
    (pd.to_datetime(df["month"]).dt.to_period("M").dt.to_timestamp() >= start_month) &
    (pd.to_datetime(df["month"]).dt.to_period("M").dt.to_timestamp() <= end_month)
].shape[0]

count

# %% [code] {"jupyter":{"outputs_hidden":false}}
(grid_25km_annual["property_type"].eq("ALL") & grid_25km_annual["new_build"].eq("ALL")).any()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:59:27.946071Z","iopub.execute_input":"2026-02-05T10:59:27.946456Z","iopub.status.idle":"2026-02-05T10:59:27.968472Z","shell.execute_reply.started":"2026-02-05T10:59:27.946426Z","shell.execute_reply":"2026-02-05T10:59:27.967260Z"},"jupyter":{"outputs_hidden":false}}
g = 25000

row = grid_25km_annual[
    (grid_25km_annual[f"gx_{g}"] == 500000) &
    (grid_25km_annual[f"gy_{g}"] == 200000) &
    (grid_25km_annual["property_type"] == "D") &
    (grid_25km_annual["new_build"] == "ALL") 
]

row.sort_values(by='sales_12m' , ascending=False)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:59:32.911333Z","iopub.execute_input":"2026-02-05T10:59:32.912331Z","iopub.status.idle":"2026-02-05T10:59:37.368910Z","shell.execute_reply.started":"2026-02-05T10:59:32.912295Z","shell.execute_reply":"2026-02-05T10:59:37.367632Z"},"jupyter":{"outputs_hidden":false}}
import pandas as pd
import numpy as np
from pyproj import Transformer
import plotly.express as px
import plotly.io as pio

pio.renderers.default = "iframe"
TRANSFORMER = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)

colorscale = "RdYlGn_r"
lo = 200_000
hi = 1_000_000

def plot_annual_grid_map(
    grid_annual: pd.DataFrame,
    g: int,
    end_month=None,
    property_type: str = "ALL",
    new_build: str = "ALL",
    min_sales: int = 3,
    use_tiles: bool = True,
    zoom: float = 4.6,
    opacity: float = 0.45,
    fill_gaps: bool = True,
    lookback_years: int = 10
):
    def norm_month_series(s: pd.Series) -> pd.Series:
        return pd.to_datetime(s.astype(str)).dt.to_period("M").dt.to_timestamp()

    def norm_month_value(v) -> pd.Timestamp:
        return pd.to_datetime(str(v)).to_period("M").to_timestamp()

    gx_col = f"gx_{g}"
    gy_col = f"gy_{g}"
    cell_col = f"cell_{g}"

    d = grid_annual.copy()
    d["end_month"] = norm_month_series(d["end_month"])

    if end_month is None:
        end_month = d["end_month"].max()
    else:
        end_month = norm_month_value(end_month)

    # Filter to segment first (required)
    d = d[(d["property_type"] == property_type) & (d["new_build"] == new_build)].copy()
    if d.empty:
        raise ValueError("No rows after filtering property_type/new_build. Check your stacked levels exist.")

    # Standardize columns
    d = d.rename(columns={"median_price_12m": "median_price", "sales_12m": "sales"})

    # Restrict to eligible backfill window
    min_allowed = norm_month_value(end_month - pd.DateOffset(years=lookback_years))
    d = d[(d["end_month"] <= end_month) & (d["end_month"] >= min_allowed)].copy()

    if fill_gaps:
        d = (
            d.sort_values("end_month", ascending=False)
             .drop_duplicates(subset=[gx_col, gy_col], keep="first")
             .copy()
        )
        d["end_month_used"] = d["end_month"]
    else:
        d = d[d["end_month"] == end_month].copy()
        d["end_month_used"] = d["end_month"]

    if d.empty:
        raise ValueError("No rows left after applying end_month / backfill window.")

    # Sales threshold
    d = d[d["sales"] >= min_sales].copy()
    if d.empty:
        raise ValueError("No rows meet min_sales after filtering/backfill.")

    d["years_stale"] = (end_month.year - d["end_month_used"].map(lambda t: t.year)).astype(int)

    # Cell id
    d[cell_col] = d[gx_col].astype("int64").astype(str) + "_" + d[gy_col].astype("int64").astype(str)

    # Build GeoJSON squares
    x0 = d[gx_col].astype(float).to_numpy()
    y0 = d[gy_col].astype(float).to_numpy()
    x1 = x0 + g
    y1 = y0 + g

    lon00, lat00 = TRANSFORMER.transform(x0, y0)
    lon10, lat10 = TRANSFORMER.transform(x1, y0)
    lon11, lat11 = TRANSFORMER.transform(x1, y1)
    lon01, lat01 = TRANSFORMER.transform(x0, y1)

    lon_min, lon_max = -10.5, 4.5
    lat_min, lat_max = 49.0, 62.5
    ok = (
        (lon00 >= lon_min) & (lon00 <= lon_max) & (lat00 >= lat_min) & (lat00 <= lat_max) &
        (lon10 >= lon_min) & (lon10 <= lon_max) & (lat10 >= lat_min) & (lat10 <= lat_max) &
        (lon11 >= lon_min) & (lon11 <= lon_max) & (lat11 >= lat_min) & (lat11 <= lat_max) &
        (lon01 >= lon_min) & (lon01 <= lon_max) & (lat01 >= lat_min) & (lat01 <= lat_max)
    )

    d = d.loc[ok].copy()
    if d.empty:
        raise ValueError("Nothing left after UK clipping (check gx/gy values).")

    idx = np.where(ok)[0]
    lon00, lat00 = lon00[idx], lat00[idx]
    lon10, lat10 = lon10[idx], lat10[idx]
    lon11, lat11 = lon11[idx], lat11[idx]
    lon01, lat01 = lon01[idx], lat01[idx]

    ids = d[cell_col].astype(str).to_numpy()

    features = []
    for i in range(len(d)):
        poly = [
            [lon00[i], lat00[i]],
            [lon10[i], lat10[i]],
            [lon11[i], lat11[i]],
            [lon01[i], lat01[i]],
            [lon00[i], lat00[i]],
        ]
        features.append({
            "type": "Feature",
            "id": ids[i],
            "properties": {"cell": ids[i]},
            "geometry": {"type": "Polygon", "coordinates": [poly]},
        })

    geojson = {"type": "FeatureCollection", "features": features}

    lo = float(d["median_price"].quantile(0.05))
    hi = float(d["median_price"].quantile(0.95))

    title = f"UK House Prices ({g//1000}km) — target {end_month.date()} — {property_type}/{new_build}"
    if fill_gaps:
        title += f" (backfilled ≤{lookback_years}y)"

    hover = {
        "median_price": ":,.0f",
        "sales": True,
        "end_month_used": True,
        "years_stale": True,
        "property_type": True,
        "new_build": True,
    }

    if use_tiles:
        fig = px.choropleth_mapbox(
            d,
            geojson=geojson,
            locations=cell_col,
            color="median_price",
            range_color=(lo, hi),
            color_continuous_scale=colorscale,
            hover_data=hover,
            mapbox_style="open-street-map",
            center={"lat": 54.5, "lon": -2.5},
            zoom=zoom,
            opacity=opacity,
            title=title
        )
    else:
        fig = px.choropleth(
            d,
            geojson=geojson,
            locations=cell_col,
            color="median_price",
            range_color=(lo, hi),
            hover_data=hover,
            title=title
        )
        fig.update_geos(fitbounds="locations", visible=False)

    fig.update_traces(marker_line_width=0.3)
    fig.update_layout(margin={"r": 0, "t": 55, "l": 0, "b": 0})
    fig.update_traces(marker_line_width=1.4, marker_line_color="rgba(0,0,0,0.7)")
    fig.show(renderer="iframe")

# %% [code] {"execution":{"iopub.status.busy":"2026-02-05T10:59:49.898611Z","iopub.execute_input":"2026-02-05T10:59:49.898978Z","iopub.status.idle":"2026-02-05T10:59:52.446480Z","shell.execute_reply.started":"2026-02-05T10:59:49.898950Z","shell.execute_reply":"2026-02-05T10:59:52.445385Z"},"jupyter":{"outputs_hidden":false}}
g = 25000
grid_annual = grid_25km_annual  # or grid_10km_annual / grid_5km_annual / grid_1km_annual

d_map = plot_annual_grid_map(
    grid_annual,
    g=g,
    end_month="2025-12-01",
    property_type="D",
    new_build="N",
    opacity=0.35,
    fill_gaps=True,
    lookback_years=10
)

# %% [code] {"jupyter":{"outputs_hidden":false}}
import pandas as pd
import numpy as np
import plotly.express as px

def build_delta_df(grid_annual: pd.DataFrame, g: int,
                   property_type: str = "ALL", new_build: str = "ALL",
                   min_sales: int = 3,
                   end_month_latest=None,
                   end_month_oldest=None) -> pd.DataFrame:
    gx_col = f"gx_{g}"
    gy_col = f"gy_{g}"
    cell_col = f"cell_{g}"

    d = grid_annual.copy()
    d["end_month"] = pd.to_datetime(d["end_month"].astype(str)).dt.to_period("M").dt.to_timestamp()

    # segment filter (must be explicit to avoid dupes)
    d = d[(d["property_type"] == property_type) & (d["new_build"] == new_build)].copy()
    if d.empty:
        raise ValueError("No rows for that property_type/new_build. (Do you have ALL/ALL stacked?)")

    d = d.rename(columns={"median_price_12m": "median_price", "sales_12m": "sales"})
    d = d[d["sales"] >= min_sales].copy()

    # choose snapshot months
    if end_month_latest is None:
        end_month_latest = d["end_month"].max()
    else:
        end_month_latest = pd.to_datetime(str(end_month_latest)).to_period("M").to_timestamp()

    if end_month_oldest is None:
        end_month_oldest = d["end_month"].min()
    else:
        end_month_oldest = pd.to_datetime(str(end_month_oldest)).to_period("M").to_timestamp()

    latest = d[d["end_month"] == end_month_latest].copy()
    oldest = d[d["end_month"] == end_month_oldest].copy()

    if latest.empty or oldest.empty:
        raise ValueError("Chosen end_month_latest/end_month_oldest not found for that segment.")

    keep = [gx_col, gy_col, "median_price", "sales"]
    latest = latest[keep].rename(columns={"median_price": "price_latest", "sales": "sales_latest"})
    oldest = oldest[keep].rename(columns={"median_price": "price_oldest", "sales": "sales_oldest"})

    out = latest.merge(oldest, on=[gx_col, gy_col], how="inner")

    out["delta_gbp"] = out["price_latest"] - out["price_oldest"]
    out["delta_pct"] = np.where(out["price_oldest"] > 0,
                                (out["price_latest"] / out["price_oldest"] - 1.0) * 100.0,
                                np.nan)

    out[cell_col] = out[gx_col].astype("int64").astype(str) + "_" + out[gy_col].astype("int64").astype(str)
    out["end_month_latest"] = end_month_latest
    out["end_month_oldest"] = end_month_oldest
    out["property_type"] = property_type
    out["new_build"] = new_build

    return out

# %% [code] {"jupyter":{"outputs_hidden":false}}
from pyproj import Transformer

TRANSFORMER = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)

def plot_delta_map(delta_df: pd.DataFrame, g: int,
                   metric: str = "delta_pct",  # "delta_pct" or "delta_gbp"
                   use_tiles: bool = True,
                   zoom: float = 4.6,
                   opacity: float = 0.45):
    gx_col = f"gx_{g}"
    gy_col = f"gy_{g}"
    cell_col = f"cell_{g}"

    d = delta_df.copy()

    # GeoJSON squares
    x0 = d[gx_col].astype(float).to_numpy()
    y0 = d[gy_col].astype(float).to_numpy()
    x1 = x0 + g
    y1 = y0 + g

    lon00, lat00 = TRANSFORMER.transform(x0, y0)
    lon10, lat10 = TRANSFORMER.transform(x1, y0)
    lon11, lat11 = TRANSFORMER.transform(x1, y1)
    lon01, lat01 = TRANSFORMER.transform(x0, y1)

    # UK-ish clip
    ok = (
        (lon00 >= -10.5) & (lon00 <= 4.5) & (lat00 >= 49.0) & (lat00 <= 62.5) &
        (lon10 >= -10.5) & (lon10 <= 4.5) & (lat10 >= 49.0) & (lat10 <= 62.5) &
        (lon11 >= -10.5) & (lon11 <= 4.5) & (lat11 >= 49.0) & (lat11 <= 62.5) &
        (lon01 >= -10.5) & (lon01 <= 4.5) & (lat01 >= 49.0) & (lat01 <= 62.5)
    )
    d = d.loc[ok].copy()
    idx = np.where(ok)[0]
    lon00, lat00 = lon00[idx], lat00[idx]
    lon10, lat10 = lon10[idx], lat10[idx]
    lon11, lat11 = lon11[idx], lat11[idx]
    lon01, lat01 = lon01[idx], lat01[idx]

    ids = d[cell_col].astype(str).to_numpy()
    features = []
    for i in range(len(d)):
        poly = [[lon00[i], lat00[i]],[lon10[i], lat10[i]],[lon11[i], lat11[i]],[lon01[i], lat01[i]],[lon00[i], lat00[i]]]
        features.append({"type":"Feature","id":ids[i],"properties":{"cell":ids[i]},
                         "geometry":{"type":"Polygon","coordinates":[poly]}})
    geojson = {"type":"FeatureCollection","features":features}

    end_latest = pd.to_datetime(d["end_month_latest"].iloc[0]).date()
    end_oldest = pd.to_datetime(d["end_month_oldest"].iloc[0]).date()
    seg = f"{d['property_type'].iloc[0]}/{d['new_build'].iloc[0]}"

    # Diverging colour scale for deltas
    colorscale = "RdBu"  # red=negative, blue=positive by default
    if metric == "delta_pct":
        # centre at 0 using symmetric range based on 95th percentile
        m = float(np.nanpercentile(np.abs(d["delta_pct"]), 95))
        rng = (-m, m)
        title = f"Δ% (12m ending {end_oldest} → {end_latest}) — {seg}"
        hover = {"delta_pct":":.1f","delta_gbp":":,.0f","price_oldest":":,.0f","price_latest":":,.0f",
                 "sales_oldest":True,"sales_latest":True}
        color_col = "delta_pct"
    else:
        m = float(np.nanpercentile(np.abs(d["delta_gbp"]), 95))
        rng = (-m, m)
        title = f"Δ£ (12m ending {end_oldest} → {end_latest}) — {seg}"
        hover = {"delta_gbp":":,.0f","delta_pct":":.1f","price_oldest":":,.0f","price_latest":":,.0f",
                 "sales_oldest":True,"sales_latest":True}
        color_col = "delta_gbp"

    if use_tiles:
        fig = px.choropleth_mapbox(
            d, geojson=geojson, locations=cell_col, color=color_col,
            range_color=rng, color_continuous_scale=colorscale,
            hover_data=hover, mapbox_style="open-street-map",
            center={"lat":54.5,"lon":-2.5}, zoom=zoom, opacity=opacity, title=title
        )
    else:
        fig = px.choropleth(
            d, geojson=geojson, locations=cell_col, color=color_col,
            range_color=rng, color_continuous_scale=colorscale,
            hover_data=hover, title=title
        )
        fig.update_geos(fitbounds="locations", visible=False)

    # darker borders like you wanted
    fig.update_traces(marker_line_width=1.1, marker_line_color="rgba(0,0,0,0.9)")
    fig.update_layout(margin={"r":0,"t":55,"l":0,"b":0})
    fig.show(renderer="iframe")

# %% [code] {"jupyter":{"outputs_hidden":false}}
def plot_top_movers(delta_df: pd.DataFrame, n: int = 20):
    d = delta_df.dropna(subset=["delta_pct"]).copy()
    d = d.sort_values("delta_pct", ascending=False).head(n).copy()

    fig = px.bar(
        d,
        x="delta_pct",
        y=d.index.astype(str),
        hover_data={"delta_pct":":.1f","delta_gbp":":,.0f","price_oldest":":,.0f","price_latest":":,.0f"},
        title=f"Top {n} grid cells by Δ% (joined cells only)"
    )
    fig.update_layout(yaxis_title="row", xaxis_title="Δ%")
    fig.show(renderer="iframe")

# %% [code] {"jupyter":{"outputs_hidden":false}}
def build_overall_deltas(grid_annual: pd.DataFrame, min_sales: int = 3) -> pd.DataFrame:
    """
    Compute deltas between earliest and latest available month across entire dataset.
    
    KAGGLE OPTIMIZATION:
    - Avoids storing all intermediate period deltas; only computes earliest→latest
    - Single merge operation (lower memory footprint than multi-period approach)
    - Filtered by min_sales to reduce output size
    - Returns only non-null deltas to save storage
    
    Args:
        grid_annual: Annual stacked grid data with columns [gx_*, gy_*, end_month, property_type, new_build, median, sales_12m]
        min_sales: Minimum transaction count to include
    
    Returns:
        DataFrame with columns [gx, gy, cell, property_type, new_build, 
        price_earliest, sales_earliest, end_month_earliest,
        price_latest, sales_latest, end_month_latest,
        delta_gbp, delta_pct, years_delta]
    """
    d = grid_annual.copy()
    print(f"DEBUG: build_overall_deltas input: {len(d)} rows, min_sales filter={min_sales}")
    d = d[d["sales_12m"] >= min_sales].copy()
    print(f"DEBUG: after min_sales filter: {len(d)} rows")
    
    if d.empty:
        return pd.DataFrame()
    
    # Find earliest and latest months available
    earliest_month = d["end_month"].min()
    latest_month = d["end_month"].max()
    
    print(f"DEBUG: earliest_month={earliest_month}, latest_month={latest_month}")
    
    if earliest_month == latest_month:
        print(f"Only one month available ({earliest_month}); skipping overall deltas")
        return pd.DataFrame()
    
    # Subset to earliest and latest only (memory efficient)
    earliest_data = d[d["end_month"] == earliest_month].copy()
    latest_data = d[d["end_month"] == latest_month].copy()
    
    # Determine grid size from column names (needed for debug output)
    grid_sizes = [g for col in earliest_data.columns if col.startswith("gx_") for g in [int(col.split("_")[1])]]
    if not grid_sizes:
        raise ValueError("No grid columns found (expected gx_*, gy_*)")
    g = grid_sizes[0]
    
    gx_col = f"gx_{g}"
    gy_col = f"gy_{g}"
    cell_col = f"cell_{g}"
    
    print(f"DEBUG earliest_data rows: {len(earliest_data)}, unique cells: {earliest_data[[gx_col, gy_col]].drop_duplicates().shape[0]}")
    print(f"DEBUG latest_data rows: {len(latest_data)}, unique cells: {latest_data[[gx_col, gy_col]].drop_duplicates().shape[0]}")
    
    # Group by cell, property_type, new_build at each time point
    earliest_agg = earliest_data.groupby([gx_col, gy_col, "property_type", "new_build"]).agg({
        "median_price_12m": "first",
        "sales_12m": "first"
    }).reset_index().rename(columns={"median_price_12m": "price_earliest", "sales_12m": "sales_earliest"})
    
    latest_agg = latest_data.groupby([gx_col, gy_col, "property_type", "new_build"]).agg({
        "median_price_12m": "first",
        "sales_12m": "first"
    }).reset_index().rename(columns={"median_price_12m": "price_latest", "sales_12m": "sales_latest"})
    
    print(f"DEBUG: earliest_agg={len(earliest_agg)} unique cell+segment combos")
    print(f"DEBUG: latest_agg={len(latest_agg)} unique cell+segment combos")
    
    # Inner join: only cells with data in both periods
    out = earliest_agg.merge(
        latest_agg,
        on=[gx_col, gy_col, "property_type", "new_build"],
        how="inner"
    )
    
    if out.empty:
        print(f"No cells with data in both {earliest_month} and {latest_month}")
        return pd.DataFrame()
    
    # DEBUG: Show coordinate distribution
    unique_cells = out[[gx_col, gy_col]].drop_duplicates()
    print(f"DEBUG: {len(unique_cells)} unique grid cells")
    print(f"DEBUG: {gx_col} range: {out[gx_col].min()} to {out[gx_col].max()}")
    print(f"DEBUG: {gy_col} range: {out[gy_col].min()} to {out[gy_col].max()}")
    if len(unique_cells) <= 10:
        print(f"DEBUG: Cells - {unique_cells.values.tolist()}")
    
    # Compute deltas
    out["delta_gbp"] = out["price_latest"] - out["price_earliest"]
    out["delta_pct"] = np.where(
        out["price_earliest"] > 0,
        (out["price_latest"] / out["price_earliest"] - 1.0) * 100.0,
        np.nan
    )
    
    # Add metadata
    out[cell_col] = out[gx_col].astype("int64").astype(str) + "_" + out[gy_col].astype("int64").astype(str)
    out["end_month_earliest"] = earliest_month
    out["end_month_latest"] = latest_month
    out["years_delta"] = (pd.to_datetime(latest_month).year - pd.to_datetime(earliest_month).year)
    # Also expose generic coordinate columns and a generic cell id for JSON consumers
    out["gx"] = out[gx_col].astype(float)
    out["gy"] = out[gy_col].astype(float)
    out["cell"] = out[cell_col].astype(str)
    
    # Select output columns (clean up grid-specific columns)
    # NOTE: sales_latest retained to contextualize large delta_pct values (sparse vs. robust moves)
    keep_cols = [
        gx_col, gy_col, "gx", "gy", cell_col, "cell", "property_type", "new_build",
        "price_earliest", "sales_earliest", "end_month_earliest",
        "price_latest", "sales_latest", "end_month_latest",
        "delta_gbp", "delta_pct", "years_delta"
    ]
    out = out[[c for c in keep_cols if c in out.columns]]
    
    # Filter to non-null deltas only (saves storage)
    out = out.dropna(subset=["delta_pct"])
    
    # Convert Timestamps to ISO format strings for JSON serialization
    out["end_month_earliest"] = pd.to_datetime(out["end_month_earliest"]).dt.strftime("%Y-%m-%d")
    out["end_month_latest"] = pd.to_datetime(out["end_month_latest"]).dt.strftime("%Y-%m-%d")
    
    return out.sort_values("delta_pct", ascending=False)

# %% [code] {"jupyter":{"outputs_hidden":false}}
g = 5000
grid_annual = grid_5km_annual

delta_25 = build_delta_df(
    grid_annual, g,
    property_type="D",
    new_build="ALL",
    min_sales=30
)

plot_delta_map(delta_25, g, metric="delta_pct", opacity=0.6)

# %% [markdown]
# ## Computing Overall Deltas (Earliest → Latest)
# 
# For Kaggle efficiency, use `build_overall_deltas()` to compute deltas across your entire dataset history.
# This single comparison is much cheaper than computing all period-to-period deltas.

# %% [code] {"jupyter":{"outputs_hidden":false}}
# Example: Compute overall deltas for all property types across 5km, 10km, 25km grids
# (Skip 1km to avoid excessive data volume)

delta_metadata = {}

for grid_size, grid_annual in [
    (5000, grid_5km_annual),
    (10000, grid_10km_annual),
    (25000, grid_25km_annual),
]:
    grid_label = f"{grid_size // 1000}km"
    overall_deltas = build_overall_deltas(grid_annual, min_sales=5)
    
    if not overall_deltas.empty:
        cell_col = f"cell_{grid_size}"
        print(f"\n{'='*60}")
        print(f"Overall Deltas: {grid_label}")
        print(f"{'='*60}")
        print(f"Generated {len(overall_deltas)} cells with price movement")
        print(f"Time range: {overall_deltas['end_month_earliest'].iloc[0]} → {overall_deltas['end_month_latest'].iloc[0]}")
        print(f"Years: {overall_deltas['years_delta'].iloc[0]}")
        print(f"\nTop 10 gainers (%):")
        print(overall_deltas.nlargest(10, "delta_pct")[[cell_col, "property_type", "new_build", "sales_latest", "delta_pct", "delta_gbp"]])
        
        # Ensure grid coordinate columns are native Python types and add lon/lat center
        gx_col = f"gx_{grid_size}"
        gy_col = f"gy_{grid_size}"
        try:
            overall_deltas[gx_col] = overall_deltas[gx_col].astype("int64")
            overall_deltas[gy_col] = overall_deltas[gy_col].astype("int64")
        except Exception:
            # best-effort cast
            overall_deltas[gx_col] = overall_deltas[gx_col].astype(float).round(0).astype("Int64")
            overall_deltas[gy_col] = overall_deltas[gy_col].astype(float).round(0).astype("Int64")

        overall_deltas["gx"] = overall_deltas["gx"].astype(float).round(0).astype("Int64")
        overall_deltas["gy"] = overall_deltas["gy"].astype(float).round(0).astype("Int64")

        # Add centre lon/lat for convenience (EPSG:27700 -> EPSG:4326)
        try:
            x_cent = overall_deltas[gx_col].astype(float).to_numpy() + (grid_size / 2.0)
            y_cent = overall_deltas[gy_col].astype(float).to_numpy() + (grid_size / 2.0)
            lon_c, lat_c = TRANSFORMER.transform(x_cent, y_cent)
            overall_deltas["lon"] = lon_c
            overall_deltas["lat"] = lat_c
        except Exception:
            overall_deltas["lon"] = None
            overall_deltas["lat"] = None

        # Convert NaNs to None for JSON and ensure timestamps are strings
        overall_deltas["end_month_earliest"] = overall_deltas["end_month_earliest"].astype(str)
        overall_deltas["end_month_latest"] = overall_deltas["end_month_latest"].astype(str)

        # Capture metadata for this grid
        earliest = overall_deltas["end_month_earliest"].iloc[0]
        latest = overall_deltas["end_month_latest"].iloc[0]
        delta_metadata[grid_label] = {
            "earliest": earliest,
            "latest": latest,
            "rows": len(overall_deltas)
        }

        # Save to JSON (memory-efficient for Kaggle)
        output_path = str(OUTPUT_DIR / f"deltas_overall_{grid_label}.json.gz")
        with gzip.open(output_path, "wt", encoding="utf-8") as f:
            json.dump(overall_deltas.where(pd.notnull(overall_deltas), None).to_dict(orient="records"), f)
        print(f"\nSaved to {output_path}")
    else:
        print(f"\nNo deltas generated for {grid_label}")

# Save delta metadata file
if delta_metadata:
    delta_metadata_path = str(OUTPUT_DIR / "deltas_metadata.json")
    with open(delta_metadata_path, "w") as f:
        json.dump(delta_metadata, f, indent=2)
    print(f"\n{'='*60}")
    print("Delta metadata:")
    print(json.dumps(delta_metadata, indent=2))
    print(f"Saved to {delta_metadata_path}")
#plot_top_movers(delta_25, n=20)

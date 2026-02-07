# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:22:40.155697Z","iopub.execute_input":"2026-02-07T05:22:40.156718Z"},"jupyter":{"outputs_hidden":false}}
import os, time, requests
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

# %% [code] {"jupyter":{"outputs_hidden":false}}
import os
print(os.getcwd())
print(os.listdir(".")[:50])

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:25:58.574996Z","iopub.execute_input":"2026-02-07T05:25:58.575335Z","iopub.status.idle":"2026-02-07T05:25:58.581901Z","shell.execute_reply.started":"2026-02-07T05:25:58.575299Z","shell.execute_reply":"2026-02-07T05:25:58.580753Z"},"jupyter":{"outputs_hidden":false}}
import os

for d in os.listdir("/kaggle/input"):
    p = f"/kaggle/input/{d}"
    print("\n==", p)
    print(os.listdir(p)[:50])

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:25:58.583946Z","iopub.execute_input":"2026-02-07T05:25:58.584716Z","iopub.status.idle":"2026-02-07T05:27:42.136540Z","shell.execute_reply.started":"2026-02-07T05:25:58.584685Z","shell.execute_reply":"2026-02-07T05:27:42.135639Z"},"jupyter":{"outputs_hidden":false}}
import pandas as pd

path = "/kaggle/working/pp-2025.txt"

# Full PPD schema (16 columns)
all_cols = [
    "transaction_id", "price", "date", "postcode",
    "property_type", "new_build", "tenure",
    "paon", "saon", "street", "locality", "town_city",
    "district", "county", "ppd_category", "record_status"
]

usecols = ["transaction_id", "price", "date", "postcode", "property_type", "new_build", "record_status"]

cutoff = (pd.Timestamp.today().normalize() - pd.DateOffset(years=5)).date()

chunks = []
for chunk in pd.read_csv(
    path,
    header=None,
    names=all_cols,
    usecols=usecols,
    dtype={
        "transaction_id": "string",
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

    chunks.append(chunk)

df = pd.concat(chunks, ignore_index=True)

# Month-start timestamp (for your downstream logic)
df["month"] = df["date"].dt.to_period("M").dt.to_timestamp()

print("Rows kept:", len(df))
print("Date range:", df["date"].min().date(), "->", df["date"].max().date())

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:27:46.015685Z","iopub.execute_input":"2026-02-07T05:27:46.016433Z","iopub.status.idle":"2026-02-07T05:27:46.042758Z","shell.execute_reply.started":"2026-02-07T05:27:46.016403Z","shell.execute_reply":"2026-02-07T05:27:46.042096Z"},"jupyter":{"outputs_hidden":false}}
df.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:28:24.553698Z","iopub.execute_input":"2026-02-07T05:28:24.554298Z","iopub.status.idle":"2026-02-07T05:28:51.827415Z","shell.execute_reply.started":"2026-02-07T05:28:24.554257Z","shell.execute_reply":"2026-02-07T05:28:51.825965Z"},"jupyter":{"outputs_hidden":false}}
import pandas as pd
path_east_north = "/kaggle/input/postcode-eastnorth/ONSPD_Online_latest_Postcode_Centroids_.csv"

cols = [
    "x","y","PCDS"
]

df_en = pd.read_csv(
    path_east_north,    
    names=cols,    
    usecols=[0,1,4],
    skiprows=1,
    dtype={
        "x": "string",
        "y": "string",
        "PCDS": "string",
                
    }
)

df_en.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:29:11.181408Z","iopub.execute_input":"2026-02-07T05:29:11.181877Z","iopub.status.idle":"2026-02-07T05:29:15.373022Z","shell.execute_reply.started":"2026-02-07T05:29:11.181775Z","shell.execute_reply":"2026-02-07T05:29:15.371967Z"},"jupyter":{"outputs_hidden":false}}
df_en["EAST1M"]  = pd.to_numeric(df_en["x"], errors="coerce")
df_en["NORTH1M"] = pd.to_numeric(df_en["y"], errors="coerce")

df_en = df_en.dropna(subset=["EAST1M","NORTH1M"]).copy()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:29:20.393336Z","iopub.execute_input":"2026-02-07T05:29:20.393661Z","iopub.status.idle":"2026-02-07T05:29:32.007790Z","shell.execute_reply.started":"2026-02-07T05:29:20.393635Z","shell.execute_reply":"2026-02-07T05:29:32.006576Z"},"jupyter":{"outputs_hidden":false}}
GRID_SIZES = [1000, 5000, 10000, 25000]  # metres

for g in GRID_SIZES:
    df_en[f"gx_{g}"] = (df_en["EAST1M"] // g) * g
    df_en[f"gy_{g}"] = (df_en["NORTH1M"] // g) * g
    df_en[f"cell_{g}"] = (
        df_en[f"gx_{g}"].astype("Int64").astype(str) + "_" +
        df_en[f"gy_{g}"].astype("Int64").astype(str)
    )

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:29:35.803921Z","iopub.execute_input":"2026-02-07T05:29:35.804572Z","iopub.status.idle":"2026-02-07T05:29:36.520682Z","shell.execute_reply.started":"2026-02-07T05:29:35.804536Z","shell.execute_reply":"2026-02-07T05:29:36.519849Z"},"jupyter":{"outputs_hidden":false}}
def make_cells(df, g):
    cells = (df[[f"gx_{g}", f"gy_{g}"]]
             .drop_duplicates()
             .rename(columns={f"gx_{g}":"gx", f"gy_{g}":"gy"}))
    cells["grid_m"] = g
    cells["x0"] = cells["gx"]
    cells["y0"] = cells["gy"]
    cells["x1"] = cells["gx"] + g
    cells["y1"] = cells["gy"] + g
    return cells

cells_1km  = make_cells(df_en, 1000)
cells_5km  = make_cells(df_en, 5000)
cells_10km = make_cells(df_en, 10000)
cells_25km = make_cells(df_en, 25000)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:29:46.057652Z","iopub.execute_input":"2026-02-07T05:29:46.058028Z","iopub.status.idle":"2026-02-07T05:29:46.064883Z","shell.execute_reply.started":"2026-02-07T05:29:46.057998Z","shell.execute_reply":"2026-02-07T05:29:46.063383Z"},"jupyter":{"outputs_hidden":false}}
print("1km:",  len(cells_1km))
print("5km:",  len(cells_5km))
print("10km:", len(cells_10km))
print("25km:", len(cells_25km))

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:29:48.720065Z","iopub.execute_input":"2026-02-07T05:29:48.721001Z","iopub.status.idle":"2026-02-07T05:29:53.635150Z","shell.execute_reply.started":"2026-02-07T05:29:48.720943Z","shell.execute_reply":"2026-02-07T05:29:53.633665Z"},"jupyter":{"outputs_hidden":false}}
df["pc_key"] = df["postcode"].astype("string").str.replace(" ", "", regex=False).str.upper()
df_en["pc_key"] = df_en["PCDS"].astype("string").str.replace(" ", "", regex=False).str.upper()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:29:56.836827Z","iopub.execute_input":"2026-02-07T05:29:56.837865Z","iopub.status.idle":"2026-02-07T05:29:56.866477Z","shell.execute_reply.started":"2026-02-07T05:29:56.837819Z","shell.execute_reply":"2026-02-07T05:29:56.864825Z"},"jupyter":{"outputs_hidden":false}}
df_en.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:30:09.293565Z","iopub.execute_input":"2026-02-07T05:30:09.294027Z","iopub.status.idle":"2026-02-07T05:30:22.210616Z","shell.execute_reply.started":"2026-02-07T05:30:09.293991Z","shell.execute_reply":"2026-02-07T05:30:22.209420Z"},"jupyter":{"outputs_hidden":false}}
df_en["EAST1M"]  = pd.to_numeric(df_en["EAST1M"], errors="coerce")
df_en["NORTH1M"] = pd.to_numeric(df_en["NORTH1M"], errors="coerce")
df_en = df_en.dropna(subset=["EAST1M","NORTH1M"]).copy()

for g in [1000, 5000, 10000, 25000]:
    df_en[f"gx_{g}"] = ((df_en["EAST1M"] // g) * g).astype("int64")
    df_en[f"gy_{g}"] = ((df_en["NORTH1M"] // g) * g).astype("int64")
    df_en[f"cell_{g}"] = df_en[f"gx_{g}"].astype(str) + "_" + df_en[f"gy_{g}"].astype(str)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:30:26.442460Z","iopub.execute_input":"2026-02-07T05:30:26.442851Z","iopub.status.idle":"2026-02-07T05:30:48.332300Z","shell.execute_reply.started":"2026-02-07T05:30:26.442819Z","shell.execute_reply":"2026-02-07T05:30:48.331116Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T06:05:55.224738Z","iopub.execute_input":"2026-02-07T06:05:55.225237Z","iopub.status.idle":"2026-02-07T06:06:12.506490Z","shell.execute_reply.started":"2026-02-07T06:05:55.225199Z","shell.execute_reply":"2026-02-07T06:06:12.505653Z"},"jupyter":{"outputs_hidden":false}}

postcode_lookup = df_en[[
    "PCDS",
    "cell_1000", "cell_5000", "cell_10000", "cell_25000",
]].copy()

# Extract outcode (area) from full postcode and normalise
postcode_lookup["outcode"] = (
    postcode_lookup["PCDS"].astype("string").str.strip().str.split(" ", n=1).str[0].str.upper()
)
postcode_lookup = postcode_lookup.dropna(subset=["outcode"]).copy()

# Split each cell string (e.g. "385000_801000") into separate X/Y columns per grid size
for g in [1000, 5000, 10000, 25000]:
    cell_col = f"cell_{g}"
    x_col = f"cell_{g}_x"
    y_col = f"cell_{g}_y"
    # If the cell column exists, split on the underscore; keep as nullable Int64
    if cell_col in postcode_lookup.columns:
        parts = postcode_lookup[cell_col].astype("string").str.split("_", n=1, expand=True)
        postcode_lookup[x_col] = pd.to_numeric(parts[0], errors="coerce").astype("Int64")
        postcode_lookup[y_col] = pd.to_numeric(parts[1], errors="coerce").astype("Int64")
    else:
        postcode_lookup[x_col] = pd.Series([pd.NA] * len(postcode_lookup), dtype="Int64")
        postcode_lookup[y_col] = pd.Series([pd.NA] * len(postcode_lookup), dtype="Int64")

# Drop the original full postcode string column (`PCDS`) and the combined `cell_*` columns
drop_cells = [f"cell_{g}" for g in [1000, 5000, 10000, 25000]] + ["PCDS"]
postcode_lookup = postcode_lookup.drop(columns=[c for c in drop_cells if c in postcode_lookup.columns])

# Deduplicate by outcode + all grid X/Y coordinate pairs
dedupe_cols = ["outcode"] + [f"cell_{g}_x" for g in [1000, 5000, 10000, 25000]] + [f"cell_{g}_y" for g in [1000, 5000, 10000, 25000]]
postcode_lookup = postcode_lookup.drop_duplicates(subset=dedupe_cols)

# Save as parquet (compact, fast) and JSON (portable)
postcode_lookup_out_parquet = str(OUTPUT_DIR / "postcode_grid_outcode_lookup.parquet")
postcode_lookup_out_json = str(OUTPUT_DIR / "postcode_grid_outcode_lookup.json.gz")

postcode_lookup.to_parquet(postcode_lookup_out_parquet, index=False)

import json, gzip
with gzip.open(postcode_lookup_out_json, "wt", encoding="utf-8") as f:
    json.dump(postcode_lookup.where(pd.notnull(postcode_lookup), None).to_dict(orient="records"), f)

print("Wrote postcode lookup:", postcode_lookup_out_parquet, "rows:", len(postcode_lookup))


# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T06:06:25.442621Z","iopub.execute_input":"2026-02-07T06:06:25.443191Z","iopub.status.idle":"2026-02-07T06:06:25.454079Z","shell.execute_reply.started":"2026-02-07T06:06:25.443162Z","shell.execute_reply":"2026-02-07T06:06:25.453075Z"}}
postcode_lookup.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:32:31.857153Z","iopub.execute_input":"2026-02-07T05:32:31.858041Z","iopub.status.idle":"2026-02-07T05:32:32.316209Z","shell.execute_reply.started":"2026-02-07T05:32:31.857996Z","shell.execute_reply":"2026-02-07T05:32:32.314919Z"},"jupyter":{"outputs_hidden":false}}
df[["postcode", "EAST1M", "NORTH1M", "gx_25000", "gy_25000", "cell_25000"]].head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:32:41.270513Z","iopub.execute_input":"2026-02-07T05:32:41.270910Z","iopub.status.idle":"2026-02-07T05:32:42.665655Z","shell.execute_reply.started":"2026-02-07T05:32:41.270878Z","shell.execute_reply":"2026-02-07T05:32:42.664178Z"},"jupyter":{"outputs_hidden":false}}
df["month"] = df["date"].dt.to_period("M").dt.to_timestamp()

# optional but recommended for later
df["property_type"] = df["property_type"].astype("string")
df["new_build"] = df["new_build"].astype("string")

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:32:45.250225Z","iopub.execute_input":"2026-02-07T05:32:45.250712Z","iopub.status.idle":"2026-02-07T05:32:51.794963Z","shell.execute_reply.started":"2026-02-07T05:32:45.250662Z","shell.execute_reply":"2026-02-07T05:32:51.793756Z"},"jupyter":{"outputs_hidden":false}}
df["month"] = pd.to_datetime(df["month"]).dt.to_period("M").dt.to_timestamp()
latest_month = df["month"].max()
# Keep only last 10 years (inclusive, aligned to month)
cutoff_month = (latest_month - pd.DateOffset(years=10)).to_period("M").to_timestamp()
df = df[df["month"] >= cutoff_month].copy()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:33:05.839630Z","iopub.execute_input":"2026-02-07T05:33:05.840922Z","iopub.status.idle":"2026-02-07T05:33:05.858950Z","shell.execute_reply.started":"2026-02-07T05:33:05.840864Z","shell.execute_reply":"2026-02-07T05:33:05.857104Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:33:09.428261Z","iopub.execute_input":"2026-02-07T05:33:09.428625Z","iopub.status.idle":"2026-02-07T05:33:22.576176Z","shell.execute_reply.started":"2026-02-07T05:33:09.428596Z","shell.execute_reply":"2026-02-07T05:33:22.575100Z"},"jupyter":{"outputs_hidden":false}}
grid_25km_annual = make_grid_annual_stack_levels(
    df,
    g=25000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:33:25.830103Z","iopub.execute_input":"2026-02-07T05:33:25.830874Z","iopub.status.idle":"2026-02-07T05:33:39.332488Z","shell.execute_reply.started":"2026-02-07T05:33:25.830832Z","shell.execute_reply":"2026-02-07T05:33:39.331457Z"},"jupyter":{"outputs_hidden":false}}
grid_10km_annual = make_grid_annual_stack_levels(
    df,
    g=10000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:33:42.151610Z","iopub.execute_input":"2026-02-07T05:33:42.152725Z","iopub.status.idle":"2026-02-07T05:33:57.400205Z","shell.execute_reply.started":"2026-02-07T05:33:42.152683Z","shell.execute_reply":"2026-02-07T05:33:57.398469Z"},"jupyter":{"outputs_hidden":false}}
grid_5km_annual = make_grid_annual_stack_levels(
    df,
    g=5000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:34:10.260542Z","iopub.execute_input":"2026-02-07T05:34:10.261072Z","iopub.status.idle":"2026-02-07T05:34:21.699375Z","shell.execute_reply.started":"2026-02-07T05:34:10.261036Z","shell.execute_reply":"2026-02-07T05:34:21.698053Z"},"jupyter":{"outputs_hidden":false}}
grid_1km_annual = make_grid_annual_stack_levels(
    df,
    g=1000,
    min_sales=3,
    years_back=1   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:34:24.836866Z","iopub.execute_input":"2026-02-07T05:34:24.837344Z","iopub.status.idle":"2026-02-07T05:34:25.208295Z","shell.execute_reply.started":"2026-02-07T05:34:24.837297Z","shell.execute_reply":"2026-02-07T05:34:25.207127Z"},"jupyter":{"outputs_hidden":false}}
grid_1km_annual.to_parquet("/kaggle/working/grid_1km_annual.parquet", index=False)
grid_5km_annual.to_parquet("/kaggle/working/grid_5km_annual.parquet", index=False)
grid_10km_annual.to_parquet("/kaggle/working/grid_10km_annual.parquet", index=False)
grid_25km_annual.to_parquet("/kaggle/working/grid_25km_annual.parquet", index=False)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T05:58:25.314690Z","iopub.execute_input":"2026-02-07T05:58:25.315168Z","iopub.status.idle":"2026-02-07T05:58:25.321106Z","shell.execute_reply.started":"2026-02-07T05:58:25.315136Z","shell.execute_reply":"2026-02-07T05:58:25.319817Z"}}
import os, time, requests, gc
from pathlib import Path

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T06:00:28.690358Z","iopub.execute_input":"2026-02-07T06:00:28.691251Z","iopub.status.idle":"2026-02-07T06:00:28.699003Z","shell.execute_reply.started":"2026-02-07T06:00:28.691211Z","shell.execute_reply":"2026-02-07T06:00:28.697677Z"}}
from pathlib import Path
import os, json, gzip
import pandas as pd

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/kaggle/working"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# quick runtime checks
for n in ("grid_1km_annual","grid_5km_annual","grid_10km_annual","grid_25km_annual"):
    if n not in globals():
        raise RuntimeError(f"{n} not found — run make_grid_annual_stack_levels first")

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T06:00:31.219944Z","iopub.execute_input":"2026-02-07T06:00:31.220494Z","iopub.status.idle":"2026-02-07T06:00:54.140464Z","shell.execute_reply.started":"2026-02-07T06:00:31.220460Z","shell.execute_reply":"2026-02-07T06:00:54.138974Z"},"jupyter":{"outputs_hidden":false}}
import pandas as pd, json, gzip

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/kaggle/working"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

for grid_size, grid_annual in [
    (1000, grid_1km_annual),
    (5000, grid_5km_annual),
    (10000, grid_10km_annual),
    (25000, grid_25km_annual),
]:
    d = grid_annual.copy()
    g = grid_size
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

    out_path = str(OUTPUT_DIR / f"grid_{g//1000}km_full.json.gz")
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
metadata_path = "/kaggle/working/grid_metadata.json"
with open(metadata_path, "w") as f:
    json.dump(grid_metadata, f, indent=2)

print(f"\nGrid availability metadata:")
print(json.dumps(grid_metadata, indent=2))
print(f"Saved to {metadata_path}")

# %% [code] {"execution":{"iopub.status.busy":"2026-02-06T07:30:25.743491Z","iopub.execute_input":"2026-02-06T07:30:25.744103Z","iopub.status.idle":"2026-02-06T07:30:28.232924Z","shell.execute_reply.started":"2026-02-06T07:30:25.744074Z","shell.execute_reply":"2026-02-06T07:30:28.232168Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-06T07:30:28.234614Z","iopub.execute_input":"2026-02-06T07:30:28.234991Z","iopub.status.idle":"2026-02-06T07:30:28.245192Z","shell.execute_reply.started":"2026-02-06T07:30:28.234966Z","shell.execute_reply":"2026-02-06T07:30:28.244304Z"}}
(grid_25km_annual["property_type"].eq("ALL") & grid_25km_annual["new_build"].eq("ALL")).any()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-06T07:30:28.246521Z","iopub.execute_input":"2026-02-06T07:30:28.246898Z","iopub.status.idle":"2026-02-06T07:30:28.273729Z","shell.execute_reply.started":"2026-02-06T07:30:28.246850Z","shell.execute_reply":"2026-02-06T07:30:28.272922Z"},"jupyter":{"outputs_hidden":false}}
g = 25000

row = grid_25km_annual[
    (grid_25km_annual[f"gx_{g}"] == 500000) &
    (grid_25km_annual[f"gy_{g}"] == 200000) &
    (grid_25km_annual["property_type"] == "D") &
    (grid_25km_annual["new_build"] == "ALL") 
]

row.sort_values(by='sales_12m' , ascending=False)

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T05:37:31.186998Z","iopub.execute_input":"2026-02-07T05:37:31.188336Z","iopub.status.idle":"2026-02-07T05:37:32.882297Z","shell.execute_reply.started":"2026-02-07T05:37:31.188293Z","shell.execute_reply":"2026-02-07T05:37:32.881238Z"}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T05:37:36.650722Z","iopub.execute_input":"2026-02-07T05:37:36.652773Z","iopub.status.idle":"2026-02-07T05:37:36.660694Z","shell.execute_reply.started":"2026-02-07T05:37:36.652717Z","shell.execute_reply":"2026-02-07T05:37:36.659582Z"}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T05:37:51.359403Z","iopub.execute_input":"2026-02-07T05:37:51.360067Z","iopub.status.idle":"2026-02-07T05:37:51.382549Z","shell.execute_reply.started":"2026-02-07T05:37:51.360029Z","shell.execute_reply":"2026-02-07T05:37:51.381157Z"}}
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

# %% [markdown] {"jupyter":{"outputs_hidden":false}}
# ## Computing Overall Deltas (Earliest → Latest)
# 
# For Kaggle efficiency, use `build_overall_deltas()` to compute deltas across your entire dataset history.
# This single comparison is much cheaper than computing all period-to-period deltas.

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T05:38:15.677728Z","iopub.execute_input":"2026-02-07T05:38:15.678089Z","iopub.status.idle":"2026-02-07T05:38:21.873491Z","shell.execute_reply.started":"2026-02-07T05:38:15.678062Z","shell.execute_reply":"2026-02-07T05:38:21.872368Z"}}
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
        output_path = f"/kaggle/working/deltas_overall_{grid_label}.json.gz"
        with gzip.open(output_path, "wt", encoding="utf-8") as f:
            json.dump(overall_deltas.where(pd.notnull(overall_deltas), None).to_dict(orient="records"), f)
        print(f"\nSaved to {output_path}")
    else:
        print(f"\nNo deltas generated for {grid_label}")

# Save delta metadata file
if delta_metadata:
    delta_metadata_path = "/kaggle/working/deltas_metadata.json"
    with open(delta_metadata_path, "w") as f:
        json.dump(delta_metadata, f, indent=2)
    print(f"\n{'='*60}")
    print("Delta metadata:")
    print(json.dumps(delta_metadata, indent=2))
    print(f"Saved to {delta_metadata_path}")
#plot_top_movers(delta_25, n=20)
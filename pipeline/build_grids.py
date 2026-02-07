# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:20:01.998464Z","iopub.execute_input":"2026-02-07T08:20:01.999014Z","iopub.status.idle":"2026-02-07T08:23:11.845913Z","shell.execute_reply.started":"2026-02-07T08:20:01.998985Z","shell.execute_reply":"2026-02-07T08:23:11.844671Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T08:24:45.971601Z","iopub.execute_input":"2026-02-07T08:24:45.972901Z","iopub.status.idle":"2026-02-07T08:24:45.983231Z","shell.execute_reply.started":"2026-02-07T08:24:45.972850Z","shell.execute_reply":"2026-02-07T08:24:45.981610Z"}}
import os
print(os.getcwd())
print(os.listdir(".")[:50])

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:24:48.003641Z","iopub.execute_input":"2026-02-07T08:24:48.004104Z","iopub.status.idle":"2026-02-07T08:24:48.027332Z","shell.execute_reply.started":"2026-02-07T08:24:48.004065Z","shell.execute_reply":"2026-02-07T08:24:48.025939Z"},"jupyter":{"outputs_hidden":false}}
import os

for d in os.listdir("/kaggle/input"):
    p = f"/kaggle/input/{d}"
    print("\n==", p)
    print(os.listdir(p)[:50])

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:18:07.200199Z","iopub.execute_input":"2026-02-07T08:18:07.200543Z","iopub.status.idle":"2026-02-07T08:18:22.363976Z","shell.execute_reply.started":"2026-02-07T08:18:07.200518Z","shell.execute_reply":"2026-02-07T08:18:22.362960Z"}}
import pandas as pd
import hashlib

path_scot = "/kaggle/input/scotland-prices/results.csv"  # change if needed
DAILY_THRESHOLD = 50  # you said 50

def parse_scot_date(s: pd.Series) -> pd.Series:
    s = s.astype("string").str.strip()
    dt = pd.to_datetime(s, format="%d-%m-%Y", errors="coerce")
    m = dt.isna()
    if m.any():
        dt[m] = pd.to_datetime(s[m], dayfirst=True, errors="coerce")
    return dt

today = pd.Timestamp.today().normalize()

# Load minimal columns
raw = pd.read_csv(
    path_scot,
    usecols=["Postcode", "Date", "Price", "Link"],
    dtype={"Postcode": "string", "Date": "string", "Price": "string", "Link": "string"},
)

# Clean
raw["postcode"] = raw["Postcode"].str.strip().str.upper()
raw["date"] = parse_scot_date(raw["Date"])
raw = raw[raw["date"].notna() & (raw["date"] <= today)]

price_clean = (
    raw["Price"]
      .str.replace("£", "", regex=False)
      .str.replace(",", "", regex=False)
      .str.strip()
)
raw["price"] = pd.to_numeric(price_clean, errors="coerce")
raw = raw[raw["price"].notna()]

# --- find latest "busy day" ---
daily_counts = raw.groupby(raw["date"].dt.normalize()).size().sort_index()

busy_days = daily_counts[daily_counts >= DAILY_THRESHOLD]
if not busy_days.empty:
    end_date = busy_days.index.max()
    reason = f"latest day with >= {DAILY_THRESHOLD} sales"
else:
    # fallback: use the day with the maximum count (still gives you a sensible anchor)
    end_date = daily_counts.idxmax()
    reason = f"no day with >= {DAILY_THRESHOLD}; using busiest day (count={int(daily_counts.max())})"

start_date = end_date - pd.DateOffset(years=1)

print("End date chosen:", end_date.date(), f"({reason})")
print("Start date:", start_date.date())
print("Sales on end date:", int(daily_counts.loc[end_date]))
print("Total sales in window:", int(raw[(raw['date'] >= start_date) & (raw['date'] <= end_date)].shape[0]))

# Filter to window
df_scot = raw[(raw["date"] >= start_date) & (raw["date"] <= end_date)].copy()

# Standardise schema like England
df_scot["property_type"] = "D"
df_scot["new_build"] = "N"
df_scot["record_status"] = "A"

key = df_scot["Link"].fillna(
    df_scot["postcode"] + "|" +
    df_scot["date"].dt.strftime("%Y-%m-%d") + "|" +
    df_scot["price"].astype("int64").astype("string")
)
df_scot["transaction_id"] = key.apply(lambda x: hashlib.md5(x.encode("utf-8")).hexdigest()).astype("string")

df_scot["month"] = df_scot["date"].dt.to_period("M").dt.to_timestamp()

df_scot = df_scot[[
    "transaction_id", "price", "date", "postcode",
    "property_type", "new_build", "record_status", "month"
]].copy()

df_scot.head()



# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:24:57.279344Z","iopub.execute_input":"2026-02-07T08:24:57.280668Z","iopub.status.idle":"2026-02-07T08:26:49.195614Z","shell.execute_reply.started":"2026-02-07T08:24:57.280634Z","shell.execute_reply":"2026-02-07T08:26:49.194590Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:31:30.335924Z","iopub.execute_input":"2026-02-07T08:31:30.336363Z","iopub.status.idle":"2026-02-07T08:31:33.025397Z","shell.execute_reply.started":"2026-02-07T08:31:30.336286Z","shell.execute_reply":"2026-02-07T08:31:33.024555Z"},"jupyter":{"outputs_hidden":false}}
cols = ["transaction_id","price","date","postcode","property_type","new_build","record_status","month"]

df = df[cols].copy()
df_scot = df_scot[cols].copy()

df_all = pd.concat([df, df_scot], ignore_index=True)

print("England/Wales:", len(df))
print("Scotland:", len(df_scot))
print("Combined:", len(df_all))
print("Combined date range:", df_all["date"].min().date(), "->", df_all["date"].max().date())

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:31:55.080829Z","iopub.execute_input":"2026-02-07T08:31:55.081765Z","iopub.status.idle":"2026-02-07T08:31:55.969809Z","shell.execute_reply.started":"2026-02-07T08:31:55.081729Z","shell.execute_reply":"2026-02-07T08:31:55.968392Z"}}
# Latest month in the combined dataset (from England/Wales usually)
latest_month_start = df["month"].max()   # month-start timestamp
latest_month_end = (latest_month_start + pd.offsets.MonthEnd(0)).normalize()
days_in_latest_month = latest_month_end.day

# Shift ONLY Scotland
df_scot2 = df_scot.copy()

# Keep original day number but clamp to end-of-month (handles 29/30/31)
orig_day = df_scot2["date"].dt.day.clip(upper=days_in_latest_month)

df_scot2["date"] = pd.to_datetime({
    "year": latest_month_start.year,
    "month": latest_month_start.month,
    "day": orig_day
})

# Recompute month field
df_scot2["month"] = df_scot2["date"].dt.to_period("M").dt.to_timestamp()

# Rebuild combined df using shifted Scotland
df_all = pd.concat([df, df_scot2], ignore_index=True)

print("Latest month used:", latest_month_start.date())
print("Scotland shifted date range:", df_scot2["date"].min().date(), "->", df_scot2["date"].max().date())


# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:33:10.255785Z","iopub.execute_input":"2026-02-07T08:33:10.256204Z","iopub.status.idle":"2026-02-07T08:33:10.382975Z","shell.execute_reply.started":"2026-02-07T08:33:10.256165Z","shell.execute_reply":"2026-02-07T08:33:10.381687Z"}}
df = df_all

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:33:16.661362Z","iopub.execute_input":"2026-02-07T08:33:16.662165Z","iopub.status.idle":"2026-02-07T08:33:32.063635Z","shell.execute_reply.started":"2026-02-07T08:33:16.662131Z","shell.execute_reply":"2026-02-07T08:33:32.062016Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:33:56.433834Z","iopub.execute_input":"2026-02-07T08:33:56.434860Z","iopub.status.idle":"2026-02-07T08:34:00.771313Z","shell.execute_reply.started":"2026-02-07T08:33:56.434825Z","shell.execute_reply":"2026-02-07T08:34:00.770190Z"},"jupyter":{"outputs_hidden":false}}
df_en["EAST1M"]  = pd.to_numeric(df_en["x"], errors="coerce")
df_en["NORTH1M"] = pd.to_numeric(df_en["y"], errors="coerce")

df_en = df_en.dropna(subset=["EAST1M","NORTH1M"]).copy()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:34:02.781119Z","iopub.execute_input":"2026-02-07T08:34:02.781563Z","iopub.status.idle":"2026-02-07T08:34:20.423039Z","shell.execute_reply.started":"2026-02-07T08:34:02.781523Z","shell.execute_reply":"2026-02-07T08:34:20.421844Z"},"jupyter":{"outputs_hidden":false}}
GRID_SIZES = [1000, 5000, 10000, 25000]  # metres

for g in GRID_SIZES:
    df_en[f"gx_{g}"] = (df_en["EAST1M"] // g) * g
    df_en[f"gy_{g}"] = (df_en["NORTH1M"] // g) * g
    df_en[f"cell_{g}"] = (
        df_en[f"gx_{g}"].astype("Int64").astype(str) + "_" +
        df_en[f"gy_{g}"].astype("Int64").astype(str)
    )

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:34:45.007534Z","iopub.execute_input":"2026-02-07T08:34:45.008296Z","iopub.status.idle":"2026-02-07T08:34:45.703960Z","shell.execute_reply.started":"2026-02-07T08:34:45.008258Z","shell.execute_reply":"2026-02-07T08:34:45.702962Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:34:48.135000Z","iopub.execute_input":"2026-02-07T08:34:48.135936Z","iopub.status.idle":"2026-02-07T08:34:48.141678Z","shell.execute_reply.started":"2026-02-07T08:34:48.135902Z","shell.execute_reply":"2026-02-07T08:34:48.140496Z"},"jupyter":{"outputs_hidden":false}}
print("1km:",  len(cells_1km))
print("5km:",  len(cells_5km))
print("10km:", len(cells_10km))
print("25km:", len(cells_25km))

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:34:57.505801Z","iopub.execute_input":"2026-02-07T08:34:57.506114Z","iopub.status.idle":"2026-02-07T08:35:01.962319Z","shell.execute_reply.started":"2026-02-07T08:34:57.506089Z","shell.execute_reply":"2026-02-07T08:35:01.961274Z"},"jupyter":{"outputs_hidden":false}}
df["pc_key"] = df["postcode"].astype("string").str.replace(" ", "", regex=False).str.upper()
df_en["pc_key"] = df_en["PCDS"].astype("string").str.replace(" ", "", regex=False).str.upper()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:35:05.038947Z","iopub.execute_input":"2026-02-07T08:35:05.039406Z","iopub.status.idle":"2026-02-07T08:35:05.060818Z","shell.execute_reply.started":"2026-02-07T08:35:05.039377Z","shell.execute_reply":"2026-02-07T08:35:05.059624Z"},"jupyter":{"outputs_hidden":false}}
df_en.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:35:07.413122Z","iopub.execute_input":"2026-02-07T08:35:07.413496Z","iopub.status.idle":"2026-02-07T08:35:19.832018Z","shell.execute_reply.started":"2026-02-07T08:35:07.413453Z","shell.execute_reply":"2026-02-07T08:35:19.831069Z"},"jupyter":{"outputs_hidden":false}}
df_en["EAST1M"]  = pd.to_numeric(df_en["EAST1M"], errors="coerce")
df_en["NORTH1M"] = pd.to_numeric(df_en["NORTH1M"], errors="coerce")
df_en = df_en.dropna(subset=["EAST1M","NORTH1M"]).copy()

for g in [1000, 5000, 10000, 25000]:
    df_en[f"gx_{g}"] = ((df_en["EAST1M"] // g) * g).astype("int64")
    df_en[f"gy_{g}"] = ((df_en["NORTH1M"] // g) * g).astype("int64")
    df_en[f"cell_{g}"] = df_en[f"gx_{g}"].astype(str) + "_" + df_en[f"gy_{g}"].astype(str)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:35:22.086215Z","iopub.execute_input":"2026-02-07T08:35:22.087114Z","iopub.status.idle":"2026-02-07T08:35:39.421672Z","shell.execute_reply.started":"2026-02-07T08:35:22.087080Z","shell.execute_reply":"2026-02-07T08:35:39.420869Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:38:09.679018Z","iopub.execute_input":"2026-02-07T08:38:09.679963Z","iopub.status.idle":"2026-02-07T08:38:49.798381Z","shell.execute_reply.started":"2026-02-07T08:38:09.679926Z","shell.execute_reply":"2026-02-07T08:38:49.797573Z"},"jupyter":{"outputs_hidden":false}}
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/kaggle/working"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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


# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:39:01.385831Z","iopub.execute_input":"2026-02-07T08:39:01.386284Z","iopub.status.idle":"2026-02-07T08:39:01.401250Z","shell.execute_reply.started":"2026-02-07T08:39:01.386249Z","shell.execute_reply":"2026-02-07T08:39:01.400267Z"},"jupyter":{"outputs_hidden":false}}
postcode_lookup.head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:39:03.958268Z","iopub.execute_input":"2026-02-07T08:39:03.958630Z","iopub.status.idle":"2026-02-07T08:39:04.359555Z","shell.execute_reply.started":"2026-02-07T08:39:03.958604Z","shell.execute_reply":"2026-02-07T08:39:04.358577Z"},"jupyter":{"outputs_hidden":false}}
df[["postcode", "EAST1M", "NORTH1M", "gx_25000", "gy_25000", "cell_25000"]].head()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:39:08.820438Z","iopub.execute_input":"2026-02-07T08:39:08.820775Z","iopub.status.idle":"2026-02-07T08:39:10.000975Z","shell.execute_reply.started":"2026-02-07T08:39:08.820749Z","shell.execute_reply":"2026-02-07T08:39:10.000075Z"},"jupyter":{"outputs_hidden":false}}
df["month"] = df["date"].dt.to_period("M").dt.to_timestamp()

# optional but recommended for later
df["property_type"] = df["property_type"].astype("string")
df["new_build"] = df["new_build"].astype("string")

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:39:13.336201Z","iopub.execute_input":"2026-02-07T08:39:13.337101Z","iopub.status.idle":"2026-02-07T08:39:21.690540Z","shell.execute_reply.started":"2026-02-07T08:39:13.337067Z","shell.execute_reply":"2026-02-07T08:39:21.689459Z"},"jupyter":{"outputs_hidden":false}}
df["month"] = pd.to_datetime(df["month"]).dt.to_period("M").dt.to_timestamp()
latest_month = df["month"].max()
# Keep only last 10 years (inclusive, aligned to month)
cutoff_month = (latest_month - pd.DateOffset(years=10)).to_period("M").to_timestamp()
df = df[df["month"] >= cutoff_month].copy()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:39:25.254902Z","iopub.execute_input":"2026-02-07T08:39:25.255217Z","iopub.status.idle":"2026-02-07T08:39:25.270884Z","shell.execute_reply.started":"2026-02-07T08:39:25.255192Z","shell.execute_reply":"2026-02-07T08:39:25.269897Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:39:31.013131Z","iopub.execute_input":"2026-02-07T08:39:31.013453Z","iopub.status.idle":"2026-02-07T08:39:43.289743Z","shell.execute_reply.started":"2026-02-07T08:39:31.013429Z","shell.execute_reply":"2026-02-07T08:39:43.288626Z"},"jupyter":{"outputs_hidden":false}}
grid_25km_annual = make_grid_annual_stack_levels(
    df,
    g=25000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:39:46.690825Z","iopub.execute_input":"2026-02-07T08:39:46.691661Z","iopub.status.idle":"2026-02-07T08:39:59.364747Z","shell.execute_reply.started":"2026-02-07T08:39:46.691626Z","shell.execute_reply":"2026-02-07T08:39:59.363861Z"},"jupyter":{"outputs_hidden":false}}
grid_10km_annual = make_grid_annual_stack_levels(
    df,
    g=10000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:40:02.849165Z","iopub.execute_input":"2026-02-07T08:40:02.849579Z","iopub.status.idle":"2026-02-07T08:40:15.721936Z","shell.execute_reply.started":"2026-02-07T08:40:02.849548Z","shell.execute_reply":"2026-02-07T08:40:15.720927Z"},"jupyter":{"outputs_hidden":false}}
grid_5km_annual = make_grid_annual_stack_levels(
    df,
    g=5000,
    min_sales=3,
    years_back=10   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:40:19.878700Z","iopub.execute_input":"2026-02-07T08:40:19.879210Z","iopub.status.idle":"2026-02-07T08:40:28.617959Z","shell.execute_reply.started":"2026-02-07T08:40:19.879176Z","shell.execute_reply":"2026-02-07T08:40:28.616954Z"},"jupyter":{"outputs_hidden":false}}
grid_1km_annual = make_grid_annual_stack_levels(
    df,
    g=1000,
    min_sales=3,
    years_back=1   # latest + last 10 yearly snapshots
)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:40:33.102561Z","iopub.execute_input":"2026-02-07T08:40:33.103772Z","iopub.status.idle":"2026-02-07T08:40:33.420669Z","shell.execute_reply.started":"2026-02-07T08:40:33.103735Z","shell.execute_reply":"2026-02-07T08:40:33.419637Z"},"jupyter":{"outputs_hidden":false}}
grid_1km_annual.to_parquet("/kaggle/working/grid_1km_annual.parquet", index=False)
grid_5km_annual.to_parquet("/kaggle/working/grid_5km_annual.parquet", index=False)
grid_10km_annual.to_parquet("/kaggle/working/grid_10km_annual.parquet", index=False)
grid_25km_annual.to_parquet("/kaggle/working/grid_25km_annual.parquet", index=False)

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:40:42.663463Z","iopub.execute_input":"2026-02-07T08:40:42.664533Z","iopub.status.idle":"2026-02-07T08:40:42.669370Z","shell.execute_reply.started":"2026-02-07T08:40:42.664493Z","shell.execute_reply":"2026-02-07T08:40:42.668159Z"},"jupyter":{"outputs_hidden":false}}
import os, time, requests, gc
from pathlib import Path

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:40:45.115147Z","iopub.execute_input":"2026-02-07T08:40:45.116170Z","iopub.status.idle":"2026-02-07T08:40:45.122200Z","shell.execute_reply.started":"2026-02-07T08:40:45.116134Z","shell.execute_reply":"2026-02-07T08:40:45.121115Z"},"jupyter":{"outputs_hidden":false}}
from pathlib import Path
import os, json, gzip
import pandas as pd

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/kaggle/working"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# quick runtime checks
for n in ("grid_1km_annual","grid_5km_annual","grid_10km_annual","grid_25km_annual"):
    if n not in globals():
        raise RuntimeError(f"{n} not found — run make_grid_annual_stack_levels first")

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:40:49.952314Z","iopub.execute_input":"2026-02-07T08:40:49.953099Z","iopub.status.idle":"2026-02-07T08:41:12.220634Z","shell.execute_reply.started":"2026-02-07T08:40:49.953063Z","shell.execute_reply":"2026-02-07T08:41:12.219568Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:41:22.949136Z","iopub.execute_input":"2026-02-07T08:41:22.949565Z","iopub.status.idle":"2026-02-07T08:41:25.519950Z","shell.execute_reply.started":"2026-02-07T08:41:22.949524Z","shell.execute_reply":"2026-02-07T08:41:25.518912Z"},"jupyter":{"outputs_hidden":false}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T08:41:32.691927Z","iopub.execute_input":"2026-02-07T08:41:32.692262Z","iopub.status.idle":"2026-02-07T08:41:32.704425Z","shell.execute_reply.started":"2026-02-07T08:41:32.692234Z","shell.execute_reply":"2026-02-07T08:41:32.703373Z"}}
(grid_25km_annual["property_type"].eq("ALL") & grid_25km_annual["new_build"].eq("ALL")).any()

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T08:41:34.965168Z","iopub.execute_input":"2026-02-07T08:41:34.966542Z","iopub.status.idle":"2026-02-07T08:41:34.988437Z","shell.execute_reply.started":"2026-02-07T08:41:34.966504Z","shell.execute_reply":"2026-02-07T08:41:34.987363Z"},"jupyter":{"outputs_hidden":false}}
g = 25000

row = grid_25km_annual[
    (grid_25km_annual[f"gx_{g}"] == 500000) &
    (grid_25km_annual[f"gy_{g}"] == 200000) &
    (grid_25km_annual["property_type"] == "D") &
    (grid_25km_annual["new_build"] == "ALL") 
]

row.sort_values(by='sales_12m' , ascending=False)

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T08:41:44.760929Z","iopub.execute_input":"2026-02-07T08:41:44.761319Z","iopub.status.idle":"2026-02-07T08:41:46.321683Z","shell.execute_reply.started":"2026-02-07T08:41:44.761288Z","shell.execute_reply":"2026-02-07T08:41:46.320698Z"}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T08:41:56.007208Z","iopub.execute_input":"2026-02-07T08:41:56.008626Z","iopub.status.idle":"2026-02-07T08:41:56.015289Z","shell.execute_reply.started":"2026-02-07T08:41:56.008581Z","shell.execute_reply":"2026-02-07T08:41:56.014500Z"}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T08:41:58.923694Z","iopub.execute_input":"2026-02-07T08:41:58.924000Z","iopub.status.idle":"2026-02-07T08:41:58.944737Z","shell.execute_reply.started":"2026-02-07T08:41:58.923977Z","shell.execute_reply":"2026-02-07T08:41:58.943585Z"}}
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

# %% [code] {"jupyter":{"outputs_hidden":false},"execution":{"iopub.status.busy":"2026-02-07T08:42:03.551532Z","iopub.execute_input":"2026-02-07T08:42:03.551863Z","iopub.status.idle":"2026-02-07T08:42:09.483713Z","shell.execute_reply.started":"2026-02-07T08:42:03.551837Z","shell.execute_reply":"2026-02-07T08:42:09.482537Z"}}
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

# %% [code] {"execution":{"iopub.status.busy":"2026-02-07T06:12:42.743172Z","iopub.execute_input":"2026-02-07T06:12:42.743521Z","iopub.status.idle":"2026-02-07T06:12:42.764984Z","shell.execute_reply.started":"2026-02-07T06:12:42.743495Z","shell.execute_reply":"2026-02-07T06:12:42.764124Z"}}
overall_deltas
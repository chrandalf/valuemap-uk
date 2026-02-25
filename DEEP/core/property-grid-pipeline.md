# Property Grid Pipeline

## Purpose

Transforms raw UK Land Registry transaction data into grid-aggregated price statistics at four spatial resolutions. Produces median prices, price-per-square-foot, price deltas, and postcode-to-outcode lookup indexes.

## Source File

`/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_property_artifacts.py`

## Inputs

| File | Description |
|---|---|
| `pipeline/data/raw/property/pp-2025.txt` | HM Land Registry Price Paid (England + Wales) |
| `pipeline/data/raw/property/Scotland_properties.csv` | Scotland transactions (optional) |
| `pipeline/data/raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv` | ONS Postcode Directory — BNG coordinates per postcode |
| `pipeline/data/raw/epc/epc_prop_all.csv` | EPC floor area (for PPSF metric) |

## Key Constants

```python
GRID_SIZES = [1000, 5000, 10000, 25000]        # metres
DELTA_GRID_SIZES = [5000, 10000, 25000]         # 1km excluded from deltas
MEDIAN_YEARS_BACK_BY_GRID = {1000: 0, 5000: 5, 10000: 5, 25000: 5}
PPSF_YEARS_BACK_BY_GRID   = {1000: 0, 5000: 5, 10000: 5, 25000: 5}
SQFT_PER_M2 = 10.76391041671
SCOTLAND_DAILY_THRESHOLD = 50  # busy-day detection for Scotland date anchoring
```

`years_back=0` for 1km means only the latest 12-month window is kept (no historical snapshots), keeping the artifact small.

## Core Functions

### `load_onspd(path) -> DataFrame`
Reads ONSPD in 500k-row chunks. Detects column names case-insensitively (`pcd7`/`pcds`, `east1m`/`x`, `north1m`/`y`). Returns `postcode_key` (normalised, no spaces), `east` (BNG easting), `north` (BNG northing).

### `load_pp(path, years_back) -> DataFrame`
Reads PP CSV with no header (16 named columns). Filters: `record_status == "A"` (active), date within `[today - years_back, today]`, price > 0. Adds `month` (truncated to month start), `postcode_key`, `paon_key` (normalised PAON for EPC matching).

### `load_scotland_properties(path, years_back, anchor_month) -> DataFrame`
Scotland data has different date format (`DD-MM-YYYY`). Scotland lacks property type/new-build flags so all records are typed as `D`/`N`. Uses busy-day heuristic (`SCOTLAND_DAILY_THRESHOLD = 50`) to detect the effective data cutoff date, then keeps 1 year back from that. If `anchor_month` is set, all Scotland dates are rebased to that month (aligns with England's latest month).

### `load_epc_latest(path) -> DataFrame`
Reads EPC CSV, extracts `postcode_key + paon_key → TOTAL_FLOOR_AREA`. For each (postcode, paon) pair, keeps the most recent inspection date. Used for PPSF calculation.

### `with_grid_cells(df, onspd) -> DataFrame`
Merges PP transactions onto ONSPD by `postcode_key`. For each grid size `g`, computes:
```python
gx_g = (east // g) * g      # floor to grid step
gy_g = (north // g) * g
cell_g = f"{gx_g}_{gy_g}"
```

### `aggregate_segments(window, g) -> DataFrame`
Produces four cross-joined segments per (gx, gy) pair:
- `(property_type, new_build)` — specific
- `(property_type, "ALL")` — any tenure
- `("ALL", new_build)` — any type
- `("ALL", "ALL")` — total

Aggregation: `median` of price, `tx_count` (row count). Uses pandas `.groupby().agg()`.

### `build_grid_outputs(df, output_dir, latest_end_month)`
For each grid size, computes `yearly_end_months()` — the latest end month plus one snapshot per year back. For each end month, computes a 12-month trailing window (`end_month - 11 months` to `end_month`), calls `aggregate_segments()`, and emits:
- `grid_{g}km_full.json.gz` — monolithic (legacy compatibility)
- `cells/{grid}/{metric}/{end_month}/{PTYPE}_{NB}.json.gz` — partitioned (current format)
- `cells/{grid}/{metric}/_manifest.json` — lists all available partitions

### `build_ppsf_outputs(df, epc_latest, output_dir)`
Joins EPC floor area onto PP transactions by `(postcode_key, paon_key)`. For missing floor areas, fills with the postcode-level average floor area for that property type/new-build segment. Computes:
```python
price_per_sqft = price / (TOTAL_FLOOR_AREA_FILLED * SQFT_PER_M2)
```
Minimum 3 transactions per cell segment (hard filter). Outputs `grid_{g}km_ppsf_full.json.gz` + partitioned files.

### `build_delta_outputs(df, output_dir, latest_end_month)`
Computes earliest available 12-month window vs latest 12-month window. Joins early and late aggregates on `(gx, gy, property_type, new_build)` (inner join — both periods must exist). Computes:
```python
delta_gbp = price_latest - price_earliest
delta_pct = ((price_latest / price_earliest) - 1.0) * 100.0
```
Outputs `deltas_overall_{g}km.json.gz` for 5km, 10km, 25km only.

### `build_postcode_indexes(onspd, output_dir)`
Creates a mapping `cell_key → [outcode, ...]` for each grid size. Used by `/api/postcodes` and `/api/outcodes` to list what outcodes fall within a clicked grid cell.

## Output Schema

### Grid cell row (median)
```json
{
  "gx": 385000,
  "gy": 801000,
  "end_month": "2025-12-01",
  "property_type": "ALL",
  "new_build": "ALL",
  "median": 285000.0,
  "tx_count": 47
}
```

### Grid cell row (PPSF)
```json
{
  "gx": 385000,
  "gy": 801000,
  "end_month": "2025-12-01",
  "property_type": "D",
  "new_build": "N",
  "median_ppsf": 312.5,
  "tx_count": 12
}
```

### Delta row
```json
{
  "gx_5000": 385000,
  "gy_5000": 800000,
  "gx": 385000,
  "gy": 800000,
  "cell_5000": "385000_800000",
  "cell": "385000_800000",
  "property_type": "ALL",
  "new_build": "ALL",
  "price_earliest": 240000.0,
  "sales_earliest": 38,
  "end_month_earliest": "2015-12-01",
  "price_latest": 285000.0,
  "sales_latest": 47,
  "end_month_latest": "2025-12-01",
  "delta_gbp": 45000.0,
  "delta_pct": 18.75,
  "years_delta": 10
}
```

### Postcode outcode index
```json
{ "385000_800000": ["SW1A", "SW1B", "SW1H"] }
```

## Running

```bash
python pipeline/build_property_artifacts.py \
  --pp pipeline/data/raw/property/pp-2025.txt \
  --onspd pipeline/data/raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv \
  --epc pipeline/data/raw/epc/epc_prop_all.csv \
  --years-back 10
```

Called automatically by `python pipeline/run_pipeline.py` (unless `--skip-property` is passed). After build, `prepare_property_assets.py` stages outputs for R2 upload.

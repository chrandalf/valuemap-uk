# Setup — ValueMap UK

## Frontend (Next.js)

### Prerequisites

- Node.js 20+
- npm (package-lock.json committed)

### Install and run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint       # ESLint check
```

### Key dependencies

| Package | Version | Purpose |
|---|---|---|
| next | 16.1.6 | App framework |
| react | 19.2.3 | UI |
| maplibre-gl | 5.17.0 | Map rendering |
| tailwindcss | ^4 | Styling |
| @cloudflare/workers-types | ^4.2026 | Type defs for Pages Functions |

---

## Pipeline (Python)

### Prerequisites

- Python 3.10+
- pip packages: `pandas`, `pyproj`, `boto3`, `botocore`

No `requirements.txt` is committed. Install manually:
```bash
pip install pandas pyproj boto3
```

### Raw data files required

Download and place in `pipeline/data/raw/` before running:

| File | Source | Path |
|---|---|---|
| `pp-2025.txt` | HM Land Registry Price Paid | `pipeline/data/raw/property/pp-2025.txt` |
| ONSPD CSV | ONS Geography Portal | `pipeline/data/raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv` |
| `epc_prop_all.csv` | MHCLG EPC register | `pipeline/data/raw/epc/epc_prop_all.csv` |
| `202425_performance_tables_schools_revised.csv` | DfE | `pipeline/data/raw/schools/` |
| `england_ks4revised.csv` | DfE | `pipeline/data/raw/schools/` |
| `open_flood_risk_by_postcode.csv` | Environment Agency | `pipeline/data/raw/flood/` |
| `HoC-GE2024-results-by-candidate.csv` | House of Commons | `pipeline/data/raw/elections/` |
| Westminster constituency GeoJSON | ONS / OS | `pipeline/data/raw/geography/Westminster_Parliamentary...geojson` |

### Run the full pipeline

```bash
python pipeline/run_pipeline.py
```

Options:
```bash
--skip-property         # skip property artifact build
--skip-schools          # skip school scoring
--skip-flood            # skip flood asset build
--skip-vote             # skip vote cell build
--mainstream-only       # only mainstream school variants
--publish-public        # copy model artifacts to public/data for inspection
--no-publish-r2-staging # skip staging to pipeline/data/publish
```

### Upload to Cloudflare R2

Set credentials as environment variables, then:
```bash
python pipeline/upload_model_assets_to_r2.py
```

Required env vars: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

Optional: `--skip-flood`, `--skip-property`, `--no-backup-before-upload`

---

## Cloudflare Pages Environment Bindings

Configure in the Cloudflare Pages dashboard under Settings > Environment Variables and Bindings:

| Binding | Type | Required |
|---|---|---|
| `BRICKGRID_BUCKET` | R2 Bucket | Yes (or `R2`) |
| `BMC_ACCESS_TOKEN` | Secret | No (supporters panel) |
| `SCHOOL_OVERLAY_KEY` | Text | No (key override) |
| `FLOOD_OVERLAY_KEY` | Text | No (key override) |
| `POSTCODE_LOOKUP_INDEX_KEY` | Text | No (key override) |

---

## Common Issues

**API returns 404 for cells data**: The R2 bucket binding is not configured, or the data artifacts have not been uploaded. Check Cloudflare Pages bindings and run the upload script.

**Pipeline fails on ONSPD column detection**: The ONSPD CSV column names change between ONS releases. The `load_onspd()` function detects `pcd7`/`pcds` (postcode), `east1m`/`x` (easting), `north1m`/`y` (northing). Verify the actual headers in your file.

**Scotland data absent or misaligned**: The Scotland CSV is optional. If absent, `load_scotland_properties()` returns an empty DataFrame silently. If dates look wrong, the busy-day threshold (`SCOTLAND_DAILY_THRESHOLD = 50`) may not match your data — check `tmp_scotland_diag.py` for diagnostics.

**boto3 not found on upload**: `pip install boto3` — it is not in the committed dependencies.

**`minTxCount` query param has no effect**: Must be an integer ≥ 1. Values < 1 are clamped to 1. The default `3` is a statistical noise filter — reducing it will show cells with 1–2 transactions.

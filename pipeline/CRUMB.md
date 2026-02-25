# pipeline/ — Python Data Pipeline

## WHAT
Offline Python pipeline that transforms raw government data into compressed JSON
artifacts uploaded to Cloudflare R2. Runs locally (not on a server). All data
domains — property prices, flood risk, school quality, election votes — are
processed here and staged before upload.

## KEY FILES
- `run_pipeline.py` — Orchestrator. Flags: --skip-property/schools/flood/vote,
  --mainstream-only, --publish-public, --no-publish-r2-staging.
- `paths.py` — Canonical path constants. Always import from here, never hardcode.
- `upload_model_assets_to_r2.py` — Uploads `pipeline/data/publish/` to R2 via
  boto3. Creates timestamped backup archive in `data/archive/r2/` by default.
- `upload_vote_cells_to_r2.py` — Dedicated uploader for vote cell JSON files.
- `build_property_artifacts.py` — Joins Land Registry price-paid (pp-2025.txt)
  with ONSPD centroids, bins to grids, outputs grid_*_full.json.gz + PPSF variants.
- `build_grids.py` — Legacy grid builder (Jupyter notebook version also exists).
- `build_flood_postcode_assets.py` — EA flood risk CSV to postcode lookup + GeoJSON.
- `build_school_scores.py` — DfE KS4 tables to 0-1 quality score per school.
- `build_school_postcode_scores.py` / `build_school_overlay_points.py` — Postcode
  scores and overlay GeoJSON for schools.
- `build_vote_*.py` — 2024 GE results to grid cell vote fractions and boundary GeoJSON.

## DATA DIRECTORY LAYOUT
pipeline/data/
├── raw/            # Source files — download manually before running
│   ├── property/   # pp-2025.txt, ONSPD postcode centroids CSV
│   ├── schools/    # DfE performance tables CSV, KS4 CSV
│   ├── flood/      # EA open_flood_risk_by_postcode.csv
│   ├── elections/  # HoC GE2024 results CSV
│   └── geography/  # Westminster constituency boundaries GeoJSON
├── intermediate/   # Wrangled working outputs (not uploaded)
├── model/          # Final artifacts ready for staging
└── publish/        # Staged copy of model/ — this is what gets uploaded to R2

## PATTERNS
- All scripts import path constants from `paths.py` — never hardcode paths
- `ensure_pipeline_dirs()` must be called at script start
- Artifacts are gzip-compressed JSON (.json.gz) or GeoJSON (.geojson.gz)
- Grid sizes: 1km, 5km, 10km, 25km (1km excluded from delta calculations)

## LANDMINES
- Raw source files are not in git — pp-2025.txt is multi-GB, must be placed manually
- R2 upload requires env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME
- No requirements.txt — install pandas, boto3 etc. manually before running
- Scotland anomaly filter (50 tx/day threshold) is hardcoded in build_property_artifacts.py

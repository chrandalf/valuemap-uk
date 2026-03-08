This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Rolled-back work after c6db026

The codebase is being restored to commit `c6db026` at the user's request. The work attempted after that point was mainly in two areas:

- 1km price-estimate UX changes: added extra estimate modes, changed the default 1km mode back to actual prices, adjusted popup copy to show actual vs estimate, and updated map styling for modelled cells.
- Commute filtering prototype: added a separate commute filter control where a user enters a work postcode and a maximum drive time, then the map filters 1km cells against a generated catchment shape.
- Commute backend experiments: first used a Cloudflare Pages function calling the Mapbox Isochrone API, then briefly added a free approximate fallback based on postcode-centered polygons to avoid paid routing costs.
- Find My Area interaction changes: kept commute filtering separate from weighted scoring, and added a lightweight fast path so commute-only filtering would not trigger the full scoring pass.
- Documentation and UI copy: added user-facing explanation text for 1km estimates and commute behavior.

This section exists so the attempted direction is documented even though the code has been rolled back.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Data Pipeline

## Tomorrow: First Review (Property Snapshots)

Before any new upload, review property snapshot outputs first:

- Median grids (`grid_*_full.json.gz`): **5 years back** (latest + yearly snapshots)
- PPSF grids (`grid_*_ppsf_full.json.gz`): **1km = 1 year back**, **5km/10km/25km = 3 years back**

Quick check command:

```bash
$tmp = "pipeline/tmp_policy_stats.py"
$code = @'
import gzip
import json
from pathlib import Path

base = Path("pipeline/data/publish/property")
print("MEDIAN FILES")
for g in ["1km", "5km", "10km", "25km"]:
	rows = json.loads(gzip.decompress((base / f"grid_{g}_full.json.gz").read_bytes()).decode("utf-8"))
	months = sorted({r.get("end_month") for r in rows if r.get("end_month") is not None})
	print(f"{g}: rows={len(rows)} months={len(months)} first={months[0] if months else None} last={months[-1] if months else None}")

print("\nPPSF FILES")
for g in ["1km", "5km", "10km", "25km"]:
	rows = json.loads(gzip.decompress((base / f"grid_{g}_ppsf_full.json.gz").read_bytes()).decode("utf-8"))
	months = sorted({r.get("end_month") for r in rows if r.get("end_month") is not None})
	print(f"{g}: rows={len(rows)} months={len(months)} first={months[0] if months else None} last={months[-1] if months else None}")
'@
Set-Content -Path $tmp -Value $code -Encoding UTF8
python $tmp
Remove-Item $tmp
```

Pipeline data is now organized under `pipeline/data`:

- `pipeline/data/raw` → source files you download/import
- `pipeline/data/intermediate` → wrangled/scored working outputs
- `pipeline/data/model` → final model-ready artifacts for overlays/upload
- `pipeline/data/publish` → staged artifacts copied from model, used as the R2 upload source

Run the full pipeline in the correct order:

```bash
python pipeline/run_pipeline.py
```

Property is now included in `run_pipeline` and is built from raw inputs in `pipeline/data/raw/property`:

- `pp-2025.txt`
- `ONSPD_Online_latest_Postcode_Centroids_.csv`

`run_pipeline` generates property artifacts (`grid_*_full.json.gz`, `grid_*_ppsf_full.json.gz`, `deltas_overall_*.json.gz`, `postcode_outcode_index_*.json.gz`) before staging/upload.

Useful options:

- `--skip-property`
- `--mainstream-only` (schools)
- `--skip-schools`, `--skip-flood`, `--skip-vote`
- `--publish-public` (copies model artifacts to `public/data` for local inspection)
- `--no-publish-r2-staging` (skip copying model artifacts to `pipeline/data/publish`)

Upload staged artifacts to R2:

```bash
python pipeline/upload_model_assets_to_r2.py
```

By default this now creates a timestamped backup archive of the current remote objects (same keys you are about to upload) in `pipeline/data/archive/r2/` before uploading.

If you need to skip this backup step:

```bash
python pipeline/upload_model_assets_to_r2.py --no-backup-before-upload
```

The same pre-upload backup behavior is enabled in: ggggg

- `python pipeline/upload_vote_cells_to_r2.py`
- legacy `pipeline/build_grids.py` uploads (disable there with env `R2_BACKUP_BEFORE_UPLOAD=0`, optional archive path via `R2_BACKUP_DIR`)

If flood assets are managed manually for now, upload only schools + vote:

```bash
python pipeline/upload_model_assets_to_r2.py --skip-flood
```

If property is also managed outside this flow, skip that group too:

```bash
python pipeline/upload_model_assets_to_r2.py --skip-flood --skip-property
```

## API notes (cells)

`functions/api/cells.ts` supports two useful query params:

- `minTxCount` (default `3`) → filters out low-sample cells (e.g. `tx_count` 1-2)
- `refresh=1` → bypasses in-memory worker cache and reloads latest grid object from R2

Example:

`/api/cells?grid=1km&metric=median&propertyType=ALL&newBuild=ALL&endMonth=LATEST&minTxCount=3&refresh=1`

## Raw data — from-scratch checklist

All inputs live under `pipeline/data/raw/`. Run `python pipeline/run_pipeline.py --help` for the full list of `--skip-*` flags.

### Auto-downloaded by the pipeline (no manual action needed)

| Raw file | Downloaded by | Source |
|---|---|---|
| `raw/property/pp-2025.txt` (~5 GB) | `build_grids.py` | [HMLR Price Paid Data (complete)](http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-complete.txt) — OGL v3 |
| `raw/crime/latest.zip` (~1.6 GB) | `build_crime_overlay.py` | [data.police.uk bulk archive](https://data.police.uk/data/archive/latest.zip) — OGL v3 |
| `raw/census/ts007a_age_lsoa21.csv` | `fetch_age_data.py` | Nomis API — dataset NM_2020_1 (TS007A), no key needed |
| `raw/census/ts058_commute_lsoa21.csv` | `fetch_commute_data.py` | Nomis API — dataset NM_2075_1 (TS058), no key needed |
| `raw/schools/ofsted_mi_state_schools.csv` | `build_primary_school_ofsted_overlay.py --download` | [Ofsted Management Information](https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes) — OGL v3 |

### Must be downloaded manually before running

| Raw file | Where to get it | Licence |
|---|---|---|
| `raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv` | [ONS Geography Portal — ONSPD latest centroids](https://geoportal.statistics.gov.uk/datasets/ons-postcode-directory-latest-centroids) | OGL v3 |
| `raw/schools/england_ks4revised.csv` | [DfE Compare School Performance — download data, KS4 revised](https://www.compare-school-performance.service.gov.uk/download-data) | OGL v3 |
| `raw/schools/202425_performance_tables_schools_revised.csv` | Same DfE download portal — select year 2024/25, revised, all schools | OGL v3 |
| `raw/epc/all-domestic-certificates.zip` (~4 GB) | [MHCLG EPC bulk download](https://epc.opendatacommunities.org/domestic/search) — free registration, download all domestic EPCs | OGL v3 |
| `raw/elections/HoC-GE2024-results-by-candidate.csv` | [House of Commons Research Briefings — CBP-10077](https://researchbriefings.files.parliament.uk/documents/CBP-10077/HoC-GE2024-results-by-candidate.csv) | OPL v3 |
| `raw/geography/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFE_*.geojson` | [ONS Geography Portal — Westminster Constituencies July 2024 BFE](https://geoportal.statistics.gov.uk/datasets/ons::westminster-parliamentary-constituencies-july-2024-boundaries-uk-bfe) | OGL v3 |
| `raw/flood/open_flood_risk_by_postcode.csv` | Kaggle (temporary source — official EA integration not yet done) | — |
| `raw/Stations/GB train stations.json` | **Source not yet documented** — see note below | — |

> **Station data note:** The `GB train stations.json` GeoJSON is not yet linked to a confirmed upstream source in the codebase. Probable candidates are the ORR (Office of Rail and Road), NaPTAN, or an Overpass API export from OpenStreetMap (the file has `name`, `code` (CRS), and `owner` fields). This must be confirmed before a reproducible from-scratch build of the station overlay is possible.

### Upload scripts

| What | Script |
|---|---|
| Property, schools, stations, flood, vote, crime, EPC | `python pipeline/upload_model_assets_to_r2.py` |
| Census age cells | `python pipeline/upload_age_cells_to_r2.py` |
| Census commute cells | `python pipeline/upload_commute_cells_to_r2.py` |
| Country lookup assets | `python pipeline/_upload_country_assets.py` |


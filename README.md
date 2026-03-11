# ValueMap UK

A Next.js app for exploring UK property prices, flood risk, school quality, broadband speeds, crime stats, and more — all layered on an interactive grid map. Built for house hunters who want actual data rather than estate agent copy.

Deployed on Cloudflare Pages, with Workers handling the data APIs and R2 storing pre-built grid assets.

###Dev server

\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000). Main file to edit: \`app/page.tsx\` — hot-reloads automatically.

---

## Notes on the c6db026 rollback

Rolled back to \`c6db026\` after a couple of experiments that didn't work out:

- **1km price estimates** — tried extra estimate modes and updated the popup copy to show actual vs modelled prices. Reverted because it made the UI more confusing than helpful.
- **Commute filtering** — built a filter where you enter a work postcode and max drive time, and the map greys out cells outside the catchment. First used the Mapbox Isochrone API, then switched to a free postcode-radius fallback to avoid routing costs. Pulled it because the UX wasn't right and it slowed down the filter path.

Keeping this here so I remember what's been tried.

---

## Data Pipeline

### Before uploading — check property snapshots

Before any new upload, review the property snapshot outputs:

- Median grids (\`grid_*_full.json.gz\`): should have **5 years back** (latest + yearly snapshots)
- PPSF grids (\`grid_*_ppsf_full.json.gz\`): **1km = 1 year back**, **5km/10km/25km = 3 years back**

### Folder layout

\`\`\`
pipeline/data/raw/          # source files (downloaded or manually added)
pipeline/data/intermediate/ # wrangled / scored working outputs
pipeline/data/model/        # final model-ready artifacts
pipeline/data/publish/      # staged files copied from model — this is what gets uploaded to R2
\`\`\`

### Run the full pipeline

\`\`\`bash
python pipeline/run_pipeline.py
\`\`\`

Useful flags:

- \`--skip-property\`
- \`--mainstream-only\` (schools)
- \`--skip-schools\`, \`--skip-flood\`, \`--skip-vote\`
- \`--publish-public\` — copies model artifacts to \`public/data\` for local inspection
- \`--no-publish-r2-staging\` — skips copying to \`pipeline/data/publish\`

### Upload to R2

\`\`\`bash
python pipeline/upload_model_assets_to_r2.py
\`\`\`

Creates a timestamped backup of current remote objects in \`pipeline/data/archive/r2/\` before uploading. Skip with \`--no-backup-before-upload\`.

Upload only the freshness metadata (no asset groups):

\`\`\`bash
python pipeline/upload_model_assets_to_r2.py --skip-property --skip-vote --skip-schools --skip-stations --skip-flood --skip-crime --skip-epc --skip-model --skip-broadband
\`\`\`

---

## API notes (cells)

\`functions/api/cells.ts\` supports two useful params:

- \`minTxCount\` (default \`3\`) — filters out low-sample cells
- \`refresh=1\` — bypasses the in-memory worker cache, reloads latest grid from R2

Example: \`/api/cells?grid=1km&metric=median&propertyType=ALL&newBuild=ALL&endMonth=LATEST&minTxCount=3&refresh=1\`

---

## Raw data — from-scratch checklist

Everything lives under \`pipeline/data/raw/\`. Run \`python pipeline/run_pipeline.py --help\` for all \`--skip-*\` flags.

### Auto-downloaded by the pipeline

| Raw file | Downloaded by | Source |
|---|---|---|
| \`raw/property/pp-2025.txt\` (~5 GB) | \`build_grids.py\` | [HMLR Price Paid Data](http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-complete.txt) — OGL v3 |
| \`raw/crime/latest.zip\` (~1.6 GB) | \`build_crime_overlay.py\` | [data.police.uk bulk archive](https://data.police.uk/data/archive/latest.zip) — OGL v3 |
| \`raw/census/ts007a_age_lsoa21.csv\` | \`fetch_age_data.py\` | Nomis API — dataset NM_2020_1 (TS007A) |
| \`raw/census/ts058_commute_lsoa21.csv\` | \`fetch_commute_data.py\` | Nomis API — dataset NM_2075_1 (TS058) |
| \`raw/schools/ofsted_mi_state_schools.csv\` | \`build_primary_school_ofsted_overlay.py --download\` | [Ofsted Management Information](https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes) — OGL v3 |

### Must be downloaded manually

| Raw file | Where to get it | Licence |
|---|---|---|
| \`raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv\` | [ONS Geography Portal — ONSPD latest centroids](https://geoportal.statistics.gov.uk/datasets/ons-postcode-directory-latest-centroids) | OGL v3 |
| \`raw/schools/england_ks4revised.csv\` | [DfE Compare School Performance — KS4 revised](https://www.compare-school-performance.service.gov.uk/download-data) | OGL v3 |
| \`raw/schools/202425_performance_tables_schools_revised.csv\` | Same DfE portal — year 2024/25, revised, all schools | OGL v3 |
| \`raw/epc/all-domestic-certificates.zip\` (~4 GB) | [MHCLG EPC bulk download](https://epc.opendatacommunities.org/domestic/search) — free registration | OGL v3 |
| \`raw/elections/HoC-GE2024-results-by-candidate.csv\` | [House of Commons Research Briefings — CBP-10077](https://researchbriefings.files.parliament.uk/documents/CBP-10077/HoC-GE2024-results-by-candidate.csv) | OPL v3 |
| \`raw/geography/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFE_*.geojson\` | [ONS Geography Portal — Westminster Constituencies July 2024 BFE](https://geoportal.statistics.gov.uk/datasets/ons::westminster-parliamentary-constituencies-july-2024-boundaries-uk-bfe) | OGL v3 |
| \`raw/flood/open_flood_risk_by_postcode.csv\` | Kaggle (temporary — official EA integration not done yet) | — |
| \`raw/Stations/GB train stations.json\` | Source not yet confirmed — probably ORR, NaPTAN, or an OSM Overpass export | — |

> **Station data note:** I haven't pinned down the exact upstream source for the stations GeoJSON yet. The file has \`name\`, \`code\` (CRS), and \`owner\` fields which suggest NaPTAN or ORR, but it needs confirming before the station overlay can be rebuilt from scratch.

### Upload scripts

| What | Script |
|---|---|
| Property, schools, stations, flood, vote, crime, EPC, broadband | \`python pipeline/upload_model_assets_to_r2.py\` |
| Census age cells | \`python pipeline/upload_age_cells_to_r2.py\` |
| Census commute cells | \`python pipeline/upload_commute_cells_to_r2.py\` |
| Country lookup assets | \`python pipeline/_upload_country_assets.py\` |
| Data freshness manifest | Runs automatically at the end of \`upload_model_assets_to_r2.py\` |

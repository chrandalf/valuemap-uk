# Architecture Overview — ValueMap UK

## System Pattern

Three-tier pipeline-to-edge architecture:

```
[Python Pipeline] --> [Cloudflare R2] --> [Cloudflare Pages Functions] --> [Next.js SPA]
```

- **Pipeline**: Python scripts run locally or in CI to produce static data artifacts
- **Storage**: Cloudflare R2 object storage holds all artifacts (gzipped JSON/GeoJSON)
- **Edge API**: Cloudflare Pages Functions serve data from R2 with in-memory worker caching
- **Frontend**: Next.js App Router SPA (single page) renders a MapLibre GL map with filters and overlays

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5 |
| Map renderer | MapLibre GL 5 |
| Styling | Tailwind CSS 4 |
| Edge runtime | Cloudflare Pages Functions (Workers runtime) |
| Storage | Cloudflare R2 (S3-compatible) |
| Data pipeline | Python 3, pandas, pyproj |
| Upload client | boto3 (S3-compatible endpoint) |

## Components

### pipeline/
Python data processing. Produces all static artifacts. No real-time data fetching — runs offline using government open data files as input. Outputs are gzipped JSON to `pipeline/data/model/`, then staged to `pipeline/data/publish/` before R2 upload.

Source data:
- HM Land Registry Price Paid data (`pp-2025.txt`)
- ONS Postcode Directory (ONSPD) for coordinate lookup
- EPC (Energy Performance Certificate) floor area data
- DfE KS4 school performance tables (England only)
- Environment Agency flood risk by postcode CSV
- House of Commons GE2024 election results CSV
- Westminster Parliamentary Constituency boundary GeoJSON

### functions/api/
Cloudflare Pages Functions. Each file maps to one API route. All data is fetched from R2 on cold start, then held in module-scope Maps/objects for the lifetime of the worker isolate.

Routes:
- `cells.ts` → `/api/cells` — property price grid cells
- `deltas.ts` → `/api/deltas` — price change grid cells
- `schools.ts` → `/api/schools` — school overlay GeoJSON
- `flood.ts` → `/api/flood` — flood risk GeoJSON
- `outcodes.ts` → `/api/outcodes` — postcode outcode rankings
- `postcodes.ts` → `/api/postcodes` — postcodes within a grid cell
- `supporters.ts` → `/api/supporters` — Buy Me a Coffee supporter names

### app/
Single-page Next.js application. `app/page.tsx` is the only interactive route — it owns all UI state. `app/Map.tsx` is a large client component that wraps MapLibre GL, data fetching, and map rendering logic. All other `app/` subdirectories are static content pages (legal, instructions, data-sources, etc.).

## Grid System

All property data is pre-aggregated into four grid resolutions using British National Grid (EPSG:27700) coordinates:

| Label | Cell size (metres) | Use |
|---|---|---|
| 1km | 1,000 × 1,000 | Fine-grained local view |
| 5km | 5,000 × 5,000 | Default on load |
| 10km | 10,000 × 10,000 | Regional view |
| 25km | 25,000 × 25,000 | National overview |

Grid coordinates (`gx`, `gy`) are the south-west corner of each cell in BNG metres, floored to the grid step. Cell centres are computed as `gx + grid_meters/2`, `gy + grid_meters/2`.

## Data Flow Summary

See `/Users/bsr/repos/repos-external/valuemap-uk/DEEP/architecture/data-flow.md` for end-to-end detail.

## Related Files

- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/paths.py` — all canonical path constants
- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/run_pipeline.py` — orchestrator
- `/Users/bsr/repos/repos-external/valuemap-uk/functions/api/cells.ts` — primary API handler
- `/Users/bsr/repos/repos-external/valuemap-uk/app/Map.tsx` — map rendering and data fetching

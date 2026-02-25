# valuemap-uk

## WHAT
Interactive UK house price map built on Next.js + MapLibre GL. Displays Land Registry
transaction data as grid cells (1km–25km resolution) with overlays for flood risk,
school quality, and 2024 election voting patterns. A Python data pipeline transforms
raw government data into gzip-compressed JSON artifacts stored in Cloudflare R2,
served by Cloudflare Pages Functions.

## STATE
ACTIVE — Property data current to Dec 2025.

## MAP

valuemap-uk/
├── app/          # Next.js App Router — map UI + static info pages → CRUMB.md
│   ├── page.tsx  # All filter/overlay state + UI panels
│   ├── Map.tsx   # MapLibre GL rendering, data fetching, overlays
│   └── */        # Static info pages (contact, data-sources, legal, …)
├── functions/    # Cloudflare Pages Functions (edge API) → CRUMB.md
│   └── api/      # cells, deltas, flood, schools, outcodes, postcodes
├── pipeline/     # Python data pipeline — build + upload artifacts → CRUMB.md
│   ├── run_pipeline.py
│   ├── paths.py
│   └── build_*.py / upload_*.py
└── public/       # Static SVG assets

## KEY DECISIONS
- Static export (next.config.ts `output: "export"`) not SSR — avoids server runtime,
  entire frontend deploys as static files on Cloudflare Pages
- Cloudflare R2 not a traditional DB — all grid data stored as partitioned .json.gz
  objects; edge workers decompress and filter at request time
- Python pipeline not TypeScript — data processing uses pandas/numpy ecosystem
  which is impractical in JS; pipeline runs locally and uploads artifacts
- Separate median vs PPSF metrics — PPSF requires EPC floor area join, producing
  distinct artifact sets (grid_*_full vs grid_*_ppsf_full)
- Cells API caches at partition level not monolithic file — reduces cold-fetch
  latency; `refresh=1` bypasses the cache

## LANDMINES
- `page.tsx` and `Map.tsx` are intentionally large monoliths — all UI state and
  all map rendering logic each live in a single file
- `NEXT_PUBLIC_VOTE_CELLS_DATA_VERSION` (Map.tsx fallback `"20260222b"`) must be
  updated when new vote cell data is uploaded to R2
- `pipeline/data/` is not in git — raw source files must be obtained manually
- R2 upload backs up remote objects before overwriting by default

## DEPTH
- app/CRUMB.md — Frontend components and page routing
- functions/CRUMB.md — Edge API route handlers
- pipeline/CRUMB.md — Data pipeline scripts and artifact structure

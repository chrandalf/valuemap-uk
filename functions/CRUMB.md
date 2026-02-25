# functions/ — Cloudflare Pages Functions (Edge API)

## WHAT
Cloudflare Pages Functions — TypeScript edge handlers that run at the CDN edge.
Each file under `functions/api/` maps to a `/api/<name>` route. They read gzip-
compressed JSON artifacts from Cloudflare R2 and return filtered JSON to the browser.
No traditional server; all state is in R2 objects or worker-scoped in-memory cache.

## KEY FILES
- `api/cells.ts` — Primary data endpoint. Reads partitioned grid cell files from R2
  (`cells/{grid}/{metric}/{endMonth}/{propertyType}_{newBuild}.json.gz`). Has in-memory
  partition cache with TTL. Falls back to legacy monolithic files if partition missing.
  Backfills vote data onto rows before returning. Params: grid, metric, propertyType,
  newBuild, endMonth, minTxCount, refresh.
- `api/deltas.ts` — Returns price-change (delta) rows for a grid+segment. Joins vote
  lookup onto rows. Used for delta_gbp / delta_pct metric views.
- `api/flood.ts` — Streams flood overlay GeoJSON.gz from R2. Supports meta=1 and
  plain=1 (decompressed) query params.
- `api/schools.ts` — Streams school overlay GeoJSON.gz from R2. Same pattern as flood.
- `api/outcodes.ts` — Aggregates cell medians into outcode-level weighted averages.
  Joins postcode→outcode index from R2. Used by the outcode ranking panel in the UI.
- `api/postcodes.ts` — Returns postcodes within a given grid cell (by gx/gy or cell
  key). Paginates via limit/offset. Used by cell click popups.
- `api/supporters.ts` — Proxies Buy Me a Coffee API for supporter names display.
- `ping.ts` — Health check, returns "pong".

## PATTERNS
- All handlers export `onRequestGet` — Cloudflare Pages Functions convention
- R2 bucket accessed via `env.R2` or `env.BRICKGRID_BUCKET` (both checked)
- In-memory Maps used as worker-scoped caches (survive across requests in same isolate)
- All grid data is gzip-compressed JSON; handlers decompress via DecompressionStream
- Partition key format: `cells/{grid}/{metric}/{endMonth}/{propertyType}_{newBuild}.json.gz`

## DEPENDENCIES
- `@cloudflare/workers-types` — TypeScript types for R2Bucket, PagesFunction, etc.
- R2 bucket: `valuemap-uk` (configured via Cloudflare Pages bindings)
- Env vars required: none strictly, but `FLOOD_OVERLAY_KEY`, `SCHOOL_OVERLAY_KEY`,
  `POSTCODE_LOOKUP_KEY`, `POSTCODE_LOOKUP_INDEX_KEY`, `BMC_ACCESS_TOKEN` are optional
  overrides

## LANDMINES
- In-memory cache is per-worker-isolate — Cloudflare may spawn multiple isolates,
  so cache is not shared globally; `refresh=1` param forces re-fetch from R2
- `cells.ts` has a legacy monolithic fallback path for older (pre-partitioned) R2
  objects — this path will be removed eventually once all grids are partitioned
- Vote data is backfilled in cells.ts from a separate R2 object; if vote cells
  version mismatches the frontend constant, cells will lack vote fields

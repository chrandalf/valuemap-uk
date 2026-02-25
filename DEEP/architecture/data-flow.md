# Data Flow — ValueMap UK

## Pipeline Phase (offline, developer-run)

```
Raw inputs (government CSVs)
    │
    ▼
build_property_artifacts.py
    ├── load_onspd()        → postcode → BNG easting/northing lookup
    ├── load_pp()           → HM Land Registry price paid (chunked, filtered)
    ├── load_scotland_properties() → optional Scotland CSV
    ├── load_epc_latest()   → EPC floor area for PPSF metric
    ├── with_grid_cells()   → assigns gx/gy for all four grid sizes
    ├── build_grid_outputs()   → grid_Xkm_full.json.gz (median prices)
    │                            + cells/{grid}/{metric}/{month}/{type}_{nb}.json.gz
    │                            + cells/{grid}/{metric}/_manifest.json
    ├── build_ppsf_outputs()   → grid_Xkm_ppsf_full.json.gz (price/sqft)
    ├── build_delta_outputs()  → deltas_overall_Xkm.json.gz (earliest vs latest)
    └── build_postcode_indexes() → postcode_outcode_index_Xkm.json.gz
         (cell_key → [outcode, ...])

build_school_scores.py
    └── DfE performance CSV → school_scores_202425.csv (ranked quality scores)

build_school_postcode_scores.py
    └── england_ks4revised.csv → school_postcode_scores_202425.csv

build_school_overlay_points.py
    └── school_postcode_scores → school_overlay_points.geojson.gz

build_flood_postcode_assets.py
    └── EA flood CSV → flood_postcode_lookup.json.gz
                    → flood_outcode_summary.json.gz
                    → flood_postcode_points.geojson.gz

build_vote_blocks.py       → ge2024_vote_blocks_by_constituency.csv
build_vote_overlay_geojson.py → ge2024_vote_blocks_map.geojson
build_vote_cells_by_grid.py → vote_cells_Xkm.json.gz
    └── uses pyproj EPSG:27700 → EPSG:4326 transform
        + ray-casting point-in-polygon against constituency boundaries
        + spatial tile index (0.25° tiles) for O(1) polygon lookup
```

## Staging and Upload

```
pipeline/data/model/   (canonical build output)
    │
    ▼  copy_model_to_publish() in run_pipeline.py
    │
pipeline/data/publish/  (R2 upload staging area)
    │
    ▼  python pipeline/upload_model_assets_to_r2.py
    │   uses boto3 against Cloudflare R2 S3 endpoint
    │   pre-upload: downloads existing R2 objects → timestamped zip archive
    │
Cloudflare R2 bucket "valuemap-uk"
```

## Request Phase (runtime, Cloudflare Workers)

```
Browser → GET /api/cells?grid=5km&metric=median&propertyType=ALL&newBuild=ALL&endMonth=2025-12-01
    │
    ▼  cells.ts onRequestGet()
    ├── getManifest(env, grid, metric)
    │     R2 key: cells/{grid}/{metric}/_manifest.json
    │     cached 10 min in MANIFEST_CACHE (module-scope Map)
    │
    ├── partitionKey = cells/{grid}/{metric}/{endMonth}/{propertyType}_{newBuild}.json.gz
    ├── PARTITION_CACHE.get(partitionKey)  (10 min TTL)
    │     hit → skip R2
    │     miss → bucket.get(partitionKey) → gunzip → parse
    │
    ├── applyFilters(rows, minTxCount, metric)
    │     filters tx_count < minTxCount (default 3)
    │     normalises metric field name (median_ppsf → median)
    │
    ├── backfillVotes(env, grid, rows)
    │     VOTE_CACHE_BY_GRID[grid]  (no TTL, lives for isolate lifetime)
    │     merges pct_progressive / pct_conservative / pct_popular_right
    │     keyed by gx_gy string
    │
    └── Response.json({ grid, metric, end_month, rows })
        Cache-Control: public, max-age=1200

Browser → GET /api/deltas?grid=5km&propertyType=ALL&newBuild=ALL
    ├── deltaCache (module-scope, no TTL)
    │     R2 key: deltas_overall_{grid}.json.gz
    ├── voteCache (module-scope, no TTL)
    └── filters rows by propertyType + newBuild; joins vote data by gx/gy

Browser → GET /api/outcodes?grid=5km&...
    ├── getCachedGrid() → grid_Xkm_full.json.gz from R2 (module-scope, no TTL)
    ├── loadOutcodeIndex() → postcode_outcode_index_Xkm.json.gz
    └── weighted median per outcode:
        sum(median * tx_count) / sum(tx_count) per cell → outcode rollup
        returns sorted top[] and bottom[] arrays
```

## Frontend Data Fetch (Map.tsx)

```
MapState change (grid / metric / propertyType / newBuild / endMonth)
    │
    ▼
isDeltaMetric(metric) ?
  fetch /api/deltas?grid=...    (price change data, static cache 6h)
: fetch /api/cells?grid=...     (snapshot data, cache 20 min)
    │
    ▼
MapLibre GL layer update:
  - fill-color expression using quantile breaks (jenks-style)
  - fill-opacity varies by tx_count (low volume = more transparent)
  - flood / school / vote overlays rendered as separate layers on top
```

## R2 Object Key Naming

| Object | R2 key pattern |
|---|---|
| Partition (new format) | `cells/{grid}/{metric}/{YYYY-MM-DD}/{PTYPE}_{NB}.json.gz` |
| Partition manifest | `cells/{grid}/{metric}/_manifest.json` |
| Legacy monolithic | `grid_{grid}_full.json.gz` |
| Legacy PPSF monolithic | `grid_{grid}_ppsf_full.json.gz` |
| Delta | `deltas_overall_{grid}.json.gz` |
| Postcode-outcode index | `postcode_outcode_index_{grid}.json.gz` |
| Vote cells | `vote_cells_{grid}.json.gz` |
| School overlay | `school_overlay_points.geojson.gz` |
| Flood lookup | `flood_postcode_lookup.json.gz` |
| Flood outcode summary | `flood_outcode_summary.json.gz` |
| Flood points GeoJSON | `flood_postcode_points.geojson.gz` |

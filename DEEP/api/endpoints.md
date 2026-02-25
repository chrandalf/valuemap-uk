# API Endpoints

All endpoints are Cloudflare Pages Functions in `/Users/bsr/repos/repos-external/valuemap-uk/functions/api/`. All are GET-only. All data is served from Cloudflare R2 with in-memory worker caching.

## R2 Bucket Resolution

Every handler resolves the R2 bucket with:
```typescript
const bucket = env.BRICKGRID_BUCKET ?? env.R2;
```
If neither binding exists the handler throws and returns 5xx.

---

## GET /api/cells

**File**: `functions/api/cells.ts`

Property price grid cells for a given resolution, metric, segment, and time period.

### Query Parameters

| Param | Default | Values | Description |
|---|---|---|---|
| `grid` | `25km` | `1km\|5km\|10km\|25km` | Grid resolution |
| `metric` | `median` | `median\|median_ppsf` | Price metric |
| `propertyType` | `ALL` | `ALL\|D\|S\|T\|F` | Property type filter |
| `newBuild` | `ALL` | `ALL\|Y\|N` | New build filter |
| `endMonth` | `LATEST` | `LATEST\|YYYY-MM-DD` | Time period |
| `minTxCount` | `3` | integer ≥ 1 | Min transaction count filter |
| `refresh` | — | `1` | Bypasses in-memory partition cache |

### Response

```json
{
  "grid": "5km",
  "metric": "median",
  "end_month": "2025-12-01",
  "propertyType": "ALL",
  "newBuild": "ALL",
  "minTxCount": 3,
  "count": 4200,
  "rows": [
    {
      "gx": 385000, "gy": 800000,
      "end_month": "2025-12-01",
      "property_type": "ALL", "new_build": "ALL",
      "median": 285000, "tx_count": 47,
      "pct_progressive": 54.2, "pct_conservative": 28.1,
      "pct_popular_right": 12.3,
      "constituency": "Cities of London and Westminster"
    }
  ]
}
```

`Cache-Control: public, max-age=1200`

### Caching

- **Partition cache**: `PARTITION_CACHE` — `Map<string, {rows, loadedAtMs}>` — 10-minute TTL. Key is the R2 partition object key.
- **Manifest cache**: `MANIFEST_CACHE` — same TTL. Key is `cells/{grid}/{metric}/_manifest.json`.
- **Vote cache**: `VOTE_CACHE_BY_GRID` — no TTL (lives for worker isolate lifetime).
- **Legacy cache**: `LEGACY_CACHE` — 10-minute TTL for monolithic files.

### Fallback Path

If the partition manifest is absent (R2 returns 404), or if the exact partition file is not found, the handler falls back to loading the legacy monolithic file (`grid_{grid}_full.json.gz`) and filtering in memory.

---

## GET /api/deltas

**File**: `functions/api/deltas.ts`

Price change statistics comparing the earliest and latest available 12-month windows.

### Query Parameters

| Param | Default | Values |
|---|---|---|
| `grid` | `25km` | `5km\|10km\|25km` (1km not supported) |
| `propertyType` | `ALL` | `ALL\|D\|S\|T\|F` |
| `newBuild` | `ALL` | `ALL\|Y\|N` |

### Response

```json
{
  "grid": "5km",
  "propertyType": "ALL",
  "newBuild": "ALL",
  "count": 3800,
  "timeRange": {
    "earliest": "2015-12-01",
    "latest": "2025-12-01"
  },
  "rows": [ /* DeltaRow[] with vote fields backfilled */ ]
}
```

`Cache-Control: public, max-age=21600` (6 hours — deltas change rarely)

### Caching

`deltaCache` and `voteCache` — module-scope Maps, no TTL (cleared only on isolate restart).

---

## GET /api/schools

**File**: `functions/api/schools.ts`

Proxies the school overlay GeoJSON from R2. No filtering or transformation.

### Query Parameters

| Param | Description |
|---|---|
| `key` | Override R2 object key (default: `school_overlay_points.geojson.gz`) |
| `plain=1` | Decompress gzip before sending |
| `meta=1` | Return metadata only (size, etag, upload date) |

### Key Resolution

Tries up to 7 candidate key paths (raw, without leading slash, basename only, `valuemap-uk/` prefix, `v1/` prefix).

`Cache-Control: public, max-age=3600`

---

## GET /api/flood

**File**: `functions/api/flood.ts`

Proxies the flood risk GeoJSON from R2. Identical interface to `/api/schools`.

Default key: `flood_postcode_points.geojson.gz`

`Cache-Control: public, max-age=3600`

---

## GET /api/outcodes

**File**: `functions/api/outcodes.ts`

Weighted median price per postcode outcode, ranked lowest to highest and highest to lowest.

### Query Parameters

| Param | Default | Description |
|---|---|---|
| `grid` | `25km` | Grid resolution |
| `propertyType` | `ALL` | Property type filter |
| `newBuild` | `ALL` | New build filter |
| `endMonth` | `LATEST` | Time period |
| `indexKey` | `postcode_outcode_index_{grid}.json.gz` | Override R2 index key |

### Algorithm

1. Load grid cells (from monolithic `grid_{grid}_full.json.gz`), filter by segment + endMonth.
2. Load outcode index (`postcode_outcode_index_{grid}.json.gz`): `cell_key → [outcode, ...]`.
3. For each cell in the index, look up its median and tx_count. For each outcode that cell maps to:
   ```
   sum += median * tx_count
   weight += tx_count
   ```
4. Outcode median = `sum / weight`.
5. Return sorted `top[]` (highest first) and `bottom[]` (lowest first).

### Response

```json
{
  "grid": "5km", "end_month": "2025-12-01",
  "propertyType": "ALL", "newBuild": "ALL",
  "count": 2800,
  "top": [{ "outcode": "KT2", "median": 820000, "weight": 234 }],
  "bottom": [{ "outcode": "WN1", "median": 95000, "weight": 89 }]
}
```

`Cache-Control: public, max-age=3600`

---

## GET /api/postcodes

**File**: `functions/api/postcodes.ts`

Lists postcode strings (actually outcode strings) within a given grid cell.

### Query Parameters

| Param | Default | Description |
|---|---|---|
| `grid` | `25km` | Grid resolution |
| `cell` | — | Cell key string `"gx_gy"` |
| `gx` | — | Alternative to `cell` |
| `gy` | — | Alternative to `cell` |
| `limit` | `10` | Page size (1–100) |
| `offset` | `0` | Page offset |
| `indexKey` | `postcode_outcode_index_{grid}.json.gz` | Override index key |

### Response

```json
{
  "grid": "5km", "cell": "385000_800000",
  "total": 12, "offset": 0, "limit": 10, "has_more": true,
  "postcodes": ["SW1A", "SW1B", "SW1H"]
}
```

`Cache-Control: public, max-age=1200`

### Caching

`INDEX_CACHE` — module-scope Map, keyed by index key string, no TTL.

---

## GET /api/supporters

**File**: `functions/api/supporters.ts`

Fetches supporter names from Buy Me a Coffee API. Requires `BMC_ACCESS_TOKEN` env binding.

### Response

```json
{ "ok": true, "items": ["Alice", "Bob"] }
```

Returns empty list (not an error) if `BMC_ACCESS_TOKEN` is not configured.

`Cache-Control: public, max-age=600`

### Error Codes

| Code | Meaning |
|---|---|
| 400 | Invalid `grid` or `metric` parameter |
| 404 | R2 object not found (schools/flood) |
| 500 | R2 read error |
| 502 | Upstream API error (supporters) |
| 503 | Unexpected exception in handler |

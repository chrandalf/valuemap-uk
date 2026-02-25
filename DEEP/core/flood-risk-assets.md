# Flood Risk Assets

## Purpose

Converts Environment Agency postcode-level flood risk data into three lookup artifacts used by the map overlay and postcode search feature.

## Source File

`/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_flood_postcode_assets.py`

## Input

`pipeline/data/raw/flood/open_flood_risk_by_postcode.csv`

Source: Environment Agency "Open Flood Risk by Postcode" dataset (open licence).

## Risk Score Mapping

```python
RISK_SCORE = {
    "none":     0,
    "very low": 1,
    "low":      2,
    "medium":   3,
    "high":     4,
}
```

The risk band string is lowercased and normalised before mapping. Unknown bands default to `0`.

## Processing Steps

1. **Column detection** — column names are normalised (`re.sub(r"[^a-z0-9]+", "_", ...)`) so the script handles minor header variations without failing.

2. **Deduplication** — multiple flood risk records can exist per postcode (e.g. surface water vs river). Records are sorted by `(postcode_key, risk_score DESC, pub_date DESC)` and deduplicated to one row per postcode, keeping the most severe and most recent assessment.

3. **Optional restriction** — if `--restrict-postcodes-file` is passed, only postcodes present in that file are included. Supports JSON dict keys, JSON arrays, CSV with a postcode column, or newline-delimited text.

4. **Three outputs are written:**

### Output 1: `flood_postcode_lookup.json.gz`

Dictionary keyed by normalised postcode key. Excludes `risk_score = 0` by default (risk-free postcodes not stored to keep size down).

```json
{
  "SW1A1AA": {
    "postcode": "SW1A 1AA",
    "outcode": "SW1A",
    "risk_band": "High",
    "risk_score": 4,
    "pub_date": "2023-01-01",
    "easting": 529090,
    "northing": 179645,
    "latitude": 51.501,
    "longitude": -0.1246
  }
}
```

### Output 2: `flood_outcode_summary.json.gz`

One record per outcode (e.g. `SW1A`) with aggregate stats:

```json
{
  "outcode": "SW1A",
  "postcode_count": 120,
  "max_risk_score": 4,
  "mean_risk_score": 1.23,
  "high_count": 3,
  "medium_count": 8,
  "low_count": 45,
  "very_low_count": 64,
  "none_count": 0
}
```

### Output 3: `flood_postcode_points.geojson.gz`

GeoJSON FeatureCollection. Each feature is a Point at the postcode's lat/lon. Properties include `postcode`, `postcode_key`, `outcode`, `risk_band`, `risk_score`, `suitability`, `risk_for_insurance_sop`.

Excludes `risk_score = 0` by default. Rendered by the map overlay as coloured dots.

## API Endpoint

`/api/flood` (served by `functions/api/flood.ts`) proxies the GeoJSON directly from R2 to the browser. It uses multi-candidate key resolution (tries several path prefixes/variations before returning 404). Supports:
- `?plain=1` — decompress gzip before sending (for debugging)
- `?meta=1` — return metadata (size, etag, upload date) without the body

## Caching

The flood overlay is fetched once per map session and cached in the browser. `Cache-Control: public, max-age=3600` is set by the API. There is no in-memory worker cache for flood data (the file is streamed directly from R2).

# R2 Storage and Deployment

## Cloudflare R2 Bucket

**Bucket name**: `valuemap-uk` (default; overridable via `R2_BUCKET` env var)

All static data artifacts are stored as flat objects (no real directory hierarchy — slashes in key names are used as logical path separators). The bucket is accessed via the Cloudflare R2 S3-compatible API using boto3 during pipeline uploads, and via the native `R2Bucket` binding inside Workers runtime at request time.

## R2 Object Naming

See `/Users/bsr/repos/repos-external/valuemap-uk/DEEP/architecture/data-flow.md` for the full R2 key table.

Key points:
- Partition files use a nested path: `cells/{grid}/{metric}/{YYYY-MM-DD}/{PTYPE}_{NB}.json.gz`
- Manifests are un-gzipped JSON: `cells/{grid}/{metric}/_manifest.json`
- Legacy monolithic files remain at root level: `grid_{grid}_full.json.gz`

## Upload Script

`/Users/bsr/repos/repos-external/valuemap-uk/pipeline/upload_model_assets_to_r2.py`

### Required Environment Variables

| Variable | Aliases | Description |
|---|---|---|
| `R2_ACCOUNT_ID` | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `R2_BUCKET` | `R2_BUCKET_NAME` | R2 bucket name (default `valuemap-uk`) |
| `R2_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID`, `S3_ACCESS_KEY` | R2 API token ID |
| `R2_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY`, `TOKEN_VALUE` | R2 API token secret |
| `R2_PREFIX` | — | Optional object key prefix |

### Pre-upload Backup

By default (before every upload), the script downloads the current R2 objects into a timestamped ZIP archive at `pipeline/data/archive/r2/r2_backup_{timestamp}_{prefix}.zip`. This creates a rollback point. The manifest inside the ZIP lists each object's key, size, ETag, and last-modified date.

Disable with `--no-backup-before-upload`.

### Upload Behaviour

```python
s3.upload_file(
    str(local_path),
    bucket_name,
    object_key,
    ExtraArgs={
        "ContentType": content_type_for(path),  # application/json or application/geo+json
        "CacheControl": "public, max-age=86400",
        "ContentEncoding": "gzip",  # for .gz files
    }
)
```

Content-type is inferred from the file suffix: `.geojson.gz` → `application/geo+json`, `.json.gz` → `application/json`.

### Selective Upload

```bash
# Skip flood and property, upload schools and vote only:
python pipeline/upload_model_assets_to_r2.py --skip-flood --skip-property

# Skip pre-upload backup:
python pipeline/upload_model_assets_to_r2.py --no-backup-before-upload
```

## Cloudflare Pages Deployment

The Next.js app deploys to Cloudflare Pages. Pages Functions (in `functions/api/`) are automatically deployed alongside the static site.

Workers bindings configured in the Cloudflare dashboard:
- `BRICKGRID_BUCKET` → R2 bucket binding (primary)
- `R2` → R2 bucket binding (fallback — legacy name)
- Optional secret text bindings: `BMC_ACCESS_TOKEN`, `SCHOOL_OVERLAY_KEY`, `FLOOD_OVERLAY_KEY`, `POSTCODE_LOOKUP_KEY`, `POSTCODE_LOOKUP_INDEX_KEY`

## Local Development

```bash
npm run dev      # Next.js dev server on http://localhost:3000
```

The Pages Functions are not available during `next dev`. To test API handlers locally, use Wrangler:
```bash
# Example from package.json scripts:
wrangler r2 object put valuemap-uk/v1/grid/25km/full.json.gz \
  --file ./data_local/grid_25km_full.json.gz
```

## Pipeline Data Directories

Defined in `pipeline/paths.py`:

```
pipeline/data/
├── raw/           # Source files (downloaded from gov.uk / EA / DfE)
│   ├── property/  # pp-2025.txt, ONSPD CSV
│   ├── schools/   # DfE CSVs
│   ├── flood/     # EA flood CSV
│   ├── elections/ # HoC GE2024 CSV
│   ├── geography/ # Westminster constituency GeoJSON
│   └── epc/       # EPC floor area CSV
├── intermediate/  # Wrangled working outputs (CSVs)
├── model/         # Final built artifacts per domain
│   ├── property/  # grid_*.json.gz, deltas_*.json.gz, postcode_outcode_index_*.json.gz, cells/
│   ├── schools/   # school_overlay_points.geojson.gz
│   ├── flood/     # flood_postcode_lookup.json.gz, flood_postcode_points.geojson.gz
│   └── vote/      # vote_cells_*.json.gz, ge2024_vote_blocks_map.geojson
├── publish/       # Staging area (copy of model/) — R2 upload source
└── archive/r2/    # Pre-upload backup ZIPs
```

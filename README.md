This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

The same pre-upload backup behavior is enabled in: ggg

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

# Pipeline Run — Resume 14/03/2026

## What's Done (13/03)

All these ran successfully with **1mile** (1600m) output:

| Step | Output | Status |
|------|--------|--------|
| `build_property_artifacts.py` | `grid_1mile_full.json.gz`, `grid_1mile_ppsf_full.json.gz`, percentiles, outcode index | ✅ |
| `build_school_scores.py` (mainstream) | school scores + postcode scores + overlay GeoJSON | ✅ |
| `build_station_overlay_points.py` | station overlay GeoJSON (2,595 features) | ✅ |
| `build_vote_blocks.py` + `build_vote_overlay_geojson.py` | vote blocks + GeoJSON (650 constituencies) | ✅ |
| `build_vote_cells_by_grid.py` | `vote_cells_1mile.json.gz` (228,576 cells) | ✅ |
| `build_crime_overlay.py` | LSOA crime overlay (33,956 features) | ✅ |
| `build_crime_cells.py` | `crime_cells_1mile.json.gz` (51,965 cells) | ✅ |
| `build_age_cells.py` | `age_cells_1mile.json.gz` (52,406 cells) | ✅ |
| `build_commute_cells.py` | `commute_cells_1mile.json.gz` (52,406 cells) | ✅ |
| `build_primary_school_ofsted_overlay.py` | primary school overlay (16,693 features) | ✅ |
| `build_epc_cells.py` | `epc_fuel_cells_1mile.json.gz` + `epc_age_cells_1mile.json.gz` | ✅ |

### Fix applied during run
- `build_crime_overlay.py` line 108: `tmp.rename(dest)` → `tmp.replace(dest)` (Windows can't rename over existing file)

### Skipped (missing raw data)
- **Flood** — `data/raw/flood/open_flood_risk_by_postcode.csv` not present. Existing publish/flood data can be re-uploaded as-is.

---

## What's Left to Run

Open a terminal, activate venv, cd to pipeline, load .env:

```powershell
& .venv-7\Scripts\Activate.ps1
cd pipeline
Get-Content ..\.env | Where-Object { $_ -match "^\s*[^#]+=.+" } | ForEach-Object { $parts = $_ -split "=", 2; [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process") }
```

### Step 1: Country Lookup
Needs vote cells to exist (they do).

```powershell
python build_country_lookup_assets.py
```

Produces `country_cells_1mile.json.gz` + other grids + `country_by_outward.json.gz`.

### Step 2: Listed Building Cells
Not in `run_pipeline.py` — must run manually.

```powershell
python build_listed_building_cells.py
```

### Step 3: Broadband Cells

```powershell
python build_broadband_cells.py
```

### Step 4: Transit Overlays (bus stops, metro, pharmacy, listed buildings, planning, holiday lets)

```powershell
python build_bus_stop_points.py --bus-output data\model\transit\bus_stop_overlay_points.geojson.gz --metro-output data\model\transit\metro_tram_overlay_points.geojson.gz
python build_pharmacy_points.py --output data\model\transit\pharmacy_overlay_points.geojson.gz
python build_listed_building_points.py --output data\model\transit\listed_building_overlay_points.geojson.gz
python build_planning_application_points.py --output data\model\transit\planning_application_overlay_points.geojson.gz
python build_holiday_let_points.py --output data\model\transit\holiday_let_overlay_points.geojson.gz
```

### Step 5: Prepare Property Assets
Re-run after country_cells_1mile exists:

```powershell
python prepare_property_assets.py
```

### Step 6: Copy Model → Publish

```powershell
python -c "from run_pipeline import copy_model_to_publish; copy_model_to_publish()"
```

### Step 7: Upload Everything to R2

```powershell
python upload_model_assets_to_r2.py
python upload_vote_cells_to_r2.py
python upload_age_cells_to_r2.py
python upload_commute_cells_to_r2.py
python _upload_country_assets.py
```

### Step 8: Build Price Model (modelled estimates)

```powershell
python build_price_model.py
```

Then upload modelled files:

```powershell
python upload_model_assets_to_r2.py --modelled-only
```

(Check if `--modelled-only` flag exists; if not, the full upload covers it.)

### Step 9: Verify

```powershell
# Check R2 for 1mile keys
python r2_compare.py
```

Then start the dev server and check the app loads 1mile data:

```powershell
cd ..
npm run dev
```

- Zoom to ~level 9 → should see "1mile" grid (was "1km")
- Check grid selector shows "1mi" button
- Open network tab, confirm API fetches `grid=1mile`
- Check vote/crime/age/commute/EPC layers load at 1mile

---

## Key Files Changed (1km → 1mile migration)

If anything looks wrong, the full change set was:
- 11 pipeline Python build scripts
- `paths.py` (R2 asset names)
- 6 upload scripts
- 5 API TypeScript files (`functions/api/`)
- 4 frontend files (`app/`)

TypeScript compiles clean: `npx tsc --noEmit` ✅

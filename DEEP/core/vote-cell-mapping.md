# Vote Cell Mapping

## Purpose

Maps 2024 General Election vote share percentages from Westminster parliamentary constituency polygons onto grid cells, producing a compact lookup `(gx, gy) → vote_shares` for all four grid sizes.

## Source Files

- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_vote_blocks.py` — aggregates GE2024 results by constituency
- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_vote_overlay_geojson.py` — joins vote shares onto constituency boundary GeoJSON
- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_vote_cells_by_grid.py` — main spatial join: grid cell centres → constituency polygons

## Inputs

| File | Description |
|---|---|
| `pipeline/data/raw/elections/HoC-GE2024-results-by-candidate.csv` | GE2024 results per candidate per constituency |
| `pipeline/data/raw/geography/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFE_2463071003872310654.geojson` | Constituency boundary polygons (WGS84) |
| `pipeline/data/model/vote/ge2024_vote_blocks_map.geojson` | Constituency polygons annotated with vote share properties |
| `pipeline/data/model/property/grid_Xkm_full.json.gz` | Grid cell rows (provides gx/gy list per grid size) |

## Vote Share Categories

Each constituency's votes are grouped into three political blocs (not individual parties):

| Property | Bloc includes |
|---|---|
| `pct_progressive` | Labour + Lib Dems + SNP + Plaid + Green + others left-of-centre |
| `pct_conservative` | Conservatives |
| `pct_popular_right` | Reform UK |

These are percentages of the total vote (sum may be < 100 due to other minor parties).

## Spatial Matching Algorithm

### CRS transformation
Grid cell coordinates are BNG (EPSG:27700). Constituency polygons are WGS84 (EPSG:4326). Cell centres are converted using `pyproj`:
```python
transformer = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)
cx = gx + grid_meters / 2
cy = gy + grid_meters / 2
lon, lat = transformer.transform(cx, cy)
```

### Spatial tile index
A 0.25° tile index is built over constituency bounding boxes to reduce point-in-polygon candidates from O(N) to O(1) per query:
```python
def build_tile_index(polygons, tile_deg=0.25):
    index = {}
    for idx, poly in enumerate(polygons):
        min_lon, min_lat, max_lon, max_lat = poly.bbox
        for tx in range(floor(min_lon/tile_deg), floor(max_lon/tile_deg)+1):
            for ty in range(floor(min_lat/tile_deg), floor(max_lat/tile_deg)+1):
                index.setdefault((tx, ty), []).append(idx)
    return index
```

### Point-in-polygon (ray casting)
Ray casting with hole support. Each constituency polygon may be a `Polygon` or `MultiPolygon`. For each polygon part, the algorithm checks outer ring containment then subtracts holes:
```python
def point_in_polygon_parts(lon, lat, parts):
    for part in parts:
        if not point_in_ring(lon, lat, part.outer): continue
        in_hole = any(point_in_ring(lon, lat, hole) for hole in part.holes)
        if not in_hole: return True
    return False
```

A cell that matches no polygon is silently skipped (noted as a miss). Cells at sea or over Scotland (where constituency boundaries may not align with grid) are typical misses.

## Output Schema

`vote_cells_{grid}.json.gz` — array of objects:
```json
[
  {
    "gx": 385000,
    "gy": 800000,
    "pct_progressive": 54.2,
    "pct_conservative": 28.1,
    "pct_popular_right": 12.3,
    "constituency": "Cities of London and Westminster"
  }
]
```

## Runtime Merge

At request time, `cells.ts` and `deltas.ts` merge vote data onto property rows by `gx_gy` string key. This backfill approach means vote data is always current (no rebuild needed when property data is refreshed) and avoids storing vote shares inside the property artifacts.

See `/Users/bsr/repos/repos-external/valuemap-uk/DEEP/api/cells.md` for the `backfillVotes()` implementation.

## Frontend Rendering

Vote overlay can be toggled in the UI via `voteOverlayMode: "off" | "on"`. The `voteColorScale` state switches between:
- `relative` — color ramp within the fetched data's min/max
- `absolute` — fixed scale (e.g. 0–100%)

The three pct fields are present on `ApiRow` in `Map.tsx` and used to derive fill color expressions in MapLibre GL.

# Deep Documentation Index — ValueMap UK

*On-demand technical reference. Read root CRUMB.md first for orientation (if present), or see `/Users/bsr/repos/repos-external/valuemap-uk/DEEP/architecture/overview.md` for a project overview.*

## Files

### Setup
- **setup.md** — Frontend install, Python pipeline prerequisites, raw data sources, common issues

### Architecture
- **architecture/overview.md** — System pattern, tech stack, component roles, grid coordinate system
- **architecture/data-flow.md** — End-to-end flow: pipeline → R2 → Workers API → browser; R2 key naming table

### Core (Business Logic)
- **core/property-grid-pipeline.md** — How raw Land Registry data becomes grid cell artifacts; schemas for median, PPSF, delta, and postcode index outputs; all key functions with signatures
- **core/school-scoring-algorithm.md** — KS4 percentile ranking algorithm, metric weights, quality bands, mainstream filter logic
- **core/vote-cell-mapping.md** — GE2024 vote share spatial join: CRS transform, tile index, ray-casting point-in-polygon; output schema
- **core/flood-risk-assets.md** — Risk score mapping, deduplication logic, three output artifact formats
- **core/index-scoring.md** — Client-side weighted suitability score: affordability, flood, school sub-scores; state management pattern

### Data
- **data/schemas.md** — All data schemas: CellRow, DeltaRow, VoteCellRow, OutcodeIndex, manifest, school/flood GeoJSON feature properties; R2 env bindings

### API
- **api/endpoints.md** — All 7 API endpoints: parameters, response shapes, error codes, caching behaviour, fallback paths

### Infrastructure
- **infrastructure/r2-and-deployment.md** — R2 bucket layout, upload script env vars and flags, pre-upload backup, Cloudflare Pages setup, pipeline data directory structure

---

**Last Updated**: 2026-02-24
**Total Files**: 11

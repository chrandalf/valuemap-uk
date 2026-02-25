# app/ — Next.js Frontend

## WHAT
Next.js 16 App Router frontend compiled as a fully static export. The entire
interactive map experience lives in two large files: `page.tsx` (state + UI) and
`Map.tsx` (MapLibre GL rendering). All other directories are static informational pages.

## KEY FILES
- `page.tsx` — Root page component. Owns all MapState (grid, metric, propertyType,
  newBuild, endMonth, overlays). Renders filter panels, overlay controls, postcode
  search, "Locate Me", outcode rankings, legend, and mobile UI.
- `Map.tsx` — MapLibre GL map. Fetches cells/deltas from `/api/*`, renders grid
  cells as GeoJSON fill layers, handles flood/school/vote overlays, postcode search
  logic, and "Locate Me" geolocation. Exports `LegendData`, `LocateMeResult`,
  `IndexPrefs` types consumed by page.tsx.
- `layout.tsx` — HTML root with OpenGraph/Twitter metadata, Geist font loading.
- `globals.css` — Tailwind v4 base; minimal custom overrides.

## PATTERNS
- State flows one-way: `page.tsx` holds `MapState`, passes it as props into `Map.tsx`
- Map.tsx calls back via `onLegendChange`, `onLocateMe`, `onPostcodeSearch` callbacks
- Overlays (flood/school/vote) are fetched lazily inside Map.tsx when mode != "off"
- Grid cells are colored using quantile breaks (median) or diverging scale (delta)
- `IndexPrefs` drives a composite scoring overlay weighted by affordability/flood/
  school/coast — rendered as a separate index layer in Map.tsx

## STATIC PAGES
Each subdirectory contains a single `page.tsx` rendering prose content:
- `contact/` — contact information
- `data-sources/` — attribution for Land Registry, Ofsted, EA flood, OS data
- `description/` — about the product
- `election-info/` — explanation of vote overlay
- `instructions/` — how to use the map
- `legal/` — terms
- `next-steps/` — roadmap / planned features
- `privacy/` — privacy policy

## DEPENDENCIES
- `maplibre-gl ^5.17` — map rendering
- `tailwindcss ^4` — styling
- API routes in `../functions/api/` — all data fetched at runtime from edge functions

## LANDMINES
- `page.tsx` and `Map.tsx` are intentionally monolithic — do not split without care,
  many internal callbacks and refs are tightly coupled
- Vote cells data version is a hardcoded fallback in Map.tsx line ~130;
  update `NEXT_PUBLIC_VOTE_CELLS_DATA_VERSION` env var or the fallback string when
  new vote data is uploaded
- `next.config.ts` sets `output: "export"` — no server-side features (no API routes
  in app/, no middleware)

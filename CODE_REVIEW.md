# Code Review — ValueMap UK

**Reviewer**: Claude Sonnet 4.6
**Date**: 2026-02-24
**Scope**: Full codebase review — frontend, edge API, Python pipeline, infrastructure

---

## Executive Summary

ValueMap UK is a well-architected, production-deployed property valuation mapping application with a clean separation of concerns between its pipeline, storage, API, and frontend layers. The codebase is pragmatic and clearly maintained by a solo developer who has made sensible trade-offs (intentional monoliths, offline pipeline). However, several issues warrant attention before the application scales: XSS vulnerabilities in popup HTML construction, missing input validation on API parameters, a complete absence of automated tests, a fragile hardcoded version constant with no enforcement, unbounded in-memory caches in Workers isolates, and a missing `requirements.txt` that makes pipeline reproduction unreliable.

---

## Severity Legend

- **Critical** — Exploitable vulnerability or data corruption risk; fix immediately.
- **High** — Defect that will cause production failures or significant user harm under realistic conditions.
- **Medium** — Code quality issue that will cause maintenance burden, subtle bugs, or degraded reliability.
- **Low** — Style, minor code smell, or enhancement opportunity.

---

## Section 1: Security

### 1.1 [Critical] XSS via unescaped user-controlled data in MapLibre popup HTML

**Files**: `app/Map.tsx` — lines 1147–1161, 1169–1182, 1193–1222, 1298–1330, 1347–1392, 2483–2491

All map popups are constructed using raw string template literals and injected via MapLibre's `popup.setHTML()` or direct `el.innerHTML`. Several of these inject values that derive from R2-stored data fields (`postcode`, `school_name`, `constituency`, `risk_band`). Although R2 is controlled data, any pipeline compromise, R2 misconfiguration, or future extension that accepts user input could trivially become stored XSS.

```typescript
// app/Map.tsx line 1147–1161 — school_name is injected verbatim
const schoolName = String(p.school_name ?? "School");
const html = `<div>...<div style="font-weight: 700">${schoolName}</div>...`;
popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
```

The constituency field (line 1349) is also injected verbatim into popup HTML:
```typescript
const constituency = String(p.constituency ?? "Cell vote estimate");
const html = `...<div style="font-weight: 700">${constituency}</div>...`;
```

**Recommendation**: Implement an HTML escaping helper and use it on all data-derived values before injection:
```typescript
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```
Apply to all field values used in template literals passed to `setHTML` or `innerHTML`.

---

### 1.2 [High] Missing input validation on `endMonth` parameter in cells.ts

**File**: `functions/api/cells.ts` — lines 11–34

The `endMonth` query parameter is accepted as-is and used directly to construct an R2 key path:

```typescript
const endMonthParam = (url.searchParams.get("endMonth") ?? "LATEST").toUpperCase();
// ...
endMonth = endMonthParam; // used verbatim when not "LATEST"
// ...
const partitionKey = `cells/${grid}/${metric}/${endMonth}/${propertyType}_${newBuild}.json.gz`;
```

While Cloudflare R2 does not expose path traversal in the classical sense, an attacker can probe the internal R2 bucket structure by supplying arbitrary `endMonth` values (e.g., `../../../../etc/passwd`, `_manifest`, `..`). This leaks information about R2 key structure and may also allow bypassing the manifest-driven "LATEST" resolution to access any stored partition key if the attacker guesses the format.

Additionally, `propertyType` and `newBuild` are passed through after only a `.toUpperCase()` call — they are not validated against the known allowed values before being incorporated into the R2 key path.

**Recommendation**: Validate `endMonth` against a strict format regex before use:
```typescript
if (endMonthParam !== "LATEST" && !/^\d{4}-\d{2}-\d{2}$/.test(endMonthParam)) {
  return Response.json("Invalid endMonth format. Use YYYY-MM-DD or LATEST.", { status: 400 });
}
```
Also add allowlist validation for `propertyType` and `newBuild`:
```typescript
const VALID_PROPERTY_TYPES = new Set(["ALL", "D", "S", "T", "F"]);
const VALID_NEW_BUILD = new Set(["ALL", "Y", "N"]);
if (!VALID_PROPERTY_TYPES.has(propertyType) || !VALID_NEW_BUILD.has(newBuild)) {
  return Response.json("Invalid propertyType or newBuild.", { status: 400 });
}
```

---

### 1.3 [High] External API call without rate limiting or circuit breaker (supporters.ts)

**File**: `functions/api/supporters.ts` — lines 28–33

The `supporters` endpoint proxies every request to the Buy Me a Coffee API with the bearer token. There is no debounce, rate limiting, or caching at the function level beyond the HTTP `Cache-Control` header (which only protects CDN edge caches, not the origin worker):

```typescript
const apiRes = await fetch("https://developers.buymeacoffee.com/api/v1/supporters", {
  headers: { Authorization: `Bearer ${env.BMC_ACCESS_TOKEN}` },
});
```

Cloudflare Pages Functions do not deduplicate concurrent requests. A burst of traffic that bypasses the CDN cache (e.g., Cache-Control miss, `cache-busting` parameters) will amplify calls to BMC's API and may exhaust the BMC token rate limit.

**Recommendation**: Cache the result in a module-level variable (similar to the delta/vote caches elsewhere), with a TTL of at least 60 seconds:
```typescript
let _bmcCache: { items: string[]; loadedAtMs: number } | null = null;
const BMC_TTL_MS = 60_000;
```

---

### 1.4 [Medium] No CORS headers on any API endpoint

**Files**: All files in `functions/api/`

None of the API endpoints set `Access-Control-Allow-Origin` or other CORS headers. Since these endpoints serve data consumed by the Next.js SPA on the same Cloudflare Pages domain, this is currently harmless. However:
- Any future subdomain separation or cross-origin usage will break silently.
- The lack of explicit CORS policy makes the surface area less auditable.

**Recommendation**: Add explicit CORS headers to all responses, even if restricting to the same origin:
```typescript
headers.set("Access-Control-Allow-Origin", "https://valuemap.co.uk"); // or your domain
```

---

### 1.5 [Medium] BMC token exposed in upstream error response

**File**: `functions/api/supporters.ts` — lines 36–39

When the BMC API returns a non-OK status, the raw upstream response body is forwarded to the client:

```typescript
const body = await apiRes.text();
return new Response(JSON.stringify({
  error: "Failed to fetch supporters",
  status: apiRes.status,
  body  // upstream body may contain token-related error details
}), { status: 502 });
```

The upstream BMC error response body could contain information that assists in reverse-engineering the authentication mechanism.

**Recommendation**: Log the upstream body server-side (e.g., `console.error`) and return only a generic error to the client:
```typescript
console.error("BMC API error", apiRes.status, body);
return new Response(JSON.stringify({ error: "Failed to fetch supporters" }), { status: 502 });
```

---

### 1.6 [Medium] `key` query parameter allows arbitrary R2 key path construction in flood.ts and schools.ts

**Files**: `functions/api/flood.ts` — lines 95–129; `functions/api/schools.ts` — lines 95–129

Both `flood.ts` and `schools.ts` accept a user-supplied `key` query parameter that is normalized and used to probe up to 7 candidate R2 key paths:

```typescript
const requestedKey = normalizeRequestedKey(
  url.searchParams.get("key") ?? env.FLOOD_OVERLAY_KEY ?? "flood_postcode_points.geojson.gz"
);
const candidates = Array.from(new Set([
  requestedKey,
  requestedKey.replace(/^\/+/, ""),
  ...
  `v1/${requestedKey.replace(/^.*\//, "")}`,
]));
```

The `normalizeRequestedKey` regex only validates the filename structure partially:
```typescript
const keyMatch = cleaned.match(/[a-zA-Z0-9/_.-]+\.(?:geojson|json)(?:\.gz)?/i);
```

While this prevents direct traversal attacks (the regex requires a valid extension), it still allows probing arbitrary key paths within the allowed character set (e.g., `../../some_other_key.json.gz`). The 7-candidate waterfall also fires 7 sequential R2 reads on cache miss, which could be used for bucket enumeration.

**Recommendation**: Remove the `key` override parameter from production or restrict it to an allowlist of known R2 object names. If the override is needed for diagnostics, protect it with an API key check.

---

### 1.7 [Low] `@ts-ignore` suppresses a type error in gunzipToString

**File**: `functions/api/cells.ts` — line 319

```typescript
// @ts-ignore – available in Workers runtime
const ds = new DecompressionStream("gzip");
```

This comment acknowledges the issue but the suppression hides potential type drift. The same decompression is implemented differently in `deltas.ts` (using `ReadableStream` directly) without any `@ts-ignore`. The inconsistency suggests the `@ts-ignore` was added as a workaround rather than properly extending the type environment.

**Recommendation**: Add a proper ambient declaration for `DecompressionStream` via `@cloudflare/workers-types` or a custom `d.ts` shim. Standardize to a single decompression implementation across all handlers.

---

## Section 2: Error Handling

### 2.1 [High] Unhandled race condition in `fetchPostcodesRef` pattern

**File**: `app/Map.tsx` — lines 1400–1435

The `fetchPostcodes` function is assigned to `fetchPostcodesRef.current` after each render cycle (line 1435). When a user clicks a cell quickly, multiple in-flight fetch calls can race. The later response may arrive before the earlier one, replacing correct results with stale data. There is no cancellation mechanism for competing fetches:

```typescript
const fetchPostcodes = async (gx: number, gy: number, offset: number, append: boolean) => {
  setPostcodeLoading(true);
  // No AbortController, no sequence number guard
  const res = await fetch(`/api/postcodes?${qs.toString()}`);
  // By the time this resolves, user may have clicked a different cell
  setPostcodeItems(prev => append ? [...prev, ...items] : items);
};
```

This is in contrast to the `setRealData` call at line 1487–1515, which does use an `AbortController` and a sequence number guard (`requestSeqRef`).

**Recommendation**: Apply the same pattern used for the main data fetch — introduce a `postcodeSeqRef` and abort previous in-flight requests on new cell clicks.

---

### 2.2 [High] Silent error swallowing throughout Map.tsx causes invisible failures

**File**: `app/Map.tsx` — multiple locations (lines 586, 638, 1586, 1638, 1659)

A pervasive pattern of bare `catch (e) { // ignore }` exists for layer operations:

```typescript
try {
  if (map.getLayer("flood-overlay-fill")) {
    map.setLayoutProperty("flood-overlay-fill", "visibility", floodVisibility);
  }
  // ...
} catch (e) {
  // ignore
}
```

While some of these are defensive around layer existence checks, they also suppress genuine MapLibre errors. If a layer name typo or API change causes a real error, the UI silently renders incorrectly with no diagnostic path.

**Recommendation**: Distinguish between "layer not yet added" (which can be safely ignored) and unexpected errors. Use `map.getLayer(id)` checks explicitly before operations and only suppress `undefined`-style guard failures, not all exceptions. At minimum add `console.warn` for unexpected errors during development.

---

### 2.3 [Medium] `deltas.ts` returns empty rows silently when R2 object missing

**File**: `functions/api/deltas.ts` — lines 196–213

```typescript
async function loadDeltasFromR2(env: Env, grid: GridKey): Promise<DeltaData> {
  const obj = await bucket.get(objectKey);
  if (!obj) {
    console.warn(`Delta file not found: ${objectKey}`);
    return { rows: [] }; // silent empty response
  }
  // ...
}
```

An R2 delta file missing returns HTTP 200 with an empty `rows` array. The UI receives a valid response and renders a blank map with no indicator to the user that the data is missing. This masks deployment errors (e.g., a failed upload).

**Recommendation**: Return HTTP 404 with a clear error message when the delta file is not found:
```typescript
if (!obj) {
  throw new Error(`Delta file not found: ${objectKey}`);
}
```
Let the caller in `onRequestGet` handle this and return a 404.

---

### 2.4 [Medium] `outcodes.ts` uses `env.R2` directly (not the dual-bucket helper) for grid data

**File**: `functions/api/outcodes.ts` — line 151

```typescript
const obj = await env.R2.get(key);
```

All other API handlers use `getBucket(env)` (or equivalent) which tries `BRICKGRID_BUCKET` first then falls back to `R2`. The `getCachedGrid` function in `outcodes.ts` directly accesses `env.R2`, bypassing this fallback. If the deployment only has `BRICKGRID_BUCKET` configured (not `R2`), this will throw a runtime exception.

**Recommendation**: Replace `env.R2.get(key)` with the bucket resolution helper:
```typescript
const bucket = env.BRICKGRID_BUCKET ?? env.R2;
if (!bucket) throw new Error("R2 binding not found.");
const obj = await bucket.get(key);
```

---

### 2.5 [Medium] Pipeline `run_step` uses `subprocess.run(check=True)` with no timeout

**File**: `pipeline/run_pipeline.py` — line 28

```python
def run_step(label: str, args: list[str]) -> None:
    subprocess.run(cmd, check=True)
```

Pipeline steps can hang indefinitely (e.g., reading multi-GB CSV files, waiting for R2 uploads). The orchestrator has no timeout mechanism, meaning a stuck subprocess blocks the entire pipeline with no diagnostic output.

**Recommendation**: Add a `timeout` parameter appropriate for each pipeline step:
```python
subprocess.run(cmd, check=True, timeout=3600)  # 1 hour max per step
```

---

### 2.6 [Low] `upload_model_assets_to_r2.py` does not handle partial upload failures

**File**: `pipeline/upload_model_assets_to_r2.py` — lines 286–299

The upload loop assumes all uploads will succeed and prints a hardcoded `"0 failed"`:

```python
for path, object_key in zip(files, object_keys):
    s3.upload_file(...)
    print(f"Uploaded: {object_key}")

print(f"R2 upload finished: {len(files)} succeeded, 0 failed")
```

If an upload fails mid-loop (network error, permission error), the exception propagates up, but previously uploaded objects are not rolled back. The R2 bucket is left in a partially updated state.

**Recommendation**: Track success/failure per file and report accurately:
```python
succeeded, failed = 0, []
for path, object_key in zip(files, object_keys):
    try:
        s3.upload_file(...)
        succeeded += 1
    except Exception as e:
        failed.append((object_key, str(e)))

if failed:
    for key, err in failed:
        print(f"FAILED: {key}: {err}", file=sys.stderr)
    raise SystemExit(f"Upload finished with {len(failed)} failures.")
print(f"R2 upload finished: {succeeded} succeeded, 0 failed")
```

---

## Section 3: Code Quality and DRY Violations

### 3.1 [High] `decompressGzip` function duplicated across three files

**Files**: `functions/api/deltas.ts` (lines 216–243), `functions/api/outcodes.ts` (lines 207–234), `functions/api/postcodes.ts` (lines 166–193)

The identical `decompressGzip` implementation is copy-pasted verbatim across three separate handlers. Additionally, a different implementation using `new Response(gz).body!.pipeThrough(ds)` exists in `cells.ts` (line 318). This is a maintenance hazard: a bug fix or performance improvement in one copy will not propagate to others.

**Recommendation**: Extract to a shared utility module, e.g., `functions/_lib/gzip.ts`:
```typescript
export async function gunzipToString(gz: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(gz).body!.pipeThrough(ds);
  return await new Response(stream).text();
}
```
Import this in all four handler files.

---

### 3.2 [High] `resolveSchoolObject` and `resolveFloodObject` are near-identical

**Files**: `functions/api/schools.ts` (lines 101–130), `functions/api/flood.ts` (lines 101–130)

These two functions are character-for-character identical except for the default key name and the error message string. The 7-candidate key probe logic, bucket resolution, and normalization are fully duplicated.

**Recommendation**: Extract to a shared utility:
```typescript
// functions/_lib/r2-resolve.ts
export async function resolveR2Object(
  env: Env,
  requestedKey: string,
  defaultKey: string
): Promise<ResolvedObject | null> { ... }
```

---

### 3.3 [Medium] `GridKey` type and `isGridKey` validator duplicated in every handler

**Files**: All files in `functions/api/` — `cells.ts`, `deltas.ts`, `outcodes.ts`, `postcodes.ts`

Each file independently declares:
```typescript
type GridKey = "1km" | "5km" | "10km" | "25km";
function isGridKey(v: string): v is GridKey { ... }
```

`deltas.ts` uses a narrower `GridKey = "5km" | "10km" | "25km"` (1km excluded), but the validator logic and the type definition are still repeated in the other three files identically.

**Recommendation**: Move to `functions/_lib/types.ts` and import where needed.

---

### 3.4 [Medium] `voteKeyForGrid` helper duplicated between cells.ts and deltas.ts

**Files**: `functions/api/cells.ts` (lines 168–175), `functions/api/deltas.ts` (lines 180–186)

```typescript
// cells.ts
function voteKeyForGrid(grid: GridKey) {
  switch (grid) {
    case "1km": return "vote_cells_1km.json.gz";
    // ...
  }
}
```

The same function exists in both files. Extracting it to a shared module eliminates the duplication.

---

### 3.5 [Medium] Hardcoded `DEFAULT_STATE` duplicated between page.tsx and Map.tsx initializer

**File**: `app/page.tsx` — lines 83–95 (initial `useState`) and lines 191–203 (`DEFAULT_STATE` object)

The initial map state is defined twice: once in the `useState` call and once in a `DEFAULT_STATE` constant used by `resetAll`. They contain the same values but are maintained separately. A future field addition must be updated in two places.

**Recommendation**: Define `DEFAULT_STATE` once and use it as the `useState` initializer:
```typescript
const DEFAULT_STATE: MapState = { grid: "5km", ... };
const [state, setState] = useState<MapState>(DEFAULT_STATE);
```

---

### 3.6 [Medium] `cellFcRef.current` type is `any`

**File**: `app/Map.tsx` — line 218

```typescript
const cellFcRef = useRef<any>(null);
```

This ref holds a GeoJSON `FeatureCollection` used extensively for index scoring. The `any` type allows unsafe property accesses throughout the scoring logic without type checking.

**Recommendation**: Define a typed GeoJSON interface and use it:
```typescript
type CellFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, ApiRow & { index_score?: number }>;
const cellFcRef = useRef<CellFeatureCollection | null>(null);
```

---

### 3.7 [Medium] `geoCacheRef` key does not include `voteColorScale`

**File**: `app/Map.tsx` — line 2060

```typescript
const cacheKey = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth ?? "LATEST"}|${VOTE_CELLS_DATA_VERSION}`;
```

The cache key includes `VOTE_CELLS_DATA_VERSION` but not `state.voteColorScale`. The vote color scale (`relative` vs `absolute`) affects the `vote_rank_lr` field written into each feature's properties by `ensureVoteRelativeRanks`. When the user switches scale modes, the cached GeoJSON FeatureCollection may contain stale `vote_rank_lr` values.

Looking at `applyVoteOverlayColorFromSource` (line 1919), relative rankings are mutated directly onto the cached feature properties and keyed only by the vote overlay expression, not the cached data. The cache is reused but `vote_rank_lr` may be out of date for subsequent scale switches.

**Recommendation**: Either include `voteColorScale` in the cache key, or strip `vote_rank_lr` from features when the scale mode changes.

---

### 3.8 [Medium] Scotland timestamp rebasing is complex and untestable

**File**: `pipeline/build_property_artifacts.py` — lines 230–312

The `load_scotland_properties` function contains a multi-step heuristic: detect the effective data cutoff via a busy-day threshold (`SCOTLAND_DAILY_THRESHOLD = 50`), then optionally rebase all dates to an `anchor_month`. The logic at lines 298–311 reconstructs individual transaction dates in the anchor month using the original day-of-month. This is a brittle numerical operation (clipping days to the month's length) that is hard to reason about and not tested.

The `daily_threshold` logic at lines 287–291 silently falls back to `idxmax()` (the busiest single day) when no day exceeds the threshold, which is a very different behavior and not documented.

**Recommendation**: Add unit tests for the Scotland date logic. Document the fallback behavior with a comment. Consider extracting the date rebasing to a named function with a docstring.

---

### 3.9 [Low] `getBucket` in deltas.ts uses unsafe double-cast

**File**: `functions/api/deltas.ts` — line 189

```typescript
function getBucket(env: Env): R2Bucket {
  const bucket = ((env && ((env as any).BRICKGRID_BUCKET || (env as any).R2)) as unknown) as R2Bucket | undefined;
  if (!bucket) { throw new Error(...); }
  return bucket;
}
```

Compare to `cells.ts` line 311 which uses the cleaner typed pattern:
```typescript
function getBucket(env: Env): R2Bucket {
  const bucket = env.BRICKGRID_BUCKET ?? env.R2;
  if (!bucket) throw new Error("...");
  return bucket;
}
```

The `deltas.ts` version's double-cast is unnecessary. This inconsistency is a code smell suggesting the functions were written independently.

---

### 3.10 [Low] `page.tsx` has duplicated type declarations already exported by Map.tsx

**File**: `app/page.tsx` — lines 6–16

Several types (`GridSize`, `Metric`, `ValueFilterMode`, `FloodOverlayMode`, `SchoolOverlayMode`, `VoteOverlayMode`, `VoteColorScale`) are declared locally in `page.tsx` when they are already exported from `Map.tsx` (or are substantially identical). `MapState` is defined independently in both files with slightly different field optionality.

**Recommendation**: Export all shared types from `Map.tsx` and import them in `page.tsx` to maintain a single source of truth.

---

### 3.11 [Low] `buildZooplaHref` uses `stateRef.current` instead of being a pure function

**File**: `app/Map.tsx` — lines 645–693

`buildZooplaHref` reads from `stateRef.current` and `indexPrefsRef.current` directly rather than accepting them as parameters. This makes the function impure and impossible to test in isolation, and its behavior depends on closure-captured refs rather than its named parameters.

**Recommendation**: Pass the required state as function arguments:
```typescript
function buildZooplaHref(
  outcode: string,
  maxPrice: number | null | undefined,
  state: MapState,
  indexPrefs: IndexPrefs | null
): string { ... }
```

---

## Section 4: Performance

### 4.1 [High] No TTL on delta and vote caches in Workers — memory grows unbounded per isolate

**Files**: `functions/api/deltas.ts` (lines 121–122), `functions/api/postcodes.ts` (line 142)

The `deltaCache`, `voteCache`, and `INDEX_CACHE` Maps in these files have no TTL or eviction mechanism:

```typescript
// deltas.ts
const deltaCache = new Map<GridKey, DeltaData>();    // no TTL
const voteCache = new Map<GridKey, Map<...> | null>(); // no TTL
```

A Cloudflare Worker isolate can persist for hours across many requests. With 4 grid sizes and both property types creating separate entries, and given the size of delta files (potentially several MB per grid), these caches could hold tens of MB in a single isolate. While Cloudflare caps memory per isolate (~128MB), the lack of any eviction strategy means there is no protection against memory growth.

Additionally, the documentation notes that `deltaCache` has "no TTL (cleared only on isolate restart)". If upstream data is updated in R2, the cached delta data remains stale until the isolate restarts.

**Recommendation**: Add a TTL for delta and vote caches, consistent with the 10-minute TTL used for partition and manifest caches in `cells.ts`. Alternatively, document clearly that updating delta data requires a forced isolate restart.

---

### 4.2 [High] `ensureAggregatesAndUpdate` may fetch the same grid data twice in rapid succession

**File**: `app/Map.tsx` — lines 2147–2330

`ensureAggregatesAndUpdate` can issue a `fetch /api/cells?grid=25km` request (lines 2192–2218) and then a second `fetch /api/cells?grid={current}` request (lines 2252–2279) within the same function call, both happening asynchronously. These fire in serial (one waits on the other). If the current grid is already 25km, the 25km data is fetched twice.

The function also accesses `(src as any)._data` (line 2159, 2227) — an internal MapLibre property that is not part of the public API and may change in a future MapLibre version.

**Recommendation**: Check if `state.grid === "25km"` before issuing the second fetch. Avoid accessing `_data` on the source object; pass the feature collection explicitly through the call chain.

---

### 4.3 [Medium] Index scoring fetches flood and school data separately from the overlay fetch

**File**: `app/Map.tsx` — lines 2622–2665

When the user activates the index scoring panel, `applyIndexScoring` fetches `/api/flood?plain=1` and `/api/schools?plain=1` independently from the overlay fetch already issued by the flood/school overlay system (via the MapLibre GeoJSON source). For a user who has flood overlays enabled, this doubles the network traffic for those datasets.

**Recommendation**: Share the already-fetched overlay data with the index scoring system through the existing `floodSearchEntriesRef` / `schoolSearchEntriesRef` refs, which hold exactly the same data in a different format.

---

### 4.4 [Medium] `geoCacheRef` in Map.tsx grows indefinitely with no eviction

**File**: `app/Map.tsx` — line 628

```typescript
const geoCacheRef = useRef<Map<string, any>>(new Map<string, any>());
```

This `Map` caches GeoJSON FeatureCollections per `(grid, propertyType, newBuild, metric, endMonth, voteDataVersion)` key. A user exploring all combinations (4 grids × 5 property types × 3 new build options × 4 metrics × 5 periods) could create up to ~1200 cache entries, each potentially multi-MB for fine-grained grids. On the 1km grid, a single FeatureCollection can be tens of MB.

**Recommendation**: Implement a simple LRU eviction with a maximum entry count (e.g., 20 entries), matching real user navigation patterns.

---

### 4.5 [Medium] 7-sequential-R2-reads waterfall on every cold cache miss for schools/flood/postcodes

**Files**: `functions/api/flood.ts`, `functions/api/schools.ts`, `functions/api/outcodes.ts`, `functions/api/postcodes.ts`

When an object is not found at the primary key, these handlers issue up to 6 additional sequential R2 `bucket.get()` calls to try alternative key paths. Each R2 read incurs a round-trip latency. On a cold start with the canonical key being correct, this wastes time trying 6 other keys before finding the right one.

The original intent appears to be handling deployed objects with varying prefix conventions. However, with a stable deployment this waterfall never resolves on the first try.

**Recommendation**: Use the R2 `head()` method to check existence before `get()`, or — better — standardize on the canonical key and remove the fallback waterfall, replacing it with a single fallback to the bare filename if the full path fails.

---

### 4.6 [Low] Spatial grid bucket hash may collide for densely packed UK coordinates

**File**: `app/Map.tsx` — lines 2582–2588

```typescript
const bx = Math.floor(p.lon / cellSize) + 100;
const by = Math.floor(p.lat / cellSize);
const key = bx * 1000 + by;
```

For UK coordinates (lon ~= -8 to +2, lat ~= 49 to 61), with `cellSize = 0.12`:
- `bx` ranges from `Math.floor(-8/0.12) + 100` = approximately 34 to `Math.floor(2/0.12) + 100` = approximately 117
- `by` ranges from `Math.floor(49/0.12)` = approximately 408 to `Math.floor(61/0.12)` = approximately 508

Key = `bx * 1000 + by`. Maximum `bx * 1000` = 117,000. Maximum `by` = 508. These do not overlap. The hash is correct for UK, but the `+100` offset chosen for "negative longitude handling" will produce incorrect bucket assignments if the grid is ever used for other geographies. No comment explains the magic constant.

**Recommendation**: Add a comment explaining the offset and why it is sufficient for UK coordinates. Consider using a two-part key (`bx * 10000 + (by + 1000)`) to be unambiguous.

---

## Section 5: Type Safety

### 5.1 [High] `any` type used pervasively throughout Map.tsx for MapLibre expressions

**File**: `app/Map.tsx` — approximately 80+ occurrences of `as any` casts on MapLibre paint/filter expressions

The MapLibre GL TypeScript bindings for data expressions are incomplete, requiring many `as any` casts. While this is a known limitation of the library, the effect is that the TypeScript compiler provides no coverage over the most complex rendering logic in the application. An incorrectly formatted expression will produce a silent runtime rendering failure.

```typescript
"circle-color": ["step", ["get", "point_count"], ...] as any,
"circle-radius": ["step", ["get", "point_count"], ...] as any,
```

**Recommendation**: Extract all MapLibre expression builders into typed helper functions with runtime validation, reducing the blast radius of any single misconstruction:
```typescript
function stepExpression(input: ExprInput, ...steps: [value: any, output: any][]): FilterSpecification {
  return ["step", input, ...steps.flat()] as FilterSpecification;
}
```

---

### 5.2 [Medium] `Env` interface inconsistent across worker files

**Files**: All `functions/api/*.ts`

The `Env` interface is independently declared in each file with different optionality:
- `cells.ts`: `R2?: R2Bucket; BRICKGRID_BUCKET?: R2Bucket` (both optional)
- `deltas.ts`: `BRICKGRID_BUCKET: R2Bucket` (required, `R2` absent from interface)
- `outcodes.ts`: `R2: R2Bucket` (required), `BRICKGRID_BUCKET?: R2Bucket` (optional)

This inconsistency means TypeScript enforcement of the environment contract differs per file. In `deltas.ts`, the `getBucket` function casts `env as any` to access `env.R2` because `R2` is not in the `Env` interface, bypassing the type system entirely.

**Recommendation**: Consolidate into a single `Env` interface in `functions/_lib/types.ts`:
```typescript
export interface Env {
  BRICKGRID_BUCKET?: R2Bucket;
  R2?: R2Bucket;
  SCHOOL_OVERLAY_KEY?: string;
  FLOOD_OVERLAY_KEY?: string;
  POSTCODE_LOOKUP_KEY?: string;
  POSTCODE_LOOKUP_INDEX_KEY?: string;
  BMC_ACCESS_TOKEN?: string;
}
```

---

### 5.3 [Medium] `normalizeDeltaRows` loses type safety by accessing rows via string key

**File**: `app/Map.tsx` — lines 2124–2141

```typescript
function normalizeDeltaRows(rows: any[], grid: GridSize): ApiRow[] {
  const gxKey = `gx_${gridMeters}`;
  const gyKey = `gy_${gridMeters}`;
  return rows.map((r) => ({
    gx: r[gxKey],  // dynamic key access, no type safety
    gy: r[gyKey],
    // ...
  }));
}
```

`rows` is typed as `any[]`, and the `gxKey`/`gyKey` are computed strings. If the delta row schema changes (e.g., renamed keys), this breaks silently at runtime.

**Recommendation**: Type `rows` as `DeltaRow[]` (already defined in Map.tsx area) and use a typed accessor function:
```typescript
function getGridCoordsFromDeltaRow(row: DeltaRow, grid: GridSize): { gx: number; gy: number } | null {
  // type-safe switch using the known schema fields
}
```

---

### 5.4 [Low] `manifest.partitions.map((p: any) => ...)` discards manifest type information

**File**: `functions/api/cells.ts` — line 30

```typescript
const months = [...new Set(manifest.partitions.map((p: any) => p.end_month as string))].sort();
```

The `manifest` is already parsed from JSON. Typing the manifest with a proper interface would remove the `(p: any)` annotation:
```typescript
interface Manifest {
  grid: string;
  metric: string;
  partitions: Array<{
    end_month: string;
    property_type: string;
    new_build: string;
    row_count: number;
  }>;
}
```

---

## Section 6: Missing Test Coverage

There are **zero automated tests** anywhere in the project. No test files exist (confirmed: no `*.test.*` or `*.spec.*` files). This is the highest-risk issue from a long-term reliability standpoint.

### 6.1 [Critical] No tests for edge API handlers

The six API handlers in `functions/api/` are the critical path for all data delivery. They contain non-trivial logic (manifest resolution, partition key construction, vote backfill, legacy fallback) that is entirely untested.

**What should be tested (Vitest + Miniflare or Cloudflare Workers test environment)**:

- `cells.ts`: valid parameters return correct JSON shape; invalid `grid` returns 400; `minTxCount` filtering is applied; the legacy fallback path is exercised when manifest is absent; `refresh=1` bypasses partition cache; vote backfill correctly merges fields; `endMonth=LATEST` resolves to the maximum available month from the manifest.
- `deltas.ts`: coordinate extraction for each grid size (`gx_5000`, `gx_10000`, `gx_25000`) is correct; missing delta file returns empty rows; vote backfill works.
- `outcodes.ts`: weighted median calculation is mathematically correct; cell not present in index is skipped; all `bucket.get()` paths succeed.
- `flood.ts` / `schools.ts`: 404 when all candidate keys miss; correct `Content-Encoding: gzip` when `plain=1` is absent; correct decompressed response when `plain=1`.
- `supporters.ts`: graceful handling when `BMC_ACCESS_TOKEN` is absent; error response when BMC API returns non-200; name deduplication and limit applied.

---

### 6.2 [Critical] No tests for Python pipeline data transformations

The pipeline produces all application data. A bug in aggregation math silently generates incorrect property prices or vote fractions that propagate to production.

**What should be tested (pytest)**:

- `normalize_postcode_key`: handles `None`, empty string, mixed case, various whitespace.
- `derive_outcode`: correctly derives outcode from full postcodes of various formats.
- `with_grid_cells`: a small mock DataFrame produces correct `gx`/`gy` BNG floor values.
- `aggregate_segments`: correctly produces the four segments (ALL/ALL, specific type, etc.) with correct median and tx_count.
- `load_scotland_properties`: the date rebasing logic produces correct month alignment; the busy-day fallback to `idxmax()` is exercised.
- `write_partitions`: produces correctly named files for each (end_month, ptype, nb) combination and a manifest with accurate row counts.
- `build_delta_outputs`: cells present in only one period are excluded (inner join); delta_gbp and delta_pct are computed correctly.
- `extract_paon_from_epc_address`: various address formats (flat/apartment prefix, plain number, mixed) correctly extract the PAON key.

---

### 6.3 [High] No tests for frontend utility functions

Several pure functions in `Map.tsx` contain non-trivial logic that is untested:

- `computeWeightedQuantiles`: the weighted quantile algorithm should be tested against known inputs.
- `ensureStrictlyIncreasingBreaks`: boundary cases (all same values, two values, large arrays with duplicates).
- `normalizeDeltaRows`: coordinate extraction for each grid size.
- `ensureVoteRelativeRanks`: the ranked scoring algorithm produces values in [0, 1].
- `buildSpatialGrid` / `querySpatialGrid`: spatial queries return the correct candidate set.
- `buildZooplaHref`: URL construction for each property type combination.
- `normalizePostcodeSearch` (wherever it is defined): various postcode formats are normalized correctly.

**Recommended tooling**: Vitest with `jsdom` environment. The above functions are all pure or near-pure and can be extracted from the component for isolated testing.

---

### 6.4 [Medium] No integration tests for R2 key name construction

The R2 key naming convention is the most critical contract between the pipeline and the API. A mismatch (e.g., pipeline outputs `cells/5km/median/2025-12-01/ALL_ALL.json.gz` but API requests `cells/5km/median/2025-12-01/ALL_ALL.json.gz`) would produce a silent 404 fallback to the legacy path.

**What should be tested**: A cross-language contract test that verifies the key strings produced by `pipeline/build_property_artifacts.py`'s `write_partitions` function match the key strings constructed in `cells.ts`'s `partitionKey` computation for the same input parameters.

---

## Section 7: Infrastructure and Deployment

### 7.1 [High] No `wrangler.toml` — Cloudflare Pages bindings are undocumented in code

There is no `wrangler.toml` or equivalent configuration file in the repository. The Cloudflare Pages bindings (`BRICKGRID_BUCKET`, `R2`, `BMC_ACCESS_TOKEN`, etc.) are documented only in `DEEP/infrastructure/r2-and-deployment.md` and configured manually in the Cloudflare dashboard.

This means:
- A new developer cannot reproduce the deployment from the repository alone.
- There is no code-level enforcement that required bindings exist.
- Local development with Wrangler is not possible without manual setup.

**Recommendation**: Add a `wrangler.toml` with at minimum:
```toml
name = "valuemap-uk"
compatibility_date = "2025-01-01"

[[r2_buckets]]
binding = "BRICKGRID_BUCKET"
bucket_name = "valuemap-uk"
```
For production secrets, document them as environment variables without values.

---

### 7.2 [High] `NEXT_PUBLIC_VOTE_CELLS_DATA_VERSION` hardcoded fallback with no enforcement mechanism

**File**: `app/Map.tsx` — line 130

```typescript
const VOTE_CELLS_DATA_VERSION = process.env.NEXT_PUBLIC_VOTE_CELLS_DATA_VERSION ?? "20260222b";
```

The CRUMB documents call this a "landmine": when new vote cell data is uploaded to R2, this constant (or the env var) must be updated, otherwise the frontend requests data under the old version key and the cells API backfills stale vote data. There is no automated check that this version matches what is actually in R2.

**Recommendation**: Serve the vote cells version dynamically from the cells manifest (or a dedicated `/api/version` endpoint that reads a `version.json` from R2). Eliminate the hardcoded fallback entirely so a version mismatch is an explicit error rather than a silent staleness.

---

### 7.3 [High] No `requirements.txt` for Python pipeline

**File**: `pipeline/CRUMB.md` landmines section

The pipeline CRUMB explicitly documents: "No requirements.txt — install pandas, boto3 etc. manually before running." This creates a significant reproducibility problem:
- New developers cannot reproduce the exact library versions used to generate production data.
- CI/CD automation of the pipeline (if added) requires manual version discovery.
- A pandas or pyproj minor version change could silently alter aggregation behavior.

**Recommendation**: Add a `pipeline/requirements.txt` or `pipeline/pyproject.toml` with pinned versions:
```
pandas>=2.0,<3.0
pyproj>=3.5,<4.0
boto3>=1.34,<2.0
```
At minimum, run `pip freeze > pipeline/requirements.txt` from the current working environment.

---

### 7.4 [Medium] `copy_model_to_public` flattens subdirectory structure

**File**: `pipeline/run_pipeline.py` — lines 31–42

```python
def copy_model_to_public() -> None:
    for src in MODEL_DIR.rglob("*"):
        if not src.is_file():
            continue
        dst = PUBLIC_DATA_DIR / src.name  # uses only filename, not relative path
        shutil.copy2(src, dst)
```

This copies all model files into `public/data/` using only the filename (not the relative path). If two model files from different subdirectories share the same filename, the second will silently overwrite the first. For the current artifact set this does not cause collisions, but the partitioned cell files (e.g., `ALL_ALL.json.gz`) would collide because many cells use the same filename across different grid/metric/month directories.

This function is flagged as `--publish-public` mode for local inspection, not for production deployment, but the silent overwrite is still a reliability issue.

**Recommendation**: Either preserve the relative directory structure (as `copy_model_to_publish` correctly does), or document that this mode is only valid for the top-level non-partitioned artifacts.

---

### 7.5 [Medium] No Cloudflare Pages `_headers` or `_redirects` file

The repository has no `public/_headers` file to set security headers (CSP, X-Frame-Options, etc.) for the static Next.js export. The default Cloudflare Pages deployment does not add these headers automatically.

**Recommendation**: Add `public/_headers`:
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self)
```
A Content Security Policy should be carefully crafted to allow MapLibre GL's inline style requirements and the OpenStreetMap tile origin.

---

### 7.6 [Low] Upload script uses `CacheControl: public, max-age=86400` for all artifacts

**File**: `pipeline/upload_model_assets_to_r2.py` — line 289

All R2 objects are uploaded with a 24-hour `Cache-Control`. The API handlers then set their own `Cache-Control` headers (ranging from 20 minutes to 6 hours) on their responses to browsers. Since R2 objects are not served directly to browsers (they go through the Worker), the R2-level `Cache-Control` is for Cloudflare's internal CDN between R2 and the Worker. The 24-hour TTL means newly uploaded artifacts may not be visible to Workers for up to 24 hours if the CDN path between R2 and the Worker caches them.

**Recommendation**: Test whether Cloudflare Workers bypass the R2 CDN cache or respect it. If the CDN cache is bypassed (Workers read directly from R2), this is fine. If not, use a shorter `max-age` (e.g., `300`) or `no-store` for R2 objects that are mutable.

---

## Section 8: Data Pipeline Quality

### 8.1 [Medium] Scotland property type hardcoded as "D" (Detached)

**File**: `pipeline/build_property_artifacts.py` — line 272

```python
chunk["property_type"] = "D"
chunk["new_build"] = "N"
```

All Scotland transactions are tagged as Detached/Existing regardless of actual property type. This is acknowledged as a data limitation (Scotland data lacks type flags), but it means:
- When a user filters by property type on the Scotland/northern England boundary, Scotland data will contribute to "Detached" statistics even if a cell contains mixed property types.
- The CRUMB notes this as a general data coverage issue but it is not surfaced to the user in the UI for affected cells.

**Recommendation**: Tag Scotland rows with a flag (`scotland: True`) in the artifact and use it in the UI to show a more specific caveat: "This cell includes Scotland data (type classified as Detached)."

---

### 8.2 [Medium] No data integrity validation after pipeline stages

**File**: `pipeline/run_pipeline.py`

The orchestrator runs each pipeline step as a subprocess and checks only the exit code (via `subprocess.run(check=True)`). No validation is performed after each step to confirm:
- The output files exist and are non-empty.
- The JSON output is parseable.
- Row counts are plausible (e.g., total UK transactions in a year should be ~1M+).
- No essential grid resolutions are missing from the output.

A step that exits with code 0 but produces corrupt or empty output (e.g., due to a pandas silently dropping all rows from a join) will not be caught.

**Recommendation**: Add a post-pipeline validation step that reads each artifact, parses the JSON, and checks row counts against expected minimums:
```python
def validate_artifacts() -> None:
    for name in REQUIRED_PROPERTY_ASSET_NAMES:
        path = MODEL_PROPERTY_DIR / name
        with gzip.open(path, "rt") as f:
            rows = json.load(f)
        assert len(rows) > 1000, f"Too few rows in {name}: {len(rows)}"
```

---

### 8.3 [Medium] EPC floor area fill uses postcode average but does not validate outliers

**File**: `pipeline/build_property_artifacts.py` — (referenced in DEEP core docs)

When a transaction cannot be joined to an EPC record, the floor area is filled with the postcode-level average for that property type/new build segment. This fill is applied without capping or outlier detection. Postcode averages computed from few EPC records (e.g., 1–2 records) may be highly unreliable, and the fill could produce PPSF values that are extreme outliers — especially for new build properties in newly developed postcodes where EPC records are sparse.

**Recommendation**: Add a minimum confidence threshold for the fill (e.g., require at least 5 EPC records in the postcode before using the postcode average; otherwise use a district-level average). Log how many transactions received the fill to assess coverage.

---

### 8.4 [Low] `SCOTLAND_DAILY_THRESHOLD = 50` is not empirically justified

**File**: `pipeline/build_property_artifacts.py` — line 19

The comment in the CRUMB describes this constant as a "busy-day detection" heuristic but there is no documented justification for the value 50. If the Scotland data source increases reporting density over time, this threshold may become too conservative and inadvertently exclude recent data.

**Recommendation**: Add a comment documenting the empirical basis for this value (e.g., "typical Scotland daily transaction count is N; threshold of 50 distinguishes bulk-delivered historic data from live reporting") and add a log statement printing the detected cutoff date so it can be inspected each pipeline run.

---

## Section 9: Accessibility and UX Quality

### 9.1 [Low] Map popup HTML contains emoji characters that may not render in all browsers

**File**: `app/Map.tsx` — lines 1300, 1309, 1312, 1314, 1316, 1320, 1326–1328

The index scoring popup uses emoji (`🗺️`, `🏠`, `💰`, `🌊`, `🏫`, `🏖️`) directly in the HTML string. While these are supported by modern browsers, they may render as boxes on older mobile browsers or assistive technology.

**Recommendation**: Replace emojis in critical data labels with text or SVG icons. Consider providing `aria-label` attributes on the MapLibre popup for screen reader accessibility.

---

### 9.2 [Low] `coastWeight` slider is visible and interactive but produces no scoring effect

**File**: `app/DEEP/core/index-scoring.md` documents: "Coast weight is implemented as a UI control but not wired to actual coastline distance data. Setting it > 0 has no effect on scoring."

A user setting a nonzero coast weight will see the slider respond but the score output will not change. This is a confusing UX experience.

**Recommendation**: Either implement the coast proximity scoring, or disable/hide the slider with a tooltip ("Coming soon") until it is implemented.

---

## Summary of Recommended Priorities

### Immediate (Critical/High severity — address before next traffic spike)

1. **Escape all user/data-derived values** in MapLibre popup HTML to prevent XSS (Section 1.1).
2. **Validate `endMonth`, `propertyType`, and `newBuild` parameters** against allowlists in `cells.ts` before constructing R2 keys (Section 1.2).
3. **Fix `outcodes.ts` to use the bucket resolution helper** instead of direct `env.R2.get()` (Section 2.4).
4. **Add a module-level in-memory cache with TTL** to `supporters.ts` (Section 1.3).
5. **Extract `decompressGzip` and `gunzipToString`** to a shared library module (Section 3.1).

### Short Term (High severity — address in next sprint)

6. **Add `requirements.txt`** for the Python pipeline (Section 7.3).
7. **Add a `wrangler.toml`** to make deployment reproducible from the repository (Section 7.1).
8. **Implement the first round of unit tests**: pipeline data transformation functions and API handler logic (Sections 6.1, 6.2).
9. **Fix `fetchPostcodesRef` race condition** using abort controller and sequence number (Section 2.1).
10. **Add TTLs to `deltaCache` and `voteCache`** in worker handlers (Section 4.1).
11. **Replace hardcoded vote cells version fallback** with a dynamic version lookup (Section 7.2).
12. **Add data integrity validation step** to the pipeline orchestrator (Section 8.2).

### Medium Term (Medium severity — address in next development cycle)

13. Consolidate `Env` interface and shared types into `functions/_lib/` (Section 5.2).
14. Consolidate `resolveSchoolObject`/`resolveFloodObject` into a shared utility (Section 3.2).
15. Add `public/_headers` for security headers (Section 7.5).
16. Add a LRU eviction policy to `geoCacheRef` (Section 4.4).
17. Fix `copy_model_to_public` to preserve directory structure (Section 7.4).
18. Remove the `key` override parameter from flood/school endpoints or add authentication (Section 1.6).
19. Reduce the 7-sequential-R2-reads waterfall to a 2-step probe (Section 4.5).
20. Disable or label the `coastWeight` slider as unimplemented (Section 9.2).

### Low Priority (Improvements and polish)

21. Fix `getBucket` inconsistency in `deltas.ts` (Section 3.9).
22. Type MapLibre expression builders to reduce `as any` coverage gaps (Section 5.1).
23. Add a `@ts-ignore`-free ambient type for `DecompressionStream` (Section 1.7).
24. Make `buildZooplaHref` a pure function (Section 3.11).
25. Add unit tests for frontend utility functions (Section 6.3).

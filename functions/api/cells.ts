import type { R2Bucket } from "@cloudflare/workers-types";
import { gunzipToString } from "../_lib/gzip";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const url = new URL(request.url);

  // ---- query params (match your UI state) ----
  const grid = (url.searchParams.get("grid") ?? "25km") as GridKey;
  const metric = (url.searchParams.get("metric") ?? "median") as CellsMetric;
  const propertyType = (url.searchParams.get("propertyType") ?? "ALL").toUpperCase();
  const newBuild = (url.searchParams.get("newBuild") ?? "ALL").toUpperCase();
  const endMonthParam = (url.searchParams.get("endMonth") ?? "LATEST").toUpperCase();
  const minTxCount = Math.max(1, Number.parseInt(url.searchParams.get("minTxCount") ?? "3", 10) || 3);
  const modelledParam = url.searchParams.get("modelled") ?? "blend";
  const modelledMode = (["actual", "estimated", "model_only"] as const).includes(modelledParam as any)
    ? (modelledParam as "actual" | "estimated" | "model_only")
    : "blend";
  // For blend/estimated/model_only on 1km median, keep sparse rows so applyModelledData
  // can see them (it applies the real minTxCount threshold internally).
  const effectiveMinTxCount = (grid === "1km" && metric === "median" && modelledMode !== "actual") ? 1 : minTxCount;

  if (!isGridKey(grid)) {
    return Response.json("Invalid grid. Use 1km|5km|10km|25km", { status: 400 });
  }

  if (!isCellsMetric(metric)) {
    return Response.json("Invalid metric. Use median|median_ppsf", { status: 400 });
  }

  const parsedTypes = parseAndNormalizePropertyTypes(propertyType);
  if (!parsedTypes) {
    return Response.json("Invalid propertyType. Use ALL|D|S|T|F or comma-separated e.g. D,S", { status: 400 });
  }
  const { types: propertyTypes, canonical: canonicalPropertyType } = parsedTypes;

  if (!isNewBuild(newBuild)) {
    return Response.json("Invalid newBuild. Use ALL|Y|N", { status: 400 });
  }

  if (!isValidEndMonthParam(endMonthParam)) {
    return Response.json("Invalid endMonth. Use LATEST or YYYY-MM-DD", { status: 400 });
  }

  // ---- resolve end_month ----
  let endMonth: string;
  if (endMonthParam === "LATEST") {
    const manifest = await getManifest(env, grid, metric);
    if (!manifest) {
      // Fall back to legacy monolithic path
      return await legacyHandler(env, grid, metric, canonicalPropertyType, propertyTypes, newBuild, endMonthParam, minTxCount);
    }
    const months = [...new Set(manifest.partitions.map((p: any) => p.end_month as string))].sort();
    endMonth = months[months.length - 1] as string;
  } else {
    endMonth = endMonthParam;
  }

  // ---- fetch partition(s) ----
  const bucket = getBucket(env);

  if (propertyTypes.length > 1) {
    // Multi-type: parallel R2 fetch, weighted-mean merge per cell
    const mergedCacheKey = `cells/${grid}/${metric}/${endMonth}/${canonicalPropertyType}_${newBuild}.json.gz`;
    const now = Date.now();
    const cachedMerged = PARTITION_CACHE.get(mergedCacheKey);
    if (cachedMerged && now - cachedMerged.loadedAtMs <= CACHE_TTL_MS) {
      const rows = applyFilters(cachedMerged.rows, effectiveMinTxCount, metric);
      let enriched = await backfillAll(env, grid, rows);
      if (grid === "1km" && metric === "median" && modelledMode !== "actual") {
        const modelledLookup = await getCachedModelledLookup(env, canonicalPropertyType, newBuild).catch(() => null);
        if (modelledLookup) enriched = applyModelledData(enriched, modelledLookup, modelledMode as "blend" | "estimated" | "model_only", minTxCount);
      }
      return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, modelledMode, count: enriched.length, rows: enriched });
    }

    const partitionResults = await Promise.all(
      propertyTypes.map((pt) =>
        fetchPartitionRows(bucket, `cells/${grid}/${metric}/${endMonth}/${pt}_${newBuild}.json.gz`)
      )
    );
    const validPartitions = partitionResults.filter((p): p is CellRow[] => p !== null);
    if (validPartitions.length === 0) {
      return await legacyHandler(env, grid, metric, canonicalPropertyType, propertyTypes, newBuild, endMonth, minTxCount);
    }

    const rawMerged = mergePartitionRows(validPartitions);
    PARTITION_CACHE.set(mergedCacheKey, { rows: rawMerged, loadedAtMs: Date.now() });
    const rows = applyFilters(rawMerged, effectiveMinTxCount, metric);
    let enriched = await backfillAll(env, grid, rows);
    if (grid === "1km" && metric === "median" && modelledMode !== "actual") {
      const modelledLookup = await getCachedModelledLookup(env, canonicalPropertyType, newBuild).catch(() => null);
      if (modelledLookup) enriched = applyModelledData(enriched, modelledLookup, modelledMode as "blend" | "estimated" | "model_only", minTxCount);
    }
    return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, modelledMode, count: enriched.length, rows: enriched });
  }

  // Single type (or ALL): standard single-partition fetch
  const partitionKey = `cells/${grid}/${metric}/${endMonth}/${canonicalPropertyType}_${newBuild}.json.gz`;

  // Check in-memory cache
  const now = Date.now();
  const cached = PARTITION_CACHE.get(partitionKey);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) {
    const rows = applyFilters(cached.rows, effectiveMinTxCount, metric);
    let enriched = await backfillAll(env, grid, rows);
    if (grid === "1km" && metric === "median" && modelledMode !== "actual") {
      const modelledLookup = await getCachedModelledLookup(env, canonicalPropertyType, newBuild).catch(() => null);
      if (modelledLookup) enriched = applyModelledData(enriched, modelledLookup, modelledMode as "blend" | "estimated" | "model_only", minTxCount);
    }
    return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, modelledMode, count: enriched.length, rows: enriched });
  }

  // Fetch from R2
  const obj = await bucket.get(partitionKey);

  if (!obj) {
    // Partition not found — try legacy monolithic file as fallback
    return await legacyHandler(env, grid, metric, canonicalPropertyType, propertyTypes, newBuild, endMonth, minTxCount);
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rawRows = JSON.parse(jsonText) as CellRow[];

  // Cache it
  PARTITION_CACHE.set(partitionKey, { rows: rawRows, loadedAtMs: Date.now() });

  const rows = applyFilters(rawRows, effectiveMinTxCount, metric);
  let enriched = await backfillAll(env, grid, rows);
  if (grid === "1km" && metric === "median" && modelledMode !== "actual") {
    const modelledLookup = await getCachedModelledLookup(env, canonicalPropertyType, newBuild).catch(() => null);
    if (modelledLookup) enriched = applyModelledData(enriched, modelledLookup, modelledMode as "blend" | "estimated" | "model_only", minTxCount);
  }
  return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, modelledMode, count: enriched.length, rows: enriched });
};

/* ---------- types ---------- */

type GridKey = "1km" | "5km" | "10km" | "25km";
type CellsMetric = "median" | "median_ppsf";
type PropertyType = "ALL" | "D" | "S" | "T" | "F";
type NewBuild = "ALL" | "Y" | "N";

function isGridKey(v: string): v is GridKey {
  return v === "1km" || v === "5km" || v === "10km" || v === "25km";
}

function isCellsMetric(v: string): v is CellsMetric {
  return v === "median" || v === "median_ppsf";
}

function isPropertyType(v: string): v is PropertyType {
  return v === "ALL" || v === "D" || v === "S" || v === "T" || v === "F";
}

function isNewBuild(v: string): v is NewBuild {
  return v === "ALL" || v === "Y" || v === "N";
}

function isValidEndMonthParam(v: string): boolean {
  return v === "LATEST" || /^\d{4}-\d{2}-\d{2}$/.test(v);
}

type CellRow = {
  gx: number;
  gy: number;
  end_month: string;
  property_type: string;
  new_build: string;
  median?: number;
  median_ppsf?: number;
  tx_count: number;
  delta_gbp?: number;
  delta_pct?: number;
  years_stale?: number;
  pct_progressive?: number;
  pct_conservative?: number;
  pct_popular_right?: number;
  constituency?: string;
  country?: string;
  mean_dist_km?: number;
  pct_wfh?: number;
  mean_age?: number;
  age_score?: number;
  pct_under_15?: number;
  pct_15_24?: number;
  pct_25_44?: number;
  pct_45_64?: number;
  pct_65_plus?: number;
  // modelled price estimate fields
  is_modelled?: boolean;
  model_confidence?: number;   // 0 | 1 | 2
  n_years_model?: number;
  ratio_cv_model?: number;
  estimated_median?: number;
  actual_median?: number;      // original sparse median before model replacement (blend mode only)
  bb_avg_speed?: number;       // weighted avg max available download speed (Mbit/s)
};

type VoteCellRow = {
  gx: number;
  gy: number;
  pct_progressive: number;
  pct_conservative: number;
  pct_popular_right: number;
  constituency?: string;
  country?: string;
};

type VoteCellValue = Omit<VoteCellRow, "gx" | "gy">;

type CommuteCellRow = {
  gx: number;
  gy: number;
  mean_dist_km: number;
  pct_wfh: number;
  pct_lt5: number;
  pct_5_10: number;
  pct_10_20: number;
  pct_20_60: number;
  pct_60p: number;
};

type CommuteCellValue = Omit<CommuteCellRow, "gx" | "gy">;

type AgeCellRow = {
  gx: number;
  gy: number;
  mean_age: number;
  age_score: number;
  pct_under_15: number;
  pct_15_24: number;
  pct_25_44: number;
  pct_45_64: number;
  pct_65_plus: number;
};

type AgeCellValue = Omit<AgeCellRow, "gx" | "gy">;

type CrimeCellRow = {
  gx: number;
  gy: number;
  violent_rate:         number;
  property_rate:        number;
  asb_rate:             number;
  total_rate:           number;
  violent_count:        number;
  property_count:       number;
  asb_count:            number;
  total_count:          number;
  crime_score:          number;
  violent_score:        number;
  property_score:       number;
  asb_score:            number;
  crime_local_score:    number;
  violent_local_score:  number;
  property_local_score: number;
  asb_local_score:      number;
};

type CrimeCellValue = Omit<CrimeCellRow, "gx" | "gy">;

type EpcFuelCellRow = {
  gx: number;
  gy: number;
  n: number;
  pct_gas: number;
  pct_electric: number;
  pct_oil: number;
  pct_lpg: number;
  pct_other: number; // raw JSON field name; stored as fuel_pct_other to avoid clash with vote pct_other
};

type EpcFuelCellValue = {
  n: number;
  pct_gas: number;
  pct_electric: number;
  pct_oil: number;
  pct_lpg: number;
  fuel_pct_other: number;
};

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
}

/* ---------- helpers ---------- */

function applyFilters(rows: CellRow[], minTxCount: number, metric: CellsMetric): CellRow[] {
  return rows
    .filter((r) => Number(r.tx_count ?? 0) >= minTxCount)
    .map((r) => ({
      ...r,
      median:
        metric === "median_ppsf"
          ? Number((r as any).median_ppsf ?? r.median ?? NaN)
          : Number(r.median ?? NaN),
    }));
}

function jsonResponse(data: any) {
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=1200" },
  });
}

/* ---------- multi-type helpers ---------- */

/** Parse and normalise a propertyType query param which may be a comma-separated list.
 *  Returns { types, canonical } where types is the array of single-letter atoms to fetch
 *  and canonical is the sorted joined string used as the cache/response key.
 *  Returns null if any atom is invalid.
 */
function parseAndNormalizePropertyTypes(raw: string): { types: string[]; canonical: string } | null {
  const atoms = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (atoms.length === 0) return null;
  if (atoms.includes("ALL")) return { types: ["ALL"], canonical: "ALL" };
  const ORDER = ["D", "S", "T", "F"];
  for (const a of atoms) {
    if (!ORDER.includes(a)) return null;
  }
  const unique = [...new Set(atoms)];
  unique.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (unique.length === 4) return { types: ["ALL"], canonical: "ALL" };
  if (unique.length === 1) return { types: unique, canonical: unique[0] };
  return { types: unique, canonical: unique.join(",") };
}

/** Fetch a single partition from R2, using the in-memory cache. */
async function fetchPartitionRows(bucket: R2Bucket, partitionKey: string): Promise<CellRow[] | null> {
  const now = Date.now();
  const cached = PARTITION_CACHE.get(partitionKey);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.rows;
  const obj = await bucket.get(partitionKey);
  if (!obj) return null;
  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rawRows = JSON.parse(jsonText) as CellRow[];
  PARTITION_CACHE.set(partitionKey, { rows: rawRows, loadedAtMs: Date.now() });
  return rawRows;
}

/** Merge rows from multiple partitions by (gx, gy) using tx_count-weighted mean
 *  for median and median_ppsf.  All partitions are raw (pre-applyFilters) rows.
 */
function mergePartitionRows(partitions: CellRow[][]): CellRow[] {
  type Accum = {
    gx: number; gy: number;
    medianWSum: number; medianTx: number;
    ppsfWSum: number; ppsfTx: number;
    totalTx: number;
    endMonth: string; newBuild: string;
  };
  const cellMap = new Map<string, Accum>();
  for (const rows of partitions) {
    for (const r of rows) {
      const tx = Number(r.tx_count ?? 0);
      if (tx <= 0) continue;
      const key = `${r.gx}_${r.gy}`;
      let acc = cellMap.get(key);
      if (!acc) {
        acc = { gx: r.gx, gy: r.gy, medianWSum: 0, medianTx: 0, ppsfWSum: 0, ppsfTx: 0, totalTx: 0, endMonth: r.end_month, newBuild: r.new_build };
        cellMap.set(key, acc);
      }
      acc.totalTx += tx;
      const med = Number(r.median ?? NaN);
      if (Number.isFinite(med)) { acc.medianWSum += med * tx; acc.medianTx += tx; }
      const ppsf = Number((r as any).median_ppsf ?? NaN);
      if (Number.isFinite(ppsf)) { acc.ppsfWSum += ppsf * tx; acc.ppsfTx += tx; }
    }
  }
  const merged: CellRow[] = [];
  for (const acc of cellMap.values()) {
    const row: CellRow = {
      gx: acc.gx, gy: acc.gy,
      end_month: acc.endMonth,
      property_type: "MULTI",
      new_build: acc.newBuild,
      tx_count: acc.totalTx,
    };
    if (acc.medianTx > 0) row.median = acc.medianWSum / acc.medianTx;
    if (acc.ppsfTx > 0) (row as any).median_ppsf = acc.ppsfWSum / acc.ppsfTx;
    merged.push(row);
  }
  return merged;
}

/* ---------- partition cache ---------- */

type PartitionEntry = { rows: CellRow[]; loadedAtMs: number };
const PARTITION_CACHE = new Map<string, PartitionEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/* ---------- manifest cache ---------- */

const MANIFEST_CACHE = new Map<string, { data: any; loadedAtMs: number }>();

async function getManifest(env: Env, grid: GridKey, metric: CellsMetric): Promise<any | null> {
  const key = `cells/${grid}/${metric}/_manifest.json`;
  const now = Date.now();
  const cached = MANIFEST_CACHE.get(key);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) {
    return cached.data;
  }

  const bucket = getBucket(env);
  const obj = await bucket.get(key);
  if (!obj) return null;

  const text = await obj.text();
  const data = JSON.parse(text);
  MANIFEST_CACHE.set(key, { data, loadedAtMs: Date.now() });
  return data;
}

/* ---------- vote data ---------- */

const VOTE_CACHE_BY_GRID: Partial<Record<GridKey, Map<string, VoteCellValue>>> = {};

function voteKeyForGrid(grid: GridKey) {
  switch (grid) {
    case "1km": return "vote_cells_1km.json.gz";
    case "5km": return "vote_cells_5km.json.gz";
    case "10km": return "vote_cells_10km.json.gz";
    case "25km": return "vote_cells_25km.json.gz";
  }
}

async function getCachedVoteLookup(env: Env, grid: GridKey): Promise<Map<string, VoteCellValue> | null> {
  const cached = VOTE_CACHE_BY_GRID[grid];
  if (cached) return cached;

  const bucket = getBucket(env);
  const key = voteKeyForGrid(grid);
  const obj = await bucket.get(key);
  if (!obj) return null;

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as VoteCellRow[];

  const lookup = new Map<string, VoteCellValue>();
  for (const row of rows) {
    lookup.set(`${row.gx}_${row.gy}`, {
      pct_progressive: Number(row.pct_progressive ?? 0),
      pct_conservative: Number(row.pct_conservative ?? 0),
      pct_popular_right: Number(row.pct_popular_right ?? 0),
      constituency: row.constituency,
      country: row.country,
    });
  }

  VOTE_CACHE_BY_GRID[grid] = lookup;
  return lookup;
}

async function backfillVotes(env: Env, grid: GridKey, rows: CellRow[]): Promise<CellRow[]> {
  let voteLookup: Map<string, VoteCellValue> | null = null;
  try {
    voteLookup = await getCachedVoteLookup(env, grid);
  } catch {
    return rows;
  }
  if (!voteLookup) return rows;

  return rows.map((row) => {
    const vote = voteLookup!.get(`${row.gx}_${row.gy}`);
    if (!vote) return row;
    return {
      ...row,
      pct_progressive: vote.pct_progressive,
      pct_conservative: vote.pct_conservative,
      pct_popular_right: vote.pct_popular_right,
      constituency: vote.constituency,
      country: vote.country,
    };
  });
}

/* ---------- slim country lookup (all grids) ---------- */

// country_cells_{grid}.json.gz is a nested dict {gx_km: {gy_km: country_char}}
// built from vote_cells_{grid} by build_country_lookup_assets.py.
// Sizes: 1km=44 KB, 5km=5 KB, 10km=1.3 KB, 25km=0.4 KB compressed.
// Loading this separately from the vote file means country is always available
// for flood/school scoring even if the vote lookup fails, and decouples country
// from the large vote_cells_1km.json.gz file (2 MB compressed).
const COUNTRY_CACHE_BY_GRID: Partial<Record<GridKey, Map<string, string> | null>> = {};

async function getCachedCountryLookup(env: Env, grid: GridKey): Promise<Map<string, string> | null> {
  // If already in cache (including explicit null = file not found), return immediately
  if (Object.prototype.hasOwnProperty.call(COUNTRY_CACHE_BY_GRID, grid)) {
    return COUNTRY_CACHE_BY_GRID[grid] ?? null;
  }

  const bucket = getBucket(env);
  const obj = await bucket.get(`country_cells_${grid}.json.gz`);
  if (!obj) {
    COUNTRY_CACHE_BY_GRID[grid] = null; // cache miss so we don't retry on every request
    return null;
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  // nested {gx_km_str: {gy_km_str: country_char}}
  const nested = JSON.parse(jsonText) as Record<string, Record<string, string>>;

  const lookup = new Map<string, string>();
  for (const [gxKm, ys] of Object.entries(nested)) {
    const gx = String(Number(gxKm) * 1000);
    for (const [gyKm, country] of Object.entries(ys)) {
      const gy = String(Number(gyKm) * 1000);
      lookup.set(`${gx}_${gy}`, country);
    }
  }

  COUNTRY_CACHE_BY_GRID[grid] = lookup;
  return lookup;
}

/* ---------- commute data ---------- */

const COMMUTE_CACHE_BY_GRID: Partial<Record<GridKey, { lookup: Map<string, CommuteCellValue>; loadedAtMs: number }>> = {};

function commuteKeyForGrid(grid: GridKey) {
  switch (grid) {
    case "1km":  return "commute_cells_1km.json.gz";
    case "5km":  return "commute_cells_5km.json.gz";
    case "10km": return "commute_cells_10km.json.gz";
    case "25km": return "commute_cells_25km.json.gz";
  }
}

async function getCachedCommuteLookup(env: Env, grid: GridKey): Promise<Map<string, CommuteCellValue> | null> {
  const now = Date.now();
  const cached = COMMUTE_CACHE_BY_GRID[grid];
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.lookup;

  const bucket = getBucket(env);
  const key = commuteKeyForGrid(grid);
  const obj = await bucket.get(key);
  if (!obj) {
    // Cache the miss so we don't re-hit R2 on every request when the file doesn't exist
    COMMUTE_CACHE_BY_GRID[grid] = { lookup: new Map(), loadedAtMs: Date.now() };
    return null;
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as CommuteCellRow[];

  const lookup = new Map<string, CommuteCellValue>();
  for (const row of rows) {
    lookup.set(`${row.gx}_${row.gy}`, {
      mean_dist_km: Number(row.mean_dist_km ?? 0),
      pct_wfh: Number(row.pct_wfh ?? 0),
      pct_lt5: Number(row.pct_lt5 ?? 0),
      pct_5_10: Number(row.pct_5_10 ?? 0),
      pct_10_20: Number(row.pct_10_20 ?? 0),
      pct_20_60: Number(row.pct_20_60 ?? 0),
      pct_60p: Number(row.pct_60p ?? 0),
    });
  }

  COMMUTE_CACHE_BY_GRID[grid] = { lookup, loadedAtMs: Date.now() };
  return lookup;
}

async function backfillCommute(env: Env, grid: GridKey, rows: CellRow[]): Promise<CellRow[]> {
  let commuteLookup: Map<string, CommuteCellValue> | null = null;
  try {
    commuteLookup = await getCachedCommuteLookup(env, grid);
  } catch {
    return rows;
  }
  if (!commuteLookup) return rows;

  return rows.map((row) => {
    const commute = commuteLookup!.get(`${row.gx}_${row.gy}`);
    if (!commute) return row;
    return {
      ...row,
      mean_dist_km: commute.mean_dist_km,
      pct_wfh: commute.pct_wfh,
      pct_lt5: commute.pct_lt5,
      pct_5_10: commute.pct_5_10,
      pct_10_20: commute.pct_10_20,
      pct_20_60: commute.pct_20_60,
      pct_60p: commute.pct_60p,
    };
  });
}

/* ---------- age data ---------- */

const AGE_CACHE_BY_GRID: Partial<Record<GridKey, { lookup: Map<string, AgeCellValue>; loadedAtMs: number }>> = {};

function ageKeyForGrid(grid: GridKey) {
  switch (grid) {
    case "1km":  return "age_cells_1km.json.gz";
    case "5km":  return "age_cells_5km.json.gz";
    case "10km": return "age_cells_10km.json.gz";
    case "25km": return "age_cells_25km.json.gz";
  }
}

async function getCachedAgeLookup(env: Env, grid: GridKey): Promise<Map<string, AgeCellValue> | null> {
  const now = Date.now();
  const cached = AGE_CACHE_BY_GRID[grid];
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.lookup;

  const bucket = getBucket(env);
  const key = ageKeyForGrid(grid);
  const obj = await bucket.get(key);
  if (!obj) {
    // Cache the miss so we don't re-hit R2 on every request when the file doesn't exist
    AGE_CACHE_BY_GRID[grid] = { lookup: new Map(), loadedAtMs: Date.now() };
    return null;
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as AgeCellRow[];

  const lookup = new Map<string, AgeCellValue>();
  for (const row of rows) {
    lookup.set(`${row.gx}_${row.gy}`, {
      mean_age:      Number(row.mean_age      ?? 41.5),
      age_score:     Number(row.age_score     ?? 0.5),
      pct_under_15:  Number(row.pct_under_15  ?? 0),
      pct_15_24:     Number(row.pct_15_24     ?? 0),
      pct_25_44:     Number(row.pct_25_44     ?? 0),
      pct_45_64:     Number(row.pct_45_64     ?? 0),
      pct_65_plus:   Number(row.pct_65_plus   ?? 0),
    });
  }

  AGE_CACHE_BY_GRID[grid] = { lookup, loadedAtMs: Date.now() };
  return lookup;
}

async function backfillAge(env: Env, grid: GridKey, rows: CellRow[]): Promise<CellRow[]> {
  let ageLookup: Map<string, AgeCellValue> | null = null;
  try {
    ageLookup = await getCachedAgeLookup(env, grid);
  } catch {
    return rows;
  }
  if (!ageLookup) return rows;

  return rows.map((row) => {
    const age = ageLookup!.get(`${row.gx}_${row.gy}`);
    if (!age) return row;
    return {
      ...row,
      mean_age:     age.mean_age,
      age_score:    age.age_score,
      pct_under_15: age.pct_under_15,
      pct_15_24:    age.pct_15_24,
      pct_25_44:    age.pct_25_44,
      pct_45_64:    age.pct_45_64,
      pct_65_plus:  age.pct_65_plus,
    };
  });
}

/* ---------- crime cell data ---------- */

const CRIME_CACHE_BY_GRID: Partial<Record<GridKey, { lookup: Map<string, CrimeCellValue>; loadedAtMs: number }>> = {};

function crimeKeyForGrid(grid: GridKey) {
  switch (grid) {
    case "1km":  return "crime_cells_1km.json.gz";
    case "5km":  return "crime_cells_5km.json.gz";
    case "10km": return "crime_cells_10km.json.gz";
    case "25km": return "crime_cells_25km.json.gz";
  }
}

async function getCachedCrimeLookup(env: Env, grid: GridKey): Promise<Map<string, CrimeCellValue> | null> {
  const now = Date.now();
  const cached = CRIME_CACHE_BY_GRID[grid];
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.lookup;

  const bucket = getBucket(env);
  const key = crimeKeyForGrid(grid);
  const obj = await bucket.get(key);
  if (!obj) {
    CRIME_CACHE_BY_GRID[grid] = { lookup: new Map(), loadedAtMs: Date.now() };
    return null;
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as CrimeCellRow[];

  const lookup = new Map<string, CrimeCellValue>();
  for (const row of rows) {
    lookup.set(`${row.gx}_${row.gy}`, {
      violent_rate:         Number(row.violent_rate         ?? 0),
      property_rate:        Number(row.property_rate        ?? 0),
      asb_rate:             Number(row.asb_rate             ?? 0),
      total_rate:           Number(row.total_rate           ?? 0),
      violent_count:        Number(row.violent_count        ?? 0),
      property_count:       Number(row.property_count       ?? 0),
      asb_count:            Number(row.asb_count            ?? 0),
      total_count:          Number(row.total_count          ?? 0),
      crime_score:          Number(row.crime_score          ?? 50),
      violent_score:        Number(row.violent_score        ?? 50),
      property_score:       Number(row.property_score       ?? 50),
      asb_score:            Number(row.asb_score            ?? 50),
      crime_local_score:    Number(row.crime_local_score    ?? row.crime_score    ?? 50),
      violent_local_score:  Number(row.violent_local_score  ?? row.violent_score  ?? 50),
      property_local_score: Number(row.property_local_score ?? row.property_score ?? 50),
      asb_local_score:      Number(row.asb_local_score      ?? row.asb_score      ?? 50),
    });
  }

  CRIME_CACHE_BY_GRID[grid] = { lookup, loadedAtMs: Date.now() };
  return lookup;
}

/* ---------- EPC fuel cell data ---------- */

const EPC_FUEL_CACHE_BY_GRID: Partial<Record<GridKey, { lookup: Map<string, EpcFuelCellValue>; loadedAtMs: number }>> = {};

function epcFuelKeyForGrid(grid: GridKey) {
  switch (grid) {
    case "1km":  return "epc_fuel_cells_1km.json.gz";
    case "5km":  return "epc_fuel_cells_5km.json.gz";
    case "10km": return "epc_fuel_cells_10km.json.gz";
    case "25km": return "epc_fuel_cells_25km.json.gz";
  }
}

async function getCachedEpcFuelLookup(env: Env, grid: GridKey): Promise<Map<string, EpcFuelCellValue> | null> {
  const now = Date.now();
  const cached = EPC_FUEL_CACHE_BY_GRID[grid];
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.lookup;

  const bucket = getBucket(env);
  const key = epcFuelKeyForGrid(grid);
  const obj = await bucket.get(key);
  if (!obj) {
    EPC_FUEL_CACHE_BY_GRID[grid] = { lookup: new Map(), loadedAtMs: Date.now() };
    return null;
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as EpcFuelCellRow[];

  const lookup = new Map<string, EpcFuelCellValue>();
  for (const row of rows) {
    lookup.set(`${row.gx}_${row.gy}`, {
      n:              Number(row.n            ?? 0),
      pct_gas:        Number(row.pct_gas      ?? 0),
      pct_electric:   Number(row.pct_electric ?? 0),
      pct_oil:        Number(row.pct_oil      ?? 0),
      pct_lpg:        Number(row.pct_lpg      ?? 0),
      fuel_pct_other: Number(row.pct_other    ?? 0),
    });
  }

  EPC_FUEL_CACHE_BY_GRID[grid] = { lookup, loadedAtMs: Date.now() };
  return lookup;
}

/* ---------- broadband speed cell data ---------- */

const BROADBAND_CACHE_BY_GRID: Partial<Record<GridKey, { lookup: Map<string, number>; loadedAtMs: number }>> = {};

async function getCachedBroadbandLookup(env: Env, grid: GridKey): Promise<Map<string, number> | null> {
  const now = Date.now();
  const cached = BROADBAND_CACHE_BY_GRID[grid];
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.lookup.size > 0 ? cached.lookup : null;

  const bucket = getBucket(env);
  const key = `broadband_cells_${grid}.json.gz`;
  const obj = await bucket.get(key);
  if (!obj) {
    BROADBAND_CACHE_BY_GRID[grid] = { lookup: new Map(), loadedAtMs: Date.now() };
    return null;
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as Array<{ gx: number; gy: number; bb_avg_speed: number }>;

  const lookup = new Map<string, number>();
  for (const row of rows) {
    lookup.set(`${row.gx}_${row.gy}`, row.bb_avg_speed);
  }

  BROADBAND_CACHE_BY_GRID[grid] = { lookup, loadedAtMs: Date.now() };
  return lookup.size > 0 ? lookup : null;
}

/* ---------- modelled price estimates ---------- */

type ModelledRow = { estimated_median: number; model_confidence: number; n_years: number; ratio_cv: number };
const MODELLED_CACHE = new Map<string, { lookup: Map<string, ModelledRow>; loadedAtMs: number }>();

async function getCachedModelledLookup(
  env: Env,
  propertyType: string,
  newBuild: string,
): Promise<Map<string, ModelledRow> | null> {
  const cacheMapKey = `modelled_1km_${propertyType}_${newBuild}`;
  const now = Date.now();
  const cached = MODELLED_CACHE.get(cacheMapKey);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) {
    return cached.lookup.size > 0 ? cached.lookup : null;
  }
  const bucket = getBucket(env);
  const obj = await bucket.get(`${cacheMapKey}.json.gz`);
  if (!obj) {
    MODELLED_CACHE.set(cacheMapKey, { lookup: new Map(), loadedAtMs: Date.now() });
    return null;
  }
  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as Array<{ gx: number; gy: number; estimated_median: number; model_confidence: number; n_years: number; ratio_cv: number }>;
  const lookup = new Map<string, ModelledRow>();
  for (const r of rows) {
    lookup.set(`${r.gx}_${r.gy}`, { estimated_median: r.estimated_median, model_confidence: r.model_confidence, n_years: r.n_years, ratio_cv: r.ratio_cv });
  }
  MODELLED_CACHE.set(cacheMapKey, { lookup, loadedAtMs: Date.now() });
  return lookup.size > 0 ? lookup : null;
}

/**
 * Merge modelled estimates into the enriched row set.
 *
 * Modes:
 *   blend      — keep actual rows with tx_count >= minTxCount; for sparse/missing cells
 *                inject modelled rows; annotate well-sampled actuals with estimated_median.
 *   estimated  — replace all actual medians with modelled estimates where available;
 *                inject modelled rows for cells with no actual data.
 *   model_only — return ONLY injected cells (no actual data in partition); pure coverage map.
 *   actual     — noop (should not be called).
 */
function applyModelledData(
  enrichedRows: CellRow[],
  modelledLookup: Map<string, ModelledRow>,
  modelledMode: "blend" | "estimated" | "model_only",
  minTxCount: number,
): CellRow[] {
  const actualByKey = new Map<string, CellRow>();
  for (const r of enrichedRows) actualByKey.set(`${r.gx}_${r.gy}`, r);

  const output: CellRow[] = [];

  if (modelledMode === "estimated") {
    // Replace all actuals with modelled estimates where available; fall back to actual if not
    for (const r of enrichedRows) {
      const key = `${r.gx}_${r.gy}`;
      const m = modelledLookup.get(key);
      if (m) {
        output.push({ ...r, median: m.estimated_median, is_modelled: true, model_confidence: m.model_confidence, n_years_model: m.n_years, ratio_cv_model: m.ratio_cv, estimated_median: m.estimated_median });
      } else {
        output.push(r);
      }
    }
    // Inject cells that have no actual data at all
    for (const [key, m] of modelledLookup) {
      if (!actualByKey.has(key) && m.model_confidence >= 1) {
        const [gx, gy] = key.split("_").map(Number);
        output.push({ gx, gy, end_month: "", property_type: "ALL", new_build: "ALL", tx_count: 0, median: m.estimated_median, is_modelled: true, model_confidence: m.model_confidence, n_years_model: m.n_years, ratio_cv_model: m.ratio_cv, estimated_median: m.estimated_median });
      }
    }
  } else if (modelledMode === "model_only") {
    // Show ONLY cells that have a model estimate but NO actual data in the partition
    for (const [key, m] of modelledLookup) {
      if (!actualByKey.has(key) && m.model_confidence >= 0) {
        const [gx, gy] = key.split("_").map(Number);
        output.push({ gx, gy, end_month: "", property_type: "ALL", new_build: "ALL", tx_count: 0, median: m.estimated_median, is_modelled: true, model_confidence: m.model_confidence, n_years_model: m.n_years, ratio_cv_model: m.ratio_cv, estimated_median: m.estimated_median });
      }
    }
  } else {
    // blend: keep actual rows passing minTxCount; inject model for sparse/missing cells
    for (const r of enrichedRows) {
      if (Number(r.tx_count ?? 0) >= minTxCount) {
        // Actual cell — attach estimate for popup comparison if model has one
        const key = `${r.gx}_${r.gy}`;
        const m = modelledLookup.get(key);
        if (m) {
          output.push({ ...r, estimated_median: m.estimated_median, model_confidence: m.model_confidence, n_years_model: m.n_years, ratio_cv_model: m.ratio_cv });
        } else {
          output.push(r);
        }
      } else {
        // Sparse actual — replace with model if confidence >= 1
        const key = `${r.gx}_${r.gy}`;
        const m = modelledLookup.get(key);
        if (m && m.model_confidence >= 1) {
          const actualMedian = Number(r.tx_count ?? 0) > 0 ? r.median : undefined;
          output.push({ ...r, median: m.estimated_median, is_modelled: true, model_confidence: m.model_confidence, n_years_model: m.n_years, ratio_cv_model: m.ratio_cv, estimated_median: m.estimated_median, actual_median: actualMedian });
        }
        // else drop (not enough data for actual or model)
      }
    }
    // Inject cells with no actual data at all
    for (const [key, m] of modelledLookup) {
      if (!actualByKey.has(key) && m.model_confidence >= 0) {
        const [gx, gy] = key.split("_").map(Number);
        output.push({ gx, gy, end_month: "", property_type: "ALL", new_build: "ALL", tx_count: 0, median: m.estimated_median, is_modelled: true, model_confidence: m.model_confidence, n_years_model: m.n_years, ratio_cv_model: m.ratio_cv, estimated_median: m.estimated_median });
      }
    }
  }

  return output;
}

/** Fetch vote/commute/age/country lookups in parallel, then enrich rows in a single pass. */
async function backfillAll(env: Env, grid: GridKey, rows: CellRow[]): Promise<CellRow[]> {
  // vote_cells_1km.json.gz is ~2 MB compressed / ~20 MB uncompressed — loading it
  // alongside a large 1km partition on a cold isolate reliably hits the Worker CPU
  // time limit, so we skip vote overlay for 1km.
  // Country is always sourced from the dedicated slim country_cells_{grid}.json.gz
  // file (44 KB for 1km, <5 KB for other grids) rather than from the vote file,
  // so it remains available for flood/school scoring regardless of vote load status.
  const votePromise = grid === "1km"
    ? Promise.resolve(null)
    : getCachedVoteLookup(env, grid).catch(() => null);

  // broadband_cells_1km.json.gz is 632 KB compressed — loading it alongside all
  // other 1km backfills risks hitting the Worker CPU limit (same issue as vote at 1km).
  // Broadband infrastructure doesn't vary meaningfully at sub-5km resolution, so we
  // always use the 5km lookup (51 KB) and snap 1km cell coordinates up to 5km.
  const broadbandGrid: GridKey = grid === "1km" ? "5km" : grid;
  const broadbandPromise = getCachedBroadbandLookup(env, broadbandGrid).catch(() => null);

  const [voteLookup, countryLookup, commuteLookup, ageLookup, crimeLookup, epcFuelLookup, broadbandLookup] = await Promise.all([
    votePromise,
    getCachedCountryLookup(env, grid).catch(() => null),
    getCachedCommuteLookup(env, grid).catch(() => null),
    getCachedAgeLookup(env, grid).catch(() => null),
    getCachedCrimeLookup(env, grid).catch(() => null),
    getCachedEpcFuelLookup(env, grid).catch(() => null),
    broadbandPromise,
  ]);

  return rows.map((row) => {
    let out: any = row;
    const key = `${row.gx}_${row.gy}`;

    // Stamp country from the slim lookup first (works for all grids including 1km)
    const country = countryLookup?.get(key);
    if (country) out = { ...out, country };

    // Vote overlay fields (excludes 1km to avoid CPU timeout; country already set above)
    const vote = voteLookup?.get(key);
    if (vote) out = { ...out,
      pct_progressive: vote.pct_progressive,
      pct_conservative: vote.pct_conservative,
      pct_popular_right: vote.pct_popular_right,
      constituency: vote.constituency,
    };

    const commute = commuteLookup?.get(key);
    if (commute) out = { ...out,
      mean_dist_km: commute.mean_dist_km,
      pct_wfh: commute.pct_wfh,
      pct_lt5: commute.pct_lt5,
      pct_5_10: commute.pct_5_10,
      pct_10_20: commute.pct_10_20,
      pct_20_60: commute.pct_20_60,
      pct_60p: commute.pct_60p,
    };

    const age = ageLookup?.get(key);
    if (age) out = { ...out,
      mean_age:     age.mean_age,
      age_score:    age.age_score,
      pct_under_15: age.pct_under_15,
      pct_15_24:    age.pct_15_24,
      pct_25_44:    age.pct_25_44,
      pct_45_64:    age.pct_45_64,
      pct_65_plus:  age.pct_65_plus,
    };

    const crime = crimeLookup?.get(key);
    if (crime) out = { ...out,
      violent_rate:         crime.violent_rate,
      property_rate:        crime.property_rate,
      asb_rate:             crime.asb_rate,
      total_rate:           crime.total_rate,
      violent_count:        crime.violent_count,
      property_count:       crime.property_count,
      asb_count:            crime.asb_count,
      total_count:          crime.total_count,
      crime_score:          crime.crime_score,
      violent_score:        crime.violent_score,
      property_score:       crime.property_score,
      asb_score:            crime.asb_score,
      crime_local_score:    crime.crime_local_score,
      violent_local_score:  crime.violent_local_score,
      property_local_score: crime.property_local_score,
      asb_local_score:      crime.asb_local_score,
    };

    const epcFuel = epcFuelLookup?.get(key);
    if (epcFuel) out = { ...out,
      epc_n:          epcFuel.n,
      pct_gas:        epcFuel.pct_gas,
      pct_electric:   epcFuel.pct_electric,
      pct_oil:        epcFuel.pct_oil,
      pct_lpg:        epcFuel.pct_lpg,
      fuel_pct_other: epcFuel.fuel_pct_other,
    };

    const broadband = broadbandLookup?.get(
      grid === "1km"
        ? `${Math.floor(row.gx / 5000) * 5000}_${Math.floor(row.gy / 5000) * 5000}`
        : key
    );
    if (broadband !== undefined) out = { ...out, bb_avg_speed: broadband };

    return out;
  });
}

/* ---------- legacy fallback (monolithic files) ---------- */

type LegacyCacheEntry = {
  rows: CellRow[];
  latestEndMonth: string;
  loadedAtMs: number;
};

const LEGACY_CACHE: Partial<Record<string, LegacyCacheEntry>> = {};

function legacyR2Key(grid: GridKey, metric: CellsMetric) {
  if (metric === "median_ppsf") {
    return `grid_${grid}_ppsf_full.json.gz`;
  }
  return `grid_${grid}_full.json.gz`;
}

async function legacyHandler(
  env: Env,
  grid: GridKey,
  metric: CellsMetric,
  propertyTypeCanonical: string,
  propertyTypesArr: string[],
  newBuild: string,
  endMonth: string,
  minTxCount: number,
): Promise<Response> {
  const cacheKey = `legacy|${grid}|${metric}`;
  const now = Date.now();
  let entry = LEGACY_CACHE[cacheKey];

  if (!entry || now - entry.loadedAtMs > CACHE_TTL_MS) {
    const key = legacyR2Key(grid, metric);
    const bucket = getBucket(env);
    const obj = await bucket.get(key);
    if (!obj) {
      return Response.json({ error: `Data not found: ${key}` }, { status: 404 });
    }
    const gz = await obj.arrayBuffer();
    const jsonText = await gunzipToString(gz);
    const rows = JSON.parse(jsonText) as CellRow[];

    let latest = "0000-00-00";
    for (const r of rows) {
      if (r.end_month > latest) latest = r.end_month;
    }

    entry = { rows, latestEndMonth: latest, loadedAtMs: Date.now() };
    LEGACY_CACHE[cacheKey] = entry;
  }

  const resolvedMonth = endMonth === "LATEST" ? entry.latestEndMonth : endMonth;

  // Match by individual type atoms:
  // - "ALL" in propertyTypesArr means the user wants the pre-aggregated "ALL" rows
  //   (not a wildcard — the legacy file contains explicit rows with property_type="ALL")
  // - Any other atoms D/S/T/F mean user wants those specific type rows
  const typeSet = propertyTypesArr.filter((t) => t !== "ALL");
  const wantsAllAggregate = propertyTypesArr.includes("ALL") && typeSet.length === 0;
  const preFiltered = entry.rows.filter(
    (r) =>
      r.end_month === resolvedMonth &&
      (wantsAllAggregate ? r.property_type === "ALL" : typeSet.includes(r.property_type)) &&
      r.new_build === newBuild
  );

  // For multi-type: merge cells first, then apply minTxCount to merged totals
  let rawRows: CellRow[];
  if (typeSet.length > 1) {
    const merged = mergePartitionRows([preFiltered]);
    rawRows = merged.filter((r) => Number(r.tx_count ?? 0) >= minTxCount);
  } else {
    rawRows = preFiltered.filter((r) => Number(r.tx_count ?? 0) >= minTxCount);
  }

  const rows = rawRows.map((r) => ({
    ...r,
    median:
      metric === "median_ppsf"
        ? Number((r as any).median_ppsf ?? r.median ?? NaN)
        : Number(r.median ?? NaN),
  }));

  const enriched = await backfillAll(env, grid, rows);

  return jsonResponse({
    grid,
    metric,
    end_month: resolvedMonth,
    propertyType: propertyTypeCanonical,
    newBuild,
    minTxCount,
    count: enriched.length,
    rows: enriched,
  });
}

/* ---------- R2 bucket resolution ---------- */

function getBucket(env: Env): R2Bucket {
  const bucket = env.BRICKGRID_BUCKET ?? env.R2;
  if (!bucket) throw new Error("R2 binding not found. Expected `BRICKGRID_BUCKET` or `R2`.");
  return bucket;
}


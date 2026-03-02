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
      const rows = applyFilters(cachedMerged.rows, minTxCount, metric);
      const withVotes = await backfillVotes(env, grid, rows);
      const withCommute = await backfillCommute(env, grid, withVotes);
      const withAge = await backfillAge(env, grid, withCommute);
      return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, count: withAge.length, rows: withAge });
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
    const rows = applyFilters(rawMerged, minTxCount, metric);
    const withVotes = await backfillVotes(env, grid, rows);
    const withCommute = await backfillCommute(env, grid, withVotes);
    const withAge = await backfillAge(env, grid, withCommute);
    return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, count: withAge.length, rows: withAge });
  }

  // Single type (or ALL): standard single-partition fetch
  const partitionKey = `cells/${grid}/${metric}/${endMonth}/${canonicalPropertyType}_${newBuild}.json.gz`;

  // Check in-memory cache
  const now = Date.now();
  const cached = PARTITION_CACHE.get(partitionKey);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) {
    const rows = applyFilters(cached.rows, minTxCount, metric);
    const withVotes = await backfillVotes(env, grid, rows);
    const withCommute = await backfillCommute(env, grid, withVotes);
    const withAge = await backfillAge(env, grid, withCommute);
    return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, count: withAge.length, rows: withAge });
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

  const rows = applyFilters(rawRows, minTxCount, metric);
  const withVotes = await backfillVotes(env, grid, rows);
  const withCommute = await backfillCommute(env, grid, withVotes);
  const withAge = await backfillAge(env, grid, withCommute);
  return jsonResponse({ grid, metric, end_month: endMonth, propertyType: canonicalPropertyType, newBuild, minTxCount, count: withAge.length, rows: withAge });
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
  if (!obj) return null;

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
  if (!obj) return null;

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

  const withVotes = await backfillVotes(env, grid, rows);
  const withCommute = await backfillCommute(env, grid, withVotes);
  const withAge = await backfillAge(env, grid, withCommute);

  return jsonResponse({
    grid,
    metric,
    end_month: resolvedMonth,
    propertyType: propertyTypeCanonical,
    newBuild,
    minTxCount,
    count: withAge.length,
    rows: withAge,
  });
}

/* ---------- R2 bucket resolution ---------- */

function getBucket(env: Env): R2Bucket {
  const bucket = env.BRICKGRID_BUCKET ?? env.R2;
  if (!bucket) throw new Error("R2 binding not found. Expected `BRICKGRID_BUCKET` or `R2`.");
  return bucket;
}


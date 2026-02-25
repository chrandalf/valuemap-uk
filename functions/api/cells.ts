import type { R2Bucket } from "@cloudflare/workers-types";

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

  if (!isPropertyType(propertyType)) {
    return Response.json("Invalid propertyType. Use ALL|D|S|T|F", { status: 400 });
  }

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
      return await legacyHandler(env, grid, metric, propertyType, newBuild, endMonthParam, minTxCount);
    }
    const months = [...new Set(manifest.partitions.map((p: any) => p.end_month as string))].sort();
    endMonth = months[months.length - 1] as string;
  } else {
    endMonth = endMonthParam;
  }

  // ---- fetch the exact partition ----
  const partitionKey = `cells/${grid}/${metric}/${endMonth}/${propertyType}_${newBuild}.json.gz`;

  // Check in-memory cache
  const now = Date.now();
  const cached = PARTITION_CACHE.get(partitionKey);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) {
    const rows = applyFilters(cached.rows, minTxCount, metric);
    const withVotes = await backfillVotes(env, grid, rows);
    return jsonResponse({ grid, metric, end_month: endMonth, propertyType, newBuild, minTxCount, count: withVotes.length, rows: withVotes });
  }

  // Fetch from R2
  const bucket = getBucket(env);
  const obj = await bucket.get(partitionKey);

  if (!obj) {
    // Partition not found — try legacy monolithic file as fallback
    return await legacyHandler(env, grid, metric, propertyType, newBuild, endMonth, minTxCount);
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rawRows = JSON.parse(jsonText) as CellRow[];

  // Cache it
  PARTITION_CACHE.set(partitionKey, { rows: rawRows, loadedAtMs: Date.now() });

  const rows = applyFilters(rawRows, minTxCount, metric);
  const withVotes = await backfillVotes(env, grid, rows);
  return jsonResponse({ grid, metric, end_month: endMonth, propertyType, newBuild, minTxCount, count: withVotes.length, rows: withVotes });
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
};

type VoteCellRow = {
  gx: number;
  gy: number;
  pct_progressive: number;
  pct_conservative: number;
  pct_popular_right: number;
  constituency?: string;
};

type VoteCellValue = Omit<VoteCellRow, "gx" | "gy">;

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
  propertyType: string,
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

  const filtered = entry.rows.filter(
    (r) =>
      r.end_month === resolvedMonth &&
      r.property_type === propertyType &&
      r.new_build === newBuild &&
      Number(r.tx_count ?? 0) >= minTxCount
  );

  const rows = filtered.map((r) => ({
    ...r,
    median:
      metric === "median_ppsf"
        ? Number((r as any).median_ppsf ?? r.median ?? NaN)
        : Number(r.median ?? NaN),
  }));

  const withVotes = await backfillVotes(env, grid, rows);

  return jsonResponse({
    grid,
    metric,
    end_month: resolvedMonth,
    propertyType,
    newBuild,
    minTxCount,
    count: withVotes.length,
    rows: withVotes,
  });
}

/* ---------- R2 bucket resolution ---------- */

function getBucket(env: Env): R2Bucket {
  const bucket = env.BRICKGRID_BUCKET ?? env.R2;
  if (!bucket) throw new Error("R2 binding not found. Expected `BRICKGRID_BUCKET` or `R2`.");
  return bucket;
}

/* ---------- gzip helper ---------- */

async function gunzipToString(gz: ArrayBuffer): Promise<string> {
  // @ts-ignore – available in Workers runtime
  const ds = new DecompressionStream("gzip");
  const stream = new Response(gz).body!.pipeThrough(ds);
  return await new Response(stream).text();
}

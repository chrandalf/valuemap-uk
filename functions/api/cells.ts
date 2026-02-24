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
  const refreshCache = ["1", "true", "yes"].includes((url.searchParams.get("refresh") ?? "").toLowerCase());

  if (!isGridKey(grid)) {
    return Response.json("Invalid grid. Use 1km|5km|10km|25km", { status: 400 });
  }

  if (!isCellsMetric(metric)) {
    return Response.json("Invalid metric. Use median|median_ppsf", { status: 400 });
  }

  // ---- load + cache data (PER GRID) ----
  const data = await getCachedGrid(env, grid, metric, refreshCache);

  const endMonth = endMonthParam === "LATEST" ? data.latestEndMonth : endMonthParam;

  // ---- filter rows ----
  const filtered = data.rows.filter(
    (r) =>
      r.end_month === endMonth &&
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

  return Response.json(
    {
      grid,
      metric,
      end_month: endMonth,
      propertyType,
      newBuild,
      minTxCount,
      count: rows.length,
      rows,
    },
    {
      headers: {
        // cache at edge a bit; tune later
        "Cache-Control": "public, max-age=1200",
      },
    }
  );
};

/* ---------- types ---------- */

type GridKey = "1km" | "5km" | "10km" | "25km";
type CellsMetric = "median" | "median_ppsf";

function isGridKey(v: string): v is GridKey {
  return v === "1km" || v === "5km" || v === "10km" || v === "25km";
}

function isCellsMetric(v: string): v is CellsMetric {
  return v === "median" || v === "median_ppsf";
}

type CellRow = {
  gx: number;
  gy: number;
  end_month: string;
  property_type: string;
  new_build: string;
  median: number;
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
  R2: R2Bucket;
}

/* ---------- cache (PER GRID) ---------- */

type CacheEntry = {
  rows: CellRow[];
  latestEndMonth: string;
  loadedAtMs: number;
};

const CACHE_BY_GRID_AND_METRIC: Partial<Record<`${GridKey}|${CellsMetric}`, CacheEntry>> = {};
const VOTE_CACHE_BY_GRID: Partial<Record<GridKey, Map<string, VoteCellValue>>> = {};

function r2KeyForGrid(grid: GridKey, metric: CellsMetric) {
  // Must match your bucket object names
  if (metric === "median_ppsf") {
    switch (grid) {
      case "1km": return "grid_1km_ppsf_full.json.gz";
      case "5km": return "grid_5km_ppsf_full.json.gz";
      case "10km": return "grid_10km_ppsf_full.json.gz";
      case "25km": return "grid_25km_ppsf_full.json.gz";
    }
  }

  switch (grid) {
    case "1km": return "grid_1km_full.json.gz";
    case "5km": return "grid_5km_full.json.gz";
    case "10km": return "grid_10km_full.json.gz";
    case "25km": return "grid_25km_full.json.gz";
  }
}

const GRID_CACHE_TTL_MS = 10 * 60 * 1000;

async function getCachedGrid(env: Env, grid: GridKey, metric: CellsMetric, forceRefresh: boolean): Promise<CacheEntry> {
  const cacheKey = `${grid}|${metric}` as const;
  const cached = CACHE_BY_GRID_AND_METRIC[cacheKey];
  const now = Date.now();
  if (cached && !forceRefresh && now - cached.loadedAtMs <= GRID_CACHE_TTL_MS) {
    await backfillVoteDataIfMissing(env, grid, cached.rows);
    return cached;
  }

  const key = r2KeyForGrid(grid, metric);

  const obj = await env.R2.get(key);
  if (!obj) {
    throw new Error(`R2 object not found: ${key}`);
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as CellRow[];

  await backfillVoteDataIfMissing(env, grid, rows);

  let latest = "0000-00-00";
  for (const r of rows) {
    if (r.end_month > latest) latest = r.end_month;
  }

  const entry = { rows, latestEndMonth: latest, loadedAtMs: Date.now() };
  CACHE_BY_GRID_AND_METRIC[cacheKey] = entry;
  return entry;
}

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

  const key = voteKeyForGrid(grid);
  const obj = await getBucket(env).get(key);
  if (!obj) {
    return null;
  }

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

async function backfillVoteDataIfMissing(env: Env, grid: GridKey, rows: CellRow[]) {
  const sample = rows.find((row) => row.pct_progressive !== undefined || row.pct_conservative !== undefined || row.pct_popular_right !== undefined);
  if (sample) return;

  const voteLookup = await getCachedVoteLookup(env, grid);
  if (!voteLookup) return;

  for (const row of rows) {
    const vote = voteLookup.get(`${row.gx}_${row.gy}`);
    if (!vote) continue;
    row.pct_progressive = vote.pct_progressive;
    row.pct_conservative = vote.pct_conservative;
    row.pct_popular_right = vote.pct_popular_right;
    if (vote.constituency) {
      row.constituency = vote.constituency;
    }
  }
}

function getBucket(env: Env): R2Bucket {
  return ((env && ((env as any).R2 || (env as any).BRICKGRID_BUCKET)) as unknown) as R2Bucket;
}

/* ---------- gzip helper (Workers runtime supports this) ---------- */

async function gunzipToString(gz: ArrayBuffer): Promise<string> {
  // @ts-ignore – available in Workers runtime
  const ds = new DecompressionStream("gzip");
  const stream = new Response(gz).body!.pipeThrough(ds);
  return await new Response(stream).text();
}

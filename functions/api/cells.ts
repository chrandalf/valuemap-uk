import type { R2Bucket } from "@cloudflare/workers-types";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const url = new URL(request.url);

  // ---- query params (match your UI state) ----
  const grid = (url.searchParams.get("grid") ?? "25km") as GridKey;
  const propertyType = (url.searchParams.get("propertyType") ?? "ALL").toUpperCase();
  const newBuild = (url.searchParams.get("newBuild") ?? "ALL").toUpperCase();
  const endMonthParam = (url.searchParams.get("endMonth") ?? "LATEST").toUpperCase();

  if (!isGridKey(grid)) {
    return Response.json("Invalid grid. Use 1km|5km|10km|25km", { status: 400 });
  }

  // ---- load + cache data (PER GRID) ----
  const data = await getCachedGrid(env, grid);

  const endMonth = endMonthParam === "LATEST" ? data.latestEndMonth : endMonthParam;

  // ---- filter rows ----
  const rows = data.rows.filter(
    (r) =>
      r.end_month === endMonth &&
      r.property_type === propertyType &&
      r.new_build === newBuild
  );

  return Response.json(
    {
      grid,
      end_month: endMonth,
      propertyType,
      newBuild,
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

function isGridKey(v: string): v is GridKey {
  return v === "1km" || v === "5km" || v === "10km" || v === "25km";
}

type CellRow = {
  gx: number;
  gy: number;
  end_month: string;
  property_type: string;
  new_build: string;
  median: number;
  tx_count: number;
  delta_gbp?: number;
  delta_pct?: number;
  years_stale?: number;
};

interface Env {
  R2: R2Bucket;
}

/* ---------- cache (PER GRID) ---------- */

type CacheEntry = {
  rows: CellRow[];
  latestEndMonth: string;
};

const CACHE_BY_GRID: Partial<Record<GridKey, CacheEntry>> = {};

function r2KeyForGrid(grid: GridKey) {
  // Must match your bucket object names
  switch (grid) {
    case "1km": return "grid_1km_full.json.gz";
    case "5km": return "grid_5km_full.json.gz";
    case "10km": return "grid_10km_full.json.gz";
    case "25km": return "grid_25km_full.json.gz";
  }
}

async function getCachedGrid(env: Env, grid: GridKey): Promise<CacheEntry> {
  const cached = CACHE_BY_GRID[grid];
  if (cached) return cached;

  const key = r2KeyForGrid(grid);

  const obj = await env.R2.get(key);
  if (!obj) {
    throw new Error(`R2 object not found: ${key}`);
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as CellRow[];

  let latest = "0000-00-00";
  for (const r of rows) {
    if (r.end_month > latest) latest = r.end_month;
  }

  const entry = { rows, latestEndMonth: latest };
  CACHE_BY_GRID[grid] = entry;
  return entry;
}

/* ---------- gzip helper (Workers runtime supports this) ---------- */

async function gunzipToString(gz: ArrayBuffer): Promise<string> {
  // @ts-ignore – available in Workers runtime
  const ds = new DecompressionStream("gzip");
  const stream = new Response(gz).body!.pipeThrough(ds);
  return await new Response(stream).text();
}

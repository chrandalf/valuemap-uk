import type { R2Bucket } from "@cloudflare/workers-types";
import { gunzipToString } from "../_lib/gzip";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const url = new URL(request.url);

  // ---- query params ----
  const grid = (url.searchParams.get("grid") ?? "25km") as GridKey;
  const propertyType = (url.searchParams.get("propertyType") ?? "ALL").toUpperCase();
  const newBuild = (url.searchParams.get("newBuild") ?? "ALL").toUpperCase();

  if (!isGridKey(grid)) {
    return Response.json("Invalid grid. Use 5km|10km|25km (1km excluded)", { status: 400 });
  }

  // ---- load + cache delta data (PER GRID) ----
  let data: DeltaData;
  try {
    data = await getCachedDeltas(env, grid);
  } catch (err: any) {
    const msg = err?.message || String(err);
    return new Response(JSON.stringify({ error: "Failed loading delta files", message: msg }), { status: 500 });
  }

  let voteLookup: Map<string, VoteCellValue> | null = null;
  try {
    voteLookup = await getCachedVoteLookup(env, grid);
  } catch {
    voteLookup = null;
  }

  // ---- filter rows by segment ----
  const rows = data.rows
    .filter((r) => r.property_type === propertyType && r.new_build === newBuild)
    .map((r) => {
      if (!voteLookup) return r;
      const coords = getGridCoords(r, grid);
      if (!coords) return r;
      const vote = voteLookup.get(`${coords.gx}_${coords.gy}`);
      if (!vote) return r;
      return {
        ...r,
        pct_progressive: vote.pct_progressive,
        pct_conservative: vote.pct_conservative,
        pct_popular_right: vote.pct_popular_right,
        constituency: vote.constituency,
      };
    });

  return Response.json(
    {
      grid,
      propertyType,
      newBuild,
      count: rows.length,
      timeRange: {
        earliest: data.rows.length > 0 ? data.rows[0].end_month_earliest : null,
        latest: data.rows.length > 0 ? data.rows[0].end_month_latest : null,
      },
      rows,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=21600", // longer cache since deltas are static
      },
    }
  );
};

/* ---------- types ---------- */

type GridKey = "5km" | "10km" | "25km";

function isGridKey(v: string): v is GridKey {
  return v === "5km" || v === "10km" || v === "25km";
}

type DeltaRow = {
  gx_5000?: number;
  gy_5000?: number;
  gx_10000?: number;
  gy_10000?: number;
  gx_25000?: number;
  gy_25000?: number;
  cell_5000?: string;
  cell_10000?: string;
  cell_25000?: string;
  property_type: string;
  new_build: string;
  price_earliest: number;
  sales_earliest: number;
  price_latest: number;
  sales_latest: number;
  delta_gbp: number;
  delta_pct: number;
  end_month_earliest: string;
  end_month_latest: string;
  years_delta: number;
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

type DeltaData = {
  rows: DeltaRow[];
};

/* ---------- loading + caching ---------- */

const deltaCache = new Map<GridKey, DeltaData>();
const voteCache = new Map<GridKey, Map<string, VoteCellValue> | null>();

async function getCachedDeltas(env: Env, grid: GridKey): Promise<DeltaData> {
  if (deltaCache.has(grid)) {
    return deltaCache.get(grid)!;
  }

  const data = await loadDeltasFromR2(env, grid);
  deltaCache.set(grid, data);
  return data;
}

async function getCachedVoteLookup(env: Env, grid: GridKey): Promise<Map<string, VoteCellValue> | null> {
  if (voteCache.has(grid)) {
    return voteCache.get(grid) ?? null;
  }

  const bucket = getBucket(env);
  const key = voteKeyForGrid(grid);
  const obj = await bucket.get(key);
  if (!obj) {
    return null;
  }

  const text = await gunzipToString(await obj.arrayBuffer());
  const rows = JSON.parse(text) as VoteCellRow[];

  const lookup = new Map<string, VoteCellValue>();
  for (const row of rows) {
    lookup.set(`${row.gx}_${row.gy}`, {
      pct_progressive: Number(row.pct_progressive ?? 0),
      pct_conservative: Number(row.pct_conservative ?? 0),
      pct_popular_right: Number(row.pct_popular_right ?? 0),
      constituency: row.constituency,
    });
  }

  voteCache.set(grid, lookup);
  return lookup;
}

function getGridCoords(row: DeltaRow, grid: GridKey): { gx: number; gy: number } | null {
  if (grid === "5km") {
    return Number.isFinite(Number(row.gx_5000)) && Number.isFinite(Number(row.gy_5000))
      ? { gx: Number(row.gx_5000), gy: Number(row.gy_5000) }
      : null;
  }
  if (grid === "10km") {
    return Number.isFinite(Number(row.gx_10000)) && Number.isFinite(Number(row.gy_10000))
      ? { gx: Number(row.gx_10000), gy: Number(row.gy_10000) }
      : null;
  }
  return Number.isFinite(Number(row.gx_25000)) && Number.isFinite(Number(row.gy_25000))
    ? { gx: Number(row.gx_25000), gy: Number(row.gy_25000) }
    : null;
}

function voteKeyForGrid(grid: GridKey) {
  switch (grid) {
    case "5km": return "vote_cells_5km.json.gz";
    case "10km": return "vote_cells_10km.json.gz";
    case "25km": return "vote_cells_25km.json.gz";
  }
}

function getBucket(env: Env): R2Bucket {
  const bucket = ((env && ((env as any).BRICKGRID_BUCKET || (env as any).R2)) as unknown) as R2Bucket | undefined;
  if (!bucket) {
    throw new Error("R2 binding not found. Expected environment binding `BRICKGRID_BUCKET` or `R2`.");
  }
  return bucket;
}

async function loadDeltasFromR2(env: Env, grid: GridKey): Promise<DeltaData> {
  const bucket = getBucket(env);

  const gridLabel = grid === "5km" ? "5km" : grid === "10km" ? "10km" : "25km";
  const objectKey = `deltas_overall_${gridLabel}.json.gz`;

  const obj = await bucket.get(objectKey);
  if (!obj) {
    console.warn(`Delta file not found: ${objectKey}`);
    return { rows: [] };
  }

  // Decompress gzip
  const text = await gunzipToString(await obj.arrayBuffer());
  const rows = JSON.parse(text) as DeltaRow[];

  return { rows };
}

/* ---------- environment types ---------- */

interface Env {
  BRICKGRID_BUCKET: R2Bucket;
}

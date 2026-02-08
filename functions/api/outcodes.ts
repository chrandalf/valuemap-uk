import type { R2Bucket } from "@cloudflare/workers-types";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const url = new URL(request.url);

    const grid = (url.searchParams.get("grid") ?? "25km") as GridKey;
    const propertyType = (url.searchParams.get("propertyType") ?? "ALL").toUpperCase();
    const newBuild = (url.searchParams.get("newBuild") ?? "ALL").toUpperCase();
    const endMonthParam = (url.searchParams.get("endMonth") ?? "LATEST").toUpperCase();

    if (!isGridKey(grid)) {
      return Response.json("Invalid grid. Use 1km|5km|10km|25km", { status: 400 });
    }

    const data = await getCachedGrid(env, grid);
    const endMonth = endMonthParam === "LATEST" ? data.latestEndMonth : endMonthParam;

    const rows = data.rows.filter(
      (r) =>
        r.end_month === endMonth &&
        r.property_type === propertyType &&
        r.new_build === newBuild
    );

    const cellMedians = new Map<string, { median: number; tx: number }>();
    for (const r of rows) {
      if (!Number.isFinite(r.median)) continue;
      const tx = Number.isFinite(r.tx_count) ? r.tx_count : 0;
      if (tx <= 0) continue;
      const key = `${Math.round(r.gx)}_${Math.round(r.gy)}`;
      cellMedians.set(key, { median: r.median, tx });
    }

    const indexKeyParam = url.searchParams.get("indexKey") ?? env.POSTCODE_LOOKUP_INDEX_KEY;
    const defaultIndexKey = `postcode_outcode_index_${grid}.json.gz`;
    const rawIndexKey = (indexKeyParam ?? defaultIndexKey).trim();
    const indexKeyMatch = rawIndexKey.match(/[a-zA-Z0-9/_.-]+\.json(?:\.gz)?/);
    const indexKey = indexKeyMatch ? indexKeyMatch[0] : defaultIndexKey;

    const outcodeIndex = await loadOutcodeIndex(env, indexKey);

    const outcodeAgg = new Map<string, { sum: number; weight: number }>();
    for (const [cell, outcodes] of Object.entries(outcodeIndex)) {
      const cellData = cellMedians.get(cell);
      if (!cellData) continue;
      const weight = cellData.tx > 0 ? cellData.tx : 1;
      for (const outcode of outcodes) {
        const prev = outcodeAgg.get(outcode) ?? { sum: 0, weight: 0 };
        prev.sum += cellData.median * weight;
        prev.weight += weight;
        outcodeAgg.set(outcode, prev);
      }
    }

    const items: OutcodeRank[] = [];
    for (const [outcode, agg] of outcodeAgg) {
      if (agg.weight <= 0) continue;
      const value = agg.sum / agg.weight;
      if (!Number.isFinite(value)) continue;
      items.push({ outcode, median: value, weight: agg.weight });
    }

    items.sort((a, b) => a.median - b.median);
    const bottom = items.slice(0, 10);
    const top = items.slice(-10).reverse();

    return Response.json(
      {
        grid,
        end_month: endMonth,
        propertyType,
        newBuild,
        count: items.length,
        top,
        bottom,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
        },
      }
    );
  } catch (err: any) {
    const message = err?.message || String(err);
    return new Response(JSON.stringify({ error: "Outcode ranking failed", message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
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
};

type CacheEntry = {
  rows: CellRow[];
  latestEndMonth: string;
};

type OutcodeRank = {
  outcode: string;
  median: number;
  weight: number;
};

interface Env {
  R2: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
  POSTCODE_LOOKUP_INDEX_KEY?: string;
}

/* ---------- cache (PER GRID) ---------- */

const CACHE_BY_GRID: Partial<Record<GridKey, CacheEntry>> = {};

function r2KeyForGrid(grid: GridKey) {
  switch (grid) {
    case "1km":
      return "grid_1km_full.json.gz";
    case "5km":
      return "grid_5km_full.json.gz";
    case "10km":
      return "grid_10km_full.json.gz";
    case "25km":
      return "grid_25km_full.json.gz";
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

async function loadOutcodeIndex(env: Env, indexKey: string): Promise<Record<string, string[]>> {
  const bucket = ((env && ((env as any).BRICKGRID_BUCKET || (env as any).R2)) as unknown) as R2Bucket | undefined;
  if (!bucket) {
    throw new Error("R2 binding not found. Expected environment binding `BRICKGRID_BUCKET` or `R2`.");
  }

  const triedKeys: string[] = [];
  const candidates = Array.from(new Set([
    indexKey,
    indexKey.replace(/^\/+/, ""),
    indexKey.replace(/^.*\//, ""),
    `valuemap-uk/${indexKey}`,
    `valuemap-uk/${indexKey.replace(/^.*\//, "")}`,
    `v1/${indexKey}`,
    `v1/${indexKey.replace(/^.*\//, "")}`,
  ]));

  for (const k of candidates) {
    triedKeys.push(k);
    // eslint-disable-next-line no-await-in-loop
    const attempt = await bucket.get(k as any as string);
    if (attempt) {
      const decompressed = await decompressGzip(await attempt.arrayBuffer());
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text) as Record<string, string[]>;
    }
  }

  throw new Error(`Index not found: tried keys: ${triedKeys.join(", ")}`);
}

async function gunzipToString(gz: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(gz).body!.pipeThrough(ds);
  return await new Response(stream).text();
}

async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });

  const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

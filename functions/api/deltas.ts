import type { R2Bucket } from "@cloudflare/workers-types";

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

  // ---- filter rows by segment ----
  const rows = data.rows.filter(
    (r) => r.property_type === propertyType && r.new_build === newBuild
  );

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
        "Cache-Control": "public, max-age=3600", // longer cache since deltas are static
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
};

type DeltaData = {
  rows: DeltaRow[];
};

/* ---------- loading + caching ---------- */

const deltaCache = new Map<GridKey, DeltaData>();

async function getCachedDeltas(env: Env, grid: GridKey): Promise<DeltaData> {
  if (deltaCache.has(grid)) {
    return deltaCache.get(grid)!;
  }

  const data = await loadDeltasFromR2(env, grid);
  deltaCache.set(grid, data);
  return data;
}

async function loadDeltasFromR2(env: Env, grid: GridKey): Promise<DeltaData> {
  // Support either `BRICKGRID_BUCKET` or `R2` binding name (some projects use simply `R2`)
  const bucket = ((env && ((env as any).BRICKGRID_BUCKET || (env as any).R2)) as unknown) as R2Bucket | undefined;
  if (!bucket) {
    throw new Error("R2 binding not found. Expected environment binding `BRICKGRID_BUCKET` or `R2`.");
  }

  const gridLabel = grid === "5km" ? "5km" : grid === "10km" ? "10km" : "25km";
  const objectKey = `deltas_overall_${gridLabel}.json.gz`;

  const obj = await bucket.get(objectKey);
  if (!obj) {
    console.warn(`Delta file not found: ${objectKey}`);
    return { rows: [] };
  }

  // Decompress gzip
  const decompressed = await decompressGzip(await obj.arrayBuffer());
  const text = new TextDecoder().decode(decompressed);
  const rows = JSON.parse(text) as DeltaRow[];

  return { rows };
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

/* ---------- environment types ---------- */

interface Env {
  BRICKGRID_BUCKET: R2Bucket;
}

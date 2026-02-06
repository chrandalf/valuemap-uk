import type { R2Bucket } from "@cloudflare/workers-types";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const url = new URL(request.url);

  const grid = (url.searchParams.get("grid") ?? "25km") as GridKey;
  const cell = (url.searchParams.get("cell") ?? "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 1_000_000);

  if (!isGridKey(grid)) {
    return Response.json("Invalid grid. Use 1km|5km|10km|25km", { status: 400 });
  }
  if (!cell) {
    return Response.json("Missing cell", { status: 400 });
  }

  const index = await getCellIndex(env, grid);
  const list = index.get(cell) ?? [];

  const slice = list.slice(offset, offset + limit);
  const hasMore = offset + limit < list.length;

  return Response.json(
    {
      grid,
      cell,
      total: list.length,
      offset,
      limit,
      has_more: hasMore,
      postcodes: slice,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    }
  );
};

/* ---------- types ---------- */

type GridKey = "1km" | "5km" | "10km" | "25km";

function isGridKey(v: string): v is GridKey {
  return v === "1km" || v === "5km" || v === "10km" || v === "25km";
}

interface Env {
  R2: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
}

type PostcodeRow = {
  pc_key?: string;
  postcode?: string;
  cell_1000?: string;
  cell_5000?: string;
  cell_10000?: string;
  cell_25000?: string;
};

/* ---------- cache ---------- */

const INDEX_BY_GRID: Partial<Record<GridKey, Map<string, string[]>>> = {};

async function getCellIndex(env: Env, grid: GridKey): Promise<Map<string, string[]>> {
  const cached = INDEX_BY_GRID[grid];
  if (cached) return cached;

  const bucket = ((env && ((env as any).BRICKGRID_BUCKET || (env as any).R2)) as unknown) as R2Bucket | undefined;
  if (!bucket) {
    throw new Error("R2 binding not found. Expected environment binding `BRICKGRID_BUCKET` or `R2`.");
  }

  const obj = await bucket.get("postcode_grid_lookup.json.gz");
  if (!obj) {
    throw new Error("R2 object not found: postcode_grid_lookup.json.gz");
  }

  const decompressed = await decompressGzip(await obj.arrayBuffer());
  const text = new TextDecoder().decode(decompressed);
  const rows = JSON.parse(text) as PostcodeRow[];

  const map = new Map<string, string[]>();
  const cellKey = grid === "1km" ? "cell_1000"
    : grid === "5km" ? "cell_5000"
    : grid === "10km" ? "cell_10000"
    : "cell_25000";

  for (const r of rows) {
    const cell = (r as any)[cellKey] as string | undefined;
    if (!cell) continue;
    const pc = (r.postcode || r.pc_key || "").toString();
    if (!pc) continue;
    const list = map.get(cell);
    if (list) list.push(pc);
    else map.set(cell, [pc]);
  }

  INDEX_BY_GRID[grid] = map;
  return map;
}

function clampInt(v: string | null, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
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

import type { R2Bucket } from "@cloudflare/workers-types";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const url = new URL(request.url);

    const grid = (url.searchParams.get("grid") ?? "25km") as GridKey;
    // Allow either `cell` (e.g. "385000_801000") or numeric coords `gx` and `gy`
    let cell = (url.searchParams.get("cell") ?? "").trim();
    const gxParam = url.searchParams.get("gx");
    const gyParam = url.searchParams.get("gy");
    if (!cell && gxParam && gyParam) {
      // normalize to the same key format as used in the lookup (int ints joined by `_`)
      const gxn = Number(gxParam);
      const gyn = Number(gyParam);
      if (Number.isFinite(gxn) && Number.isFinite(gyn)) {
        cell = `${Math.round(gxn)}_${Math.round(gyn)}`;
      }
    }
    const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 1_000_000);
    // Default to the uploaded R2 object name; allow override via `key` param or `POSTCODE_LOOKUP_KEY` env var
    const key = (url.searchParams.get("key") ?? env.POSTCODE_LOOKUP_KEY ?? "postcode_grid_outcode_lookup.json.gz").trim();

    if (!isGridKey(grid)) {
      return Response.json("Invalid grid. Use 1km|5km|10km|25km", { status: 400 });
    }
    if (!cell) {
      return Response.json("Missing cell", { status: 400 });
    }

    const index = await getCellIndex(env, grid, key);
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
  } catch (err: any) {
    const message = err?.message || String(err);
    return new Response(JSON.stringify({ error: "Postcode lookup failed", message }), {
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

interface Env {
  R2: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
  POSTCODE_LOOKUP_KEY?: string;
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

async function getCellIndex(env: Env, grid: GridKey, key: string): Promise<Map<string, string[]>> {
  const cached = INDEX_BY_GRID[grid];
  if (cached) return cached;

  const bucket = ((env && ((env as any).BRICKGRID_BUCKET || (env as any).R2)) as unknown) as R2Bucket | undefined;
  if (!bucket) {
    throw new Error("R2 binding not found. Expected environment binding `BRICKGRID_BUCKET` or `R2`.");
  }

  // Try to fetch the object; many deployments place objects under a prefix
  // so attempt several common key variants before failing to give better diagnostics.
  const triedKeys: string[] = [];
  const candidates = Array.from(new Set([
    key,
    key.replace(/^\/+/, ""),
    key.replace(/^.*\//, ""),
    `valuemap-uk/${key}`,
    `valuemap-uk/${key.replace(/^.*\//, "")}`,
    `v1/${key}`,
    `v1/${key.replace(/^.*\//, "")}`,
  ]));

  let obj: { arrayBuffer: () => Promise<ArrayBuffer> } | null = null;
  let foundKey: string | null = null;
  for (const k of candidates) {
    triedKeys.push(k);
    // eslint-disable-next-line no-await-in-loop
    const attempt = await bucket.get(k as any as string);
    if (attempt) {
      obj = attempt;
      foundKey = k;
      break;
    }
  }

  if (!obj) {
    // helpful error showing what we tried
    throw new Error(`R2 object not found: tried keys: ${triedKeys.join(", ")}`);
  }

  const decompressed = await decompressGzip(await obj.arrayBuffer());
  const text = new TextDecoder().decode(decompressed);
  const rows = JSON.parse(text) as PostcodeRow[];

  const map = new Map<string, Set<string>>();

  // support either a combined cell column (e.g. cell_1000 = "385000_801000")
  // or split integer columns (cell_1000_x, cell_1000_y) which our preprocessing may produce
  const combinedCellField = grid === "1km" ? "cell_1000"
    : grid === "5km" ? "cell_5000"
    : grid === "10km" ? "cell_10000"
    : "cell_25000";
  const splitXField = `${combinedCellField}_x`;
  const splitYField = `${combinedCellField}_y`;

  for (const r of rows) {
    let cellVal: string | undefined;

    // Prefer existing combined cell string
    const rawCombined = (r as any)[combinedCellField];
    if (rawCombined !== undefined && rawCombined !== null && String(rawCombined).trim() !== "") {
      cellVal = String(rawCombined).trim();
    } else {
      // Try split integer fields
      const x = (r as any)[splitXField];
      const y = (r as any)[splitYField];
      if (x !== undefined && x !== null && y !== undefined && y !== null) {
        cellVal = `${String(x)}_${String(y)}`;
      }
    }

    if (!cellVal) continue;

    // outcode may already be provided (we wrote it); prefer it, else derive from postcode/pc_key
    let outcodeRaw = (r as any)["outcode"] ?? (r.postcode || r.pc_key || "");
    outcodeRaw = String(outcodeRaw).trim();
    if (!outcodeRaw) continue;
    const outcode = outcodeRaw.split(" ")[0].toUpperCase();
    if (!outcode) continue;

    const set = map.get(cellVal);
    if (set) set.add(outcode);
    else map.set(cellVal, new Set([outcode]));
  }

  const out = new Map<string, string[]>();
  for (const [cell, set] of map.entries()) {
    out.set(cell, Array.from(set).sort());
  }

  INDEX_BY_GRID[grid] = out;
  return out;
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

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
    const indexKeyParam = url.searchParams.get("indexKey") ?? env.POSTCODE_LOOKUP_INDEX_KEY;
    // Default to the uploaded R2 object name; allow override via `key` param or `POSTCODE_LOOKUP_KEY` env var
    // Extract the first token that looks like a JSON/GZ object key to avoid shell artifacts (e.g., jq)
    const rawKey = (url.searchParams.get("key") ?? env.POSTCODE_LOOKUP_KEY ?? "postcode_grid_outcode_lookup.json.gz").trim();
    const keyMatch = rawKey.match(/[a-zA-Z0-9/_.-]+\.json(?:\.gz)?/);
    const key = keyMatch ? keyMatch[0] : "postcode_grid_outcode_lookup.json.gz";

    const defaultIndexKey = `postcode_outcode_index_${grid}.json.gz`;
    const rawIndexKey = (indexKeyParam ?? defaultIndexKey).trim();
    const indexKeyMatch = rawIndexKey.match(/[a-zA-Z0-9/_.-]+\.json(?:\.gz)?/);
    const indexKey = indexKeyMatch ? indexKeyMatch[0] : defaultIndexKey;

    if (!isGridKey(grid)) {
      return Response.json("Invalid grid. Use 1km|5km|10km|25km", { status: 400 });
    }
    if (!cell) {
      return Response.json("Missing cell", { status: 400 });
    }

    const list = await getPostcodesForCell(env, grid, key, cell, indexKey);

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
          "Cache-Control": "public, max-age=1200",
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
  POSTCODE_LOOKUP_INDEX_KEY?: string;
}

type PostcodeRow = {
  pc_key?: string;
  postcode?: string;
  cell_1000?: string;
  cell_5000?: string;
  cell_10000?: string;
  cell_25000?: string;
};

/* ---------- lookup ---------- */

async function getPostcodesForCell(
  env: Env,
  grid: GridKey,
  key: string,
  cell: string,
  indexKey: string
): Promise<string[]> {
  const index = await tryLoadIndex(env, indexKey);
  if (index) {
    return index[cell] ?? [];
  }

  if (grid === "1km") {
    throw new Error("Index required for 1km grid. Upload postcode_outcode_index_1km.json.gz.");
  }

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

  const found = await fetchObjectWithCandidates(bucket, candidates, triedKeys);
  if (!found) {
    throw new Error(`R2 object not found: tried keys: ${triedKeys.join(", ")}`);
  }
  const { obj } = found;

  const decompressed = await decompressGzip(await obj.arrayBuffer());
  const text = new TextDecoder().decode(decompressed);
  const rows = JSON.parse(text) as PostcodeRow[];

  const outcodes = new Set<string>();

  // support either a combined cell column (e.g. cell_1000 = "385000_801000")
  // or split integer columns (cell_1000_x, cell_1000_y) which our preprocessing may produce
  const combinedCellField = grid === "5km" ? "cell_5000"
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

    if (cellVal === cell) {
      outcodes.add(outcode);
    }
  }

  return Array.from(outcodes).sort();
}

async function tryLoadIndex(env: Env, indexKey: string): Promise<Record<string, string[]> | null> {
  const cached = INDEX_CACHE.get(indexKey);
  if (cached) return cached;

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

  const found = await fetchObjectWithCandidates(bucket, candidates, triedKeys);
  if (!found) return null;

  const decompressed = await decompressGzip(await found.obj.arrayBuffer());
  const text = new TextDecoder().decode(decompressed);
  const parsed = JSON.parse(text) as Record<string, string[]>;
  INDEX_CACHE.set(indexKey, parsed);
  return parsed;
}

const INDEX_CACHE = new Map<string, Record<string, string[]>>();

async function fetchObjectWithCandidates(
  bucket: R2Bucket,
  candidates: string[],
  triedKeys: string[]
): Promise<{ obj: { arrayBuffer: () => Promise<ArrayBuffer> }; foundKey: string } | null> {
  for (const k of candidates) {
    triedKeys.push(k);
    // eslint-disable-next-line no-await-in-loop
    const attempt = await bucket.get(k as any as string);
    if (attempt) {
      return { obj: attempt, foundKey: k };
    }
  }
  return null;
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

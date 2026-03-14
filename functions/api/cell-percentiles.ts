import type { R2Bucket } from "@cloudflare/workers-types";
import { gunzipToString } from "../_lib/gzip";

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
}

// Lookup format: { "gx_gy": [p25, p70, p90, src_int] }  src: 0=direct 1=parent 2=national
type PctEntry = [number, number, number, number];
type PctLookup = Record<string, PctEntry>;

const SOURCE_LABELS = ["direct", "parent", "national"] as const;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let _cache: PctLookup | null = null;
let _cacheLoadedAt = 0;

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const url = new URL(request.url);
  const gx = Number(url.searchParams.get("gx"));
  const gy = Number(url.searchParams.get("gy"));

  if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
    return Response.json({ error: "gx and gy are required" }, { status: 400 });
  }

  const now = Date.now();
  if (!_cache || now - _cacheLoadedAt > CACHE_TTL_MS) {
    const bucket: R2Bucket = env.BRICKGRID_BUCKET ?? env.R2 as R2Bucket;
    if (!bucket) return Response.json({ error: "R2 binding not found" }, { status: 500 });
    const obj = await bucket.get("cells_1mile_percentiles.json.gz");
    if (!obj) return Response.json({ error: "Lookup file not found" }, { status: 503 });
    const gz = await obj.arrayBuffer();
    const text = await gunzipToString(gz);
    _cache = JSON.parse(text) as PctLookup;
    _cacheLoadedAt = now;
  }

  const key = `${gx}_${gy}`;
  const entry = _cache[key];
  if (!entry) {
    return Response.json({ error: "Cell not found" }, { status: 404 });
  }

  return Response.json({
    p25: entry[0],
    p70: entry[1],
    p90: entry[2],
    p_source: SOURCE_LABELS[entry[3]] ?? "direct",
  });
};

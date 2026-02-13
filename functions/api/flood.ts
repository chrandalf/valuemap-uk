import type { R2Bucket } from "@cloudflare/workers-types";

type FloodGeoJson = {
  type: "FeatureCollection";
  features: unknown[];
};

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
  FLOOD_OVERLAY_KEY?: string;
}

const FLOOD_CACHE = new Map<string, FloodGeoJson>();

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const url = new URL(request.url);
    const rawKey = (url.searchParams.get("key") ?? env.FLOOD_OVERLAY_KEY ?? "flood_postcode_points.geojson.gz").trim();
    const keyMatch = rawKey.match(/[a-zA-Z0-9/_.-]+\.(?:geojson|json)(?:\.gz)?/i);
    const key = keyMatch ? keyMatch[0] : "flood_postcode_points.geojson.gz";

    const cached = FLOOD_CACHE.get(key);
    if (cached) {
      return Response.json(cached, {
        headers: {
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const bucket = env.BRICKGRID_BUCKET ?? env.R2;
    if (!bucket) {
      throw new Error("R2 binding not found. Expected environment binding `BRICKGRID_BUCKET` or `R2`.");
    }

    const candidates = Array.from(
      new Set([
        key,
        key.replace(/^\/+/, ""),
        key.replace(/^.*\//, ""),
        `valuemap-uk/${key}`,
        `valuemap-uk/${key.replace(/^.*\//, "")}`,
        `v1/${key}`,
        `v1/${key.replace(/^.*\//, "")}`,
      ])
    );

    let obj: { arrayBuffer: () => Promise<ArrayBuffer> } | null = null;
    let foundKey: string | null = null;
    for (const candidate of candidates) {
      const attempt = await bucket.get(candidate);
      if (attempt) {
        obj = attempt;
        foundKey = candidate;
        break;
      }
    }

    if (!obj || !foundKey) {
      return Response.json({ error: `Flood overlay not found for key '${key}'.` }, { status: 404 });
    }

    const bytes = await obj.arrayBuffer();
    const text = foundKey.endsWith(".gz")
      ? new TextDecoder().decode(await decompressGzip(bytes))
      : new TextDecoder().decode(bytes);

    const parsed: unknown = JSON.parse(text);
    const normalized: FloodGeoJson = isFeatureCollection(parsed)
      ? { type: "FeatureCollection", features: parsed.features }
      : { type: "FeatureCollection", features: [] };

    FLOOD_CACHE.set(key, normalized);

    return Response.json(normalized, {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "Flood overlay lookup failed", message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
};

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

function isFeatureCollection(value: unknown): value is FloodGeoJson {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === "FeatureCollection" && Array.isArray(maybe.features);
}
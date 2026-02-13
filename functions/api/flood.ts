import type { R2Bucket } from "@cloudflare/workers-types";

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
  FLOOD_OVERLAY_KEY?: string;
}

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const url = new URL(request.url);
    const rawKey = (url.searchParams.get("key") ?? env.FLOOD_OVERLAY_KEY ?? "flood_postcode_points.geojson.gz").trim();
    const keyMatch = rawKey.match(/[a-zA-Z0-9/_.-]+\.(?:geojson|json)(?:\.gz)?/i);
    const key = keyMatch ? keyMatch[0] : "flood_postcode_points.geojson.gz";

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

    let obj: (Awaited<ReturnType<R2Bucket["get"]>>) | null = null;
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

    if (!obj.body) {
      return Response.json({ error: `Flood overlay object '${foundKey}' has no body.` }, { status: 500 });
    }

    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("Content-Type", foundKey.endsWith(".geojson") || foundKey.endsWith(".geojson.gz") ? "application/geo+json; charset=utf-8" : "application/json; charset=utf-8");
    if (foundKey.endsWith(".gz")) {
      headers.set("Content-Encoding", "gzip");
    }
    headers.set("X-Flood-Key", foundKey);

    return new Response(obj.body, {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "Flood overlay lookup failed", message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
};

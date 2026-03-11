import type { R2Bucket } from "@cloudflare/workers-types";
import { gunzipStream } from "../_lib/gzip";

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
}

type ResolvedObject = {
  object: NonNullable<Awaited<ReturnType<R2Bucket["get"]>>>;
  key: string;
};

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const url = new URL(request.url);
    const resolved = await resolveListedBuildingObject(env, request);
    if (!resolved) {
      const requestedKey = normalizeRequestedKey(url.searchParams.get("key") ?? "listed_building_overlay_points.geojson.gz");
      return Response.json({ error: `Listed building overlay not found for key '${requestedKey}'.` }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set(
      "Content-Type",
      resolved.key.endsWith(".geojson") || resolved.key.endsWith(".geojson.gz")
        ? "application/geo+json; charset=utf-8"
        : "application/json; charset=utf-8"
    );
    const wantsPlain = url.searchParams.get("plain") === "1";
    if (resolved.key.endsWith(".gz") && !wantsPlain) {
      headers.set("Content-Encoding", "gzip");
    }
    headers.set("X-ListedBuilding-Key", resolved.key);

    if (url.searchParams.get("meta") === "1") {
      return Response.json(
        {
          ok: true,
          key: resolved.key,
          size: resolved.object.size,
          uploaded: resolved.object.uploaded?.toISOString?.() ?? null,
          httpEtag: resolved.object.httpEtag ?? null,
        },
        { headers }
      );
    }

    if (wantsPlain && resolved.key.endsWith(".gz") && resolved.object.body) {
      const plainStream = gunzipStream(resolved.object.body as unknown as ReadableStream<unknown>);
      headers.delete("Content-Encoding");
      headers.set("X-ListedBuilding-Plain", "1");
      return new Response(plainStream, {
        status: 200,
        headers,
      });
    }

    const body = await resolved.object.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "Listed building overlay lookup failed", message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const onRequestHead = async ({ env, request }: { env: Env; request: Request }) => {
  try {
    const resolved = await resolveListedBuildingObject(env, request);
    if (!resolved) {
      return new Response(null, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set(
      "Content-Type",
      resolved.key.endsWith(".geojson") || resolved.key.endsWith(".geojson.gz")
        ? "application/geo+json; charset=utf-8"
        : "application/json; charset=utf-8"
    );
    const url = new URL(request.url);
    const wantsPlain = url.searchParams.get("plain") === "1";
    if (resolved.key.endsWith(".gz") && !wantsPlain) {
      headers.set("Content-Encoding", "gzip");
    }
    headers.set("X-ListedBuilding-Key", resolved.key);
    headers.set("X-ListedBuilding-Size", String(resolved.object.size ?? 0));
    if (wantsPlain) headers.set("X-ListedBuilding-Plain", "1");

    return new Response(null, { status: 200, headers });
  } catch {
    return new Response(null, { status: 503 });
  }
};

function normalizeRequestedKey(raw: string) {
  const cleaned = raw.trim();
  const keyMatch = cleaned.match(/[a-zA-Z0-9/_.-]+\.(?:geojson|json)(?:\.gz)?/i);
  return keyMatch ? keyMatch[0] : "listed_building_overlay_points.geojson.gz";
}

async function resolveListedBuildingObject(env: Env, request: Request): Promise<ResolvedObject | null> {
  const url = new URL(request.url);
  const requestedKey = normalizeRequestedKey(
    url.searchParams.get("key") ?? "listed_building_overlay_points.geojson.gz"
  );

  const bucket = env.BRICKGRID_BUCKET ?? env.R2;
  if (!bucket) {
    throw new Error("R2 binding not found. Expected environment binding `BRICKGRID_BUCKET` or `R2`.");
  }

  const obj = await bucket.get(requestedKey);
  if (!obj) return null;
  return { object: obj, key: requestedKey };
}

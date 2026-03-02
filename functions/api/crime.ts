import type { R2Bucket } from "@cloudflare/workers-types";
import { gunzipStream } from "../_lib/gzip";

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
}

const DEFAULT_KEY = "crime_overlay_lsoa.geojson.gz";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const url = new URL(request.url);
  const key = (url.searchParams.get("key") ?? DEFAULT_KEY).replace(/^\/+/, "");

  const bucket: R2Bucket | undefined = env.BRICKGRID_BUCKET ?? env.R2;
  if (!bucket) {
    return Response.json({ error: "R2 bucket not configured." }, { status: 503 });
  }

  const object = await bucket.get(key);
  if (!object) {
    return Response.json({ error: `Crime overlay not found for key '${key}'.` }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set(
    "Content-Type",
    key.endsWith(".geojson") || key.endsWith(".geojson.gz")
      ? "application/geo+json; charset=utf-8"
      : "application/json; charset=utf-8"
  );

  const wantsPlain = url.searchParams.get("plain") === "1";
  if (key.endsWith(".gz") && !wantsPlain) {
    headers.set("Content-Encoding", "gzip");
  }

  if (url.searchParams.get("meta") === "1") {
    return Response.json(
      {
        ok: true,
        key,
        size: object.size,
        uploaded: object.uploaded?.toISOString?.() ?? null,
        httpEtag: object.httpEtag ?? null,
      },
      { headers }
    );
  }

  if (wantsPlain && key.endsWith(".gz") && object.body) {
    const plainStream = gunzipStream(object.body as unknown as ReadableStream<unknown>);
    headers.delete("Content-Encoding");
    return new Response(plainStream, { status: 200, headers });
  }

  const body = await object.arrayBuffer();
  return new Response(body, { status: 200, headers });
};

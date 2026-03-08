import type { R2Bucket } from "@cloudflare/workers-types";

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
}

export const onRequestGet = async ({ env }: { env: Env; request: Request }) => {
  const bucket: R2Bucket | undefined = env.BRICKGRID_BUCKET ?? env.R2;
  if (!bucket) {
    return Response.json({ error: "R2 bucket not configured." }, { status: 503 });
  }

  const object = await bucket.get("data_freshness.json");
  if (!object) {
    return Response.json({ error: "data_freshness.json not found in R2." }, { status: 404 });
  }

  const text = await object.text();
  return new Response(text, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};

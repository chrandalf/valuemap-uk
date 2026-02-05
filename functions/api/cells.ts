export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);

  // ---- query params (match your UI state) ----
  const grid = url.searchParams.get("grid") ?? "25km";
  const propertyType = (url.searchParams.get("propertyType") ?? "ALL").toUpperCase();
  const newBuild = (url.searchParams.get("newBuild") ?? "ALL").toUpperCase();
  const endMonthParam = (url.searchParams.get("endMonth") ?? "LATEST").toUpperCase();

  if (grid !== "25km") {
    return Response.json(
      { error: "Only 25km grid wired for now" },
      { status: 400 }
    );
  }

  // ---- load + cache data ----
  const data = await getCached25km(env);
  const endMonth =
    endMonthParam === "LATEST" ? data.latestEndMonth : endMonthParam;

  // ---- filter rows ----
  const rows = data.rows.filter(
    (r) =>
      r.end_month === endMonth &&
      r.property_type === propertyType &&
      r.new_build === newBuild
  );

  return Response.json(
    {
      grid,
      end_month: endMonth,
      propertyType,
      newBuild,
      count: rows.length,
      rows,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    }
  );
};

/* ---------- types ---------- */

type CellRow = {
  gx: number;
  gy: number;
  end_month: string;
  property_type: string;
  new_build: string;
  median: number;
  tx_count: number;
  delta_gbp?: number;
  delta_pct?: number;
  years_stale?: number;
};

interface Env {
  R2: R2Bucket;
}

/* ---------- cache ---------- */

let CACHE: {
  rows: CellRow[];
  latestEndMonth: string;
} | null = null;

async function getCached25km(env: Env) {
  if (CACHE) return CACHE;

  const obj = await env.R2.get("v1/grid/25km/full.json.gz");
  if (!obj) {
    throw new Error("R2 object not found: v1/grid/25km/full.json.gz");
  }

  const gz = await obj.arrayBuffer();
  const jsonText = await gunzipToString(gz);
  const rows = JSON.parse(jsonText) as CellRow[];

  // compute latest month once
  let latest = "0000-00-00";
  for (const r of rows) {
    if (r.end_month > latest) latest = r.end_month;
  }

  CACHE = { rows, latestEndMonth: latest };
  return CACHE;
}

/* ---------- gzip helper (Workers runtime supports this) ---------- */

async function gunzipToString(gz: ArrayBuffer): Promise<string> {
  // @ts-ignore – available in Workers runtime
  const ds = new DecompressionStream("gzip");
  const stream = new Response(gz).body!.pipeThrough(ds);
  return await new Response(stream).text();
}
import type { R2Bucket } from "@cloudflare/workers-types";
import { gunzipToString } from "../_lib/gzip";

// Returns a single-cell valuation snapshot for the price-check feature.
// Inputs: gx, gy (OSGB36 metres for 1mile/1600m grid), propertyType (D|S|T|F|ALL)
// The endpoint loads the latest 1mile + 5km median partitions from R2 (same cache
// pattern as cells.ts) and the percentile file, then returns the matching rows.

interface Env {
  R2?: R2Bucket;
  BRICKGRID_BUCKET?: R2Bucket;
}

type PropertyType = "ALL" | "D" | "S" | "T" | "F";

function isPropertyType(v: string): v is PropertyType {
  return ["ALL", "D", "S", "T", "F"].includes(v);
}

type CellRow = {
  gx: number;
  gy: number;
  median?: number;
  tx_count?: number;
  estimated_median?: number;
  actual_median?: number;
  is_modelled?: boolean;
  model_confidence?: number;
  n_years_model?: number;
  median_ppsf?: number;
  [k: string]: unknown;
};

type PctEntry = [number, number, number, number]; // [p25, p70, p90, src_int]
type PctLookup = Record<string, PctEntry>;

const CACHE_TTL_MS = 10 * 60 * 1000;

function getBucket(env: Env): R2Bucket {
  const b = env.BRICKGRID_BUCKET ?? env.R2;
  if (!b) throw new Error("R2 binding not found");
  return b as R2Bucket;
}

/* ---- manifest (resolves latest end_month) ---- */
const MANIFEST_CACHE = new Map<string, { data: any; loadedAtMs: number }>();

async function getLatestEndMonth(env: Env, grid: "1mile" | "5km"): Promise<string | null> {
  const key = `cells/${grid}/median/_manifest.json`;
  const now = Date.now();
  const cached = MANIFEST_CACHE.get(key);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) {
    const months = [...new Set((cached.data.partitions as any[]).map((p: any) => p.end_month as string))].sort();
    return months[months.length - 1] ?? null;
  }
  const bucket = getBucket(env);
  const obj = await bucket.get(key);
  if (!obj) return null;
  const data = JSON.parse(await obj.text());
  MANIFEST_CACHE.set(key, { data, loadedAtMs: Date.now() });
  const months = [...new Set((data.partitions as any[]).map((p: any) => p.end_month as string))].sort();
  return months[months.length - 1] ?? null;
}

/* ---- partition row cache ---- */
const PARTITION_CACHE = new Map<string, { rows: CellRow[]; loadedAtMs: number }>();

async function getPartitionRows(env: Env, key: string): Promise<CellRow[] | null> {
  const now = Date.now();
  const cached = PARTITION_CACHE.get(key);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.rows;
  const bucket = getBucket(env);
  const obj = await bucket.get(key);
  if (!obj) return null;
  const gz = await obj.arrayBuffer();
  const rows = JSON.parse(await gunzipToString(gz)) as CellRow[];
  PARTITION_CACHE.set(key, { rows, loadedAtMs: Date.now() });
  return rows;
}

/* ---- percentile cache ---- */
let _pctCache: PctLookup | null = null;
let _pctLoadedAt = 0;

async function getPercentiles(env: Env): Promise<PctLookup | null> {
  const now = Date.now();
  if (_pctCache && now - _pctLoadedAt <= CACHE_TTL_MS) return _pctCache;
  const bucket = getBucket(env);
  const obj = await bucket.get("cells_1mile_percentiles.json.gz");
  if (!obj) return null;
  const gz = await obj.arrayBuffer();
  _pctCache = JSON.parse(await gunzipToString(gz)) as PctLookup;
  _pctLoadedAt = Date.now();
  return _pctCache;
}

/* ---- modelled data cache ---- */
const MODELLED_CACHE = new Map<string, { lookup: Map<string, { estimated_median: number; model_confidence: number; n_years_model: number }>; loadedAtMs: number }>();

async function getModelledLookup(env: Env, propertyType: string, newBuild: string) {
  const key = `price_model/modelled_cells_${propertyType}_${newBuild}.json.gz`;
  const now = Date.now();
  const cached = MODELLED_CACHE.get(key);
  if (cached && now - cached.loadedAtMs <= CACHE_TTL_MS) return cached.lookup;
  const bucket = getBucket(env);
  const obj = await bucket.get(key);
  if (!obj) return null;
  const gz = await obj.arrayBuffer();
  const rows = JSON.parse(await gunzipToString(gz)) as Array<{ gx: number; gy: number; estimated_median: number; model_confidence: number; n_years_model: number }>;
  const lookup = new Map<string, { estimated_median: number; model_confidence: number; n_years_model: number }>();
  for (const r of rows) lookup.set(`${r.gx}_${r.gy}`, { estimated_median: r.estimated_median, model_confidence: r.model_confidence, n_years_model: r.n_years_model });
  MODELLED_CACHE.set(key, { lookup, loadedAtMs: Date.now() });
  return lookup;
}

/* ---- main handler ---- */
export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const url = new URL(request.url);
  const gx = Number(url.searchParams.get("gx"));
  const gy = Number(url.searchParams.get("gy"));
  const rawType = (url.searchParams.get("propertyType") ?? "ALL").toUpperCase();
  const propertyType: PropertyType = isPropertyType(rawType) ? rawType : "ALL";

  if (!Number.isFinite(gx) || !Number.isFinite(gy) || gx < 0 || gy < 0) {
    return Response.json({ error: "Valid gx and gy required (OSGB36 metres)" }, { status: 400 });
  }

  // Round to nearest 1mile (1600m) cell boundary, just in case caller sends raw easting/northing
  const gx1 = Math.floor(gx / 1600) * 1600;
  const gy1 = Math.floor(gy / 1600) * 1600;

  // Parent 5km cell
  const gx5 = Math.floor(gx / 5000) * 5000;
  const gy5 = Math.floor(gy / 5000) * 5000;

  try {
    // Resolve end months in parallel
    const [endMonth1, endMonth5] = await Promise.all([
      getLatestEndMonth(env, "1mile"),
      getLatestEndMonth(env, "5km"),
    ]);

    if (!endMonth1 || !endMonth5) {
      return Response.json({ error: "Data manifest not available" }, { status: 503 });
    }

    // Load partitions + percentiles + modelled data in parallel
    const partKey1 = `cells/1mile/median/${endMonth1}/${propertyType}_ALL.json.gz`;
    const partKey5 = `cells/5km/median/${endMonth5}/ALL_ALL.json.gz`;

    const [rows1, rows5, pcts, modelledLookup, ppsf1Rows] = await Promise.all([
      getPartitionRows(env, partKey1),
      getPartitionRows(env, partKey5),
      getPercentiles(env),
      getModelledLookup(env, propertyType, "ALL").catch(() => null),
      // Also load the PPSF partition (separate metric)
      endMonth1
        ? getPartitionRows(env, `cells/1mile/median_ppsf/${endMonth1}/${propertyType}_ALL.json.gz`).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Find the 1mile cell
    const cellKey1 = `${gx1}_${gy1}`;
    const rawCell = rows1?.find(r => r.gx === gx1 && r.gy === gy1) ?? null;

    // Overlay modelled data
    let cell: CellRow | null = rawCell ? { ...rawCell } : null;
    if (cell) {
      const mod = modelledLookup?.get(cellKey1);
      if (mod) {
        cell.estimated_median = mod.estimated_median;
        cell.model_confidence = mod.model_confidence;
        cell.n_years_model = mod.n_years_model;
        // Prefer the model estimate over sparse actuals (< 10 transactions)
        if (!cell.median || Number(cell.tx_count ?? 0) < 10) {
          cell.actual_median = cell.median ?? undefined;
          cell.median = mod.estimated_median;
          cell.is_modelled = true;
        }
      }
    }

    // Find PPSF
    const ppsfCell = ppsf1Rows?.find(r => r.gx === gx1 && r.gy === gy1) ?? null;
    const medianPpsf = ppsfCell?.median ?? null;

    // Find the 5km parent cell
    const parentCell = rows5?.find(r => r.gx === gx5 && r.gy === gy5) ?? null;

    // Percentile data
    const pctEntry = pcts?.[cellKey1] ?? null;
    const SOURCE_LABELS = ["direct", "parent", "national"] as const;

    return Response.json({
      end_month: endMonth1,
      gx: gx1,
      gy: gy1,
      // Cell data
      median:            cell?.median           ?? null,
      actual_median:     cell?.actual_median    ?? null,
      estimated_median:  cell?.estimated_median ?? null,
      tx_count:          cell?.tx_count         ?? 0,
      is_modelled:       cell?.is_modelled      ?? false,
      model_confidence:  cell?.model_confidence ?? 0,
      n_years_model:     cell?.n_years_model    ?? 0,
      median_ppsf:       Number.isFinite(Number(medianPpsf)) ? Number(medianPpsf) : null,
      // Percentiles
      p25:      pctEntry ? pctEntry[0] : null,
      p70:      pctEntry ? pctEntry[1] : null,
      p90:      pctEntry ? pctEntry[2] : null,
      p_source: pctEntry ? (SOURCE_LABELS[pctEntry[3]] ?? "direct") : null,
      // Parent 5km context
      parent_median:    parentCell?.median   ?? null,
      parent_tx_count:  parentCell?.tx_count ?? 0,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
};

"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "delta_gbp" | "delta_pct";

export type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: string;
  newBuild: string;
  endMonth?: string;
};

type ApiRow = {
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

export default function ValueMap({ state }: { state: MapState }) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Cache: avoid recomputing polygons when toggling metric only
  const geoCacheRef = useRef<Map<string, any>>(new Map<string, any>());

  // Create map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-1.5, 53.5],
      zoom: 5,
      minZoom: 4,
      maxZoom: 16,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", async () => {
      map.addSource("cells", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "cells-fill",
    type: "fill",
    source: "cells",
    paint: {
      "fill-color": getFillColorExpression(state.metric),
      "fill-opacity": 0.42,
    },
  });

  map.addLayer({
    id: "cells-outline",
    type: "line",
    source: "cells",
    paint: {
      "line-color": "rgba(0,0,0,0.85)",
      "line-width": 1.2,
    },
  });

  map.addLayer({
    id: "cells-no-sales",
    type: "symbol",
    source: "cells",
    layout: {
      "text-field": "✕",
      "text-size": 24,
      "text-anchor": "center",
      "text-offset": [0, 0],
    },
    paint: {
      "text-color": "rgba(100, 100, 100, 0.7)",
    },
    filter: ["==", ["get", "tx_count"], 0],
  });

  // ✅ ADD HOVER TOOLTIP HERE (after layers exist)
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
  });

  map.on("mousemove", "cells-fill", (e) => {
    map.getCanvas().style.cursor = "pointer";

    const f = e.features?.[0] as any;
    if (!f) return;

    const p = f.properties || {};
    const median = Number(p.median ?? 0);
    const tx = Number(p.tx_count ?? 0);

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
          <div style="font-weight: 700; margin-bottom: 4px;">£${median.toLocaleString()}</div>
          <div>Sales: <b>${tx}</b></div>
        </div>
      `)
      .addTo(map);
  });

  map.on("mouseleave", "cells-fill", () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
  });

  // Initial real data load
  await setRealData(map, state, geoCacheRef.current);
});

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload data when filters/grid/metric change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    setRealData(map, state, geoCacheRef.current).catch((e) => {
      console.error("setRealData failed", e);
    });
  }, [state.grid, state.propertyType, state.newBuild, state.endMonth, state.metric]);

  // Update colours when metric changes (no refetch)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    // Recompute percentile-based colour mapping using the current grid aggregate
    ensureAggregatesAndUpdate(map, state, geoCacheRef.current).catch((e) => {
      // fallback to absolute expression if anything goes wrong
      // eslint-disable-next-line no-console
      console.error('ensureAggregatesAndUpdate failed on metric change', e);
      if (map.getLayer("cells-fill")) {
        map.setPaintProperty("cells-fill", "fill-color", getFillColorExpression(state.metric));
      }
    });
  }, [state.metric]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      <div
        id="median-overlay"
        style={{
          position: "absolute",
          top: 12,
          right: 70,
          background: "rgba(255,255,255,0.95)",
          padding: "6px 10px",
          borderRadius: 6,
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          fontSize: 13,
          zIndex: 2,
        }}
      >
        Loading...
      </div>
    </div>
  );
}

/** ---------------- Real data wiring ---------------- */

async function setRealData(map: maplibregl.Map, state: MapState, cache: Map<string, any>) {
  // Determine if we're fetching delta or regular data
  const isDelta = state.metric === "delta_gbp" || state.metric === "delta_pct";
  const endpoint = isDelta ? "/api/deltas" : "/api/cells";

  const endMonth = isDelta ? undefined : state.endMonth ?? "LATEST";
  const cacheKey = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth ?? "LATEST"}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    const src = map.getSource("cells") as maplibregl.GeoJSONSource;
    src.setData(cached);
    await ensureAggregatesAndUpdate(map, state, cache);
    return;
  }

  const qs = new URLSearchParams({
    grid: state.grid,
    propertyType: state.propertyType ?? "ALL",
    newBuild: state.newBuild ?? "ALL",
  });
  
  // Only add endMonth for non-delta requests
  if (!isDelta) {
    qs.set("endMonth", endMonth!);
  }

  const res = await fetch(`${endpoint}?${qs.toString()}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API failed ${res.status}: ${txt}`);
  }

  const payload: any = await res.json();

  // Normalize delta rows to have gx/gy instead of gx_5000/gy_5000 etc
  let rows: any[] = Array.isArray(payload) ? payload : payload.rows;
  if (!Array.isArray(rows)) throw new Error("Unexpected API payload shape");

  if (isDelta) {
    rows = normalizeDeltaRows(rows, state.grid);
  }

  const fc = rowsToGeoJsonSquares(rows, gridToMeters(state.grid));

  cache.set(cacheKey, fc);

  const src = map.getSource("cells") as maplibregl.GeoJSONSource;
  src.setData(fc as any);
  await ensureAggregatesAndUpdate(map, state, cache);
}

// Normalize delta rows: rename gx_5000/gy_5000 to gx/gy based on grid
function normalizeDeltaRows(rows: any[], grid: GridSize): ApiRow[] {
  const gridMeters = gridToMeters(grid);
  const gxKey = `gx_${gridMeters}`;
  const gyKey = `gy_${gridMeters}`;

  return rows.map((r) => ({
    gx: r[gxKey],
    gy: r[gyKey],
    end_month: r.end_month_latest || "N/A",
    property_type: r.property_type,
    new_build: r.new_build,
    median: 0, // Not used for deltas
    tx_count: r.sales_latest || 0,
    delta_gbp: r.delta_gbp || 0,
    delta_pct: r.delta_pct || 0,
    years_stale: r.years_delta || 0,
  }));
}

async function ensureAggregatesAndUpdate(map: maplibregl.Map, state: MapState, cache: Map<string, any>) {
  try {
    // For delta metrics, skip aggregates (no 25km overlay makes sense)
    const isDelta = state.metric === "delta_gbp" || state.metric === "delta_pct";
    if (isDelta) return;

    // 1) ensure 25km aggregate for the overlay (unchanged behaviour)
    const endMonth = state.endMonth ?? "LATEST";
    const key25 = `25km|${state.propertyType}|${state.newBuild}|median|${endMonth}`;
    let fc25 = cache.get(key25);

    if (!fc25) {
      const qs25 = new URLSearchParams({
        grid: "25km",
        propertyType: state.propertyType ?? "ALL",
        newBuild: state.newBuild ?? "ALL",
        endMonth: endMonth,
      });

      try {
        const res25 = await fetch(`/api/cells?${qs25.toString()}`);
        if (res25.ok) {
          const payload25: any = await res25.json();
          const rows25: ApiRow[] = Array.isArray(payload25) ? payload25 : payload25.rows;
          if (Array.isArray(rows25)) {
            fc25 = rowsToGeoJsonSquares(rows25, gridToMeters("25km"));
            cache.set(key25, fc25);
          }
        } else {
          // eslint-disable-next-line no-console
          console.warn("Failed to fetch 25km data for overlay", res25.status);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Error fetching 25km data for overlay", e);
      }
    }

    if (fc25) {
      updateOverlayFromFeatureCollection(map, fc25);
    } else {
      // fallback: use any available featurecollection (current map source)
      try {
        const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
        const data: any = src ? (src as any)._data ?? null : null;
        if (data) updateOverlayFromFeatureCollection(map, data);
      } catch (e) {
        // ignore
      }
    }

    // 2) ensure current-grid aggregate for colour breaks (per-grid deciles)
    const keyCur = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth}`;
    let fcCur = cache.get(keyCur);

    if (!fcCur) {
      // try to reuse the current map source data before fetching
      try {
        const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
        const srcData: any = src ? (src as any)._data ?? null : null;
        if (srcData && Array.isArray(srcData.features) && srcData.features.length > 0) {
          fcCur = srcData;
          cache.set(keyCur, fcCur);
        }
      } catch (e) {
        // ignore
      }
    }

    if (!fcCur) {
      // fetch current grid as a fallback
      const qsCur = new URLSearchParams({
        grid: state.grid,
        propertyType: state.propertyType ?? "ALL",
        newBuild: state.newBuild ?? "ALL",
        endMonth: endMonth,
      });

      try {
        const resCur = await fetch(`/api/cells?${qsCur.toString()}`);
        if (resCur.ok) {
          const payloadCur: any = await resCur.json();
          const rowsCur: ApiRow[] = Array.isArray(payloadCur) ? payloadCur : payloadCur.rows;
          if (Array.isArray(rowsCur)) {
            fcCur = rowsToGeoJsonSquares(rowsCur, gridToMeters(state.grid));
            cache.set(keyCur, fcCur);
          }
        } else {
          // eslint-disable-next-line no-console
          console.warn("Failed to fetch current grid data for colour mapping", resCur.status);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Error fetching current grid data for colour mapping", e);
      }
    }

    // 3) compute decile breaks from the current-grid aggregate (or fallback to 25km)
    try {
      let breaks: number[] | null = null;
      const probs = [0,0.01,0.02,0.03,0.04,0.05,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.95,0.96,0.97,0.98,0.99,1];
      if (fcCur) breaks = computeWeightedQuantiles(fcCur, state.metric, probs);
      else if (fc25) breaks = computeWeightedQuantiles(fc25, state.metric, probs);

      if (breaks) {
        const colors = makeTailColors();
        const expr = buildTailColorExpression(state.metric, breaks, colors);
        if (map.getLayer("cells-fill")) {
          map.setPaintProperty("cells-fill", "fill-color", expr);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to apply decile colour mapping', e);
    }

  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("ensureAggregatesAndUpdate failed", e);
  }
}

function computeWeightedQuantiles(fc: any, metric: "median" | "delta_gbp" | "delta_pct", probs: number[]) {
  const features = (fc?.features ?? []) as any[];
  const values: Array<{v: number; w: number}> = [];

  for (const f of features) {
    const p = f.properties || {};
    const raw = Number(p[metric] ?? NaN);
    if (!isFinite(raw)) continue;
    const weight = Number(p.tx_count ?? 0) > 0 ? Number(p.tx_count) : 1;
    values.push({ v: raw, w: weight });
  }

  if (values.length === 0) {
    return probs.map(() => NaN);
  }

  values.sort((a, b) => a.v - b.v);
  const totalW = values.reduce((s, x) => s + x.w, 0);

  const breaks: number[] = [];
  let cum = 0;
  let pi = 0;
  for (const entry of values) {
    cum += entry.w;
    const frac = cum / totalW;
    while (pi < probs.length && frac >= probs[pi]) {
      breaks.push(entry.v);
      pi++;
    }
    if (pi >= probs.length) break;
  }
  while (breaks.length < probs.length) breaks.push(values[values.length - 1].v);
  return breaks;
}

function buildTailColorExpression(metric: string, breaks: number[], colors: string[]) {
  // build a step expression: start with color for values < first threshold
  const expr: any[] = ["step", ["get", metric], colors[0]];
  // push threshold,value pairs for remaining colors
  for (let i = 1; i < breaks.length && i < colors.length; i++) {
    expr.push(breaks[i]);
    expr.push(colors[i]);
  }
  return expr as any;
}

function makeTailColors() {
  // bottom tail (5 steps), middle (10), top tail (5)
  const bottom = ["#366ca1","#236686","#16799a","#2aa3c6","#58c7e6"];
  const middle = [
    "#00ccbc","#6dd2a8","#bfeaa3","#ffffbf","#fee08b",
    "#fdae61","#f07a4a","#e04d3b","#d73027","#b30015",
  ];
  const top = ["#3a0480", "#39235b", "#241048", "#140534", "#010001"];
  return [...bottom, ...middle, ...top];
}

function updateOverlayFromFeatureCollection(map: maplibregl.Map, fc: any) {
  try {
    const features = fc?.features ?? [];
    let sumW = 0;
    let sumWX = 0;

    for (const f of features) {
      const p = f.properties || {};
      const tx = Number(p.tx_count ?? 0);
      const median = Number(p.median ?? 0);
      if (tx > 0) {
        sumW += tx;
        sumWX += median * tx;
      }
    }

    const el = map.getContainer().querySelector("#median-overlay") as HTMLElement | null;
    let html = `<div style="font-weight:700">Weighted median: N/A</div>`;
    if (sumW > 0) {
      const avg = Math.round(sumWX / sumW);
      html = `<div style="font-weight:700">Weighted median: £${avg.toLocaleString()}</div>`;
      html += `<div style="margin-top:4px">Transactions: <b>${sumW.toLocaleString()}</b></div>`;
    } else {
      html += `<div style="margin-top:4px">Transactions: <b>0</b></div>`;
    }

    if (el) el.innerHTML = html;
  } catch (e) {
    // don't throw; overlay is purely UI
    // eslint-disable-next-line no-console
    console.error("updateOverlayFromFeatureCollection failed", e);
  }
}

function gridToMeters(grid: "1km" | "5km" | "10km" | "25km") {
  switch (grid) {
    case "1km": return 1000;
    case "5km": return 5000;
    case "10km": return 10000;
    case "25km": return 25000;
  }
}

function rowsToGeoJsonSquares(rows: ApiRow[], g: number) {
  const features: any[] = [];

  for (const r of rows) {
    const x0 = r.gx;
    const y0 = r.gy;
    const x1 = x0 + g;
    const y1 = y0 + g;

    const [lon00, lat00] = osgbToWgs84(x0, y0);
    const [lon10, lat10] = osgbToWgs84(x1, y0);
    const [lon11, lat11] = osgbToWgs84(x1, y1);
    const [lon01, lat01] = osgbToWgs84(x0, y1);

    // Cheap UK-ish clip (optional but helps if anything weird leaks in)
    if (
      lon00 < -11 || lon00 > 5 || lat00 < 48.5 || lat00 > 62.8 ||
      lon11 < -11 || lon11 > 5 || lat11 < 48.5 || lat11 > 62.8
    ) {
      continue;
    }

    const id = `${x0}_${y0}`;

    features.push({
      type: "Feature",
      id,
      geometry: {
        type: "Polygon",
        coordinates: [[
          [lon00, lat00],
          [lon10, lat10],
          [lon11, lat11],
          [lon01, lat01],
          [lon00, lat00],
        ]],
      },
      properties: {
        ...r,
        median: r.median,
        delta_gbp: r.delta_gbp ?? 0,
        delta_pct: r.delta_pct ?? 0,
        tx_count: r.tx_count,
        years_stale: r.years_stale ?? 0,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** ---------------- Styling helpers (unchanged) ---------------- */

function getFillColorExpression(metric: "median" | "delta_gbp" | "delta_pct") {
  if (metric === "median") {
    return [
    "interpolate", ["linear"], ["get", "median"],
    100000,  "#2c7bb6", // deep blue (cheap)
    200000,  "#00a6ca", // cyan
    300000,  "#00ccbc", // teal
    400000,  "#90eb9d", // soft green
    550000,  "#ffffbf", // very light (middle)
    700000,  "#fdae61", // orange
    850000,  "#f46d43", // strong orange/red
    1000000, "#d73027", // deep red (expensive)
  ] as any;
}

  if (metric === "delta_gbp") {
    return [
      "interpolate", ["linear"], ["get", "delta_gbp"],
      -200000, "#2c7bb6",
      -50000,  "#00ccbc",
      0,       "#90eb9d",
      100000,  "#fdae61",
      300000,  "#d73027",
    ] as any;
  }

  return [
    "interpolate", ["linear"], ["get", "delta_pct"],
    -20, "#d73027",
    -10, "#fdae61",
    0,   "#90eb9d",
    10,  "#00ccbc",
    20,  "#2c7bb6",
  ] as any;
}

/** ---------------- OSGB36 (EPSG:27700) -> WGS84 (EPSG:4326) ----------------
 * Self-contained conversion (no deps).
 * Accuracy: plenty for grid visualisation.
 */

// Ellipsoid / datum constants
const a = 6377563.396; // Airy 1830 major axis
const b = 6356256.909; // Airy 1830 minor axis
const F0 = 0.9996012717; // scale factor on central meridian
const lat0 = degToRad(49);
const lon0 = degToRad(-2);
const N0 = -100000;
const E0 = 400000;
const e2 = 1 - (b * b) / (a * a);
const n = (a - b) / (a + b);

function osgbToWgs84(E: number, N: number): [number, number] {
  // 1) Easting/Northing -> OSGB36 lat/lon
  const [lat, lon] = enToLatLonOSGB36(E, N);

  // 2) OSGB36 lat/lon -> cartesian (Airy 1830)
  const [x1, y1, z1] = latLonToCartesian(lat, lon, 0, a, b);

  // 3) Helmert transform to WGS84 cartesian
  const [x2, y2, z2] = helmertOSGB36ToWGS84(x1, y1, z1);

  // 4) cartesian -> WGS84 lat/lon
  const [latW, lonW] = cartesianToLatLon(x2, y2, z2, 6378137.0, 6356752.3141);

  return [radToDeg(lonW), radToDeg(latW)];
}

function enToLatLonOSGB36(E: number, N: number): [number, number] {
  let lat = lat0;
  let M = 0;

  do {
    lat = (N - N0 - M) / (a * F0) + lat;

    const Ma = (1 + n + (5 / 4) * n * n + (5 / 4) * n * n * n) * (lat - lat0);
    const Mb = (3 * n + 3 * n * n + (21 / 8) * n * n * n) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n * n + (15 / 8) * n * n * n) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n * n * n * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 0.00001); // 0.01mm

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);

  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const dE = E - E0;

  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * Math.pow(nu, 3))) * (5 + 3 * tanLat * tanLat + eta2 - 9 * eta2 * tanLat * tanLat);
  const IX = (tanLat / (720 * rho * Math.pow(nu, 5))) * (61 + 90 * tanLat * tanLat + 45 * Math.pow(tanLat, 4));

  const X = 1 / (cosLat * nu);
  const XI = (1 / (6 * cosLat * Math.pow(nu, 3))) * (nu / rho + 2 * tanLat * tanLat);
  const XII = (1 / (120 * cosLat * Math.pow(nu, 5))) * (5 + 28 * tanLat * tanLat + 24 * Math.pow(tanLat, 4));
  const XIIA = (1 / (5040 * cosLat * Math.pow(nu, 7))) * (61 + 662 * tanLat * tanLat + 1320 * Math.pow(tanLat, 4) + 720 * Math.pow(tanLat, 6));

  const lat1 = lat - VII * dE * dE + VIII * Math.pow(dE, 4) - IX * Math.pow(dE, 6);
  const lon1 = lon0 + X * dE - XI * Math.pow(dE, 3) + XII * Math.pow(dE, 5) - XIIA * Math.pow(dE, 7);

  return [lat1, lon1];
}

function latLonToCartesian(lat: number, lon: number, h: number, a_: number, b_: number): [number, number, number] {
  const e2_ = 1 - (b_ * b_) / (a_ * a_);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const nu = a_ / Math.sqrt(1 - e2_ * sinLat * sinLat);
  const x = (nu + h) * cosLat * cosLon;
  const y = (nu + h) * cosLat * sinLon;
  const z = ((1 - e2_) * nu + h) * sinLat;

  return [x, y, z];
}

function helmertOSGB36ToWGS84(x: number, y: number, z: number): [number, number, number] {
  // Helmert transform parameters (OSGB36 -> WGS84)
  const tx = 446.448;
  const ty = -125.157;
  const tz = 542.060;
  const s = 0.0000204894; // ppm -> scale (20.4894e-6)
  const rx = degToRad(0.00004172222);
  const ry = degToRad(0.00006861111);
  const rz = degToRad(0.00023391666);

  const x2 = tx + (1 + s) * x + (-rz) * y + (ry) * z;
  const y2 = ty + (rz) * x + (1 + s) * y + (-rx) * z;
  const z2 = tz + (-ry) * x + (rx) * y + (1 + s) * z;

  return [x2, y2, z2];
}

function cartesianToLatLon(x: number, y: number, z: number, a_: number, b_: number): [number, number] {
  const e2_ = 1 - (b_ * b_) / (a_ * a_);
  const p = Math.sqrt(x * x + y * y);

  let lat = Math.atan2(z, p * (1 - e2_));
  let latPrev = 2 * Math.PI;

  while (Math.abs(lat - latPrev) > 1e-12) {
    latPrev = lat;
    const sinLat = Math.sin(lat);
    const nu = a_ / Math.sqrt(1 - e2_ * sinLat * sinLat);
    lat = Math.atan2(z + e2_ * nu * sinLat, p);
  }

  const lon = Math.atan2(y, x);
  return [lat, lon];
}

function degToRad(d: number) { return (d * Math.PI) / 180; }
function radToDeg(r: number) { return (r * 180) / Math.PI; }

"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "delta_gbp" | "delta_pct";

export type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: string; // unused for mock, but keep it in state
  newBuild: string;     // unused for mock, but keep it in state
};

export default function Map({ state }: { state: MapState }) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

    map.on("load", () => {
      // Add empty source up front
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

      // Initial mock data
      setMockData(map, state.grid);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when grid changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    // If layers/sources aren't ready yet, skip
    const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    setMockData(map, state.grid);
  }, [state.grid]);

  // Update colours when metric changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    if (map.getLayer("cells-fill")) {
      map.setPaintProperty("cells-fill", "fill-color", getFillColorExpression(state.metric));
    }
  }, [state.metric]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

/** --- Mock data + styling helpers --- **/

function setMockData(map: maplibregl.Map, grid: GridSize) {
  const fc = generateMockCells(grid);
  const src = map.getSource("cells") as maplibregl.GeoJSONSource;
  src.setData(fc as any);
}

function generateMockCells(grid: GridSize) {
  // Rough UK-ish bbox
  const lonMin = -8.6, lonMax = 1.9;
  const latMin = 49.8, latMax = 60.9;

  // Cell size in km for mock
  const km = grid === "1km" ? 1 : grid === "5km" ? 5 : grid === "10km" ? 10 : 25;

  // Convert km to degrees (approx) - good enough for a mock
  const latStep = km / 111;
  const midLat = 55;
  const lonStep = km / (111 * Math.cos((midLat * Math.PI) / 180));

  // Control density (keep it smooth in browser)
  const count =
    grid === "1km" ? 900 :
    grid === "5km" ? 650 :
    grid === "10km" ? 450 : 250;

  const features: any[] = [];
  const rnd = mulberry32(hashStringToInt(grid)); // deterministic per grid

  for (let i = 0; i < count; i++) {
    const lon = lerp(lonMin, lonMax, rnd());
    const lat = lerp(latMin, latMax, rnd());

    const x0 = lon;
    const y0 = lat;
    const x1 = lon + lonStep;
    const y1 = lat + latStep;

    const median = Math.round(200_000 + rnd() * 800_000);              // £200k..£1m
    const delta_gbp = Math.round(-200_000 + rnd() * 500_000);          // -200k..+300k
    const delta_pct = Math.round((-30 + rnd() * 90) * 10) / 10;        // -30..+60
    const tx_count = Math.round(10 + rnd() * 220);                     // 10..230
    const years_stale = Math.round(rnd() * 3);                         // 0..3

    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ]],
      },
      properties: {
        median,
        delta_gbp,
        delta_pct,
        tx_count,
        years_stale,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function getFillColorExpression(metric: "median" | "delta_gbp" | "delta_pct") {
  // MapLibre expression, returned as any for simplicity
  if (metric === "median") {
    // green -> yellow -> red (higher price = red)
    return [
      "interpolate", ["linear"], ["get", "median"],
      200000, "#1a9850",
      400000, "#91cf60",
      600000, "#fee08b",
      800000, "#fc8d59",
      1000000, "#d73027",
    ] as any;
  }

  if (metric === "delta_gbp") {
    // red (down) -> white -> blue (up)
    return [
      "interpolate", ["linear"], ["get", "delta_gbp"],
      -200000, "#b2182b",
      -50000,  "#ef8a62",
      0,       "#f7f7f7",
      100000,  "#67a9cf",
      300000,  "#2166ac",
    ] as any;
  }

  // delta_pct
  return [
    "interpolate", ["linear"], ["get", "delta_pct"],
    -30, "#b2182b",
    -10, "#ef8a62",
    0,   "#f7f7f7",
    20,  "#67a9cf",
    60,  "#2166ac",
  ] as any;
}

/** deterministic random */
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStringToInt(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

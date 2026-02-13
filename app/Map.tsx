"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "delta_gbp" | "delta_pct";
type ValueFilterMode = "off" | "lte" | "gte";
type FloodOverlayMode = "off" | "on" | "on_hide_cells";

export type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: string;
  newBuild: string;
  endMonth?: string;
  valueFilterMode?: ValueFilterMode;
  valueThreshold?: number;
  floodOverlayMode?: FloodOverlayMode;
};

export type LegendData =
  | {
      kind: "median";
      breaks: number[];
      colors: string[];
      probs: number[];
    }
  | {
      kind: "delta";
      metric: "delta_gbp" | "delta_pct";
      min: number;
      max: number;
      maxAbs: number;
      stops: number[];
      colors: string[];
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

export default function ValueMap({
  state,
  onLegendChange,
  onPostcodePanelChange,
  onZoomChange,
}: {
  state: MapState;
  onLegendChange?: (legend: LegendData | null) => void;
  onPostcodePanelChange?: (open: boolean) => void;
  onZoomChange?: (zoom: number) => void;
}) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const stateRef = useRef<MapState>(state);
  const onZoomChangeRef = useRef<typeof onZoomChange>(onZoomChange);

  const [postcodeCell, setPostcodeCell] = useState<string | null>(null);
  const [postcodeItems, setPostcodeItems] = useState<string[]>([]);
  const [postcodeTotal, setPostcodeTotal] = useState(0);
  const [postcodeOffset, setPostcodeOffset] = useState(0);
  const [postcodeLoading, setPostcodeLoading] = useState(false);
  const [postcodeError, setPostcodeError] = useState<string | null>(null);
  const [scotlandNote, setScotlandNote] = useState<string | null>(null);
  const [postcodeMaxPrice, setPostcodeMaxPrice] = useState<number | null>(null);
  const fetchPostcodesRef = useRef<(gx: number, gy: number, offset: number, append: boolean) => void>(() => {});


  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    setPostcodeCell(null);
    setPostcodeItems([]);
    setPostcodeTotal(0);
    setPostcodeOffset(0);
    setPostcodeError(null);
    setScotlandNote(null);
    setPostcodeMaxPrice(null);
  }, [state.grid]);

  useEffect(() => {
    onPostcodePanelChange?.(Boolean(postcodeCell));
  }, [postcodeCell, onPostcodePanelChange]);


  // Cache: avoid recomputing polygons when toggling metric only
  const geoCacheRef = useRef<Map<string, any>>(new Map<string, any>());

  const buildZooplaHref = (outcode: string, maxPrice?: number | null) => {
    const clean = outcode.trim().toLowerCase();
    const s = stateRef.current;
    const params = new URLSearchParams({
      q: clean,
      search_source: s.newBuild === "Y" ? "new-homes" : "for-sale",
    });

    const isNewHomes = s.newBuild === "Y";
    let path = isNewHomes
      ? `https://www.zoopla.co.uk/new-homes/property/${encodeURIComponent(clean)}/`
      : `https://www.zoopla.co.uk/for-sale/property/${encodeURIComponent(clean)}/`;

    switch (s.propertyType) {
      case "D":
        path = isNewHomes
          ? `https://www.zoopla.co.uk/new-homes/houses/${encodeURIComponent(clean)}/`
          : `https://www.zoopla.co.uk/for-sale/houses/${encodeURIComponent(clean)}/`;
        params.set("property_sub_type", "detached");
        break;
      case "S":
        path = isNewHomes
          ? `https://www.zoopla.co.uk/new-homes/houses/${encodeURIComponent(clean)}/`
          : `https://www.zoopla.co.uk/for-sale/houses/${encodeURIComponent(clean)}/`;
        params.set("property_sub_type", "semi_detached");
        break;
      case "T":
        path = isNewHomes
          ? `https://www.zoopla.co.uk/new-homes/houses/${encodeURIComponent(clean)}/`
          : `https://www.zoopla.co.uk/for-sale/houses/${encodeURIComponent(clean)}/`;
        params.set("property_sub_type", "terraced");
        break;
      case "F":
        path = isNewHomes
          ? `https://www.zoopla.co.uk/new-homes/flats/${encodeURIComponent(clean)}/`
          : `https://www.zoopla.co.uk/for-sale/flats/${encodeURIComponent(clean)}/`;
        break;
      default:
        break;
    }

    if (s.newBuild === "N") params.set("new_homes", "exclude");
    if (maxPrice && Number.isFinite(maxPrice)) {
      params.set("price_max", String(Math.round(maxPrice)));
    }

    return `${path}?${params.toString()}`;
  };

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
            attribution: "(c) OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-1.5, 53.5],
      zoom: 5,
      minZoom: 4,
      maxZoom: 16,
    });

    const emitZoom = () => {
      onZoomChangeRef.current?.(map.getZoom());
    };
    map.on("zoomend", emitZoom);

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", async () => {
      emitZoom();
      map.addSource("cells", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("flood-overlay", {
    type: "geojson",
    data: "/api/flood?plain=1",
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 50,
  });

  map.addLayer({
    id: "flood-overlay-clusters",
    type: "circle",
    source: "flood-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.floodOverlayMode && stateRef.current.floodOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "rgba(103,232,249,0.55)",
        100,
        "rgba(14,165,233,0.7)",
        1000,
        "rgba(2,132,199,0.85)",
      ] as any,
      "circle-radius": [
        "step",
        ["get", "point_count"],
        16,
        100,
        22,
        1000,
        30,
      ] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "flood-overlay-cluster-count",
    type: "symbol",
    source: "flood-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.floodOverlayMode && stateRef.current.floodOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: {
      "text-color": "rgba(255,255,255,0.95)",
    },
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
    id: "flood-overlay-fill",
    type: "fill",
    source: "flood-overlay",
    filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]] as any,
    layout: {
      visibility: stateRef.current.floodOverlayMode && stateRef.current.floodOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "fill-color": floodBandColorExpression(),
      "fill-opacity": ["interpolate", ["linear"], floodSeverityExpression(), 0, 0.03, 4, 0.12] as any,
    },
  });

  map.addLayer({
    id: "flood-overlay-outline",
    type: "line",
    source: "flood-overlay",
    filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]] as any,
    layout: {
      visibility: stateRef.current.floodOverlayMode && stateRef.current.floodOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "line-color": floodBandColorExpression(),
      "line-width": ["interpolate", ["linear"], floodSeverityExpression(), 0, 0.8, 4, 1.8] as any,
      "line-dasharray": [1, 1.5],
      "line-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "flood-overlay-points",
    type: "circle",
    source: "flood-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.floodOverlayMode && stateRef.current.floodOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "match",
        ["round", floodSeverityExpression()],
        0,
        "#22c55e",
        1,
        "#3b82f6",
        2,
        "#1d4ed8",
        3,
        "#f59e0b",
        4,
        "#dc2626",
        "#22c55e",
      ] as any,
      "circle-opacity": ["interpolate", ["linear"], floodSeverityExpression(), 0, 0.55, 4, 0.95] as any,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.4, 6, 5.5, 8, 8.5, 10, 12.5] as any,
      "circle-stroke-color": "rgba(255,255,255,0.95)",
      "circle-stroke-width": 1,
      "circle-blur": 0.03,
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
      "text-field": "x",
      "text-size": 24,
      "text-anchor": "center",
      "text-offset": [0, 0],
    },
    paint: {
      "text-color": "rgba(100, 100, 100, 0.7)",
    },
    filter: ["==", ["get", "tx_count"], 0],
  });

  applyValueFilter(map, stateRef.current);

  // Add hover tooltip (after layers exist)
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
  });

  const useFloodPopupMode = () => {
    const current = stateRef.current;
    return current.floodOverlayMode === "on_hide_cells" && map.getZoom() >= 10;
  };

  const riskLabelFromScore = (score: number) => {
    if (score >= 4) return "High";
    if (score >= 3) return "Medium";
    if (score >= 2) return "Low";
    if (score >= 1) return "Very low";
    return "None";
  };

  const showFloodPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;

    const p = f.properties || {};
    const postcode = String(p.postcode ?? p.postcode_key ?? "Unknown postcode");
    const riskScore = Number(p.risk_score ?? 0);
    const riskBandRaw = String(p.risk_band ?? "").trim();
    const riskBand = riskBandRaw ? riskBandRaw : riskLabelFromScore(riskScore);

    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">${postcode}</div>
        <div>Flood risk: <b>${riskBand}</b></div>
        <div>Score: <b>${riskScore}</b></div>
      </div>
    `;

    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showFloodClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">Flood cluster</div>
        <div>Postcodes in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity: 0.8; margin-top: 2px;">Zoom in for postcode-level points.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  map.on("mousemove", "flood-overlay-points", (e) => {
    if (!useFloodPopupMode()) return;
    map.getCanvas().style.cursor = "pointer";
    showFloodPointPopup(e);
  });

  map.on("mouseleave", "flood-overlay-points", () => {
    if (!useFloodPopupMode()) return;
    map.getCanvas().style.cursor = "";
    popup.remove();
  });

  map.on("mousemove", "flood-overlay-clusters", (e) => {
    if (!useFloodPopupMode()) return;
    map.getCanvas().style.cursor = "pointer";
    showFloodClusterPopup(e);
  });

  map.on("mouseleave", "flood-overlay-clusters", () => {
    if (!useFloodPopupMode()) return;
    map.getCanvas().style.cursor = "";
    popup.remove();
  });

  map.on("mousemove", "flood-overlay-cluster-count", (e) => {
    if (!useFloodPopupMode()) return;
    map.getCanvas().style.cursor = "pointer";
    showFloodClusterPopup(e);
  });

  map.on("mouseleave", "flood-overlay-cluster-count", () => {
    if (!useFloodPopupMode()) return;
    map.getCanvas().style.cursor = "";
    popup.remove();
  });

  map.on("mousemove", "cells-fill", (e) => {
    if (useFloodPopupMode()) {
      popup.remove();
      return;
    }

    map.getCanvas().style.cursor = "pointer";

    const f = e.features?.[0] as any;
    if (!f) return;

    const p = f.properties || {};
    const median = Number(p.median ?? 0);
    const tx = Number(p.tx_count ?? 0);
    const dg = Number(p.delta_gbp ?? 0);
    const dp = Number(p.delta_pct ?? 0);

    // Show delta popup only if we're actually looking at delta data (deltas are non-zero)
    let html = "";
    if ((dg !== 0 || dp !== 0) && median === 0) {
      const sign = dg > 0 ? "+" : dg < 0 ? "-" : "";
      html = `
        <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
          <div style="font-weight: 700; margin-bottom: 4px;">${sign}GBP ${Math.abs(dg).toLocaleString()}</div>
          <div>Change %: <b>${dp.toFixed(1)}%</b></div>
          <div>Sales sample: <b>${tx}</b></div>
        </div>
      `;
    } else {
      html = `
        <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
          <div style="font-weight: 700; margin-bottom: 4px;">GBP ${median.toLocaleString()}</div>
          <div>Sales sample: <b>${tx}</b></div>
        </div>
      `;
    }

    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  map.on("mouseleave", "cells-fill", () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
  });

  const fetchPostcodes = async (gx: number, gy: number, offset: number, append: boolean) => {
    setPostcodeLoading(true);
    setPostcodeError(null);
    setPostcodeCell(`${gx}_${gy}`);
    try {
      const qs = new URLSearchParams({
        grid: stateRef.current.grid,
        gx: String(gx),
        gy: String(gy),
        limit: "10",
        offset: String(offset),
      });
      const res = await fetch(`/api/postcodes?${qs.toString()}`);
      if (!res.ok) {
        let msg = `Failed to load postcodes (${res.status})`;
        try {
          const err = (await res.json()) as { message?: string };
          if (err?.message) msg = `${msg}: ${err.message}`;
        } catch (e) {
          // ignore
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as { postcodes?: unknown; total?: unknown };
      const items = Array.isArray(data.postcodes) ? (data.postcodes as string[]) : [];
      const total = Number(data.total ?? items.length);
      setPostcodeTotal(total);
      setPostcodeOffset(offset);
      setPostcodeItems((prev) => (append ? [...prev, ...items] : items));
    } catch (e: any) {
      setPostcodeError(e?.message || "Failed to load postcodes");
    } finally {
      setPostcodeLoading(false);
    }
  };
  fetchPostcodesRef.current = fetchPostcodes;

  map.on("click", "cells-fill", (e) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const gx = Number(f.properties?.gx);
    const gy = Number(f.properties?.gy);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
    const median = Number(f.properties?.median);
    if (Number.isFinite(median)) {
      setPostcodeMaxPrice(median * 1.25);
    } else {
      setPostcodeMaxPrice(null);
    }
    // Subtle Scotland caveat when clicking northern cells (Gretna ~331900, 568300)
    if (gy >= 568300) {
      setScotlandNote("Scotland data coverage is partial and may be 1–2 years out of date.");
    } else {
      setScotlandNote(null);
    }
    void fetchPostcodesRef.current(gx, gy, 0, false);
  });

  // Initial real data load
  await setRealData(map, state, geoCacheRef.current, undefined, onLegendChange);
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

    const abortController = new AbortController();
    const seq = ++requestSeqRef.current;
    setIsLoading(true);

    const debounceMs = 200;
    const timeoutId = setTimeout(() => {
      setRealData(map, state, geoCacheRef.current, abortController.signal, onLegendChange)
        .then(() => {
          if (requestSeqRef.current === seq) setIsLoading(false);
        })
        .catch((e) => {
          if (e.name !== "AbortError") {
            console.error("setRealData failed", e);
          }
          if (requestSeqRef.current === seq) setIsLoading(false);
        });
    }, debounceMs);

    // Cleanup: abort in-flight request if component unmounts or state changes again
    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
      if (requestSeqRef.current === seq) setIsLoading(false);
    };
  }, [state.grid, state.propertyType, state.newBuild, state.endMonth, state.metric]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("load", () => applyValueFilter(map, stateRef.current));
      return;
    }

    applyValueFilter(map, state);
  }, [state.metric, state.valueFilterMode, state.valueThreshold]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    const mode = state.floodOverlayMode ?? "off";
    const floodVisibility = mode === "off" ? "none" : "visible";
    const hideCellsMode = mode === "on_hide_cells";
    try {
      if (map.getLayer("flood-overlay-fill")) {
        map.setLayoutProperty("flood-overlay-fill", "visibility", floodVisibility);
      }
      if (map.getLayer("flood-overlay-outline")) {
        map.setLayoutProperty("flood-overlay-outline", "visibility", floodVisibility);
      }
      if (map.getLayer("flood-overlay-points")) {
        map.setLayoutProperty("flood-overlay-points", "visibility", floodVisibility);
      }
      if (map.getLayer("flood-overlay-clusters")) {
        map.setLayoutProperty("flood-overlay-clusters", "visibility", floodVisibility);
      }
      if (map.getLayer("flood-overlay-cluster-count")) {
        map.setLayoutProperty("flood-overlay-cluster-count", "visibility", floodVisibility);
      }
      if (map.getLayer("cells-fill")) {
        map.setLayoutProperty("cells-fill", "visibility", "visible");
        map.setPaintProperty("cells-fill", "fill-opacity", hideCellsMode ? 0.09 : 0.42);
      }
      if (map.getLayer("cells-outline")) {
        map.setLayoutProperty("cells-outline", "visibility", "visible");
        map.setPaintProperty("cells-outline", "line-opacity", hideCellsMode ? 0.22 : 1);
      }
      if (map.getLayer("cells-no-sales")) {
        map.setLayoutProperty("cells-no-sales", "visibility", "visible");
        map.setPaintProperty("cells-no-sales", "text-opacity", hideCellsMode ? 0.2 : 1);
      }
    } catch (e) {
      // ignore
    }
  }, [state.floodOverlayMode]);

  // Note: metric changes already trigger setRealData (via deps below).
  // Avoid a separate recolor effect to prevent stale data/legend during rapid filter changes.

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {isLoading && (
        <div
          className="map-loading"
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            zIndex: 3,
        }}
      >
        Loading...
      </div>
      )}
      <div
        id="median-overlay"
        className="median-overlay"
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
      {postcodeCell && (
        <div
          className="postcode-wrap"
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 3,
            maxWidth: 300,
          }}
        >
          <div
            className="postcode-panel"
            style={{
              background: "rgba(10, 12, 20, 0.92)",
              color: "white",
              padding: "10px 12px",
              borderRadius: 10,
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              fontSize: 12,
            }}
          >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
            <div style={{ fontWeight: 600 }}>Postcode areas</div>
            <button
              type="button"
              onClick={() => {
                setPostcodeCell(null);
                setPostcodeItems([]);
                setPostcodeTotal(0);
                setPostcodeOffset(0);
                setPostcodeError(null);
                setScotlandNote(null);
              }}
              style={{
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.7)",
                fontSize: 12,
              }}
            >
              Close
            </button>
          </div>
          {postcodeError && <div style={{ color: "#ff9999" }}>{postcodeError}</div>}
          {scotlandNote && (
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 6 }}>
              {scotlandNote}
            </div>
          )}
          {!postcodeError && (
            <>
              {postcodeLoading && postcodeItems.length === 0 && <div>Loading...</div>}
          {postcodeItems.length === 0 && !postcodeLoading && <div>No postcode areas found.</div>}
              {postcodeItems.length > 0 && (
                <>
                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
                    Click a postcode to open Zoopla (shows properties around this price or less; editable there).
                  </div>
                  <div
                    className="postcode-list"
                    style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflow: "auto" }}
                  >
                    {postcodeItems.map((pc, i) => {
                      const href = buildZooplaHref(pc, postcodeMaxPrice);
                      return (
                        <a
                          key={`${pc}-${i}`}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 8px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.14)",
                            color: "white",
                            textDecoration: "none",
                            fontSize: 12,
                          }}
                        >
                          {pc}
                        </a>
                      );
                    })}
                  </div>
                </>
              )}
              {postcodeItems.length < postcodeTotal && (
                <button
                  type="button"
                  onClick={() => {
                    const [gx, gy] = (postcodeCell ?? "").split("_").map(Number);
                    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
                    void fetchPostcodesRef.current(gx, gy, postcodeOffset + 10, true);
                  }}
                  style={{
                    marginTop: 8,
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    padding: "6px 8px",
                    borderRadius: 6,
                    fontSize: 12,
                    width: "100%",
                  }}
                  disabled={postcodeLoading}
                >
                  {postcodeLoading ? "Loading..." : "Show more"}
                </button>
              )}
            </>
          )}
          </div>
          <a
            href="https://buymeacoffee.com/chrandalf"
            target="_blank"
            rel="noreferrer"
            aria-label="Buy me a coffee"
            title="Buy me a coffee"
            style={{
              alignSelf: "flex-start",
              height: 24,
              padding: "0 9px 0 7px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(10, 12, 20, 0.92)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white",
              textDecoration: "none",
              fontSize: 10,
              lineHeight: 1,
              letterSpacing: 0.2,
              whiteSpace: "nowrap",
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
              focusable="false"
              fill="currentColor"
            >
              <path d="M5 6h10a0 0 0 0 1 0 0v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V6Zm10 1h1.5a2.5 2.5 0 1 1 0 5H15V7Zm-8 2h6v3H7V9Zm1 9h6a3 3 0 0 0 3-3v-1h-1.5a3.5 3.5 0 1 0 0-7H5v4a3 3 0 0 0 3 3Z" />
              <path d="M6 5h8v1H6V5Z" />
            </svg>
            <span>buy me a coffee?</span>
          </a>
        </div>
      )}
    </div>
  );
}

/** ---------------- Real data wiring ---------------- */

function floodSeverityExpression() {
  return [
    "coalesce",
    ["to-number", ["get", "risk_score"]],
    [
      "match",
      ["downcase", ["to-string", ["get", "risk_band"]]],
      "high",
      4,
      "medium",
      3,
      "med",
      3,
      "low",
      2,
      "very low",
      1,
      "none",
      0,
      [
        "match",
        ["downcase", ["to-string", ["get", "severity"]]],
        "high",
        4,
        "medium",
        3,
        "med",
        3,
        "low",
        2,
        0,
      ],
    ],
    0,
  ] as any;
}

function floodBandColorExpression() {
  return [
    "match",
    ["round", floodSeverityExpression()],
    0,
    "#22c55e",
    1,
    "#3b82f6",
    2,
    "#1d4ed8",
    3,
    "#f59e0b",
    4,
    "#dc2626",
    "#22c55e",
  ] as any;
}

async function setRealData(
  map: maplibregl.Map,
  state: MapState,
  cache: Map<string, any>,
  signal?: AbortSignal,
  onLegendChange?: (legend: LegendData | null) => void
) {
  // Determine if we're fetching delta or regular data
  const isDelta = state.metric === "delta_gbp" || state.metric === "delta_pct";
  const endpoint = isDelta ? "/api/deltas" : "/api/cells";

  const endMonth = isDelta ? undefined : state.endMonth ?? "LATEST";
  const cacheKey = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth ?? "LATEST"}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    const src = map.getSource("cells") as maplibregl.GeoJSONSource;
    src.setData(cached);
    await ensureAggregatesAndUpdate(map, state, cache, onLegendChange);
    return;
  }

  // Clear stale data while fetching to avoid showing wrong colors/legend
  try {
    const src = map.getSource("cells") as maplibregl.GeoJSONSource;
    src.setData({ type: "FeatureCollection", features: [] } as any);
  } catch (e) {
    // ignore
  }
  if (onLegendChange) onLegendChange(null);

  const qs = new URLSearchParams({
    grid: state.grid,
    propertyType: state.propertyType ?? "ALL",
    newBuild: state.newBuild ?? "ALL",
  });
  
  // Only add endMonth for non-delta requests
  if (!isDelta) {
    qs.set("endMonth", endMonth!);
  }

  const res = await fetch(`${endpoint}?${qs.toString()}`, { signal });
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
  await ensureAggregatesAndUpdate(map, state, cache, onLegendChange);
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

const QUANTILE_PROBS = [0,0.01,0.02,0.03,0.04,0.05,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.95,0.96,0.97,0.98,0.99,1];
const DELTA_COLORS = ["#4a0080", "#d73027", "#f46d43", "#f7f7f7", "#1a9850", "#238b45", "#08519c"];
const DELTA_STOP_WEIGHTS = [-1, -0.5, -0.2, 0, 0.2, 0.5, 1];

async function ensureAggregatesAndUpdate(
  map: maplibregl.Map,
  state: MapState,
  cache: Map<string, any>,
  onLegendChange?: (legend: LegendData | null) => void
) {
  try {
    // For delta metrics, apply simple linear color mapping (quantiles can be complex with diverging data)
    const isDelta = state.metric === "delta_gbp" || state.metric === "delta_pct";
    if (isDelta) {
      const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
      const srcData: any = src ? (src as any)._data ?? null : null;
      const stats = computeMinMax(srcData, state.metric as "delta_gbp" | "delta_pct");
      const fallbackMaxAbs = state.metric === "delta_pct" ? 30 : 300000;
      const maxAbs = stats ? Math.max(Math.abs(stats.min), Math.abs(stats.max)) : 0;
      const safeMaxAbs = maxAbs > 0 ? maxAbs : fallbackMaxAbs;
      const stops = buildDeltaStops(safeMaxAbs);
      const colors = DELTA_COLORS;
      const expr = buildDeltaColorExpression(state.metric, stops, colors);

      if (map.getLayer("cells-fill")) {
        map.setPaintProperty("cells-fill", "fill-color", expr);
      }
      if (onLegendChange) {
        const min = stats ? stats.min : -safeMaxAbs;
        const max = stats ? stats.max : safeMaxAbs;
        onLegendChange({
          kind: "delta",
          metric: state.metric as "delta_gbp" | "delta_pct",
          min,
          max,
          maxAbs: safeMaxAbs,
          stops,
          colors,
        });
      }
      return;
    }

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

    // 3) compute quantile breaks from the current-grid aggregate (or fallback to 25km)
    try {
      let breaks: number[] | null = null;
      const sourceFc = fcCur || fc25;
      if (sourceFc) breaks = computeWeightedQuantiles(sourceFc, state.metric, QUANTILE_PROBS);

      if (breaks && breaks.length > 0 && breaks.every((v) => Number.isFinite(v)) && hasVariance(breaks)) {
        const colors = makeTailColors();
        const expr = buildTailColorExpression(state.metric, breaks, colors, true);
        if (map.getLayer("cells-fill")) {
          map.setPaintProperty("cells-fill", "fill-color", expr);
        }
        if (onLegendChange) {
          onLegendChange({ kind: "median", breaks, colors, probs: QUANTILE_PROBS });
        }
      } else {
        const colors = makeTailColors();
        const stats = computeMinMax(sourceFc, "median");
        if (stats) {
          const linearBreaks = buildLinearBreaks(stats.min, stats.max, QUANTILE_PROBS.length);
          const expr = buildTailColorExpression("median", linearBreaks, colors, true);
          if (map.getLayer("cells-fill")) {
            map.setPaintProperty("cells-fill", "fill-color", expr);
          }
          if (onLegendChange) {
            onLegendChange({ kind: "median", breaks: linearBreaks, colors, probs: QUANTILE_PROBS });
          }
        } else if (onLegendChange) {
          onLegendChange(null);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to apply quantile colour mapping', e);
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

function computeMinMax(fc: any, metric: "median" | "delta_gbp" | "delta_pct") {
  const features = (fc?.features ?? []) as any[];
  let min = Infinity;
  let max = -Infinity;

  for (const f of features) {
    const p = f.properties || {};
    const raw = Number(p[metric] ?? NaN);
    if (!isFinite(raw)) continue;
    if (raw < min) min = raw;
    if (raw > max) max = raw;
  }

  if (!isFinite(min) || !isFinite(max)) return null;
  return { min, max };
}

function buildLinearBreaks(min: number, max: number, count: number) {
  if (!isFinite(min) || !isFinite(max) || count <= 1) return [min, max];
  if (min === max) return Array.from({ length: count }, () => min);
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

function hasVariance(breaks: number[]) {
  if (breaks.length < 2) return false;
  const min = Math.min(...breaks);
  const max = Math.max(...breaks);
  return max > min;
}
function buildDeltaStops(maxAbs: number) {
  return DELTA_STOP_WEIGHTS.map((w) => w * maxAbs);
}

function buildDeltaColorExpression(metric: string, stops: number[], colors: string[]) {
  const expr: any[] = ["interpolate", ["linear"], ["get", metric]];
  for (let i = 0; i < stops.length && i < colors.length; i++) {
    expr.push(stops[i]);
    expr.push(colors[i]);
  }
  return expr as any;
}

function buildTailColorExpression(metric: string, breaks: number[], colors: string[], useLog = false) {
  // build a step expression: start with color for values < first threshold
  const input = useLog ? ["ln", ["max", ["get", metric], 1]] : ["get", metric];
  const expr: any[] = ["step", input, colors[0]];
  // push threshold,value pairs for remaining colors
  for (let i = 1; i < breaks.length && i < colors.length; i++) {
    const value = useLog ? Math.log(Math.max(breaks[i], 1)) : breaks[i];
    expr.push(value);
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
      html = `<div style="font-weight:700">Weighted median: GBP ${avg.toLocaleString()}</div>`;
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

function buildValueFilter(state: MapState) {
  const mode = state.valueFilterMode ?? "off";
  const threshold = state.valueThreshold;
  if (mode === "off" || !Number.isFinite(threshold)) return null;
  const op = mode === "lte" ? "<=" : ">=";

  const prop =
    state.metric === "median"
      ? "median"
      : state.metric === "delta_gbp"
        ? "delta_gbp"
        : "delta_pct";

  // Coalesce missing values to 0 so the filter behaves deterministically.
  return [op, ["coalesce", ["get", prop], 0], threshold] as any;
}

function applyValueFilter(map: maplibregl.Map, state: MapState) {
  const valueFilter = buildValueFilter(state);
  if (map.getLayer("cells-fill")) {
    map.setFilter("cells-fill", valueFilter as any);
  }
  if (map.getLayer("cells-outline")) {
    map.setFilter("cells-outline", valueFilter as any);
  }
  if (map.getLayer("cells-no-sales")) {
    const noSalesBase: any = ["==", ["get", "tx_count"], 0];
    const noSalesFilter = valueFilter ? (["all", noSalesBase, valueFilter] as any) : noSalesBase;
    map.setFilter("cells-no-sales", noSalesFilter as any);
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
      -300000, "#4a0080", // extreme reduction: dark purple
      -150000, "#d73027", // reduction: red
      -50000,  "#f46d43", // mild reduction: light red
      0,       "#f7f7f7", // neutral: off-white
      50000,   "#1a9850", // increase: green
      150000,  "#238b45", // more increase: darker green
      300000,  "#08519c", // extreme increase: dark blue
    ] as any;
  }

  return [
    "interpolate", ["linear"], ["get", "delta_pct"],
    -30, "#4a0080", // extreme reduction: dark purple
    -15, "#d73027", // reduction: red
    -5,  "#f46d43", // mild reduction: light red
    0,   "#f7f7f7", // neutral: off-white
    5,   "#1a9850", // increase: green
    15,  "#238b45", // more increase: darker green
    30,  "#08519c", // extreme increase: dark blue
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





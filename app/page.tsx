"use client";

import { useEffect, useRef, useState } from "react";
import ValueMap, { type LegendData, type LocateMeResult } from "./Map";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "delta_gbp" | "delta_pct";
type PropertyType = "ALL" | "D" | "S" | "T" | "F"; // Detached / Semi / Terraced / Flat
type NewBuild = "ALL" | "Y" | "N";
type ValueFilterMode = "off" | "lte" | "gte";
type FloodOverlayMode = "off" | "on" | "on_hide_cells";
type GridMode = "auto" | "manual";

type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: PropertyType;
  newBuild: NewBuild;
  endMonth?: string;
  valueFilterMode: ValueFilterMode;
  valueThreshold: number;
  floodOverlayMode: FloodOverlayMode;
};

type OutcodeRank = {
  outcode: string;
  median: number;
  weight: number;
};

const METRIC_LABEL: Record<Metric, string> = {
  median: "Median",
  delta_gbp: "Change (GBP)",
  delta_pct: "Change (%)",
};

const PROPERTY_LABEL: Record<PropertyType, string> = {
  ALL: "All",
  D: "Detached",
  S: "Semi",
  T: "Terraced",
  F: "Flat",
};

const NEWBUILD_LABEL: Record<NewBuild, string> = {
  ALL: "All",
  Y: "New",
  N: "Existing",
};

const PERIOD_LABEL: Record<string, string> = {
  "2025-12-01": "Dec 2025",
  "2024-12-01": "Dec 2024",
  "2023-12-01": "Dec 2023",
  "2022-12-01": "Dec 2022",
  "2021-12-01": "Dec 2021",
};

export default function Home() {
  const [state, setState] = useState<MapState>({
    grid: "5km",
    metric: "median",
    propertyType: "ALL",
    newBuild: "ALL",
    endMonth: "2025-12-01",
    valueFilterMode: "off",
    valueThreshold: 300000,
    floodOverlayMode: "off",
  });
  const [legend, setLegend] = useState<LegendData | null>(null);
  const medianLegend =
    state.metric === "median" && legend && legend.kind === "median" ? legend : null;
  const deltaLegend =
    state.metric !== "median" && legend && legend.kind === "delta" && legend.metric === state.metric
      ? legend
      : null;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsPage, setInstructionsPage] = useState(1);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionPage, setDescriptionPage] = useState(1);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [nextStepsOpen, setNextStepsOpen] = useState(false);
  const [postcodeOpen, setPostcodeOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [outcodeTop, setOutcodeTop] = useState<OutcodeRank[]>([]);
  const [outcodeBottom, setOutcodeBottom] = useState<OutcodeRank[]>([]);
  const [outcodeLoading, setOutcodeLoading] = useState(false);
  const [outcodeError, setOutcodeError] = useState<string | null>(null);
  const [outcodeMode, setOutcodeMode] = useState<"top" | "bottom">("bottom");
  const [outcodeLimit, setOutcodeLimit] = useState(3);
  const [overlayPanelCollapsed, setOverlayPanelCollapsed] = useState(false);
  const [valuePanelCollapsed, setValuePanelCollapsed] = useState(false);
  const [postcodeSearch, setPostcodeSearch] = useState("");
  const [postcodeSearchToken, setPostcodeSearchToken] = useState(0);
  const [postcodeSearchStatus, setPostcodeSearchStatus] = useState<string | null>(null);
  const [locateMeToken, setLocateMeToken] = useState(0);
  const [locateMeStatus, setLocateMeStatus] = useState<string | null>(null);
  const [locateMeSummary, setLocateMeSummary] = useState<string | null>(null);
  const [supporterNames, setSupporterNames] = useState<string[]>([]);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [gridMode, setGridMode] = useState<GridMode>("manual");
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  const urlHydratedRef = useRef(false);
  const supportersScrollerRef = useRef<HTMLDivElement | null>(null);

  const anySubpanelOpen = filtersOpen || instructionsOpen || descriptionOpen || dataSourcesOpen || nextStepsOpen;
  const DEFAULT_STATE: MapState = {
    grid: "5km",
    metric: "median",
    propertyType: "ALL",
    newBuild: "ALL",
    endMonth: "2025-12-01",
    valueFilterMode: "off",
    valueThreshold: 300000,
    floodOverlayMode: "off",
  };
  const closeAllSubpanels = () => {
    setFiltersOpen(false);
    setInstructionsOpen(false);
    setDescriptionOpen(false);
    setDataSourcesOpen(false);
    setNextStepsOpen(false);
  };
  const resetAll = () => {
    setState(DEFAULT_STATE);
    setLegendOpen(true);
    closeAllSubpanels();
    setMenuOpen(true);
  };

  const scrollSupportersRight = () => {
    const el = supportersScrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: 180, behavior: "smooth" });
  };

  const formatLegendCurrency = (value: number) => {
    if (!Number.isFinite(value)) return "N/A";
    const rounded = Math.round(value);
    if (Math.abs(rounded) >= 1000) {
      return `${Math.round(rounded / 1000)}k`;
    }
    return `${rounded}`;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    setIsMobileViewport(isMobile);
    if (isMobile) {
      setFiltersOpen(false);
      setOverlayPanelCollapsed(true);
      setValuePanelCollapsed(true);
      setGridMode("manual");
    }
  }, []);

  const autoGridForZoom = (zoom: number, metric: Metric): GridSize => {
    if (zoom >= 8.2) return metric === "median" ? "1km" : "5km";
    if (zoom >= 7.0) return "5km";
    if (zoom >= 5.6) return "10km";
    return "25km";
  };

  const handleMapZoomChange = (zoom: number) => {
    setMapZoom(zoom);
    if (!isMobileViewport) return;
    if (gridMode !== "auto") return;
    setState((s) => {
      const nextGrid = autoGridForZoom(zoom, s.metric);
      if (nextGrid === s.grid) return s;
      return { ...s, grid: nextGrid };
    });
  };

  useEffect(() => {
    if (!isMobileViewport || gridMode !== "auto") return;
    if (state.metric !== "median" && state.grid === "1km") {
      setState((s) => ({ ...s, grid: "5km" }));
    }
  }, [isMobileViewport, gridMode, state.metric, state.grid]);

  useEffect(() => {
    if (!isMobileViewport || gridMode !== "auto") return;
    if (mapZoom == null) return;
    setState((s) => {
      const nextGrid = autoGridForZoom(mapZoom, s.metric);
      if (nextGrid === s.grid) return s;
      return { ...s, grid: nextGrid };
    });
  }, [isMobileViewport, gridMode, mapZoom, state.metric]);

  useEffect(() => {
    const controller = new AbortController();
    const loadSupporters = async () => {
      try {
        const res = await fetch("/api/supporters?limit=10", { signal: controller.signal });
        if (!res.ok) return;
        const payload = (await res.json()) as { items?: string[] };
        const items = Array.isArray(payload.items) ? payload.items : [];
        const sortedItems = [...items].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" })
        );
        setSupporterNames(sortedItems);
      } catch {
        // ignore optional supporters feed failures
      }
    };
    void loadSupporters();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    urlHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlHydratedRef.current) return;

    const params = new URLSearchParams();
    params.set("grid", state.grid);
    params.set("metric", state.metric);
    params.set("type", state.propertyType);
    params.set("newBuild", state.newBuild);
    params.set("period", state.endMonth ?? "2025-12-01");
    params.set("vfm", state.valueFilterMode);
    params.set("vth", String(Math.round(state.valueThreshold * 10) / 10));
    params.set("flood", state.floodOverlayMode);

    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", nextUrl);
  }, [state]);

  useEffect(() => {
    if (state.metric !== "median") {
      setOutcodeTop([]);
      setOutcodeBottom([]);
      setOutcodeError(null);
      setOutcodeLoading(false);
      return;
    }

    const controller = new AbortController();
    const fetchOutcodes = async () => {
      setOutcodeLoading(true);
      setOutcodeError(null);
      try {
        const params = new URLSearchParams({
          grid: state.grid,
          propertyType: state.propertyType,
          newBuild: state.newBuild,
          endMonth: state.endMonth ?? "LATEST",
        });
        const res = await fetch(`/api/outcodes?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Failed to load postcode ranks (${res.status})`);
        }
        const data = (await res.json()) as { top?: OutcodeRank[]; bottom?: OutcodeRank[] };
        setOutcodeTop(Array.isArray(data.top) ? data.top : []);
        setOutcodeBottom(Array.isArray(data.bottom) ? data.bottom : []);
      } catch (e: any) {
        if (e.name === "AbortError") return;
        setOutcodeError(e?.message ?? "Failed to load postcode ranks");
      } finally {
        setOutcodeLoading(false);
      }
    };

    void fetchOutcodes();
    return () => controller.abort();
  }, [state.grid, state.propertyType, state.newBuild, state.endMonth, state.metric]);

  const legendContent = (
    <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 12, fontSize: 16, opacity: 0.9 }}>
        {state.metric === "median" ? "Median house price" : `${METRIC_LABEL[state.metric]} Scale`}
      </div>
      {state.metric === "median" && (
        <>
          {!medianLegend && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>Loading scale...</div>
          )}
          {medianLegend && (
            <>
              <div className="legend-range" style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px", gap: 8, alignItems: "center" }}>
                <div style={{ textAlign: "left", fontSize: 12, opacity: 0.75 }}>
                  {formatLegendCurrency(medianLegend.breaks[0])}
                </div>
                <div className="legend-bars" style={{ display: "flex", height: 50, gap: 3 }}>
                  {medianLegend.colors.map((c, i) => (
                    <div key={i} style={{ flex: 1, backgroundColor: c, borderRadius: 3 }} />
                  ))}
                </div>
                <div style={{ textAlign: "right", fontSize: 12, opacity: 0.75 }}>
                  {formatLegendCurrency(medianLegend.breaks[medianLegend.breaks.length - 1])}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {state.metric !== "median" && (
        <>
          {!deltaLegend && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>Loading scale...</div>
          )}
          {deltaLegend && (
            <>
              <div className="legend-range" style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px", gap: 8, alignItems: "center" }}>
                <div style={{ textAlign: "left", fontSize: 12, opacity: 0.75 }}>
                  {formatDeltaValue(state.metric, deltaLegend.stops[0])}
                </div>
                <div className="legend-bars" style={{ display: "flex", height: 50, gap: 3, minWidth: 240 }}>
                  {deltaLegend.colors.map((c, i) => (
                    <div key={i} style={{ flex: 1, backgroundColor: c, borderRadius: 3 }} />
                  ))}
                </div>
                <div style={{ textAlign: "right", fontSize: 12, opacity: 0.75 }}>
                  {formatDeltaValue(state.metric, deltaLegend.stops[deltaLegend.stops.length - 1])}
                </div>
              </div>
              <div className="legend-sub" style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px", marginTop: 6 }}>
                <div />
                <div style={{ textAlign: "center", fontSize: 11, opacity: 0.75 }}>
                  {state.metric === "delta_pct" ? "0%" : "0"}
                </div>
                <div />
              </div>
            </>
          )}
        </>
      )}
    </>
  );

  const formatOutcodeCurrency = (value: number) => {
    if (!Number.isFinite(value)) return "N/A";
    return `£${formatLegendCurrency(value)}`;
  };

  const formatFilterValue = (value: number) => `£${formatLegendCurrency(value)}`;

  const periodLabel = PERIOD_LABEL[state.endMonth ?? "2025-12-01"] ?? (state.endMonth ?? "LATEST");

  const formatSignedPounds = (value: number) => {
    if (!Number.isFinite(value)) return "N/A";
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}£${Math.round(Math.abs(value)).toLocaleString()}`;
  };
  const formatSignedPercent = (value: number) => {
    if (!Number.isFinite(value)) return "N/A";
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(1)}%`;
  };

  const handleLocateMeResult = (result: LocateMeResult) => {
    if (result.status !== "success") {
      setLocateMeStatus(result.message);
      setLocateMeSummary(null);
      return;
    }

    const chunks: string[] = [];
    if (result.accuracyMeters != null) {
      chunks.push(`Accuracy ±${result.accuracyMeters}m`);
    }
    if (result.cell?.median != null && Number.isFinite(result.cell.median)) {
      chunks.push(`Median £${Math.round(result.cell.median).toLocaleString()}`);
    }
    if (result.cell?.txCount != null && Number.isFinite(result.cell.txCount)) {
      chunks.push(`Sales ${Math.round(result.cell.txCount)}`);
    }
    if (result.floodNearest) {
      chunks.push(
        `Nearest flood postcode ${result.floodNearest.postcode} (${result.floodNearest.riskBand}, ${result.floodNearest.distanceMeters}m)`
      );
    }

    setLocateMeStatus("Location found");
    setLocateMeSummary(chunks.join(" · "));
  };

  const formatMetricFilterValue = (metric: Metric, value: number) => {
    if (metric === "median") return formatFilterValue(value);
    return metric === "delta_gbp" ? formatSignedPounds(value) : formatSignedPercent(value);
  };

  const valueFilterLabel =
    state.valueFilterMode === "off"
      ? "Off"
      : `${state.valueFilterMode === "lte" ? "Below" : "Above"} ${formatMetricFilterValue(state.metric, state.valueThreshold)}`;
  const floodOverlayLabel =
    state.floodOverlayMode === "off"
      ? "Off"
      : state.floodOverlayMode === "on"
        ? "On"
        : "On (hide cells)";

  const currentFiltersSummary =
    `Grid: ${state.grid} · Metric: ${METRIC_LABEL[state.metric]} · ` +
    `Type: ${PROPERTY_LABEL[state.propertyType]} · New build: ${NEWBUILD_LABEL[state.newBuild]} · ` +
    `Period: ${periodLabel} · Flood: ${floodOverlayLabel}`;
  const headerFilterSummary =
    `${state.grid} · ${METRIC_LABEL[state.metric]} · ${PROPERTY_LABEL[state.propertyType]} · ${NEWBUILD_LABEL[state.newBuild]} · ${periodLabel}`;

  // Global value-filter scales (stable across other filters), per metric
  const MEDIAN_FILTER_MIN = 50_000;
  const MEDIAN_FILTER_MAX = 3_000_000;
  const DELTA_GBP_FILTER_MAX_ABS = 200_000;
  const DELTA_PCT_FILTER_MAX_ABS = 30;

  const valueFilterMin =
    state.metric === "median"
      ? MEDIAN_FILTER_MIN
      : state.metric === "delta_gbp"
        ? -DELTA_GBP_FILTER_MAX_ABS
        : -DELTA_PCT_FILTER_MAX_ABS;
  const valueFilterMax =
    state.metric === "median"
      ? MEDIAN_FILTER_MAX
      : state.metric === "delta_gbp"
        ? DELTA_GBP_FILTER_MAX_ABS
        : DELTA_PCT_FILTER_MAX_ABS;

  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

  // Slider is logarithmic for median (more resolution at lower values) and
  // signed-power for deltas (more resolution around 0, symmetric).
  const SLIDER_POS_MAX = 1000;

  const posToThreshold = (pos: number) => {
    const p = clamp(pos, 0, SLIDER_POS_MAX);

    if (state.metric === "median") {
      const safeMin = Math.max(1, MEDIAN_FILTER_MIN);
      const safeMax = Math.max(safeMin + 1, MEDIAN_FILTER_MAX);
      const logMin = Math.log(safeMin);
      const logMax = Math.log(safeMax);
      const logRange = Math.max(1e-9, logMax - logMin);
      const t = p / SLIDER_POS_MAX;
      const raw = Math.exp(logMin + logRange * t);
      return Math.round(raw / 1000) * 1000;
    }

    const mid = SLIDER_POS_MAX / 2;
    const x = (p - mid) / mid; // [-1, 1]
    const k = 3;
    const maxAbs = state.metric === "delta_gbp" ? DELTA_GBP_FILTER_MAX_ABS : DELTA_PCT_FILTER_MAX_ABS;
    const raw = Math.sign(x) * Math.pow(Math.abs(x), k) * maxAbs;
    return state.metric === "delta_gbp" ? Math.round(raw / 1000) * 1000 : Math.round(raw * 10) / 10;
  };

  const thresholdToPos = (value: number) => {
    const v = Number.isFinite(value) ? value : 0;

    if (state.metric === "median") {
      const safeMin = Math.max(1, MEDIAN_FILTER_MIN);
      const safeMax = Math.max(safeMin + 1, MEDIAN_FILTER_MAX);
      const logMin = Math.log(safeMin);
      const logMax = Math.log(safeMax);
      const logRange = Math.max(1e-9, logMax - logMin);
      const vv = clamp(v, safeMin, safeMax);
      const t = (Math.log(vv) - logMin) / logRange;
      return Math.round(clamp(t, 0, 1) * SLIDER_POS_MAX);
    }

    const maxAbs = state.metric === "delta_gbp" ? DELTA_GBP_FILTER_MAX_ABS : DELTA_PCT_FILTER_MAX_ABS;
    const vv = clamp(v, -maxAbs, maxAbs);
    const k = 3;
    const t = Math.sign(vv) * Math.pow(Math.abs(vv) / maxAbs, 1 / k);
    const mid = SLIDER_POS_MAX / 2;
    return Math.round((t * mid) + mid);
  };

  useEffect(() => {
    setState((s) => {
      const raw = Number.isFinite(s.valueThreshold) ? s.valueThreshold : 0;

      if (s.metric === "median") {
        const rounded = Math.round(raw / 1000) * 1000;
        const clamped = clamp(rounded, MEDIAN_FILTER_MIN, MEDIAN_FILTER_MAX);
        if (clamped === s.valueThreshold) return s;
        return { ...s, valueThreshold: clamped };
      }

      if (s.metric === "delta_gbp") {
        const maxAbs = DELTA_GBP_FILTER_MAX_ABS;
        const rounded = Math.round(raw / 1000) * 1000;
        const clamped = clamp(rounded, -maxAbs, maxAbs);
        const next = Math.abs(raw) > maxAbs ? 0 : clamped;
        if (next === s.valueThreshold) return s;
        return { ...s, valueThreshold: next };
      }

      const maxAbs = DELTA_PCT_FILTER_MAX_ABS;
      const rounded = Math.round(raw * 10) / 10;
      const clamped = clamp(rounded, -maxAbs, maxAbs);
      const next = Math.abs(raw) > maxAbs ? 0 : clamped;
      if (next === s.valueThreshold) return s;
      return { ...s, valueThreshold: next };
    });
  }, [state.metric]);

  const showOutcodePanel = false;

  return (
    <main style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <Styles />
      <ValueMap
        state={state}
        onLegendChange={setLegend}
        onPostcodePanelChange={setPostcodeOpen}
        onZoomChange={handleMapZoomChange}
        postcodeSearchQuery={postcodeSearch}
        postcodeSearchToken={postcodeSearchToken}
        locateMeToken={locateMeToken}
        onLocateMeResult={handleLocateMeResult}
        onPostcodeSearchResult={(result) => {
          if (result.status === "found") {
            setPostcodeSearchStatus(`Found ${result.matchedPostcode ?? result.normalizedQuery}`);
            return;
          }
          if (result.status === "broad-has-risk") {
            const count = result.hierarchyMatchCount ?? 0;
            setPostcodeSearchStatus(
              `${result.normalizedQuery} is a broader postcode area. ${count.toLocaleString()} flood-risk postcodes found under it${
                result.nearestPostcode ? ` (showing ${result.nearestPostcode})` : ""
              }.`
            );
            return;
          }
          if (result.status === "no-risk-nearest") {
            setPostcodeSearchStatus(
              `No mapped flood-risk postcode found for ${result.normalizedQuery}. Nearest mapped postcode: ${result.nearestPostcode ?? "available"}`
            );
            return;
          }
          if (result.status === "not-found") {
            setPostcodeSearchStatus(`No postcode match found for ${result.normalizedQuery}`);
            return;
          }
          setPostcodeSearchStatus("Postcode search unavailable right now");
        }}
      />

      {/* Top-left product panel */}
      <div
        className="panel"
        data-open={filtersOpen ? "true" : "false"}
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          width: 500,
          maxWidth: "calc(100vw - 36px)",
          padding: 14,
          borderRadius: 14,
          background: "rgba(10, 12, 20, 0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(10px)",
          color: "white",
        }}
      >
        <div className="panel-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="panel-title" style={{ fontSize: 24, fontWeight: 700, marginTop: 2, lineHeight: 1.2 }}>
              UK HOUSE PRICE GRID{" "}
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75, verticalAlign: "middle" }}>
                v0.1
              </span>
            </div>
            <div className="panel-byline" style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
              by Chris Randall
            </div>
          </div>
        </div>
        <div
          className="panel-actions"
          data-menu-open={menuOpen && !anySubpanelOpen ? "true" : "false"}
          style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}
        >
          <button
            type="button"
            className="menu-toggle"
            onClick={() => {
              if (anySubpanelOpen) {
                closeAllSubpanels();
                setMenuOpen(true);
                return;
              }
              setMenuOpen((v) => !v);
            }}
            aria-expanded={menuOpen}
            aria-controls="master-menu"
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.08)",
              color: "white",
              fontSize: 11,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              style={{ display: "block" }}
            >
              <path
                fill="currentColor"
                d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7Zm8.94 2.39-1.63-.94c.1-.46.15-.94.15-1.45c0-.5-.05-.99-.15-1.45l1.63-.94a.5.5 0 0 0 .2-.65l-1.54-2.66a.5.5 0 0 0-.62-.22l-1.62.66a7.8 7.8 0 0 0-2.5-1.45l-.25-1.72A.5.5 0 0 0 13.1 0h-3.2a.5.5 0 0 0-.49.42l-.25 1.72a7.8 7.8 0 0 0-2.5 1.45l-1.62-.66a.5.5 0 0 0-.62.22L1.88 5.8a.5.5 0 0 0 .2.65l1.63.94c-.1.46-.15.94-.15 1.45c0 .5.05.99.15 1.45l-1.63.94a.5.5 0 0 0-.2.65l1.54 2.66a.5.5 0 0 0 .62.22l1.62-.66c.74.6 1.6 1.08 2.5 1.45l.25 1.72c.03.24.25.42.49.42h3.2c.24 0 .45-.18.49-.42l.25-1.72c.9-.37 1.76-.85 2.5-1.45l1.62.66a.5.5 0 0 0 .62-.22l1.54-2.66a.5.5 0 0 0-.2-.65ZM12 17a5 5 0 1 1 0-10a5 5 0 0 1 0 10Z"
              />
            </svg>
            {anySubpanelOpen ? "Back" : menuOpen ? "Close menu" : "Menu"}
          </button>

          <div
            className="menu-filter-summary"
            aria-live="polite"
            style={{
              padding: "6px 9px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.9)",
              fontSize: 10,
              lineHeight: 1.25,
              maxWidth: 310,
              flex: "1 1 220px",
              minWidth: 0,
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            }}
          >
            {`Current: ${headerFilterSummary}`}
          </div>

          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              className="panel-toggle menu-btn"
              onClick={() => {
                closeAllSubpanels();
                setFiltersOpen(true);
              }}
              aria-expanded={filtersOpen}
              aria-controls="filters-panel"
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "2px solid rgba(147,197,253,0.9)",
                background: "rgba(59,130,246,0.22)",
                color: "white",
                fontSize: 11,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {filtersOpen ? "Hide filters" : "Filters"}
            </button>
          )}

          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              onClick={resetAll}
              className="reset-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
              }}
            >
              Reset
            </button>
          )}
          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              onClick={() => {
                closeAllSubpanels();
                setInstructionsOpen(true);
                setInstructionsPage(1);
                setMenuOpen(true);
              }}
              className="instructions-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
              }}
            >
              Instructions
            </button>
          )}
          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              onClick={() => {
                closeAllSubpanels();
                setDescriptionOpen(true);
                setDescriptionPage(1);
                setMenuOpen(true);
              }}
              className="description-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
              }}
            >
              Description
            </button>
          )}
          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              onClick={() => {
                closeAllSubpanels();
                setDataSourcesOpen(true);
                setMenuOpen(true);
              }}
              className="datasources-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
              }}
            >
              Data sources
            </button>
          )}
          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              onClick={() => {
                closeAllSubpanels();
                setNextStepsOpen(true);
                setMenuOpen(true);
              }}
              className="nextsteps-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
              }}
            >
              Next steps
            </button>
          )}
          {menuOpen && !anySubpanelOpen && (
            <a
              href="/contact"
              className="contact-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Contact
            </a>
          )}
          {menuOpen && !anySubpanelOpen && (
            <a
              href="/legal"
              className="legal-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Legal
            </a>
          )}
          {menuOpen && !anySubpanelOpen && (
            <a
              href="/privacy"
              className="privacy-toggle menu-btn"
              style={{
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 11,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Privacy
            </a>
          )}
        </div>
        {!menuOpen && !anySubpanelOpen && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, width: "100%" }}>
              <input
                type="text"
                value={postcodeSearch}
                onChange={(e) => {
                  setPostcodeSearch(e.target.value);
                  if (postcodeSearchStatus) setPostcodeSearchStatus(null);
                }}
                placeholder="Search postcode (e.g. AL10 0AA)"
                aria-label="Search postcode"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  padding: "6px 8px",
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (!postcodeSearch.trim()) {
                    setPostcodeSearchStatus("Enter a postcode");
                    return;
                  }
                  setPostcodeSearchToken((v) => v + 1);
                }}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  padding: "6px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                Go
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocateMeStatus("Requesting location permission...");
                  setLocateMeSummary(null);
                  setLocateMeToken((v) => v + 1);
                }}
                title="Use my location (one-shot)"
                aria-label="Use my location once"
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(59,130,246,0.2)",
                  color: "white",
                  padding: "6px 8px",
                  borderRadius: 8,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                Locate me
              </button>
            </div>
            {postcodeSearchStatus && (
              <div style={{ fontSize: 11, opacity: 0.82, marginTop: 6 }}>
                {postcodeSearchStatus}
              </div>
            )}
            {locateMeStatus && (
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 6 }}>
                {locateMeStatus}
              </div>
            )}
            {locateMeSummary && (
              <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4, lineHeight: 1.35 }}>
                {locateMeSummary}
              </div>
            )}
          </div>
        )}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            justifyContent: "flex-start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <a
              href="https://buymeacoffee.com/chrandalf"
              target="_blank"
              rel="noreferrer"
              aria-label="Buy me a coffee"
              title="Buy me a coffee"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.22)",
                color: "white",
                textDecoration: "none",
                fontSize: 11,
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
            >
              <span aria-hidden="true">☕</span>
              <span>Buy me a coffee</span>
            </a>
            <div style={{ fontSize: 10, opacity: 0.72, lineHeight: 1.25 }}>
              Free to use. Optional support only; no paid priority or guarantees.
            </div>
            {supporterNames.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: 380 }}>
                <div
                  ref={supportersScrollerRef}
                  style={{
                    fontSize: 10,
                    opacity: 0.78,
                    lineHeight: 1.35,
                    whiteSpace: "nowrap",
                    overflowX: "hidden",
                    overflowY: "hidden",
                    flex: 1,
                  }}
                >
                  Thanks to supporters: {supporterNames.join(", ")}
                </div>
                <button
                  type="button"
                  onClick={scrollSupportersRight}
                  aria-label="Scroll supporter names"
                  title="Show more supporters"
                  style={{
                    border: "1px solid rgba(255,255,255,0.22)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    borderRadius: 999,
                    width: 18,
                    height: 18,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    lineHeight: 1,
                    padding: 0,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  →
                </button>
              </div>
            )}
          </div>
        </div>
        {(menuOpen || anySubpanelOpen) && (
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
            Scotland coverage is partial and may be 1–2 years out of date.
          </div>
        )}
        {(menuOpen || anySubpanelOpen) && (
          <div className="current-filters-mobile" style={{ marginTop: 6, fontSize: 10, opacity: 0.65, lineHeight: 1.25 }}>
            {`Current filters: ${currentFiltersSummary} · Value filter: ${valueFilterLabel}`}
          </div>
        )}
        {(menuOpen || anySubpanelOpen) && (
          <div
            style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.18)",
              fontSize: 10,
              lineHeight: 1.35,
              opacity: 0.9,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Information only</div>
            <div>
              Flood data shown here is for information only and comes from a flood risk database.
              Data may be incomplete or out of date at the time of use. Always verify with official
              sources before making decisions.
            </div>
          </div>
        )}
        {instructionsOpen && (
          <div
            className="instructions-panel"
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 11,
              lineHeight: 1.4,
              opacity: 0.92,
            }}
          >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>How to use this map</div>
                <button
                  type="button"
                  onClick={() => {
                    setInstructionsOpen(false);
                    setInstructionsPage(1);
                    setMenuOpen(true);
                  }}
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    padding: "4px 8px",
                    borderRadius: 999,
                    fontSize: 10,
                  }}
                >
                  Back
                </button>
              </div>
              {instructionsPage === 1 && (
                <>
                  <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 8 }}>Page 1 of 3 · Start here</div>
                  <div style={{ marginBottom: 8 }}>
                    This map answers a simple question: <b>where are prices higher, lower, or changing faster</b>, and how that varies when you compare like-for-like homes.
                    The quickest way to use it is to set the area size first, then choose what kind of change you want to see.
                  </div>
                  <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                    <li><b>Grid</b> controls the level of detail. Smaller cells show street-level variation; larger cells are better for regional patterns.</li>
                    <li><b>Metric</b> changes what the colours mean: median price, change in pounds, or change in percent.</li>
                    <li><b>Type</b> and <b>New build</b> keep comparisons fair by avoiding mixed property stock.</li>
                    <li><b>Period</b> lets you compare different years so you can check whether patterns are recent or persistent.</li>
                  </ol>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => setInstructionsPage(2)}
                      style={{
                        cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 10,
                      }}
                    >
                      Next page
                    </button>
                  </div>
                </>
              )}

              {instructionsPage === 2 && (
                <>
                  <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 8 }}>Page 2 of 3 · Filters and overlays</div>
                  <div style={{ marginBottom: 8 }}>
                    The right-side panels are for focused filtering. They are separate from the main menu so you can adjust thresholds quickly while keeping the map visible.
                  </div>
                  <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                    <li>On mobile, filters stay in the menu. Use the left-side zoom stack (<b>Auto</b>, 25km, 10km, 5km, 1km) to change map detail quickly.</li>
                    <li><b>Value filter</b> shows only areas above or below a threshold. Use this to isolate cheap/expensive areas or strong movers.</li>
                    <li>The threshold scale is <b>metric-specific</b>: £ range for median/change-£ and % range for change-%.</li>
                    <li><b>Overlay filters</b> includes Flood so you can compare value patterns against flood-risk hotspots.</li>
                    <li>On mobile, Overlay and Value panels can be collapsed into small boxes so the map remains readable.</li>
                  </ol>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => setInstructionsPage(1)}
                      style={{
                        cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 10,
                      }}
                    >
                      Previous page
                    </button>
                    <button
                      type="button"
                      onClick={() => setInstructionsPage(3)}
                      style={{
                        cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 10,
                      }}
                    >
                      Next page
                    </button>
                  </div>
                </>
              )}

              {instructionsPage === 3 && (
                <>
                  <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 8 }}>Page 3 of 3 · Reading results carefully</div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>How to interpret what you see</div>
                  <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                    <li>Clicking a cell opens postcode context; this helps move from pattern-finding to practical checking.</li>
                    <li>Use medians as a robust baseline, then switch to change metrics to test momentum.</li>
                    <li>If a pattern appears, change one filter at a time to check whether the signal still holds.</li>
                    <li>Treat flood overlay as exploratory context until production-grade historic datasets are integrated.</li>
                  </ol>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Data notes</div>
                  <ol start={1} style={{ margin: 0, padding: "0 0 0 16px" }}>
                    <li>Prices are sold prices, not asking prices.</li>
                    <li>Medians reduce outlier distortion but can still move if the mix of sold homes changes.</li>
                    <li>Scotland coverage is partial and may lag by 1–2 years in places.</li>
                  </ol>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => setInstructionsPage(2)}
                      style={{
                        cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 10,
                      }}
                    >
                      Previous page
                    </button>
                  </div>
                </>
              )}
          </div>
        )}

        {/* Controls */}
        {filtersOpen && (
          <>
            <div
              id="filters-panel"
              className="controls"
              data-open={filtersOpen ? "true" : "false"}
              style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 14 }}
            >
              <ControlRow label="Grid">
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="auto-grid-row" style={{ display: "none", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 11, opacity: 0.82 }}>
                      Grid mode: {gridMode === "auto" ? `Auto (${state.grid})` : "Manual"}
                    </div>
                    <button
                      type="button"
                      onClick={() => setGridMode((v) => (v === "auto" ? "manual" : "auto"))}
                      style={{
                        cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 10,
                      }}
                    >
                      {gridMode === "auto" ? "Switch to manual" : "Switch to auto"}
                    </button>
                  </div>
                  <Segment
                    options={state.metric === "median" ? ["1km", "5km", "10km", "25km"] : ["5km", "10km", "25km"]}
                    value={state.grid}
                    onChange={(v) => {
                      setGridMode("manual");
                      setState((s) => ({ ...s, grid: v as GridSize }));
                    }}
                  />
                </div>
              </ControlRow>
              {state.metric !== "median" && state.grid === "1km" && (
                <div style={{ fontSize: 11, color: "#ff9999", fontStyle: "italic", marginTop: -8 }}>
                  1km deltas unavailable
                </div>
              )}

              <ControlRow label="Metric">
                <Segment
                  options={["median", "delta_gbp", "delta_pct"]}
                  value={state.metric}
                  onChange={(v) => setState((s) => ({ ...s, metric: v as Metric }))}
                  renderOption={(v) => METRIC_LABEL[v as Metric]}
                />
              </ControlRow>

              <ControlRow label="Type">
                <Segment
                  options={["ALL", "D", "S", "T", "F"]}
                  value={state.propertyType}
                  onChange={(v) => setState((s) => ({ ...s, propertyType: v as PropertyType }))}
                  renderOption={(v) => PROPERTY_LABEL[v as PropertyType]}
                />
              </ControlRow>

              <ControlRow label="New build">
                <Segment
                  options={["ALL", "Y", "N"]}
                  value={state.newBuild}
                  onChange={(v) => setState((s) => ({ ...s, newBuild: v as NewBuild }))}
                  renderOption={(v) => NEWBUILD_LABEL[v as NewBuild]}
                />
              </ControlRow>

              <ControlRow label="Period">
                <Segment
                  options={["2025-12-01", "2024-12-01", "2023-12-01", "2022-12-01", "2021-12-01"]}
                  value={state.endMonth ?? "2025-12-01"}
                  onChange={(v) => setState((s) => ({ ...s, endMonth: v }))}
                  renderOption={(v) => {
                    const labels: Record<string, string> = {
                      "2025-12-01": "Dec 2025",
                      "2024-12-01": "Dec 2024",
                      "2023-12-01": "Dec 2023",
                      "2022-12-01": "Dec 2022",
                      "2021-12-01": "Dec 2021",
                    };
                    return labels[v] ?? v;
                  }}
                />
              </ControlRow>

            </div>

            {/* Deltas explanation */}
            {state.metric !== "median" && (
              <div className="panel-delta" style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.08)", borderLeft: "3px solid #fdae61", fontSize: 11, lineHeight: 1.4, opacity: 0.9 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Price change</div>
                <div style={{ marginBottom: 6 }}>
                  Comparing <b>earliest available month (Dec 2021)</b> to <b>latest month (Dec 2025)</b>.
                </div>
                <div>
                  <b>Note:</b> Small deltas may reflect differences in which property types sold in each period, not solely price changes in the area. Large transactions or demographic shifts can influence median prices independently of market rates.
                </div>
              </div>
            )}
          </>
        )}
        {descriptionOpen && (
          <div
            className="description-panel"
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 11,
              lineHeight: 1.45,
              opacity: 0.92,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Description</div>
              <button
                type="button"
                onClick={() => {
                  setDescriptionOpen(false);
                  setDescriptionPage(1);
                  setMenuOpen(true);
                }}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                }}
              >
                Back
              </button>
            </div>
            {descriptionPage === 1 && (
              <>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  UK House Price Map - Grid-Based Analysis
                </div>
                <div style={{ marginBottom: 8 }}>
                  This interactive UK house price map shows how property prices vary across the country using a grid-based approach rather than traditional postcode averages. By aggregating sales into evenly sized grid cells (from 1km up to 25km), it becomes much easier to spot regional patterns, price gradients, and local anomalies that are often hidden when data is grouped by administrative boundaries.
                </div>
                <div style={{ marginBottom: 8 }}>
                  The map is built using Land Registry price paid data, aggregated over a trailing 12-month period to smooth short-term volatility. For each grid cell, prices are summarised using median values, which are more robust than simple averages and less distorted by very high or very low individual sales. Where enough transactions exist, the map also shows recent price changes, helping to highlight areas where prices are rising or falling relative to the recent past.
                </div>
                <div style={{ marginBottom: 8 }}>
                  You can switch between different grid sizes depending on the level of detail you want. Smaller grids (such as 1km or 5km) reveal fine-grained local variation, while larger grids provide a broader regional view that is useful for comparing towns, cities, or wider housing markets. Filters allow prices to be explored by property type (detached, semi-detached, terraced, or flats) and by new build versus existing homes, making it easier to compare like with like.
                </div>
                <button
                  type="button"
                  onClick={() => setDescriptionPage(2)}
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    padding: "4px 8px",
                    borderRadius: 999,
                    fontSize: 10,
                  }}
                >
                  Next page
                </button>
              </>
            )}
            {descriptionPage === 2 && (
              <>
                <div style={{ marginBottom: 8 }}>
                  This grid-based view is particularly useful for people researching a move, comparing affordability between regions, or trying to understand how house prices change as you move away from city centres. Because grid cells are consistent in size, they avoid some of the distortions caused by postcode areas, which can vary widely in shape and population.
                </div>
                <div style={{ marginBottom: 8 }}>
                  The map is designed as an exploratory tool rather than a property listing service. Clicking on a grid cell reveals the underlying price context for that area, and individual postcodes can be explored further using external listing sites if desired. Coverage is strongest for England and Wales, with Scotland included where data availability allows.
                </div>
                <div style={{ marginBottom: 8 }}>
                  All data shown is aggregated and anonymised. The aim is not to predict prices, but to provide a clear, data-driven picture of UK house prices by area, helping patterns emerge that are difficult to see in traditional tables or charts.
                </div>
                <button
                  type="button"
                  onClick={() => setDescriptionPage(1)}
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    padding: "4px 8px",
                    borderRadius: 999,
                    fontSize: 10,
                  }}
                >
                  Previous page
                </button>
              </>
            )}
          </div>
        )}
        {dataSourcesOpen && (
          <div
            className="datasources-panel"
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 11,
              lineHeight: 1.45,
              opacity: 0.92,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Data sources</div>
              <button
                type="button"
                onClick={() => {
                  setDataSourcesOpen(false);
                  setMenuOpen(true);
                }}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                }}
              >
                Back
              </button>
            </div>
            <ol start={1} style={{ margin: 0, padding: "0 0 0 16px" }}>
              <li>UK Land Registry Price Paid Data (sold price transactions).</li>
              <li>Office for National Statistics: ONSPD_Online_latest_Postcode_Centroids.</li>
              <li>Energy Performance of Buildings Register (Domestic EPC data) — Department for Levelling Up, Housing and Communities.</li>
            </ol>
            <div style={{ marginTop: 8, opacity: 0.8 }}>
              Licensing and attribution follow the terms provided by each source.
            </div>
          </div>
        )}
        {nextStepsOpen && (
          <div
            className="nextsteps-panel"
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 11,
              lineHeight: 1.45,
              opacity: 0.92,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Next steps</div>
              <button
                type="button"
                onClick={() => {
                  setNextStepsOpen(false);
                  setMenuOpen(true);
                }}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                }}
              >
                Back
              </button>
            </div>
            <ol start={1} style={{ margin: 0, padding: "0 0 0 16px" }}>
              <li>
                v0.2: I will add flood exposure data (rivers/sea and surface water) so I can test whether price drops correlate with flood risk.
              </li>
              <li>
                v0.3: I will add EPC-linked property detail so I can filter by rooms and compute price per square metre or square foot.
              </li>
              <li>
                v0.4: I will add confidence/coverage indicators per cell (e.g., sales count banding or a low-data flag).
              </li>
              <li>
                v0.5: I will add a comparison mode with side-by-side metrics or a then vs now slider.
              </li>
              <li>
                v0.6: I will add commuting/transport overlays (rail/metro stations) to contextualize price gradients.
              </li>
              <li>
                v0.7: I will add affordability layers after I add income data (price-to-income ratios).
              </li>
            </ol>
          </div>
        )}

      </div>

      {/* Right-side stacked panels */}
      {(!isMobileViewport || !postcodeOpen) && !instructionsOpen && !descriptionOpen && (legendOpen || state.metric === "median" || state.metric === "delta_gbp" || state.metric === "delta_pct") && (
        <div
          className="right-panels"
          data-menu-open={menuOpen ? "true" : "false"}
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width: 520,
            maxWidth: "calc(100vw - 36px)",
            zIndex: 3,
          }}
        >
          {showOutcodePanel && state.metric === "median" && (
            <div
              className="outcode-panel"
              style={{
                width: "100%",
                maxHeight: "calc(100vh - 120px)",
                padding: "12px 14px",
                borderRadius: 14,
                background: "rgba(10, 12, 20, 0.85)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 12,
                overflow: "auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Bottom postcode areas by median</div>
              </div>
              {outcodeLoading && <div style={{ opacity: 0.7, marginBottom: 8 }}>Loading...</div>}
              {outcodeError && <div style={{ color: "#ff9999", marginBottom: 8 }}>{outcodeError}</div>}
              {!outcodeLoading && !outcodeError && outcodeTop.length === 0 && (
                <div style={{ opacity: 0.7, marginBottom: 8 }}>No data available.</div>
              )}
              {(() => {
                const source = outcodeMode === "top" ? outcodeTop : outcodeBottom;
                const list = source.slice(0, outcodeLimit);
                if (list.length === 0) return null;
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {list.map((row) => (
                      <div
                        key={`${outcodeMode}-${row.outcode}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.08)",
                          border: "1px solid rgba(255,255,255,0.16)",
                          fontSize: 11,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{row.outcode}</span>
                        <span>{formatOutcodeCurrency(row.median)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {(outcodeMode === "top" ? outcodeTop : outcodeBottom).length > outcodeLimit && (
                  <button
                    type="button"
                    onClick={() => setOutcodeLimit((v) => v + 3)}
                    style={{
                      cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.08)",
                      color: "white",
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                    }}
                  >
                    Show more
                  </button>
                )}
                {outcodeLimit > 3 && (
                  <button
                    type="button"
                    onClick={() => setOutcodeLimit(3)}
                    style={{
                      cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.08)",
                      color: "white",
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                    }}
                  >
                    Show less
                  </button>
                )}
              </div>
              <div style={{ marginTop: 10, fontSize: 10, opacity: 0.65 }}>
                Based on grid medians aggregated to postcode areas.
              </div>
            </div>
          )}

          <div
            className="overlay-filter-panel mobile-collapsible"
            data-collapsed={overlayPanelCollapsed ? "true" : "false"}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(10, 12, 20, 0.85)",
              border: "1px solid rgba(255,255,255,0.12)",
              backdropFilter: "blur(10px)",
              color: "white",
              fontSize: 12,
            }}
          >
            <div className="mobile-collapsible-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
              <div style={{ fontWeight: 600 }}>
                <span className="title-full">Overlay filters</span>
                <span className="title-mini">Overlay</span>
              </div>
              <div className="mobile-header-extra" style={{ fontSize: 10, opacity: 0.7 }}>Flood risk overlay</div>
              <button
                type="button"
                className="mobile-collapse-toggle"
                onClick={() => setOverlayPanelCollapsed((v) => !v)}
                aria-label={overlayPanelCollapsed ? "Expand overlay filters" : "Collapse overlay filters"}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  fontSize: 14,
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {overlayPanelCollapsed ? "›" : "‹"}
              </button>
            </div>
            <div className="mobile-collapsible-body" style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Flood</div>
              <Segment
                options={["off", "on", "on_hide_cells"]}
                value={state.floodOverlayMode}
                onChange={(v) => setState((s) => ({ ...s, floodOverlayMode: v as FloodOverlayMode }))}
                renderOption={(v) => {
                  if (v === "on") return "On";
                  if (v === "on_hide_cells") return "On (hide cells)";
                  return "Off";
                }}
              />
            </div>
          </div>

          {(
            state.metric === "median" ||
            state.metric === "delta_gbp" ||
            state.metric === "delta_pct"
          ) && (
            <div
              className="value-filter-panel mobile-collapsible"
              data-collapsed={valuePanelCollapsed ? "true" : "false"}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 14,
                background: "rgba(10, 12, 20, 0.85)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 12,
              }}
            >
              <div className="mobile-collapsible-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
                <div style={{ fontWeight: 600 }}>
                  <span className="title-full">
                    {state.metric === "median"
                      ? "Median value filter"
                      : state.metric === "delta_gbp"
                        ? "Change (£) filter"
                        : "Change (%) filter"}
                  </span>
                  <span className="title-mini">Value</span>
                </div>
                <div className="mobile-header-extra" style={{ fontSize: 10, opacity: 0.7 }}>
                  {state.metric === "median"
                    ? `${formatFilterValue(valueFilterMin)}–${formatFilterValue(valueFilterMax)}`
                    : `${formatMetricFilterValue(state.metric, valueFilterMin)}–${formatMetricFilterValue(state.metric, valueFilterMax)}`}
                </div>
                <button
                  type="button"
                  className="mobile-collapse-toggle"
                  onClick={() => setValuePanelCollapsed((v) => !v)}
                  aria-label={valuePanelCollapsed ? "Expand value filter" : "Collapse value filter"}
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    fontSize: 14,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {valuePanelCollapsed ? "›" : "‹"}
                </button>
              </div>

              <div className="mobile-collapsible-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Mode</div>
                  <Segment
                    options={["off", "lte", "gte"]}
                    value={state.valueFilterMode}
                    onChange={(v) => setState((s) => ({ ...s, valueFilterMode: v as ValueFilterMode }))}
                    renderOption={(v) => {
                      const labels: Record<string, string> = {
                        off: "Off",
                        lte: "Below",
                        gte: "Above",
                      };
                      return labels[v] ?? v;
                    }}
                  />
                </div>

                {state.valueFilterMode !== "off" && (
                  <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Threshold</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <input
                        type="range"
                        min={0}
                        max={1000}
                        step={1}
                        value={thresholdToPos(state.valueThreshold)}
                        onChange={(e) => {
                          const pos = Number(e.target.value);
                          const next = posToThreshold(pos);
                          setState((s) => ({ ...s, valueThreshold: next }));
                        }}
                        style={{ width: "100%" }}
                      />
                      <div style={{ fontSize: 11, opacity: 0.75 }}>
                        {valueFilterLabel}
                      </div>
                    </div>
                  </div>
                )}

                <div
                  className="current-filters-box"
                  style={{
                    marginTop: 2,
                      padding: "7px 9px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9, marginBottom: 6 }}>
                    Current filters
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.35 }}>
                    {currentFiltersSummary}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    {`Value filter: ${valueFilterLabel}`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {legendOpen && (
            <div
              className="legend"
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 14,
                background: "rgba(10, 12, 20, 0.85)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 13,
              }}
            >
              {legendContent}
            </div>
          )}
        </div>
      )}

      {!filtersOpen && !menuOpen && !instructionsOpen && !descriptionOpen && !dataSourcesOpen && !nextStepsOpen && (
        <div className="mobile-grid-dock" aria-label="Map grid controls">
          <button
            type="button"
            className={gridMode === "auto" ? "mobile-grid-btn active" : "mobile-grid-btn"}
            onClick={() => {
              setGridMode("auto");
              if (mapZoom == null) return;
              setState((s) => {
                const nextGrid = autoGridForZoom(mapZoom, s.metric);
                if (nextGrid === s.grid) return s;
                return { ...s, grid: nextGrid };
              });
            }}
          >
            Auto
          </button>
          <button
            type="button"
            className={gridMode === "manual" && state.grid === "25km" ? "mobile-grid-btn active" : "mobile-grid-btn"}
            onClick={() => {
              setGridMode("manual");
              setState((s) => ({ ...s, grid: "25km" }));
            }}
          >
            25km
          </button>
          <button
            type="button"
            className={gridMode === "manual" && state.grid === "10km" ? "mobile-grid-btn active" : "mobile-grid-btn"}
            onClick={() => {
              setGridMode("manual");
              setState((s) => ({ ...s, grid: "10km" }));
            }}
          >
            10km
          </button>
          <button
            type="button"
            className={gridMode === "manual" && state.grid === "5km" ? "mobile-grid-btn active" : "mobile-grid-btn"}
            onClick={() => {
              setGridMode("manual");
              setState((s) => ({ ...s, grid: "5km" }));
            }}
          >
            5km
          </button>
          <button
            type="button"
            disabled={state.metric !== "median"}
            className={gridMode === "manual" && state.grid === "1km" ? "mobile-grid-btn active" : "mobile-grid-btn"}
            onClick={() => {
              if (state.metric !== "median") return;
              setGridMode("manual");
              setState((s) => ({ ...s, grid: "1km" }));
            }}
          >
            1km
          </button>
        </div>
      )}
    </main>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="control-row" style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
      <div className="control-label" style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      {children}
    </div>
  );
}

function Segment({
  options,
  value,
  onChange,
  renderOption,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  renderOption?: (v: string) => string;
}) {
  return (
    <div
      className="segment"
      style={{
        display: "flex",
        borderRadius: 999,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        width: "fit-content",
        flexWrap: "wrap",
      }}
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={active ? "segment-btn active" : "segment-btn"}
            style={{
              cursor: "pointer",
              border: "none",
              padding: "6px 10px",
              fontSize: 12,
              color: "white",
              background: active ? "rgba(255,255,255,0.16)" : "transparent",
            }}
          >
            {renderOption ? renderOption(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

/* Responsive tweaks for phones */
export function Styles() {
  return (
    <style jsx global>{`
      .panel-actions {
        align-items: stretch;
      }
      .current-filters-mobile {
        display: none;
      }
      .panel-actions[data-menu-open="true"] {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .panel-actions .menu-btn {
        flex: 1 1 120px;
        text-align: center;
        justify-content: center;
        white-space: nowrap;
      }
      .menu-filter-summary {
        display: none;
      }
      .panel button,
      .right-panels button {
        transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
      }
      .panel button:hover,
      .right-panels button:hover {
        background: rgba(255,255,255,0.14) !important;
        border-color: rgba(255,255,255,0.32) !important;
      }
      .mobile-collapse-toggle {
        display: none !important;
      }
      .mobile-grid-btn {
        display: none;
      }
      .mobile-grid-dock {
        display: none;
      }
      .mobile-collapsible .title-mini {
        display: none;
      }
      @media (max-width: 640px) {
        .menu-filter-summary {
          display: block !important;
        }
        .auto-grid-row {
          display: flex !important;
        }
        .mobile-grid-dock {
          display: inline-flex !important;
          position: fixed !important;
          left: 10px !important;
          right: auto !important;
          top: 50% !important;
          bottom: auto !important;
          transform: translateY(-50%);
          z-index: 5 !important;
          gap: 4px;
          flex-direction: column;
        }
        .mobile-grid-btn {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.24);
          background: rgba(10, 12, 20, 0.9);
          color: white;
          padding: 6px 8px;
          border-radius: 8px;
          font-size: 10px;
          font-weight: 600;
          box-shadow: 0 2px 10px rgba(0,0,0,0.35);
          min-width: 48px;
          text-align: center;
          white-space: nowrap;
          line-height: 1.1;
        }
        .mobile-grid-btn.active {
          background: rgba(147,197,253,0.95);
          color: rgba(10,12,20,0.95);
          border-color: rgba(191,219,254,1);
          box-shadow: 0 0 0 1px rgba(10,12,20,0.45) inset, 0 2px 10px rgba(0,0,0,0.35);
        }
        .mobile-grid-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .current-filters-mobile {
          display: block;
        }
        .current-filters-box {
          display: none !important;
        }
        .panel-actions {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 8px !important;
        }
        .panel-actions .menu-btn {
          width: 100% !important;
        }
        .outcode-panel {
          display: none !important;
        }
        .median-overlay {
          display: none !important;
        }
        .panel {
          left: 12px !important;
          right: auto !important;
          top: 12px !important;
          width: calc(100vw - 82px) !important;
          max-width: none !important;
          padding: 8px !important;
          max-height: calc(100svh - 24px) !important;
          overflow: auto !important;
          overflow-x: hidden !important;
        }
        .panel[data-open="false"] {
          max-height: none !important;
          overflow: hidden !important;
        }
        .panel[data-open="false"] .panel-brand,
        .panel[data-open="false"] .panel-desc {
          display: none !important;
        }
        .panel[data-open="false"] .panel-title {
          font-size: 16px !important;
          margin-top: 0 !important;
        }
        .panel-title {
          font-size: clamp(15px, 4.2vw, 18px) !important;
          line-height: 1.1 !important;
        }
        .panel-byline {
          font-size: clamp(10px, 2.8vw, 11px) !important;
          margin-top: 2px !important;
        }
        .panel[data-open="false"] {
          padding: 8px 10px !important;
        }
        .panel-toggle {
          display: inline-block !important;
        }
        .controls[data-open="false"] {
          display: none !important;
        }
        .panel-delta {
          display: none !important;
        }
        .controls {
          gap: 4px !important;
        }
        .control-row {
          grid-template-columns: 1fr !important;
          gap: 3px !important;
        }
        .control-label {
          font-size: clamp(9px, 2.6vw, 10px) !important;
          opacity: 0.7 !important;
        }
        .segment {
          width: 100% !important;
          display: grid !important;
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          gap: 4px !important;
          border: none !important;
          background: transparent !important;
          padding: 0 !important;
        }
        .segment-btn {
          min-width: 0 !important;
          padding: 5px 6px !important;
          font-size: clamp(10px, 2.8vw, 11px) !important;
          border: 1px solid rgba(255,255,255,0.18) !important;
          border-radius: 10px !important;
          background: rgba(255,255,255,0.06) !important;
        }
        .segment-btn.active {
          background: rgba(255,255,255,0.22) !important;
          border-color: rgba(255,255,255,0.5) !important;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.35) inset !important;
        }
        .control-row:first-of-type .segment {
          grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
        }
        .postcode-wrap {
          position: fixed !important;
          left: 12px !important;
          right: 12px !important;
          top: auto !important;
          bottom: 12px !important;
          max-width: none !important;
          width: auto !important;
          z-index: 4 !important;
          pointer-events: auto !important;
        }
        .postcode-panel {
          padding: 8px 10px !important;
          max-height: 38svh !important;
          overflow: auto !important;
        }
        .postcode-list {
          max-height: 110px !important;
        }
        .right-panels {
          right: 12px !important;
          left: 12px !important;
          width: auto !important;
          max-width: none !important;
          bottom: 12px !important;
          position: fixed !important;
          z-index: 3 !important;
          gap: 8px !important;
          max-height: 60svh !important;
          overflow: auto !important;
          -webkit-overflow-scrolling: touch;
        }
        .right-panels[data-menu-open="true"] {
          display: none !important;
        }
        .mobile-collapse-toggle {
          display: inline-flex !important;
        }
        .mobile-collapsible[data-collapsed="true"] {
          width: 96px !important;
          min-width: 96px !important;
          max-width: 96px !important;
          align-self: flex-start !important;
          padding: 8px 8px !important;
        }
        .mobile-collapsible[data-collapsed="true"] .mobile-collapsible-body {
          display: none !important;
        }
        .mobile-collapsible[data-collapsed="true"] .mobile-header-extra,
        .mobile-collapsible[data-collapsed="true"] .title-full {
          display: none !important;
        }
        .mobile-collapsible[data-collapsed="true"] .title-mini {
          display: inline !important;
          font-weight: 600;
          font-size: 11px;
          opacity: 0.9;
        }
        .mobile-collapsible[data-collapsed="true"] .mobile-collapsible-header {
          margin-bottom: 0 !important;
        }
        .value-filter-panel {
          padding: 8px 10px !important;
        }
        .legend {
          width: 100% !important;
          max-width: none !important;
          padding: 6px 8px !important;
          max-height: 32svh !important;
          overflow: auto !important;
          position: static !important;
          z-index: auto !important;
        }
        .legend .legend-bars {
          height: 18px !important;
        }
        .legend .legend-title {
          font-size: clamp(12px, 3.4vw, 14px) !important;
          margin-bottom: 8px !important;
        }
        .legend .legend-sub {
          display: none !important;
        }
      }
    `}</style>
  );
}


function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "N/A";
  return `GBP ${Math.round(value).toLocaleString()}`;
}

function formatSignedCurrency(value: number) {
  if (!Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}GBP ${Math.round(Math.abs(value)).toLocaleString()}`;
}

function formatPercent(value: number, withSign: boolean) {
  if (!Number.isFinite(value)) return "N/A";
  const sign = withSign ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function formatDeltaValue(metric: Metric, value: number) {
  return metric === "delta_pct" ? formatPercent(value, true) : formatSignedCurrency(value);
}

function getQuantileValue(legend: Extract<LegendData, { kind: "median" }>, p: number) {
  const idx = legend.probs.findIndex((v) => v === p);
  if (idx < 0 || idx >= legend.breaks.length) return NaN;
  return legend.breaks[idx];
}




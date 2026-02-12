"use client";

import { useEffect, useState } from "react";
import ValueMap, { type LegendData } from "./Map";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "delta_gbp" | "delta_pct";
type PropertyType = "ALL" | "D" | "S" | "T" | "F"; // Detached / Semi / Terraced / Flat
type NewBuild = "ALL" | "Y" | "N";
type ValueFilterMode = "off" | "lte" | "gte";

type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: PropertyType;
  newBuild: NewBuild;
  endMonth?: string;
  valueFilterMode: ValueFilterMode;
  valueThreshold: number;
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

  const anySubpanelOpen = filtersOpen || instructionsOpen || descriptionOpen || dataSourcesOpen || nextStepsOpen;
  const closeAllSubpanels = () => {
    setFiltersOpen(false);
    setInstructionsOpen(false);
    setDescriptionOpen(false);
    setDataSourcesOpen(false);
    setNextStepsOpen(false);
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
    if (isMobile) setFiltersOpen(false);
  }, []);

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
  const valueFilterLabel =
    state.metric !== "median" || state.valueFilterMode === "off"
      ? "Off"
      : `${state.valueFilterMode === "lte" ? "Below" : "Above"} ${formatFilterValue(state.valueThreshold)}`;

  // Global value-filter scale (stable across other filters)
  const VALUE_FILTER_GLOBAL_MIN = 50_000;
  const VALUE_FILTER_GLOBAL_MAX = 3_000_000;
  const valueFilterMin = VALUE_FILTER_GLOBAL_MIN;
  const valueFilterMax = VALUE_FILTER_GLOBAL_MAX;

  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

  // Slider is logarithmic to give much more resolution at lower values.
  // We keep the UI slider in "position" space and map to a price threshold.
  const SLIDER_POS_MAX = 1000;
  const safeMin = Math.max(1, valueFilterMin);
  const safeMax = Math.max(safeMin + 1, valueFilterMax);
  const logMin = Math.log(safeMin);
  const logMax = Math.log(safeMax);
  const logRange = Math.max(1e-9, logMax - logMin);

  const posToThreshold = (pos: number) => {
    const p = clamp(pos, 0, SLIDER_POS_MAX);
    const t = p / SLIDER_POS_MAX;
    const raw = Math.exp(logMin + logRange * t);
    // Round to nearest £1k for stable display + predictable filtering
    return Math.round(raw / 1000) * 1000;
  };

  const thresholdToPos = (value: number) => {
    const v = clamp(Number.isFinite(value) ? value : 300000, safeMin, safeMax);
    const t = (Math.log(v) - logMin) / logRange;
    return Math.round(clamp(t, 0, 1) * SLIDER_POS_MAX);
  };

  useEffect(() => {
    if (state.metric !== "median") return;
    setState((s) => {
      const raw = Number.isFinite(s.valueThreshold) ? s.valueThreshold : 300000;
      const rounded = Math.round(raw / 1000) * 1000;
      const clamped = clamp(rounded, safeMin, safeMax);
      if (clamped === s.valueThreshold) return s;
      return { ...s, valueThreshold: clamped };
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
      />

      {/* Top-left product panel */}
      <div
        className="panel"
        data-open={filtersOpen ? "true" : "false"}
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          width: 520,
          maxWidth: "calc(100vw - 36px)",
          padding: 16,
          borderRadius: 16,
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
          data-menu-open={menuOpen ? "true" : "false"}
          style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}
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
              {filtersOpen ? "Hide filters" : "Filters"}
            </button>
          )}
          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              onClick={() => setLegendOpen((v) => !v)}
              className="legend-toggle menu-btn"
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
              {legendOpen ? "Hide legend" : "Show legend"}
            </button>
          )}
          {menuOpen && !anySubpanelOpen && (
            <button
              type="button"
              onClick={() => {
                closeAllSubpanels();
                setInstructionsOpen(true);
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
        </div>
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
          Scotland coverage is partial and may be 1–2 years out of date.
        </div>
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
              <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                <li>Choose a grid size (1km, 5km, 10km, 25km) to control how local or regional the view is.</li>
                <li>Select a metric to see either median sold prices or recent price changes (GBP or %).</li>
                <li>Filter by property type (detached, semi, terraced, flats) and new build vs existing homes.</li>
                <li>Pick a time period to view the latest data or compare changes over time.</li>
                <li>Click a grid cell to explore price context for that area.</li>
                <li>Tap a postcode to open Zoopla with listings around the shown price for that location.</li>
              </ol>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>What this is useful for</div>
              <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                <li>Spotting undervalued or expensive pockets within the same town or city.</li>
                <li>Comparing local markets without postcode boundary distortions.</li>
                <li>Understanding how prices change as you move away from city centres.</li>
                <li>Tracking price momentum over time using consistent grid areas.</li>
              </ol>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Notes on the data</div>
              <ol start={1} style={{ margin: 0, padding: "0 0 0 16px" }}>
                <li>Prices are based on sold prices, not asking prices.</li>
                <li>Values are medians, not averages, to reduce distortion from outliers.</li>
                <li>Coverage is strongest for England and Wales; Scotland is partial and may be less recent.</li>
              </ol>
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
                <Segment
                  options={state.metric === "median" ? ["1km", "5km", "10km", "25km"] : ["5km", "10km", "25km"]}
                  value={state.grid}
                  onChange={(v) => setState((s) => ({ ...s, grid: v as GridSize }))}
                />
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

            {/* Quick debug so you can see it working */}
            <div className="panel-debug" style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
              {`Selected: ${state.grid} - ${METRIC_LABEL[state.metric]} - ${PROPERTY_LABEL[state.propertyType]} - ${NEWBUILD_LABEL[state.newBuild]} - ${state.endMonth ?? "LATEST"}`}
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
                v0.2: I will add EPC-linked property detail so I can filter by rooms and compute price per square metre or square foot.
              </li>
              <li>
                v0.3: I will add confidence/coverage indicators per cell (e.g., sales count banding or a low-data flag).
              </li>
              <li>
                v0.4: I will add a comparison mode with side-by-side metrics or a then vs now slider.
              </li>
              <li>
                v0.5: I will add commuting/transport overlays (rail/metro stations) to contextualize price gradients.
              </li>
              <li>
                v0.6: I will add affordability layers after I add income data (price-to-income ratios).
              </li>
            </ol>
          </div>
        )}

      </div>

      {/* Right-side stacked panels */}
      {!postcodeOpen && (legendOpen || state.metric === "median") && (
        <div
          className="right-panels"
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: 560,
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

          {state.metric === "median" && (
            <div
              className="value-filter-panel"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                background: "rgba(10, 12, 20, 0.85)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 600 }}>Median value filter</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>
                  {formatLegendCurrency(valueFilterMin)}–{formatLegendCurrency(valueFilterMax)}
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
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
                        {`${state.valueFilterMode === "lte" ? "Below" : "Above"} ${formatFilterValue(state.valueThreshold)}`}
                      </div>
                    </div>
                  </div>
                )}

                <div
                  style={{
                    marginTop: 2,
                    padding: "8px 10px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9, marginBottom: 6 }}>
                    Current filters
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.35 }}>
                    {`Grid: ${state.grid} · Metric: ${METRIC_LABEL[state.metric]} · Type: ${PROPERTY_LABEL[state.propertyType]} · New build: ${NEWBUILD_LABEL[state.newBuild]} · Period: ${periodLabel}`}
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
                padding: "20px 28px",
                borderRadius: 14,
                background: "rgba(10, 12, 20, 0.85)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 14,
              }}
            >
              {legendContent}
            </div>
          )}
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
      .panel-actions[data-menu-open="true"] {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .panel-actions[data-menu-open="true"] .menu-toggle {
        grid-column: 1 / -1;
      }
      .panel-actions .menu-btn {
        flex: 1 1 120px;
        text-align: center;
        justify-content: center;
        white-space: nowrap;
      }
      @media (max-width: 640px) {
        .panel-actions {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 8px !important;
        }
        .panel-actions .menu-toggle {
          grid-column: 1 / -1;
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
          right: 12px !important;
          top: 12px !important;
          width: auto !important;
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
        .panel-debug,
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




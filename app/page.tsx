"use client";

import { useState } from "react";
import ValueMap, { type LegendData } from "./Map";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "delta_gbp" | "delta_pct";
type PropertyType = "ALL" | "D" | "S" | "T" | "F"; // Detached / Semi / Terraced / Flat
type NewBuild = "ALL" | "Y" | "N";

type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: PropertyType;
  newBuild: NewBuild;
  endMonth?: string;
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

export default function Home() {
  const [state, setState] = useState<MapState>({
    grid: "5km",
    metric: "median",
    propertyType: "ALL",
    newBuild: "ALL",
    endMonth: "LATEST",
  });
  const [legend, setLegend] = useState<LegendData | null>(null);
  const medianLegend =
    state.metric === "median" && legend && legend.kind === "median" ? legend : null;
  const deltaLegend =
    state.metric !== "median" && legend && legend.kind === "delta" && legend.metric === state.metric
      ? legend
      : null;
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [postcodeOpen, setPostcodeOpen] = useState(false);

  const formatLegendCurrency = (value: number) => {
    if (!Number.isFinite(value)) return "N/A";
    const rounded = Math.round(value);
    if (Math.abs(rounded) >= 1000) {
      return `${Math.round(rounded / 1000)}k`;
    }
    return `${rounded}`;
  };

  const legendContent = (
    <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 12, fontSize: 16, opacity: 0.9 }}>
        {METRIC_LABEL[state.metric]} Scale
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
              <div className="legend-sub" style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px", marginTop: 6 }}>
                <div />
                <div style={{ textAlign: "center", fontSize: 11, opacity: 0.75 }}>
                  Median: {formatLegendCurrency(getQuantileValue(medianLegend, 0.5))}
                </div>
                <div />
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
              UK HOUSE PRICE GRID
            </div>
            <div className="panel-byline" style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
              by Chris Randall
            </div>
          </div>
          {!postcodeOpen && (
            <div
              className="legend-inline"
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                background: "rgba(10, 12, 20, 0.85)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 12,
                minWidth: 0,
                maxWidth: "100%",
              }}
            >
              {legendContent}
            </div>
          )}
        </div>
        <div
          className="panel-actions"
          style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {!instructionsOpen && (
            <button
              type="button"
              className="panel-toggle"
              onClick={() => setFiltersOpen((v) => !v)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                fontSize: 12,
                cursor: "pointer",
                display: "none",
              }}
            >
              {filtersOpen ? "Hide filters" : "Show filters"}
            </button>
          )}
          {!instructionsOpen && (
            <button
              type="button"
              onClick={() => {
                setInstructionsOpen(true);
                setFiltersOpen(false);
              }}
              className="instructions-toggle"
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
              <div style={{ fontWeight: 600 }}>Instructions</div>
              <button
                type="button"
                onClick={() => {
                  setInstructionsOpen(false);
                  setFiltersOpen(true);
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
                Back to filters
              </button>
            </div>
            This is a grid based map of the UK showing property sold prices for the last 5 years. You're able to filter which years you want to look at and look at changes (deltas) between years. After you click a cell, tap a postcode to open Zoopla and view properties in that area around the suggested price. Useful for spotting undervalued areas, comparing local markets, and tracking momentum over time.
          </div>
        )}

        {/* Controls */}
        <div
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
              options={["LATEST", "2025-12-01", "2024-12-01", "2023-12-01", "2022-12-01", "2021-12-01"]}
              value={state.endMonth ?? "LATEST"}
              onChange={(v) => setState((s) => ({ ...s, endMonth: v }))}
              renderOption={(v) => {
                const labels: Record<string, string> = {
                  "LATEST": "Now",
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

      </div>

      {/* Bottom-right legend */}
      {!postcodeOpen && (
        <div
          className="legend"
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            padding: "20px 28px",
            borderRadius: 14,
            background: "rgba(10, 12, 20, 0.85)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(10px)",
            color: "white",
            fontSize: 14,
            width: 560,
            maxWidth: "calc(100vw - 36px)",
          }}
        >
        {legendContent}
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
      .legend-inline {
        display: none;
      }
      @media (max-width: 640px) {
        .legend-inline {
          display: none !important;
        }
        .legend {
          display: block !important;
          position: fixed !important;
          right: 12px !important;
          bottom: 12px !important;
          left: auto !important;
          width: 140px !important;
          max-width: 42vw !important;
          padding: 8px !important;
          max-height: 44svh !important;
          overflow: auto !important;
        }
        .legend .legend-range {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          gap: 6px !important;
        }
        .legend .legend-bars {
          flex-direction: column !important;
          width: 12px !important;
          height: 120px !important;
          gap: 3px !important;
        }
        .legend .legend-range > div {
          text-align: center !important;
        }
        .legend-inline .legend-title {
          font-size: 12px !important;
          margin-bottom: 6px !important;
        }
        .legend-inline .legend-bars {
          height: 12px !important;
        }
        .legend-inline .legend-sub {
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
        .panel[data-open="false"] .panel-byline,
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
        .legend {
          right: 12px !important;
          left: 12px !important;
          width: auto !important;
          max-width: none !important;
          padding: 6px 8px !important;
          bottom: 12px !important;
          max-height: 32svh !important;
          overflow: auto !important;
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




"use client";

import { useState } from "react";
import ValueMap from "./Map";

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
  delta_gbp: "Δ £",
  delta_pct: "Δ %",
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

  return (
    <main style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <ValueMap state={state} />

      {/* Top-left “product” panel */}
      <div
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
        <div style={{ fontSize: 12, letterSpacing: 0.6, opacity: 0.8 }}>VALUEMAP UK</div>
        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>UK House Price Grid</div>
        <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.35 }}>
          Grid-based medians and deltas (trailing 12 months). Data layer next.
        </div>

        {/* Controls */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 14 }}>
          <ControlRow label="Grid">
            <Segment
              options={["1km", "5km", "10km", "25km"]}
              value={state.grid}
              onChange={(v) => setState((s) => ({ ...s, grid: v as GridSize }))}
            />
          </ControlRow>

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
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
          {`Selected: ${state.grid} · ${METRIC_LABEL[state.metric]} · ${PROPERTY_LABEL[state.propertyType]} · ${NEWBUILD_LABEL[state.newBuild]} · ${state.endMonth ?? "LATEST"}`}
        </div>
      </div>

      {/* Bottom-right mini legend */}
      <div
        style={{
          position: "absolute",
          right: 18,
          bottom: 18,
          padding: "10px 12px",
          borderRadius: 14,
          background: "rgba(10, 12, 20, 0.72)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(10px)",
          color: "white",
          fontSize: 12,
          opacity: 0.9,
        }}
      >
        Map running ✅ — controls are live
      </div>
    </main>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
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

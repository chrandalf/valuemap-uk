"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ValueMap, { type LegendData, type LocateMeResult, type IndexPrefs } from "./Map";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "median_ppsf" | "delta_gbp" | "delta_pct";
type PropertyType = "ALL" | "D" | "S" | "T" | "F"; // Detached / Semi / Terraced / Flat
type NewBuild = "ALL" | "Y" | "N";
type ValueFilterMode = "off" | "lte" | "gte";
type FloodOverlayMode = "off" | "on" | "on_hide_cells";
type SchoolOverlayMode = "off" | "on" | "on_hide_cells";
type VoteOverlayMode = "off" | "on";
type VoteColorScale = "relative" | "absolute";
type GridMode = "auto" | "manual";

type IndexScoringPrefs = {
  budget: number;
  propertyType: "ALL" | "D" | "S" | "T" | "F";
  affordWeight: number;
  floodWeight: number;
  schoolWeight: number;
  coastWeight: number;
};

type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: PropertyType;
  newBuild: NewBuild;
  endMonth?: string;
  valueFilterMode: ValueFilterMode;
  valueThreshold: number;
  floodOverlayMode: FloodOverlayMode;
  schoolOverlayMode: SchoolOverlayMode;
  voteOverlayMode: VoteOverlayMode;
  voteColorScale: VoteColorScale;
};

type OutcodeRank = {
  outcode: string;
  median: number;
  weight: number;
};

const METRIC_LABEL: Record<Metric, string> = {
  median: "Median",
  median_ppsf: "Price / ft²",
  delta_gbp: "Change (GBP)",
  delta_pct: "Change (%)",
};

const isDeltaMetric = (metric: Metric) => metric === "delta_gbp" || metric === "delta_pct";

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

const PERIOD_OPTIONS = ["2025-12-01", "2024-12-01", "2023-12-01", "2022-12-01", "2021-12-01"] as const;
const MOBILE_QUICK_FILTER_ORDER = ["metric", "propertyType", "newBuild", "period", "grid"] as const;

type MobileQuickFilterKey = (typeof MOBILE_QUICK_FILTER_ORDER)[number];

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
    schoolOverlayMode: "off",
    voteOverlayMode: "off",
    voteColorScale: "relative",
  });
  const [legend, setLegend] = useState<LegendData | null>(null);
  const medianLegend =
    !isDeltaMetric(state.metric) && legend && legend.kind === "median" ? legend : null;
  const deltaLegend =
    isDeltaMetric(state.metric) && legend && legend.kind === "delta" && legend.metric === state.metric
      ? legend
      : null;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsPage, setInstructionsPage] = useState(1);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [electionInfoOpen, setElectionInfoOpen] = useState(false);
  const [voteKeyOpen, setVoteKeyOpen] = useState(false);
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
  const [activePostcodeSearch, setActivePostcodeSearch] = useState("");
  const [postcodeSearchToken, setPostcodeSearchToken] = useState(0);
  const [postcodeSearchStatus, setPostcodeSearchStatus] = useState<string | null>(null);
  const [locateMeToken, setLocateMeToken] = useState(0);
  const [locateMeStatus, setLocateMeStatus] = useState<string | null>(null);
  const [locateMeSummary, setLocateMeSummary] = useState<string | null>(null);
  const [supporterNames, setSupporterNames] = useState<string[]>([]);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [gridMode, setGridMode] = useState<GridMode>("manual");
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  const [cleanScreenMode, setCleanScreenMode] = useState(false);
  const [controlsDropOpen, setControlsDropOpen] = useState(false);
  const [infoDropOpen, setInfoDropOpen] = useState(false);
  const [panelFront, setPanelFront] = useState<Record<string, number>>({});
  const zSeqRef = useRef(0);
  const controlsDropRef = useRef<HTMLDivElement | null>(null);
  const infoDropRef = useRef<HTMLDivElement | null>(null);
  const [mobileOverlayRatio, setMobileOverlayRatio] = useState(0);
  const [mobileQuickFilterKey, setMobileQuickFilterKey] = useState<MobileQuickFilterKey>("grid");
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexActive, setIndexActive] = useState(false);
  const [indexScoringPending, setIndexScoringPending] = useState(false);
  const [indexToken, setIndexToken] = useState(0);
  const [indexBudget, setIndexBudget] = useState(300000);
  const [indexPropertyType, setIndexPropertyType] = useState<"ALL" | "D" | "S" | "T" | "F">("ALL");
  const [indexAffordWeight, setIndexAffordWeight] = useState(5);
  const [indexFloodWeight, setIndexFloodWeight] = useState(5);
  const [indexSchoolWeight, setIndexSchoolWeight] = useState(5);
  const [indexCoastWeight, setIndexCoastWeight] = useState(0);
  const [indexApplied, setIndexApplied] = useState<IndexScoringPrefs>({
    budget: 300000,
    propertyType: "ALL",
    affordWeight: 5,
    floodWeight: 5,
    schoolWeight: 5,
    coastWeight: 0,
  });
  const [indexSuitabilityMode, setIndexSuitabilityMode] = useState<ValueFilterMode>("off");
  const [indexSuitabilityThreshold, setIndexSuitabilityThreshold] = useState(65);
  const introInitRef = useRef(false);
  const urlHydratedRef = useRef(false);
  const supportersScrollerRef = useRef<HTMLDivElement | null>(null);
  const topPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelsRef = useRef<HTMLDivElement | null>(null);

  const anySubpanelOpen = filtersOpen || instructionsOpen || dataSourcesOpen || electionInfoOpen;

  // Keep map scoring prefs stable while user edits sliders; apply only on "Score areas"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const computedIndexPrefs: IndexPrefs | null = useMemo(() => {
    if (!indexActive) return null;
    return {
      budget: indexApplied.budget,
      propertyType: indexApplied.propertyType,
      affordWeight: indexApplied.affordWeight,
      floodWeight: indexApplied.floodWeight,
      schoolWeight: indexApplied.schoolWeight,
      coastWeight: indexApplied.coastWeight,
      indexFilterMode: indexSuitabilityMode,
      indexFilterThreshold: indexSuitabilityThreshold / 100,
    };
  }, [
    indexActive,
    indexToken,
    indexApplied,
    indexSuitabilityMode,
    indexSuitabilityThreshold,
  ]);

  const DEFAULT_STATE: MapState = {
    grid: "5km",
    metric: "median",
    propertyType: "ALL",
    newBuild: "ALL",
    endMonth: "2025-12-01",
    valueFilterMode: "off",
    valueThreshold: 300000,
    floodOverlayMode: "off",
    schoolOverlayMode: "off",
    voteOverlayMode: "off",
    voteColorScale: "relative",
  };
  const closeAllSubpanels = () => {
    setFiltersOpen(false);
    setInstructionsOpen(false);
    setDataSourcesOpen(false);
    setElectionInfoOpen(false);
  };

  const bringToFront = (id: string) => {
    const n = ++zSeqRef.current;
    setPanelFront(prev => ({ ...prev, [id]: n }));
  };
  const frontZ = (id: string, base: number) => base + (panelFront[id] ?? 0);
  const resetAll = () => {
    setState(DEFAULT_STATE);
    setLegendOpen(true);
    closeAllSubpanels();
    setControlsDropOpen(false);
    setInfoDropOpen(false);
    setActivePostcodeSearch("");
    setPostcodeSearchStatus(null);
    setIndexOpen(false);
    setIndexActive(false);
    setIndexScoringPending(false);
    setIndexBudget(300000);
    setIndexPropertyType("ALL");
    setIndexAffordWeight(5);
    setIndexFloodWeight(5);
    setIndexSchoolWeight(5);
    setIndexCoastWeight(0);
    setIndexApplied({
      budget: 300000,
      propertyType: "ALL",
      affordWeight: 5,
      floodWeight: 5,
      schoolWeight: 5,
      coastWeight: 0,
    });
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!controlsDropOpen && !infoDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (controlsDropOpen && controlsDropRef.current && !controlsDropRef.current.contains(e.target as Node)) {
        setControlsDropOpen(false);
      }
      if (infoDropOpen && infoDropRef.current && !infoDropRef.current.contains(e.target as Node)) {
        setInfoDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [controlsDropOpen, infoDropOpen]);

  useEffect(() => {
    if (!activePostcodeSearch.trim()) return;
    setPostcodeSearchToken((v) => v + 1);
  }, [state.floodOverlayMode, state.schoolOverlayMode, activePostcodeSearch]);

  useEffect(() => {
    if (!indexActive) {
      setIndexScoringPending(false);
    }
  }, [indexActive]);

  useEffect(() => {
    if (introInitRef.current) return;
    introInitRef.current = true;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const fromDocs = url.searchParams.get("from") === "docs";
    setIndexOpen(!fromDocs);
    if (fromDocs) {
      url.searchParams.delete("from");
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", next);
    }
  }, []);

  const scrollSupportersRight = () => {
    const el = supportersScrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: 180, behavior: "smooth" });
  };

  const currentMobileQuickFilterLabel =
    mobileQuickFilterKey === "metric"
      ? "Metric"
      : mobileQuickFilterKey === "propertyType"
        ? "Type"
        : mobileQuickFilterKey === "newBuild"
          ? "New build"
          : mobileQuickFilterKey === "period"
            ? "Period"
            : "Grid";

  const cycleMobileQuickFilter = () => {
    setMobileQuickFilterKey((current) => {
      const idx = MOBILE_QUICK_FILTER_ORDER.indexOf(current);
      const nextIdx = idx < 0 ? 0 : (idx + 1) % MOBILE_QUICK_FILTER_ORDER.length;
      return MOBILE_QUICK_FILTER_ORDER[nextIdx];
    });
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
    if (zoom >= 8.2) return isDeltaMetric(metric) ? "5km" : "1km";
    if (zoom >= 7.0) return "5km";
    if (zoom >= 5.6) return "10km";
    return "25km";
  };

  const handleMapZoomChange = (zoom: number) => {
    setMapZoom(zoom);
    if (gridMode !== "auto") return;
    setState((s) => {
      const nextGrid = autoGridForZoom(zoom, s.metric);
      if (nextGrid === s.grid) return s;
      return { ...s, grid: nextGrid };
    });
  };

  useEffect(() => {
    if (gridMode !== "auto") return;
    if (isDeltaMetric(state.metric) && state.grid === "1km") {
      setState((s) => ({ ...s, grid: "5km" }));
    }
  }, [gridMode, state.metric, state.grid]);

  useEffect(() => {
    if (gridMode !== "auto") return;
    if (mapZoom == null) return;
    setState((s) => {
      const nextGrid = autoGridForZoom(mapZoom, s.metric);
      if (nextGrid === s.grid) return s;
      return { ...s, grid: nextGrid };
    });
  }, [gridMode, mapZoom, state.metric]);

  useEffect(() => {
    if (!isMobileViewport || cleanScreenMode) {
      setMobileOverlayRatio(0);
      return;
    }

    const computeOverlayRatio = () => {
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const refs = [topPanelRef.current, rightPanelsRef.current];
      let area = 0;
      for (const el of refs) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const w = Math.max(0, rect.width);
        const h = Math.max(0, rect.height);
        if (w === 0 || h === 0) continue;
        area += w * h;
      }
      setMobileOverlayRatio(area / viewportArea);
    };

    computeOverlayRatio();
    window.addEventListener("resize", computeOverlayRatio);
    return () => window.removeEventListener("resize", computeOverlayRatio);
  }, [
    isMobileViewport,
    cleanScreenMode,
    filtersOpen,
    instructionsOpen,
    dataSourcesOpen,
    postcodeOpen,
    legendOpen,
    overlayPanelCollapsed,
    valuePanelCollapsed,
    state.metric,
    state.valueFilterMode,
    state.floodOverlayMode,
    state.schoolOverlayMode,
  ]);

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
    params.set("schools", state.schoolOverlayMode);
    params.set("vote", state.voteOverlayMode);
    params.set("voteScale", state.voteColorScale);

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

  const formatFilterValue = (value: number) => `£${formatLegendCurrency(value)}`;
  const formatPpsfValue = (value: number) => {
    if (!Number.isFinite(value)) return "N/A";
    return `£${Math.round(value).toLocaleString()}/ft²`;
  };

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

  const formatMetricFilterValue = (metric: Metric, value: number) => {
    if (metric === "median") return formatFilterValue(value);
    if (metric === "median_ppsf") return formatPpsfValue(value);
    return metric === "delta_gbp" ? formatSignedPounds(value) : formatSignedPercent(value);
  };

  const voteLegendContent = (
    <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 10, fontSize: 16, opacity: 0.9 }}>
        Political votes (Left ↔ Right)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "86px 1fr 86px", gap: 8, alignItems: "center" }}>
        <div style={{ textAlign: "left", fontSize: 11, opacity: 0.85 }}>Left strong</div>
        <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", border: "1px solid rgba(255,255,255,0.2)" }}>
          {[
            "#450a0a",
            "#b91c1c",
            "#ef4444",
            "#fecaca",
            "#f3f4f6",
            "#bfdbfe",
            "#60a5fa",
            "#1e3a8a",
            "#0b1b5a",
          ].map((c, i) => (
            <div key={i} style={{ flex: 1, backgroundColor: c }} />
          ))}
        </div>
        <div style={{ textAlign: "right", fontSize: 11, opacity: 0.85 }}>Right strong</div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.8, lineHeight: 1.35 }}>
        Weighted axis: Left = (Progressive × 2) + (Other × 1), Right = (Popular Right × 2) + (Conservative × 1).
      </div>
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8, lineHeight: 1.35 }}>
        {state.voteColorScale === "relative"
          ? "Relative: colours show each cell's left/right strength compared with other loaded cells."
          : "Absolute: colours show left/right strength from raw vote shares in that cell."}
      </div>
    </>
  );

  const schoolLegendContent = (
    <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 10, fontSize: 16, opacity: 0.9 }}>
        School quality overlay
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "86px 1fr 86px", gap: 8, alignItems: "center" }}>
        <div style={{ textAlign: "left", fontSize: 11, opacity: 0.85 }}>Weaker</div>
        <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", border: "1px solid rgba(255,255,255,0.2)" }}>
          {[
            "#7f1d1d",
            "#dc2626",
            "#f59e0b",
            "#f3f4f6",
            "#86efac",
            "#16a34a",
            "#14532d",
          ].map((c, i) => (
            <div key={i} style={{ flex: 1, backgroundColor: c }} />
          ))}
        </div>
        <div style={{ textAlign: "right", fontSize: 11, opacity: 0.85 }}>Stronger</div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.8, lineHeight: 1.35 }}>
        Points are schools. Search/Locate highlights nearest school and nearest good school.
      </div>
    </>
  );

  const indexLegendContent = (
    <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 12, fontSize: 16, opacity: 0.9 }}>
        🔍 Area match score
      </div>
      <div className="legend-range" style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px", gap: 8, alignItems: "center" }}>
        <div style={{ textAlign: "left", fontSize: 12, opacity: 0.75 }}>Poor match</div>
        <div className="legend-bars" style={{ display: "flex", height: 50, gap: 3 }}>
          {["#d73027","#f46d43","#fdae61","#ffffbf","#a6d96a","#66bd63","#1a9850"].map((c, i) => (
            <div key={i} style={{ flex: 1, backgroundColor: c, borderRadius: 3 }} />
          ))}
        </div>
        <div style={{ textAlign: "right", fontSize: 12, opacity: 0.75 }}>Great match</div>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, opacity: 0.6, lineHeight: 1.35 }}>
        Based on your preferences: budget, flood safety, school quality. Greener cells are a better fit.
      </div>
    </>
  );

  const legendContent = (
    <>
      {indexActive && indexLegendContent}
      {state.schoolOverlayMode !== "off" && schoolLegendContent}
      {!indexActive && state.voteOverlayMode === "on" && voteLegendContent}
      {!indexActive && state.voteOverlayMode !== "on" && (
      <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 12, fontSize: 16, opacity: 0.9 }}>
        {state.metric === "median"
          ? "Median house price"
          : state.metric === "median_ppsf"
            ? "Median price per sq ft"
            : `${METRIC_LABEL[state.metric]} Scale`}
      </div>
      {!isDeltaMetric(state.metric) && (
        <>
          {!medianLegend && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>Loading scale...</div>
          )}
          {medianLegend && (
            <>
              <div className="legend-range" style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px", gap: 8, alignItems: "center" }}>
                <div style={{ textAlign: "left", fontSize: 12, opacity: 0.75 }}>
                  {formatMetricFilterValue(state.metric, medianLegend.breaks[0])}
                </div>
                <div className="legend-bars" style={{ display: "flex", height: 50, gap: 3 }}>
                  {medianLegend.colors.map((c, i) => (
                    <div key={i} style={{ flex: 1, backgroundColor: c, borderRadius: 3 }} />
                  ))}
                </div>
                <div style={{ textAlign: "right", fontSize: 12, opacity: 0.75 }}>
                  {formatMetricFilterValue(state.metric, medianLegend.breaks[medianLegend.breaks.length - 1])}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {isDeltaMetric(state.metric) && (
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
      )}
    </>
  );

  const formatOutcodeCurrency = (value: number) => {
    if (!Number.isFinite(value)) return "N/A";
    return `£${formatLegendCurrency(value)}`;
  };

  const periodLabel = PERIOD_LABEL[state.endMonth ?? "2025-12-01"] ?? (state.endMonth ?? "LATEST");

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
      if (state.metric === "median_ppsf") {
        chunks.push(`Median PPSF £${Math.round(result.cell.median).toLocaleString()}/ft²`);
      } else {
        chunks.push(`Median £${Math.round(result.cell.median).toLocaleString()}`);
      }
    }
    if (result.cell?.txCount != null && Number.isFinite(result.cell.txCount)) {
      chunks.push(`Sales ${Math.round(result.cell.txCount)}`);
    }
    if (state.floodOverlayMode !== "off" && result.floodNearest) {
      chunks.push(
        `Nearest flood postcode ${result.floodNearest.postcode} (${result.floodNearest.riskBand}, ${result.floodNearest.distanceMeters}m)`
      );
    }
    if (state.schoolOverlayMode !== "off" && result.schoolNearest) {
      chunks.push(
        `Nearest school ${result.schoolNearest.schoolName} (${result.schoolNearest.distanceMeters}m, ${result.schoolNearest.qualityBand})`
      );
    }
    if (state.schoolOverlayMode !== "off" && result.schoolNearestGood) {
      chunks.push(
        `Nearest good school ${result.schoolNearestGood.schoolName} (${result.schoolNearestGood.distanceMeters}m)`
      );
    }

    setLocateMeStatus("Location found");
    setLocateMeSummary(chunks.join(" · "));
  };

  const valueFilterLabel =
    state.valueFilterMode === "off"
      ? "Off"
      : `${state.valueFilterMode === "lte" ? "Below" : "Above"} ${formatMetricFilterValue(state.metric, state.valueThreshold)}`;
  const indexSuitabilityLabel =
    indexSuitabilityMode === "off"
      ? "Off"
      : `${indexSuitabilityMode === "lte" ? "Below" : "Above"} ${indexSuitabilityThreshold}%`;
  const floodOverlayLabel =
    state.floodOverlayMode === "off"
      ? "Off"
      : state.floodOverlayMode === "on"
        ? "On"
        : "On (hide cells)";
  const schoolOverlayLabel =
    state.schoolOverlayMode === "off"
      ? "Off"
      : state.schoolOverlayMode === "on"
        ? "On"
        : "On (hide cells)";
  const voteOverlayLabel =
    state.voteOverlayMode === "off"
      ? "Off"
      : "On";
  const voteScaleLabel = state.voteColorScale === "relative" ? "Relative" : "Absolute";

  const currentFiltersSummary =
    `Grid: ${state.grid} · Metric: ${METRIC_LABEL[state.metric]} · ` +
    `Type: ${PROPERTY_LABEL[state.propertyType]} · New build: ${NEWBUILD_LABEL[state.newBuild]} · ` +
    `Period: ${periodLabel} · Flood: ${floodOverlayLabel} · Schools: ${schoolOverlayLabel} · Vote overlay: ${voteOverlayLabel} (${voteScaleLabel})`;
  const headerFilterSummary =
    `${state.grid} · ${METRIC_LABEL[state.metric]} · ${PROPERTY_LABEL[state.propertyType]} · ${NEWBUILD_LABEL[state.newBuild]} · ${periodLabel}`;
  const headerMedianSummary =
    !isDeltaMetric(state.metric) && medianLegend
      ? `${formatMetricFilterValue(state.metric, medianLegend.breaks[0])}–${formatMetricFilterValue(state.metric, medianLegend.breaks[medianLegend.breaks.length - 1])}`
      : null;
  const topBarHeight = isMobileViewport ? 88 : 48;
  const topStripTop = topBarHeight + 4;
  const floatingPanelTop = topBarHeight + 8;
  const clearButtonTop = isMobileViewport ? topBarHeight + 86 : 162;

  // Global value-filter scales (stable across other filters), per metric
  const MEDIAN_FILTER_MIN = 50_000;
  const MEDIAN_FILTER_MAX = 3_000_000;
  const PPSF_FILTER_MIN = 50;
  const PPSF_FILTER_MAX = 1500;
  const DELTA_GBP_FILTER_MAX_ABS = 200_000;
  const DELTA_PCT_FILTER_MAX_ABS = 30;

  const valueFilterMin =
    state.metric === "median"
      ? MEDIAN_FILTER_MIN
      : state.metric === "median_ppsf"
        ? PPSF_FILTER_MIN
      : state.metric === "delta_gbp"
        ? -DELTA_GBP_FILTER_MAX_ABS
        : -DELTA_PCT_FILTER_MAX_ABS;
  const valueFilterMax =
    state.metric === "median"
      ? MEDIAN_FILTER_MAX
      : state.metric === "median_ppsf"
        ? PPSF_FILTER_MAX
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

    if (state.metric === "median_ppsf") {
      const safeMin = Math.max(1, PPSF_FILTER_MIN);
      const safeMax = Math.max(safeMin + 1, PPSF_FILTER_MAX);
      const logMin = Math.log(safeMin);
      const logMax = Math.log(safeMax);
      const logRange = Math.max(1e-9, logMax - logMin);
      const t = p / SLIDER_POS_MAX;
      const raw = Math.exp(logMin + logRange * t);
      return Math.round(raw);
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

    if (state.metric === "median_ppsf") {
      const safeMin = Math.max(1, PPSF_FILTER_MIN);
      const safeMax = Math.max(safeMin + 1, PPSF_FILTER_MAX);
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

      if (s.metric === "median_ppsf") {
        const rounded = Math.round(raw);
        const clamped = clamp(rounded, PPSF_FILTER_MIN, PPSF_FILTER_MAX);
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
        postcodeSearchQuery={activePostcodeSearch}
        postcodeSearchToken={postcodeSearchToken}
        locateMeToken={locateMeToken}
        onLocateMeResult={handleLocateMeResult}
        indexPrefs={computedIndexPrefs}
        onIndexScoringApplied={() => setIndexScoringPending(false)}
        onPostcodeSearchResult={(result) => {
          const floodLookupActive = result.lookupMode !== "schools" && state.floodOverlayMode !== "off";
          const schoolLookupActive = result.lookupMode !== "flood" && state.schoolOverlayMode !== "off";

          const schoolSuffix = schoolLookupActive && result.schoolNearest
            ? ` · nearest school: ${result.schoolNearest.schoolName} (${result.schoolNearest.distanceMeters}m, ${result.schoolNearest.qualityBand})`
            : "";
          const schoolGoodSuffix = schoolLookupActive && result.schoolNearestGood
            ? ` · nearest good school: ${result.schoolNearestGood.schoolName} (${result.schoolNearestGood.distanceMeters}m)`
            : "";

          if (!floodLookupActive && schoolLookupActive) {
            if (result.schoolNearest || result.schoolNearestGood) {
              setPostcodeSearchStatus(`School lookup for ${result.normalizedQuery}${schoolSuffix}${schoolGoodSuffix}`);
              return;
            }
            setPostcodeSearchStatus(`No mapped school found for ${result.normalizedQuery}`);
            return;
          }

          if (result.status === "found") {
            setPostcodeSearchStatus(`Found ${result.matchedPostcode ?? result.normalizedQuery}${schoolSuffix}${schoolGoodSuffix}`);
            return;
          }
          if (result.status === "broad-has-risk") {
            const count = result.hierarchyMatchCount ?? 0;
            setPostcodeSearchStatus(
              `${result.normalizedQuery} is a broader postcode area. ${count.toLocaleString()} flood-risk postcodes found under it${
                result.nearestPostcode ? ` (showing ${result.nearestPostcode})` : ""
              }.${schoolSuffix}${schoolGoodSuffix}`
            );
            return;
          }
          if (result.status === "no-risk-nearest") {
            setPostcodeSearchStatus(
              `No mapped flood-risk postcode found for ${result.normalizedQuery}. Nearest mapped postcode: ${result.nearestPostcode ?? "available"}${schoolSuffix}${schoolGoodSuffix}`
            );
            return;
          }
          if (result.status === "not-found") {
            setPostcodeSearchStatus(`No postcode match found for ${result.normalizedQuery}${schoolSuffix}${schoolGoodSuffix}`);
            return;
          }
          setPostcodeSearchStatus(`Postcode search unavailable right now${schoolSuffix}${schoolGoodSuffix}`);
        }}
      />


      {/* ═══ Fixed top bar ═══ */}
      {!(isMobileViewport && cleanScreenMode) && (
        <div
          ref={topPanelRef}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: topBarHeight,
            zIndex: frontZ("topbar", 50),
            background: "rgba(8,10,20,0.94)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            color: "white",
            padding: isMobileViewport ? "6px 10px" : "0 12px",
            display: "grid",
            gridTemplateRows: isMobileViewport ? "1fr 1fr" : "1fr",
            gap: isMobileViewport ? 6 : 0,
          }}
          onMouseDown={() => bringToFront("topbar")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.1, whiteSpace: "nowrap", flexShrink: 0, marginRight: 2 }}>
              UK House Price Grid{" "}
              <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.45 }}>v0.1</span>
            </div>

            <div ref={controlsDropRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setControlsDropOpen(v => !v); setInfoDropOpen(false); }}
                style={{ cursor: "pointer", border: controlsDropOpen ? "1px solid rgba(250,204,21,0.7)" : "1px solid rgba(255,255,255,0.2)", background: controlsDropOpen ? "rgba(250,204,21,0.14)" : "rgba(255,255,255,0.08)", color: "white", padding: "5px 10px", borderRadius: 999, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
              >
                ⚙ Controls ▾
              </button>
              {controlsDropOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 210, background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "6px 0", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 200 }}>
                  {([
                    { label: filtersOpen ? "🗂 Filters (open)" : "🗂 Filters", action: () => { setFiltersOpen(v => !v); setControlsDropOpen(false); bringToFront("filters"); } },
                    { label: "🔍 Find my area", action: () => { setIndexOpen(v => !v); setControlsDropOpen(false); bringToFront("index"); } },
                    { label: "↺  Reset all", action: () => { resetAll(); } },
                  ] as Array<{ label: string; action: () => void }>).map(({ label, action }) => (
                    <button key={label} type="button" onClick={action}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "white", cursor: "pointer", padding: "8px 14px", fontSize: 11 }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      {label}
                    </button>
                  ))}
                  <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
                  <a href="https://buymeacoffee.com/chrandalf" target="_blank" rel="noreferrer"
                    style={{ display: "block", padding: "8px 14px", fontSize: 11, color: "white", textDecoration: "none" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    ☕ Buy me a coffee
                  </a>
                  {supporterNames.length > 0 && (
                    <div style={{ padding: "2px 14px 7px", fontSize: 9, opacity: 0.55, lineHeight: 1.3 }}>
                      Thanks: {supporterNames.slice(0, 6).join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div ref={infoDropRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setInfoDropOpen(v => !v); setControlsDropOpen(false); }}
                style={{ cursor: "pointer", border: infoDropOpen ? "1px solid rgba(147,197,253,0.7)" : "1px solid rgba(255,255,255,0.2)", background: infoDropOpen ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.08)", color: "white", padding: "5px 10px", borderRadius: 999, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
              >
                ℹ Info ▾
              </button>
              {infoDropOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 210, background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "6px 0", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 200 }}>
                  {([
                    { label: "📖 Instructions", href: "/instructions" },
                    { label: "📊 Data sources", href: "/data-sources" },
                    { label: "🗳 Election info", href: "/election-info" },
                    { label: "📝 Description", href: "/description" },
                    { label: "🗺 Next steps", href: "/next-steps" },
                    { label: "✉ Contact", href: "/contact" },
                    { label: "⚖ Legal", href: "/legal" },
                    { label: "🔒 Privacy", href: "/privacy" },
                  ] as Array<{ label: string; href: string }>).map(({ label, href }) => (
                    <a key={href} href={href} style={{ display: "block", padding: "8px 14px", fontSize: 11, color: "white", textDecoration: "none" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}
                    >
                      {label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {!isMobileViewport && (
              <div style={{ display: "grid", gap: 1, maxWidth: 330, flexShrink: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {headerFilterSummary}
                </div>
                {headerMedianSummary && (
                  <div style={{ fontSize: 10, opacity: 0.72, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {`Median range: ${headerMedianSummary}`}
                  </div>
                )}
              </div>
            )}
            <div style={{ flex: 1 }} />

            {!isMobileViewport && (
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                <input type="text"
                  value={postcodeSearch}
                  onChange={(e) => { setPostcodeSearch(e.target.value); if (postcodeSearchStatus) setPostcodeSearchStatus(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { const q = postcodeSearch.trim(); if (q) { setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); } } }}
                  placeholder="Search postcode…"
                  aria-label="Search postcode"
                  style={{ width: 155, borderRadius: 7, border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 8px", fontSize: 11 }}
                />
                <button type="button"
                  onClick={() => { const q = postcodeSearch.trim(); if (!q) { setPostcodeSearchStatus("Enter a postcode"); return; } setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); }}
                  style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 9px", borderRadius: 7, fontSize: 11 }}
                >
                  Go
                </button>
                <button type="button"
                  onClick={() => { setLocateMeStatus("Requesting location permission..."); setLocateMeSummary(null); setLocateMeToken(v => v + 1); }}
                  title="Use my location (one-shot)" aria-label="Use my location once"
                  style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(59,130,246,0.2)", color: "white", padding: "5px 9px", borderRadius: 7, fontSize: 11, whiteSpace: "nowrap" }}
                >
                  📍 Locate
                </button>
              </div>
            )}
          </div>

          {isMobileViewport && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 0 }}>
              <input
                type="text"
                value={postcodeSearch}
                onChange={(e) => { setPostcodeSearch(e.target.value); if (postcodeSearchStatus) setPostcodeSearchStatus(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { const q = postcodeSearch.trim(); if (q) { setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); } } }}
                placeholder="Postcode…"
                aria-label="Search postcode"
                style={{ flex: 1, minWidth: 0, borderRadius: 7, border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 8px", fontSize: 11 }}
              />
              <button
                type="button"
                onClick={() => { setLocateMeStatus("Requesting location permission..."); setLocateMeSummary(null); setLocateMeToken(v => v + 1); }}
                title="Use my location (one-shot)"
                aria-label="Use my location once"
                style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(59,130,246,0.2)", color: "white", padding: "5px 8px", borderRadius: 7, fontSize: 11, whiteSpace: "nowrap" }}
              >
                📍 Locate
              </button>
              <button
                type="button"
                onClick={() => { const q = postcodeSearch.trim(); if (!q) { setPostcodeSearchStatus("Enter a postcode"); return; } setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); }}
                style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 9px", borderRadius: 7, fontSize: 11 }}
              >
                Go
              </button>
            </div>
          )}
        </div>
      )}

      {/* Status strip (below top bar) */}
      {(postcodeSearchStatus || locateMeStatus || locateMeSummary) && !cleanScreenMode && (
        <div
          style={{ position: "fixed", top: topStripTop, left: 18, zIndex: frontZ("status", 48), maxWidth: "calc(100vw - 36px)", background: "rgba(8,10,20,0.92)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "6px 10px", color: "white", fontSize: 11, lineHeight: 1.4 }}
          onMouseDown={() => bringToFront("status")}
        >
          {postcodeSearchStatus && <div>{postcodeSearchStatus}</div>}
          {locateMeStatus && <div style={{ opacity: 0.85 }}>{locateMeStatus}</div>}
          {locateMeSummary && <div style={{ opacity: 0.8, marginTop: 2 }}>{locateMeSummary}</div>}
        </div>
      )}

      {/* Flood overlay warning banner */}
      {state.floodOverlayMode !== "off" && !cleanScreenMode && (
        <div
          style={{ position: "fixed", top: topStripTop, left: (postcodeSearchStatus || locateMeStatus || locateMeSummary) ? "auto" : 18, right: (postcodeSearchStatus || locateMeStatus || locateMeSummary) ? 18 : "auto", zIndex: 46, maxWidth: 380, borderRadius: 8, border: "1px solid rgba(248,113,113,0.55)", background: "rgba(239,68,68,0.12)", padding: "6px 10px", color: "white", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-start", gap: 6 }}>
          <div style={{ width: 16, height: 16, borderRadius: 999, background: "rgba(239,68,68,0.9)", color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>!</div>
          <div style={{ fontSize: 10, lineHeight: 1.35, opacity: 0.95 }}>
            <b>Important:</b> Flood overlay uses open flood data. Always verify with official UK government sources before making decisions.
          </div>
        </div>
      )}

      {/* ── Floating Filters panel ── */}
      {filtersOpen && !cleanScreenMode && (
        <div
          style={{ position: "fixed", top: floatingPanelTop, left: 18, zIndex: frontZ("filters", 45), width: 480, maxWidth: "calc(100vw - 36px)", maxHeight: "calc(100vh - 72px)", overflow: "auto", padding: 14, borderRadius: 14, background: "rgba(10,12,20,0.96)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(12px)", color: "white", boxShadow: "0 8px 40px rgba(0,0,0,0.55)" }}
          onMouseDown={() => bringToFront("filters")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>🗂 Filters</div>
            <button type="button" onClick={() => setFiltersOpen(false)} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", width: 26, height: 26, borderRadius: 999, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
          <div id="filters-panel" className="controls" data-open="true" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <ControlRow label="Grid">
              <Segment
                options={isDeltaMetric(state.metric) ? ["5km", "10km", "25km"] : ["1km", "5km", "10km", "25km"]}
                value={state.grid}
                onChange={(v) => { setGridMode("manual"); setState((s) => ({ ...s, grid: v as GridSize })); }}
              />
            </ControlRow>
            {isDeltaMetric(state.metric) && state.grid === "1km" && (
              <div style={{ fontSize: 11, color: "#ff9999", fontStyle: "italic", marginTop: -4 }}>1km deltas unavailable</div>
            )}
            <ControlRow label="Metric">
              <Segment options={["median", "median_ppsf", "delta_gbp", "delta_pct"]} value={state.metric} onChange={(v) => setState((s) => ({ ...s, metric: v as Metric }))} renderOption={(v) => METRIC_LABEL[v as Metric]} />
            </ControlRow>
            <ControlRow label="Type">
              <Segment options={["ALL", "D", "S", "T", "F"]} value={state.propertyType} onChange={(v) => setState((s) => ({ ...s, propertyType: v as PropertyType }))} renderOption={(v) => PROPERTY_LABEL[v as PropertyType]} />
            </ControlRow>
            <ControlRow label="New build">
              <Segment options={["ALL", "Y", "N"]} value={state.newBuild} onChange={(v) => setState((s) => ({ ...s, newBuild: v as NewBuild }))} renderOption={(v) => NEWBUILD_LABEL[v as NewBuild]} />
            </ControlRow>
            <ControlRow label="Period">
              <Segment options={[...PERIOD_OPTIONS]} value={state.endMonth ?? "2025-12-01"} onChange={(v) => setState((s) => ({ ...s, endMonth: v }))}
                renderOption={(v) => { const L: Record<string, string> = { "2025-12-01": "Dec 2025", "2024-12-01": "Dec 2024", "2023-12-01": "Dec 2023", "2022-12-01": "Dec 2022", "2021-12-01": "Dec 2021" }; return L[v] ?? v; }} />
            </ControlRow>
          </div>
          {isDeltaMetric(state.metric) && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.08)", borderLeft: "3px solid #fdae61", fontSize: 11, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Price change</div>
              <div style={{ marginBottom: 6 }}>Comparing <b>Dec 2021</b> to <b>Dec 2025</b>.</div>
              <div><b>Note:</b> Small deltas may reflect differences in property types sold in each period, not solely price changes.</div>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 10, opacity: 0.6, lineHeight: 1.3 }}>Scotland coverage is partial and may be 1–2 years out of date.</div>
          <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", fontSize: 10, lineHeight: 1.35, opacity: 0.88 }}>
            <b>Information only.</b> Map outputs may be incomplete or out of date. Always verify important details with official UK government sources.
          </div>
        </div>
      )}

      {/* ── Floating Instructions panel ── */}
      {instructionsOpen && !cleanScreenMode && (
        <div
          style={{ position: "fixed", top: floatingPanelTop, left: 18, zIndex: frontZ("instructions", 45), width: 460, maxWidth: "calc(100vw - 36px)", maxHeight: "calc(100vh - 72px)", overflow: "auto", padding: 14, borderRadius: 14, background: "rgba(10,12,20,0.96)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(12px)", color: "white", boxShadow: "0 8px 40px rgba(0,0,0,0.55)", fontSize: 11, lineHeight: 1.4 }}
          onMouseDown={() => bringToFront("instructions")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>📖 How to use this map</div>
            <button type="button" onClick={() => { setInstructionsOpen(false); setInstructionsPage(1); }} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", width: 26, height: 26, borderRadius: 999, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
          {instructionsPage === 1 && (
            <>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 8 }}>Page 1 of 3 · Start here</div>
              <div style={{ marginBottom: 8 }}>This map answers: <b>where are prices higher, lower, or changing faster</b>, and how that varies when you compare like-for-like homes.</div>
              <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                <li><b>Grid</b> controls the level of detail. Smaller cells show street-level variation; larger cells are better for regional patterns.</li>
                <li><b>Metric</b> changes what the colours mean: median price, change in pounds, or change in percent.</li>
                <li><b>Type</b> and <b>New build</b> keep comparisons fair by avoiding mixed property stock.</li>
                <li><b>Period</b> lets you compare different years so you can check whether patterns are recent or persistent.</li>
              </ol>
              <button type="button" onClick={() => setInstructionsPage(2)} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", padding: "4px 10px", borderRadius: 999, fontSize: 10 }}>Next page →</button>
            </>
          )}
          {instructionsPage === 2 && (
            <>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 8 }}>Page 2 of 3 · Filters and overlays</div>
              <div style={{ marginBottom: 8 }}>The right-side panels are for focused filtering — separate from the main menu so you can adjust thresholds quickly while keeping the map visible.</div>
              <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                <li>On mobile, use the bottom zoom dock to change map detail quickly.</li>
                <li><b>Value filter</b> shows only areas above or below a threshold.</li>
                <li>The threshold scale is <b>metric-specific</b>: £ range for median, % range for change-%.</li>
                <li><b>Overlay filters</b> includes Flood so you can compare value patterns against flood-risk hotspots.</li>
              </ol>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setInstructionsPage(1)} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", padding: "4px 10px", borderRadius: 999, fontSize: 10 }}>← Previous</button>
                <button type="button" onClick={() => setInstructionsPage(3)} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", padding: "4px 10px", borderRadius: 999, fontSize: 10 }}>Next →</button>
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
              <ol start={1} style={{ margin: "0 0 10px 16px", padding: 0 }}>
                <li>Prices are sold prices, not asking prices.</li>
                <li>Medians reduce outlier distortion but can still move if the mix of sold homes changes.</li>
                <li>Scotland coverage is partial and may lag by 1–2 years in places.</li>
              </ol>
              <button type="button" onClick={() => setInstructionsPage(2)} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", padding: "4px 10px", borderRadius: 999, fontSize: 10 }}>← Previous</button>
            </>
          )}
        </div>
      )}

      {/* ── Floating Data Sources panel ── */}
      {dataSourcesOpen && !cleanScreenMode && (
        <div
          style={{ position: "fixed", top: floatingPanelTop, left: 18, zIndex: frontZ("datasources", 45), width: 420, maxWidth: "calc(100vw - 36px)", maxHeight: "calc(100vh - 72px)", overflow: "auto", padding: 14, borderRadius: 14, background: "rgba(10,12,20,0.96)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(12px)", color: "white", boxShadow: "0 8px 40px rgba(0,0,0,0.55)", fontSize: 11, lineHeight: 1.45 }}
          onMouseDown={() => bringToFront("datasources")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>📊 Data sources</div>
            <button type="button" onClick={() => setDataSourcesOpen(false)} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", width: 26, height: 26, borderRadius: 999, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
          <ol start={1} style={{ margin: 0, padding: "0 0 0 16px" }}>
            <li>UK Land Registry Price Paid Data (sold price transactions).</li>
            <li>Office for National Statistics: ONSPD_Online_latest_Postcode_Centroids.</li>
            <li>Energy Performance of Buildings Register (Domestic EPC data) — Department for Levelling Up, Housing and Communities.</li>
          </ol>
          <div style={{ marginTop: 8, opacity: 0.8 }}>Licensing and attribution follow the terms provided by each source.</div>
        </div>
      )}

      {/* ── Floating Election Info panel ── */}
      {electionInfoOpen && !cleanScreenMode && (
        <div
          style={{ position: "fixed", top: floatingPanelTop, left: 18, zIndex: frontZ("electioninfo", 45), width: 430, maxWidth: "calc(100vw - 36px)", maxHeight: "calc(100vh - 72px)", overflow: "auto", padding: 14, borderRadius: 14, background: "rgba(10,12,20,0.96)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(12px)", color: "white", boxShadow: "0 8px 40px rgba(0,0,0,0.55)", fontSize: 11, lineHeight: 1.45 }}
          onMouseDown={() => bringToFront("electioninfo")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>🗳 Election overlay (GE 2024)</div>
            <button type="button" onClick={() => setElectionInfoOpen(false)} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", width: 26, height: 26, borderRadius: 999, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
          <div style={{ marginBottom: 8 }}>This overlay maps General Election 2024 vote shares by constituency boundary. Turn it on in Overlay filters.</div>
          <ol start={1} style={{ margin: 0, padding: "0 0 0 16px" }}>
            <li><b>Progressive</b>: Labour, Lib Dem, Green, SNP, Plaid Cymru, Alliance, SDLP, Sinn Féin and related centre-left parties.</li>
            <li><b>Conservative</b>: Conservative and Unionist family parties.</li>
            <li><b>Popular Right</b>: Reform UK and related right-populist parties.</li>
            <li><b>Other</b>: all remaining parties/candidates not in those three groupings.</li>
          </ol>
          <div style={{ marginTop: 8, opacity: 0.8 }}>Percentages are vote-share within each constituency and are for exploratory information only.</div>
        </div>
      )}



      {/* Find My Area – centered modal */}
      {indexOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: frontZ("index", 46),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(3px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setIndexOpen(false); }}
          onMouseDown={() => bringToFront("index")}
        >
          <div
            className="index-modal"
            style={{
              width: 380,
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "calc(100vh - 48px)",
              overflow: "auto",
              padding: "16px 18px",
              borderRadius: 16,
              background: "rgba(10, 12, 20, 0.96)",
              border: indexActive
                ? "2px solid rgba(26,152,80,0.6)"
                : "1px solid rgba(250,204,21,0.3)",
              backdropFilter: "blur(12px)",
              color: "white",
              fontSize: 12,
              boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>🔍 Find my area</div>
              <button
                type="button"
                onClick={() => setIndexOpen(false)}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  width: 26, height: 26,
                  borderRadius: 999,
                  fontSize: 15, lineHeight: 1,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 14, lineHeight: 1.5 }}>
              Tell us what matters to you — we&apos;ll score every cell on the map and colour it green (great match) to red (poor match).
            </div>

            {/* Budget */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>
                  💰 Budget ({state.metric === "median_ppsf" ? "per ft²" : "price"})
                </span>
                <span style={{ fontSize: 12, opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
                  £{indexBudget.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                min={state.metric === "median_ppsf" ? 50 : 50000}
                max={state.metric === "median_ppsf" ? 1000 : 2000000}
                step={state.metric === "median_ppsf" ? 10 : 10000}
                value={indexBudget}
                onChange={(e) => setIndexBudget(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#facc15" }}
              />
            </div>

            {/* Property type */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>🏠 Property type</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(["ALL", "D", "S", "T", "F"] as const).map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setIndexPropertyType(pt)}
                    style={{
                      cursor: "pointer",
                      border: indexPropertyType === pt ? "2px solid rgba(250,204,21,0.8)" : "1px solid rgba(255,255,255,0.18)",
                      background: indexPropertyType === pt ? "rgba(250,204,21,0.2)" : "rgba(255,255,255,0.06)",
                      color: "white",
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: indexPropertyType === pt ? 700 : 400,
                    }}
                  >
                    {PROPERTY_LABEL[pt]}
                  </button>
                ))}
              </div>
            </div>

            {/* Affordability weight */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>💰 Affordability importance</span>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{indexAffordWeight}/10</span>
              </div>
              <input
                type="range" min={0} max={10} step={1}
                value={indexAffordWeight}
                onChange={(e) => setIndexAffordWeight(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#facc15" }}
              />
            </div>

            {/* Flood weight */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>🌊 Flood safety importance</span>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{indexFloodWeight}/10</span>
              </div>
              <input
                type="range" min={0} max={10} step={1}
                value={indexFloodWeight}
                onChange={(e) => setIndexFloodWeight(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#60a5fa" }}
              />
            </div>

            {/* School weight */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>🏫 School quality importance</span>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{indexSchoolWeight}/10</span>
              </div>
              <input
                type="range" min={0} max={10} step={1}
                value={indexSchoolWeight}
                onChange={(e) => setIndexSchoolWeight(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#22c55e" }}
              />
            </div>

            {/* Coast weight – placeholder */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12, opacity: 0.5 }}>🏖️ Coast proximity (coming soon)</span>
                <span style={{ fontSize: 12, opacity: 0.4 }}>{indexCoastWeight}/10</span>
              </div>
              <input
                type="range" min={0} max={10} step={1}
                value={indexCoastWeight}
                onChange={(e) => setIndexCoastWeight(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#94a3b8", opacity: 0.4 }}
                disabled
              />
            </div>

            <div style={{ marginBottom: 14, fontSize: 11, opacity: 0.72, lineHeight: 1.35 }}>
              Suitability filter is available in the right-side panel after scoring.
            </div>

            {/* Score / Clear buttons */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setIndexApplied({
                    budget: indexBudget,
                    propertyType: indexPropertyType,
                    affordWeight: indexAffordWeight,
                    floodWeight: indexFloodWeight,
                    schoolWeight: indexSchoolWeight,
                    coastWeight: indexCoastWeight,
                  });
                  setGridMode("manual");
                  setState((s) => ({ ...s, grid: "1km" }));
                  setIndexScoringPending(true);
                  setIndexActive(true);
                  setIndexToken((t) => t + 1);
                  setIndexOpen(false);
                }}
                style={{
                  flex: 1,
                  cursor: "pointer",
                  border: "2px solid rgba(26,152,80,0.7)",
                  background: "rgba(26,152,80,0.28)",
                  color: "white",
                  padding: "10px 14px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {indexScoringPending ? "⏳ Scoring..." : "🗺️ Score areas"}
              </button>
              {indexActive && (
                <button
                  type="button"
                  onClick={() => { setIndexScoringPending(false); setIndexActive(false); setIndexOpen(false); }}
                  style={{
                    flex: 1,
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    padding: "10px 14px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Clear scores
                </button>
              )}
            </div>

            {indexActive && (
              <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6, lineHeight: 1.4, textAlign: "center" }}>
                🟢 Great match → 🟡 Average → 🔴 Poor match
              </div>
            )}

            {!indexActive && (
              <button
                type="button"
                onClick={() => setIndexOpen(false)}
                style={{
                  marginTop: 10,
                  width: "100%",
                  cursor: "pointer",
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 12,
                  padding: "6px 0 2px",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                Skip — explore manually
              </button>
            )}
          </div>
        </div>
      )}

      {/* Right-side stacked panels */}
      {(!isMobileViewport || !postcodeOpen) &&
        !cleanScreenMode &&
        (indexActive || legendOpen || state.metric === "median" || state.metric === "median_ppsf" || state.metric === "delta_gbp" || state.metric === "delta_pct") && (
        <div
          ref={rightPanelsRef}
          className="right-panels"
          data-menu-open={anySubpanelOpen ? "true" : "false"}
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width: 520,
            maxWidth: "calc(100vw - 36px)",
            zIndex: frontZ("rightpanels", 45),
          }}
          onMouseDown={() => bringToFront("rightpanels")}
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
              <div className="mobile-header-extra" style={{ fontSize: 10, opacity: 0.7 }}>Flood, schools, votes</div>
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
              <div style={{ fontSize: 12, opacity: 0.8 }}>Schools</div>
              <Segment
                options={["off", "on", "on_hide_cells"]}
                value={state.schoolOverlayMode}
                onChange={(v) => setState((s) => ({ ...s, schoolOverlayMode: v as SchoolOverlayMode }))}
                renderOption={(v) => {
                  if (v === "on") return "On";
                  if (v === "on_hide_cells") return "On (hide cells)";
                  return "Off";
                }}
              />
              <div style={{ fontSize: 12, opacity: 0.8 }}>Political votes</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "nowrap",
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                }}
              >
                <Segment
                  compact
                  options={["off", "on"]}
                  value={state.voteOverlayMode}
                  onChange={(v) => setState((s) => ({ ...s, voteOverlayMode: v as VoteOverlayMode }))}
                  renderOption={(v) => (v === "on" ? "On" : "Off")}
                />
                <Segment
                  compact
                  options={["relative", "absolute"]}
                  value={state.voteColorScale}
                  onChange={(v) => setState((s) => ({ ...s, voteColorScale: v as VoteColorScale }))}
                  renderOption={(v) => (v === "relative" ? "Relative" : "Absolute")}
                />
                <button
                  type="button"
                  onClick={() => setVoteKeyOpen((x) => !x)}
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    flex: "0 0 auto",
                  }}
                >
                  {voteKeyOpen ? "Hide key" : "Open key"}
                </button>
              </div>
            </div>
            {voteKeyOpen && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  fontSize: 10,
                  lineHeight: 1.35,
                  opacity: 0.9,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Election overlay key</div>
                <div><b>Progressive:</b> Labour, Lib Dem, Green, SNP, Plaid Cymru, Alliance, SDLP, Sinn Féin (+ aligned).</div>
                <div style={{ marginTop: 4 }}><b>Conservative:</b> Conservative and unionist family parties.</div>
                <div style={{ marginTop: 4 }}><b>Popular Right:</b> Reform UK and related right-populist parties.</div>
              </div>
            )}
          </div>

          {!indexActive && (
            state.metric === "median" ||
            state.metric === "median_ppsf" ||
            state.metric === "delta_gbp" ||
            state.metric === "delta_pct") && (
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
                      : state.metric === "median_ppsf"
                        ? "Price / ft² filter"
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

          {(legendOpen || indexActive) && (
            <div
              className="legend"
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 14,
                background: "rgba(10, 12, 20, 0.85)",
                border: indexActive ? "1px solid rgba(26,152,80,0.4)" : "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 13,
              }}
            >
              {legendContent}
            </div>
          )}

          {/* Index suitability panel when scoring is active */}
          {indexActive && !indexOpen && (
            <div
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 14,
                background: "rgba(10, 12, 20, 0.9)",
                border: "2px solid rgba(26,152,80,0.5)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 12,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Median value filter</div>
                <div style={{ fontSize: 11, opacity: 0.78 }}>0%–100%</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Mode</div>
                <Segment
                  options={["off", "lte", "gte"]}
                  value={indexSuitabilityMode}
                  onChange={(v) => setIndexSuitabilityMode(v as ValueFilterMode)}
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

              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 12, opacity: indexSuitabilityMode === "off" ? 0.5 : 0.8 }}>Threshold</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={indexSuitabilityThreshold}
                    onChange={(e) => setIndexSuitabilityThreshold(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#22c55e", opacity: indexSuitabilityMode === "off" ? 0.55 : 1 }}
                    disabled={indexSuitabilityMode === "off"}
                  />
                  <div style={{ fontSize: 11, opacity: 0.8 }}>
                    {indexSuitabilityMode === "off"
                      ? "Showing all suitability levels"
                      : indexSuitabilityMode === "gte"
                        ? `Above ${indexSuitabilityThreshold}%`
                        : `Below ${indexSuitabilityThreshold}%`}
                  </div>
                </div>
              </div>

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
                  {currentFiltersSummary}
                </div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                  {`Suitability filter: ${indexSuitabilityLabel}`}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setIndexOpen(true)}
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    padding: "5px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Edit scoring
                </button>
                <button
                  type="button"
                  onClick={() => { setIndexScoringPending(false); setIndexActive(false); setIndexOpen(false); }}
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(239,68,68,0.3)",
                    background: "rgba(239,68,68,0.12)",
                    color: "white",
                    padding: "5px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isMobileViewport && cleanScreenMode && !postcodeOpen && !instructionsOpen && (
        <div
          className="right-panels"
          style={{
            right: 12,
            left: 12,
            width: "auto",
            maxWidth: "none",
            bottom: 12,
            position: "fixed",
            zIndex: 3,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: "54svh",
            overflow: "auto",
          }}
        >
          <div
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 12,
              background: "rgba(10, 12, 20, 0.85)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "white",
              fontSize: 10,
              lineHeight: 1.35,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Current filters</div>
            <div style={{ opacity: 0.82 }}>{currentFiltersSummary}</div>
            <div style={{ opacity: 0.82, marginTop: 3 }}>{`Value filter: ${valueFilterLabel}`}</div>
          </div>
          <div
            className="legend"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(10, 12, 20, 0.85)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "white",
              fontSize: 12,
            }}
          >
            {legendContent}
          </div>
        </div>
      )}

      {isMobileViewport && (
        <button
          type="button"
          onClick={() => setCleanScreenMode((v) => !v)}
          aria-label={cleanScreenMode ? "Restore previous screen" : "Clear screen"}
          title={cleanScreenMode ? "Restore previous screen" : "Clear screen"}
          style={{
            position: "fixed",
            right: 8,
            top: clearButtonTop,
            zIndex: 6,
            border: "1px solid rgba(255,255,255,0.24)",
            background: cleanScreenMode ? "rgba(147,197,253,0.9)" : "rgba(10, 12, 20, 0.88)",
            color: "white",
            borderRadius: 8,
            width: 64,
            height: 28,
            minWidth: 64,
            minHeight: 28,
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1,
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            animation: !cleanScreenMode && mobileOverlayRatio > 0.5 ? "cleanScreenPulse 1100ms ease-in-out infinite" : "none",
          }}
        >
          {cleanScreenMode ? "Restore" : "Clear"}
        </button>
      )}

      {!cleanScreenMode &&
        !anySubpanelOpen &&
        (
        <div className="mobile-grid-dock" aria-label="Map grid controls">
          <button
            type="button"
            className="mobile-grid-btn"
            onClick={cycleMobileQuickFilter}
            aria-label={`Cycle quick filter (${currentMobileQuickFilterLabel})`}
            title={`Cycle quick filter: ${currentMobileQuickFilterLabel}`}
          >
            →
          </button>
          <div className="mobile-grid-label" aria-live="polite">
            {currentMobileQuickFilterLabel}
          </div>
          {mobileQuickFilterKey === "metric" && (
            <>
              <button
                type="button"
                className={state.metric === "median" ? "mobile-grid-btn active" : "mobile-grid-btn"}
                onClick={() => setState((s) => ({ ...s, metric: "median" }))}
              >
                Median
              </button>
              <button
                type="button"
                className={state.metric === "median_ppsf" ? "mobile-grid-btn active" : "mobile-grid-btn"}
                onClick={() => setState((s) => ({ ...s, metric: "median_ppsf" }))}
              >
                £/ft²
              </button>
              <button
                type="button"
                className={state.metric === "delta_gbp" ? "mobile-grid-btn active" : "mobile-grid-btn"}
                onClick={() => setState((s) => ({ ...s, metric: "delta_gbp", grid: s.grid === "1km" ? "5km" : s.grid }))}
              >
                Δ GBP
              </button>
              <button
                type="button"
                className={state.metric === "delta_pct" ? "mobile-grid-btn active" : "mobile-grid-btn"}
                onClick={() => setState((s) => ({ ...s, metric: "delta_pct", grid: s.grid === "1km" ? "5km" : s.grid }))}
              >
                Δ %
              </button>
            </>
          )}
          {mobileQuickFilterKey === "propertyType" && (
            <>
              <button type="button" className={state.propertyType === "ALL" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, propertyType: "ALL" }))}>All</button>
              <button type="button" className={state.propertyType === "D" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, propertyType: "D" }))}>D</button>
              <button type="button" className={state.propertyType === "S" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, propertyType: "S" }))}>S</button>
              <button type="button" className={state.propertyType === "T" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, propertyType: "T" }))}>T</button>
              <button type="button" className={state.propertyType === "F" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, propertyType: "F" }))}>F</button>
            </>
          )}
          {mobileQuickFilterKey === "newBuild" && (
            <>
              <button type="button" className={state.newBuild === "ALL" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, newBuild: "ALL" }))}>All</button>
              <button type="button" className={state.newBuild === "Y" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, newBuild: "Y" }))}>New</button>
              <button type="button" className={state.newBuild === "N" ? "mobile-grid-btn active" : "mobile-grid-btn"} onClick={() => setState((s) => ({ ...s, newBuild: "N" }))}>Existing</button>
            </>
          )}
          {mobileQuickFilterKey === "period" && (
            <>
              {PERIOD_OPTIONS.map((period) => (
                <button
                  key={period}
                  type="button"
                  className={(state.endMonth ?? "2025-12-01") === period ? "mobile-grid-btn active" : "mobile-grid-btn"}
                  onClick={() => setState((s) => ({ ...s, endMonth: period }))}
                >
                  {PERIOD_LABEL[period] ?? period}
                </button>
              ))}
            </>
          )}
          {mobileQuickFilterKey === "grid" && (
            <>
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
                disabled={state.metric !== "median" && state.metric !== "median_ppsf"}
                className={gridMode === "manual" && state.grid === "1km" ? "mobile-grid-btn active" : "mobile-grid-btn"}
                onClick={() => {
                  if (state.metric !== "median" && state.metric !== "median_ppsf") return;
                  setGridMode("manual");
                  setState((s) => ({ ...s, grid: "1km" }));
                }}
              >
                1km
              </button>
            </>
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
  compact = false,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  renderOption?: (v: string) => string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "segment segment-compact" : "segment"}
      style={{
        display: "flex",
        borderRadius: 999,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        width: "fit-content",
        flexWrap: compact ? "nowrap" : "wrap",
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
      @keyframes cleanScreenPulse {
        0% {
          transform: scale(1);
          box-shadow: 0 2px 10px rgba(0,0,0,0.35), 0 0 0 0 rgba(239,68,68,0.35);
        }
        50% {
          transform: scale(1.06);
          box-shadow: 0 0 0 7px rgba(239,68,68,0.42), 0 2px 14px rgba(0,0,0,0.45);
        }
        100% {
          transform: scale(1);
          box-shadow: 0 2px 10px rgba(0,0,0,0.35), 0 0 0 0 rgba(239,68,68,0.35);
        }
      }
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border: 1px solid rgba(255,255,255,0.24);
        background: rgba(10, 12, 20, 0.9);
        color: white;
        padding: 7px 10px;
        border-radius: 9px;
        font-size: 11px;
        font-weight: 600;
        box-shadow: 0 2px 10px rgba(0,0,0,0.35);
        min-width: 58px;
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
      .mobile-grid-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255,255,255,0.24);
        background: rgba(30, 41, 59, 0.9);
        color: white;
        padding: 7px 10px;
        border-radius: 9px;
        font-size: 11px;
        font-weight: 800;
        min-width: 58px;
        text-align: center;
        line-height: 1.1;
        box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      }
      .mobile-grid-dock {
        display: inline-flex;
        position: fixed;
        left: 14px;
        right: auto;
        top: 56%;
        bottom: auto;
        transform: translateY(-50%);
        z-index: 5;
        gap: 5px;
        flex-direction: column;
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
        .mobile-grid-label {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255,255,255,0.24);
          background: rgba(30, 41, 59, 0.9);
          color: white;
          padding: 6px 8px;
          border-radius: 8px;
          font-size: 10px;
          font-weight: 800;
          min-width: 48px;
          text-align: center;
          line-height: 1.1;
          box-shadow: 0 2px 10px rgba(0,0,0,0.35);
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
        .segment-compact {
          width: fit-content !important;
          display: inline-flex !important;
          grid-template-columns: none !important;
          gap: 0 !important;
          border: 1px solid rgba(255,255,255,0.14) !important;
          background: rgba(255,255,255,0.06) !important;
          padding: 0 !important;
        }
        .segment-compact .segment-btn {
          border: none !important;
          border-radius: 0 !important;
          min-width: 0 !important;
          padding: 6px 10px !important;
          font-size: 11px !important;
          background: transparent !important;
          white-space: nowrap !important;
        }
        .segment-compact .segment-btn.active {
          background: rgba(255,255,255,0.16) !important;
          border-color: transparent !important;
          box-shadow: none !important;
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



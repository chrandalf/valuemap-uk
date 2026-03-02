"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ValueMap, { type LegendData, type LocateMeResult, type IndexPrefs, type RgLogEntry, type RightClickInfoData } from "./Map";
import GuidedTour, { type TourStep } from "./components/GuidedTour";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "median_ppsf" | "delta_gbp" | "delta_pct";
type PropertyType = "ALL" | "D" | "S" | "T" | "F"; // Detached / Semi / Terraced / Flat
type NewBuild = "ALL" | "Y" | "N";
type ValueFilterMode = "off" | "lte" | "gte";
type FloodOverlayMode = "off" | "on" | "on_hide_cells";
type SchoolOverlayMode = "off" | "on" | "on_hide_cells";
type StationOverlayMode = "off" | "on" | "on_hide_cells";
type VoteOverlayMode = "off" | "on";
type CommuteOverlayMode = "off" | "on";
type AgeOverlayMode = "off" | "on";
type VoteColorScale = "relative" | "absolute";
type GridMode = "auto" | "manual";

type IndexScoringPrefs = {
  budget: number;
  propertyType: "ALL" | "D" | "S" | "T" | "F";
  affordWeight: number;
  floodWeight: number;
  schoolWeight: number;
  trainWeight: number;
  coastWeight: number;
  ageWeight?: number;
  ageDirection?: "young" | "old";
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
  stationOverlayMode: StationOverlayMode;
  voteOverlayMode: VoteOverlayMode;
  voteColorScale: VoteColorScale;
  commuteOverlayMode: CommuteOverlayMode;
  ageOverlayMode: AgeOverlayMode;
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

// ── Find My Area: importance picker ─────────────────────────────────────
const IMP_LEVELS = [
  { label: "Must",  value: 10 },
  { label: "Want",  value: 6  },
  { label: "Nice",  value: 3  },
  { label: "Off",   value: 0  },
] as const;

function snapToLevel(v: number): number {
  return IMP_LEVELS.reduce<number>(
    (best, l) => (Math.abs(v - l.value) < Math.abs(v - best) ? l.value : best),
    IMP_LEVELS[0].value
  );
}

function ImportancePicker({
  emoji, label, value, onChange, color, disabled,
}: {
  emoji: string; label: string; value: number;
  onChange: (v: number) => void; color: string; disabled?: boolean;
}) {
  const active = snapToLevel(value);
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
      opacity: disabled ? 0.38 : 1,
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, flex: "0 0 auto", minWidth: 100 }}>
        {emoji} {label}
      </span>
      <div style={{ display: "flex", gap: 3 }}>
        {IMP_LEVELS.map(({ label: lbl, value: v }) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(v)}
            style={{
              cursor: disabled ? "default" : "pointer",
              padding: "3px 8px",
              borderRadius: 6,
              fontSize: 10,
              fontWeight: active === v ? 700 : 400,
              border: active === v ? `1.5px solid ${color}` : "1px solid rgba(255,255,255,0.13)",
              background: active === v ? `${color}30` : "rgba(255,255,255,0.04)",
              color: active === v ? "white" : "rgba(255,255,255,0.5)",
              lineHeight: 1.4, minWidth: 36, textAlign: "center",
            }}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState<MapState>(() => {
    const defaults: MapState = {
      grid: "5km",
      metric: "median",
      propertyType: "ALL",
      newBuild: "ALL",
      endMonth: "2025-12-01",
      valueFilterMode: "off",
      valueThreshold: 300000,
      floodOverlayMode: "off",
      schoolOverlayMode: "off",
      stationOverlayMode: "off",
      voteOverlayMode: "off",
      voteColorScale: "relative",
      commuteOverlayMode: "off",
      ageOverlayMode: "off",
    };
    if (typeof window === "undefined") return defaults;
    try {
      const p = new URLSearchParams(window.location.search);
      const grid = p.get("grid");
      const metric = p.get("metric");
      const type = p.get("type");
      const newBuild = p.get("newBuild");
      const period = p.get("period");
      const vfm = p.get("vfm");
      const vth = p.get("vth");
      const flood = p.get("flood");
      const schools = p.get("schools");
      const stations = p.get("stations");
      const vote = p.get("vote");
      const voteScale = p.get("voteScale");
      const commute = p.get("commute");
      const age = p.get("age");
      const GRIDS: GridSize[] = ["1km", "5km", "10km", "25km"];
      const METRICS: Metric[] = ["median", "median_ppsf", "delta_gbp", "delta_pct"];
      const TYPES: PropertyType[] = ["ALL", "D", "S", "T", "F"];
      const NEWBUILDS: NewBuild[] = ["ALL", "Y", "N"];
      const VFMS: ValueFilterMode[] = ["off", "lte", "gte"];
      const FLOODS: FloodOverlayMode[] = ["off", "on", "on_hide_cells"];
      const SCHOOLS: SchoolOverlayMode[] = ["off", "on", "on_hide_cells"];
      const STATIONS: StationOverlayMode[] = ["off", "on", "on_hide_cells"];
      // Only hydrate if at least one known param is present
      if (!grid && !metric && !type && !flood && !schools && !vote && !stations && !commute && !age) return defaults;
      return {
        grid: GRIDS.includes(grid as GridSize) ? (grid as GridSize) : defaults.grid,
        metric: METRICS.includes(metric as Metric) ? (metric as Metric) : defaults.metric,
        propertyType: TYPES.includes(type as PropertyType) ? (type as PropertyType) : defaults.propertyType,
        newBuild: NEWBUILDS.includes(newBuild as NewBuild) ? (newBuild as NewBuild) : defaults.newBuild,
        endMonth: period ?? defaults.endMonth,
        valueFilterMode: VFMS.includes(vfm as ValueFilterMode) ? (vfm as ValueFilterMode) : defaults.valueFilterMode,
        valueThreshold: vth ? parseFloat(vth) : defaults.valueThreshold,
        floodOverlayMode: FLOODS.includes(flood as FloodOverlayMode) ? (flood as FloodOverlayMode) : defaults.floodOverlayMode,
        schoolOverlayMode: SCHOOLS.includes(schools as SchoolOverlayMode) ? (schools as SchoolOverlayMode) : defaults.schoolOverlayMode,
        stationOverlayMode: STATIONS.includes(stations as StationOverlayMode) ? (stations as StationOverlayMode) : defaults.stationOverlayMode,
        voteOverlayMode: vote === "on" ? "on" : defaults.voteOverlayMode,
        voteColorScale: voteScale === "absolute" ? "absolute" : defaults.voteColorScale,
        commuteOverlayMode: commute === "on" ? "on" : defaults.commuteOverlayMode,
        ageOverlayMode: age === "on" ? "on" : defaults.ageOverlayMode,
      };
    } catch {
      return defaults;
    }
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
  const [easyColours, setEasyColours] = useState(() => {
    try { return localStorage.getItem("valuemap_easy_colours") === "1"; } catch { return false; }
  });
  const [mobileFiltersActiveOpen, setMobileFiltersActiveOpen] = useState(false);
  const [postcodeSearch, setPostcodeSearch] = useState("");
  const [activePostcodeSearch, setActivePostcodeSearch] = useState("");
  const [postcodeSearchToken, setPostcodeSearchToken] = useState(0);
  const [postcodeSearchClearToken, setPostcodeSearchClearToken] = useState(0);
  const [postcodeSearchStatus, setPostcodeSearchStatus] = useState<string | null>(null);
  const [tapToSearch, setTapToSearch] = useState(false);
  const [rgLog, setRgLog] = useState<RgLogEntry[]>([]);
  const [rgLogOpen, setRgLogOpen] = useState(false);
  const [rightClickInfo, setRightClickInfo] = useState<RightClickInfoData | null>(null);
  const [rgPanelMinimized, setRgPanelMinimized] = useState(false);
  const [rgDismissToken, setRgDismissToken] = useState(0);
  const [locateMeToken, setLocateMeToken] = useState(0);
  const [locateMeStatus, setLocateMeStatus] = useState<string | null>(null);
  const [locateMeSummary, setLocateMeSummary] = useState<string | null>(null);
  const [supporterNames, setSupporterNames] = useState<string[]>([]);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [gridMode, setGridMode] = useState<GridMode>("manual");
  const [mapStats, setMapStats] = useState<{ label: string; value: string; txCount: number } | null>(null);
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  const [cleanScreenMode, setCleanScreenMode] = useState(false);
  const [controlsDropOpen, setControlsDropOpen] = useState(false);
  const [infoDropOpen, setInfoDropOpen] = useState(false);
  const [overlaysDropOpen, setOverlaysDropOpen] = useState(false);
  const [docModalSrc, setDocModalSrc] = useState<string | null>(null);
  const [panelFront, setPanelFront] = useState<Record<string, number>>({});
  const zSeqRef = useRef(0);
  const controlsDropRef = useRef<HTMLDivElement | null>(null);
  const infoDropRef = useRef<HTMLDivElement | null>(null);
  const overlaysDropRef = useRef<HTMLDivElement | null>(null);
  const [mobileOverlayRatio, setMobileOverlayRatio] = useState(0);
  const [mobileQuickFilterKey, setMobileQuickFilterKey] = useState<MobileQuickFilterKey>("grid");
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexActive, setIndexActive] = useState(false);
  const [indexScoringPending, setIndexScoringPending] = useState(false);
  const [indexToken, setIndexToken] = useState(0);
  const [indexBudget, setIndexBudget] = useState(300000);
  const [indexPropertyType, setIndexPropertyType] = useState<"ALL" | "D" | "S" | "T" | "F">("ALL");
  const [indexAffordWeight, setIndexAffordWeight] = useState(0);
  const [indexFloodWeight, setIndexFloodWeight] = useState(0);
  const [indexSchoolWeight, setIndexSchoolWeight] = useState(0);
  const [indexTrainWeight, setIndexTrainWeight] = useState(0);
  const [indexCoastWeight, setIndexCoastWeight] = useState(0);
  const [indexAgeWeight, setIndexAgeWeight] = useState(0);
  const [indexAgeDirection, setIndexAgeDirection] = useState<"young" | "old">("young");
  const [indexApplied, setIndexApplied] = useState<IndexScoringPrefs>({
    budget: 300000,
    propertyType: "ALL",
    affordWeight: 0,
    floodWeight: 0,
    schoolWeight: 0,
    trainWeight: 0,
    coastWeight: 0,
  });
  const [indexSuitabilityMode, setIndexSuitabilityMode] = useState<ValueFilterMode>("off");
  const [indexSuitabilityThreshold, setIndexSuitabilityThreshold] = useState(65);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [showMePulse, setShowMePulse] = useState(true);
  const [flyToRequest, setFlyToRequest] = useState<{ center: [number, number]; zoom: number; token: number } | null>(null);
  const flyToSeqRef = useRef(0);
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
      trainWeight: indexApplied.trainWeight,
      coastWeight: indexApplied.coastWeight,
      ageWeight: indexApplied.ageWeight ?? 0,
      ageDirection: indexApplied.ageDirection ?? "young",
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
    stationOverlayMode: "off",
    voteOverlayMode: "off",
    voteColorScale: "relative",
    commuteOverlayMode: "off",
    ageOverlayMode: "off",
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
    setOverlaysDropOpen(false);
    setActivePostcodeSearch("");
    setPostcodeSearchStatus(null);
    setPostcodeSearchClearToken((v) => v + 1);
    setIndexOpen(false);
    setIndexActive(false);
    setIndexScoringPending(false);
    setIndexBudget(300000);
    setIndexPropertyType("ALL");
    setIndexAffordWeight(0);
    setIndexFloodWeight(0);
    setIndexSchoolWeight(0);
    setIndexTrainWeight(0);
    setIndexCoastWeight(0);
    setIndexAgeWeight(0);
    setIndexAgeDirection("young");
    setIndexApplied({
      budget: 300000,
      propertyType: "ALL",
      affordWeight: 0,
      floodWeight: 0,
      schoolWeight: 0,
      trainWeight: 0,
      coastWeight: 0,
      ageWeight: 0,
    });
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!controlsDropOpen && !infoDropOpen && !overlaysDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (controlsDropOpen && controlsDropRef.current && !controlsDropRef.current.contains(e.target as Node)) {
        setControlsDropOpen(false);
      }
      if (infoDropOpen && infoDropRef.current && !infoDropRef.current.contains(e.target as Node)) {
        setInfoDropOpen(false);
      }
      if (overlaysDropOpen && overlaysDropRef.current && !overlaysDropRef.current.contains(e.target as Node)) {
        setOverlaysDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [controlsDropOpen, infoDropOpen, overlaysDropOpen]);

  useEffect(() => {
    if (!activePostcodeSearch.trim()) return;
    setPostcodeSearchToken((v) => v + 1);
  }, [state.floodOverlayMode, state.schoolOverlayMode, state.stationOverlayMode, activePostcodeSearch]);

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
    // Stop the pulse animation if user has already completed the tour
    try {
      const tourDone = localStorage.getItem("valuemap_tour_done");
      if (tourDone === "1") setShowMePulse(false);
    } catch { /* ignore */ }
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
    state.stationOverlayMode,
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

  // Close doc modal when iframe BackToMapChip sends a postMessage
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data === "close-doc-modal") setDocModalSrc(null);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
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
    params.set("stations", state.stationOverlayMode);
    params.set("vote", state.voteOverlayMode);
    params.set("voteScale", state.voteColorScale);
    params.set("commute", state.commuteOverlayMode);
    params.set("age", state.ageOverlayMode);

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

  const commuteLegendContent = (
    <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 10, fontSize: 16, opacity: 0.9 }}>
        🚗 Commute distance (Census 2021)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "86px 1fr 86px", gap: 8, alignItems: "center" }}>
        <div style={{ textAlign: "left", fontSize: 11, opacity: 0.85 }}>WFH / short</div>
        <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", border: "1px solid rgba(255,255,255,0.2)" }}>
          {(easyColours
            ? ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#d6604d", "#b2182b"]
            : ["#15803d", "#86efac", "#fef08a", "#fb923c", "#ef4444", "#7f1d1d"]
          ).map((c, i) => (
            <div key={i} style={{ flex: 1, backgroundColor: c }} />
          ))}
        </div>
        <div style={{ textAlign: "right", fontSize: 11, opacity: 0.85 }}>Long (17km+)</div>
      </div>
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.6 }}>
        <span>0 km</span><span>~4 km</span><span>~7 km</span><span>~10 km</span><span>~14 km</span><span>17 km</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8, lineHeight: 1.35 }}>
        Mean distance travelled to work per 1km² census area (LSOA). Census 2021, England &amp; Wales only.
      </div>
    </>
  );

  const ageLegendContent = (
    <>
      <div className="legend-title" style={{ fontWeight: 600, marginBottom: 10, fontSize: 16, opacity: 0.9 }}>
        👥 Community age mix (Census 2021)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 60px", gap: 8, alignItems: "center" }}>
        <div style={{ textAlign: "left", fontSize: 11, opacity: 0.85 }}>Older</div>
        <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", border: "1px solid rgba(255,255,255,0.2)" }}>
          {(easyColours
            ? ["#762a83", "#af8dc3", "#f7f7f7", "#d9f0a3", "#1a7837"]
            : ["#1e3a8a", "#60a5fa", "#e5e7eb", "#fbbf24", "#b45309"]
          ).map((c, i) => (
            <div key={i} style={{ flex: 1, backgroundColor: c }} />
          ))}
        </div>
        <div style={{ textAlign: "right", fontSize: 11, opacity: 0.85 }}>Younger</div>
      </div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 4, fontSize: 10 }}>
        {[
          ["#60a5fa", "Under 15"],
          ["#34d399", "15–24"],
          ["#facc15", "25–44"],
          ["#fb923c", "45–64"],
          ["#f87171", "65+"],
        ].map(([col, lbl]) => (
          <span key={lbl} style={{ display: "flex", alignItems: "center", gap: 3, opacity: 0.75 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: col, flexShrink: 0, display: "inline-block" }} />
            {lbl}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8, lineHeight: 1.35 }}>
        Mean age and broad band distribution per LSOA. Census 2021, England &amp; Wales only.
      </div>
    </>
  );

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
        Based on your preferences: max price, flood safety, school quality. Greener cells are a better fit.
      </div>
    </>
  );

  const legendContent = (
    <>
      {indexActive && indexLegendContent}
      {state.schoolOverlayMode !== "off" && schoolLegendContent}
      {!indexActive && state.ageOverlayMode === "on" && ageLegendContent}
      {!indexActive && state.ageOverlayMode !== "on" && state.commuteOverlayMode === "on" && commuteLegendContent}
      {!indexActive && state.ageOverlayMode !== "on" && state.commuteOverlayMode !== "on" && state.voteOverlayMode === "on" && voteLegendContent}
      {!indexActive && state.ageOverlayMode !== "on" && state.commuteOverlayMode !== "on" && state.voteOverlayMode !== "on" && (
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
    if (state.stationOverlayMode !== "off" && result.stationNearest) {
      const distMiles = (result.stationNearest.distanceMeters / 1609).toFixed(1);
      chunks.push(
        `Nearest station ${result.stationNearest.name} (${distMiles}mi, ${result.stationNearest.distanceMeters}m)`
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
      ? "Off (all areas shown)"
      : `${indexSuitabilityMode === "lte" ? "Score ≤" : "Score ≥"} ${indexSuitabilityThreshold}%`;
  const compactIndexUi = isMobileViewport;
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
  const anyOverlayActive = state.floodOverlayMode !== "off" || state.schoolOverlayMode !== "off" || state.stationOverlayMode !== "off" || state.voteOverlayMode !== "off" || state.commuteOverlayMode !== "off" || state.ageOverlayMode !== "off";

  const currentFiltersSummary =
    `Grid: ${state.grid} · Metric: ${METRIC_LABEL[state.metric]} · ` +
    `Type: ${PROPERTY_LABEL[state.propertyType]} · New build: ${NEWBUILD_LABEL[state.newBuild]} · ` +
    `Period: ${periodLabel} · Flood: ${floodOverlayLabel} · Schools: ${schoolOverlayLabel} · ` +
    `Stations: ${state.stationOverlayMode === "off" ? "Off" : state.stationOverlayMode === "on" ? "On" : "On (hide cells)"} · ` +
    `Vote overlay: ${voteOverlayLabel} (${voteScaleLabel}) · ` +
    `Commute: ${state.commuteOverlayMode === "on" ? "On" : "Off"} · ` +
    `Age mix: ${state.ageOverlayMode === "on" ? "On" : "Off"}`;
  const headerFilterSummary =
    `${state.grid} · ${METRIC_LABEL[state.metric]} · ${PROPERTY_LABEL[state.propertyType]} · ${NEWBUILD_LABEL[state.newBuild]} · ${periodLabel}`;
  const headerMedianSummary =
    !isDeltaMetric(state.metric) && medianLegend
      ? `${formatMetricFilterValue(state.metric, medianLegend.breaks[0])}–${formatMetricFilterValue(state.metric, medianLegend.breaks[medianLegend.breaks.length - 1])}`
      : null;
  const indexAffordabilitySummary = `Find my area affordability uses ${PROPERTY_LABEL[indexApplied.propertyType]} medians vs max price ${state.metric === "median_ppsf" ? `£${Math.round(indexApplied.budget).toLocaleString()}/ft²` : `£${Math.round(indexApplied.budget).toLocaleString()}`}`;
  const topBarHeight = isMobileViewport ? 88 : 48;
  const topStripTop = topBarHeight + 4;
  const floatingPanelTop = topBarHeight + 8;
  const clearButtonTop = isMobileViewport ? topBarHeight + 126 : 162;

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

  /* ═══ Guided tour step definitions ═══ */
  const tourFlyTo = useCallback((center: [number, number], zoom: number) => {
    const t = ++flyToSeqRef.current;
    setFlyToRequest({ center, zoom, token: t });
  }, []);

  const startTour = useCallback(() => {
    // Reset UI to clean state before starting
    closeAllSubpanels();
    setControlsDropOpen(false);
    setInfoDropOpen(false);
    setIndexOpen(false);
    setIndexActive(false);
    setCleanScreenMode(false);
    setTourStep(0);
    setTourActive(true);
    setShowMePulse(false);
    // Reset map to default view
    setState((s) => ({ ...s, grid: "5km", metric: "median", propertyType: "ALL", floodOverlayMode: "off", schoolOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off" }));
    const t = ++flyToSeqRef.current;
    setFlyToRequest({ center: [-1.5, 53.5], zoom: 5, token: t });
  }, []);

  const endTour = useCallback(() => {
    setTourActive(false);
    setTourStep(0);
    setShowMePulse(false);
    setCleanScreenMode(false);
    // Reset everything the demo may have changed
    resetAll();
    // Fly back to default UK view
    const t = ++flyToSeqRef.current;
    setFlyToRequest({ center: [-1.5, 53.5], zoom: 5, token: t });
    // Remember tour was completed/dismissed
    try { localStorage.setItem("valuemap_tour_done", "1"); } catch { /* ignore */ }
  }, []);

  const tourSteps: TourStep[] = useMemo(() => [
    /* ═══ 0 — Welcome ═══ */
    {
      target: null,
      title: "Welcome to the UK House Price Grid",
      text: "I'll walk you through the map section by section. Each section has a \"Show me\" button that demonstrates exactly what to do — or you can skip ahead. You can zoom in and out at any time using your scroll wheel or pinching on mobile. Let's begin!",
      placement: "center" as const,
    },

    /* ═══ 1 — Section intro: Find My Area ═══ */
    {
      target: null,
      title: "🔍 Finding Your Perfect Area",
      text: "Find My Area scores the entire map based on your max price and what matters to you. Areas light up green (great match) to red (poor match). Want to see how it works?",
      placement: "center" as const,
      isSectionIntro: true,
      nextSectionIndex: 15,
    },

    /* 2 — Demo: open Controls dropdown */
    {
      target: "[data-tour='controls-menu']",
      title: "Step 1 — Open the Controls menu",
      text: "First, you'd tap Controls. I've opened it for you — see the options highlighted: Filters, Find my area, and Reset all. Let's tap Find my area.",
      placement: "right" as const,
      noOverlay: true,
      enterDelay: 500,
      onEnter: () => { if (isMobileViewport) setCleanScreenMode(false); closeAllSubpanels(); setInfoDropOpen(false); setControlsDropOpen(true); },
    },

    /* 3 — Demo: open Find My Area modal */
    {
      target: "[data-tour='index-modal']",
      title: "Step 2 — The Find My Area panel",
      text: "This panel is where you set up your search. At the top is your max price — I'm about to set it. Below that are importance sliders for affordability, flood safety, and school quality. Watch as I set them up…",
      placement: "left" as const,
      enterDelay: 600,
      onEnter: () => { setControlsDropOpen(false); setIndexOpen(true); },
    },

    /* 4 — Demo: set budget */
    {
      target: "[data-tour='index-modal']",
      title: "Step 3 — Setting your max price",
      text: "I've set the max price to £350,000. In real use, you'd enter the typical price you expect to pay in the areas you're considering. Areas with medians well above this will score near-zero on affordability.",
      placement: "left" as const,
      enterDelay: 500,
      onEnter: () => { setIndexBudget(350000); },
    },

    /* 5 — Demo: set importance weights */
    {
      target: "[data-tour='index-modal']",
      title: "Step 4 — Adjusting importance sliders",
      text: "Now I've moved the importance sliders: Affordability → 7, Flood safety → 8, School quality → 6. Higher numbers = matters more. These are personal to you — drag them to match your priorities.",
      placement: "left" as const,
      enterDelay: 500,
      onEnter: () => {
        setIndexAffordWeight(7);
        setIndexFloodWeight(8);
        setIndexSchoolWeight(6);
        setIndexCoastWeight(0);
      },
    },

    /* 6 — Demo: press Score areas */
    {
      target: null,
      title: "Step 5 — Pressing Score Areas",
      text: "I've tapped the green \"Score Areas\" button. The map is now calculating how well every 1km cell matches your preferences — watch the colours change…",
      placement: "center" as const,
      enterDelay: 500,
      autoAdvanceOnly: true,
      waitFor: "[data-tour='area-match-filter']",
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setIndexBudget(350000);
        setIndexPropertyType("ALL");
        setIndexAffordWeight(7);
        setIndexFloodWeight(8);
        setIndexSchoolWeight(6);
        setIndexTrainWeight(0);
        setIndexCoastWeight(0);
        setIndexApplied({ budget: 350000, propertyType: "ALL", affordWeight: 7, floodWeight: 8, schoolWeight: 6, trainWeight: 0, coastWeight: 0, ageWeight: 0 });
        setGridMode("manual");
        setState((s) => ({ ...s, grid: "1km" }));
        setIndexScoringPending(true);
        setIndexActive(true);
        setIndexToken((t) => t + 1);
        setIndexSuitabilityMode("off");
        setIndexOpen(false);
      },
    },

    /* 7 — Demo: zoom into results — gentle zoom to ~9 */
    {
      target: null,
      title: "Step 6 — Let's see the results",
      text: "The map is now colour-coded: green = great match, yellow = okay, red = poor match. I'm zooming into Yorkshire — feel free to zoom in/out yourself with the scroll wheel or pinch to explore at your own pace.",
      placement: "top-center" as const,
      enterDelay: 1200,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(true);
        tourFlyTo([-1.55, 53.6], 9);
      },
    },

    /* 8 — Demo: explain cell colours in detail */
    {
      target: null,
      title: "Step 7 — Reading the cell colours",
      text: "Each coloured square is a 1km area. Bright green = 80%+ match, yellow = 40–60%, red = below 30%. Zoom in with your scroll wheel to see individual cells more clearly, or zoom out to see the bigger picture. Try clicking a cell on the map!",
      placement: "top-center" as const,
      noOverlay: true,
      enterDelay: 1200,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(true);
      },
    },

    /* 9 — Demo: explain what's inside a cell */
    {
      target: null,
      title: "Step 8 — What's inside each cell?",
      text: "Go ahead — click any coloured cell on the map now! Because scoring is active, the popup shows your Match Score with a breakdown: how well it scored on Affordability, Flood Safety, and Schools, each weighted by your importance sliders. Close the popup and press Next when you're ready.",
      placement: "top-center" as const,
      noOverlay: true,
      enterDelay: 1200,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(true);
      },
    },

    /* 10 — Demo: area match filter — set to Above 65% */
    {
      target: "[data-tour='area-match-filter']",
      title: "Step 9 — Filtering: show only good matches",
      text: "I've set the match filter to \"Good matches ≥ 65%\". Watch the map — all cells scoring below 65% have just vanished! Only the green and yellow-green areas remain. This instantly narrows your search to areas that genuinely fit your criteria — raise the slider to get an even tighter shortlist.",
      placement: "left" as const,
      enterDelay: 1000,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setIndexSuitabilityMode("gte");
        setIndexSuitabilityThreshold(65);
      },
    },

    /* 11 — Demo: area match filter — switch to Below 65% */
    {
      target: "[data-tour='area-match-filter']",
      title: "Step 10 — The other side: weaker areas",
      text: "Now I've switched to \"Weak areas\". The map flips — only the lower-scoring cells stay visible. Useful for understanding where NOT to look, or for spotting up-and-coming areas that score average on schools but are affordable.",
      placement: "left" as const,
      enterDelay: 1200,
      onEnter: () => {
        setIndexSuitabilityMode("lte");
      },
    },

    /* 12 — Demo: reset filter and explain */
    {
      target: "[data-tour='area-match-filter']",
      title: "Step 11 — Back to the full picture",
      text: "I've set it back to \"All\" so every cell is visible again. In normal use it'll stay on \"Good matches\" after you score — just slide the threshold between 30–90% to be as relaxed or strict as you like.",
      placement: "left" as const,
      enterDelay: 1000,
      onEnter: () => {
        setIndexSuitabilityMode("off");
      },
    },

    /* 13 — Demo: show overlays on top of scoring */
    {
      target: "[data-tour='overlay-panel']",
      title: "Step 12 — Layer extra data on top",
      text: "While scores are active, you can layer overlays on top. I've added flood risk and school quality dots with cells hidden so the dots are clear and clickable. This lets you see which scored areas also have flood concerns or good schools nearby.",
      placement: "left" as const,
      enterDelay: 1000,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setState((s) => ({ ...s, floodOverlayMode: "on_hide_cells", schoolOverlayMode: "on_hide_cells" }));
      },
    },

    /* 14 — Demo: cleanup and zoom-out transition */
    {
      target: null,
      title: "That's Find My Area!",
      text: "You saw how to: set budget → adjust priorities → score → read cells → filter by match level → add overlays. I'm zooming back out to the full UK view for the next section.",
      placement: "center" as const,
      enterDelay: 600,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setIndexScoringPending(false);
        setIndexActive(false);
        setIndexOpen(false);
        setIndexSuitabilityMode("off");
        setState((s) => ({ ...s, grid: "5km", floodOverlayMode: "off", schoolOverlayMode: "off" }));
        tourFlyTo([-1.5, 53.5], 5);
      },
    },

    /* ═══ 15 — Section intro: Manual Exploration ═══ */
    {
      target: null,
      title: "🗺️ Exploring the Map Manually",
      text: "You can also browse the map using quick filters on the left. Change the grid size, metric, property type, and more — each change updates instantly. Want me to show you?",
      placement: "center" as const,
      isSectionIntro: true,
      nextSectionIndex: 23,
      enterDelay: 1000,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        // Ensure we're fully zoomed out — safety net in case prior zoom-out didn't complete
        tourFlyTo([-1.5, 53.5], 5);
      },
    },

    /* 16 — Demo: show quick dock on Grid */
    {
      target: "[data-tour='quick-dock']",
      title: "Step 1 — The quick-filter dock",
      text: "This side dock is your fastest way to change settings. Right now it's showing the Grid options. I've selected 25km — see how each square covers a huge area? Perfect for the national overview.",
      placement: "right" as const,
      enterDelay: 700,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setMobileQuickFilterKey("grid");
        setGridMode("manual");
        setState((s) => ({ ...s, grid: "25km", metric: "median", propertyType: "ALL" }));
        setFiltersOpen(false);
      },
    },

    /* 17 — Demo: 5km grid */
    {
      target: "[data-tour='quick-dock']",
      title: "Step 2 — Switch to 5km",
      text: "Now I've tapped 5km. More squares appear, showing finer local variation. You can go down to 1km for street-level detail. Watch how the map updates instantly.",
      placement: "right" as const,
      enterDelay: 700,
      onEnter: () => { setState((s) => ({ ...s, grid: "5km" })); },
    },

    /* 18 — Demo: cycle dock to Metric */
    {
      target: "[data-tour='quick-dock']",
      title: "Step 3 — Press the arrow → to cycle",
      text: "See the → arrow at the top of the dock? I've tapped it to cycle from Grid to Metric. The dock now shows different measurement options — Median, £/ft², and change metrics.",
      placement: "right" as const,
      enterDelay: 700,
      onEnter: () => {
        setMobileQuickFilterKey("metric");
      },
    },

    /* 19 — Demo: select ppsf */
    {
      target: "[data-tour='quick-dock']",
      title: "Step 4 — Tap £/ft²",
      text: "Now I've tapped £/ft² (price per square foot). This is a fairer way to compare areas because it accounts for home sizes. Notice the legend updated to show £ per ft² values.",
      placement: "right" as const,
      enterDelay: 700,
      onEnter: () => { setState((s) => ({ ...s, metric: "median_ppsf" })); },
    },

    /* 20 — Demo: cycle to Type */
    {
      target: "[data-tour='quick-dock']",
      title: "Step 5 — Arrow → again to Type",
      text: "Another tap of the arrow → now we're on Type. This lets you filter by Detached, Semi, Terraced, or Flat. I'll tap D for detached.",
      placement: "right" as const,
      enterDelay: 700,
      onEnter: () => {
        setMobileQuickFilterKey("propertyType");
      },
    },

    /* 21 — Demo: select Detached */
    {
      target: "[data-tour='quick-dock']",
      title: "Step 6 — Filtered to Detached",
      text: "Now the map shows only detached house prices. This is how you compare like-for-like. The quick dock arrow cycles through: Grid → Metric → Type → New build → Period.",
      placement: "right" as const,
      enterDelay: 700,
      onEnter: () => { setState((s) => ({ ...s, propertyType: "D" })); },
    },

    /* 22 — Demo: cleanup */
    {
      target: null,
      title: "That's manual exploration!",
      text: "Use the quick dock arrows for fast changes. Next up — data overlay layers that add flood, school, and election data on top of the price map.",
      placement: "center" as const,
      enterDelay: 600,
      onEnter: () => {
        setFiltersOpen(false);
        setState((s) => ({ ...s, grid: "5km", metric: "median", propertyType: "ALL" }));
      },
    },

    /* ═══ 23 — Section intro: Overlays ═══ */
    {
      target: null,
      title: "📊 Data Overlay Layers",
      text: "You can layer extra data on top of the price map — flood risk zones, school performance ratings, and election results. These help you understand what makes each area tick. Want me to show you?",
      placement: "center" as const,
      isSectionIntro: true,
      nextSectionIndex: 32,
      enterDelay: 600,
    },

    /* 24 — Demo: zoom into Yorkshire for all overlay demos */
    {
      target: null,
      title: "Step 1 — Let's look at one area",
      text: "I'm zooming into the York and Humber area — this is one of the best spots to see flood data. We'll stay here and toggle the overlays on and off so you can see each layer clearly.",
      placement: "top-center" as const,
      enterDelay: 1200,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(true);
        setState((s) => ({ ...s, floodOverlayMode: "off", schoolOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off" }));
        tourFlyTo([-1.08, 53.96], 9);
      },
    },

    /* 25 — Demo: flood overlay on (hide-cells) */
    {
      target: "[data-tour='overlay-panel']",
      title: "Step 2 — Flood risk layer",
      text: "I've turned on flood risk with \"hide cells\" mode — this removes the price grid so you can see the flood dots clearly without the coloured squares getting in the way. Each dot is a flood monitoring area.",
      placement: "left" as const,
      enterDelay: 1000,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setState((s) => ({ ...s, floodOverlayMode: "on_hide_cells", schoolOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off" }));
      },
    },

    /* 26 — Demo: explain flood detail */
    {
      target: null,
      title: "Step 3 — Reading the flood data",
      text: "Green dots are low risk, orange and red are higher risk. Use your scroll wheel to zoom in and explore the flood plain. Try clicking a flood dot to see its details! When you search a postcode with flood risk on, it finds the nearest monitoring point and shows its risk level.",
      placement: "top-center" as const,
      noOverlay: true,
      enterDelay: 1000,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(true);
      },
    },

    /* 27 — Demo: switch to schools (hide-cells) */
    {
      target: "[data-tour='overlay-panel']",
      title: "Step 4 — School quality layer",
      text: "Now I've turned off floods and turned on school quality — again with \"hide cells\" so the dots are easy to read. Each dot is a secondary school, coloured by performance rating.",
      placement: "left" as const,
      enterDelay: 1200,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setState((s) => ({ ...s, floodOverlayMode: "off", schoolOverlayMode: "on_hide_cells" }));
      },
    },

    /* 28 — Demo: explain school data */
    {
      target: null,
      title: "Step 5 — Reading the school data",
      text: "Each school dot has a quality band from A (best) to E. Zoom in with your scroll wheel to see individual schools. Try clicking a school dot to see its details! When you search a postcode, it finds the nearest school and nearest 'good' school — useful for families.",
      placement: "top-center" as const,
      noOverlay: true,
      enterDelay: 1000,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(true);
      },
    },

    /* 29 — Demo: vote overlay — zoom out to show England */
    {
      target: "[data-tour='overlay-panel']",
      title: "Step 6 — Election results layer",
      text: "I've turned off schools and turned on the election overlay. The map is zooming out so you can see England's constituency patterns — coloured shading shows General Election 2024 results by party.",
      placement: "left" as const,
      enterDelay: 1200,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setState((s) => ({ ...s, schoolOverlayMode: "off", voteOverlayMode: "on" }));
        setTimeout(() => tourFlyTo([-1.4, 52.6], 6.5), 300);
      },
    },

    /* 30 — Demo: combining overlays — back to York/Humber */
    {
      target: "[data-tour='overlay-panel']",
      title: "Step 7 — Combining data layers",
      text: "You can stack multiple overlays — here I've turned on both flood and school dots together with cells hidden. Use \"Hide cells\" when you want to click on overlay dots; use \"On\" for a quick visual glance with the price grid still visible.",
      placement: "left" as const,
      enterDelay: 1200,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setState((s) => ({ ...s, voteOverlayMode: "off", floodOverlayMode: "on_hide_cells", schoolOverlayMode: "on_hide_cells", commuteOverlayMode: "off" }));
        setTimeout(() => tourFlyTo([-1.08, 53.96], 9), 300);
      },
    },

    /* 31 — Demo: cleanup overlays */
    {
      target: null,
      title: "That's overlays!",
      text: "Toggle flood, schools, and vote overlays on and off whenever you need extra context. Stack them together, or use hide-cells to focus on one. Next up: postcode search.",
      placement: "center" as const,
      enterDelay: 600,
      onEnter: () => {
        if (isMobileViewport) setCleanScreenMode(false);
        setState((s) => ({ ...s, floodOverlayMode: "off", schoolOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off" }));
        tourFlyTo([-1.5, 53.5], 5);
      },
    },

    /* ═══ 32 — Section intro: Postcode Search ═══ */
    {
      target: null,
      title: "🔎 Searching for a Postcode",
      text: "Got a specific area in mind? Type any UK postcode and the map flies straight there. You can also press Locate to use your current GPS position. Want me to show you?",
      placement: "center" as const,
      isSectionIntro: true,
      nextSectionIndex: 36,
      enterDelay: 1000,
    },

    /* 33 — Demo: type postcode */
    {
      target: isMobileViewport ? null : "[data-tour='postcode-search']",
      title: "Step 1 — Type a postcode",
      text: "I've typed SW1A 1AA (near Buckingham Palace) into the search box. You can type any UK postcode — full or partial.",
      placement: isMobileViewport ? ("center" as const) : ("bottom" as const),
      enterDelay: 700,
      onEnter: () => { if (isMobileViewport) setCleanScreenMode(false); setPostcodeSearch("SW1A 1AA"); },
    },

    /* 34 — Demo: press Go — tooltip at TOP so map result is visible underneath */
    {
      target: null,
      title: "Step 2 — The map flies there!",
      text: "I've pressed Go — the map is flying to central London! Look below to see the price cells around the postcode. The map zooms to that location automatically.",
      placement: "top-center" as const,
      enterDelay: 1000,
      onEnter: () => {
        setPostcodeSearch("SW1A 1AA");
        setActivePostcodeSearch("SW1A 1AA");
        setPostcodeSearchToken((v) => v + 1);
      },
    },

    /* 35 — Demo: cleanup */
    {
      target: null,
      title: "That's postcode search!",
      text: isMobileViewport
        ? "Type any postcode, tap 📍 Locate for GPS, or use the 🔍 tap-to-search button to tap anywhere on the map. All work with flood & school overlays too."
        : "Type any postcode, press 📍 Locate for GPS, or right-click anywhere on the map. Flood & school overlays update automatically.",
      placement: "center" as const,
      enterDelay: 600,
      onEnter: () => {
        setPostcodeSearch("");
        setActivePostcodeSearch("");
        setPostcodeSearchStatus(null);
        tourFlyTo([-1.5, 53.5], 5);
      },
    },

    /* ═══ 36 — Section intro: Info & Help ═══ */
    {
      target: null,
      title: "ℹ️ Getting Help & Information",
      text: "All the reference pages — Instructions, Data Sources, Election Info, and legal / privacy pages — are in one place. Want me to show you where?",
      placement: "center" as const,
      isSectionIntro: true,
      nextSectionIndex: 39,
      enterDelay: 1000,
    },

    /* 37 — Demo: open Info menu */
    {
      target: "[data-tour='info-menu']",
      title: "Step 1 — The Info menu",
      text: "I've opened Info. This is where you'll find full Instructions, Data Sources, Election Info, and all legal / privacy pages. Everything opens as an overlay — you never leave the map.",
      placement: "right" as const,
      noOverlay: true,
      enterDelay: 700,
      onEnter: () => { if (isMobileViewport) setCleanScreenMode(false); setControlsDropOpen(false); setInfoDropOpen(true); },
    },

    /* 38 — Demo: close Info */
    {
      target: null,
      title: "Remember this!",
      text: "You can re-open this tour any time from the Info menu — just tap \"✨ Show me how\".",
      placement: "center" as const,
      enterDelay: 600,
      onEnter: () => { setInfoDropOpen(false); },
    },

    /* ═══ 39 — Finish ═══ */
    {
      target: null,
      title: "You're all set! 🎉",
      text: "Start with Find My Area if you have preferences, or just zoom and explore. On mobile, tap \"Clear\" (top right) to hide all panels — press \"Restore\" to bring them back. Happy house hunting!",
      placement: "center" as const,
    },
  ], [isMobileViewport, tourFlyTo]);

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
        postcodeSearchClearToken={postcodeSearchClearToken}
        locateMeToken={locateMeToken}
        onLocateMeResult={handleLocateMeResult}
        indexPrefs={computedIndexPrefs}
        onIndexScoringApplied={() => setIndexScoringPending(false)}
        onStatsUpdate={setMapStats}
        flyToRequest={flyToRequest}
        easyColours={easyColours}
        onReverseGeocode={(postcode) => {
          setPostcodeSearch(postcode);
          setActivePostcodeSearch(postcode);
          setPostcodeSearchToken((v) => v + 1);
        }}
        tapToSearch={tapToSearch}
        rgLogCount={rgLog.length}
        onOpenLog={() => setRgLogOpen(true)}
        onLocationLogged={(entry) => setRgLog((prev) => [entry, ...prev])}
        onRightClickInfo={(info) => { setRightClickInfo(info); if (info) setRgPanelMinimized(false); }}
        rgDismissToken={rgDismissToken}
        onPostcodeSearchResult={(result) => {
          const floodLookupActive = result.lookupMode !== "schools" && state.floodOverlayMode !== "off";
          const schoolLookupActive = result.lookupMode !== "flood" && state.schoolOverlayMode !== "off";
          const stationLookupActive = state.stationOverlayMode !== "off";

          const schoolSuffix = schoolLookupActive && result.schoolNearest
            ? ` · nearest school: ${result.schoolNearest.schoolName} (${result.schoolNearest.distanceMeters}m, ${result.schoolNearest.qualityBand})`
            : "";
          const schoolGoodSuffix = schoolLookupActive && result.schoolNearestGood
            ? ` · nearest good school: ${result.schoolNearestGood.schoolName} (${result.schoolNearestGood.distanceMeters}m)`
            : "";
          const stationSuffix = stationLookupActive && result.stationNearest
            ? ` · nearest station: ${result.stationNearest.name} (${(result.stationNearest.distanceMeters / 1609).toFixed(1)}mi)`
            : "";

          if (!floodLookupActive && schoolLookupActive) {
            if (result.schoolNearest || result.schoolNearestGood) {
              setPostcodeSearchStatus(`School lookup for ${result.normalizedQuery}${schoolSuffix}${schoolGoodSuffix}${stationSuffix}`);
              return;
            }
            setPostcodeSearchStatus(`No mapped school found for ${result.normalizedQuery}${stationSuffix}`);
            return;
          }

          if (result.status === "found") {
            const overlaySuffix = !floodLookupActive && !schoolLookupActive
              ? " · Enable Flood or Schools overlay for flood risk / school data"
              : "";
            setPostcodeSearchStatus(`Found ${result.matchedPostcode ?? result.normalizedQuery}${schoolSuffix}${schoolGoodSuffix}${stationSuffix}${overlaySuffix}`);
            return;
          }
          if (result.status === "broad-has-risk") {
            const count = result.hierarchyMatchCount ?? 0;
            setPostcodeSearchStatus(
              `${result.normalizedQuery} is a broader postcode area. ${count.toLocaleString()} flood-risk postcodes found under it${
                result.nearestPostcode ? ` (showing ${result.nearestPostcode})` : ""
              }.${schoolSuffix}${schoolGoodSuffix}${stationSuffix}`
            );
            return;
          }
          if (result.status === "no-risk-nearest") {
            setPostcodeSearchStatus(
              `No mapped flood-risk postcode found for ${result.normalizedQuery}. Nearest mapped postcode: ${result.nearestPostcode ?? "available"}${schoolSuffix}${schoolGoodSuffix}${stationSuffix}`
            );
            return;
          }
          if (result.status === "not-found") {
            setPostcodeSearchStatus(`No postcode match found for ${result.normalizedQuery}${schoolSuffix}${schoolGoodSuffix}${stationSuffix}`);
            return;
          }
          setPostcodeSearchStatus(`Postcode search unavailable right now${schoolSuffix}${schoolGoodSuffix}${stationSuffix}`);
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
              <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.45 }}>v0.4</span>
            </div>

            <div ref={controlsDropRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                data-tour="controls-btn"
                type="button"
                onClick={(e) => { e.stopPropagation(); setControlsDropOpen(v => !v); setInfoDropOpen(false); }}
                style={{ cursor: "pointer", border: controlsDropOpen ? "1px solid rgba(250,204,21,0.7)" : "1px solid rgba(255,255,255,0.2)", background: controlsDropOpen ? "rgba(250,204,21,0.14)" : "rgba(255,255,255,0.08)", color: "white", padding: "5px 10px", borderRadius: 999, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
              >
                ⚙ Controls ▾
              </button>
              {controlsDropOpen && (
                <span data-tour="controls-dropdown" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 1, height: 1, pointerEvents: "none" }} />
              )}
              {controlsDropOpen && (
                <div data-tour="controls-menu" style={isMobileViewport ? { position: "fixed", top: topBarHeight + 6, left: 8, right: 8, width: "auto", maxHeight: "calc(100vh - 110px)", overflowY: "auto", background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "6px 0", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 600 } : { position: "absolute", top: "calc(100% + 4px)", left: 0, width: 210, background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "6px 0", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 200 }}>
                  {([
                    { label: filtersOpen ? "🗂 Filters (open)" : "🗂 Filters", action: () => { setFiltersOpen(v => !v); setControlsDropOpen(false); bringToFront("filters"); } },
                    { label: "🔍 Find my area", action: () => { setIndexOpen(v => !v); setControlsDropOpen(false); bringToFront("index"); } },
                    { label: rgLog.length > 0 ? `📋 Search log (${rgLog.length})` : "📋 Search log", action: () => { setRgLogOpen(v => !v); setControlsDropOpen(false); } },
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
                  <button type="button"
                    onClick={() => {
                      const next = !easyColours;
                      setEasyColours(next);
                      try { localStorage.setItem("valuemap_easy_colours", next ? "1" : "0"); } catch { /* ignore */ }
                    }}
                    style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", color: "white", cursor: "pointer", padding: "8px 14px", fontSize: 11 }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <span>🎨 Easy colours</span>
                    <span style={{ fontSize: 10, opacity: 0.7, background: easyColours ? "rgba(250,204,21,0.22)" : "rgba(255,255,255,0.1)", border: easyColours ? "1px solid rgba(250,204,21,0.5)" : "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "1px 7px" }}>
                      {easyColours ? "On" : "Off"}
                    </span>
                  </button>
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
                data-tour="info-btn"
                type="button"
                onClick={(e) => { e.stopPropagation(); setInfoDropOpen(v => !v); setControlsDropOpen(false); }}
                style={{ cursor: "pointer", border: infoDropOpen ? "1px solid rgba(147,197,253,0.7)" : "1px solid rgba(255,255,255,0.2)", background: infoDropOpen ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.08)", color: "white", padding: "5px 10px", borderRadius: 999, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
              >
                ℹ Info ▾
              </button>
              {infoDropOpen && (
                <span data-tour="info-dropdown" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 1, height: 1, pointerEvents: "none" }} />
              )}
              {infoDropOpen && (
                <div data-tour="info-menu" style={isMobileViewport ? { position: "fixed", top: topBarHeight + 6, left: 8, right: 8, width: "auto", maxHeight: "calc(100vh - 110px)", overflowY: "auto", background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "6px 0", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 600 } : { position: "absolute", top: "calc(100% + 4px)", left: 0, width: 210, background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "6px 0", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 200 }}>
                  {([
                    { label: "✨ Show me how",   action: () => { setInfoDropOpen(false); startTour(); } },
                    { label: "📖 Instructions", action: () => { setInstructionsOpen(v => !v); setInfoDropOpen(false); bringToFront("instructions"); } },
                    { label: "📊 Data sources",  action: () => { setDataSourcesOpen(v => !v); setInfoDropOpen(false); bringToFront("datasources"); } },
                    { label: "🗳 Election info",  action: () => { setElectionInfoOpen(v => !v); setInfoDropOpen(false); bringToFront("electioninfo"); } },
                    { label: "📝 Description",   action: () => { setDocModalSrc("/description?embedded=1"); setInfoDropOpen(false); } },
                    { label: "🗺 Next steps",    action: () => { setDocModalSrc("/next-steps?embedded=1"); setInfoDropOpen(false); } },
                    { label: "✉ Contact",        action: () => { setDocModalSrc("/contact?embedded=1"); setInfoDropOpen(false); } },
                    { label: "⚖ Legal",          action: () => { setDocModalSrc("/legal?embedded=1"); setInfoDropOpen(false); } },
                    { label: "🔒 Privacy",       action: () => { setDocModalSrc("/privacy?embedded=1"); setInfoDropOpen(false); } },
                  ] as Array<{ label: string; action: () => void }>).map(({ label, action }) => (
                    <button key={label} type="button" onClick={action}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "white", cursor: "pointer", padding: "8px 14px", fontSize: 11 }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Overlays dropdown ── */}
            <div ref={overlaysDropRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOverlaysDropOpen(v => !v); setControlsDropOpen(false); setInfoDropOpen(false); }}
                style={{
                  cursor: "pointer",
                  border: overlaysDropOpen ? "1px solid rgba(74,222,128,0.7)" : anyOverlayActive ? "1px solid rgba(74,222,128,0.45)" : "1px solid rgba(255,255,255,0.2)",
                  background: overlaysDropOpen ? "rgba(74,222,128,0.14)" : anyOverlayActive ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.08)",
                  color: "white",
                  padding: "5px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
              >
                {anyOverlayActive && (
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "rgba(74,222,128,0.9)", flexShrink: 0 }} />
                )}
                ⊕ Overlays ▾
              </button>
              {overlaysDropOpen && (
                <div style={isMobileViewport ? { position: "fixed", top: topBarHeight + 6, left: 8, right: 8, width: "auto", maxHeight: "calc(100vh - 110px)", overflowY: "auto", background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "8px 12px 10px", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 600 } : { position: "absolute", top: "calc(100% + 4px)", left: 0, width: 278, background: "rgba(8,10,22,0.98)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, padding: "8px 12px 10px", boxShadow: "0 10px 40px rgba(0,0,0,0.65)", zIndex: 200 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Overlay layers</div>

                  {/* Flood */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: 11, opacity: 0.8, width: 70, flexShrink: 0 }}>🌊 Flood</div>
                    <Segment
                      options={["off", "on", "on_hide_cells"]}
                      value={state.floodOverlayMode}
                      onChange={(v) => setState((s) => ({ ...s, floodOverlayMode: v as FloodOverlayMode }))}
                      renderOption={(v) => v === "on" ? "On" : v === "on_hide_cells" ? "Hide cells" : "Off"}
                    />
                  </div>

                  {/* Schools */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: 11, opacity: 0.8, width: 70, flexShrink: 0 }}>🏫 Schools</div>
                    <Segment
                      options={["off", "on", "on_hide_cells"]}
                      value={state.schoolOverlayMode}
                      onChange={(v) => setState((s) => ({ ...s, schoolOverlayMode: v as SchoolOverlayMode }))}
                      renderOption={(v) => v === "on" ? "On" : v === "on_hide_cells" ? "Hide cells" : "Off"}
                    />
                  </div>

                  {/* Train stations */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: 11, opacity: 0.8, width: 70, flexShrink: 0 }}>🚂 Stations</div>
                    <Segment
                      options={["off", "on", "on_hide_cells"]}
                      value={state.stationOverlayMode}
                      onChange={(v) => setState((s) => ({ ...s, stationOverlayMode: v as StationOverlayMode }))}
                      renderOption={(v) => v === "on" ? "On" : v === "on_hide_cells" ? "Hide cells" : "Off"}
                    />
                  </div>

                  {/* Cell colour overlays sub-group */}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "8px 0 7px" }} />
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.45, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>Cell colour</div>

                  {/* Political votes */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: 11, opacity: 0.8, width: 70, flexShrink: 0, paddingTop: 2 }}>🗳 Politics</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <Segment
                        options={["off", "on"]}
                        value={state.voteOverlayMode}
                        onChange={(v) => setState((s) => ({ ...s, voteOverlayMode: v as VoteOverlayMode, ...(v === "on" ? { commuteOverlayMode: "off" as CommuteOverlayMode, ageOverlayMode: "off" as AgeOverlayMode } : {}) }))}
                        renderOption={(v) => v === "on" ? "On" : "Off"}
                      />
                      {state.voteOverlayMode === "on" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>Scale:</div>
                          <Segment
                            options={["relative", "absolute"]}
                            value={state.voteColorScale}
                            onChange={(v) => setState((s) => ({ ...s, voteColorScale: v as VoteColorScale }))}
                            renderOption={(v) => v === "relative" ? "Relative" : "Absolute"}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Commute distance */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: 11, opacity: 0.8, width: 70, flexShrink: 0, paddingTop: 2 }}>🚗 Commute</div>
                    <Segment
                      options={["off", "on"]}
                      value={state.commuteOverlayMode}
                      onChange={(v) => setState((s) => ({ ...s, commuteOverlayMode: v as CommuteOverlayMode, ...(v === "on" ? { voteOverlayMode: "off" as VoteOverlayMode, ageOverlayMode: "off" as AgeOverlayMode } : {}) }))}
                      renderOption={(v) => v === "on" ? "On" : "Off"}
                    />
                  </div>

                  {/* Age mix */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ fontSize: 11, opacity: 0.8, width: 70, flexShrink: 0, paddingTop: 2 }}>👥 Age mix</div>
                    <Segment
                      options={["off", "on"]}
                      value={state.ageOverlayMode}
                      onChange={(v) => setState((s) => ({ ...s, ageOverlayMode: v as AgeOverlayMode, ...(v === "on" ? { voteOverlayMode: "off" as VoteOverlayMode, commuteOverlayMode: "off" as CommuteOverlayMode } : {}) }))}
                      renderOption={(v) => v === "on" ? "On" : "Off"}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Show Me How pill in top bar (desktop only) ── */}
            {!isMobileViewport && !tourActive && (
              <button
                type="button"
                onClick={startTour}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(250,204,21,0.7)",
                  background: "rgba(250,204,21,0.18)",
                  color: "white",
                  padding: "5px 12px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  ...(showMePulse ? { animation: "tourShowMePulseInline 1.6s ease-in-out infinite" } : {}),
                }}
              >
                ✨ Show me how
              </button>
            )}

            {!isMobileViewport && (
              <div style={{ display: "grid", gap: 1, maxWidth: 330, flexShrink: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {headerFilterSummary}
                </div>
                {indexActive ? (
                  <div style={{ fontSize: 10, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {indexAffordabilitySummary}
                  </div>
                ) : headerMedianSummary && (
                  <div style={{ fontSize: 10, opacity: 0.72, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {`Median range: ${headerMedianSummary}`}
                  </div>
                )}
                {mapStats && (
                  <div style={{ fontSize: 10, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "rgba(250,204,21,0.9)" }}>
                    {mapStats.label}: <b>{mapStats.value}</b> &middot; {mapStats.txCount.toLocaleString()} sales
                  </div>
                )}
              </div>
            )}
            <div style={{ flex: 1 }} />

            {!isMobileViewport && (
              <div data-tour="postcode-search" style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                <input type="text"
                  value={postcodeSearch}
                  onChange={(e) => {
                    setPostcodeSearch(e.target.value);
                    if (postcodeSearchStatus) setPostcodeSearchStatus(null);
                    // If user clears the input box, also wipe the committed search so overlay
                    // button changes no longer re-zoom to the old postcode.
                    if (!e.target.value.trim() && activePostcodeSearch) {
                      setActivePostcodeSearch("");
                      setPostcodeSearchClearToken((v) => v + 1);
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") { const q = postcodeSearch.trim(); if (q) { setState(s => ({ ...s, floodOverlayMode: "off", schoolOverlayMode: "off", stationOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off", ageOverlayMode: "off" })); setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); } } }}
                  placeholder="Search postcode…"
                  aria-label="Search postcode"
                  style={{ width: 155, borderRadius: 7, border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 8px", fontSize: 11 }}
                />
                <button type="button"
                  onClick={() => { const q = postcodeSearch.trim(); if (!q) { setPostcodeSearchStatus("Enter a postcode"); return; } setState(s => ({ ...s, floodOverlayMode: "off", schoolOverlayMode: "off", stationOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off", ageOverlayMode: "off" })); setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); }}
                  style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 9px", borderRadius: 7, fontSize: 11 }}
                >
                  Go
                </button>
                {activePostcodeSearch && (
                  <button
                    type="button"
                    title="Clear postcode search"
                    aria-label="Clear postcode search"
                    onClick={() => {
                      setPostcodeSearch("");
                      setActivePostcodeSearch("");
                      setPostcodeSearchStatus(null);
                      setPostcodeSearchClearToken((v) => v + 1);
                    }}
                    style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(239,68,68,0.18)", color: "rgba(255,255,255,0.85)", padding: "5px 8px", borderRadius: 7, fontSize: 12, lineHeight: 1 }}
                  >
                    ×
                  </button>
                )}
                <button type="button"
                  onClick={() => { setLocateMeStatus("Requesting location permission..."); setLocateMeSummary(null); setLocateMeToken(v => v + 1); }}
                  title="Use my location (one-shot)" aria-label="Use my location once"
                  style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(59,130,246,0.2)", color: "white", padding: "5px 9px", borderRadius: 7, fontSize: 11, whiteSpace: "nowrap" }}
                >
                  📍 Locate
                </button>
                {/* Desktop hint: right-click tip */}
                <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, whiteSpace: "nowrap", userSelect: "none" }}>or right-click map</span>
              </div>
            )}
          </div>

          {isMobileViewport && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 0 }}>
              <input
                type="text"
                value={postcodeSearch}
                onChange={(e) => {
                  setPostcodeSearch(e.target.value);
                  if (postcodeSearchStatus) setPostcodeSearchStatus(null);
                  if (!e.target.value.trim() && activePostcodeSearch) {
                    setActivePostcodeSearch("");
                    setPostcodeSearchClearToken((v) => v + 1);
                  }
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { const q = postcodeSearch.trim(); if (q) { setState(s => ({ ...s, floodOverlayMode: "off", schoolOverlayMode: "off", stationOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off", ageOverlayMode: "off" })); setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); } } }}
                placeholder="Postcode…"
                aria-label="Search postcode"
                style={{ width: 90, minWidth: 0, flexShrink: 0, borderRadius: 7, border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 8px", fontSize: 11 }}
              />
              {/* Tap-to-search toggle — magnifier icon, lights up when active */}
              <button
                type="button"
                title={tapToSearch ? "Tap-to-search ON: tap any map spot" : "Tap-to-search: tap anywhere to look up postcode"}
                aria-label="Toggle tap-to-search"
                data-tour="tap-to-search"
                onClick={() => setTapToSearch((v) => !v)}
                style={{
                  cursor: "pointer",
                  border: tapToSearch ? "1px solid rgba(250,204,21,0.8)" : "1px solid rgba(255,255,255,0.22)",
                  background: tapToSearch ? "rgba(250,204,21,0.22)" : "rgba(255,255,255,0.08)",
                  color: tapToSearch ? "rgba(250,204,21,1)" : "rgba(255,255,255,0.65)",
                  padding: "5px 7px", borderRadius: 7, fontSize: 13, lineHeight: 1, flexShrink: 0,
                }}
              >
                🔍
              </button>
              {activePostcodeSearch ? (
                <button
                  type="button"
                  title="Clear postcode search"
                  aria-label="Clear postcode search"
                  onClick={() => {
                    setPostcodeSearch("");
                    setActivePostcodeSearch("");
                    setPostcodeSearchStatus(null);
                    setPostcodeSearchClearToken((v) => v + 1);
                  }}
                  style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(239,68,68,0.18)", color: "rgba(255,255,255,0.85)", padding: "5px 8px", borderRadius: 7, fontSize: 12, lineHeight: 1, flexShrink: 0 }}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setLocateMeStatus("Requesting location permission..."); setLocateMeSummary(null); setLocateMeToken(v => v + 1); }}
                  title="Use my location (one-shot)"
                  aria-label="Use my location once"
                  style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(59,130,246,0.2)", color: "white", padding: "5px 8px", borderRadius: 7, fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  📍 Locate
                </button>
              )}
              <button
                type="button"
                onClick={() => { const q = postcodeSearch.trim(); if (!q) { setPostcodeSearchStatus("Enter a postcode"); return; } setState(s => ({ ...s, floodOverlayMode: "off", schoolOverlayMode: "off", stationOverlayMode: "off", voteOverlayMode: "off", commuteOverlayMode: "off", ageOverlayMode: "off" })); setActivePostcodeSearch(q); setPostcodeSearchToken(v => v + 1); }}
                style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.1)", color: "white", padding: "5px 9px", borderRadius: 7, fontSize: 11, flexShrink: 0 }}
              >
                Go
              </button>
              {mapStats && (
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, opacity: 0.85, color: "rgba(250,204,21,0.9)" }}>
                  <b>{mapStats.value}</b> &middot; {mapStats.txCount.toLocaleString()} sales
                </div>
              )}
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
          <div id="filters-panel" data-tour="filters-panel" className="controls" data-open="true" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
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
            data-tour="index-modal"
            className="index-modal"
            style={{
              width: compactIndexUi ? 352 : 380,
              maxWidth: compactIndexUi ? "calc(100vw - 20px)" : "calc(100vw - 32px)",
              maxHeight: compactIndexUi ? "calc(100vh - 20px)" : "calc(100vh - 48px)",
              overflow: "auto",
              padding: compactIndexUi ? "11px 12px" : "16px 18px",
              borderRadius: compactIndexUi ? 12 : 16,
              background: "rgba(10, 12, 20, 0.96)",
              border: indexActive
                ? "2px solid rgba(26,152,80,0.6)"
                : "1px solid rgba(250,204,21,0.3)",
              backdropFilter: "blur(12px)",
              color: "white",
              fontSize: compactIndexUi ? 11 : 12,
              fontFamily: "var(--font-sans), Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
              lineHeight: compactIndexUi ? 1.3 : 1.4,
              boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: compactIndexUi ? 7 : 10 }}>
              <div style={{ fontWeight: 700, fontSize: compactIndexUi ? 14 : 15 }}>🔍 Find my area</div>
              <button
                type="button"
                onClick={() => setIndexOpen(false)}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  width: compactIndexUi ? 24 : 26, height: compactIndexUi ? 24 : 26,
                  borderRadius: 999,
                  fontSize: compactIndexUi ? 13 : 15, lineHeight: 1,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 10, lineHeight: 1.35 }}>
              Score every cell <b style={{ color: "#22c55e" }}>green</b> (great match) → <b style={{ color: "#ef4444" }}>red</b> (poor) based on what you care about.
            </div>

            {/* Budget + Property type card */}
            <div style={{
              background: "rgba(255,255,255,0.04)",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "8px 10px",
              marginBottom: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>
                  💰 Max price{state.metric === "median_ppsf" ? " (per ft²)" : ""}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 2, background: "rgba(255,255,255,0.08)", borderRadius: 7, padding: "3px 8px", border: "1px solid rgba(255,255,255,0.14)" }}>
                  <span style={{ fontSize: 12, opacity: 0.7, fontWeight: 600 }}>£</span>
                  <input
                    type="number"
                    className="budget-input"
                    min={state.metric === "median_ppsf" ? 50 : 50000}
                    max={state.metric === "median_ppsf" ? 1000 : 2000000}
                    step={state.metric === "median_ppsf" ? 10 : 5000}
                    value={indexBudget}
                    onChange={(e) => { const v = Number(e.target.value); if (v > 0) setIndexBudget(v); }}
                    onBlur={(e) => {
                      const min = state.metric === "median_ppsf" ? 50 : 50000;
                      const max = state.metric === "median_ppsf" ? 1000 : 2000000;
                      setIndexBudget((v) => Math.max(min, Math.min(max, v)));
                      void e;
                    }}
                    style={{ background: "none", border: "none", color: "white", fontSize: 13, fontWeight: 700, width: 95, outline: "none", textAlign: "right" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, flex: "0 0 auto", minWidth: 64 }}>🏠 Type</span>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {(["ALL", "D", "S", "T", "F"] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setIndexPropertyType(pt)}
                      style={{
                        cursor: "pointer",
                        border: indexPropertyType === pt ? "1.5px solid rgba(250,204,21,0.85)" : "1px solid rgba(255,255,255,0.15)",
                        background: indexPropertyType === pt ? "rgba(250,204,21,0.18)" : "rgba(255,255,255,0.05)",
                        color: "white",
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: indexPropertyType === pt ? 700 : 400,
                      }}
                    >
                      {PROPERTY_LABEL[pt]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Importance pickers card */}
            <div style={{
              background: "rgba(255,255,255,0.04)",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "6px 10px 4px",
              marginBottom: 10,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.4, marginBottom: 3 }}>
                How important?
              </div>
              <ImportancePicker emoji="💰" label="Affordability" value={indexAffordWeight} onChange={setIndexAffordWeight} color="#facc15" />
              <ImportancePicker emoji="🌊" label="Flood safety"  value={indexFloodWeight}  onChange={setIndexFloodWeight}  color="#60a5fa" />
              <ImportancePicker emoji="🏫" label="Schools"       value={indexSchoolWeight} onChange={setIndexSchoolWeight} color="#22c55e" />
              <ImportancePicker emoji="🚂" label="Trains"        value={indexTrainWeight}  onChange={setIndexTrainWeight}  color="#f97316" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 11, fontWeight: 600, flex: "0 0 auto", minWidth: 100 }}>👥 Community age</span>
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {([{ label: "Must", value: 10 }, { label: "Want", value: 6 }, { label: "Nice", value: 3 }, { label: "Off", value: 0 }] as const).map(({ label: lbl, value: v }) => {
                      const active = [0, 3, 6, 10].reduce<number>((best, l) => Math.abs(indexAgeWeight - l) < Math.abs(indexAgeWeight - best) ? l : best, 10);
                      return (
                        <button key={v} type="button" onClick={() => setIndexAgeWeight(v)} style={{ cursor: "pointer", padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: active === v ? 700 : 400, border: active === v ? "1.5px solid #a78bfa" : "1px solid rgba(255,255,255,0.13)", background: active === v ? "#a78bfa30" : "rgba(255,255,255,0.04)", color: active === v ? "white" : "rgba(255,255,255,0.5)", lineHeight: 1.4, minWidth: 36, textAlign: "center" }}>{lbl}</button>
                      );
                    })}
                  </div>
                  {indexAgeWeight > 0 && (
                    <select
                      value={indexAgeDirection}
                      onChange={(e) => setIndexAgeDirection(e.target.value as "young" | "old")}
                      style={{ marginLeft: 4, fontSize: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "white", borderRadius: 6, padding: "2px 4px", cursor: "pointer" }}
                    >
                      <option value="young">Younger</option>
                      <option value="old">Older</option>
                    </select>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", opacity: 0.3 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>🏖️ Coast</span>
                <span style={{ fontSize: 10, fontStyle: "italic" }}>coming soon</span>
              </div>
            </div>

            {/* Coverage note */}
            <div style={{ fontSize: 10, opacity: 0.52, marginBottom: 10, lineHeight: 1.35 }}>
              ⓘ Flood &amp; school scores use England-only data — Wales &amp; Scotland coming later.
            </div>

            {indexActive && (
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 8, lineHeight: 1.3, textAlign: "center" }}>
                🟢 Great match · 🟡 Average · 🔴 Poor match · After scoring, the map will hide weaker areas automatically — you can adjust the threshold in the filter below.
              </div>
            )}

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
                    trainWeight: indexTrainWeight,
                    coastWeight: indexCoastWeight,
                    ageWeight: indexAgeWeight,
                    ageDirection: indexAgeDirection,
                  });
                  setGridMode("manual");
                  setState((s) => ({ ...s, grid: "1km" }));
                  setIndexScoringPending(true);
                  setIndexActive(true);
                  setIndexToken((t) => t + 1);
                  setIndexSuitabilityMode("gte");
                  setIndexSuitabilityThreshold(50);
                  setIndexOpen(false);
                }}
                style={{
                  flex: 1,
                  cursor: "pointer",
                  border: "2px solid rgba(26,152,80,0.7)",
                  background: "rgba(26,152,80,0.28)",
                  color: "white",
                  padding: "9px 10px",
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
                    padding: "9px 10px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Clear scores
                </button>
              )}
            </div>

            {!indexActive && (
              <button
                type="button"
                onClick={() => setIndexOpen(false)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  cursor: "pointer",
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 11,
                  padding: "5px 0 1px",
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
            gap: 5,
            width: 468,
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
                padding: "8px 10px",
                borderRadius: 12,
                background: "rgba(10, 12, 20, 0.85)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 11,
              }}
            >
              <div className="mobile-collapsible-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Mode</div>
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
                  <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>Threshold</div>
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
                      <div style={{ fontSize: 10, opacity: 0.75 }}>
                        {valueFilterLabel}
                      </div>
                    </div>
                  </div>
                )}

                <div
                  className="current-filters-box"
                  style={{
                    marginTop: 2,
                    padding: "6px 8px",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.9, marginBottom: 5 }}>
                    Current filters
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.35 }}>
                    {currentFiltersSummary}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>
                    {`Value filter: ${valueFilterLabel}`}
                  </div>
                </div>

                {isMobileViewport && (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setMobileFiltersActiveOpen((v) => !v)}
                      style={{
                        cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.2)",
                        background: "rgba(255,255,255,0.08)",
                        color: "white",
                        padding: "5px 9px",
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {mobileFiltersActiveOpen ? "Hide filters" : "Filters Active"}
                    </button>
                    {mobileFiltersActiveOpen && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: "7px 9px",
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.9, marginBottom: 5 }}>
                          Current filters
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.35 }}>
                          {currentFiltersSummary}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>
                          {`Value filter: ${valueFilterLabel}`}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {(legendOpen || indexActive) && (
            <div
              data-tour="legend"
              className="legend"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 12,
                background: "rgba(10, 12, 20, 0.85)",
                border: indexActive ? "1px solid rgba(26,152,80,0.4)" : "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 12,
              }}
            >
              {legendContent}
            </div>
          )}

          {/* Index suitability panel when scoring is active */}
          {indexActive && !indexOpen && (
            <div
              data-tour="area-match-filter"
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 12,
                background: "rgba(10, 12, 20, 0.9)",
                border: "2px solid rgba(26,152,80,0.5)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontSize: 11,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>🎯 Show only good matches</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11, opacity: 0.8 }}>Show</div>
                <Segment
                  options={["off", "lte", "gte"]}
                  value={indexSuitabilityMode}
                  onChange={(v) => setIndexSuitabilityMode(v as ValueFilterMode)}
                  renderOption={(v) => {
                    const labels: Record<string, string> = {
                      off: "All",
                      lte: "Weak areas",
                      gte: "Good matches",
                    };
                    return labels[v] ?? v;
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11, opacity: indexSuitabilityMode === "off" ? 0.5 : 0.8 }}>Min score</div>
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
                  <div style={{ fontSize: 10, opacity: 0.8 }}>
                    {indexSuitabilityMode === "off"
                      ? "All scored areas visible"
                      : indexSuitabilityMode === "gte"
                        ? `Showing areas scoring ≥ ${indexSuitabilityThreshold}% — raise to narrow further`
                        : `Showing areas scoring ≤ ${indexSuitabilityThreshold}% — lower-scoring areas only`}
                  </div>
                </div>
              </div>

              {!isMobileViewport && (
                <div
                  style={{
                    marginTop: 2,
                    padding: "6px 8px",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.9, marginBottom: 5 }}>
                    Current filters
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.35 }}>
                    {currentFiltersSummary}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>
                    {`Match filter: ${indexSuitabilityLabel}`}
                  </div>
                </div>
              )}

              {isMobileViewport && (
                <div style={{ marginTop: 2 }}>
                  <button
                    type="button"
                    onClick={() => setMobileFiltersActiveOpen((v) => !v)}
                    style={{
                      cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.08)",
                      color: "white",
                      padding: "5px 9px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {mobileFiltersActiveOpen ? "Hide filters" : "Filters Active"}
                  </button>
                  {mobileFiltersActiveOpen && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: "7px 9px",
                        borderRadius: 10,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.9, marginBottom: 5 }}>
                        Current filters
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.35 }}>
                        {currentFiltersSummary}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>
                        {`Match filter: ${indexSuitabilityLabel}`}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                  Edit criteria
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 600 }}>Filters Active</div>
              <button
                type="button"
                onClick={() => setMobileFiltersActiveOpen((v) => !v)}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {mobileFiltersActiveOpen ? "Hide" : "Open"}
              </button>
            </div>
            {mobileFiltersActiveOpen && (
              <>
                <div style={{ opacity: 0.82, marginTop: 6 }}>{currentFiltersSummary}</div>
                <div style={{ opacity: 0.82, marginTop: 3 }}>{`Value filter: ${valueFilterLabel}`}</div>
              </>
            )}
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
        <div data-tour="quick-dock" className="mobile-grid-dock" aria-label="Map grid controls">
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

      {/* ── Scoring loading overlay ── */}
      {indexScoringPending && (
        <div
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              padding: "22px 32px",
              borderRadius: 18,
              background: "rgba(10,12,20,0.92)",
              border: "1px solid rgba(26,152,80,0.55)",
              backdropFilter: "blur(14px)",
              boxShadow: "0 8px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(26,152,80,0.2)",
              color: "white",
              animation: "scoringPulse 1.6s ease-in-out infinite",
            }}
          >
            <div style={{ fontSize: 32, lineHeight: 1 }}>🗺️</div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Scoring areas…</div>
            <div style={{ fontSize: 11, opacity: 0.65, textAlign: "center", maxWidth: 200, lineHeight: 1.4 }}>Calculating match scores across every cell on the map</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 8, height: 8,
                    borderRadius: 999,
                    background: "rgba(26,152,80,0.9)",
                    animation: `scoringDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Doc modal (iframe overlay for description, next-steps, legal, privacy, contact) ── */}
      {docModalSrc && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setDocModalSrc(null); }}
        >
          <div style={{ position: "relative", width: 680, maxWidth: "calc(100vw - 24px)", height: "min(88vh, 820px)", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 16px 60px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column" }}>
            <button
              type="button"
              onClick={() => setDocModalSrc(null)}
              style={{ position: "absolute", top: 10, right: 12, zIndex: 10, cursor: "pointer", border: "1px solid rgba(255,255,255,0.25)", background: "rgba(10,12,20,0.85)", color: "white", width: 30, height: 30, borderRadius: 999, fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}
              aria-label="Close"
            >✕</button>
            <iframe
              src={docModalSrc}
              style={{ flex: 1, border: "none", width: "100%", height: "100%", borderRadius: 16, background: "rgba(10,12,20,0.98)" }}
              title="Info"
            />
          </div>
        </div>
      )}

      {/* ── Show Me button (mobile, only until tour completed) ── */}
      {!tourActive && !cleanScreenMode && isMobileViewport && showMePulse && (
        <div
          style={{
            position: "fixed",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 0,
            border: "2px solid rgba(250,204,21,0.75)",
            background: "rgba(250,204,21,0.22)",
            borderRadius: 999,
            backdropFilter: "blur(10px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            animation: showMePulse ? "tourShowMePulse 1.6s ease-in-out infinite" : undefined,
          }}
        >
          <button
            data-tour="show-me"
            type="button"
            onClick={startTour}
            style={{
              cursor: "pointer",
              border: "none",
              background: "transparent",
              color: "white",
              padding: "10px 16px 10px 22px",
              borderRadius: "999px 0 0 999px",
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: "nowrap",
              letterSpacing: 0.3,
            }}
          >
            ✨ Show me how
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setShowMePulse(false);
              try { localStorage.setItem("valuemap_tour_done", "1"); } catch { /* ignore */ }
            }}
            style={{
              cursor: "pointer",
              border: "none",
              borderLeft: "1px solid rgba(250,204,21,0.35)",
              background: "transparent",
              color: "rgba(255,255,255,0.7)",
              padding: "10px 14px 10px 10px",
              borderRadius: "0 999px 999px 0",
              fontSize: 14,
              lineHeight: 1,
              fontWeight: 400,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Guided Tour overlay ── */}
      <GuidedTour
        steps={tourSteps}
        active={tourActive}
        onEnd={endTour}
        stepIndex={tourStep}
        onStepChange={setTourStep}
      />

      {/* ── Right-click info panel — desktop: fixed left column; mobile: bottom sheet ── */}
      {rightClickInfo && !isMobileViewport && (
        <div style={{
          position: "fixed", top: floatingPanelTop, left: 18, zIndex: 9998,
          width: 288, background: "white", border: "1px solid #e5e7eb",
          borderRadius: 12, boxShadow: "0 4px 32px rgba(0,0,0,0.18)",
          overflow: "visible",
        }}>
          {/* CSS border-triangle arrow pointing right toward the map */}
          <div style={{ position: "absolute", right: -11, top: "50%", transform: "translateY(-50%)", width: 0, height: 0, borderTop: "10px solid transparent", borderBottom: "10px solid transparent", borderLeft: "10px solid #e5e7eb" }} />
          <div style={{ position: "absolute", right: -9, top: "50%", transform: "translateY(-50%)", width: 0, height: 0, borderTop: "10px solid transparent", borderBottom: "10px solid transparent", borderLeft: "10px solid white" }} />
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px", borderBottom: "1px solid #f3f4f6" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1d4ed8" }}>
              📍 {rightClickInfo.stage === "ready" ? rightClickInfo.postcode : "…"}
              {rightClickInfo.stage === "ready" && rightClickInfo.isOutcode && <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af", marginLeft: 5 }}>district</span>}
            </span>
            <button type="button" onClick={() => { setRightClickInfo(null); setRgDismissToken(v => v + 1); }} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#9ca3af", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>✕</button>
          </div>
          {/* Content */}
          {rightClickInfo.stage === "loading" ? (
            <div style={{ padding: "12px 12px", fontSize: 12, color: "#9ca3af" }}>Looking up location…</div>
          ) : (
            <div style={{ padding: "8px 12px" }}>
              {([
                { icon: "🌊", label: "Flood",   html: rightClickInfo.floodHtml },
                { icon: "🏫", label: "Schools", html: rightClickInfo.schoolHtml },
                { icon: "🚂", label: "Station", html: rightClickInfo.stationHtml },
              ] as const).map(({ icon, label, html }) => (
                <div key={label} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                  <span style={{ width: 16, flexShrink: 0, textAlign: "center", paddingTop: 1 }}>{icon}</span>
                  <span style={{ color: "#9ca3af", width: 48, flexShrink: 0, fontSize: 11, paddingTop: 2 }}>{label}</span>
                  <div style={{ fontSize: 12, lineHeight: 1.4, flex: 1, minWidth: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              ))}
              {rightClickInfo.cellMedian && (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                  <span style={{ width: 16, flexShrink: 0, textAlign: "center", paddingTop: 1 }}>🏠</span>
                  <span style={{ color: "#9ca3af", width: 48, flexShrink: 0, fontSize: 11, paddingTop: 2 }}>Price</span>
                  <div style={{ fontSize: 12, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{rightClickInfo.cellMedian >= 1000000 ? `£${(rightClickInfo.cellMedian / 1000000).toFixed(1)}m` : `£${Math.round(rightClickInfo.cellMedian / 1000)}k`}</span>
                    {rightClickInfo.cellDeltaPct !== undefined && (
                      <span style={{ color: rightClickInfo.cellDeltaPct >= 0 ? "#16a34a" : "#dc2626", marginLeft: 6, fontSize: 11 }}>
                        {rightClickInfo.cellDeltaPct >= 0 ? "▲" : "▼"}{Math.abs(rightClickInfo.cellDeltaPct).toFixed(1)}%
                      </span>
                    )}
                    {(rightClickInfo as any).cellDeltaGbp !== undefined && (
                      <span style={{ color: "#9ca3af", fontSize: 10, marginLeft: 4 }}>
                        {((d: number) => `(${d >= 0 ? "+" : "−"}£${Math.round(Math.abs(d) / 1000)}k)`)((rightClickInfo as any).cellDeltaGbp)}
                      </span>
                    )}
                    {rightClickInfo.cellTxCount !== undefined && (
                      <span style={{ color: "#9ca3af", fontSize: 10, marginLeft: 5 }}>({rightClickInfo.cellTxCount} sales)</span>
                    )}
                  </div>
                </div>
              )}
              {rightClickInfo.constituency && (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                  <span style={{ width: 16, flexShrink: 0, textAlign: "center", paddingTop: 1 }}>🗳️</span>
                  <span style={{ color: "#9ca3af", width: 48, flexShrink: 0, fontSize: 11, paddingTop: 2 }}>Area</span>
                  <div style={{ fontSize: 12, lineHeight: 1.4, flex: 1, minWidth: 0 }}>{rightClickInfo.constituency}</div>
                </div>
              )}
              <div style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, color: "#6b7280" }}>✓ Added to log</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setRgLogOpen(true); }} style={{ fontSize: 10, color: "#6366f1", textDecoration: "none", fontWeight: 500 }}>See log →</a>
              </div>
            </div>
          )}
        </div>
      )}
      {rightClickInfo && isMobileViewport && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9998,
          background: "white", borderTopLeftRadius: 14, borderTopRightRadius: 14,
          boxShadow: "0 -4px 24px rgba(0,0,0,0.15)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px", borderBottom: rgPanelMinimized ? "none" : "1px solid #f3f4f6" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1d4ed8" }}>
              📍 {rightClickInfo.stage === "ready" ? rightClickInfo.postcode : "Looking up…"}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" title={rgPanelMinimized ? "Expand" : "Minimise"} onClick={() => setRgPanelMinimized(v => !v)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#9ca3af", fontSize: 13, padding: "0 4px" }}>
                {rgPanelMinimized ? "▲" : "▼"}
              </button>
              <button type="button" onClick={() => { setRightClickInfo(null); setRgDismissToken(v => v + 1); setRgPanelMinimized(false); }} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#9ca3af", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>✕</button>
            </div>
          </div>
          {!rgPanelMinimized && (rightClickInfo.stage === "loading" ? (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#9ca3af" }}>Looking up location…</div>
          ) : (
            <div style={{ padding: "8px 14px 16px" }}>
              {([
                { icon: "🌊", label: "Flood",   html: rightClickInfo.floodHtml },
                { icon: "🏫", label: "Schools", html: rightClickInfo.schoolHtml },
                { icon: "🚂", label: "Station", html: rightClickInfo.stationHtml },
              ] as const).map(({ icon, label, html }) => (
                <div key={label} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                  <span style={{ width: 16, flexShrink: 0, textAlign: "center", paddingTop: 1 }}>{icon}</span>
                  <span style={{ color: "#9ca3af", width: 48, flexShrink: 0, fontSize: 11, paddingTop: 2 }}>{label}</span>
                  <div style={{ fontSize: 12, lineHeight: 1.4, flex: 1, minWidth: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              ))}
              {rightClickInfo.cellMedian && (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                  <span style={{ width: 16, flexShrink: 0, textAlign: "center", paddingTop: 1 }}>🏠</span>
                  <span style={{ color: "#9ca3af", width: 48, flexShrink: 0, fontSize: 11, paddingTop: 2 }}>Price</span>
                  <div style={{ fontSize: 12, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{rightClickInfo.cellMedian >= 1000000 ? `£${(rightClickInfo.cellMedian / 1000000).toFixed(1)}m` : `£${Math.round(rightClickInfo.cellMedian / 1000)}k`}</span>
                    {rightClickInfo.cellDeltaPct !== undefined && (
                      <span style={{ color: rightClickInfo.cellDeltaPct >= 0 ? "#16a34a" : "#dc2626", marginLeft: 6, fontSize: 11 }}>
                        {rightClickInfo.cellDeltaPct >= 0 ? "▲" : "▼"}{Math.abs(rightClickInfo.cellDeltaPct).toFixed(1)}%
                      </span>
                    )}
                    {rightClickInfo.cellTxCount !== undefined && (
                      <span style={{ color: "#9ca3af", fontSize: 10, marginLeft: 5 }}>({rightClickInfo.cellTxCount} sales)</span>
                    )}
                  </div>
                </div>
              )}
              {rightClickInfo.constituency && (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                  <span style={{ width: 16, flexShrink: 0, textAlign: "center", paddingTop: 1 }}>🗳️</span>
                  <span style={{ color: "#9ca3af", width: 48, flexShrink: 0, fontSize: 11, paddingTop: 2 }}>Area</span>
                  <div style={{ fontSize: 12, lineHeight: 1.4, flex: 1, minWidth: 0 }}>{rightClickInfo.constituency}</div>
                </div>
              )}
              <div style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, color: "#6b7280" }}>✓ Added to log</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setRgLogOpen(true); }} style={{ fontSize: 10, color: "#6366f1", textDecoration: "none", fontWeight: 500 }}>See log →</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Search log panel ── */}
      {rgLogOpen && (
        <div style={{ position: "fixed", top: 60, right: 16, zIndex: 9999, width: 320, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", background: "rgba(8,10,20,0.95)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, color: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>📋 Search log {rgLog.length > 0 && <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.6 }}>({rgLog.length})</span>}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {rgLog.length > 0 && (
                <>
                  <button type="button" title="Download CSV" onClick={() => {
                    const dc = (s: string) => `"${s.replace(/"/g, '""')}"`;
                    const disclaimer = [
                      dc("IMPORTANT NOTICE - FOR INFORMATION ONLY"),
                      dc("This data is provided for general information purposes only. It must not be relied upon for any financial, legal, property, planning, insurance, or investment decision."),
                      dc("Flood risk, school quality, and transport proximity indicators are indicative estimates derived from third-party sources and may be incomplete, inaccurate, or out of date."),
                      dc("You must seek independent professional advice and consult official sources before making any decisions, including but not limited to:"),
                      dc("  - Flood risk: Environment Agency - check-long-term-flood-risk.service.gov.uk"),
                      dc("  - School quality: Ofsted - reports.ofsted.gov.uk"),
                      dc("  - Rail proximity: National Rail - nationalrail.co.uk"),
                      dc("ValueMap accepts no responsibility or liability for any loss or damage arising from reliance on this data."),
                      dc(""),
                    ];
                    const header = "Timestamp,Postcode,Lat,Lng,Flood,Schools,Station,Median Price,Price Change %,Price Change £,Tx Count,Constituency";
                    const rows = rgLog.map(e => [
                      e.timestamp,
                      `"${e.postcode}"`,
                      e.lat,
                      e.lng,
                      `"${e.floodSummary.replace(/"/g, '""')}"`,
                      `"${e.schoolSummary.replace(/"/g, '""')}"`,
                      `"${e.stationSummary.replace(/"/g, '""')}"`,
                      e.cellMedian ?? "",
                      e.cellDeltaPct ?? "",
                      e.cellDeltaGbp ?? "",
                      e.cellTxCount ?? "",
                      e.constituency ? `"${e.constituency.replace(/"/g, '""')}"` : "",
                    ].join(","));
                    // \uFEFF = UTF-8 BOM so Excel opens with correct encoding
                    const blob = new Blob(["\uFEFF" + [...disclaimer, header, ...rows].join("\r\n")], { type: "text/csv;charset=utf-8;" });
                    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "valuemap-search-log.csv"; a.click(); URL.revokeObjectURL(a.href);
                  }} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.8)", padding: "3px 8px", borderRadius: 6, fontSize: 11 }}>⬇ CSV</button>
                  <button type="button" title="Clear all" onClick={() => setRgLog([])} style={{ cursor: "pointer", border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.12)", color: "rgba(239,68,68,0.85)", padding: "3px 8px", borderRadius: 6, fontSize: 11 }}>Clear</button>
                </>
              )}
              <button type="button" onClick={() => setRgLogOpen(false)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>✕</button>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: rgLog.length === 0 ? "16px 12px" : "4px 0" }}>
            {rgLog.length === 0 ? (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: 0, textAlign: "center" }}>No searches yet.<br/>Click any square on the map to zoom in, then right-click for full area details.</p>
            ) : rgLog.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{entry.postcode}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.4 }}>
                    <div>🌊 {entry.floodSummary}</div>
                    <div>🏫 {entry.schoolSummary}</div>
                    <div>🚂 {entry.stationSummary}</div>
                    {entry.cellMedian && <div>🏠 {entry.cellMedian >= 1000000 ? `£${(entry.cellMedian / 1000000).toFixed(1)}m` : `£${Math.round(entry.cellMedian / 1000)}k`}{entry.cellDeltaPct !== undefined ? ` (${entry.cellDeltaPct >= 0 ? "▲" : "▼"}${Math.abs(entry.cellDeltaPct).toFixed(1)}%)` : ""}</div>}
                    {entry.constituency && <div>🗳️ {entry.constituency}</div>}
                  </div>
                </div>
                <button type="button" onClick={() => setRgLog((prev) => prev.filter((_, j) => j !== i))} title="Remove" style={{ cursor: "pointer", border: "none", background: "transparent", color: "rgba(255,255,255,0.3)", fontSize: 14, padding: "0 2px", alignSelf: "flex-start", flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="control-row" style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8, alignItems: "center" }}>
      <div className="control-label" style={{ fontSize: 11, opacity: 0.8 }}>{label}</div>
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
              padding: "5px 9px",
              fontSize: 11,
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
      input.budget-input::-webkit-inner-spin-button,
      input.budget-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      input.budget-input { appearance: textfield; -moz-appearance: textfield; }
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
          bottom: 14px !important;
          top: auto !important;
          transform: none !important;
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
          /* left offset clears the mobile-grid-dock column (10px + ~48px btn + 6px gap) */
          left: 68px !important;
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
          left: 74px !important;
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



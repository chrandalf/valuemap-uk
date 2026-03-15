"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type GridSize = "1mile" | "5km" | "10km" | "25km";
type Metric = "median" | "median_ppsf" | "delta_gbp" | "delta_pct";
type ValueFilterMode = "off" | "lte" | "gte";
type FloodOverlayMode = "off" | "on" | "on_hide_cells";
type SchoolOverlayMode = "off" | "on" | "on_hide_cells";
type PrimarySchoolOverlayMode = "off" | "on" | "on_hide_cells";
type StationOverlayMode = "off" | "on" | "on_hide_cells";
type VoteOverlayMode = "off" | "on";
type CommuteOverlayMode = "off" | "on";
type AgeOverlayMode = "off" | "on";
type CrimeOverlayMode = "off" | "on" | "on_hide_cells";
type CrimeCellMode = "off" | "on";
type EpcFuelOverlayMode = "off" | "on";
type EpcFuelType = "gas" | "electric" | "oil" | "lpg";
type BroadbandCellOverlayMode = "off" | "on";
type BroadbandCellMetric = "avg_speed" | "pct_sfbb" | "pct_fast";
type ListedBuildingCellOverlayMode = "off" | "on";
type CrimeCellScale = "absolute" | "relative";
type CrimeCellSubMode = "total" | "violent" | "property" | "asb";
type VoteColorScale = "relative" | "absolute";
type BusStopOverlayMode = "off" | "on" | "on_hide_cells";
type PharmacyOverlayMode = "off" | "on" | "on_hide_cells";
type PubOverlayMode = "off" | "on" | "on_hide_cells";
type SupermarketOverlayMode = "off" | "on" | "on_hide_cells";
type ListedBuildingOverlayMode = "off" | "on" | "on_hide_cells";
type PlanningOverlayMode = "off" | "on" | "on_hide_cells";
type HolidayLetOverlayMode = "off" | "on" | "on_hide_cells";

export type MapState = {
  grid: GridSize;
  metric: Metric;
  propertyType: string;
  newBuild: string;
  endMonth?: string;
  valueFilterMode?: ValueFilterMode;
  valueThreshold?: number;
  floodOverlayMode?: FloodOverlayMode;
  schoolOverlayMode?: SchoolOverlayMode;
  primarySchoolOverlayMode?: PrimarySchoolOverlayMode;
  stationOverlayMode?: StationOverlayMode;
  voteOverlayMode?: VoteOverlayMode;
  commuteOverlayMode?: CommuteOverlayMode;
  ageOverlayMode?: AgeOverlayMode;
  crimeOverlayMode?: CrimeOverlayMode;
  crimeCellMode?: CrimeCellMode;
  crimeCellScale?: CrimeCellScale;
  crimeCellSubMode?: CrimeCellSubMode;
  voteColorScale?: VoteColorScale;
  epcFuelOverlayMode?: EpcFuelOverlayMode;
  epcFuelType?: EpcFuelType;
  broadbandCellOverlayMode?: BroadbandCellOverlayMode;
  broadbandCellMetric?: BroadbandCellMetric;
  listedBuildingCellOverlayMode?: ListedBuildingCellOverlayMode;
  overlayFilterThreshold?: number; // threshold for cell-overlay filter (units depend on active overlay)
  modelledMode?: "actual" | "blend" | "estimated" | "model_only";
  busStopOverlayMode?: BusStopOverlayMode;
  pharmacyOverlayMode?: PharmacyOverlayMode;
  pubOverlayMode?: PubOverlayMode;
  supermarketOverlayMode?: SupermarketOverlayMode;
  listedBuildingOverlayMode?: ListedBuildingOverlayMode;
  planningOverlayMode?: PlanningOverlayMode;
  holidayLetOverlayMode?: HolidayLetOverlayMode;
};

export type IndexPrefs = {
  budget: number;           // target price (median GBP or PPSF depending on metric)
  propertyType: string;     // property type for affordability (ALL|D|S|T|F or comma-joined e.g. D,S)
  affordWeight: number;     // 0-10 importance
  floodWeight: number;      // 0-10 importance
  schoolWeight: number;        // 0-10 importance (secondary school quality)
  primarySchoolWeight?: number; // 0-10 importance (nearest primary school walking distance)
  trainWeight: number;          // 0-10 importance (nearest station distance)
  trainMaxDistMiles?: number;   // when set (Must mode): hard cap — cells beyond this are zeroed; score is linear up to this distance
  coastWeight: number;          // 0-10 importance (placeholder for now)
  ageWeight?: number;       // 0-10 importance (community age mix)
  ageDirection?: "young" | "old"; // prefer younger or older communities
  crimeWeight?: number;     // 0-10 importance (local crime safety)
  epcFuelWeight?: number;       // 0-10 importance (heating fuel preference)
  epcFuelPreference?: string;   // "gas" | "electric" | "oil" | "lpg" | "no_gas"
  broadbandWeight?: number;     // 0-10 importance (internet speed tier: 3=SFBB/30Mb+, 6=Cable/100Mb+, 10=Fibre/300Mb+)
  busWeight?: number;           // 0-10 importance (bus stop / metro / tram proximity)
  pharmacyWeight?: number;      // 0-10 importance (nearest community pharmacy distance)
  pubWeight?: number;           // 0-10 importance (nearest pub/bar distance)
  supermarketWeight?: number;   // 0-10 importance (nearest food shop distance)
  regionBboxes?: [number, number, number, number][] | null; // restrict scored cells to any of these [minLon, minLat, maxLon, maxLat] bboxes
  indexFilterMode?: "off" | "lte" | "gte" | "area_only" | "top_pct";
  indexFilterThreshold?: number; // 0..1
  forceToken?: number; // increment to force a full rescore even when all other prefs are unchanged
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
  pct_progressive?: number;
  pct_conservative?: number;
  pct_popular_right?: number;
  constituency?: string;
  country?: string;   // E/W/S/N from PCON24CD prefix
  mean_dist_km?: number;
  pct_wfh?: number;
  pct_lt5?: number;
  pct_5_10?: number;
  pct_10_20?: number;
  pct_20_60?: number;
  pct_60p?: number;
  mean_age?: number;
  age_score?: number;
  pct_under_15?: number;
  pct_15_24?: number;
  pct_25_44?: number;
  pct_45_64?: number;
  pct_65_plus?: number;
  // crime cell overlay
  violent_rate?: number;
  property_rate?: number;
  asb_rate?: number;
  total_rate?: number;
  crime_score?: number;
  violent_score?: number;
  property_score?: number;
  asb_score?: number;
  crime_local_score?: number;
  violent_local_score?: number;
  property_local_score?: number;
  asb_local_score?: number;
  violent_count?: number;
  property_count?: number;
  asb_count?: number;
  total_count?: number;
  // EPC heating fuel overlay
  epc_n?: number;
  pct_gas?: number;
  pct_electric?: number;
  pct_oil?: number;
  pct_lpg?: number;
  fuel_pct_other?: number;
  // modelled price estimate fields
  is_modelled?: boolean;
  model_confidence?: number;   // 0 | 1 | 2
  n_years_model?: number;
  ratio_cv_model?: number;
  estimated_median?: number;
  actual_median?: number;
};

function isDeltaMetric(metric: Metric) {
  return metric === "delta_gbp" || metric === "delta_pct";
}

function metricPropName(metric: Metric): "median" | "delta_gbp" | "delta_pct" {
  if (metric === "delta_gbp" || metric === "delta_pct") return metric;
  return "median";
}

/**
 * Returns the GeoJSON property name + optional divisor to apply to `overlayFilterThreshold`
 * when a cell colour overlay is active. Returns null when house-price filter should be used.
 */
function getActiveCellOverlayFilterField(state: MapState): { field: string; divisor?: number; invert?: boolean } | null {
  if ((state.broadbandCellOverlayMode ?? "off") !== "off") {
    const metric = state.broadbandCellMetric ?? "avg_speed";
    if (metric === "avg_speed") return { field: "bb_avg_speed" };
    if (metric === "pct_sfbb")  return { field: "bb_pct_sfbb" };
    return { field: "bb_pct_fast" };
  }
  if ((state.crimeCellMode ?? "off") !== "off") {
    return { field: state.crimeCellScale === "relative" ? "crime_local_score" : "crime_score" };
  }
  if ((state.epcFuelOverlayMode ?? "off") !== "off") {
    const fuel = state.epcFuelType ?? "gas";
    const field = fuel === "electric" ? "pct_electric" : fuel === "oil" ? "pct_oil" : fuel === "lpg" ? "pct_lpg" : "pct_gas";
    return { field };
  }
  if ((state.ageOverlayMode ?? "off") !== "off") {
    // age_score is 0–1 (0=oldest, 1=youngest). Slider is 0–100 meaning "% older".
    // invert=true makes higher slider = older (we flip the op and use 1-threshold/100)
    return { field: "age_score", divisor: 100, invert: true };
  }
  if ((state.commuteOverlayMode ?? "off") !== "off") {
    return { field: "mean_dist_km" };
  }
  if ((state.listedBuildingCellOverlayMode ?? "off") !== "off") {
    return { field: "lb_score" };
  }
  return null;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type FloodSearchStatus = "found" | "broad-has-risk" | "no-risk-nearest" | "not-found" | "error";

type FloodSearchResult = {
  status: FloodSearchStatus;
  lookupMode?: "flood" | "schools" | "both";
  normalizedQuery: string;
  matchedPostcode?: string;
  nearestPostcode?: string;
  hierarchyMatchCount?: number;
  schoolNearest?: {
    schoolName: string;
    postcode: string;
    distanceMeters: number;
    qualityScore: number;
    qualityBand: string;
  };
  schoolNearestGood?: {
    schoolName: string;
    postcode: string;
    distanceMeters: number;
    qualityScore: number;
    qualityBand: string;
  };
  stationNearest?: {
    name: string;
    code: string;
    distanceMeters: number;
  };
};

type FloodSearchEntry = {
  postcode: string;
  postcodeKey: string;
  riskScore: number;
  lon: number;
  lat: number;
};

type SchoolSearchEntry = {
  schoolName: string;
  postcode: string;
  postcodeKey: string;
  qualityScore: number;
  qualityBand: string;
  isGood: boolean;
  lon: number;
  lat: number;
};

type StationSearchEntry = {
  name: string;
  code: string;
  owner: string;
  lon: number;
  lat: number;
};

const LOCAL_NEAREST_FLOOD_MAX_DISTANCE_METERS = 8_047; // 5 miles
const LOCAL_NEAREST_SCHOOL_MAX_DISTANCE_METERS = 19_312; // 12 miles
const LOCAL_NEAREST_STATION_MAX_DISTANCE_METERS = 80_467; // 50 miles
// Distance scoring for train station: full score within 1 mile, zero at 20 miles
const STATION_GOOD_DISTANCE_METERS = 1_609; // 1 mile
const STATION_MAX_DISTANCE_METERS = 16_093; // 10 miles
// Distance scoring for bus stops (BCT/BCS)
const BUS_STOP_GREAT_METERS   = 500;    // ≤500m = full score
const BUS_STOP_MAX_METERS     = 1_500;  // ≥1500m = zero
// Distance scoring for metro/tram (TMU/PLT)
const METRO_TRAM_GREAT_METERS = 750;    // ≤750m = full score
const METRO_TRAM_MAX_METERS   = 2_500;  // ≥2500m = zero
// Distance scoring for community pharmacies
const PHARMACY_GREAT_METERS   = 800;    // ≤800m (10-min walk) = full score
const PHARMACY_MAX_METERS     = 5_000;  // ≥5000m (few-min drive) = zero
const PUB_GREAT_METERS        = 400;    // ≤400m (5-min walk) = full score
const PUB_MAX_METERS          = 2_500;  // ≥2500m = zero
const SUPERMARKET_GREAT_METERS = 500;   // ≤500m (6-min walk) = full score
const SUPERMARKET_MAX_METERS   = 4_000; // ≥4000m = zero

const VOTE_CELLS_DATA_VERSION = process.env.NEXT_PUBLIC_VOTE_CELLS_DATA_VERSION ?? "20260222b";

// Compute which field tier to request from the cells API.
// "core" skips commute + vote lookups (saves ~2.7 MB R2 reads on the Worker) and
// returns only the fields needed for scoring and overlay paint expressions.
// "full" returns everything — needed when commute or vote overlay is active.
function computeFieldsTier(state: MapState): "core" | "full" {
  if ((state.commuteOverlayMode ?? "off") !== "off") return "full";
  if ((state.voteOverlayMode   ?? "off") !== "off") return "full";
  return "core";
}
const COMMUTE_CELLS_DATA_VERSION = process.env.NEXT_PUBLIC_COMMUTE_CELLS_DATA_VERSION ?? "20260301a";
const AGE_CELLS_DATA_VERSION = process.env.NEXT_PUBLIC_AGE_CELLS_DATA_VERSION ?? "20260301a";

/** Registers custom raster icons on a map instance. Call before adding icon-dependent layers. */
function addMapIcons(map: maplibregl.Map): void {
  if (map.hasImage("train-icon")) return;
  const SZ = 48; // canvas px; rendered as 24 logical px at pixel-ratio 2
  const canvas = document.createElement("canvas");
  canvas.width = SZ;
  canvas.height = SZ;
  const ctx = canvas.getContext("2d")!;

  // Helper: manual rounded-rect path (avoids roundRect browser-compat issues)
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // Dark-red circle badge background
  ctx.beginPath(); ctx.arc(24, 24, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#991b1b"; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.88)"; ctx.lineWidth = 2.5; ctx.stroke();

  // Train body (white rounded rect, side-view)
  rr(7, 19, 34, 14, 3); ctx.fillStyle = "white"; ctx.fill();

  // Chimney (white rounded rect above body, left)
  rr(11, 12, 5, 8, 1.5); ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();

  // Windows (blue)
  ctx.fillStyle = "#60a5fa";
  rr(10, 22, 9, 6, 1.5); ctx.fill();
  rr(23, 22, 9, 6, 1.5); ctx.fill();

  // Wheels (dark, white-stroked, peeking below body)
  ctx.fillStyle = "#1f2937"; ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 1.5;
  for (const wx of [14, 33]) {
    ctx.beginPath(); ctx.arc(wx, 35, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  map.addImage("train-icon", ctx.getImageData(0, 0, SZ, SZ), { pixelRatio: 2 });
}

export type LocateMeResult = {
  status: "success" | "denied" | "unavailable" | "timeout" | "error";
  message: string;
  accuracyMeters?: number;
  coords?: { lng: number; lat: number };
  cell?: {
    grid: GridSize;
    median?: number;
    txCount?: number;
    deltaGbp?: number;
    deltaPct?: number;
  };
  floodNearest?: {
    postcode: string;
    riskScore: number;
    riskBand: string;
    distanceMeters: number;
  };
  schoolNearest?: {
    schoolName: string;
    postcode: string;
    qualityScore: number;
    qualityBand: string;
    distanceMeters: number;
  };
  schoolNearestGood?: {
    schoolName: string;
    postcode: string;
    qualityScore: number;
    qualityBand: string;
    distanceMeters: number;
  };
  stationNearest?: {
    name: string;
    code: string;
    distanceMeters: number;
  };
};

export type RgLogEntry = {
  postcode: string;
  lat: number;
  lng: number;
  timestamp: string;      // ISO-8601
  floodSummary: string;   // plain text
  schoolSummary: string;
  primarySchoolSummary?: string;
  stationSummary: string;
  cellMedian?: number;    // median house price in the clicked cell
  cellDeltaPct?: number;  // price change % (negative = fallen)
  cellDeltaGbp?: number;  // price change in £
  cellTxCount?: number;   // transaction count in cell
  constituency?: string;  // Westminster constituency
  crimeSummary?: string;
  epcSummary?: string;
  broadbandSummary?: string;
  busStopSummary?: string;
  pharmacySummary?: string;
  pubSummary?: string;
  supermarketSummary?: string;
};

/** Data passed to page.tsx for the right-click info panel. */
export type RightClickInfoData =
  | { stage: 'loading'; clickLat: number; clickLng: number }
  | { stage: 'ready'; postcode: string; isOutcode: boolean; floodHtml: string; schoolHtml: string; primarySchoolHtml: string; stationHtml: string; crimeHtml: string; epcHtml?: string; broadbandHtml?: string; busStopHtml?: string; pharmacyHtml?: string; pubHtml?: string; supermarketHtml?: string; clickLat: number; clickLng: number; cellMedian?: number; cellDeltaPct?: number; cellDeltaGbp?: number; cellTxCount?: number; cellP25?: number; cellP70?: number; cellP90?: number; cellPSource?: string; constituency?: string; };

export default function ValueMap({
  state,
  onLegendChange,
  onPostcodePanelChange,
  onZoomChange,
  postcodeSearchQuery,
  postcodeSearchToken,
  postcodeSearchClearToken,
  onPostcodeSearchResult,
  locateMeToken,
  onLocateMeResult,
  indexPrefs,
  onIndexScoringApplied,
  onStatsUpdate,
  flyToRequest,
  easyColours,
  onReverseGeocode,
  onLocationLogged,
  onOpenLog,
  rgLogCount,
  tapToSearch,
  onRightClickInfo,
  rgDismissToken,
  hintsEnabled,
  showRgLines,
  prefetchGrids,
  indexFilterApplyRef,
  indexRelativeApplyRef,
  programmaticRgRequest,
}: {
  state: MapState;
  onLegendChange?: (legend: LegendData | null) => void;
  onPostcodePanelChange?: (open: boolean) => void;
  onZoomChange?: (zoom: number) => void;
  postcodeSearchQuery?: string;
  postcodeSearchToken?: number;
  /** Incrementing token: when it changes the map clears all postcode search state (marker, flood/school focus). */
  postcodeSearchClearToken?: number;
  onPostcodeSearchResult?: (result: FloodSearchResult) => void;
  locateMeToken?: number;
  onLocateMeResult?: (result: LocateMeResult) => void;
  indexPrefs?: IndexPrefs | null;
  onIndexScoringApplied?: () => void;
  onStatsUpdate?: (stats: { label: string; value: string; txCount: number } | null) => void;
  flyToRequest?: { center: [number, number]; zoom: number; token: number } | null;
  /** When true, swap all map colour ramps to colorblind-safe palettes (Viridis / BrBG). */
  easyColours?: boolean;
  /** Called when the user right-clicks the map and a postcode is successfully reverse-geocoded. */
  onReverseGeocode?: (postcode: string) => void;
  /** Called each time a reverse-geocode popup resolves with its full summary data (for the log). */
  onLocationLogged?: (entry: RgLogEntry) => void;
  /** Called when the user clicks "See log" inside a reverse-geocode popup. */
  onOpenLog?: () => void;
  /** Current number of entries in the search log — used to show the "Added to log #N" hint in the popup. */
  rgLogCount?: number;
  /** When true, a single tap/click anywhere on the map triggers the postcode reverse-geocode popup (for mobile users). */
  tapToSearch?: boolean;
  /** Called with info data when a right-click resolves, or null to clear the panel. */
  onRightClickInfo?: (data: RightClickInfoData | null) => void;
  /** Incrementing token: when it changes Map.tsx clears the right-click overlay lines/dot (panel dismissed by user). */
  rgDismissToken?: number;
  /** When false, suppresses on-map hint bubbles (cell-click nudge etc.). User can toggle in Controls. */
  hintsEnabled?: boolean;
  /** Controls per-category visibility of right-click focus/connection lines on the map. Each key defaults to true. */
  showRgLines?: { flood?: boolean; school?: boolean; primarySchool?: boolean; station?: boolean; crime?: boolean; busStop?: boolean; pharmacy?: boolean; pub?: boolean; supermarket?: boolean };
  /**
   * Grid sizes to silently pre-fetch into the internal geo-cache without changing the displayed grid.
   * Pass ["1mile"] so 1mile data is ready the moment Find My Area switches to it.
   */
  prefetchGrids?: GridSize[];
  /**
   * Mutable ref that Map.tsx populates with a function for applying an index-score filter threshold
   * directly (bypassing the React state → useMemo → prop chain). Used by the match-score slider
   * to achieve sub-frame filter updates without triggering full component re-renders.
   */
  indexFilterApplyRef?: React.MutableRefObject<((threshold: number) => void) | null>;
  /**
   * Mutable ref for relative (percentile) preset jumps. Computes the absolute score threshold
   * from the live source distribution and returns it so the caller can sync React state.
   * pct: fraction of cells to show (0.1 = top/bottom 10%), direction: "top" or "bottom".
   */
  indexRelativeApplyRef?: React.MutableRefObject<((pct: number, direction: "top" | "bottom") => number) | null>;
  /** When token changes, programmatically triggers a right-click info search at the given coords. */
  programmaticRgRequest?: { lat: number; lon: number; token: number } | null;
}) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const stateRef = useRef<MapState>(state);
  const onZoomChangeRef = useRef<typeof onZoomChange>(onZoomChange);
  const onPostcodeSearchResultRef = useRef<typeof onPostcodeSearchResult>(onPostcodeSearchResult);
  const onLocateMeResultRef = useRef<typeof onLocateMeResult>(onLocateMeResult);
  const onIndexScoringAppliedRef = useRef<typeof onIndexScoringApplied>(onIndexScoringApplied);
  const onStatsUpdateRef = useRef<typeof onStatsUpdate>(onStatsUpdate);
  const onReverseGeocodeRef = useRef<typeof onReverseGeocode>(onReverseGeocode);
  const onLocationLoggedRef = useRef<typeof onLocationLogged>(onLocationLogged);
  const onOpenLogRef = useRef<typeof onOpenLog>(onOpenLog);
  const rgLogCountRef = useRef<number>(rgLogCount ?? 0);
  const tapToSearchRef = useRef<boolean>(!!tapToSearch);
  const onRightClickInfoRef = useRef<typeof onRightClickInfo>(onRightClickInfo);
  const clearRgOverlayRef = useRef<(() => void) | null>(null);
  const doReverseGeocodeRef = useRef<((lon: number, lat: number) => void) | null>(null);
  const rgClickMarkerRef = useRef<maplibregl.Marker | null>(null);
  const locateMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [postcodeCell, setPostcodeCell] = useState<string | null>(null);
  const [postcodeItems, setPostcodeItems] = useState<string[]>([]);
  const [postcodeTotal, setPostcodeTotal] = useState(0);
  const [postcodeOffset, setPostcodeOffset] = useState(0);
  const [postcodeLoading, setPostcodeLoading] = useState(false);
  const [postcodeError, setPostcodeError] = useState<string | null>(null);
  const [scotlandNote, setScotlandNote] = useState<string | null>(null);
  const [postcodeMaxPrice, setPostcodeMaxPrice] = useState<number | null>(null);
  const [cellClickHint, setCellClickHint] = useState<{ x: number; y: number } | null>(null);
  const cellClickHintTimerRef = useRef<number | null>(null);
  const fetchPostcodesRef = useRef<(gx: number, gy: number, offset: number, append: boolean) => void>(() => {});
  const floodSearchEntriesRef = useRef<FloodSearchEntry[] | null>(null);
  const floodSearchEntriesPromiseRef = useRef<Promise<FloodSearchEntry[]> | null>(null);
  const schoolSearchEntriesRef = useRef<SchoolSearchEntry[] | null>(null);
  const schoolSearchEntriesPromiseRef = useRef<Promise<SchoolSearchEntry[]> | null>(null);
  const stationSearchEntriesRef = useRef<StationSearchEntry[] | null>(null);
  const stationSearchEntriesPromiseRef = useRef<Promise<StationSearchEntry[]> | null>(null);
  const indexPrefsRef = useRef<IndexPrefs | null>(indexPrefs ?? null);
  const prevIndexActiveRef = useRef(false);
  const prevIndexScoringSignatureRef = useRef<string | null>(null);
  const cellFcRef = useRef<any>(null);
  const easyColoursRef = useRef(easyColours ?? false);
  // NOTE: any new help nudges/hints rendered inside Map.tsx must check hintsEnabledRef.current before showing.
  // Nudges currently gated: cellClickHint bubble (cell-click → "double-tap for details").
  const hintsEnabledRef = useRef<boolean>(hintsEnabled ?? true);


  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Silently pre-warm the geo cache for the requested grids without changing
  // what is displayed. This lets Find My Area switch to 1mile with a cache hit
  // (instant display) rather than waiting for a fresh fetch.
  useEffect(() => {
    if (!prefetchGrids?.length) return;
    const map = mapRef.current;
    const warm = () => {
      const isDelta = isDeltaMetric(state.metric);
      if (isDelta) return; // delta grids are derived — skip
      const endMonth = state.endMonth ?? "LATEST";
      for (const grid of prefetchGrids) {
        if (grid === state.grid) continue; // already loaded/loading as active grid
        const basePrefetchKey = `${grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth}|${state.modelledMode ?? "blend"}|${VOTE_CELLS_DATA_VERSION}`;
        const cacheKey = `${basePrefetchKey}|core`;
        if (geoCacheRef.current.has(cacheKey) || geoCacheRef.current.has(`${basePrefetchKey}|full`)) continue; // already cached
        const qs = new URLSearchParams({
          grid,
          propertyType: state.propertyType ?? "ALL",
          newBuild: state.newBuild ?? "ALL",
          metric: state.metric,
          endMonth,
        });
        if (grid === "1mile") qs.set("modelled", state.modelledMode ?? "blend");
        qs.set("fields", "core");
        qs.set("voteDataVersion", VOTE_CELLS_DATA_VERSION);
        (async () => {
          try {
            const res = await fetch(`/api/cells?${qs.toString()}`);
            if (!res.ok) return;
            const payload: any = await res.json();
            const rows: any[] = Array.isArray(payload) ? payload : payload.rows;
            if (!Array.isArray(rows)) return;
            // Only cache if still not present (another request may have filled it)
            if (!geoCacheRef.current.has(cacheKey)) {
              geoCacheRef.current.set(cacheKey, rowsToGeoJsonSquares(rows, gridToMeters(grid)));
            }
          } catch { /* non-critical, silently ignore */ }
        })();
      }
    };
    if (map?.isStyleLoaded()) warm();
    else map?.once("load", warm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchGrids, state.metric, state.propertyType, state.newBuild, state.endMonth, state.modelledMode, state.grid]);

  // Populate the imperative filter-apply ref so the match-score slider can call
  // applyCombinedCellFilters directly, bypassing the React state → useMemo → prop
  // change → useEffect chain. Setting a MutableRefObject in the render function is
  // intentional and idiomatic — the function always reads current values from refs.
  if (indexFilterApplyRef != null) {
    indexFilterApplyRef.current = (threshold: number) => {
      const prefs = indexPrefsRef.current;
      if (!prefs) return;
      const map = mapRef.current;
      if (!map) return;
      const updated: IndexPrefs = { ...prefs, indexFilterThreshold: threshold };
      indexPrefsRef.current = updated;
      applyCombinedCellFilters(map, stateRef.current, updated);
    };
  }

  // Imperative ref for relative percentile jumps. Computes the absolute score threshold
  // from the live source distribution and returns it so the caller can sync React state.
  // Avoids the mode-lag bug where React state hasn't propagated to indexPrefsRef yet
  // at the moment the button click fires.
  // Imperative ref for relative preset buttons.
  // "top" direction: stays in top_pct mode — applyCombinedCellFilters computes the live
  //   percentile internally from indexFilterThreshold. Returns the integer slider % (1, 10, 25).
  // "bottom" direction: computes absolute score threshold from live distribution, switches to
  //   lte mode, returns abs*100 as slider % — or -1 if data not yet scored.
  if (indexRelativeApplyRef != null) {
    indexRelativeApplyRef.current = (pct: number, direction: "top" | "bottom"): number => {
      const prefs = indexPrefsRef.current;
      const map = mapRef.current;
      if (!prefs || !map) return -1;
      if (direction === "top") {
        // Stay in top_pct — threshold IS the fractional percentile, live computation happens in applyCombinedCellFilters
        const updated: IndexPrefs = { ...prefs, indexFilterMode: "top_pct", indexFilterThreshold: pct };
        indexPrefsRef.current = updated;
        applyCombinedCellFilters(map, stateRef.current, updated);
        return Math.round(pct * 100); // integer slider % the caller should display
      } else {
        // Bottom: compute the score at the bottomPct-th quantile from the low end, switch to lte
        const absThreshold = computeBottomThreshold(pct);
        if (absThreshold === null) return -1; // not yet scored
        const updated: IndexPrefs = { ...prefs, indexFilterMode: "lte", indexFilterThreshold: absThreshold };
        indexPrefsRef.current = updated;
        applyCombinedCellFilters(map, stateRef.current, updated);
        return Math.round(absThreshold * 100);
      }
    };
  }

  useEffect(() => {
    easyColoursRef.current = easyColours ?? false;
  }, [easyColours]);

  useEffect(() => {
    hintsEnabledRef.current = hintsEnabled ?? true;
  }, [hintsEnabled]);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    onPostcodeSearchResultRef.current = onPostcodeSearchResult;
  }, [onPostcodeSearchResult]);

  useEffect(() => {
    onReverseGeocodeRef.current = onReverseGeocode;
  }, [onReverseGeocode]);

  useEffect(() => {
    onLocationLoggedRef.current = onLocationLogged;
  }, [onLocationLogged]);

  useEffect(() => {
    onOpenLogRef.current = onOpenLog;
  }, [onOpenLog]);

  useEffect(() => {
    rgLogCountRef.current = rgLogCount ?? 0;
  }, [rgLogCount]);

  useEffect(() => {
    tapToSearchRef.current = !!tapToSearch;
  }, [tapToSearch]);

  useEffect(() => {
    onRightClickInfoRef.current = onRightClickInfo;
  }, [onRightClickInfo]);

  // When page.tsx dismisses the panel (user clicked ✕), clear the map overlay lines+dot.
  useEffect(() => {
    if (!rgDismissToken) return;
    clearRgOverlayRef.current?.();
  }, [rgDismissToken]);

  // Programmatic right-click search triggered from outside (e.g. "View on map" from Price Check).
  useEffect(() => {
    if (!programmaticRgRequest || programmaticRgRequest.token < 1) return;
    doReverseGeocodeRef.current?.(programmaticRgRequest.lon, programmaticRgRequest.lat);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programmaticRgRequest?.token]);

  // Toggle per-category visibility of right-click focus/connection lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const setVis = (ids: string[], on: boolean) => {
      const v = on ? "visible" : "none";
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    };
    const cfg = showRgLines;
    setVis(["flood-search-focus-ring", "flood-search-focus-dot"], cfg?.flood ?? true);
    setVis(["school-search-focus-nearest-line", "school-search-focus-nearest-label", "school-search-focus-good-line", "school-search-focus-good-label", "school-search-focus-ring", "school-search-focus-good-ring"], cfg?.school ?? true);
    setVis(["primary-school-search-focus-line", "primary-school-search-focus-label", "primary-school-search-focus-ring"], cfg?.primarySchool ?? true);
    setVis(["station-search-focus-outer", "station-search-focus-link", "station-search-focus-label", "station-search-focus-ring", "station-search-focus-dot"], cfg?.station ?? true);
    setVis(["crime-search-focus-line", "crime-search-focus-label", "crime-search-focus-ring"], cfg?.crime ?? true);
    setVis(["bus-stop-search-focus-line", "bus-stop-search-focus-label", "bus-stop-search-focus-ring"], cfg?.busStop ?? true);
    setVis(["pharmacy-search-focus-line", "pharmacy-search-focus-label", "pharmacy-search-focus-ring"], cfg?.pharmacy ?? true);
    setVis(["pub-search-focus-line", "pub-search-focus-label", "pub-search-focus-ring"], cfg?.pub ?? true);
    setVis(["supermarket-search-focus-line", "supermarket-search-focus-label", "supermarket-search-focus-ring"], cfg?.supermarket ?? true);
  }, [showRgLines?.flood, showRgLines?.school, showRgLines?.primarySchool, showRgLines?.station, showRgLines?.crime, showRgLines?.busStop, showRgLines?.pharmacy, showRgLines?.pub, showRgLines?.supermarket]);

  useEffect(() => {
    onLocateMeResultRef.current = onLocateMeResult;
  }, [onLocateMeResult]);

  useEffect(() => {
    onIndexScoringAppliedRef.current = onIndexScoringApplied;
    onStatsUpdateRef.current = onStatsUpdate;
  }, [onIndexScoringApplied, onStatsUpdate]);

  // ── postcodeSearchClearToken: wipe all postcode search state from the map ──
  useEffect(() => {
    if (!postcodeSearchClearToken) return;
    const map = mapRef.current;
    if (!map) return;
    setPostcodeSearchMarker(map, null);
    setFloodSearchFocus(map, null);
    setFloodSearchContext(map, null);
    setSchoolSearchFocus(map, null, null, null);
    setStationSearchFocus(map, null, null);
    setPostcodeCell(null);
  }, [postcodeSearchClearToken]);

  // ── flyToRequest: let parent drive map pan/zoom (used by guided tour) ──
  const flyToTokenRef = useRef(0);
  useEffect(() => {
    if (!flyToRequest) return;
    if (flyToRequest.token <= flyToTokenRef.current) return;
    flyToTokenRef.current = flyToRequest.token;
    const map = mapRef.current;
    if (!map) return;
    const run = () => {
      animateToPostcodeTarget(map, flyToRequest.center, flyToRequest.zoom);
    };
    if (map.isStyleLoaded()) run();
    else map.once("idle", run);
  }, [flyToRequest]);

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

  useEffect(() => {
    if (!postcodeSearchToken || postcodeSearchToken < 1) return;

    const rawQuery = (postcodeSearchQuery ?? "").trim();
    const normalized = normalizePostcodeSearch(rawQuery);
    if (!normalized) return;

    const map = mapRef.current;
    if (!map) return;

    const runSearch = async () => {
      try {
        const floodEnabled = (stateRef.current.floodOverlayMode ?? "off") !== "off";
        const schoolsEnabled = (stateRef.current.schoolOverlayMode ?? "off") !== "off";
        const stationsEnabled = (stateRef.current.stationOverlayMode ?? "off") !== "off";
        const lookupMode: FloodSearchResult["lookupMode"] = floodEnabled
          ? (schoolsEnabled ? "both" : "flood")
          : schoolsEnabled ? "schools" : undefined;

        const requestedCoords = await lookupPostcodeCoords(normalized);
        setPostcodeSearchMarker(map, requestedCoords);
        const schoolEntries = schoolsEnabled
          ? await getSchoolSearchEntries(schoolSearchEntriesRef, schoolSearchEntriesPromiseRef)
          : [];
        const nearestSchool = schoolsEnabled
          ? (requestedCoords
              ? findNearestSchoolEntryByDistance(
                  requestedCoords.lon,
                  requestedCoords.lat,
                  schoolEntries,
                  LOCAL_NEAREST_SCHOOL_MAX_DISTANCE_METERS
                )
              : findNearestSchoolPostcodeMatch(normalized, schoolEntries))
          : null;
        const nearestGoodSchool = schoolsEnabled
          ? (requestedCoords
              ? findNearestSchoolEntryByDistance(
                  requestedCoords.lon,
                  requestedCoords.lat,
                  schoolEntries.filter((entry) => entry.isGood),
                  LOCAL_NEAREST_SCHOOL_MAX_DISTANCE_METERS
                )
              : findNearestSchoolPostcodeMatch(
                  normalized,
                  schoolEntries.filter((entry) => entry.isGood)
                ))
          : null;

        setSchoolSearchFocus(map, nearestSchool, nearestGoodSchool, requestedCoords);

        // — Train station nearest —
        let nearestStation: (StationSearchEntry & { distanceMeters: number }) | null = null;
        if (stationsEnabled && requestedCoords) {
          const stationEntries = await getStationSearchEntries(stationSearchEntriesRef, stationSearchEntriesPromiseRef);
          nearestStation = findNearestStationByDistance(
            requestedCoords.lon,
            requestedCoords.lat,
            stationEntries,
            LOCAL_NEAREST_STATION_MAX_DISTANCE_METERS
          );
        }
        setStationSearchFocus(map, nearestStation, requestedCoords);
        const stationNearestPayload = nearestStation
          ? { name: nearestStation.name, code: nearestStation.code, distanceMeters: Math.round(nearestStation.distanceMeters) }
          : undefined;

        const schoolNearestPayload = nearestSchool
          ? {
              schoolName: nearestSchool.schoolName,
              postcode: nearestSchool.postcode,
              distanceMeters:
                "distanceMeters" in nearestSchool && Number.isFinite((nearestSchool as any).distanceMeters)
                  ? Math.round((nearestSchool as any).distanceMeters)
                  : 0,
              qualityScore: nearestSchool.qualityScore,
              qualityBand: nearestSchool.qualityBand,
            }
          : undefined;

        const schoolNearestGoodPayload = nearestGoodSchool
          ? {
              schoolName: nearestGoodSchool.schoolName,
              postcode: nearestGoodSchool.postcode,
              distanceMeters:
                "distanceMeters" in nearestGoodSchool && Number.isFinite((nearestGoodSchool as any).distanceMeters)
                  ? Math.round((nearestGoodSchool as any).distanceMeters)
                  : 0,
              qualityScore: nearestGoodSchool.qualityScore,
              qualityBand: nearestGoodSchool.qualityBand,
            }
          : undefined;

        if (!floodEnabled) {
          setFloodSearchFocus(map, null);
          setFloodSearchContext(map, null);

          const schoolAnchor = nearestSchool ?? nearestGoodSchool;
          if (schoolAnchor) {
            animateToPostcodeTarget(map, [schoolAnchor.lon, schoolAnchor.lat], Math.max(map.getZoom(), 12));
            onPostcodeSearchResultRef.current?.({
              status: "found",
              lookupMode,
              normalizedQuery: normalized,
              matchedPostcode: schoolAnchor.postcode,
              schoolNearest: schoolNearestPayload,
              schoolNearestGood: schoolNearestGoodPayload,
              stationNearest: stationNearestPayload,
            });
            return;
          }

          // Even with no overlay active, navigate to the postcode if coords are known
          if (requestedCoords) {
            animateToPostcodeTarget(map, [requestedCoords.lon, requestedCoords.lat], Math.max(map.getZoom(), 12));
            onPostcodeSearchResultRef.current?.({
              status: "found",
              lookupMode,
              normalizedQuery: normalized,
              matchedPostcode: normalized,
              schoolNearest: schoolNearestPayload,
              schoolNearestGood: schoolNearestGoodPayload,
              stationNearest: stationNearestPayload,
            });
            return;
          }

          onPostcodeSearchResultRef.current?.({
            status: "not-found",
            lookupMode,
            normalizedQuery: normalized,
            schoolNearest: schoolNearestPayload,
            schoolNearestGood: schoolNearestGoodPayload,
            stationNearest: stationNearestPayload,
          });
          return;
        }

        const entries = await getFloodSearchEntries(floodSearchEntriesRef, floodSearchEntriesPromiseRef);
        if (!entries.length) {
          onPostcodeSearchResultRef.current?.({
            status: "error",
            lookupMode,
            normalizedQuery: normalized,
            schoolNearest: schoolNearestPayload,
            schoolNearestGood: schoolNearestGoodPayload,
            stationNearest: stationNearestPayload,
          });
          return;
        }

        const exact = entries.find((entry) => entry.postcodeKey === normalized || normalizePostcodeSearch(entry.postcode) === normalized);
        if (exact) {
          animateToPostcodeTarget(map, [exact.lon, exact.lat], Math.max(map.getZoom(), 12));
          setFloodSearchFocus(map, exact);
          setFloodSearchContext(map, null);
          onPostcodeSearchResultRef.current?.({
            status: "found",
            lookupMode,
            normalizedQuery: normalized,
            matchedPostcode: exact.postcode,
            schoolNearest: schoolNearestPayload,
            schoolNearestGood: schoolNearestGoodPayload,
            stationNearest: stationNearestPayload,
          });
          return;
        }

        const hierarchyMatches = entries.filter((entry) => entry.postcodeKey.startsWith(normalized));
        if (hierarchyMatches.length > 0) {
          const representative = pickRepresentativeHierarchyMatch(map, hierarchyMatches);
          animateToPostcodeTarget(map, [representative.lon, representative.lat], Math.max(map.getZoom(), 12));
          setFloodSearchFocus(map, representative);
          setFloodSearchContext(map, null);
          onPostcodeSearchResultRef.current?.({
            status: "broad-has-risk",
            lookupMode,
            normalizedQuery: normalized,
            nearestPostcode: representative.postcode,
            hierarchyMatchCount: hierarchyMatches.length,
            schoolNearest: schoolNearestPayload,
            schoolNearestGood: schoolNearestGoodPayload,
            stationNearest: stationNearestPayload,
          });
          return;
        }

        const nearestByDistance = requestedCoords
          ? findNearestFloodEntryByDistance(
              requestedCoords.lon,
              requestedCoords.lat,
              entries,
              LOCAL_NEAREST_FLOOD_MAX_DISTANCE_METERS
            )
          : null;
        const nearest = requestedCoords
          ? nearestByDistance
          : (nearestByDistance ?? findNearestPostcodeMatch(normalized, entries));
        if (nearest) {
          animateToPostcodeTarget(map, [nearest.lon, nearest.lat], Math.max(map.getZoom(), 11));
          setFloodSearchFocus(map, nearest);
          setFloodSearchContext(
            map,
            requestedCoords
              ? {
                  requested: requestedCoords,
                  nearest: { lon: nearest.lon, lat: nearest.lat },
                }
              : null
          );
          onPostcodeSearchResultRef.current?.({
            status: "no-risk-nearest",
            lookupMode,
            normalizedQuery: normalized,
            nearestPostcode: nearest.postcode,
            schoolNearest: schoolNearestPayload,
            schoolNearestGood: schoolNearestGoodPayload,
            stationNearest: stationNearestPayload,
          });
          return;
        }

        setFloodSearchFocus(map, null);
        setFloodSearchContext(map, null);
        onPostcodeSearchResultRef.current?.({
          status: "not-found",
          lookupMode,
          normalizedQuery: normalized,
          schoolNearest: schoolNearestPayload,
          schoolNearestGood: schoolNearestGoodPayload,
          stationNearest: stationNearestPayload,
        });
      } catch {
        setFloodSearchFocus(map, null);
        setFloodSearchContext(map, null);
        setSchoolSearchFocus(map, null, null, null);
        setStationSearchFocus(map, null, null);
        setPostcodeSearchMarker(map, null);
        onPostcodeSearchResultRef.current?.({ status: "error", normalizedQuery: normalized });
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("idle", () => {
        void runSearch();
      });
      return;
    }

    void runSearch();
  }, [postcodeSearchToken]);

  useEffect(() => {
    if (!locateMeToken || locateMeToken < 1) return;

    const map = mapRef.current;
    if (!map) {
      onLocateMeResultRef.current?.({ status: "error", message: "Map not ready" });
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      onLocateMeResultRef.current?.({
        status: "unavailable",
        message: "Location is not supported on this device/browser",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lng = Number(position.coords.longitude);
        const lat = Number(position.coords.latitude);
        const accuracyMeters = Number(position.coords.accuracy);

        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          onLocateMeResultRef.current?.({ status: "error", message: "Invalid location coordinates" });
          return;
        }

        const run = async () => {
          animateToPostcodeTarget(map, [lng, lat], Math.max(map.getZoom(), 12));

          locateMarkerRef.current?.remove();
          locateMarkerRef.current = new maplibregl.Marker({ color: "#3b82f6" })
            .setLngLat([lng, lat])
            .addTo(map);

          const cellFeature = getCellFeatureAtLngLat(map, lng, lat);
          const cellProps = cellFeature?.properties ?? {};

          const gx = Number(cellProps?.gx);
          const gy = Number(cellProps?.gy);
          const median = Number(cellProps?.median);
          if (Number.isFinite(gx) && Number.isFinite(gy)) {
            setPostcodeMaxPrice(resolveZooplaMaxPrice(median));
            setScotlandNote(gy >= 568300 ? "Scotland data coverage is partial and may be 1–2 years out of date." : null);
            void fetchPostcodesRef.current(gx, gy, 0, false);
          }

          let floodNearest: LocateMeResult["floodNearest"];
          let schoolNearest: LocateMeResult["schoolNearest"];
          let schoolNearestGood: LocateMeResult["schoolNearestGood"];
          let stationNearest: LocateMeResult["stationNearest"];
          let nearestSchoolEntry: (SchoolSearchEntry & { distanceMeters: number }) | null = null;
          let nearestGoodEntry: (SchoolSearchEntry & { distanceMeters: number }) | null = null;
          const floodEnabled = (stateRef.current.floodOverlayMode ?? "off") !== "off";
          const schoolsEnabled = (stateRef.current.schoolOverlayMode ?? "off") !== "off";
          const stationsEnabled = (stateRef.current.stationOverlayMode ?? "off") !== "off";
          try {
            if (floodEnabled) {
              const entries = await getFloodSearchEntries(floodSearchEntriesRef, floodSearchEntriesPromiseRef);
              const nearest = findNearestFloodEntryByDistance(
                lng,
                lat,
                entries,
                LOCAL_NEAREST_FLOOD_MAX_DISTANCE_METERS
              );
              if (nearest) {
                floodNearest = {
                  postcode: nearest.postcode,
                  riskScore: nearest.riskScore,
                  riskBand: riskBandFromScore(nearest.riskScore),
                  distanceMeters: Math.round(nearest.distanceMeters),
                };
              }
            }

            if (schoolsEnabled) {
              const schoolEntries = await getSchoolSearchEntries(schoolSearchEntriesRef, schoolSearchEntriesPromiseRef);
              nearestSchoolEntry = findNearestSchoolEntryByDistance(
                lng,
                lat,
                schoolEntries,
                LOCAL_NEAREST_SCHOOL_MAX_DISTANCE_METERS
              );
              if (nearestSchoolEntry) {
                schoolNearest = {
                  schoolName: nearestSchoolEntry.schoolName,
                  postcode: nearestSchoolEntry.postcode,
                  qualityScore: nearestSchoolEntry.qualityScore,
                  qualityBand: nearestSchoolEntry.qualityBand,
                  distanceMeters: Math.round(nearestSchoolEntry.distanceMeters),
                };
              }

              nearestGoodEntry = findNearestSchoolEntryByDistance(
                lng,
                lat,
                schoolEntries.filter((entry) => entry.isGood),
                LOCAL_NEAREST_SCHOOL_MAX_DISTANCE_METERS
              );
              if (nearestGoodEntry) {
                schoolNearestGood = {
                  schoolName: nearestGoodEntry.schoolName,
                  postcode: nearestGoodEntry.postcode,
                  qualityScore: nearestGoodEntry.qualityScore,
                  qualityBand: nearestGoodEntry.qualityBand,
                  distanceMeters: Math.round(nearestGoodEntry.distanceMeters),
                };
              }
            }

            if (stationsEnabled) {
              const stationEntries = await getStationSearchEntries(stationSearchEntriesRef, stationSearchEntriesPromiseRef);
              const nearestStationEntry = findNearestStationByDistance(
                lng,
                lat,
                stationEntries,
                LOCAL_NEAREST_STATION_MAX_DISTANCE_METERS
              );
              if (nearestStationEntry) {
                stationNearest = {
                  name: nearestStationEntry.name,
                  code: nearestStationEntry.code,
                  distanceMeters: Math.round(nearestStationEntry.distanceMeters),
                };
              }
              setStationSearchFocus(map, nearestStationEntry, { lon: lng, lat });
            } else {
              setStationSearchFocus(map, null, null);
            }
          } catch {
            // ignore overlay nearest errors
          }

          setSchoolSearchFocus(map, nearestSchoolEntry, nearestGoodEntry, { lon: lng, lat });

          onLocateMeResultRef.current?.({
            status: "success",
            message: "Location found",
            accuracyMeters: Number.isFinite(accuracyMeters) ? Math.round(accuracyMeters) : undefined,
            coords: { lng, lat },
            cell: {
              grid: stateRef.current.grid,
              median: Number.isFinite(median) ? median : undefined,
              txCount: Number.isFinite(Number(cellProps?.tx_count)) ? Number(cellProps.tx_count) : undefined,
              deltaGbp: Number.isFinite(Number(cellProps?.delta_gbp)) ? Number(cellProps.delta_gbp) : undefined,
              deltaPct: Number.isFinite(Number(cellProps?.delta_pct)) ? Number(cellProps.delta_pct) : undefined,
            },
            floodNearest,
            schoolNearest,
            schoolNearestGood,
            stationNearest,
          });
        };

        if (!map.isStyleLoaded()) {
          map.once("idle", () => {
            void run();
          });
          return;
        }

        await run();
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          onLocateMeResultRef.current?.({ status: "denied", message: "Location permission denied" });
          return;
        }
        if (error.code === error.TIMEOUT) {
          onLocateMeResultRef.current?.({ status: "timeout", message: "Location request timed out" });
          return;
        }
        onLocateMeResultRef.current?.({ status: "error", message: "Unable to get your location" });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, [locateMeToken]);


  // Cache: avoid recomputing polygons when toggling metric only
  const geoCacheRef = useRef<Map<string, any>>(new Map<string, any>());

  const resolveZooplaMaxPrice = (cellMedian?: number) => {
    const s = stateRef.current;
    const prefs = indexPrefsRef.current;

    if (prefs && s.metric === "median" && Number.isFinite(prefs.budget) && prefs.budget > 0) {
      return prefs.budget;
    }

    if (s.metric === "median" && typeof cellMedian === "number" && Number.isFinite(cellMedian)) {
      return cellMedian * 1.25;
    }

    return null;
  };

  const buildZooplaHref = (outcode: string, maxPrice?: number | null) => {
    const clean = outcode.trim().toLowerCase();
    const s = stateRef.current;
    const prefs = indexPrefsRef.current;
    const effectivePropertyType = prefs?.propertyType ?? s.propertyType;
    const params = new URLSearchParams({
      q: clean,
      search_source: s.newBuild === "Y" ? "new-homes" : "for-sale",
    });

    const isNewHomes = s.newBuild === "Y";
    let path = isNewHomes
      ? `https://www.zoopla.co.uk/new-homes/property/${encodeURIComponent(clean)}/`
      : `https://www.zoopla.co.uk/for-sale/property/${encodeURIComponent(clean)}/`;

    switch (effectivePropertyType) {
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

  map.addSource("flood-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("flood-search-context", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("school-overlay", {
    type: "geojson",
    data: "/api/schools?plain=1",
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 46,
  });

  map.addSource("school-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("primary-school-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("station-overlay", {
    type: "geojson",
    data: "/api/stations?plain=1",
    cluster: true,
    clusterMaxZoom: 9,
    clusterRadius: 40,
  });

  map.addSource("primary-school-overlay", {
    type: "geojson",
    data: "/api/schools?key=primary_school_overlay_points.geojson.gz&plain=1",
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 46,
  });

  map.addSource("station-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("crime-overlay", {
    type: "geojson",
    data: "/api/crime?plain=1",
    cluster: true,
    clusterMaxZoom: 9,
    clusterRadius: 50,
  });

  map.addSource("crime-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("bus-stop-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("pharmacy-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // ── Bus stop / metro-tram / pharmacy overlay sources ──
  map.addSource("bus-stop-overlay", {
    type: "geojson",
    data: "/api/bus-stops?plain=1",
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 38,
  });

  map.addSource("metro-tram-overlay", {
    type: "geojson",
    data: "/api/bus-stops?key=metro_tram_overlay_points.geojson.gz&plain=1",
    cluster: true,
    clusterMaxZoom: 9,
    clusterRadius: 40,
  });

  map.addSource("pharmacy-overlay", {
    type: "geojson",
    data: "/api/pharmacies?plain=1",
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 40,
  });

  map.addSource("pub-overlay", {
    type: "geojson",
    data: "/api/pubs?plain=1",
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 38,
  });

  map.addSource("supermarket-overlay", {
    type: "geojson",
    data: "/api/supermarkets?plain=1",
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 38,
  });

  map.addSource("pub-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("supermarket-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("listed-building-overlay", {
    type: "geojson",
    data: "/api/listed-buildings?plain=1",
    cluster: true,
    clusterMaxZoom: 13,
    clusterRadius: 35,
  });

  map.addSource("planning-application-overlay", {
    type: "geojson",
    data: "/api/planning-applications?plain=1",
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 40,
  });

  map.addSource("holiday-let-overlay", {
    type: "geojson",
    data: "/api/holiday-lets?plain=1",
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 38,
  });

  map.addSource("postcode-search-marker", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "cells-fill",
    type: "fill",
    source: "cells",
    paint: {
      "fill-color": getFillColorExpression(state.metric, easyColoursRef.current),
      "fill-opacity": ["case", ["all", ["==", ["get", "is_modelled"], true], ["==", ["get", "model_confidence"], 0]], 0.22, ["==", ["get", "is_modelled"], true], 0.32, 0.42] as any,
    },
  });

  // ── Overlay cluster layers — added AFTER cells-fill so they render on top of cells ──
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
    id: "school-overlay-clusters",
    type: "circle",
    source: "school-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.schoolOverlayMode && stateRef.current.schoolOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "rgba(74,222,128,0.55)",
        25,
        "rgba(34,197,94,0.72)",
        100,
        "rgba(21,128,61,0.86)",
      ] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 25, 19, 100, 26] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "school-overlay-cluster-count",
    type: "symbol",
    source: "school-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.schoolOverlayMode && stateRef.current.schoolOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: {
      "text-color": "rgba(255,255,255,0.95)",
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
      "fill-color": floodBandColorExpression(easyColoursRef.current),
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
      "line-color": floodBandColorExpression(easyColoursRef.current),
      "line-width": ["interpolate", ["linear"], floodSeverityExpression(), 0, 0.8, 4, 1.8] as any,
      "line-dasharray": [1, 1.5],
      "line-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "flood-overlay-points",
    type: "symbol",
    source: "flood-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.floodOverlayMode && stateRef.current.floodOverlayMode !== "off" ? "visible" : "none",
      "text-field": "■",
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 12, 6, 16, 8, 22, 10, 30] as any,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": [
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
      "text-opacity": ["interpolate", ["linear"], floodSeverityExpression(), 0, 0.7, 4, 1] as any,
      "text-halo-color": "rgba(0,0,0,0.7)",
      "text-halo-width": 1.8,
      "text-halo-blur": 0.3,
    },
  });

  map.addLayer({
    id: "school-overlay-points",
    type: "circle",
    source: "school-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.schoolOverlayMode && stateRef.current.schoolOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": schoolQualityColorExpression(easyColoursRef.current),
      "circle-opacity": 0.92,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.2, 6, 5, 8, 7.5, 10, 11] as any,
      "circle-stroke-color": "rgba(255,255,255,0.94)",
      "circle-stroke-width": 1,
      "circle-blur": 0.02,
    },
  });

  // ── Train station overlay layers ──
  addMapIcons(map);
  map.addLayer({
    id: "station-overlay-clusters",
    type: "circle",
    source: "station-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.stationOverlayMode && stateRef.current.stationOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "rgba(180,40,40,0.58)",
        20,
        "rgba(155,28,28,0.75)",
        100,
        "rgba(127,17,17,0.88)",
      ] as any,
      "circle-radius": ["step", ["get", "point_count"], 13, 20, 18, 100, 24] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "station-overlay-cluster-count",
    type: "symbol",
    source: "station-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.stationOverlayMode && stateRef.current.stationOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: {
      "text-color": "rgba(255,255,255,0.95)",
    },
  });

  map.addLayer({
    id: "station-overlay-points",
    type: "symbol",
    source: "station-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.stationOverlayMode && stateRef.current.stationOverlayMode !== "off" ? "visible" : "none",
      "icon-image": "train-icon",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.38, 6, 0.50, 8, 0.65, 10, 0.85, 12, 1.05] as any,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "icon-anchor": "center",
    },
    paint: {
      "icon-opacity": 0.97,
    },
  });

  // ── Primary school (Ofsted) overlay layers ──
  map.addLayer({
    id: "primary-school-overlay-clusters",
    type: "circle",
    source: "primary-school-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.primarySchoolOverlayMode && stateRef.current.primarySchoolOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "rgba(99,102,241,0.55)",
        25,
        "rgba(79,70,229,0.72)",
        100,
        "rgba(55,48,163,0.86)",
      ] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 25, 19, 100, 26] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "primary-school-overlay-cluster-count",
    type: "symbol",
    source: "primary-school-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.primarySchoolOverlayMode && stateRef.current.primarySchoolOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: {
      "text-color": "rgba(255,255,255,0.95)",
    },
  });

  map.addLayer({
    id: "primary-school-overlay-points",
    type: "circle",
    source: "primary-school-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.primarySchoolOverlayMode && stateRef.current.primarySchoolOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "match",
        ["get", "ofsted_grade"],
        1, "#16a34a",
        2, "#2563eb",
        3, "#f59e0b",
        4, "#dc2626",
        0, "#9ca3af",
        "#9ca3af",
      ] as any,
      "circle-opacity": 0.92,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.2, 6, 5, 8, 7.5, 10, 11] as any,
      "circle-stroke-color": "rgba(255,255,255,0.94)",
      "circle-stroke-width": 1,
      "circle-blur": 0.02,
    },
  });

  // ── Crime (LSOA) overlay layers ──
  map.addLayer({
    id: "crime-overlay-clusters",
    type: "circle",
    source: "crime-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.crimeOverlayMode && stateRef.current.crimeOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "rgba(220,38,38,0.55)",
        25,
        "rgba(185,28,28,0.72)",
        100,
        "rgba(127,29,29,0.86)",
      ] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 25, 19, 100, 26] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "crime-overlay-cluster-count",
    type: "symbol",
    source: "crime-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.crimeOverlayMode && stateRef.current.crimeOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: {
      "text-color": "rgba(255,255,255,0.95)",
    },
  });

  map.addLayer({
    id: "crime-overlay-points",
    type: "circle",
    source: "crime-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.crimeOverlayMode && stateRef.current.crimeOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      // crime_score: 100 = safest (green), 0 = worst (red)
      "circle-color": [
        "interpolate",
        ["linear"],
        ["get", "crime_score"],
        0,  "#dc2626",
        25, "#f97316",
        50, "#eab308",
        75, "#84cc16",
        100,"#16a34a",
      ] as any,
      "circle-opacity": 0.82,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 6, 4.5, 8, 7, 10, 10] as any,
      "circle-stroke-color": "rgba(255,255,255,0.88)",
      "circle-stroke-width": 1,
      "circle-blur": 0.04,
    },
  });

  // ── Bus stop overlay layers (sky-blue) ──
  map.addLayer({
    id: "bus-stop-overlay-clusters",
    type: "circle",
    source: "bus-stop-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.busStopOverlayMode && stateRef.current.busStopOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(56,189,248,0.6)", 50, "rgba(14,165,233,0.75)", 500, "rgba(2,132,199,0.88)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 50, 19, 500, 26] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "bus-stop-overlay-cluster-count",
    type: "symbol",
    source: "bus-stop-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.busStopOverlayMode && stateRef.current.busStopOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "bus-stop-overlay-points",
    type: "circle",
    source: "bus-stop-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.busStopOverlayMode && stateRef.current.busStopOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": "#38bdf8",
      "circle-opacity": 0.88,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 12, 4.5, 14, 6, 16, 8] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
      "circle-blur": 0.02,
    },
  });

  // ── Metro / tram overlay layers (purple) ──
  map.addLayer({
    id: "metro-tram-overlay-clusters",
    type: "circle",
    source: "metro-tram-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.busStopOverlayMode && stateRef.current.busStopOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(168,85,247,0.6)", 10, "rgba(139,59,217,0.75)", 50, "rgba(109,40,217,0.88)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 13, 10, 18, 50, 24] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "metro-tram-overlay-cluster-count",
    type: "symbol",
    source: "metro-tram-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.busStopOverlayMode && stateRef.current.busStopOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "metro-tram-overlay-points",
    type: "circle",
    source: "metro-tram-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.busStopOverlayMode && stateRef.current.busStopOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": "#a855f7",
      "circle-opacity": 0.9,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 7, 6, 10, 9, 12, 12] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1.5,
      "circle-blur": 0.02,
    },
  });

  // ── Pharmacy overlay layers (amber) ──
  map.addLayer({
    id: "pharmacy-overlay-clusters",
    type: "circle",
    source: "pharmacy-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.pharmacyOverlayMode && stateRef.current.pharmacyOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(245,158,11,0.6)", 10, "rgba(217,119,6,0.75)", 50, "rgba(180,83,9,0.88)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 19, 50, 25] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "pharmacy-overlay-cluster-count",
    type: "symbol",
    source: "pharmacy-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.pharmacyOverlayMode && stateRef.current.pharmacyOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "pharmacy-overlay-points",
    type: "circle",
    source: "pharmacy-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.pharmacyOverlayMode && stateRef.current.pharmacyOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": "#f59e0b",
      "circle-opacity": 0.9,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 10, 8, 12, 11] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
      "circle-blur": 0.02,
    },
  });

  // ── Pub overlay layers (warm green) ──
  map.addLayer({
    id: "pub-overlay-clusters",
    type: "circle",
    source: "pub-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.pubOverlayMode && stateRef.current.pubOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(134,197,22,0.65)", 20, "rgba(101,163,13,0.78)", 100, "rgba(77,124,15,0.88)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 20, 19, 100, 25] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "pub-overlay-cluster-count",
    type: "symbol",
    source: "pub-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.pubOverlayMode && stateRef.current.pubOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "pub-overlay-points",
    type: "circle",
    source: "pub-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.pubOverlayMode && stateRef.current.pubOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": "#84cc16",
      "circle-opacity": 0.9,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 10, 7, 12, 10] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
      "circle-blur": 0.02,
    },
  });

  // ── Supermarket overlay layers (cyan) ──
  map.addLayer({
    id: "supermarket-overlay-clusters",
    type: "circle",
    source: "supermarket-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.supermarketOverlayMode && stateRef.current.supermarketOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(6,182,212,0.65)", 20, "rgba(8,145,178,0.78)", 100, "rgba(14,116,144,0.88)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 20, 19, 100, 25] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "supermarket-overlay-cluster-count",
    type: "symbol",
    source: "supermarket-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.supermarketOverlayMode && stateRef.current.supermarketOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "supermarket-overlay-points",
    type: "circle",
    source: "supermarket-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.supermarketOverlayMode && stateRef.current.supermarketOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": "#06b6d4",
      "circle-opacity": 0.9,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 10, 7, 12, 10] as any,
      "circle-stroke-color": "rgba(255,255,255,0.92)",
      "circle-stroke-width": 1,
      "circle-blur": 0.02,
    },
  });

  // ── Listed building overlay layers ──
  map.addLayer({
    id: "listed-building-overlay-clusters",
    type: "circle",
    source: "listed-building-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.listedBuildingOverlayMode && stateRef.current.listedBuildingOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(161,109,32,0.65)", 10, "rgba(133,77,14,0.80)", 50, "rgba(109,40,217,0.85)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 19, 50, 25] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "listed-building-overlay-cluster-count",
    type: "symbol",
    source: "listed-building-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.listedBuildingOverlayMode && stateRef.current.listedBuildingOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "listed-building-overlay-points",
    type: "circle",
    source: "listed-building-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.listedBuildingOverlayMode && stateRef.current.listedBuildingOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "match", ["get", "grade"],
        "I",   "#dc2626",
        "II*", "#ea580c",
        "#ca8a04",
      ] as any,
      "circle-opacity": 0.88,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 10, 7, 12, 10] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });

  // ── Planning application overlay layers ──
  map.addLayer({
    id: "planning-application-overlay-clusters",
    type: "circle",
    source: "planning-application-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.planningOverlayMode && stateRef.current.planningOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(37,99,235,0.65)", 10, "rgba(29,78,216,0.80)", 50, "rgba(109,40,217,0.85)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 19, 50, 25] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "planning-application-overlay-cluster-count",
    type: "symbol",
    source: "planning-application-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.planningOverlayMode && stateRef.current.planningOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "planning-application-overlay-points",
    type: "circle",
    source: "planning-application-overlay",
    filter: ["all", ["!", ["has", "point_count"]], ["in", ["get", "decision"], ["literal", ["pending", "approved", "prior_approval"]]]] as any,
    layout: {
      visibility: stateRef.current.planningOverlayMode && stateRef.current.planningOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": [
        "match", ["get", "decision"],
        "approved",       "#16a34a",
        "pending",        "#f97316",
        "prior_approval", "#2563eb",
        "#9ca3af",
      ] as any,
      "circle-opacity": 0.88,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 10, 7, 12, 9] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });

  // ── Holiday let overlay layers ──
  map.addLayer({
    id: "holiday-let-overlay-clusters",
    type: "circle",
    source: "holiday-let-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.holidayLetOverlayMode && stateRef.current.holidayLetOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": ["step", ["get", "point_count"], "rgba(234,88,12,0.65)", 10, "rgba(194,65,12,0.80)", 50, "rgba(154,52,18,0.85)"] as any,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 19, 50, 25] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "holiday-let-overlay-cluster-count",
    type: "symbol",
    source: "holiday-let-overlay",
    filter: ["has", "point_count"] as any,
    layout: {
      visibility: stateRef.current.holidayLetOverlayMode && stateRef.current.holidayLetOverlayMode !== "off" ? "visible" : "none",
      "text-field": ["get", "point_count_abbreviated"] as any,
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "rgba(255,255,255,0.95)" },
  });
  map.addLayer({
    id: "holiday-let-overlay-points",
    type: "circle",
    source: "holiday-let-overlay",
    filter: ["!", ["has", "point_count"]] as any,
    layout: {
      visibility: stateRef.current.holidayLetOverlayMode && stateRef.current.holidayLetOverlayMode !== "off" ? "visible" : "none",
    },
    paint: {
      "circle-color": "#ea580c",
      "circle-opacity": 0.85,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 10, 7, 12, 9] as any,
      "circle-stroke-color": "rgba(255,255,255,0.9)",
      "circle-stroke-width": 1,
    },
  });

  // ── Station search focus layers ──
  map.addLayer({
    id: "station-search-focus-outer",
    type: "line",
    source: "station-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: {
      "line-color": "rgba(255,255,255,0.88)",
      "line-width": 8,
      "line-opacity": 0.88,
    },
  });
  // Rail inner (narrow black dashed — the rails)
  map.addLayer({
    id: "station-search-focus-link",
    type: "line",
    source: "station-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: {
      "line-color": "#1a1a1a",
      "line-width": 3,
      "line-dasharray": [5, 3] as any,
      "line-opacity": 0.97,
    },
  });

  map.addLayer({
    id: "station-search-focus-label",
    type: "symbol",
    source: "station-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"] as any,
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "station-search-focus-ring",
    type: "circle",
    source: "station-search-focus",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "nearest"]] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 15, 12, 21] as any,
      "circle-stroke-color": "#f97316",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 8, 3.5, 12, 4.5] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  map.addLayer({
    id: "station-search-focus-dot",
    type: "circle",
    source: "station-search-focus",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "nearest"]] as any,
    paint: {
      "circle-color": "#f97316",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 8, 3.5, 12, 5] as any,
      "circle-opacity": 0.97,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.2,
    },
  });

  map.addLayer({
    id: "flood-search-focus-ring",
    type: "circle",
    source: "flood-search-focus",
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 15, 12, 21] as any,
      "circle-stroke-color": "#fde047",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 8, 3.5, 12, 4.5] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  map.addLayer({
    id: "flood-search-focus-dot",
    type: "circle",
    source: "flood-search-focus",
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 3, 12, 4] as any,
      "circle-stroke-color": "#111827",
      "circle-stroke-width": 1,
      "circle-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "flood-search-context-line",
    type: "line",
    source: "flood-search-context",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: {
      "line-color": "#60a5fa",
      "line-width": 3.5,
      "line-dasharray": [3, 1.5],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "flood-search-context-label",
    type: "symbol",
    source: "flood-search-context",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"] as any,
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#60a5fa",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "flood-search-context-requested-ring",
    type: "circle",
    source: "flood-search-context",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "requested"]] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#93c5fd",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  map.addLayer({
    id: "flood-search-context-requested-dot",
    type: "circle",
    source: "flood-search-context",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "requested"]] as any,
    paint: {
      "circle-color": "#93c5fd",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 2.8, 12, 3.5] as any,
      "circle-opacity": 0.92,
    },
  });

  map.addLayer({
    id: "school-search-focus-nearest-line",
    type: "line",
    source: "school-search-focus",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "role"], "nearest_link"]] as any,
    paint: {
      "line-color": "#ef4444",
      "line-width": 3.5,
      "line-dasharray": [3, 1.5],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "school-search-focus-nearest-label",
    type: "symbol",
    source: "school-search-focus",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "role"], "nearest_link"]] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"] as any,
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#ef4444",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "school-search-focus-good-line",
    type: "line",
    source: "school-search-focus",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "role"], "nearest_good_link"]] as any,
    paint: {
      "line-color": "#22c55e",
      "line-width": 3.5,
      "line-dasharray": [3, 1.5],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "school-search-focus-good-label",
    type: "symbol",
    source: "school-search-focus",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "role"], "nearest_good_link"]] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"] as any,
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#22c55e",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "school-search-focus-ring",
    type: "circle",
    source: "school-search-focus",
    filter: ["==", ["get", "role"], "nearest"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#f59e0b",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  map.addLayer({
    id: "school-search-focus-good-ring",
    type: "circle",
    source: "school-search-focus",
    filter: ["==", ["get", "role"], "nearest_good"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 14, 12, 18] as any,
      "circle-stroke-color": "#22c55e",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.3, 8, 3.2, 12, 4] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  // ── Primary school search focus (right-click dashed line + ring) ──
  map.addLayer({
    id: "primary-school-search-focus-line",
    type: "line",
    source: "primary-school-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: {
      "line-color": "#7c3aed",
      "line-width": 3.5,
      "line-dasharray": [3, 1.5],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "primary-school-search-focus-label",
    type: "symbol",
    source: "primary-school-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": "Primary school",
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#7c3aed",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "primary-school-search-focus-ring",
    type: "circle",
    source: "primary-school-search-focus",
    filter: ["==", ["geometry-type"], "Point"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#7c3aed",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  // ── Crime search focus (right-click dashed line + ring) ──
  map.addLayer({
    id: "crime-search-focus-line",
    type: "line",
    source: "crime-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: {
      "line-color": "#dc2626",
      "line-width": 3.5,
      "line-dasharray": [3, 1.5],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "crime-search-focus-label",
    type: "symbol",
    source: "crime-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": "Crime (LSOA)",
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#dc2626",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "crime-search-focus-ring",
    type: "circle",
    source: "crime-search-focus",
    filter: ["==", ["geometry-type"], "Point"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#dc2626",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  // ── Bus stop search focus (right-click dashed line + ring) ──
  map.addLayer({
    id: "bus-stop-search-focus-line",
    type: "line",
    source: "bus-stop-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: {
      "line-color": "#38bdf8",
      "line-width": 3.5,
      "line-dasharray": [3, 1.5],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "bus-stop-search-focus-label",
    type: "symbol",
    source: "bus-stop-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"] as any,
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#38bdf8",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "bus-stop-search-focus-ring",
    type: "circle",
    source: "bus-stop-search-focus",
    filter: ["==", ["geometry-type"], "Point"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#38bdf8",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  // ── Pharmacy search focus (right-click dashed line + ring) ──
  map.addLayer({
    id: "pharmacy-search-focus-line",
    type: "line",
    source: "pharmacy-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: {
      "line-color": "#f59e0b",
      "line-width": 3.5,
      "line-dasharray": [3, 1.5],
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "pharmacy-search-focus-label",
    type: "symbol",
    source: "pharmacy-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": "Pharmacy",
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: {
      "text-color": "#f59e0b",
      "text-halo-color": "#0f172a",
      "text-halo-width": 2.5,
      "text-halo-blur": 0.5,
    },
  });

  map.addLayer({
    id: "pharmacy-search-focus-ring",
    type: "circle",
    source: "pharmacy-search-focus",
    filter: ["==", ["geometry-type"], "Point"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#f59e0b",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  // ── Pub search focus (right-click dashed line + ring) ──
  map.addLayer({
    id: "pub-search-focus-line",
    type: "line",
    source: "pub-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: { "line-color": "#84cc16", "line-width": 3.5, "line-dasharray": [3, 1.5], "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "pub-search-focus-label",
    type: "symbol",
    source: "pub-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": "Pub",
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: { "text-color": "#84cc16", "text-halo-color": "#0f172a", "text-halo-width": 2.5, "text-halo-blur": 0.5 },
  });
  map.addLayer({
    id: "pub-search-focus-ring",
    type: "circle",
    source: "pub-search-focus",
    filter: ["==", ["geometry-type"], "Point"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#84cc16",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  // ── Supermarket search focus (right-click dashed line + ring) ──
  map.addLayer({
    id: "supermarket-search-focus-line",
    type: "line",
    source: "supermarket-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    paint: { "line-color": "#06b6d4", "line-width": 3.5, "line-dasharray": [3, 1.5], "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "supermarket-search-focus-label",
    type: "symbol",
    source: "supermarket-search-focus",
    filter: ["==", ["geometry-type"], "LineString"] as any,
    layout: {
      "symbol-placement": "line-center",
      "text-field": "Food shop",
      "text-size": 12,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": [0, -1.2] as any,
    },
    paint: { "text-color": "#06b6d4", "text-halo-color": "#0f172a", "text-halo-width": 2.5, "text-halo-blur": 0.5 },
  });
  map.addLayer({
    id: "supermarket-search-focus-ring",
    type: "circle",
    source: "supermarket-search-focus",
    filter: ["==", ["geometry-type"], "Point"] as any,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 17] as any,
      "circle-stroke-color": "#06b6d4",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3, 12, 3.8] as any,
      "circle-stroke-opacity": 0.98,
    },
  });

  map.addLayer({
    id: "postcode-search-star",
    type: "symbol",
    source: "postcode-search-marker",
    layout: {
      "text-field": "★",
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 18, 8, 26, 12, 34] as any,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#facc15",
      "text-halo-color": "rgba(0,0,0,0.85)",
      "text-halo-width": 2.2,
      "text-halo-blur": 0.4,
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

  applyValueFilter(map, stateRef.current, indexPrefsRef.current);

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
  // Allow clicking flood/school overlay dots whenever the overlay is active (on OR on_hide_cells).
  // useFloodPopupMode / useSchoolPopupMode remain restricted to on_hide_cells for cell-hover suppression.
  const floodOverlayClickable = () =>
    stateRef.current.floodOverlayMode !== "off" && map.getZoom() >= 8;
  const schoolOverlayClickable = () =>
    stateRef.current.schoolOverlayMode !== "off" && map.getZoom() >= 8;
  const stationOverlayClickable = () =>
    stateRef.current.stationOverlayMode !== "off" && map.getZoom() >= 7;

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
    const postcodeHtml = escapeHtml(postcode);
    const riskBandHtml = escapeHtml(riskBand);

    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">${postcodeHtml}</div>
        <div>Flood risk: <b>${riskBandHtml}</b></div>
        <div>Score: <b>${riskScore}</b></div>
        <a
          href="https://buymeacoffee.com/chrandalf"
          target="_blank"
          rel="noreferrer"
          style="display:inline-block; margin-top:6px; color:#ffffff; text-decoration:underline; font-size:11px;"
        >Buy me a coffee</a>
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
        <a
          href="https://buymeacoffee.com/chrandalf"
          target="_blank"
          rel="noreferrer"
          style="display:inline-block; margin-top:6px; color:#ffffff; text-decoration:underline; font-size:11px;"
        >Buy me a coffee</a>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const useSchoolPopupMode = () => {
    const current = stateRef.current;
    return current.schoolOverlayMode === "on_hide_cells" && map.getZoom() >= 10;
  };

  const usePrimarySchoolPopupMode = () => {
    const current = stateRef.current;
    return current.primarySchoolOverlayMode === "on_hide_cells" && map.getZoom() >= 10;
  };

  const showSchoolPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;

    const p = f.properties || {};
    const schoolName = String(p.school_name ?? "School");
    const postcode   = String(p.postcode ?? p.postcode_key ?? "");
    const town       = String(p.town ?? "");
    const qualityScore = Number(p.quality_score ?? NaN);
    const qualityBand  = String(p.quality_band ?? "Unknown");
    const urn          = String(p.urn ?? "");

    const col = qualityScore >= 0.75 ? "#16a34a"
              : qualityScore >= 0.60 ? "#65a30d"
              : qualityScore >= 0.40 ? "#d97706"
              : "#b91c1c";

    const ofstedUrl  = urn ? `https://reports.ofsted.gov.uk/search?q=${urn}` : null;
    const nameHtml   = ofstedUrl
      ? `<a href="${ofstedUrl}" target="_blank" rel="noreferrer"
           style="color:#1d4ed8;font-weight:700;font-size:13px;text-decoration:none">${escapeHtml(schoolName)} ↗</a>`
      : `<span style="font-weight:700;font-size:13px">${escapeHtml(schoolName)}</span>`;
    const locationHtml = [town, postcode].filter(Boolean).map(escapeHtml).join(", ");

    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:190px">
        <div style="margin-bottom:5px">${nameHtml}</div>
        ${locationHtml ? `<div style="font-size:11px;color:#6b7280;margin-bottom:5px">${locationHtml}</div>` : ""}
        <div style="border-top:1px solid #f3f4f6;padding-top:5px;margin-bottom:2px">
          <span style="color:${col};font-weight:600">${escapeHtml(qualityBand)}</span>
          <span style="color:#9ca3af;font-size:11px"> GCSE outcomes score</span>
        </div>
        <div style="font-size:10px;color:#9ca3af;margin-top:4px;line-height:1.35">
          ⚠ Score reflects GCSE results — not Ofsted rating.
          ${ofstedUrl ? `<a href="${ofstedUrl}" target="_blank" rel="noreferrer" style="color:#6366f1;text-decoration:underline">View Ofsted report ↗</a>` : ""}
        </div>
      </div>
    `;

    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showSchoolClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">School cluster</div>
        <div>Schools in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity: 0.8; margin-top: 2px;">Zoom in for school-level points.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const primarySchoolOverlayClickable = () =>
    stateRef.current.primarySchoolOverlayMode !== "off" && map.getZoom() >= 8;

  const showPrimarySchoolPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;

    const p = f.properties || {};
    const schoolName  = String(p.name ?? "School");
    const postcode    = String(p.postcode ?? "");
    const la          = String(p.la ?? "");
    const grade       = Number(p.ofsted_grade ?? 0);
    const label       = String(p.ofsted_label ?? "");
    const inspDateRaw = String(p.inspection_date ?? "");
    const inspDate    = inspDateRaw === "NULL" ? "" : inspDateRaw;
    const link        = String(p.link ?? "");

    const gradeColors: Record<number, string> = {
      1: "#16a34a",
      2: "#2563eb",
      3: "#f59e0b",
      4: "#dc2626",
      0: "#9ca3af",
    };
    const col = gradeColors[grade] ?? "#9ca3af";
    const displayLabel = label || "Not graded";
    const ratingNote = grade === 0 ? "No Ofsted grade available" : "Ofsted rating";

    const nameHtml = link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer"
           style="color:#1d4ed8;font-weight:700;font-size:13px;text-decoration:none">${escapeHtml(schoolName)} ↗</a>`
      : `<span style="font-weight:700;font-size:13px">${escapeHtml(schoolName)}</span>`;
    const metaHtml = [la, postcode].filter(Boolean).map(escapeHtml).join(", ");

    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:190px">
        <div style="margin-bottom:5px">${nameHtml}</div>
        ${metaHtml ? `<div style="font-size:11px;color:#6b7280;margin-bottom:5px">${metaHtml}</div>` : ""}
        <div style="border-top:1px solid #f3f4f6;padding-top:5px;margin-bottom:2px">
          <span style="color:${col};font-weight:600">${escapeHtml(displayLabel)}</span>
          <span style="color:#9ca3af;font-size:11px"> ${ratingNote}</span>
        </div>
        ${inspDate ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px">Inspected: ${escapeHtml(inspDate)}</div>` : ""}
      </div>
    `;

    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showPrimarySchoolClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">Primary school cluster</div>
        <div>Schools in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity: 0.8; margin-top: 2px;">Zoom in for school-level points.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showStationPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const name  = escapeHtml(String(p.name  ?? "Station"));
    const code  = escapeHtml(String(p.code  ?? ""));
    const owner = escapeHtml(String(p.owner ?? ""));
    const link  = String(p.link ?? "");
    const nrUrl = code ? `https://www.nationalrail.co.uk/stations/${code.toLowerCase()}/` : null;
    const nameHtml = link
      ? `<a href="${link}" target="_blank" rel="noreferrer" style="color:#1d4ed8;font-weight:700;font-size:13px;text-decoration:none">${name} ↗</a>`
      : `<span style="font-weight:700;font-size:13px">${name}</span>`;
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:160px">
        <div style="margin-bottom:4px">${nameHtml}</div>
        ${code  ? `<div style="font-size:11px;color:#6b7280">CRS: <b style="color:#374151">${code}</b></div>` : ""}
        ${owner ? `<div style="font-size:11px;color:#6b7280">Operator: <b style="color:#374151">${owner}</b></div>` : ""}
        ${nrUrl ? `<div style="margin-top:6px"><a href="${nrUrl}" target="_blank" rel="noreferrer" style="font-size:11px;color:#6366f1;text-decoration:underline">National Rail ↗</a></div>` : ""}
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showStationClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">🚂 Station cluster</div>
        <div>Stations in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity: 0.8; margin-top: 2px;">Zoom in to see individual stations.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const crimeOverlayClickable = () =>
    stateRef.current.crimeOverlayMode !== "off" && map.getZoom() >= 8;

  const showCrimePointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const lsoaName      = escapeHtml(String(p.lsoa_name ?? p.lsoa_code ?? "LSOA"));
    const crimeScore    = Number(p.crime_score ?? 50);
    const violentScore  = Number(p.violent_score ?? 50);
    const propertyScore = Number(p.property_score ?? 50);
    const asbScore      = Number(p.asb_score ?? 50);
    const totalRate     = Number(p.total_rate ?? 0);
    const violentRate   = Number(p.violent_rate ?? 0);
    const propertyRate  = Number(p.property_rate ?? 0);
    const asbRate       = Number(p.asb_rate ?? 0);
    // LSOA overlay has exact recorded annual crime counts (12-month window)
    const totalCount    = p.total_crimes    != null ? Number(p.total_crimes)    : null;
    const violentCount  = p.violent_crimes  != null ? Number(p.violent_crimes)  : null;
    const propertyCount = p.property_crimes != null ? Number(p.property_crimes) : null;
    const asbCount      = p.asb_crimes      != null ? Number(p.asb_crimes)      : null;
    const scoreLabel = (s: number) => s >= 80 ? "Low" : s >= 60 ? "Below avg" : s >= 40 ? "Average" : s >= 20 ? "Above avg" : "High";
    const scoreCol   = (s: number) => s >= 80 ? "#16a34a" : s >= 60 ? "#84cc16" : s >= 40 ? "#eab308" : s >= 20 ? "#f97316" : "#dc2626";
    // 1-in-X: rate is per 1,000/yr so X = 1000/rate; cap at 9999 for display
    const oneInX = (rate: number) => rate > 0 ? Math.max(1, Math.round(1000 / rate)) : null;
    const rateStr = (rate: number) => { const x = oneInX(rate); return x !== null ? `1 in ${x.toLocaleString()}/yr` : "No data"; };
    const cntStr  = (n: number | null) => n !== null ? `&nbsp;<span style="color:#c0c0c0;font-size:10px">${n.toLocaleString()} crimes/yr</span>` : "";
    const highFootfall = totalRate > 245;
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:230px">
        <div style="font-weight:700;font-size:13px;margin-bottom:5px">${lsoaName}</div>
        <div style="font-size:10px;color:#9ca3af;margin-bottom:4px">vs. UK national</div>
        <div style="border-top:1px solid #f3f4f6;padding-top:5px">
          <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:2px">
            <span style="color:#6b7280">Overall</span>
            <span style="text-align:right"><span style="color:${scoreCol(crimeScore)};font-weight:600">${scoreLabel(crimeScore)}</span>&nbsp;<span style="color:#9ca3af;font-size:10px">${rateStr(totalRate)}</span>${cntStr(totalCount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:2px">
            <span style="color:#6b7280">Violent</span>
            <span style="text-align:right"><span style="color:${scoreCol(violentScore)}">${scoreLabel(violentScore)}</span>&nbsp;<span style="color:#9ca3af;font-size:10px">${rateStr(violentRate)}</span>${cntStr(violentCount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:2px">
            <span style="color:#6b7280">Property</span>
            <span style="text-align:right"><span style="color:${scoreCol(propertyScore)}">${scoreLabel(propertyScore)}</span>&nbsp;<span style="color:#9ca3af;font-size:10px">${rateStr(propertyRate)}</span>${cntStr(propertyCount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:2px">
            <span style="color:#6b7280">ASB</span>
            <span style="text-align:right"><span style="color:${scoreCol(asbScore)}">${scoreLabel(asbScore)}</span>&nbsp;<span style="color:#9ca3af;font-size:10px">${rateStr(asbRate)}</span>${cntStr(asbCount)}</span>
          </div>
        </div>
        ${highFootfall ? `<div style="font-size:10px;color:#9ca3af;margin-top:4px;border-top:1px solid #f3f4f6;padding-top:3px">⚠ High footfall area — resident-based rates may be elevated</div>` : ""}
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showCrimeClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">Crime cluster</div>
        <div>LSOAs in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity: 0.8; margin-top: 2px;">Zoom in for LSOA-level data.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  map.on("click", "flood-overlay-points", (e) => {
    if (!floodOverlayClickable()) return;
    showFloodPointPopup(e);
  });

  map.on("click", "flood-overlay-clusters", (e) => {
    if (!floodOverlayClickable()) return;
    showFloodClusterPopup(e);
  });

  map.on("click", "flood-overlay-cluster-count", (e) => {
    if (!floodOverlayClickable()) return;
    showFloodClusterPopup(e);
  });

  map.on("click", "school-overlay-points", (e) => {
    if (!schoolOverlayClickable()) return;
    showSchoolPointPopup(e);
  });

  map.on("click", "school-overlay-clusters", (e) => {
    if (!schoolOverlayClickable()) return;
    showSchoolClusterPopup(e);
  });

  map.on("click", "school-overlay-cluster-count", (e) => {
    if (!schoolOverlayClickable()) return;
    showSchoolClusterPopup(e);
  });

  map.on("click", "primary-school-overlay-points", (e) => {
    if (!primarySchoolOverlayClickable()) return;
    showPrimarySchoolPointPopup(e);
  });

  map.on("click", "primary-school-overlay-clusters", (e) => {
    if (!primarySchoolOverlayClickable()) return;
    showPrimarySchoolClusterPopup(e);
  });

  map.on("click", "primary-school-overlay-cluster-count", (e) => {
    if (!primarySchoolOverlayClickable()) return;
    showPrimarySchoolClusterPopup(e);
  });

  map.on("click", "station-overlay-points", (e) => {
    if (!stationOverlayClickable()) return;
    showStationPointPopup(e);
  });

  map.on("click", "station-overlay-clusters", (e) => {
    if (!stationOverlayClickable()) return;
    showStationClusterPopup(e);
  });

  map.on("click", "station-overlay-cluster-count", (e) => {
    if (!stationOverlayClickable()) return;
    showStationClusterPopup(e);
  });

  map.on("click", "crime-overlay-points", (e) => {
    if (!crimeOverlayClickable()) return;
    showCrimePointPopup(e);
  });

  map.on("click", "crime-overlay-clusters", (e) => {
    if (!crimeOverlayClickable()) return;
    showCrimeClusterPopup(e);
  });

  map.on("click", "crime-overlay-cluster-count", (e) => {
    if (!crimeOverlayClickable()) return;
    showCrimeClusterPopup(e);
  });

  const busStopOverlayClickable = () => stateRef.current.busStopOverlayMode !== "off";
  const pharmacyOverlayClickable = () => stateRef.current.pharmacyOverlayMode !== "off";

  const STOP_TYPE_LABELS: Record<string, string> = {
    BCT: "On-street bus stop",
    BCS: "Bus station bay",
    PLT: "Rail / metro platform",
    TMU: "Tram / metro stop",
  };

  const showBusStopPointPopup = (e: any, isMetro: boolean) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const name = escapeHtml(String(p.name ?? (isMetro ? "Metro/tram stop" : "Bus stop")));
    const atco = escapeHtml(String(p.atco_code ?? ""));
    const rawType = String(p.stop_type ?? "");
    const stopType = escapeHtml(STOP_TYPE_LABELS[rawType] ?? rawType);
    const icon = isMetro ? "🚇" : "🚌";
    const typeLabel = stopType ? `<div style="font-size:11px;color:#6b7280">Type: <b style="color:#374151">${stopType}</b></div>` : "";
    const atcoLabel = atco ? `<div style="font-size:11px;color:#6b7280">ATCO: <b style="color:#374151">${atco}</b></div>` : "";
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:150px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${icon} ${name}</div>
        ${typeLabel}
        ${atcoLabel}
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showBusStopClusterPopup = (e: any, isMetro: boolean) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const label = isMetro ? "Metro/tram stops" : "Bus stops";
    const icon = isMetro ? "🚇" : "🚌";
    const sourceId = isMetro ? "metro-tram-overlay" : "bus-stop-overlay";
    const clusterId = f.properties?.cluster_id;

    // For small clusters (≤2 stops) expand immediately into a list of individual stops
    if (count <= 2 && clusterId != null) {
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (src && typeof (src as any).getClusterLeaves === "function") {
        const lngLat = e.lngLat;
        (async () => {
          try {
            // MapLibre v5+ returns a Promise; earlier versions used a callback — handle both
            const result = (src as any).getClusterLeaves(clusterId, count, 0);
            const leaves: any[] = (result && typeof result.then === "function")
              ? await result
              : await new Promise((res, rej) => (src as any).getClusterLeaves(clusterId, count, 0, (err: any, l: any) => err ? rej(err) : res(l)));
            if (!leaves?.length) throw new Error("no leaves");
            const rows = leaves.map((lf: any) => {
              const p = lf.properties || {};
              const name = escapeHtml(String(p.name ?? (isMetro ? "Metro/tram stop" : "Bus stop")));
              const rawType = String(p.stop_type ?? "");
              const stopType = escapeHtml(STOP_TYPE_LABELS[rawType] ?? rawType);
              const atco = escapeHtml(String(p.atco_code ?? ""));
              return `<div style="padding:4px 0;${leaves.length > 1 ? "border-bottom:1px solid #e5e7eb;" : ""}">
                <div style="font-weight:600">${icon} ${name}</div>
                ${stopType ? `<div style="font-size:11px;color:#6b7280">Type: <b style="color:#374151">${stopType}</b></div>` : ""}
                ${atco ? `<div style="font-size:11px;color:#6b7280">ATCO: <b style="color:#374151">${atco}</b></div>` : ""}
              </div>`;
            }).join("");
            popup.setLngLat(lngLat).setHTML(`
              <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:160px">
                ${rows}
              </div>`).addTo(map);
          } catch {
            popup.setLngLat(lngLat).setHTML(`
              <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
                <div style="font-weight:700;margin-bottom:4px">${icon} ${label}</div>
                <div style="opacity:0.8;">Zoom in to see individual stops.</div>
              </div>`).addTo(map);
          }
        })();
        return;
      }
    }

    // Large clusters: show count + zoom hint
    const html = `
      <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
        <div style="font-weight:700;margin-bottom:4px">${icon} ${label} cluster</div>
        <div>${label} in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity:0.8;margin-top:2px">Zoom in to see individual stops.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showPharmacyPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const name = escapeHtml(String(p.name ?? "Pharmacy"));
    const ods = escapeHtml(String(p.ods_code ?? ""));
    const postcode = escapeHtml(String(p.post_code ?? ""));
    const weekly = Number(p.weekly_total ?? 0);
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:160px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">💊 ${name}</div>
        ${postcode ? `<div style="font-size:11px;color:#6b7280">Postcode: <b style="color:#374151">${postcode}</b></div>` : ""}
        ${weekly > 0 ? `<div style="font-size:11px;color:#6b7280">Weekly items: <b style="color:#374151">${weekly.toLocaleString()}</b></div>` : ""}
        ${ods ? `<div style="font-size:11px;color:#6b7280">ODS code: <b style="color:#374151">${ods}</b></div>` : ""}
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showPharmacyClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
        <div style="font-weight:700;margin-bottom:4px">💊 Pharmacy cluster</div>
        <div>Pharmacies in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity:0.8;margin-top:2px">Zoom in to see individual pharmacies.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const listedBuildingOverlayClickable = () => stateRef.current.listedBuildingOverlayMode !== "off";

  const showListedBuildingPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const name = escapeHtml(String(p.name ?? "Listed building"));
    const grade = escapeHtml(String(p.grade ?? ""));
    const reference = escapeHtml(String(p.reference ?? ""));
    const docUrl = String(p.doc_url ?? "");
    const gradeLabel = grade === "I" ? "Grade I" : grade === "II*" ? "Grade II*" : grade === "II" ? "Grade II" : grade;
    const gradeColor = grade === "I" ? "#dc2626" : grade === "II*" ? "#ea580c" : "#ca8a04";
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:170px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">🏛️ ${name}</div>
        ${gradeLabel ? `<div style="font-size:11px;color:#6b7280">Grade: <b style="color:${gradeColor}">${gradeLabel}</b></div>` : ""}
        ${reference ? `<div style="font-size:11px;color:#6b7280">List entry: <b style="color:#374151">${reference}</b></div>` : ""}
        ${docUrl ? `<div style="font-size:11px;margin-top:3px"><a href="${escapeHtml(docUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb">Historic England record ↗</a></div>` : ""}
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showListedBuildingClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
        <div style="font-weight:700;margin-bottom:4px">🏛️ Listed buildings</div>
        <div>Buildings in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity:0.8;margin-top:2px">Zoom in to see individual buildings.</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  map.on("click", "bus-stop-overlay-points",       (e) => { if (!busStopOverlayClickable()) return; showBusStopPointPopup(e, false); });
  map.on("click", "bus-stop-overlay-clusters",     (e) => { if (!busStopOverlayClickable()) return; showBusStopClusterPopup(e, false); });
  map.on("click", "bus-stop-overlay-cluster-count",(e) => { if (!busStopOverlayClickable()) return; showBusStopClusterPopup(e, false); });
  map.on("click", "metro-tram-overlay-points",       (e) => { if (!busStopOverlayClickable()) return; showBusStopPointPopup(e, true); });
  map.on("click", "metro-tram-overlay-clusters",     (e) => { if (!busStopOverlayClickable()) return; showBusStopClusterPopup(e, true); });
  map.on("click", "metro-tram-overlay-cluster-count",(e) => { if (!busStopOverlayClickable()) return; showBusStopClusterPopup(e, true); });
  map.on("click", "pharmacy-overlay-points",       (e) => { if (!pharmacyOverlayClickable()) return; showPharmacyPointPopup(e); });
  map.on("click", "pharmacy-overlay-clusters",     (e) => { if (!pharmacyOverlayClickable()) return; showPharmacyClusterPopup(e); });
  map.on("click", "pharmacy-overlay-cluster-count",(e) => { if (!pharmacyOverlayClickable()) return; showPharmacyClusterPopup(e); });

  const pubOverlayClickable = () => stateRef.current.pubOverlayMode !== "off";
  const showPubPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const name = escapeHtml(String(p.name || "Pub/Bar"));
    const amenity = String(p.amenity ?? "pub");
    const brand = escapeHtml(String(p.brand ?? ""));
    const label = amenity === "bar" ? "🍹 Bar" : "🍺 Pub";
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:150px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${label}: ${name}</div>
        ${brand ? `<div style="font-size:11px;color:#6b7280">Brand: <b style="color:#374151">${brand}</b></div>` : ""}
      </div>`;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };
  const showPubClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    popup.setLngLat(e.lngLat).setHTML(`
      <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
        <div style="font-weight:700;margin-bottom:4px">🍺 Pub/bar cluster</div>
        <div>Venues in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity:0.8;margin-top:2px">Zoom in to see individual venues.</div>
      </div>`).addTo(map);
  };
  map.on("click", "pub-overlay-points",       (e) => { if (!pubOverlayClickable()) return; showPubPointPopup(e); });
  map.on("click", "pub-overlay-clusters",     (e) => { if (!pubOverlayClickable()) return; showPubClusterPopup(e); });
  map.on("click", "pub-overlay-cluster-count",(e) => { if (!pubOverlayClickable()) return; showPubClusterPopup(e); });

  const supermarketOverlayClickable = () => stateRef.current.supermarketOverlayMode !== "off";
  const showSupermarketPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const name = escapeHtml(String(p.name || "Food shop"));
    const shop = String(p.shop ?? "supermarket");
    const brand = escapeHtml(String(p.brand ?? ""));
    const label = shop === "convenience" ? "🏪 Convenience store" : "🛒 Supermarket";
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:150px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${label}: ${name}</div>
        ${brand ? `<div style="font-size:11px;color:#6b7280">Brand: <b style="color:#374151">${brand}</b></div>` : ""}
      </div>`;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };
  const showSupermarketClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    popup.setLngLat(e.lngLat).setHTML(`
      <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
        <div style="font-weight:700;margin-bottom:4px">🛒 Food shop cluster</div>
        <div>Shops in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity:0.8;margin-top:2px">Zoom in to see individual shops.</div>
      </div>`).addTo(map);
  };
  map.on("click", "supermarket-overlay-points",       (e) => { if (!supermarketOverlayClickable()) return; showSupermarketPointPopup(e); });
  map.on("click", "supermarket-overlay-clusters",     (e) => { if (!supermarketOverlayClickable()) return; showSupermarketClusterPopup(e); });
  map.on("click", "supermarket-overlay-cluster-count",(e) => { if (!supermarketOverlayClickable()) return; showSupermarketClusterPopup(e); });

  map.on("click", "listed-building-overlay-points",       (e) => { if (!listedBuildingOverlayClickable()) return; showListedBuildingPointPopup(e); });
  map.on("click", "listed-building-overlay-clusters",     (e) => { if (!listedBuildingOverlayClickable()) return; showListedBuildingClusterPopup(e); });
  map.on("click", "listed-building-overlay-cluster-count",(e) => { if (!listedBuildingOverlayClickable()) return; showListedBuildingClusterPopup(e); });

  const planningOverlayClickable = () => stateRef.current.planningOverlayMode !== "off";

  const showPlanningPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const ref = escapeHtml(String(p.ref ?? ""));
    const address = escapeHtml(String(p.address ?? ""));
    const description = escapeHtml(String(p.description ?? ""));
    const decision = String(p.decision ?? "");
    const startDate = escapeHtml(String(p.start_date ?? ""));
    const decisionDate = escapeHtml(String(p.decision_date ?? ""));
    const docUrl = String(p.doc_url ?? "");
    const decisionLabel: Record<string, string> = {
      approved: "✅ Approved",
      refused: "❌ Refused",
      withdrawn: "↩️ Withdrawn",
      pending: "🕐 Pending",
      prior_approval: "📋 Prior approval not required",
      other: "Unknown",
    };
    const decisionColor: Record<string, string> = {
      approved: "#16a34a", refused: "#dc2626", withdrawn: "#6b7280",
      pending: "#f97316", prior_approval: "#2563eb", other: "#9ca3af",
    };
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:200px;max-width:270px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">📋 Planning application</div>
        ${ref ? `<div style="font-size:11px;color:#6b7280">Ref: <b style="color:#374151">${ref}</b></div>` : ""}
        ${address ? `<div style="font-size:11px;color:#374151;margin-top:2px">${address}</div>` : ""}
        ${decision ? `<div style="font-size:11px;margin-top:3px;color:${decisionColor[decision] ?? '#374151'}">${decisionLabel[decision] ?? decision}</div>` : ""}
        ${description ? `<div style="font-size:11px;color:#6b7280;margin-top:3px">${description}</div>` : ""}
        ${startDate ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px">Applied: ${startDate}${decisionDate ? ` · Decided: ${decisionDate}` : ""}</div>` : ""}
        ${docUrl ? `<div style="font-size:11px;margin-top:3px"><a href="${escapeHtml(docUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb">View on council portal ↗</a></div>` : ""}
        <div style="font-size:9px;color:#9ca3af;margin-top:4px">Source: planning.data.gov.uk (MHCLG)</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showPlanningClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
        <div style="font-weight:700;margin-bottom:4px">📋 Planning applications</div>
        <div>Applications in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity:0.8;margin-top:2px">Zoom in to see individual records.</div>
        <div style="font-size:9px;color:#9ca3af;margin-top:3px">Source: planning.data.gov.uk (MHCLG)</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  map.on("click", "planning-application-overlay-points",       (e) => { if (!planningOverlayClickable()) return; showPlanningPointPopup(e); });
  map.on("click", "planning-application-overlay-clusters",     (e) => { if (!planningOverlayClickable()) return; showPlanningClusterPopup(e); });
  map.on("click", "planning-application-overlay-cluster-count",(e) => { if (!planningOverlayClickable()) return; showPlanningClusterPopup(e); });

  const holidayLetOverlayClickable = () => stateRef.current.holidayLetOverlayMode !== "off";

  const showHolidayLetPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const p = f.properties || {};
    const name = escapeHtml(String(p.name ?? ""));
    const city = escapeHtml(String(p.city ?? ""));
    const price = escapeHtml(String(p.price ?? ""));
    const minNights = Number(p.min_nights ?? 0);
    const reviews = Number(p.reviews ?? 0);
    const hostCount = Number(p.host_count ?? 1);
    const availability = Number(p.availability ?? 0);
    const operatorLabel = hostCount > 1 ? `Professional operator (${hostCount} listings)` : "Individual host";
    const html = `
      <div style="font:12px/1.5 system-ui,sans-serif;color:#374151;min-width:200px;max-width:270px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">🏠 Holiday let</div>
        ${name ? `<div style="font-size:11px;color:#374151;margin-bottom:2px">${name}</div>` : ""}
        ${city ? `<div style="font-size:11px;color:#6b7280">${city}</div>` : ""}
        ${price ? `<div style="font-size:11px;margin-top:3px">From <b>${price}</b> / night</div>` : ""}
        ${minNights > 1 ? `<div style="font-size:11px;color:#6b7280">Min stay: ${minNights} nights</div>` : ""}
        <div style="font-size:11px;color:#6b7280;margin-top:2px">Available ${availability} days/yr · ${reviews} reviews</div>
        <div style="font-size:11px;color:#6b7280">${operatorLabel}</div>
        <div style="font-size:9px;color:#9ca3af;margin-top:4px">Source: Inside Airbnb (insideairbnb.com) — CC BY 4.0 · Major cities only</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  const showHolidayLetClusterPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;
    const count = Number(f.properties?.point_count ?? 0);
    const html = `
      <div style="font-family:system-ui;font-size:12px;line-height:1.25;">
        <div style="font-weight:700;margin-bottom:4px">🏠 Holiday lets</div>
        <div>Listings in cluster: <b>${count.toLocaleString()}</b></div>
        <div style="opacity:0.8;margin-top:2px">Zoom in to see individual listings.</div>
        <div style="font-size:9px;color:#9ca3af;margin-top:3px">Source: Inside Airbnb — major cities only (London, Manchester, Edinburgh, Bristol)</div>
      </div>
    `;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  map.on("click", "holiday-let-overlay-points",       (e) => { if (!holidayLetOverlayClickable()) return; showHolidayLetPointPopup(e); });
  map.on("click", "holiday-let-overlay-clusters",     (e) => { if (!holidayLetOverlayClickable()) return; showHolidayLetClusterPopup(e); });
  map.on("click", "holiday-let-overlay-cluster-count",(e) => { if (!holidayLetOverlayClickable()) return; showHolidayLetClusterPopup(e); });

  // Pointer cursor when hovering clickable overlay features
  const overlayHoverLayers = [
    "flood-overlay-points", "flood-overlay-clusters", "flood-overlay-cluster-count",
    "school-overlay-points", "school-overlay-clusters", "school-overlay-cluster-count",
    "primary-school-overlay-points", "primary-school-overlay-clusters", "primary-school-overlay-cluster-count",
    "station-overlay-points", "station-overlay-clusters", "station-overlay-cluster-count",
    "crime-overlay-points", "crime-overlay-clusters", "crime-overlay-cluster-count",
    "bus-stop-overlay-points", "bus-stop-overlay-clusters", "bus-stop-overlay-cluster-count",
    "metro-tram-overlay-points", "metro-tram-overlay-clusters", "metro-tram-overlay-cluster-count",
    "pharmacy-overlay-points", "pharmacy-overlay-clusters", "pharmacy-overlay-cluster-count",
    "listed-building-overlay-points", "listed-building-overlay-clusters", "listed-building-overlay-cluster-count",
    "planning-application-overlay-points", "planning-application-overlay-clusters", "planning-application-overlay-cluster-count",
    "holiday-let-overlay-points", "holiday-let-overlay-clusters", "holiday-let-overlay-cluster-count",
  ];
  overlayHoverLayers.forEach((id) => {
    map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
  });

  map.on("mousemove", "cells-fill", (e) => {
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    if (useFloodPopupMode() || useSchoolPopupMode() || usePrimarySchoolPopupMode()) {
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
    const prog = Number(p.pct_progressive ?? NaN);
    const cons = Number(p.pct_conservative ?? NaN);
    const right = Number(p.pct_popular_right ?? NaN);

    // ── Index scoring breakdown popup ──
    if (indexPrefsRef.current) {
      const prefs = indexPrefsRef.current;
      const totalPrefWeight = (prefs.affordWeight ?? 0) + (prefs.floodWeight ?? 0) + (prefs.schoolWeight ?? 0) + (prefs.primarySchoolWeight ?? 0) + (prefs.trainWeight ?? 0) + (prefs.ageWeight ?? 0) + (prefs.crimeWeight ?? 0) + (prefs.epcFuelWeight ?? 0) + (prefs.broadbandWeight ?? 0) + (prefs.busWeight ?? 0) + (prefs.pharmacyWeight ?? 0) + (prefs.pubWeight ?? 0) + (prefs.supermarketWeight ?? 0);
      if (totalPrefWeight === 0) {
        const html = `<div style="font-family:system-ui;font-size:12px;line-height:1.4;min-width:180px;max-width:220px;">
          <div style="font-weight:700;margin-bottom:6px;font-size:13px;">🗺️ No criteria set</div>
          <div style="font-size:11px;opacity:0.75;">Open <b>Find My Area</b> and set importance weights to score areas against your priorities.</div>
        </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        return;
      }
      const totalScore = Number(p.index_score ?? NaN);
      if (Number.isFinite(totalScore)) {
        const bar = (v: number, noData?: boolean) => {
          if (noData) return `<span style="font-size:10px;opacity:0.5">no data for region</span>`;
          const pct = Math.round(v * 100);
          const col = v < 0.35 ? "#ef4444" : v < 0.55 ? "#fb923c" : v < 0.72 ? "#facc15" : "#4ade80";
          return `<div style="display:flex;align-items:center;gap:5px;">
            <div style="width:72px;height:5px;background:rgba(255,255,255,0.15);border-radius:3px;overflow:hidden;flex-shrink:0;">
              <div style="width:${pct}%;height:100%;background:${col};border-radius:3px;"></div>
            </div>
            <span style="font-size:11px;opacity:0.85">${pct}%</span>
          </div>`;
        };
        const wRow = (label: string, w: number, scoreHtml: string) =>
          `<div style="margin-bottom:5px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
              <span>${label}</span><span style="opacity:0.5">×${w}</span>
            </div>${scoreHtml}</div>`;

        const noAreaData = totalScore < 0;
        let html = `<div style="font-family:system-ui;font-size:12px;line-height:1.4;min-width:180px;max-width:210px;">`;
        if (noAreaData) {
          html += `<div style="font-weight:700;margin-bottom:7px;font-size:13px;">🗺️ Match score: <span style="color:#9ca3af">⚪ no data</span></div>`;
          html += `<div style="font-size:10px;opacity:0.55;margin-bottom:7px;">None of your search criteria have coverage data for this cell.</div>`;
        } else {
          const totalCol = totalScore < 0.35 ? "#ef4444" : totalScore < 0.55 ? "#fb923c" : totalScore < 0.72 ? "#facc15" : "#4ade80";
          html += `<div style="font-weight:700;margin-bottom:7px;font-size:13px;">🗺️ Match score: <span style="color:${totalCol}">${Math.round(totalScore * 100)}%</span></div>`;
        }
        const ptLabels: Record<string, string> = { ALL: "All types", D: "Detached", S: "Semi", T: "Terraced", F: "Flat" };
        const rawPtKey = prefs.propertyType ?? "ALL";
        const ptLabel = ptLabels[rawPtKey] ?? rawPtKey.split(",").map((t) => ptLabels[t] ?? t).join(" + ");
        const affordRef = Number(p.ix_av ?? NaN);
        const ixan = Number(p.ix_an ?? 0);
        const affordNoData   = ixan === 1; // truly no data
        const affordEstimated = ixan === 2; // estimated via type-ratio
        const hasAffordRef = prefs.affordWeight > 0 && !affordNoData && Number.isFinite(affordRef) && affordRef > 0;
        const unit = stateRef.current.metric === "median_ppsf" ? " /ft²" : "";
        if (hasAffordRef) {
          const medianLabel = ptLabel && ptLabel !== "All types" ? `${ptLabel} median value` : "Median value";
          const estMark = affordEstimated ? " <span style='opacity:0.55;font-size:9px'>(est.)</span>" : "";
          html += `<div style="font-size:11px;opacity:0.9;margin-bottom:${affordEstimated ? 2 : 6}px;">🏠 ${medianLabel}: <b>£${Math.round(affordRef).toLocaleString()}${unit}</b>${estMark}</div>`;
          if (affordEstimated) {
            html += `<div style="font-size:10px;opacity:0.55;margin-bottom:5px;">No ${ptLabel.toLowerCase()} sales in this cell — estimated from overall median</div>`;
          }
        } else if (prefs.affordWeight > 0 && affordNoData) {
          const missingLabel = ptLabel && ptLabel !== "All types" ? ptLabel : "selected type";
          html += `<div style="font-size:11px;opacity:0.9;margin-bottom:6px;">🏠 ${missingLabel} median value: <b>❌ Not enough data</b></div>`;
        } else if (Number.isFinite(median) && median > 0) {
          html += `<div style="font-size:11px;opacity:0.9;margin-bottom:6px;">🏠 Median value: <b>£${Math.round(median).toLocaleString()}</b></div>`;
        }
        const affordLabel = ptLabel && ptLabel !== "All types" ? `💰 ${ptLabel}` : "💰 Affordability";
        if (prefs.affordWeight > 0) {
          html += wRow(affordLabel, prefs.affordWeight, bar(Number(p.ix_a ?? 0.5), affordNoData));
          if (affordNoData) {
            html += `<div style="font-size:10px;opacity:0.72;margin:-2px 0 5px 0;">❌ Not enough data for selected type in this cell</div>`;
          }
          if (!hasAffordRef && Number.isFinite(affordRef) && affordRef > 0) {
            html += `<div style="font-size:10px;opacity:0.72;margin:-2px 0 5px 0;">Affordability reference median: <b>£${Math.round(affordRef).toLocaleString()}${unit}</b></div>`;
          }
        }
        if (prefs.floodWeight > 0)              html += wRow("🌊 Flood risk",            prefs.floodWeight,              bar(Number(p.ix_f  ?? 0.5), p.ix_fn === 1));
        if ((prefs.crimeWeight ?? 0) > 0)        html += wRow("🚔 Crime risk",             prefs.crimeWeight!,                 bar(Number(p.ix_cr ?? 0.5), !Number.isFinite(Number(p.crime_local_score))));
        if (prefs.schoolWeight > 0)             html += wRow("🏫 Schools (secondary)",   prefs.schoolWeight,             bar(Number(p.ix_s  ?? 0.5), p.ix_sn === 1));
        if ((prefs.primarySchoolWeight ?? 0) > 0) html += wRow("🏫 Primary school nearby", prefs.primarySchoolWeight!,   bar(Number(p.ix_p  ?? 0.5), p.ix_pn === 1));
        if (prefs.trainWeight > 0)              html += wRow("🚂 Train station",          prefs.trainWeight,              bar(Number(p.ix_t  ?? 0.5), p.ix_tn === 1));
        if (prefs.coastWeight > 0)              html += wRow("🏖️ Coast",                 prefs.coastWeight,              bar(0.5, true));
        if ((prefs.ageWeight ?? 0) > 0) html += wRow(`👥 Community age (${(prefs.ageDirection ?? "young") === "old" ? "older" : "younger"})`, prefs.ageWeight!, bar(Number(p.ix_ag ?? 0.5), false));
        if ((prefs.epcFuelWeight ?? 0) > 0) {
          const fuelLabels: Record<string, string> = { gas: "Gas", electric: "Electric", oil: "Oil", lpg: "LPG", no_gas: "No gas" };
          const fuelLabel = fuelLabels[prefs.epcFuelPreference ?? "gas"] ?? (prefs.epcFuelPreference ?? "gas");
          const epcFuelVal = Number(p.ix_epc_fuel ?? -1);
          html += wRow(`⚡ Heating fuel (${fuelLabel})`, prefs.epcFuelWeight!, bar(epcFuelVal < 0 ? 0.5 : epcFuelVal, epcFuelVal < 0));
        }
        if ((prefs.broadbandWeight ?? 0) > 0) {
          const bbTierLabel = prefs.broadbandWeight === 10 ? "Fibre" : prefs.broadbandWeight === 6 ? "Cable" : "SFBB";
          const bbThreshold = prefs.broadbandWeight === 10 ? 300 : prefs.broadbandWeight === 6 ? 100 : 30;
          const bbSpeed = Number(p.bb_avg_speed ?? NaN);
          const bbVal = Number.isFinite(bbSpeed) ? Math.min(1, bbSpeed / bbThreshold) : NaN;
          html += wRow(`📶 Internet (${bbTierLabel} ≥${bbThreshold}Mb)`, prefs.broadbandWeight!, bar(Number.isFinite(bbVal) ? bbVal : 0.5, !Number.isFinite(bbSpeed)));
        }
        if ((prefs.busWeight ?? 0) > 0) html += wRow("🚌 Bus & metro *", prefs.busWeight!, bar(Number(p.ix_bus ?? 0.5), p.ix_busn === 1));
        if ((prefs.pharmacyWeight ?? 0) > 0) html += wRow("💊 Pharmacy *", prefs.pharmacyWeight!, bar(Number(p.ix_phm ?? 0.5), p.ix_phmn === 1));
        if ((prefs.pubWeight ?? 0) > 0) html += wRow("🍺 Pubs/bars *", prefs.pubWeight!, bar(Number(p.ix_pub ?? 0.5), p.ix_pubn === 1));
        if ((prefs.supermarketWeight ?? 0) > 0) html += wRow("🛒 Food shops *", prefs.supermarketWeight!, bar(Number(p.ix_smkt ?? 0.5), p.ix_smktn === 1));
        html += `</div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        return;
      }
    }

    const ageMode = stateRef.current.ageOverlayMode ?? "off";
    if (ageMode !== "off") {
      const meanAge   = Number(p.mean_age     ?? NaN);
      const pUnder15  = Number(p.pct_under_15 ?? NaN);
      const p15_24    = Number(p.pct_15_24    ?? NaN);
      const p25_44    = Number(p.pct_25_44    ?? NaN);
      const p45_64    = Number(p.pct_45_64    ?? NaN);
      const p65p      = Number(p.pct_65_plus  ?? NaN);
      const hasAge = Number.isFinite(meanAge);
      const metricTitle = stateRef.current.metric === "median_ppsf"
        ? `GBP ${Math.round(median).toLocaleString()} / ft²`
        : `GBP ${median.toLocaleString()}`;
      const propHtml = Number.isFinite(median) && median > 0
        ? `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:7px;padding-top:6px;font-size:11px;opacity:0.75;">
             <span style="font-weight:600">${metricTitle}</span>
             <span style="margin-left:6px;opacity:0.7">${tx} sales</span>
           </div>`
        : "";

      if (hasAge) {
        const ageBands: Array<[string, number, string]> = [
          ["Under 15", pUnder15, "#60a5fa"],
          ["15–24",    p15_24,   "#34d399"],
          ["25–44",    p25_44,   "#facc15"],
          ["45–64",    p45_64,   "#fb923c"],
          ["65+",      p65p,     "#f87171"],
        ];
        const total = ageBands.reduce((s, [, v]) => s + (isFinite(v) ? v : 0), 0) || 100;
        const barSegs = ageBands
          .filter(([, v]) => isFinite(v) && v > 0)
          .map(([, v, col]) =>
            `<div style="flex:${(v / total * 100).toFixed(1)};background:${col};height:100%;"></div>`
          ).join("");
        const statsRows = ageBands.map(([label, v, col]) =>
          `<span style="white-space:nowrap;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${col};margin-right:3px;vertical-align:-1px;"></span>${label}&nbsp;<b>${Number.isFinite(v) ? v.toFixed(0) : "—"}%</b></span>`
        ).join("<span style='opacity:0.35'> · </span>");
        const html = `
          <div style="font-family:system-ui;font-size:12px;line-height:1.4;min-width:200px;">
            <div style="font-weight:700;margin-bottom:5px;">👥 Mean age: ${meanAge.toFixed(1)} yrs</div>
            <div style="display:flex;height:10px;border-radius:4px;overflow:hidden;margin-bottom:6px;">${barSegs}</div>
            <div style="font-size:10px;line-height:1.8;">${statsRows}</div>
            ${propHtml}
          </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      } else {
        const html = `
          <div style="font-family:system-ui;font-size:12px;line-height:1.4;">
            <div style="font-weight:700;margin-bottom:4px;">👥 No age data</div>
            <div style="opacity:0.7;font-size:11px;">Census 2021 – England &amp; Wales only</div>
            ${propHtml}
          </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
      return;
    }

    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    if (commuteMode !== "off") {
      const meanDist = Number(p.mean_dist_km ?? NaN);
      const wfh     = Number(p.pct_wfh   ?? NaN);
      const lt5     = Number(p.pct_lt5   ?? NaN);
      const s5_10   = Number(p.pct_5_10  ?? NaN);
      const s10_20  = Number(p.pct_10_20 ?? NaN);
      const s20_60  = Number(p.pct_20_60 ?? NaN);
      const p60     = Number(p.pct_60p   ?? NaN);
      const hasCommute = Number.isFinite(meanDist) && Number.isFinite(wfh);
      const metricTitle = stateRef.current.metric === "median_ppsf"
        ? `GBP ${Math.round(median).toLocaleString()} / ft²`
        : `GBP ${median.toLocaleString()}`;
      const propHtml = Number.isFinite(median) && median > 0
        ? `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:7px;padding-top:6px;font-size:11px;opacity:0.75;">
             <span style="font-weight:600">${metricTitle}</span>
             <span style="margin-left:6px;opacity:0.7">${tx} sales</span>
           </div>`
        : "";

      if (hasCommute) {
        // Stacked bar segments: WFH | <3mi | 3-6mi | 6-12mi | 12-37mi | 37mi+
        const bands: Array<[string, number, string]> = [
          ["WFH",      wfh,   "#15803d"],
          ["<3mi",     lt5,   "#86efac"],
          ["3–6mi",    s5_10, "#fef08a"],
          ["6–12mi",   s10_20,"#fb923c"],
          ["12–37mi",  s20_60,"#ef4444"],
          ["37mi+",    p60,   "#7f1d1d"],
        ];
        const total = bands.reduce((s, [, v]) => s + (isFinite(v) ? v : 0), 0) || 100;
        const barSegs = bands
          .filter(([, v]) => isFinite(v) && v > 0)
          .map(([, v, col]) =>
            `<div style="flex:${(v / total * 100).toFixed(1)};background:${col};height:100%;"></div>`
          ).join("");
        const statsRows = bands.map(([label, v, col]) =>
          `<span style="white-space:nowrap;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${col};margin-right:3px;vertical-align:-1px;"></span>${label}&nbsp;<b>${Number.isFinite(v) ? v.toFixed(0) : "—"}%</b></span>`
        ).join("<span style='opacity:0.35'> · </span>");
        const html = `
          <div style="font-family:system-ui;font-size:12px;line-height:1.4;min-width:200px;">
            <div style="font-weight:700;margin-bottom:5px;">🚗 Mean commute: ${(meanDist * 0.621).toFixed(1)} mi</div>
            <div style="display:flex;height:10px;border-radius:4px;overflow:hidden;margin-bottom:6px;">${barSegs}</div>
            <div style="font-size:10px;line-height:1.8;">${statsRows}</div>
            ${propHtml}
          </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      } else {
        const html = `
          <div style="font-family:system-ui;font-size:12px;line-height:1.4;">
            <div style="font-weight:700;margin-bottom:4px;">🚗 No commute data</div>
            <div style="opacity:0.7;font-size:11px;">Census 2021 – England &amp; Wales only</div>
            ${propHtml}
          </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      }
      return;
    }

    const crimeCellMode = stateRef.current.crimeCellMode ?? "off";
    if (crimeCellMode !== "off") {
      const scale = stateRef.current.crimeCellScale ?? "absolute";
      const isLocal = scale === "relative";
      const totalRate    = Number(p.total_rate    ?? 0);
      const violentRate  = Number(p.violent_rate  ?? 0);
      const propertyRate = Number(p.property_rate ?? 0);
      const asbRate      = Number(p.asb_rate      ?? 0);
      // Cell estimated annual counts (fractional share from pipeline, rounded)
      const totalCount    = p.total_count    != null ? Number(p.total_count)    : null;
      const violentCount  = p.violent_count  != null ? Number(p.violent_count)  : null;
      const propertyCount = p.property_count != null ? Number(p.property_count) : null;
      const asbCount      = p.asb_count      != null ? Number(p.asb_count)      : null;
      const crimeScore    = Number(isLocal ? (p.crime_local_score    ?? p.crime_score    ?? 50) : (p.crime_score    ?? 50));
      const violentScore  = Number(isLocal ? (p.violent_local_score  ?? p.violent_score  ?? 50) : (p.violent_score  ?? 50));
      const propertyScore = Number(isLocal ? (p.property_local_score ?? p.property_score ?? 50) : (p.property_score ?? 50));
      const asbScore      = Number(isLocal ? (p.asb_local_score      ?? p.asb_score      ?? 50) : (p.asb_score      ?? 50));
      const sLabel = (s: number) => s >= 80 ? "Low" : s >= 60 ? "Below avg" : s >= 40 ? "Average" : s >= 20 ? "Above avg" : "High";
      const sCol   = (s: number) => s >= 80 ? "#16a34a" : s >= 60 ? "#84cc16" : s >= 40 ? "#eab308" : s >= 20 ? "#f97316" : "#dc2626";
      const oneInX = (rate: number) => rate > 0 ? Math.max(1, Math.round(1000 / rate)) : null;
      const rStr   = (rate: number) => { const x = oneInX(rate); return x !== null ? `1 in ${x.toLocaleString()}/yr` : "No data"; };
      const context = isLocal ? "vs. local area" : "vs. UK national";
      const metricTitle = stateRef.current.metric === "median_ppsf"
        ? `GBP ${Math.round(median).toLocaleString()} / ft²`
        : `GBP ${median.toLocaleString()}`;
      const propHtml = Number.isFinite(median) && median > 0
        ? `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:6px;padding-top:5px;font-size:11px;opacity:0.65;">${metricTitle} · ${tx} sales</div>`
        : "";
      const row = (label: string, score: number, rate: number, count: number | null) =>
        `<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:2px"><span style="color:#6b7280">${label}</span><span style="text-align:right"><span style="color:${sCol(score)};font-weight:${label === "Overall" ? 600 : 400}">${sLabel(score)}</span>&nbsp;<span style="color:#9ca3af;font-size:10px">${rStr(rate)}</span>${count !== null && count > 0 ? `&nbsp;<span style="color:#c0c0c0;font-size:10px">~${count.toLocaleString()} crimes/yr</span>` : ""}</span></div>`;
      const highFootfall = totalRate > 500;
      const crimeHtml = `
        <div style="font:12px/1.5 system-ui,sans-serif;min-width:220px">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px">🔴 Crime</div>
          <div style="font-size:10px;color:#9ca3af;margin-bottom:5px">${context}</div>
          ${row("Overall", crimeScore, totalRate, totalCount)}
          ${row("Violent", violentScore, violentRate, violentCount)}
          ${row("Property", propertyScore, propertyRate, propertyCount)}
          ${row("ASB", asbScore, asbRate, asbCount)}
          ${highFootfall ? `<div style="font-size:10px;color:#9ca3af;margin-top:4px;border-top:1px solid rgba(0,0,0,0.08);padding-top:3px">⚠ High footfall area — rates vs. residents may be elevated</div>` : ""}
          ${propHtml}
        </div>`;
      popup.setLngLat(e.lngLat).setHTML(crimeHtml).addTo(map);
      return;
    }

    const epcFuelPopupMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const broadbandPopupMode = stateRef.current.broadbandCellOverlayMode ?? "off";

    if (broadbandPopupMode !== "off") {
      const bbSpeed   = Number(p.bb_avg_speed ?? NaN);
      const bbPctSfbb = Number(p.bb_pct_sfbb  ?? NaN);
      const bbPctFast = Number(p.bb_pct_fast   ?? NaN);
      const hasBb = Number.isFinite(bbSpeed);
      const metricFooter = Number.isFinite(median) && median > 0
        ? `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:7px;padding-top:6px;font-size:11px;opacity:0.65;">${stateRef.current.metric === "median_ppsf" ? `GBP ${Math.round(median).toLocaleString()} / ft²` : `GBP ${median.toLocaleString()}`} · ${tx} sales</div>`
        : "";
      if (hasBb) {
        const pctSlow = Number.isFinite(bbPctSfbb) ? (100 - bbPctSfbb).toFixed(0) : "—";
        const html = `<div style="font-family:system-ui;font-size:12px;line-height:1.6;min-width:195px;">
          <div style="font-weight:700;margin-bottom:5px;">📶 Broadband speeds</div>
          <div>Average speed: <b>${Number.isFinite(bbSpeed) ? bbSpeed.toFixed(0) : "—"} Mbit/s</b></div>
          <div style="margin-top:4px;border-top:1px solid rgba(0,0,0,0.07);padding-top:4px;">
          <div><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#15803d;margin-right:5px;vertical-align:-1px;"></span>Full-fibre / cable speeds: <b>${Number.isFinite(bbPctFast) ? bbPctFast.toFixed(0) : "—"}%</b> of homes</div>
          <div><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#22d3ee;margin-right:5px;vertical-align:-1px;"></span>Superfast broadband+: <b>${Number.isFinite(bbPctSfbb) ? bbPctSfbb.toFixed(0) : "—"}%</b> of homes</div>
          <div><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f97316;margin-right:5px;vertical-align:-1px;"></span>Slow connection only: <b>${pctSlow}%</b> of homes</div>
          </div>
          ${metricFooter}
        </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      } else {
        popup.setLngLat(e.lngLat).setHTML(`<div style="font-family:system-ui;font-size:12px;"><b>📶 No broadband data</b><div style="opacity:0.6;font-size:11px;margin-top:3px;">Broadband data not available for this cell</div>${metricFooter}</div>`).addTo(map);
      }
      return;
    }

    const lbCellPopupMode = stateRef.current.listedBuildingCellOverlayMode ?? "off";
    if (lbCellPopupMode !== "off") {
      const lbScore  = Number(p.lb_score  ?? NaN);
      const lbCount  = Number(p.lb_count  ?? NaN);
      const lbGrade1 = Number(p.lb_grade1 ?? NaN);
      const lbGrade2s = Number(p.lb_grade2s ?? NaN);
      const lbGrade2 = Number(p.lb_grade2 ?? NaN);
      const hasLb = Number.isFinite(lbCount) && lbCount > 0;
      const metricFooter = Number.isFinite(median) && median > 0
        ? `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:7px;padding-top:6px;font-size:11px;opacity:0.65;">${stateRef.current.metric === "median_ppsf" ? `GBP ${Math.round(median).toLocaleString()} / ft²` : `GBP ${median.toLocaleString()}`} · ${tx} sales</div>`
        : "";
      if (hasLb) {
        const html = `<div style="font-family:system-ui;font-size:12px;line-height:1.6;min-width:195px;">
          <div style="font-weight:700;margin-bottom:5px;">🏛️ Heritage density</div>
          <div>Heritage score: <b>${Number.isFinite(lbScore) ? lbScore : "—"} / 100</b></div>
          <div>Listed buildings: <b>${Number.isFinite(lbCount) ? lbCount.toLocaleString() : "—"}</b> in this cell</div>
          <div style="margin-top:4px;border-top:1px solid rgba(0,0,0,0.07);padding-top:4px;font-size:11px;">
          <div>Grade I: <b>${Number.isFinite(lbGrade1) ? lbGrade1.toLocaleString() : "—"}</b></div>
          <div>Grade II*: <b>${Number.isFinite(lbGrade2s) ? lbGrade2s.toLocaleString() : "—"}</b></div>
          <div>Grade II: <b>${Number.isFinite(lbGrade2) ? lbGrade2.toLocaleString() : "—"}</b></div>
          </div>
          ${metricFooter}
        </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      } else {
        popup.setLngLat(e.lngLat).setHTML(`<div style="font-family:system-ui;font-size:12px;"><b>🏛️ No listed buildings</b><div style="opacity:0.6;font-size:11px;margin-top:3px;">No listed buildings recorded in this cell</div>${metricFooter}</div>`).addTo(map);
      }
      return;
    }

    if (epcFuelPopupMode !== "off") {
      const pctGas      = Number(p.pct_gas      ?? NaN);
      const pctElectric = Number(p.pct_electric ?? NaN);
      const pctOil      = Number(p.pct_oil      ?? NaN);
      const pctLpg      = Number(p.pct_lpg      ?? NaN);
      const pctOther    = Number(p.fuel_pct_other ?? NaN);
      const hasEpc = Number.isFinite(pctGas);
      const metricFooter = Number.isFinite(median) && median > 0
        ? `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:7px;padding-top:6px;font-size:11px;opacity:0.65;">${stateRef.current.metric === "median_ppsf" ? `GBP ${Math.round(median).toLocaleString()} / ft²` : `GBP ${median.toLocaleString()}`} · ${tx} sales</div>`
        : "";
      if (hasEpc) {
        const fuelBands: Array<[string, number, string]> = [
          ["Gas",      pctGas,      "#2563eb"],
          ["Electric", pctElectric, "#f59e0b"],
          ["Oil",      pctOil,      "#16a34a"],
          ["LPG",      pctLpg,      "#a855f7"],
          ["Other",    pctOther,    "#9ca3af"],
        ];
        const total = fuelBands.reduce((s, [, v]) => s + (isFinite(v) ? v : 0), 0) || 100;
        const barSegs = fuelBands.filter(([, v]) => isFinite(v) && v > 0)
          .map(([, v, col]) => `<div style="flex:${(v/total*100).toFixed(1)};background:${col};height:100%;"></div>`).join("");
        const statsRows = fuelBands.map(([label, v, col]) =>
          `<span style="white-space:nowrap;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${col};margin-right:3px;vertical-align:-1px;"></span>${label}&nbsp;<b>${Number.isFinite(v) ? v.toFixed(0) : "—"}%</b></span>`
        ).join("<span style='opacity:0.35'> · </span>");
        const html = `<div style="font-family:system-ui;font-size:12px;line-height:1.4;min-width:200px;">
          <div style="font-weight:700;margin-bottom:5px;">⚡ Heating fuel mix</div>
          <div style="display:flex;height:10px;border-radius:4px;overflow:hidden;margin-bottom:6px;">${barSegs}</div>
          <div style="font-size:10px;line-height:1.8;">${statsRows}</div>
          ${metricFooter}
        </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      } else {
        popup.setLngLat(e.lngLat).setHTML(`<div style="font-family:system-ui;font-size:12px;"><b>⚡ No EPC fuel data</b><div style="opacity:0.6;font-size:11px;margin-top:3px;">EPC data not available for this cell</div>${metricFooter}</div>`).addTo(map);
      }
      return;
    }

    if (voteMode !== "off") {
      const constituency = String(p.constituency ?? "Cell vote estimate");
      const constituencyHtml = escapeHtml(constituency);
      const hasVoteData = Number.isFinite(prog) || Number.isFinite(cons) || Number.isFinite(right);
      const progSafe = Number.isFinite(prog) ? prog : 0;
      const consSafe = Number.isFinite(cons) ? cons : 0;
      const rightSafe = Number.isFinite(right) ? right : 0;
      const otherRaw = Number(p.pct_other ?? NaN);
      const otherSafe = Number.isFinite(otherRaw)
        ? Math.max(0, otherRaw)
        : Math.max(0, 1 - (progSafe + consSafe + rightSafe));
      const totalSafe = progSafe + consSafe + rightSafe + otherSafe;

      const html = hasVoteData
        ? `
          <div style="font-family: system-ui; font-size: 12px; line-height: 1.3;">
            <div style="font-weight: 700; margin-bottom: 4px;">${constituencyHtml}</div>
            <div>Progressive: <b>${(progSafe * 100).toFixed(1)}%</b></div>
            <div>Conservative: <b>${(consSafe * 100).toFixed(1)}%</b></div>
            <div>Popular Right: <b>${(rightSafe * 100).toFixed(1)}%</b></div>
            <div>Other: <b>${(otherSafe * 100).toFixed(1)}%</b></div>
            <div style="margin-top:4px; opacity:0.8;">Total: <b>${(totalSafe * 100).toFixed(1)}%</b></div>
          </div>
        `
        : `
          <div style="font-family: system-ui; font-size: 12px; line-height: 1.3;">
            <div style="font-weight: 700; margin-bottom: 4px;">No vote data for this cell</div>
            <div>Try a coarser grid for broader coverage.</div>
          </div>
        `;

      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      return;
    }

    // Show delta popup only if we're actually looking at delta data (deltas are non-zero)
    let html = "";
    if (isDeltaMetric(stateRef.current.metric)) {
      const sign = dg > 0 ? "+" : dg < 0 ? "-" : "";
      html = `
        <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
          <div style="font-weight: 700; margin-bottom: 4px;">${sign}GBP ${Math.abs(dg).toLocaleString()}</div>
          <div>Change %: <b>${dp.toFixed(1)}%</b></div>
          <div>Sales sample: <b>${tx}</b></div>
        </div>
      `;
    } else {
      const metricTitle = stateRef.current.metric === "median_ppsf"
        ? `GBP ${Math.round(median).toLocaleString()} / ft²`
        : `GBP ${median.toLocaleString()}`;
      const isPpsf = stateRef.current.metric === "median_ppsf";
      const fmtGbp = (v: number) => isPpsf ? `GBP ${Math.round(v).toLocaleString()} / ft²` : `GBP ${Math.round(v).toLocaleString()}`;
      const currentMode = stateRef.current.modelledMode ?? "blend";
      const isBlendMode = currentMode === "blend" || currentMode === "model_only";
      const hasEstimate = isBlendMode && p.estimated_median != null && (p.estimated_median as number) > 0;
      if (hasEstimate) {
        // Dual-row: actual + estimate for all blend cells that have a model value
        const actualVal = p.is_modelled
          ? (p.actual_median != null && (p.actual_median as number) > 0 ? fmtGbp(p.actual_median as number) : "—")
          : fmtGbp(median);
        const actualSales = `${p.is_modelled ? Number(p.tx_count ?? 0) : tx} sales`;
        const confLabel = p.model_confidence === 2 ? "High" : p.model_confidence === 1 ? "Medium" : "Low";
        html = `
          <div style="font-family: system-ui; font-size: 12px; line-height: 1.4;">
            <div style="display:grid;grid-template-columns:max-content 1fr;gap:1px 8px;">
              <span style="color:#888;">Actual</span><span><b>${actualVal}</b> <span style="color:#888;">${actualSales}</span></span>
              <span style="color:#888;">Estimate</span><span><b>${fmtGbp(p.estimated_median as number)}</b></span>
            </div>
            <div style="color:#888;font-style:italic;margin-top:4px;">◆ ${p.n_years_model ?? "?"}yr local trend · ${confLabel} confidence</div>
          </div>
        `;
      } else {
        html = `
          <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
            <div style="font-weight: 700; margin-bottom: 4px;">${metricTitle}</div>
            <div>Sales sample: <b>${tx}</b></div>
            ${p.is_modelled ? `<div style="color:#888;font-style:italic;margin-top:3px;">◆ Estimated — ${p.n_years_model ?? "?"}yr local trend · ${p.model_confidence === 2 ? "High" : p.model_confidence === 1 ? "Medium" : "Low"} confidence</div>` : ""}
          </div>
        `;
      }
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
    if (tapToSearchRef.current) return;  // tap-to-search mode: hand click to the reverse-geocode handler instead
    if (useFloodPopupMode() || useSchoolPopupMode() || usePrimarySchoolPopupMode()) {
      return;
    }

    const f = e.features?.[0] as any;
    if (!f) return;
    const gx = Number(f.properties?.gx);
    const gy = Number(f.properties?.gy);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
    const median = Number(f.properties?.median);
    setPostcodeMaxPrice(resolveZooplaMaxPrice(median));
    // Subtle Scotland caveat when clicking northern cells (Gretna ~331900, 568300)
    if (gy >= 568300) {
      setScotlandNote("Scotland data coverage is partial and may be 1–2 years out of date.");
    } else {
      setScotlandNote(null);
    }

    // Zoom in so overlay data is visible at detail level
    const coords = f.geometry?.coordinates?.[0];
    if (coords && coords.length >= 4) {
      const cLon = (coords[0][0] + coords[2][0]) / 2;
      const cLat = (coords[0][1] + coords[2][1]) / 2;
      const currentZoom = map.getZoom();
      // Zoom thresholds match autoGridForZoom in page.tsx:
      //   < 5.6 → 25km grid → zoom to 8.0 (lands on 5km)
      //   < 7.0 → 10km grid → zoom to 8.5 (lands on 5km, approaching 1mile)
      //   < 8.2 → 5km grid  → zoom to 9.5 (lands on 1mile)
      const targetZoom = currentZoom < 5.6 ? 8.0 : currentZoom < 7.0 ? 8.5 : currentZoom < 8.2 ? 9.5 : null;
      if (targetZoom !== null) {
        map.flyTo({ center: [cLon, cLat], zoom: targetZoom, duration: 900 });
      }
    }

    // Show a brief hint nudging user to right-click for full details, anchored to the tap/click point
    if (hintsEnabledRef.current) setCellClickHint({ x: e.point.x, y: e.point.y });
    if (cellClickHintTimerRef.current) clearTimeout(cellClickHintTimerRef.current);
    cellClickHintTimerRef.current = window.setTimeout(() => setCellClickHint(null), 4000);

    void fetchPostcodesRef.current(gx, gy, 0, false);
  });

  // ── Right-click → reverse postcode lookup  /  tap-to-search mode ──
  // Info is piped to page.tsx via onRightClickInfo; no MapLibre popup is created.
  const clearRgClickDot = () => { if (rgClickMarkerRef.current) { rgClickMarkerRef.current.remove(); rgClickMarkerRef.current = null; } };
  const setRgClickDot = (lon: number, lat: number) => {
    clearRgClickDot();
    const el = document.createElement('div');
    el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 3px #2563eb55;pointer-events:none;';
    rgClickMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(map);
  };
  const clearRgOverlay = () => {
    clearRgClickDot();
    setFloodSearchFocus(map, null);
    setFloodSearchContext(map, null);
    setSchoolSearchFocus(map, null, null, null);
    setPrimarySchoolSearchFocus(map, null, null);
    setStationSearchFocus(map, null, null);
    setCrimeSearchFocus(map, null, null);
    setBusStopSearchFocus(map, null, null);
    setPharmacySearchFocus(map, null, null);
    setPubSearchFocus(map, null, null);
    setSupermarketSearchFocus(map, null, null);
  };
  clearRgOverlayRef.current = clearRgOverlay;
  const closeActiveRg = () => {
    onRightClickInfoRef.current?.(null);
    clearRgOverlay();
  };
  const doReverseGeocode = (lng: number, lat: number) => {
    closeActiveRg();
    // Signal page.tsx to show loading panel immediately
    onRightClickInfoRef.current?.({ stage: 'loading', clickLat: lat, clickLng: lng });
    setRgClickDot(lng, lat);
    const lineTargets: [number, number][] = [];
    // Format metres → "450m" or "1.2mi"
    const fmtDist = (m: number) => m < 400 ? `${Math.round(m)}m` : `${(m / 1609.34).toFixed(1)}mi`;

    // Lazy-load each dataset (cached after first call, identical to applyIndexScoring logic)
    const ensureFlood = async () => {
      if (_indexFloodCache === null) {
        try {
          const r = await fetch("/api/flood?plain=1");
          _indexFloodCache = r.ok
            ? ((await r.json() as any)?.features ?? [])
                .filter((f: any) => f?.geometry?.type === "Point")
                .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), riskScore: Number(f.properties?.risk_score ?? 0) || 0 }))
            : [];
        } catch { _indexFloodCache = []; }
        _indexFloodGrid = null;
      }
      if (_indexFloodGrid === null) _indexFloodGrid = buildSpatialGrid(_indexFloodCache!, 0.12);
      return _indexFloodGrid;
    };
    const ensureSchool = async () => {
      if (_indexSchoolCache === null) {
        try {
          const r = await fetch("/api/schools?plain=1");
          _indexSchoolCache = r.ok
            ? ((await r.json() as any)?.features ?? [])
                .filter((f: any) => f?.geometry?.type === "Point")
                .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), qualityScore: Number(f.properties?.quality_score ?? 0.5) || 0.5, isGood: Boolean(f.properties?.is_good), schoolName: String(f.properties?.school_name ?? ""), urn: String(f.properties?.urn ?? "") }))
            : [];
        } catch { _indexSchoolCache = []; }
        _indexSchoolGrid = null;
      }
      if (_indexSchoolGrid === null) _indexSchoolGrid = buildSpatialGrid(_indexSchoolCache!, 0.12);
      return _indexSchoolGrid;
    };
    const ensureStation = async () => {
      if (_indexStationCache === null) {
        try {
          const r = await fetch("/api/stations?plain=1");
          if (r.ok) {
            _indexStationCache = ((await r.json() as any)?.features ?? [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), code: String(f.properties?.code ?? "") }));
            _indexStationGrid = null;
          }
        } catch { /* leave null */ }
      }
      if (_indexStationGrid === null && _indexStationCache !== null) _indexStationGrid = buildSpatialGrid(_indexStationCache, 0.12);
      return _indexStationGrid;
    };
    const ensurePrimarySchool = async () => {
      if (_indexPrimarySchoolCache === null) {
        try {
          const r = await fetch("/api/schools?key=primary_school_overlay_points.geojson.gz&plain=1");
          _indexPrimarySchoolCache = r.ok
            ? ((await r.json() as any)?.features ?? [])
                .filter((f: any) => f?.geometry?.type === "Point")
                .map((f: any) => ({
                  lon: Number(f.geometry.coordinates[0]),
                  lat: Number(f.geometry.coordinates[1]),
                  ofstedGrade: Number(f.properties?.ofsted_grade ?? 0),
                  name: String(f.properties?.name ?? ""),
                  urn: String(f.properties?.urn ?? ""),
                }))
            : [];
        } catch { _indexPrimarySchoolCache = []; }
        _indexPrimarySchoolGrid = null;
      }
      if (_indexPrimarySchoolGrid === null) _indexPrimarySchoolGrid = buildSpatialGrid(_indexPrimarySchoolCache!, 0.12);
      return _indexPrimarySchoolGrid;
    };

    const ensureCrime = async () => {
      if (_indexCrimeCache === null) {
        try {
          const r = await fetch("/api/crime?plain=1");
          _indexCrimeCache = r.ok
            ? ((await r.json() as any)?.features ?? [])
                .filter((f: any) => f?.geometry?.type === "Point")
                .map((f: any) => ({
                  lon: Number(f.geometry.coordinates[0]),
                  lat: Number(f.geometry.coordinates[1]),
                  lsoa_code: String(f.properties?.lsoa_code ?? ""),
                  lsoa_name: String(f.properties?.lsoa_name ?? ""),
                  crime_score: Number(f.properties?.crime_score ?? 50),
                  violent_score: Number(f.properties?.violent_score ?? 50),
                  property_score: Number(f.properties?.property_score ?? 50),
                  asb_score: Number(f.properties?.asb_score ?? 50),
                  total_rate: Number(f.properties?.total_rate ?? 0),
                }))
            : [];
        } catch { _indexCrimeCache = []; }
        _indexCrimeGrid = null;
      }
      if (_indexCrimeGrid === null) _indexCrimeGrid = buildSpatialGrid(_indexCrimeCache!, 0.12);
      return _indexCrimeGrid;
    };

    const ensureBusStop = async () => {
      if (_indexBusStopCache === null) {
        try {
          const r = await fetch("/api/bus-stops?plain=1");
          if (r.ok) {
            _indexBusStopCache = ((await r.json() as any)?.features ?? [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), atco_code: String(f.properties?.atco_code ?? "") }));
            _indexBusStopGrid = null;
          }
        } catch { /* leave null */ }
      }
      if (_indexBusStopGrid === null && _indexBusStopCache !== null) _indexBusStopGrid = buildSpatialGrid(_indexBusStopCache, 0.12);
      return _indexBusStopGrid;
    };
    const ensureMetroTram = async () => {
      if (_indexMetroTramCache === null) {
        try {
          const r = await fetch("/api/bus-stops?key=metro_tram_overlay_points.geojson.gz&plain=1");
          if (r.ok) {
            _indexMetroTramCache = ((await r.json() as any)?.features ?? [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), stop_type: String(f.properties?.stop_type ?? "") }));
            _indexMetroTramGrid = null;
          }
        } catch { /* leave null */ }
      }
      if (_indexMetroTramGrid === null && _indexMetroTramCache !== null) _indexMetroTramGrid = buildSpatialGrid(_indexMetroTramCache, 0.12);
      return _indexMetroTramGrid;
    };
    const ensurePharmacy = async () => {
      if (_indexPharmacyCache === null) {
        try {
          const r = await fetch("/api/pharmacies?plain=1");
          if (r.ok) {
            _indexPharmacyCache = ((await r.json() as any)?.features ?? [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), ods_code: String(f.properties?.ods_code ?? "") }));
            _indexPharmacyGrid = null;
          }
        } catch { /* leave null */ }
      }
      if (_indexPharmacyGrid === null && _indexPharmacyCache !== null) _indexPharmacyGrid = buildSpatialGrid(_indexPharmacyCache, 0.12);
      return _indexPharmacyGrid;
    };
    const ensurePub = async () => {
      if (_indexPubCache === null) {
        try {
          const r = await fetch("/api/pubs?plain=1");
          if (r.ok) {
            _indexPubCache = ((await r.json() as any)?.features ?? [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), amenity: String(f.properties?.amenity ?? "pub") }));
            _indexPubGrid = null;
          }
        } catch { /* leave null */ }
      }
      if (_indexPubGrid === null && _indexPubCache !== null) _indexPubGrid = buildSpatialGrid(_indexPubCache, 0.12);
      return _indexPubGrid;
    };
    const ensureSupermarket = async () => {
      if (_indexSupermarketCache === null) {
        try {
          const r = await fetch("/api/supermarkets?plain=1");
          if (r.ok) {
            _indexSupermarketCache = ((await r.json() as any)?.features ?? [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), shop: String(f.properties?.shop ?? "supermarket") }));
            _indexSupermarketGrid = null;
          }
        } catch { /* leave null */ }
      }
      if (_indexSupermarketGrid === null && _indexSupermarketCache !== null) _indexSupermarketGrid = buildSpatialGrid(_indexSupermarketCache, 0.12);
      return _indexSupermarketGrid;
    };

    // Clear any previous lines immediately when a new right-click starts
    setFloodSearchFocus(map, null);
    setFloodSearchContext(map, null);
    setSchoolSearchFocus(map, null, null, null);
    setPrimarySchoolSearchFocus(map, null, null);
    setStationSearchFocus(map, null, null);
    setCrimeSearchFocus(map, null, null);
    setBusStopSearchFocus(map, null, null);
    setPharmacySearchFocus(map, null, null);
    setPubSearchFocus(map, null, null);
    setSupermarketSearchFocus(map, null, null);

    void (async () => {
      try {
        // Run postcode lookup and dataset loading in parallel
        const [floodG, schoolG, primarySchoolG, stationG, crimeG, busStopG, metroTramG, pharmacyG, pubG, supermarketG, pcRes] = await Promise.all([
          ensureFlood(),
          ensureSchool(),
          ensurePrimarySchool(),
          ensureStation(),
          ensureCrime(),
          ensureBusStop(),
          ensureMetroTram(),
          ensurePharmacy(),
          ensurePub(),
          ensureSupermarket(),
          fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1&radius=2000`),
        ]);

        // ── Flood: nearest flood point to the click location ──
        // We look for the NEAREST point (not the worst-risk), matching the cell-scoring
        // logic which only considers flood dots inside the cell itself.  Looking far away
        // for a worst-case zone produces misleading arrows pointing to a distant risk
        // while ignoring whether the clicked spot is actually clean.
        //
        // Display bands (based on nearest point distance):
        //   < 200m  → "In [risk] flood zone"
        //   < 800m  → "[Risk] zone nearby (Xm)"
        //   < 2km   → "[Risk] zone Xkm away"
        //   ≥ 2km   → "✓ No flood zone nearby"    (no arrow drawn)
        let floodHtml = '<span style="color:#16a34a">✓ No flood zone nearby</span>';
        let worstFloodLon = 0, worstFloodLat = 0;
        if (floodG) {
          // Query within 0.025° (~2.8km) — just enough for the display bands above
          const fps = querySpatialGrid(floodG, lng, lat, 0.025);
          let nearestFp: (typeof fps)[0] | null = null; let nearestD = Infinity;
          for (const fp of fps) {
            const d = haversineDistanceMeters(lat, lng, fp.lat, fp.lon);
            if (d < nearestD) { nearestD = d; nearestFp = fp; }
          }
          if (nearestFp && nearestD < 2000) {
            const risk = nearestFp.riskScore;
            const riskLabel = risk >= 4 ? "High" : risk >= 3 ? "Medium" : risk >= 2 ? "Low" : "Very low";
            const riskCol   = risk >= 4 ? "#b91c1c" : risk >= 3 ? "#ea580c" : risk >= 2 ? "#d97706" : "#84cc16";
            worstFloodLon = nearestFp.lon; worstFloodLat = nearestFp.lat;
            if (nearestD < 200) {
              floodHtml = `<span style="color:${riskCol};font-weight:600">⚠ In ${riskLabel.toLowerCase()} risk flood zone</span>`;
            } else if (nearestD < 800) {
              floodHtml = `<span style="color:${riskCol};font-weight:600">${riskLabel} risk zone nearby</span> <span style="color:#9ca3af">${fmtDist(nearestD)}</span>`;
            } else {
              floodHtml = `<span style="color:#16a34a">✓ No direct risk</span> <span style="color:#9ca3af">— nearest zone ${fmtDist(nearestD)} <span style="color:${riskCol}">(${riskLabel.toLowerCase()} risk)</span></span>`;
            }
            // Draw arrow to the nearest flood point
            setFloodSearchFocus(map, { postcode: "", postcodeKey: "", riskScore: risk, lon: worstFloodLon, lat: worstFloodLat });
            setFloodSearchContext(map, { requested: { lon: lng, lat: lat }, nearest: { lon: worstFloodLon, lat: worstFloodLat } });
            lineTargets.push([worstFloodLon, worstFloodLat]);
          }
        }

        // ── Nearest school within 20 km ──
        let schoolHtml = '<span style="color:#6b7280">No school data here</span>';
        if (schoolG) {
          const sps = querySpatialGrid(schoolG, lng, lat, 0.18);
          let nearestSch: (typeof sps)[0] | null = null; let nearSchD = Infinity;
          let nearestGoodSch: (typeof sps)[0] | null = null; let nearGoodSchD = Infinity;
          for (const sp of sps) {
            const d = haversineDistanceMeters(lat, lng, sp.lat, sp.lon);
            if (d < nearSchD) { nearestSch = sp; nearSchD = d; }
            if (sp.qualityScore >= 0.7 && d < nearGoodSchD) { nearestGoodSch = sp; nearGoodSchD = d; }
          }
          if (nearestSch) {
            const q = nearestSch.qualityScore;
            const label = q >= 0.7 ? "Good" : q >= 0.45 ? "Average" : "Below average";
            const col = q >= 0.7 ? "#16a34a" : q >= 0.45 ? "#d97706" : "#b91c1c";
            const ofstedUrl = nearestSch.urn
              ? `https://reports.ofsted.gov.uk/search?q=${nearestSch.urn}`
              : null;
            const nameHtml = nearestSch.schoolName
              ? `<span style="color:#374151">${nearestSch.schoolName}</span> &mdash; `
              : "";
            const ofstedLink = ofstedUrl
              ? ` <a href="${ofstedUrl}" target="_blank" rel="noreferrer" style="color:#6366f1;font-size:10px;text-decoration:none;white-space:nowrap">Ofsted ↗</a>`
              : "";
            schoolHtml = `${nameHtml}<span style="color:${col}">${label}</span> <span style="color:#9ca3af">${fmtDist(nearSchD)} away</span>${ofstedLink}<div style="font-size:10px;color:#9ca3af;margin-top:2px">⚠ GCSE outcomes only — not Ofsted rating</div>`;
            lineTargets.push([nearestSch.lon, nearestSch.lat]);
          }
          // Draw line(s) to school(s)
          const toSchEntry = (sp: NonNullable<typeof nearestSch>, d: number) => ({
            schoolName: "", postcode: "", postcodeKey: "", qualityScore: sp.qualityScore,
            qualityBand: "", isGood: sp.isGood, lon: sp.lon, lat: sp.lat, distanceMeters: d,
          });
          setSchoolSearchFocus(
            map,
            nearestSch ? toSchEntry(nearestSch, nearSchD) : null,
            nearestGoodSch && nearestGoodSch !== nearestSch ? toSchEntry(nearestGoodSch, nearGoodSchD) : null,
            { lon: lng, lat: lat }
          );
        }

        // ── Nearest primary school within 5 km ──
        let primarySchoolHtml = '<span style="color:#6b7280">No data here</span>';
        if (primarySchoolG) {
          const pss = querySpatialGrid(primarySchoolG, lng, lat, 0.045);
          let nearestPs: (typeof pss)[0] | null = null; let nearPsD = Infinity;
          for (const ps of pss) {
            const d = haversineDistanceMeters(lat, lng, ps.lat, ps.lon);
            if (d < nearPsD) { nearPsD = d; nearestPs = ps; }
          }
          if (nearestPs) {
            const psGradeLabels: Record<number, string> = { 0: "Not graded", 1: "Outstanding", 2: "Good", 3: "Requires improvement", 4: "Inadequate" };
            const psGradeColors: Record<number, string> = { 0: "#9ca3af", 1: "#16a34a", 2: "#2563eb", 3: "#f59e0b", 4: "#dc2626" };
            const psLabel = psGradeLabels[nearestPs.ofstedGrade] ?? "Not graded";
            const psCol   = psGradeColors[nearestPs.ofstedGrade] ?? "#9ca3af";
            const psLink  = nearestPs.urn ? `https://reports.ofsted.gov.uk/provider/21/${nearestPs.urn}` : null;
            const psNameHtml  = nearestPs.name ? `<span style="color:#374151">${nearestPs.name}</span> &mdash; ` : "";
            const psOfstedLink = psLink ? ` <a href="${psLink}" target="_blank" rel="noreferrer" style="color:#6366f1;font-size:10px;text-decoration:none;white-space:nowrap">Ofsted ↗</a>` : "";
            primarySchoolHtml = `${psNameHtml}<span style="color:${psCol}">${psLabel}</span> <span style="color:#9ca3af">${fmtDist(nearPsD)} away</span>${psOfstedLink}`;
            lineTargets.push([nearestPs.lon, nearestPs.lat]);
            setPrimarySchoolSearchFocus(map, nearestPs, { lon: lng, lat });
          }
        }

        // ── Nearest station within 30 km ──
        let stationHtml = '<span style="color:#6b7280">No station data here</span>';
        if (stationG) {
          const sts = querySpatialGrid(stationG, lng, lat, 0.27);
          let nearestStn: (typeof sts)[0] | null = null; let nearStnD = Infinity;
          for (const st of sts) {
            const d = haversineDistanceMeters(lat, lng, st.lat, st.lon);
            if (d < nearStnD) { nearestStn = st; nearStnD = d; }
          }
          if (nearestStn) {
            stationHtml = `<span style="color:#374151">${nearestStn.name}</span> <span style="color:#9ca3af">${fmtDist(nearStnD)} away</span>`;
            lineTargets.push([nearestStn.lon, nearestStn.lat]);
            // Draw rail-style line to station
            setStationSearchFocus(
              map,
              { name: nearestStn.name, code: nearestStn.code, owner: "", lon: nearestStn.lon, lat: nearestStn.lat, distanceMeters: nearStnD },
              { lon: lng, lat: lat }
            );
          }
        }

        // ── Nearest crime LSOA within ~10 km ──
        let crimeHtml = '<span style="color:#6b7280">No crime data here</span>';
        if (crimeG) {
          const cps = querySpatialGrid(crimeG, lng, lat, 0.09);
          let nearestCp: (typeof cps)[0] | null = null; let nearCpD = Infinity;
          for (const cp of cps) {
            const d = haversineDistanceMeters(lat, lng, cp.lat, cp.lon);
            if (d < nearCpD) { nearCpD = d; nearestCp = cp; }
          }
          if (nearestCp) {
            const scoreLabel = (s: number) => s >= 80 ? "Low" : s >= 60 ? "Below avg" : s >= 40 ? "Average" : s >= 20 ? "Above avg" : "High";
            const scoreCol   = (s: number) => s >= 80 ? "#16a34a" : s >= 60 ? "#84cc16" : s >= 40 ? "#eab308" : s >= 20 ? "#f97316" : "#dc2626";
            const overall = nearestCp.crime_score;
            const highFootfall = nearestCp.total_rate > 245;
            const lsoaName = nearestCp.lsoa_name || nearestCp.lsoa_code;
            crimeHtml = `<span style="color:#374151">${lsoaName}</span>` +
              `<div style="margin-top:3px;line-height:1.6">` +
              `<span style="color:#9ca3af">Overall: </span><span style="color:${scoreCol(overall)};font-weight:600">${scoreLabel(overall)}</span>` +
              ` &nbsp;` +
              `<span style="color:#9ca3af">Violent: </span><span style="color:${scoreCol(nearestCp.violent_score)}">${scoreLabel(nearestCp.violent_score)}</span>` +
              ` &nbsp;` +
              `<span style="color:#9ca3af">Property: </span><span style="color:${scoreCol(nearestCp.property_score)}">${scoreLabel(nearestCp.property_score)}</span>` +
              ` &nbsp;` +
              `<span style="color:#9ca3af">ASB: </span><span style="color:${scoreCol(nearestCp.asb_score)}">${scoreLabel(nearestCp.asb_score)}</span>` +
              `</div>` +
              (highFootfall ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px">⚠ High footfall area — rate may reflect visitors, not just residents</div>` : "");
            lineTargets.push([nearestCp.lon, nearestCp.lat]);
            setCrimeSearchFocus(map, nearestCp, { lon: lng, lat });
          }
        }

        // ── Nearest bus stop / metro-tram ──
        let busStopHtml = '<span style="color:#6b7280">No transit data</span>';
        if (busStopG) {
          const busNear = querySpatialGrid(busStopG, lng, lat, 0.027); // ~3km radius
          let nearBus: (typeof busNear)[0] | null = null; let nearBusDist = Infinity;
          for (const sp of busNear) {
            const d = haversineDistanceMeters(lat, lng, sp.lat, sp.lon);
            if (d < nearBusDist) { nearBusDist = d; nearBus = sp; }
          }
          const col = (d: number) => d <= BUS_STOP_GREAT_METERS ? "#16a34a" : d <= BUS_STOP_MAX_METERS ? "#d97706" : "#6b7280";
          if (nearBus) {
            busStopHtml = `🚌 <span style="color:${col(nearBusDist)}">${escapeHtml(nearBus.name)}</span> <span style="color:#9ca3af">${fmtDist(nearBusDist)}</span>`;
            lineTargets.push([nearBus.lon, nearBus.lat]);
            setBusStopSearchFocus(map, { lon: nearBus.lon, lat: nearBus.lat, name: nearBus.name }, { lon: lng, lat });
          } else {
            busStopHtml = '<span style="color:#9ca3af">No bus stop within 2mi</span>';
          }
        }
        if (metroTramG) {
          const mtNear = querySpatialGrid(metroTramG, lng, lat, 0.09); // ~10km radius
          let nearMt: (typeof mtNear)[0] | null = null; let nearMtDist = Infinity;
          for (const sp of mtNear) {
            const d = haversineDistanceMeters(lat, lng, sp.lat, sp.lon);
            if (d < nearMtDist) { nearMtDist = d; nearMt = sp; }
          }
          if (nearMt && nearMtDist <= METRO_TRAM_MAX_METERS * 2) {
            const mtCol = nearMtDist <= METRO_TRAM_GREAT_METERS ? "#16a34a" : nearMtDist <= METRO_TRAM_MAX_METERS ? "#d97706" : "#6b7280";
            const stopLabel = nearMt.stop_type === "TMU" ? "Metro entrance" : nearMt.stop_type === "PLT" ? "Metro platform" : "Metro";
            busStopHtml += `<br/><span style="color:#a855f7;font-size:10px">${stopLabel}: ${escapeHtml(nearMt.name)}</span> <span style="color:#9ca3af;font-size:10px">${fmtDist(nearMtDist)}</span>`;
          }
        }

        // ── Nearest pharmacy ──
        let pharmacyHtml = '<span style="color:#6b7280">No pharmacy data</span>';
        if (pharmacyG) {
          const pharmNear = querySpatialGrid(pharmacyG, lng, lat, 0.09); // ~10km radius
          let nearPharm: (typeof pharmNear)[0] | null = null; let nearPharmDist = Infinity;
          for (const sp of pharmNear) {
            const d = haversineDistanceMeters(lat, lng, sp.lat, sp.lon);
            if (d < nearPharmDist) { nearPharmDist = d; nearPharm = sp; }
          }
          if (nearPharm) {
            const pharmCol = nearPharmDist <= PHARMACY_GREAT_METERS ? "#16a34a" : nearPharmDist <= PHARMACY_MAX_METERS ? "#d97706" : "#9ca3af";
            pharmacyHtml = `💊 <span style="color:${pharmCol}">${escapeHtml(nearPharm.name)}</span> <span style="color:#9ca3af">${fmtDist(nearPharmDist)}</span>`;
            lineTargets.push([nearPharm.lon, nearPharm.lat]);
            setPharmacySearchFocus(map, { lon: nearPharm.lon, lat: nearPharm.lat, name: nearPharm.name }, { lon: lng, lat });
          } else {
            pharmacyHtml = '<span style="color:#9ca3af">No pharmacy within 6mi</span>';
          }
        }

        // ── Nearest pub / bar ──
        let pubHtml = '<span style="color:#6b7280">No pub/bar data</span>';
        if (pubG) {
          const pubNear = querySpatialGrid(pubG, lng, lat, 0.04); // ~4km radius
          let nearPub: (typeof pubNear)[0] | null = null; let nearPubDist = Infinity;
          for (const sp of pubNear) {
            const d = haversineDistanceMeters(lat, lng, sp.lat, sp.lon);
            if (d < nearPubDist) { nearPubDist = d; nearPub = sp; }
          }
          if (nearPub) {
            const pubCol = nearPubDist <= PUB_GREAT_METERS ? "#16a34a" : nearPubDist <= PUB_MAX_METERS ? "#d97706" : "#9ca3af";
            const label = nearPub.amenity === "bar" ? "🍹" : "🍺";
            pubHtml = `${label} <span style="color:${pubCol}">${escapeHtml(nearPub.name)}</span> <span style="color:#9ca3af">${fmtDist(nearPubDist)}</span>`;
            lineTargets.push([nearPub.lon, nearPub.lat]);
            setPubSearchFocus(map, { lon: nearPub.lon, lat: nearPub.lat, name: nearPub.name }, { lon: lng, lat });
          } else {
            pubHtml = '<span style="color:#9ca3af">No pub/bar within 2.5km</span>';
          }
        }

        // ── Nearest food shop / supermarket ──
        let supermarketHtml = '<span style="color:#6b7280">No food shop data</span>';
        if (supermarketG) {
          const smktNear = querySpatialGrid(supermarketG, lng, lat, 0.06); // ~6km radius
          let nearSmkt: (typeof smktNear)[0] | null = null; let nearSmktDist = Infinity;
          for (const sp of smktNear) {
            const d = haversineDistanceMeters(lat, lng, sp.lat, sp.lon);
            if (d < nearSmktDist) { nearSmktDist = d; nearSmkt = sp; }
          }
          if (nearSmkt) {
            const smktCol = nearSmktDist <= SUPERMARKET_GREAT_METERS ? "#16a34a" : nearSmktDist <= SUPERMARKET_MAX_METERS ? "#d97706" : "#9ca3af";
            const label = nearSmkt.shop === "convenience" ? "🏪" : "🛒";
            supermarketHtml = `${label} <span style="color:${smktCol}">${escapeHtml(nearSmkt.name)}</span> <span style="color:#9ca3af">${fmtDist(nearSmktDist)}</span>`;
            lineTargets.push([nearSmkt.lon, nearSmkt.lat]);
            setSupermarketSearchFocus(map, { lon: nearSmkt.lon, lat: nearSmkt.lat, name: nearSmkt.name }, { lon: lng, lat });
          } else {
            supermarketHtml = '<span style="color:#9ca3af">No food shop within 4km</span>';
          }
        }

        // Auto-fit the map so the click origin and all arrow endpoints are visible.
        // Expand the bounding box by 50% of the span on each side so the view sits
        // well clear of the arrow tips, and cap zoom so tightly-clustered arrows
        // don't send the camera in too far.
        if (lineTargets.length > 0) {
          const allPts: [number, number][] = [[lng, lat], ...lineTargets];
          const lons = allPts.map(p => p[0]);
          const lats = allPts.map(p => p[1]);
          const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
          const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
          const lonSpan = Math.max(maxLon - minLon, 0.01); // at least ~1km
          const latSpan = Math.max(maxLat - minLat, 0.01);
          const padLon = lonSpan * 0.5;
          const padLat = latSpan * 0.5;
          map.fitBounds(
            [[minLon - padLon, minLat - padLat], [maxLon + padLon, maxLat + padLat]],
            { maxZoom: 11, duration: 700 }
          );
        }

        // ── Resolve postcode (with outcode fallback) ──
        let postcode = "";
        let isOutcode = false;
        if (pcRes.ok) {
          const pcData = (await pcRes.json()) as any;
          const found = pcData?.result?.[0];
          if (found?.postcode) postcode = found.postcode as string;
        }
        if (!postcode) {
          const resOut = await fetch(`https://api.postcodes.io/outcodes?lon=${lng}&lat=${lat}&limit=1&radius=50000`);
          if (resOut.ok) {
            const dataOut = (await resOut.json()) as any;
            const foundOut = dataOut?.result?.[0];
            if (foundOut?.outcode) { postcode = foundOut.outcode as string; isOutcode = true; }
          }
        }
        if (!postcode) throw new Error("no postcode");

        // ── Cell data at the click point ──
        // gx/gy and median/txCount come from whichever partition is currently rendered.
        // delta_pct is fetched independently from /api/deltas (which is cached per grid)
        // so it's always accurate regardless of the current metric view.
        const cellPx = map.project([lng, lat]);
        const cellFeats = map.queryRenderedFeatures(cellPx, { layers: ['cells-fill'] });
        const cp = (cellFeats?.[0]?.properties ?? {}) as Record<string, unknown>;
        const cellMedian  = cp.median   !== undefined && cp.median   !== null ? Number(cp.median)   : undefined;
        const cellTxCount = cp.tx_count  !== undefined && cp.tx_count  !== null ? Number(cp.tx_count) : undefined;
        const constituency = cp.constituency ? String(cp.constituency) : undefined;
        const rawGx = cp.gx !== undefined ? Number(cp.gx) : NaN;
        const rawGy = cp.gy !== undefined ? Number(cp.gy) : NaN;

        // Fire percentile lookup in parallel with the delta fetch below.
        // Percentiles are stored in a dedicated slim file (not the partition) to keep
        // 1mile partition sizes small — so we fetch them on demand at right-click time.
        const _pctPromise = (stateRef.current.grid === "1mile" && Number.isFinite(rawGx) && Number.isFinite(rawGy))
          ? fetch(`/api/cell-percentiles?gx=${rawGx}&gy=${rawGy}`).then(r => r.ok ? r.json() : null).catch(() => null)
          : Promise.resolve(null);

        // Fetch delta data from the authoritative deltas API (not from rendered features,
        // which only have delta_pct when the metric is already "delta").
        let cellDeltaPct: number | undefined;
        let cellDeltaGbp: number | undefined;
        if (Number.isFinite(rawGx) && Number.isFinite(rawGy)) {
          try {
            const currentGrid = stateRef.current.grid;
            // Deltas API supports 5km/10km/25km only
            const deltaGrid = currentGrid === "25km" ? "25km" : currentGrid === "10km" ? "10km" : "5km";
            const step = deltaGrid === "25km" ? 25000 : deltaGrid === "10km" ? 10000 : 5000;
            const dGx = Math.floor(rawGx / step) * step;
            const dGy = Math.floor(rawGy / step) * step;
            // Bust cache if grid changed
            if (_deltasCacheGrid !== deltaGrid) { _deltasCache = null; _deltasCacheGrid = null; }
            if (_deltasCache === null) {
              const dRes = await fetch(`/api/deltas?grid=${deltaGrid}&propertyType=ALL&newBuild=ALL`);
              if (dRes.ok) {
                const dData = (await dRes.json()) as { rows: Array<Record<string, unknown>> };
                _deltasCache = new Map();
                for (const row of dData.rows ?? []) {
                  const gxField = `gx_${step}`; const gyField = `gy_${step}`;
                  const rgx = Number(row[gxField]); const rgy = Number(row[gyField]);
                  if (Number.isFinite(rgx) && Number.isFinite(rgy)) {
                    _deltasCache.set(`${rgx}_${rgy}`, {
                      delta_pct: Number(row.delta_pct ?? 0),
                      delta_gbp: Number(row.delta_gbp ?? 0),
                    });
                  }
                }
                _deltasCacheGrid = deltaGrid;
              }
            }
            const dEntry = _deltasCache?.get(`${dGx}_${dGy}`);
            if (dEntry) {
              cellDeltaPct = Number.isFinite(dEntry.delta_pct) ? dEntry.delta_pct : undefined;
              cellDeltaGbp = Number.isFinite(dEntry.delta_gbp) ? dEntry.delta_gbp : undefined;
            }
          } catch { /* use undefined if delta fetch fails */ }
        }

        // Resolve percentile lookup (was fired in parallel with delta fetch)
        const _pctData = await _pctPromise as { p25?: number; p70?: number; p90?: number; p_source?: string } | null;
        const cellP25: number | undefined = _pctData?.p25 !== undefined ? Number(_pctData.p25) : undefined;
        const cellP70: number | undefined = _pctData?.p70 !== undefined ? Number(_pctData.p70) : undefined;
        const cellP90: number | undefined = _pctData?.p90 !== undefined ? Number(_pctData.p90) : undefined;
        const cellPSource: string | undefined = _pctData?.p_source ? String(_pctData.p_source) : undefined;

        // ── EPC cell data summary for right-click panel ──
        let epcHtml: string | undefined;
        const cpGas      = Number(cp.pct_gas      ?? NaN);
        const cpElectric = Number(cp.pct_electric ?? NaN);
        const cpOil      = Number(cp.pct_oil      ?? NaN);
        const cpLpg      = Number(cp.pct_lpg      ?? NaN);
        const cpOther    = Number(cp.fuel_pct_other ?? NaN);
        const hasFuel = Number.isFinite(cpGas);
        if (hasFuel) {
          const swatch = (col: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${col};margin-right:3px;vertical-align:-1px;"></span>`;
          const fuelBands: Array<[string, number, string]> = [
            ["Gas", cpGas, "#2563eb"], ["Electric", cpElectric, "#f59e0b"],
            ["Oil", cpOil, "#16a34a"], ["LPG", cpLpg, "#a855f7"], ["Other", cpOther, "#9ca3af"],
          ];
          const tot = fuelBands.reduce((s, [, v]) => s + (isFinite(v) ? v : 0), 0) || 100;
          const bars = fuelBands.filter(([, v]) => isFinite(v) && v > 0)
            .map(([, v, c]) => `<span style="display:inline-block;width:${(v/tot*100).toFixed(0)}%;height:7px;background:${c};"></span>`).join("");
          const rows = fuelBands.map(([l, v, c]) => `${swatch(c)}<span style="color:#374151">${l} <b>${isFinite(v) ? v.toFixed(0) : "—"}%</b></span>`).join(" ");
          epcHtml = `<div style="margin-bottom:5px"><div style="font-weight:600;font-size:11px;margin-bottom:3px;">⚡ Heating fuel</div><div style="display:flex;height:7px;border-radius:3px;overflow:hidden;margin-bottom:4px;">${bars}</div><div style="font-size:10px;line-height:1.7;">${rows}</div></div>`;
        }

        // ── Internet (broadband) cell data for right-click panel ──
        let broadbandHtml: string | undefined;
        const bbSpeed   = Number(cp.bb_avg_speed ?? NaN);
        const bbPctSfbb = Number(cp.bb_pct_sfbb  ?? NaN);
        const bbPctFast = Number(cp.bb_pct_fast   ?? NaN);
        if (Number.isFinite(bbSpeed)) {
          const speedCol = bbSpeed >= 300 ? "#15803d" : bbSpeed >= 100 ? "#2563eb" : bbSpeed >= 30 ? "#d97706" : "#dc2626";
          broadbandHtml =
            `<span style="color:${speedCol};font-weight:600">${bbSpeed.toFixed(0)} Mbit/s avg</span>` +
            (Number.isFinite(bbPctFast) ? ` <span style="color:#9ca3af">· ${bbPctFast.toFixed(0)}% fibre/cable</span>` : "") +
            (Number.isFinite(bbPctSfbb) ? ` <span style="color:#9ca3af">· ${bbPctSfbb.toFixed(0)}% SFBB+</span>` : "");
        }

        // ── Log this search entry (after EPC + broadband so all data is captured) ──
        const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        onLocationLoggedRef.current?.({
          postcode, lat, lng,
          timestamp: new Date().toISOString(),
          floodSummary: stripHtml(floodHtml),
          schoolSummary: stripHtml(schoolHtml),
          primarySchoolSummary: stripHtml(primarySchoolHtml),
          stationSummary: stripHtml(stationHtml),
          crimeSummary: stripHtml(crimeHtml),
          epcSummary: epcHtml ? stripHtml(epcHtml) : undefined,
          broadbandSummary: broadbandHtml ? stripHtml(broadbandHtml) : undefined,
          busStopSummary: stripHtml(busStopHtml),
          pharmacySummary: stripHtml(pharmacyHtml),
          pubSummary: stripHtml(pubHtml),
          supermarketSummary: stripHtml(supermarketHtml),
          cellMedian, cellDeltaPct, cellTxCount, constituency,
          cellDeltaGbp,
        });

        // Pass all resolved data to page.tsx to render in the fixed left panel
        onRightClickInfoRef.current?.({
          stage: 'ready',
          postcode, isOutcode,
          floodHtml, schoolHtml, primarySchoolHtml, stationHtml, crimeHtml, epcHtml, broadbandHtml, busStopHtml, pharmacyHtml, pubHtml, supermarketHtml,
          clickLat: lat, clickLng: lng,
          cellMedian, cellDeltaPct, cellDeltaGbp, cellTxCount, cellP25, cellP70, cellP90, cellPSource, constituency,
        });
      } catch {
        closeActiveRg();
      }
    })();
  }; // end doReverseGeocode
  doReverseGeocodeRef.current = doReverseGeocode;

  map.on("contextmenu", (e) => {
    e.originalEvent.preventDefault();
    const { lng, lat } = e.lngLat;
    doReverseGeocode(lng, lat);
  });

  // Double-tap on mobile → same as right-click.
  // Uses native touchend events on the canvas container to detect two taps within 350ms.
  // Calling preventDefault() stops MapLibre's built-in double-tap zoom from firing.
  {
    const canvas = map.getCanvasContainer();
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const now = Date.now();
      const dx = touch.clientX - lastTapX;
      const dy = touch.clientY - lastTapY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (now - lastTapTime < 350 && dist < 30) {
        // Double-tap detected
        e.preventDefault(); // prevent MapLibre zoom
        const rect = canvas.getBoundingClientRect();
        const point = new maplibregl.Point(
          touch.clientX - rect.left,
          touch.clientY - rect.top
        );
        const { lng, lat } = map.unproject(point);
        doReverseGeocode(lng, lat);
        lastTapTime = 0; // reset so a third tap doesn't re-fire
      } else {
        lastTapTime = now;
        lastTapX = touch.clientX;
        lastTapY = touch.clientY;
      }
    };
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
  }

  // Tap-to-search: single tap fires the same lookup when the mode is active.
  // Cell clicks are already suppressed above when this mode is on.
  map.on("click", (e) => {
    if (!tapToSearchRef.current) return;
    const { lng, lat } = e.lngLat;
    doReverseGeocode(lng, lat);
  });

  // Initial real data load
  const initFc = await setRealData(map, state, geoCacheRef.current, undefined, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
  if (initFc) cellFcRef.current = initFc;
  if (indexPrefsRef.current) {
    void applyIndexScoring(map, indexPrefsRef.current, stateRef.current, cellFcRef.current ?? undefined).then((ok) => {
      if (ok) prevIndexActiveRef.current = true;
      onIndexScoringAppliedRef.current?.();
    });
  }
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

    // On a cache miss, clear the cells source immediately so the user sees an
    // instant blank → loading state rather than stale data for the debounce period.
    const isColdLoad = (() => {
      const isDelta = isDeltaMetric(state.metric);
      const endMonth = isDelta ? "LATEST" : state.endMonth ?? "LATEST";
      const base = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth}|${state.modelledMode ?? "blend"}|${VOTE_CELLS_DATA_VERSION}`;
      return !geoCacheRef.current.has(`${base}|core`) && !geoCacheRef.current.has(`${base}|full`);
    })();
    if (isColdLoad) {
      // Also null the in-memory FC so the scoring effect cannot score stale/wrong-grid data
      // while the new grid data is in-flight. applyIndexScoring will see no features, return
      // false, and defer to this setRealData path to call it once the correct data arrives.
      cellFcRef.current = null;
      try { src.setData({ type: "FeatureCollection", features: [] } as any); } catch { /* ignore */ }
    }

    setIsLoading(true);

    const debounceMs = 200;
    const timeoutId = setTimeout(() => {
      setRealData(map, state, geoCacheRef.current, abortController.signal, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current)
        .then((fc) => {
          if (fc) cellFcRef.current = fc;
          if (indexPrefsRef.current) {
            void applyIndexScoring(map, indexPrefsRef.current, stateRef.current, cellFcRef.current ?? undefined).then((ok) => {
              if (ok) prevIndexActiveRef.current = true;
              onIndexScoringAppliedRef.current?.();
            });
          }
          // If a cell colour overlay is active, setRealData/ensureAggregatesAndUpdate
          // always resets to house-price colours, so we must re-apply the overlay immediately.
          const activeOverlay = stateRef.current;
          if (map.getLayer("cells-fill")) {
            if ((activeOverlay.broadbandCellOverlayMode ?? "off") !== "off") {
              onLegendChange?.(null);
              applyBroadbandCellOverlayColorExpression(map, (activeOverlay.broadbandCellMetric ?? "avg_speed") as BroadbandCellMetric, easyColoursRef.current);
            } else if ((activeOverlay.listedBuildingCellOverlayMode ?? "off") !== "off") {
              onLegendChange?.(null);
              applyListedBuildingCellOverlayColorExpression(map);
            } else if ((activeOverlay.crimeCellMode ?? "off") !== "off") {
              onLegendChange?.(null);
              applyCrimeCellOverlayColorExpression(map, activeOverlay.crimeCellSubMode, activeOverlay.crimeCellScale, easyColoursRef.current);
            } else if ((activeOverlay.epcFuelOverlayMode ?? "off") !== "off") {
              onLegendChange?.(null);
              applyEpcFuelOverlayColorExpression(map, (activeOverlay.epcFuelType ?? "gas") as EpcFuelType, easyColoursRef.current);
            } else if ((activeOverlay.ageOverlayMode ?? "off") !== "off") {
              applyAgeOverlayColorExpression(map, easyColoursRef.current);
            } else if ((activeOverlay.commuteOverlayMode ?? "off") !== "off") {
              applyCommuteOverlayColorExpression(map, easyColoursRef.current);
            } else if ((activeOverlay.voteOverlayMode ?? "off") !== "off") {
              applyVoteOverlayColorFromSource(map, activeOverlay.voteColorScale ?? "relative");
            }
          }
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
  }, [state.grid, state.propertyType, state.newBuild, state.endMonth, state.metric, state.voteOverlayMode, state.commuteOverlayMode, state.modelledMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("load", () => applyValueFilter(map, stateRef.current, indexPrefsRef.current));
      return;
    }

    applyValueFilter(map, state, indexPrefsRef.current);
  }, [state.metric, state.valueFilterMode, state.valueThreshold, state.overlayFilterThreshold,
      state.broadbandCellOverlayMode, state.broadbandCellMetric,
      state.crimeCellMode, state.epcFuelOverlayMode, state.epcFuelType,
      state.ageOverlayMode, state.commuteOverlayMode, state.listedBuildingCellOverlayMode]);

  // Index scoring effect
  useEffect(() => {
    indexPrefsRef.current = indexPrefs ?? null;
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    const active = indexPrefs != null;
    if (active) {
      const nextSignature = buildIndexScoringSignature(indexPrefs);
      const scoringChanged = prevIndexScoringSignatureRef.current !== nextSignature;
      const needsFullRescore = !prevIndexActiveRef.current || scoringChanged;

      if (needsFullRescore) {
        prevIndexScoringSignatureRef.current = nextSignature;
        void (async () => {
          try {
            const ok = await applyIndexScoring(map, indexPrefs, stateRef.current, cellFcRef.current ?? undefined);
            if (ok) {
              prevIndexActiveRef.current = true;
              onIndexScoringAppliedRef.current?.();
              return;
            }
            // No cell data available yet (cold load in progress).
            // setRealData will call applyIndexScoring when data arrives and clear the spinner.
            // Safety net: force-clear the spinner after 20 s in case that path also stalls.
            await new Promise<void>(resolve => setTimeout(resolve, 20000));
            onIndexScoringAppliedRef.current?.();
          } catch (e) {
            console.error("applyIndexScoring threw unexpectedly", e);
            onIndexScoringAppliedRef.current?.();
          }
        })();
      } else {
        // Criteria unchanged — just re-apply filters and clear the pending spinner
        applyCombinedCellFilters(map, stateRef.current, indexPrefs);
        onIndexScoringAppliedRef.current?.();
      }
    } else if (prevIndexActiveRef.current) {
      // Restore opacity then re-apply quantile colour mapping (NOT static getFillColorExpression)
      if (map.getLayer("cells-fill")) {
        const hideCells =
          (stateRef.current.floodOverlayMode ?? "off") === "on_hide_cells" ||
          (stateRef.current.schoolOverlayMode ?? "off") === "on_hide_cells";
        map.setPaintProperty("cells-fill", "fill-opacity", hideCells ? 0.09 : ["case", ["all", ["==", ["get", "is_modelled"], true], ["==", ["get", "model_confidence"], 0]], 0.22, ["==", ["get", "is_modelled"], true], 0.32, 0.42] as any);
      }
      applyCombinedCellFilters(map, stateRef.current, null);
      prevIndexScoringSignatureRef.current = null;
      void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current);
    }
    prevIndexActiveRef.current = active;
  }, [indexPrefs, onLegendChange]);

  // Single consolidated effect for flood/school overlay visibility + hide-cells opacity.
  // Using one effect (rather than three separate ones) avoids a race where setLayoutProperty
  // calls for visibility cause MapLibre to briefly mark style.loaded()=false, which would
  // silently prevent a following hide-cells effect from updating fill-opacity.
  // A requestAnimationFrame deferral ensures all layout changes are committed before
  // paint properties are updated, fixing both:
  //   - Off → On (hide cells): cells not fading (hide-cells effect blocked by prior layout call)
  //   - Going to Off: cells staying near-transparent (white) for same reason
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const floodMode = state.floodOverlayMode ?? "off";
    const schoolMode = state.schoolOverlayMode ?? "off";
    const primarySchoolMode = state.primarySchoolOverlayMode ?? "off";
    const stationMode = state.stationOverlayMode ?? "off";
    const crimeMode = state.crimeOverlayMode ?? "off";
    const busStopMode = state.busStopOverlayMode ?? "off";
    const pharmacyMode = state.pharmacyOverlayMode ?? "off";
    const pubMode = state.pubOverlayMode ?? "off";
    const supermarketMode = state.supermarketOverlayMode ?? "off";
    const listedBuildingMode = state.listedBuildingOverlayMode ?? "off";
    const planningMode = state.planningOverlayMode ?? "off";
    const holidayLetMode = state.holidayLetOverlayMode ?? "off";
    const floodVisibility = floodMode === "off" ? "none" : "visible";
    const schoolVisibility = schoolMode === "off" ? "none" : "visible";
    const primarySchoolVisibility = primarySchoolMode === "off" ? "none" : "visible";
    const stationVisibility = stationMode === "off" ? "none" : "visible";
    const crimeVisibility = crimeMode === "off" ? "none" : "visible";
    const busStopVisibility = busStopMode === "off" ? "none" : "visible";
    const pharmacyVisibility = pharmacyMode === "off" ? "none" : "visible";
    const pubVisibility = pubMode === "off" ? "none" : "visible";
    const supermarketVisibility = supermarketMode === "off" ? "none" : "visible";
    const listedBuildingVisibility = listedBuildingMode === "off" ? "none" : "visible";
    const planningVisibility = planningMode === "off" ? "none" : "visible";
    const holidayLetVisibility = holidayLetMode === "off" ? "none" : "visible";
    const hideCellsMode = floodMode === "on_hide_cells" || schoolMode === "on_hide_cells" || primarySchoolMode === "on_hide_cells" || stationMode === "on_hide_cells" || crimeMode === "on_hide_cells" || busStopMode === "on_hide_cells" || pharmacyMode === "on_hide_cells" || pubMode === "on_hide_cells" || supermarketMode === "on_hide_cells" || listedBuildingMode === "on_hide_cells" || planningMode === "on_hide_cells" || holidayLetMode === "on_hide_cells";

    const apply = () => {
      try {
        // Flood layer visibility
        if (map.getLayer("flood-overlay-fill")) map.setLayoutProperty("flood-overlay-fill", "visibility", floodVisibility);
        if (map.getLayer("flood-overlay-outline")) map.setLayoutProperty("flood-overlay-outline", "visibility", floodVisibility);
        if (map.getLayer("flood-overlay-points")) map.setLayoutProperty("flood-overlay-points", "visibility", floodVisibility);
        if (map.getLayer("flood-overlay-clusters")) map.setLayoutProperty("flood-overlay-clusters", "visibility", floodVisibility);
        if (map.getLayer("flood-overlay-cluster-count")) map.setLayoutProperty("flood-overlay-cluster-count", "visibility", floodVisibility);

        // School layer visibility
        if (map.getLayer("school-overlay-points")) map.setLayoutProperty("school-overlay-points", "visibility", schoolVisibility);
        if (map.getLayer("school-overlay-clusters")) map.setLayoutProperty("school-overlay-clusters", "visibility", schoolVisibility);
        if (map.getLayer("school-overlay-cluster-count")) map.setLayoutProperty("school-overlay-cluster-count", "visibility", schoolVisibility);

        // Primary school (Ofsted) layer visibility
        if (map.getLayer("primary-school-overlay-points")) map.setLayoutProperty("primary-school-overlay-points", "visibility", primarySchoolVisibility);
        if (map.getLayer("primary-school-overlay-clusters")) map.setLayoutProperty("primary-school-overlay-clusters", "visibility", primarySchoolVisibility);
        if (map.getLayer("primary-school-overlay-cluster-count")) map.setLayoutProperty("primary-school-overlay-cluster-count", "visibility", primarySchoolVisibility);

        // Station layer visibility
        if (map.getLayer("station-overlay-points")) map.setLayoutProperty("station-overlay-points", "visibility", stationVisibility);
        if (map.getLayer("station-overlay-clusters")) map.setLayoutProperty("station-overlay-clusters", "visibility", stationVisibility);
        if (map.getLayer("station-overlay-cluster-count")) map.setLayoutProperty("station-overlay-cluster-count", "visibility", stationVisibility);

        // Crime (LSOA) layer visibility
        if (map.getLayer("crime-overlay-points")) map.setLayoutProperty("crime-overlay-points", "visibility", crimeVisibility);
        if (map.getLayer("crime-overlay-clusters")) map.setLayoutProperty("crime-overlay-clusters", "visibility", crimeVisibility);
        if (map.getLayer("crime-overlay-cluster-count")) map.setLayoutProperty("crime-overlay-cluster-count", "visibility", crimeVisibility);

        // Bus stop / metro-tram layer visibility (share the busStopMode toggle)
        if (map.getLayer("bus-stop-overlay-points")) map.setLayoutProperty("bus-stop-overlay-points", "visibility", busStopVisibility);
        if (map.getLayer("bus-stop-overlay-clusters")) map.setLayoutProperty("bus-stop-overlay-clusters", "visibility", busStopVisibility);
        if (map.getLayer("bus-stop-overlay-cluster-count")) map.setLayoutProperty("bus-stop-overlay-cluster-count", "visibility", busStopVisibility);
        if (map.getLayer("metro-tram-overlay-points")) map.setLayoutProperty("metro-tram-overlay-points", "visibility", busStopVisibility);
        if (map.getLayer("metro-tram-overlay-clusters")) map.setLayoutProperty("metro-tram-overlay-clusters", "visibility", busStopVisibility);
        if (map.getLayer("metro-tram-overlay-cluster-count")) map.setLayoutProperty("metro-tram-overlay-cluster-count", "visibility", busStopVisibility);

        // Pharmacy layer visibility
        if (map.getLayer("pharmacy-overlay-points")) map.setLayoutProperty("pharmacy-overlay-points", "visibility", pharmacyVisibility);
        if (map.getLayer("pharmacy-overlay-clusters")) map.setLayoutProperty("pharmacy-overlay-clusters", "visibility", pharmacyVisibility);
        if (map.getLayer("pharmacy-overlay-cluster-count")) map.setLayoutProperty("pharmacy-overlay-cluster-count", "visibility", pharmacyVisibility);

        // Pub/bar layer visibility
        if (map.getLayer("pub-overlay-points")) map.setLayoutProperty("pub-overlay-points", "visibility", pubVisibility);
        if (map.getLayer("pub-overlay-clusters")) map.setLayoutProperty("pub-overlay-clusters", "visibility", pubVisibility);
        if (map.getLayer("pub-overlay-cluster-count")) map.setLayoutProperty("pub-overlay-cluster-count", "visibility", pubVisibility);

        // Supermarket/food shop layer visibility
        if (map.getLayer("supermarket-overlay-points")) map.setLayoutProperty("supermarket-overlay-points", "visibility", supermarketVisibility);
        if (map.getLayer("supermarket-overlay-clusters")) map.setLayoutProperty("supermarket-overlay-clusters", "visibility", supermarketVisibility);
        if (map.getLayer("supermarket-overlay-cluster-count")) map.setLayoutProperty("supermarket-overlay-cluster-count", "visibility", supermarketVisibility);

        // Listed building layer visibility
        if (map.getLayer("listed-building-overlay-points")) map.setLayoutProperty("listed-building-overlay-points", "visibility", listedBuildingVisibility);
        if (map.getLayer("listed-building-overlay-clusters")) map.setLayoutProperty("listed-building-overlay-clusters", "visibility", listedBuildingVisibility);
        if (map.getLayer("listed-building-overlay-cluster-count")) map.setLayoutProperty("listed-building-overlay-cluster-count", "visibility", listedBuildingVisibility);

        // Planning application layer visibility
        if (map.getLayer("planning-application-overlay-points")) map.setLayoutProperty("planning-application-overlay-points", "visibility", planningVisibility);
        if (map.getLayer("planning-application-overlay-clusters")) map.setLayoutProperty("planning-application-overlay-clusters", "visibility", planningVisibility);
        if (map.getLayer("planning-application-overlay-cluster-count")) map.setLayoutProperty("planning-application-overlay-cluster-count", "visibility", planningVisibility);

        // Holiday let layer visibility
        if (map.getLayer("holiday-let-overlay-points")) map.setLayoutProperty("holiday-let-overlay-points", "visibility", holidayLetVisibility);
        if (map.getLayer("holiday-let-overlay-clusters")) map.setLayoutProperty("holiday-let-overlay-clusters", "visibility", holidayLetVisibility);
        if (map.getLayer("holiday-let-overlay-cluster-count")) map.setLayoutProperty("holiday-let-overlay-cluster-count", "visibility", holidayLetVisibility);

        // Cell opacity — applied in the same call so it cannot be skipped by a mid-layout bail
        if (map.getLayer("cells-fill")) {
          map.setLayoutProperty("cells-fill", "visibility", "visible");
          map.setPaintProperty("cells-fill", "fill-opacity", hideCellsMode ? 0.09 : ["case", ["all", ["==", ["get", "is_modelled"], true], ["==", ["get", "model_confidence"], 0]], 0.22, ["==", ["get", "is_modelled"], true], 0.32, 0.42] as any);
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
    };

    if (!map.getLayer("cells-fill")) {
      // Layers not yet initialised (map.on("load") hasn't fired yet); retry once idle
      map.once("idle", apply);
      return () => { map.off("idle", apply); };
    }

    // Defer by one rAF so MapLibre finishes processing any outstanding layout changes
    // before we apply paint property updates.
    const raf = requestAnimationFrame(apply);
    return () => { cancelAnimationFrame(raf); };
  }, [state.floodOverlayMode, state.schoolOverlayMode, state.primarySchoolOverlayMode, state.stationOverlayMode, state.crimeOverlayMode, state.busStopOverlayMode, state.pharmacyOverlayMode, state.pubOverlayMode, state.supermarketOverlayMode, state.listedBuildingOverlayMode, state.planningOverlayMode, state.holidayLetOverlayMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Use getLayer check rather than isStyleLoaded() — sources loading asynchronously
    // can cause isStyleLoaded() to return false even on a live map.
    if (!map.getLayer("cells-fill")) return;

    const ageMode = stateRef.current.ageOverlayMode ?? "off";
    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    const mode = state.voteOverlayMode ?? "off";
    const scale = state.voteColorScale ?? "relative";

    const crimeCellMode = stateRef.current.crimeCellMode ?? "off";
    const epcFuelMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const broadbandMode = stateRef.current.broadbandCellOverlayMode ?? "off";
    try {
      if (broadbandMode !== "off" || crimeCellMode !== "off" || epcFuelMode !== "off" || ageMode !== "off" || commuteMode !== "off") {
        // Higher-priority overlay takes precedence — no-op, let those effects handle it
      } else if (mode === "off") {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
      } else {
        applyVoteOverlayColorFromSource(map, scale);
      }
    } catch (e) {
      // ignore
    }
  }, [state.voteOverlayMode, state.voteColorScale, onLegendChange]);

  // Commute overlay: apply/remove commute distance colours on cells.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const commuteMode = state.commuteOverlayMode ?? "off";
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    const crimeCellMode = stateRef.current.crimeCellMode ?? "off";
    const epcFuelMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const broadbandMode = stateRef.current.broadbandCellOverlayMode ?? "off";
    try {
      if (broadbandMode !== "off" || crimeCellMode !== "off" || epcFuelMode !== "off") {
        // Higher-priority overlay takes precedence — no-op
      } else if (commuteMode !== "off") {
        applyCommuteOverlayColorExpression(map, easyColoursRef.current);
      } else if (voteMode !== "off") {
        applyVoteOverlayColorFromSource(map, stateRef.current.voteColorScale ?? "relative");
      } else {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
      }
    } catch (e) { /* ignore */ }
  }, [state.commuteOverlayMode, onLegendChange]);

  // Age overlay: apply/remove age distribution colours on cells.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const ageMode = state.ageOverlayMode ?? "off";
    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    const crimeCellMode = stateRef.current.crimeCellMode ?? "off";
    const epcFuelMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const broadbandMode = stateRef.current.broadbandCellOverlayMode ?? "off";
    try {
      if (broadbandMode !== "off" || crimeCellMode !== "off" || epcFuelMode !== "off") {
        // Higher-priority overlay takes precedence — no-op
      } else if (ageMode !== "off") {
        applyAgeOverlayColorExpression(map, easyColoursRef.current);
      } else if (commuteMode !== "off") {
        applyCommuteOverlayColorExpression(map, easyColoursRef.current);
      } else if (voteMode !== "off") {
        applyVoteOverlayColorFromSource(map, stateRef.current.voteColorScale ?? "relative");
      } else {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
      }
    } catch (e) { /* ignore */ }
  }, [state.ageOverlayMode, onLegendChange]);

  // Crime cell overlay: apply/remove crime density colours on cells.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const crimeMode = state.crimeCellMode ?? "off";
    const epcFuelMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const ageMode = stateRef.current.ageOverlayMode ?? "off";
    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    const broadbandMode = stateRef.current.broadbandCellOverlayMode ?? "off";
    try {
      if (broadbandMode !== "off") {
        // Broadband overlay takes precedence — no-op
      } else if (crimeMode !== "off") {
        applyCrimeCellOverlayColorExpression(map, state.crimeCellSubMode, state.crimeCellScale, easyColoursRef.current);
        onLegendChange?.(null); // hide house price legend while crime overlay is active
      } else if (epcFuelMode !== "off") {
        applyEpcFuelOverlayColorExpression(map, (stateRef.current.epcFuelType ?? "gas") as EpcFuelType, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (ageMode !== "off") {
        applyAgeOverlayColorExpression(map, easyColoursRef.current);
      } else if (commuteMode !== "off") {
        applyCommuteOverlayColorExpression(map, easyColoursRef.current);
      } else if (voteMode !== "off") {
        applyVoteOverlayColorFromSource(map, stateRef.current.voteColorScale ?? "relative");
      } else {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
      }
    } catch (e) { /* ignore */ }
  }, [state.crimeCellMode, state.crimeCellSubMode, state.crimeCellScale, onLegendChange]);

  // EPC heating fuel overlay: apply/remove fuel composition colours on cells.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const crimeMode = stateRef.current.crimeCellMode ?? "off";
    const epcFuelMode = state.epcFuelOverlayMode ?? "off";
    const ageMode = stateRef.current.ageOverlayMode ?? "off";
    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    const broadbandMode = stateRef.current.broadbandCellOverlayMode ?? "off";
    try {
      if (broadbandMode !== "off") {
        // Broadband overlay takes precedence — no-op
      } else if (crimeMode !== "off") {
        // Crime cell overlay takes priority — no-op
      } else if (epcFuelMode !== "off") {
        applyEpcFuelOverlayColorExpression(map, (stateRef.current.epcFuelType ?? "gas") as EpcFuelType, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (ageMode !== "off") {
        applyAgeOverlayColorExpression(map, easyColoursRef.current);
      } else if (commuteMode !== "off") {
        applyCommuteOverlayColorExpression(map, easyColoursRef.current);
      } else if (voteMode !== "off") {
        applyVoteOverlayColorFromSource(map, stateRef.current.voteColorScale ?? "relative");
      } else {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
      }
    } catch (e) { /* ignore */ }
  }, [state.epcFuelOverlayMode, state.epcFuelType, onLegendChange]);

  // Broadband cell overlay: apply/remove broadband speed/coverage colours on cells.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const broadbandMode = state.broadbandCellOverlayMode ?? "off";
    const metric = (state.broadbandCellMetric ?? "avg_speed") as BroadbandCellMetric;
    const crimeMode = stateRef.current.crimeCellMode ?? "off";
    const epcFuelMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const ageMode = stateRef.current.ageOverlayMode ?? "off";
    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    try {
      if (broadbandMode !== "off") {
        applyBroadbandCellOverlayColorExpression(map, metric, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (crimeMode !== "off") {
        applyCrimeCellOverlayColorExpression(map, stateRef.current.crimeCellSubMode, stateRef.current.crimeCellScale, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (epcFuelMode !== "off") {
        applyEpcFuelOverlayColorExpression(map, (stateRef.current.epcFuelType ?? "gas") as EpcFuelType, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (ageMode !== "off") {
        applyAgeOverlayColorExpression(map, easyColoursRef.current);
      } else if (commuteMode !== "off") {
        applyCommuteOverlayColorExpression(map, easyColoursRef.current);
      } else if (voteMode !== "off") {
        applyVoteOverlayColorFromSource(map, stateRef.current.voteColorScale ?? "relative");
      } else {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
      }
    } catch (e) { /* ignore */ }
  }, [state.broadbandCellOverlayMode, state.broadbandCellMetric, onLegendChange]);

  // Listed building cell overlay: apply/remove heritage density colours on cells.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const lbMode = state.listedBuildingCellOverlayMode ?? "off";
    const crimeMode = stateRef.current.crimeCellMode ?? "off";
    const epcFuelMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const ageMode = stateRef.current.ageOverlayMode ?? "off";
    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    const broadbandMode = stateRef.current.broadbandCellOverlayMode ?? "off";
    try {
      if (lbMode !== "off") {
        applyListedBuildingCellOverlayColorExpression(map);
        onLegendChange?.(null);
      } else if (broadbandMode !== "off") {
        applyBroadbandCellOverlayColorExpression(map, (stateRef.current.broadbandCellMetric ?? "avg_speed") as BroadbandCellMetric, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (crimeMode !== "off") {
        applyCrimeCellOverlayColorExpression(map, stateRef.current.crimeCellSubMode, stateRef.current.crimeCellScale, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (epcFuelMode !== "off") {
        applyEpcFuelOverlayColorExpression(map, (stateRef.current.epcFuelType ?? "gas") as EpcFuelType, easyColoursRef.current);
        onLegendChange?.(null);
      } else if (ageMode !== "off") {
        applyAgeOverlayColorExpression(map, easyColoursRef.current);
      } else if (commuteMode !== "off") {
        applyCommuteOverlayColorExpression(map, easyColoursRef.current);
      } else if (voteMode !== "off") {
        applyVoteOverlayColorFromSource(map, stateRef.current.voteColorScale ?? "relative");
      } else {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current, !!indexPrefsRef.current);
      }
    } catch (e) { /* ignore */ }
  }, [state.listedBuildingCellOverlayMode, onLegendChange]);

  // Re-apply colour ramps whenever the easy-colours (colourblind) preference changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const crimeMode = stateRef.current.crimeCellMode ?? "off";
    const epcFuelMode = stateRef.current.epcFuelOverlayMode ?? "off";
    const ageMode = stateRef.current.ageOverlayMode ?? "off";
    const commuteMode = stateRef.current.commuteOverlayMode ?? "off";
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    const broadbandMode = stateRef.current.broadbandCellOverlayMode ?? "off";
    if (broadbandMode !== "off") {
      applyBroadbandCellOverlayColorExpression(map, (stateRef.current.broadbandCellMetric ?? "avg_speed") as BroadbandCellMetric, easyColours ?? false);
    } else if ((stateRef.current.listedBuildingCellOverlayMode ?? "off") !== "off") {
      applyListedBuildingCellOverlayColorExpression(map); // no easy-colour variant needed
    } else if (crimeMode !== "off") {
      applyCrimeCellOverlayColorExpression(map, stateRef.current.crimeCellSubMode, stateRef.current.crimeCellScale, easyColours ?? false);
    } else if (epcFuelMode !== "off") {
      applyEpcFuelOverlayColorExpression(map, (stateRef.current.epcFuelType ?? "gas") as EpcFuelType, easyColours ?? false);
    } else if (ageMode !== "off") {
      applyAgeOverlayColorExpression(map, easyColours ?? false);
    } else if (commuteMode !== "off") {
      applyCommuteOverlayColorExpression(map, easyColours ?? false);
    } else if (voteMode !== "off") {
      return; // vote overlay controls its own fixed colours — no easy-colour variant
    } else {
      void ensureAggregatesAndUpdate(
        map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColours ?? false, !!indexPrefsRef.current
      );
    }
    // Also update overlay layer colours that were baked in at init time.
    if (map.getLayer("flood-overlay-fill")) {
      map.setPaintProperty("flood-overlay-fill", "fill-color", floodBandColorExpression(easyColours ?? false));
    }
    if (map.getLayer("flood-overlay-outline")) {
      map.setPaintProperty("flood-overlay-outline", "line-color", floodBandColorExpression(easyColours ?? false));
    }
    if (map.getLayer("school-overlay-points")) {
      map.setPaintProperty("school-overlay-points", "circle-color", schoolQualityColorExpression(easyColours ?? false));
    }
  }, [easyColours, onLegendChange]);

  // Note: metric changes already trigger setRealData (via deps below).
  // Avoid a separate recolor effect to prevent stale data/legend during rapid filter changes.

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {isLoading && (
        <div
          className="map-loading"
          style={{
            position: "absolute",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(10,12,20,0.82)",
            backdropFilter: "blur(4px)",
            color: "white",
            padding: "7px 18px",
            borderRadius: 99,
            fontSize: 13,
            zIndex: 3,
            pointerEvents: "none",
            whiteSpace: "nowrap",
        }}
      >
        ⏳ Loading {state.grid} cells…
      </div>
      )}
      <div
        id="median-overlay"
        className="median-overlay"
        style={{ display: "none" }}
      />
      {cellClickHint && (
        <div
          style={{
            position: "absolute",
            top: cellClickHint.y + 14,
            left: cellClickHint.x,
            transform: "translateX(-50%)",
            background: "rgba(15,15,30,0.92)",
            color: "white",
            padding: "7px 13px",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.4,
            zIndex: 10,
            pointerEvents: "none",
            whiteSpace: "normal",
            maxWidth: 190,
            textAlign: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          Right-click (or double-tap) for full area details
        </div>
      )}
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
        </div>
      )}
    </div>
  );
}

/** ---------------- Real data wiring ---------------- */

function voteOverlayFillColorExpression(scale: VoteColorScale = "relative") {
  const p = ["coalesce", ["to-number", ["get", "pct_progressive"]], 0] as any;
  const c = ["coalesce", ["to-number", ["get", "pct_conservative"]], 0] as any;
  const r = ["coalesce", ["to-number", ["get", "pct_popular_right"]], 0] as any;
  const o = ["max", 0, ["-", 1, ["+", p, c, r]]] as any;

  // Weighted axis per spec:
  // right = (2 * popular_right) + (1 * conservative)
  // left  = (2 * progressive) + (1 * other)
  // normalize to [-1, 1] by dividing by 2 (raw range is roughly [-2, 2])
  const weightedRaw = ["-", ["+", ["*", 2, p], o], ["+", ["*", 2, r], c]] as any;
  const weightedAbsoluteAxis = ["max", -1, ["min", 1, ["/", weightedRaw, 2]]] as any;
  const weightedRelativeAxis = [
    "max",
    -1,
    ["min", 1, ["-", ["*", 2, ["coalesce", ["to-number", ["get", "vote_rank_lr"]], 0.5]], 1]],
  ] as any;

  const leftRightAxis = scale === "relative" ? weightedRelativeAxis : weightedAbsoluteAxis;

  return [
    "interpolate",
    ["linear"],
    leftRightAxis,
    -1,
    "#0b1b5a",
    -0.75,
    "#1e3a8a",
    -0.5,
    "#60a5fa",
    -0.25,
    "#bfdbfe",
    0,
    "#f3f4f6",
    0.25,
    "#fecaca",
    0.5,
    "#ef4444",
    0.75,
    "#b91c1c",
    1,
    "#450a0a",
  ] as any;
}

/** Commute distance colour ramp.
 * Normal  : green (WFH/short) → yellow → orange → dark-red (long commute)
 * Easy/CBF: RdBu reversed — blue (short) → neutral → red-orange (long)
 */
function commuteDistanceColorExpression(easy = false): any {
  // Use ["case",["has",...]] so missing property → -1 (grey).
  // ["to-number", null] = 0 in MapLibre, defeating a plain coalesce.
  const dist = ["case", ["has", "mean_dist_km"], ["to-number", ["get", "mean_dist_km"]], -1] as any;
  if (easy) {
    // RdBu reversed (colour-blind safe)
    return ["interpolate", ["linear"], dist,
      -1,   "#aaaaaa",   // no data
       0,   "#2166ac",
       4,   "#92c5de",
       7,   "#f7f7f7",
      10,   "#f4a582",
      14,   "#d6604d",
      17,   "#b2182b",
    ];
  }
  return ["interpolate", ["linear"], dist,
    -1,   "#aaaaaa",   // no data
     0,   "#15803d",
     4,   "#86efac",
     7,   "#fef08a",
    10,   "#fb923c",
    14,   "#ef4444",
    17,   "#7f1d1d",
  ];
}

function applyCommuteOverlayColorExpression(map: maplibregl.Map, easy = false) {
  if (map.getLayer("cells-fill")) {
    map.setPaintProperty("cells-fill", "fill-color", commuteDistanceColorExpression(easy));
  }
}

/** Age score colour ramp.
 * age_score: 0 = oldest community, 1 = youngest community.
 * Normal  : dark-blue (old) → neutral → amber (young)
 * Easy/CBF: purple (old) → neutral → orange-red (young)
 */
function ageColorExpression(easy = false): any {
  const score = ["case", ["has", "age_score"], ["to-number", ["get", "age_score"]], -1] as any;
  if (easy) {
    return ["interpolate", ["linear"], score,
      -1,   "#aaaaaa",   // no data
       0,   "#762a83",   // oldest — purple
       0.25, "#af8dc3",
       0.5,  "#f7f7f7",  // national median
       0.75, "#d9f0a3",
       1,   "#1a7837",   // youngest — green
    ];
  }
  return ["interpolate", ["linear"], score,
    -1,   "#aaaaaa",   // no data
     0,   "#1e3a8a",   // oldest — dark blue
     0.25, "#60a5fa",
     0.5,  "#e5e7eb",  // national median
     0.75, "#fbbf24",
     1,   "#b45309",   // youngest — amber
  ];
}

function applyAgeOverlayColorExpression(map: maplibregl.Map, easy = false) {
  if (map.getLayer("cells-fill")) {
    map.setPaintProperty("cells-fill", "fill-color", ageColorExpression(easy));
  }
}

/** Crime-cell score colour ramp.
 * score: 0 = most dangerous, 100 = safest.
 * Normal  : dark-red (dangerous) → neutral grey → dark-green (safe)
 * Easy/CBF: purple (dangerous) → neutral → green (safe)
 */
function crimeCellColorExpression(subMode: CrimeCellSubMode | undefined, scale: CrimeCellScale | undefined, easy = false): any {
  const isLocal = scale === "relative";
  const field = subMode === "violent"  ? (isLocal ? "violent_local_score"  : "violent_score")
              : subMode === "property" ? (isLocal ? "property_local_score" : "property_score")
              : subMode === "asb"      ? (isLocal ? "asb_local_score"      : "asb_score")
              : (isLocal ? "crime_local_score" : "crime_score");
  const score = ["case", ["has", field], ["to-number", ["get", field]], -1] as any;
  if (easy) {
    return ["interpolate", ["linear"], score,
      -1,  "#aaaaaa",  // no data
       0,  "#762a83",  // most dangerous — purple
      25,  "#af8dc3",
      50,  "#f7f7f7",  // national median
      75,  "#d9f0a3",
     100,  "#1a7837",  // safest — green
    ];
  }
  return ["interpolate", ["linear"], score,
    -1,  "#aaaaaa",  // no data
     0,  "#7f1d1d",  // most dangerous — dark red
    25,  "#ef4444",
    50,  "#e5e7eb",  // national median
    75,  "#86efac",
   100,  "#15803d",  // safest — dark green
  ];
}

function applyCrimeCellOverlayColorExpression(map: maplibregl.Map, subMode: CrimeCellSubMode | undefined, scale: CrimeCellScale | undefined, easy = false) {
  if (map.getLayer("cells-fill")) {
    map.setPaintProperty("cells-fill", "fill-color", crimeCellColorExpression(subMode, scale, easy));
  }
}

/** EPC fuel overlay: colour cells by % of the selected heating fuel type.
 *  Low % → grey, high % → strong colour.
 */
function epcFuelColorExpression(fuelType: EpcFuelType, easy = false): any {
  // Realistic caps: gas peaks ~90%, electric ~50%, oil ~70%, lpg ~25%
  const configs: Record<EpcFuelType, { field: string; stops: [number, string][] }> = {
    gas: {
      field: "pct_gas",
      stops: easy
        ? [[0, "#dbeafe"], [30, "#93c5fd"], [60, "#3b82f6"], [90, "#1e40af"]]
        : [[0, "#bfdbfe"], [25, "#60a5fa"], [55, "#2563eb"], [90, "#1e3a8a"]],
    },
    electric: {
      field: "pct_electric",
      stops: easy
        ? [[0, "#fef3c7"], [15, "#fcd34d"], [30, "#f59e0b"], [50, "#b45309"]]
        : [[0, "#fde68a"], [15, "#f59e0b"], [30, "#d97706"], [50, "#92400e"]],
    },
    oil: {
      field: "pct_oil",
      stops: easy
        ? [[0, "#dcfce7"], [20, "#86efac"], [45, "#22c55e"], [70, "#15803d"]]
        : [[0, "#bbf7d0"], [20, "#4ade80"], [45, "#16a34a"], [70, "#14532d"]],
    },
    lpg: {
      field: "pct_lpg",
      stops: easy
        ? [[0, "#f3e8ff"], [8, "#c084fc"], [15, "#a855f7"], [25, "#6b21a8"]]
        : [[0, "#e9d5ff"], [8, "#a855f7"], [15, "#7e22ce"], [25, "#4c1d95"]],
    },
  };
  const { field, stops } = configs[fuelType];
  const pctExpr = ["to-number", ["get", field]] as any;
  const interpArgs: any[] = [];
  for (const [val, color] of stops) { interpArgs.push(val, color); }
  return ["case",
    ["has", field],
    ["interpolate", ["linear"], pctExpr, ...interpArgs],
    "#aaaaaa",
  ];
}

function applyEpcFuelOverlayColorExpression(map: maplibregl.Map, fuelType: EpcFuelType, easy = false) {
  if (map.getLayer("cells-fill")) {
    map.setPaintProperty("cells-fill", "fill-color", epcFuelColorExpression(fuelType, easy));
  }
}

/** Broadband cell overlay colour expressions.
 *  avg_speed: 0 Mb/s (red) → 30 (orange) → 100 (yellow) → 300+ (green)
 *  pct_sfbb / pct_fast: 0% (light grey) → 100% (teal/purple)
 */
function broadbandCellColorExpression(metric: BroadbandCellMetric, easy = false): any {
  if (metric === "avg_speed") {
    const speed = ["case", ["has", "bb_avg_speed"], ["to-number", ["get", "bb_avg_speed"]], -1] as any;
    if (easy) {
      return ["interpolate", ["linear"], speed,
        -1,   "#aaaaaa",
         0,   "#762a83",
        30,   "#af8dc3",
       100,   "#f7f7f7",
       300,   "#d9f0a3",
       500,   "#1a7837",
      ];
    }
    return ["interpolate", ["linear"], speed,
      -1,   "#aaaaaa",   // no data
       0,   "#7f1d1d",   // very slow — dark red
      30,   "#f97316",   // SFBB threshold — orange
     100,   "#fbbf24",   // ultrafast threshold — amber
     300,   "#4ade80",   // fibre threshold — light green
     500,   "#15803d",   // max — dark green
    ];
  }
  // pct_sfbb or pct_fast — 0–100%
  const field = metric === "pct_sfbb" ? "bb_pct_sfbb" : "bb_pct_fast";
  const pct = ["case", ["has", field], ["to-number", ["get", field]], -1] as any;
  if (metric === "pct_sfbb") {
    if (easy) {
      return ["interpolate", ["linear"], pct,
        -1,  "#aaaaaa",
         0,  "#fef3c7",
        50,  "#34d399",
       100,  "#065f46",
      ];
    }
    return ["interpolate", ["linear"], pct,
      -1,  "#aaaaaa",   // no data
       0,  "#fef9c3",   // 0% — pale yellow
      40,  "#22d3ee",   // 40% — cyan
      75,  "#0891b2",   // 75% — teal
     100,  "#164e63",   // 100% — dark teal
    ];
  }
  // pct_fast (≥300 Mbps, proxy for fibre/cable)
  if (easy) {
    return ["interpolate", ["linear"], pct,
      -1,  "#aaaaaa",
       0,  "#fef3c7",
      40,  "#c084fc",
      80,  "#7e22ce",
     100,  "#4c1d95",
    ];
  }
  return ["interpolate", ["linear"], pct,
    -1,  "#aaaaaa",   // no data
     0,  "#fef9c3",   // 0% — pale yellow
    30,  "#a78bfa",   // 30% — light purple
    70,  "#7c3aed",   // 70% — violet
   100,  "#4c1d95",   // 100% — dark purple
  ];
}

function applyBroadbandCellOverlayColorExpression(map: maplibregl.Map, metric: BroadbandCellMetric, easy = false) {
  if (map.getLayer("cells-fill")) {
    map.setPaintProperty("cells-fill", "fill-color", broadbandCellColorExpression(metric, easy));
  }
}

/* ── Listed building heritage density cell overlay ── */

function listedBuildingCellColorExpression(): any {
  // Prefer lb_density (weighted listed buildings per property, × 1000).
  // Fall back to lb_score (0–100 normalised) if density not available.
  // No data → transparent (hide the cell entirely).
  const densityPer1k = ["*", 1000, ["to-number", ["get", "lb_density"], 0]] as any;
  const densityStops = [
    "interpolate", ["linear"], densityPer1k,
     0,  "#fefce8",  // none
     2,  "#fde68a",  // low
     5,  "#f59e0b",  // moderate
    10,  "#b45309",  // medium
    30,  "#78350f",  // high
    80,  "#431407",  // very high
  ] as any;
  const score = ["to-number", ["get", "lb_score"], 0] as any;
  const fallbackStops = [
    "interpolate", ["linear"], score,
     0,  "#fefce8",
    20,  "#fde68a",
    40,  "#f59e0b",
    60,  "#b45309",
    80,  "#78350f",
   100,  "#431407",
  ] as any;
  return [
    "case",
    ["!", ["has", "lb_score"]], "rgba(0,0,0,0)",  // no heritage data → hide cell
    ["has", "lb_density"], densityStops,           // per-property density colouring
    fallbackStops,                                  // fallback: normalised score
  ];
}

function applyListedBuildingCellOverlayColorExpression(map: maplibregl.Map) {
  if (map.getLayer("cells-fill")) {
    map.setPaintProperty("cells-fill", "fill-color", listedBuildingCellColorExpression());
  }
}

function buildVoteScoreExpression(inputExpr: any, breaks: number[] | null) {
  if (!breaks) {
    return [
      "interpolate",
      ["linear"],
      inputExpr,
      0,
      0,
      10,
      0.2,
      20,
      0.4,
      30,
      0.6,
      40,
      0.8,
      55,
      1,
    ] as any;
  }

  return [
    "interpolate",
    ["linear"],
    inputExpr,
    breaks[0],
    0,
    breaks[1],
    0.2,
    breaks[2],
    0.4,
    breaks[3],
    0.6,
    breaks[4],
    0.8,
    breaks[5],
    1,
  ] as any;
}

function applyVoteOverlayColorFromSource(
  map: maplibregl.Map,
  scale: VoteColorScale,
  sourceData?: any
) {
  const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
  const fc = sourceData ?? (src ? (src as any)._data ?? null : null);
  if (scale === "relative" && fc) {
    const changed = ensureVoteRelativeRanks(fc);
    if (changed && src) {
      src.setData(fc as any);
    }
  }
  const expr = voteOverlayFillColorExpression(scale);
  if (map.getLayer("cells-fill")) {
    map.setPaintProperty("cells-fill", "fill-color", expr);
  }
}

function ensureVoteRelativeRanks(fc: any) {
  const features = (fc?.features ?? []) as any[];
  if (!features.length) return false;

  const hasAll = features.every((f) => Number.isFinite(Number(f?.properties?.vote_rank_lr)));
  if (hasAll) return false;

  const ranked: Array<{ index: number; value: number }> = [];
  for (let i = 0; i < features.length; i++) {
    const props = features[i]?.properties ?? {};
    const p = Number(props.pct_progressive ?? 0);
    const c = Number(props.pct_conservative ?? 0);
    const r = Number(props.pct_popular_right ?? 0);
    const pSafe = Number.isFinite(p) ? p : 0;
    const cSafe = Number.isFinite(c) ? c : 0;
    const rSafe = Number.isFinite(r) ? r : 0;
    const other = Math.max(0, 1 - (pSafe + cSafe + rSafe));
    const weightedRaw = (2 * pSafe + other) - (2 * rSafe + cSafe);
    ranked.push({ index: i, value: weightedRaw });
  }

  ranked.sort((a, b) => a.value - b.value);
  const denom = Math.max(1, ranked.length - 1);
  for (let pos = 0; pos < ranked.length; pos++) {
    const rank = pos / denom;
    const feature = features[ranked[pos].index];
    if (!feature.properties) feature.properties = {};
    feature.properties.vote_rank_lr = rank;
  }

  return true;
}

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

function floodBandColorExpression(easy = false) {
  if (easy) {
    // Colorblind-safe: blue scale for low risk, amber/brown scale for high risk (no red-green)
    return [
      "match",
      ["round", floodSeverityExpression()],
      0, "#74b9e0", // pale blue (very low risk)
      1, "#0066aa", // blue (low risk)
      2, "#e07b00", // amber (moderate risk)
      3, "#c04000", // dark orange (significant risk)
      4, "#5c1a00", // very dark brown (high risk)
      "#74b9e0",
    ] as any;
  }
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

function schoolQualityColorExpression(easy = false) {
  if (easy) {
    // PuOr diverging — colorblind-safe: dark brown (poor) → neutral grey → deep blue (excellent)
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "quality_score"]], 0.5],
      0,   "#7f3b08", // dark brown (very poor)
      0.2, "#b35806", // brown
      0.4, "#f1a340", // light orange
      0.5, "#f7f7f7", // neutral
      0.6, "#998ec3", // light purple
      0.8, "#542788", // purple
      1,   "#2d004b", // dark purple (excellent)
    ] as any;
  }
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", "quality_score"]], 0.5],
    0,
    "#7f1d1d",
    0.2,
    "#dc2626",
    0.4,
    "#f59e0b",
    0.5,
    "#f3f4f6",
    0.6,
    "#86efac",
    0.8,
    "#16a34a",
    1,
    "#14532d",
  ] as any;
}

async function setRealData(
  map: maplibregl.Map,
  state: MapState,
  cache: Map<string, any>,
  signal?: AbortSignal,
  onLegendChange?: (legend: LegendData | null) => void,
  onStatsUpdate?: ((stats: { label: string; value: string; txCount: number } | null) => void) | null,
  easy = false,
  indexScoringActive = false
): Promise<any> {
  // Determine if we're fetching delta or regular data
  const isDelta = isDeltaMetric(state.metric);
  const endpoint = isDelta ? "/api/deltas" : "/api/cells";

  const endMonth = isDelta ? undefined : state.endMonth ?? "LATEST";
  const fields = isDelta ? "full" : computeFieldsTier(state);
  const baseCacheKey = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth ?? "LATEST"}|${state.modelledMode ?? "blend"}|${VOTE_CELLS_DATA_VERSION}`;
  const cacheKey = `${baseCacheKey}|${fields}`;
  // For core requests: full data (a superset) is also fine to use from cache
  const cached = cache.get(cacheKey) ?? (fields === "core" ? cache.get(`${baseCacheKey}|full`) : undefined);
  if (cached) {
    const src = map.getSource("cells") as maplibregl.GeoJSONSource;
    src.setData(cached);
    if ((state.commuteOverlayMode ?? "off") !== "off") {
      applyCommuteOverlayColorExpression(map, easy);
    } else if ((state.voteOverlayMode ?? "off") !== "off") {
      applyVoteOverlayColorFromSource(map, state.voteColorScale ?? "relative", cached);
    }
    await ensureAggregatesAndUpdate(map, state, cache, onLegendChange, onStatsUpdate, easy, indexScoringActive);
    return cached;
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
    qs.set("metric", state.metric);
    qs.set("endMonth", endMonth!);
    if (state.grid === "1mile") {
      qs.set("modelled", state.modelledMode ?? "blend");
    }
    qs.set("fields", fields);
  }
  qs.set("voteDataVersion", VOTE_CELLS_DATA_VERSION);

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
  if ((state.commuteOverlayMode ?? "off") !== "off") {
    applyCommuteOverlayColorExpression(map, easy);
  } else if ((state.voteOverlayMode ?? "off") !== "off") {
    applyVoteOverlayColorFromSource(map, state.voteColorScale ?? "relative", fc);
  }
  await ensureAggregatesAndUpdate(map, state, cache, onLegendChange, onStatsUpdate, easy, indexScoringActive);
  return fc;
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
// Brown-Blue-Green (BrBG) diverging — safe for all common colorblindness types
const DELTA_COLORS_CBF = ["#543005", "#bf812d", "#dfc27d", "#f5f5f5", "#80cdc1", "#35978f", "#003c30"];
const DELTA_STOP_WEIGHTS = [-1, -0.5, -0.2, 0, 0.2, 0.5, 1];

async function ensureAggregatesAndUpdate(
  map: maplibregl.Map,
  state: MapState,
  cache: Map<string, any>,
  onLegendChange?: (legend: LegendData | null) => void,
  onStatsUpdate?: ((stats: { label: string; value: string; txCount: number } | null) => void) | null,
  easy = false,
  indexScoringActive = false
) {
  try {
    const voteModeActive = (state.voteOverlayMode ?? "off") !== "off";
    const commuteModeActive = (state.commuteOverlayMode ?? "off") !== "off";
    const ageModeActive = (state.ageOverlayMode ?? "off") !== "off";
    const overlayActive = voteModeActive || commuteModeActive || ageModeActive || indexScoringActive;
    // For delta metrics, apply simple linear color mapping (quantiles can be complex with diverging data)
    const isDelta = isDeltaMetric(state.metric);
    if (isDelta) {
      const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
      const srcData: any = src ? (src as any)._data ?? null : null;
      const stats = computeMinMax(srcData, state.metric as "delta_gbp" | "delta_pct");
      const fallbackMaxAbs = state.metric === "delta_pct" ? 30 : 300000;
      const maxAbs = stats ? Math.max(Math.abs(stats.min), Math.abs(stats.max)) : 0;
      const safeMaxAbs = maxAbs > 0 ? maxAbs : fallbackMaxAbs;
      const stops = buildDeltaStops(safeMaxAbs);
      const colors = easy ? DELTA_COLORS_CBF : DELTA_COLORS;
      const expr = buildDeltaColorExpression(state.metric, stops, colors);

      if (!overlayActive && map.getLayer("cells-fill")) {
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
    const key25 = `25km|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth}|${state.modelledMode ?? "blend"}|${VOTE_CELLS_DATA_VERSION}`;
    let fc25 = cache.get(`${key25}|full`) ?? cache.get(`${key25}|core`);

    if (!fc25) {
      const qs25 = new URLSearchParams({
        grid: "25km",
        propertyType: state.propertyType ?? "ALL",
        newBuild: state.newBuild ?? "ALL",
        metric: state.metric,
        endMonth: endMonth,
      });
      qs25.set("voteDataVersion", VOTE_CELLS_DATA_VERSION);

      try {
        const res25 = await fetch(`/api/cells?${qs25.toString()}`);
        if (res25.ok) {
          const payload25: any = await res25.json();
          const rows25: ApiRow[] = Array.isArray(payload25) ? payload25 : payload25.rows;
          if (Array.isArray(rows25)) {
            fc25 = rowsToGeoJsonSquares(rows25, gridToMeters("25km"));
            cache.set(`${key25}|full`, fc25);
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
      updateOverlayFromFeatureCollection(map, fc25, state.metric, onStatsUpdate);
    } else {
      // fallback: use any available featurecollection (current map source)
      try {
        const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
        const data: any = src ? (src as any)._data ?? null : null;
        if (data) updateOverlayFromFeatureCollection(map, data, state.metric, onStatsUpdate);
      } catch (e) {
        // ignore
      }
    }

    // 2) ensure current-grid aggregate for colour breaks (per-grid deciles)
    const keyCur = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth}|${state.modelledMode ?? "blend"}|${VOTE_CELLS_DATA_VERSION}`;
    let fcCur = cache.get(`${keyCur}|full`) ?? cache.get(`${keyCur}|core`);

    if (!fcCur) {
      // try to reuse the current map source data before fetching
      try {
        const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
        const srcData: any = src ? (src as any)._data ?? null : null;
        if (srcData && Array.isArray(srcData.features) && srcData.features.length > 0) {
          fcCur = srcData;
          cache.set(`${keyCur}|full`, fcCur);
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
        metric: state.metric,
        endMonth: endMonth,
      });
      qsCur.set("voteDataVersion", VOTE_CELLS_DATA_VERSION);

      try {
        const resCur = await fetch(`/api/cells?${qsCur.toString()}`);
        if (resCur.ok) {
          const payloadCur: any = await resCur.json();
          const rowsCur: ApiRow[] = Array.isArray(payloadCur) ? payloadCur : payloadCur.rows;
          if (Array.isArray(rowsCur)) {
            fcCur = rowsToGeoJsonSquares(rowsCur, gridToMeters(state.grid));
            cache.set(`${keyCur}|full`, fcCur);
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

      const effectiveMedianExpr = [
        "case",
        ["all", ["<", ["get", "tx_count"], 3], [">", ["coalesce", ["get", "estimated_median"], 0], 0]],
        ["get", "estimated_median"],
        ["get", "median"],
      ];
      const colorMetric: string | any[] = metricPropName(state.metric) === "median" ? effectiveMedianExpr : metricPropName(state.metric);

      if (breaks && breaks.length > 0 && breaks.every((v) => Number.isFinite(v)) && hasVariance(breaks)) {
        const colors = makeTailColors(easy);
        const safeBreaks = ensureStrictlyIncreasingBreaks(breaks);
        const expr = buildTailColorExpression(colorMetric, safeBreaks, colors, true);
        if (!overlayActive && map.getLayer("cells-fill")) {
          map.setPaintProperty("cells-fill", "fill-color", expr);
        }
        if (onLegendChange) {
          onLegendChange({ kind: "median", breaks: safeBreaks, colors, probs: QUANTILE_PROBS });
        }
      } else {
        const colors = makeTailColors(easy);
        const stats = computeMinMax(sourceFc, state.metric);
        if (stats) {
          const linearBreaks = ensureStrictlyIncreasingBreaks(
            buildLinearBreaks(stats.min, stats.max, QUANTILE_PROBS.length)
          );
          const expr = buildTailColorExpression(colorMetric, linearBreaks, colors, true);
          if (!overlayActive && map.getLayer("cells-fill")) {
            map.setPaintProperty("cells-fill", "fill-color", expr);
          }
          if (onLegendChange) {
            onLegendChange({ kind: "median", breaks: linearBreaks, colors, probs: QUANTILE_PROBS });
          }
        } else {
          if (!overlayActive && map.getLayer("cells-fill")) {
            map.setPaintProperty("cells-fill", "fill-color", getFillColorExpression(state.metric, easy));
          }
          if (onLegendChange) {
            onLegendChange(null);
          }
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

function computeWeightedQuantiles(fc: any, metric: Metric, probs: number[]) {
  const features = (fc?.features ?? []) as any[];
  const values: Array<{v: number; w: number}> = [];
  const metricProp = metricPropName(metric);

  for (const f of features) {
    const p = f.properties || {};
    let raw: number;
    if (metricProp === "median" && Number(p.tx_count ?? 0) < 3 && p.estimated_median != null && Number(p.estimated_median) > 0) {
      raw = Number(p.estimated_median);
    } else {
      raw = Number(p[metricProp] ?? NaN);
    }
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

function computeMinMax(fc: any, metric: Metric | "median" | "delta_gbp" | "delta_pct") {
  const features = (fc?.features ?? []) as any[];
  let min = Infinity;
  let max = -Infinity;
  const metricProp = metricPropName(metric as Metric);

  for (const f of features) {
    const p = f.properties || {};
    const raw = Number(p[metricProp] ?? NaN);
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

function ensureStrictlyIncreasingBreaks(breaks: number[]) {
  if (!Array.isArray(breaks) || breaks.length === 0) return breaks;
  const adjusted: number[] = [];
  const EPS = 1e-9;

  for (let i = 0; i < breaks.length; i++) {
    const raw = Number(breaks[i]);
    if (!Number.isFinite(raw)) {
      adjusted.push(i === 0 ? 0 : adjusted[i - 1] + EPS);
      continue;
    }
    if (i === 0) {
      adjusted.push(raw);
      continue;
    }
    adjusted.push(raw <= adjusted[i - 1] ? adjusted[i - 1] + EPS : raw);
  }

  return adjusted;
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

function buildTailColorExpression(metric: string | any[], breaks: number[], colors: string[], useLog = false) {
  // build a step expression: start with color for values < first threshold
  const rawInput = typeof metric === "string" ? ["get", metric] : metric;
  const input = useLog ? ["ln", ["max", rawInput, 1]] : rawInput;
  const expr: any[] = ["step", input, colors[0]];
  // push threshold,value pairs for remaining colors
  for (let i = 1; i < breaks.length && i < colors.length; i++) {
    const value = useLog ? Math.log(Math.max(breaks[i], 1)) : breaks[i];
    expr.push(value);
    expr.push(colors[i]);
  }
  return expr as any;
}

function makeTailColors(easy = false) {
  if (easy) {
    // Viridis palette — perceptually uniform, colorblind-safe (dark purple = cheap, bright yellow = expensive)
    const bottom = ["#440154","#471365","#482374","#433381","#3b4b8c"];
    const middle = [
      "#325a8e","#2a698e","#24768e","#1f858e","#1d948c",
      "#1ea287","#27b07e","#3dbc74","#5bc563","#7fce52",
    ];
    const top = ["#a8d741","#c9df32","#dfe329","#f0ec26","#fde725"];
    return [...bottom, ...middle, ...top];
  }
  // bottom tail (5 steps), middle (10), top tail (5)
  const bottom = ["#366ca1","#236686","#16799a","#2aa3c6","#58c7e6"];
  const middle = [
    "#00ccbc","#6dd2a8","#bfeaa3","#ffffbf","#fee08b",
    "#fdae61","#f07a4a","#e04d3b","#d73027","#b30015",
  ];
  const top = ["#3a0480", "#39235b", "#241048", "#140534", "#010001"];
  return [...bottom, ...middle, ...top];
}

function updateOverlayFromFeatureCollection(
  map: maplibregl.Map,
  fc: any,
  metric: Metric,
  onStats?: ((stats: { label: string; value: string; txCount: number } | null) => void) | null
) {
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
    const metricLabel = isDeltaMetric(metric)
      ? "Weighted value"
      : metric === "median_ppsf"
        ? "Weighted median PPSF"
        : "Weighted median";
    const metricLabelHtml = escapeHtml(metricLabel);
    let html = `<div style="font-weight:700">${metricLabelHtml}: N/A</div>`;
    if (sumW > 0) {
      const avg = Math.round(sumWX / sumW);
      const val = metric === "median_ppsf"
        ? `GBP ${avg.toLocaleString()} / ft²`
        : `GBP ${avg.toLocaleString()}`;
      const valHtml = escapeHtml(val);
      html = `<div style="font-weight:700">${metricLabelHtml}: ${valHtml}</div>`;
      html += `<div style="margin-top:4px">Transactions: <b>${sumW.toLocaleString()}</b></div>`;
      onStats?.({ label: metricLabel, value: val, txCount: sumW });
    } else {
      html += `<div style="margin-top:4px">Transactions: <b>0</b></div>`;
      onStats?.({ label: metricLabel, value: "N/A", txCount: 0 });
    }

    if (el) el.innerHTML = html;
  } catch (e) {
    // don't throw; overlay is purely UI
    // eslint-disable-next-line no-console
    console.error("updateOverlayFromFeatureCollection failed", e);
  }
}

function gridToMeters(grid: "1mile" | "5km" | "10km" | "25km") {
  switch (grid) {
    case "1mile": return 1600;
    case "5km": return 5000;
    case "10km": return 10000;
    case "25km": return 25000;
  }
}

function buildValueFilter(state: MapState) {
  const mode = state.valueFilterMode ?? "off";
  if (mode === "off" || mode === undefined) return null;
  const op = mode === "lte" ? "<=" : ">=";

  // If a cell colour overlay is active, filter on the overlay metric
  const overlayField = getActiveCellOverlayFilterField(state);
  if (overlayField) {
    const raw = state.overlayFilterThreshold;
    if (!Number.isFinite(raw)) return null;
    let threshold = overlayField.divisor ? raw! / overlayField.divisor : raw!;
    // invert: field is reversed vs slider (e.g. age_score 0=old, 1=young but slider means "older")
    const effectiveOp = overlayField.invert ? (op === "<=" ? ">=" : "<=") : op;
    if (overlayField.invert) threshold = 1 - threshold;
    // Exclude cells with no data for this overlay field (don't coalesce to 0)
    return ["all",
      ["!=", ["get", overlayField.field], null],
      [effectiveOp, ["get", overlayField.field], threshold],
    ] as any;
  }

  // Default: house price / metric filter
  const threshold = state.valueThreshold;
  if (!Number.isFinite(threshold)) return null;
  const prop = metricPropName(state.metric);
  return [op, ["coalesce", ["get", prop], 0], threshold] as any;
}

// For "top_pct" mode: given a percentile (0.01 = top 1%), return the absolute score
// threshold at the (1-pct) quantile of the most-recently-scored distribution.
// Returns null if no scoring run has completed yet — callers must handle this.
function computeRelativeThreshold(topPct: number): number | null {
  const scores = _indexSortedScores;
  if (!scores || !scores.length) return null;
  // top X%: threshold = score at the (1-pct) quantile, i.e. score >= threshold keeps the top X%
  const idx = Math.floor((1 - topPct) * scores.length);
  return scores[Math.min(idx, scores.length - 1)] ?? 0;
}

// For "bottom %" presets: return the score at the bottomPct-th quantile from the low end.
// score <= result keeps only the bottom X% of cells.
function computeBottomThreshold(bottomPct: number): number | null {
  const scores = _indexSortedScores;
  if (!scores || !scores.length) return null;
  // bottom X%: threshold = score at the pct-th quantile from the bottom
  const idx = Math.floor(bottomPct * scores.length);
  return scores[Math.min(idx, scores.length - 1)] ?? 0;
}

function buildIndexFilter(indexPrefs: IndexPrefs | null | undefined) {
  if (!indexPrefs) return null;
  const mode = indexPrefs.indexFilterMode ?? "off";
  if (mode === "off") return null;
  const hasRegions = (indexPrefs.regionBboxes?.length ?? 0) > 0;
  const score = ["coalesce", ["get", "index_score"], 0] as any;
  // When regions are active, cells outside the bbox are tagged ix_oor=1.
  // Always exclude those regardless of sub-mode so only cells within the selected
  // areas (and their 10 km buffer) are ever visible.
  const inRegion = hasRegions
    ? (["!=", ["coalesce", ["get", "ix_oor"], 0], 1] as any)
    : null;

  if (mode === "area_only") {
    // Show ALL in-region scored cells, including 0-score (very poor) ones.
    // score > -0.5 excludes -1 (no data) but includes 0 (poor match).
    const hasScore = [">", score, -0.5] as any;
    return inRegion ? ["all", inRegion, hasScore] as any : hasScore;
  }

  const threshold = Math.max(0, Math.min(1, Number(indexPrefs.indexFilterThreshold ?? 0.6)));
  const op = mode === "lte" ? "<=" : ">=";
  const rawScore = ["get", "index_score"] as any;
  // For lte (weak areas / bottom %), also require score >= 0 to exclude -1 (no-data) cells
  const rangeFilter = mode === "lte"
    ? (["all", [">=", rawScore, 0], [op, rawScore, threshold]] as any)
    : ([op, score, threshold] as any);
  if (inRegion) return ["all", inRegion, rangeFilter] as any;
  return rangeFilter;
}

function applyCombinedCellFilters(
  map: maplibregl.Map,
  state: MapState,
  indexPrefs: IndexPrefs | null | undefined
) {
  // For relative (top_pct) mode, look up the absolute score threshold from the
  // cached sorted scores and translate to a standard gte filter.
  // If computeRelativeThreshold returns null (no scoring run yet), fall back to
  // showing all scored cells rather than filtering incorrectly.
  let effectivePrefs = indexPrefs;
  if (indexPrefs?.indexFilterMode === "top_pct") {
    const topPct = Math.max(0.001, Math.min(1, indexPrefs.indexFilterThreshold ?? 0.1));
    const absThreshold = computeRelativeThreshold(topPct);
    if (absThreshold === null) {
      // No scoring run completed yet — show all scored cells as fallback
      effectivePrefs = { ...indexPrefs, indexFilterMode: "area_only" };
    } else {
      effectivePrefs = { ...indexPrefs, indexFilterMode: "gte", indexFilterThreshold: absThreshold };
    }
  }

  const valueFilter = buildValueFilter(state);
  const indexFilter = buildIndexFilter(effectivePrefs);
  const combinedFilter = valueFilter && indexFilter
    ? (["all", valueFilter, indexFilter] as any)
    : (valueFilter ?? indexFilter);

  if (map.getLayer("cells-fill")) {
    map.setFilter("cells-fill", combinedFilter as any);
  }
  if (map.getLayer("cells-outline")) {
    map.setFilter("cells-outline", combinedFilter as any);
  }
  if (map.getLayer("cells-no-sales")) {
    const noSalesBase: any = ["==", ["get", "tx_count"], 0];
    const noSalesFilter = combinedFilter ? (["all", noSalesBase, combinedFilter] as any) : noSalesBase;
    map.setFilter("cells-no-sales", noSalesFilter as any);
  }
}

function applyValueFilter(map: maplibregl.Map, state: MapState, indexPrefs?: IndexPrefs | null) {
  applyCombinedCellFilters(map, state, indexPrefs ?? null);
}

function buildIndexScoringSignature(prefs: IndexPrefs) {
  return [
    prefs.budget,
    prefs.propertyType,
    prefs.affordWeight,
    prefs.floodWeight,
    prefs.schoolWeight,
    prefs.primarySchoolWeight ?? 0,
    prefs.trainWeight,
    prefs.trainMaxDistMiles ?? 0,
    prefs.ageWeight ?? 0,
    prefs.ageDirection ?? "young",
    prefs.crimeWeight ?? 0,
    prefs.epcFuelWeight ?? 0,
    prefs.epcFuelPreference ?? "gas",
    prefs.broadbandWeight ?? 0,
    prefs.busWeight ?? 0,
    prefs.pharmacyWeight ?? 0,
    prefs.pubWeight ?? 0,
    prefs.supermarketWeight ?? 0,
    // Region bboxes must be included so changing the area always triggers a full rescore
    JSON.stringify(prefs.regionBboxes ?? []),
    prefs.forceToken ?? 0,
  ].join("|");
}

/* ─── Index "Find My Area" scoring ─── */

// Module-level cache for overlay data + spatial grid indexes (built once per session)
let _indexFloodCache: Array<{ lon: number; lat: number; riskScore: number }> | null = null;
let _indexSchoolCache: Array<{ lon: number; lat: number; qualityScore: number; isGood: boolean; schoolName: string; urn: string }> | null = null;
let _indexStationCache: Array<{ lon: number; lat: number; name: string; code: string }> | null = null;
let _indexCellsCache: { key: string; lookup: Map<string, number> } | null = null;

// Delta data cache — keyed by grid (5km/10km/25km), lazily fetched on first right-click
let _deltasCache: Map<string, { delta_pct: number; delta_gbp: number }> | null = null;
let _deltasCacheGrid: string | null = null;

type SpatialGrid<T> = { buckets: Map<number, T[]>; cellSize: number };
let _indexFloodGrid: SpatialGrid<{ lon: number; lat: number; riskScore: number }> | null = null;
let _indexSchoolGrid: SpatialGrid<{ lon: number; lat: number; qualityScore: number; isGood: boolean; schoolName: string; urn: string }> | null = null;
let _indexStationGrid: SpatialGrid<{ lon: number; lat: number; name: string; code: string }> | null = null;
let _indexPrimarySchoolCache: Array<{ lon: number; lat: number; ofstedGrade: number; name: string; urn: string }> | null = null;
let _indexPrimarySchoolGrid: SpatialGrid<{ lon: number; lat: number; ofstedGrade: number; name: string; urn: string }> | null = null;
let _indexCrimeCache: Array<{ lon: number; lat: number; lsoa_code: string; lsoa_name: string; crime_score: number; violent_score: number; property_score: number; asb_score: number; total_rate: number }> | null = null;
let _indexCrimeGrid: SpatialGrid<{ lon: number; lat: number; lsoa_code: string; lsoa_name: string; crime_score: number; violent_score: number; property_score: number; asb_score: number; total_rate: number }> | null = null;
let _indexBusStopCache: Array<{ lon: number; lat: number; name: string; atco_code: string }> | null = null;
let _indexBusStopGrid: SpatialGrid<{ lon: number; lat: number; name: string; atco_code: string }> | null = null;
let _indexMetroTramCache: Array<{ lon: number; lat: number; name: string; stop_type: string }> | null = null;
let _indexMetroTramGrid: SpatialGrid<{ lon: number; lat: number; name: string; stop_type: string }> | null = null;
let _indexPharmacyCache: Array<{ lon: number; lat: number; name: string; ods_code: string }> | null = null;
let _indexPharmacyGrid: SpatialGrid<{ lon: number; lat: number; name: string; ods_code: string }> | null = null;
let _indexPubCache: Array<{ lon: number; lat: number; name: string; amenity: string }> | null = null;
let _indexPubGrid: SpatialGrid<{ lon: number; lat: number; name: string; amenity: string }> | null = null;
let _indexSupermarketCache: Array<{ lon: number; lat: number; name: string; shop: string }> | null = null;
let _indexSupermarketGrid: SpatialGrid<{ lon: number; lat: number; name: string; shop: string }> | null = null;
// Sorted index_score values from the most recent scoring run, used by computeRelativeThreshold.
// Built immediately after scoring so we never have to re-read src._data (which MapLibre may have
// already handed off to its worker before we read it back).
let _indexSortedScores: number[] | null = null;

function buildSpatialGrid<T extends { lon: number; lat: number }>(points: T[], cellSize: number): SpatialGrid<T> {
  const buckets = new Map<number, T[]>();
  for (const p of points) {
    const bx = Math.floor(p.lon / cellSize) + 100; // +100 offset handles negative UK longitudes
    const by = Math.floor(p.lat / cellSize);
    const key = bx * 1000 + by;
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push(p);
  }
  return { buckets, cellSize };
}

function querySpatialGrid<T extends { lon: number; lat: number }>(
  { buckets, cellSize }: SpatialGrid<T>,
  cLon: number, cLat: number, radiusDeg: number
): T[] {
  const results: T[] = [];
  const bx0 = Math.floor((cLon - radiusDeg) / cellSize) + 100;
  const bx1 = Math.floor((cLon + radiusDeg) / cellSize) + 100;
  const by0 = Math.floor((cLat - radiusDeg) / cellSize);
  const by1 = Math.floor((cLat + radiusDeg) / cellSize);
  for (let bx = bx0; bx <= bx1; bx++) {
    for (let by = by0; by <= by1; by++) {
      const b = buckets.get(bx * 1000 + by);
      if (b) for (const p of b) results.push(p);
    }
  }
  return results;
}

async function applyIndexScoring(
  map: maplibregl.Map,
  prefs: IndexPrefs,
  state: MapState,
  cellFc?: any
): Promise<boolean> {
  const src = map.getSource("cells") as maplibregl.GeoJSONSource | undefined;
  if (!src) return false;

  const fc: any = cellFc ?? (src as any)._data ?? null;
  if (!fc || !Array.isArray(fc.features) || fc.features.length === 0) return false;

  // ─── Hoist weights / key constants needed inside the parallel loaders ────
  const busW = prefs.busWeight ?? 0;
  const pharmW = prefs.pharmacyWeight ?? 0;
  const pubW = prefs.pubWeight ?? 0;
  const smktW = prefs.supermarketWeight ?? 0;
  const metricProp = metricPropName(state.metric);
  const indexPT = prefs.propertyType ?? "ALL";

  // ─── Parallel data load ───────────────────────────────────────────────────
  // All fetches are kicked off simultaneously so cold-cache startup time is
  // bounded by the single slowest endpoint rather than the sequential sum of
  // all of them (previously up to 8 sequential round-trips on first use).
  const loaders: Promise<void>[] = [];
  const ptRef = { lookup: null as Map<string, number> | null };

  if (_indexFloodCache === null) {
    loaders.push((async () => {
      try {
        const res = await fetch("/api/flood?plain=1");
        if (res.ok) {
          const payload = (await res.json()) as any;
          _indexFloodCache = (Array.isArray(payload?.features) ? payload.features : [])
            .filter((f: any) => f?.geometry?.type === "Point")
            .map((f: any) => ({
              lon: Number(f.geometry.coordinates[0]),
              lat: Number(f.geometry.coordinates[1]),
              riskScore: Number(f.properties?.risk_score ?? 0) || 0,
            }));
        } else {
          _indexFloodCache = [];
        }
      } catch {
        _indexFloodCache = [];
      }
      _indexFloodGrid = null;
    })());
  }

  if (_indexSchoolCache === null) {
    loaders.push((async () => {
      try {
        const res = await fetch("/api/schools?plain=1");
        if (res.ok) {
          const payload = (await res.json()) as any;
          _indexSchoolCache = (Array.isArray(payload?.features) ? payload.features : [])
            .filter((f: any) => f?.geometry?.type === "Point")
            .map((f: any) => ({
              lon: Number(f.geometry.coordinates[0]),
              lat: Number(f.geometry.coordinates[1]),
              qualityScore: Number(f.properties?.quality_score ?? 0.5) || 0.5,
              isGood: Boolean(f.properties?.is_good),
              schoolName: String(f.properties?.school_name ?? ""),
              urn: String(f.properties?.urn ?? ""),
            }));
        } else {
          _indexSchoolCache = [];
        }
      } catch {
        _indexSchoolCache = [];
      }
      _indexSchoolGrid = null;
    })());
  }

  if (_indexPrimarySchoolCache === null) {
    loaders.push((async () => {
      try {
        const res = await fetch("/api/schools?key=primary_school_overlay_points.geojson.gz&plain=1");
        if (res.ok) {
          const payload = (await res.json()) as any;
          _indexPrimarySchoolCache = (Array.isArray(payload?.features) ? payload.features : [])
            .filter((f: any) => f?.geometry?.type === "Point")
            .map((f: any) => ({
              lon: Number(f.geometry.coordinates[0]),
              lat: Number(f.geometry.coordinates[1]),
              ofstedGrade: Number(f.properties?.ofsted_grade ?? 0),
              name: String(f.properties?.name ?? ""),
              urn: String(f.properties?.urn ?? ""),
            }));
        } else {
          _indexPrimarySchoolCache = [];
        }
      } catch {
        _indexPrimarySchoolCache = [];
      }
      _indexPrimarySchoolGrid = null;
    })());
  }

  if (_indexStationCache === null) {
    loaders.push((async () => {
      try {
        const res = await fetch("/api/stations?plain=1");
        if (res.ok) {
          const payload = (await res.json()) as any;
          _indexStationCache = (Array.isArray(payload?.features) ? payload.features : [])
            .filter((f: any) => f?.geometry?.type === "Point")
            .map((f: any) => ({
              lon: Number(f.geometry.coordinates[0]),
              lat: Number(f.geometry.coordinates[1]),
              name: String(f.properties?.name ?? ""),
              code: String(f.properties?.code ?? ""),
            }));
          _indexStationGrid = null;
        }
        // else: leave null → retry on next applyIndexScoring call
      } catch {
        // leave null → retry on next applyIndexScoring call
      }
    })());
  }

  if (busW > 0) {
    if (_indexBusStopCache === null) {
      loaders.push((async () => {
        try {
          const res = await fetch("/api/bus-stops?plain=1");
          if (res.ok) {
            const payload = (await res.json()) as any;
            _indexBusStopCache = (Array.isArray(payload?.features) ? payload.features : [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), atco_code: String(f.properties?.atco_code ?? "") }));
            _indexBusStopGrid = null;
          } else { _indexBusStopCache = []; }
        } catch { _indexBusStopCache = []; }
      })());
    }
    if (_indexMetroTramCache === null) {
      loaders.push((async () => {
        try {
          const res = await fetch("/api/bus-stops?key=metro_tram_overlay_points.geojson.gz&plain=1");
          if (res.ok) {
            const payload = (await res.json()) as any;
            _indexMetroTramCache = (Array.isArray(payload?.features) ? payload.features : [])
              .filter((f: any) => f?.geometry?.type === "Point")
              .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), stop_type: String(f.properties?.stop_type ?? "") }));
            _indexMetroTramGrid = null;
          } else { _indexMetroTramCache = []; }
        } catch { _indexMetroTramCache = []; }
      })());
    }
  }

  if (pharmW > 0 && _indexPharmacyCache === null) {
    loaders.push((async () => {
      try {
        const res = await fetch("/api/pharmacies?plain=1");
        if (res.ok) {
          const payload = (await res.json()) as any;
          _indexPharmacyCache = (Array.isArray(payload?.features) ? payload.features : [])
            .filter((f: any) => f?.geometry?.type === "Point")
            .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), ods_code: String(f.properties?.ods_code ?? "") }));
          _indexPharmacyGrid = null;
        } else { _indexPharmacyCache = []; }
      } catch { _indexPharmacyCache = []; }
    })());
  }

  if (pubW > 0 && _indexPubCache === null) {
    loaders.push((async () => {
      try {
        const res = await fetch("/api/pubs?plain=1");
        if (res.ok) {
          const payload = (await res.json()) as any;
          _indexPubCache = (Array.isArray(payload?.features) ? payload.features : [])
            .filter((f: any) => f?.geometry?.type === "Point")
            .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), amenity: String(f.properties?.amenity ?? "pub") }));
          _indexPubGrid = null;
        } else { _indexPubCache = []; }
      } catch { _indexPubCache = []; }
    })());
  }

  if (smktW > 0 && _indexSupermarketCache === null) {
    loaders.push((async () => {
      try {
        const res = await fetch("/api/supermarkets?plain=1");
        if (res.ok) {
          const payload = (await res.json()) as any;
          _indexSupermarketCache = (Array.isArray(payload?.features) ? payload.features : [])
            .filter((f: any) => f?.geometry?.type === "Point")
            .map((f: any) => ({ lon: Number(f.geometry.coordinates[0]), lat: Number(f.geometry.coordinates[1]), name: String(f.properties?.name ?? ""), shop: String(f.properties?.shop ?? "supermarket") }));
          _indexSupermarketGrid = null;
        } else { _indexSupermarketCache = []; }
      } catch { _indexSupermarketCache = []; }
    })());
  }

  // — Affordability cells: also kicked off in parallel —
  const isDelta = isDeltaMetric(state.metric);
  const endpoint = isDelta ? "/api/deltas" : "/api/cells";
  const endMonth = isDelta ? undefined : state.endMonth ?? "LATEST";
  const ptKey = `${state.grid}|${indexPT}|${state.newBuild}|${state.metric}|${endMonth ?? "LATEST"}`;
  if (prefs.affordWeight > 0) {
    if (_indexCellsCache?.key === ptKey) {
      ptRef.lookup = _indexCellsCache.lookup;
    } else {
      loaders.push((async () => {
        try {
          const qs = new URLSearchParams({ grid: state.grid, propertyType: indexPT, newBuild: state.newBuild ?? "ALL" });
          if (!isDelta) { qs.set("metric", state.metric); qs.set("endMonth", endMonth!); }
          const res = await fetch(`${endpoint}?${qs.toString()}`);
          if (res.ok) {
            const payload = (await res.json()) as any;
            const rows: any[] = Array.isArray(payload?.features) ? payload.features : (Array.isArray(payload?.rows) ? payload.rows : []);
            const lookup = new Map<string, number>();
            for (const item of rows) {
              const p = item?.properties ?? item;
              const gx = Number(p.gx); const gy = Number(p.gy);
              const val = Number(p[metricProp] ?? 0) || 0;
              if (Number.isFinite(gx) && Number.isFinite(gy) && val > 0) {
                lookup.set(`${gx}_${gy}`, val);
              }
            }
            _indexCellsCache = { key: ptKey, lookup };
            ptRef.lookup = lookup;
          }
        } catch { /* use existing cell values */ }
      })());
    }
  }

  // Await all loaders simultaneously — bounded by slowest single endpoint.
  // Cap at 12 s on slow connections: overlays that didn't finish in time contribute
  // 0 to the score for this run; their caches are set when the fetch eventually
  // completes so the next scoring call uses the full data.
  if (loaders.length > 0) {
    await Promise.race([
      Promise.all(loaders),
      new Promise<void>(resolve => setTimeout(resolve, 12000)),
    ]);
  }

  // Build all spatial grid indexes now that data is populated (skipped if already built)
  const GRID_CELL = 0.12; // ~13km buckets
  if (_indexFloodGrid === null) _indexFloodGrid = buildSpatialGrid(_indexFloodCache!, GRID_CELL);
  if (_indexSchoolGrid === null) _indexSchoolGrid = buildSpatialGrid(_indexSchoolCache!, GRID_CELL);
  if (_indexStationGrid === null && _indexStationCache !== null) _indexStationGrid = buildSpatialGrid(_indexStationCache, GRID_CELL);
  if (_indexPrimarySchoolGrid === null && _indexPrimarySchoolCache !== null) _indexPrimarySchoolGrid = buildSpatialGrid(_indexPrimarySchoolCache, GRID_CELL);
  if (_indexBusStopGrid === null && _indexBusStopCache !== null) _indexBusStopGrid = buildSpatialGrid(_indexBusStopCache, GRID_CELL);
  if (_indexMetroTramGrid === null && _indexMetroTramCache !== null) _indexMetroTramGrid = buildSpatialGrid(_indexMetroTramCache, GRID_CELL);
  if (_indexPharmacyGrid === null && _indexPharmacyCache !== null) _indexPharmacyGrid = buildSpatialGrid(_indexPharmacyCache, GRID_CELL);
  if (_indexPubGrid === null && _indexPubCache !== null) _indexPubGrid = buildSpatialGrid(_indexPubCache, GRID_CELL);
  if (_indexSupermarketGrid === null && _indexSupermarketCache !== null) _indexSupermarketGrid = buildSpatialGrid(_indexSupermarketCache, GRID_CELL);

  const floodGrid = _indexFloodGrid;
  const schoolGrid = _indexSchoolGrid;
  const stationGrid = _indexStationGrid;
  const primarySchoolGrid = _indexPrimarySchoolGrid;

  // Walking distance thresholds for primary schools
  const PRIMARY_WALK_GOOD_METERS = 800;   // ≤800m (10-min walk) = full score
  const PRIMARY_WALK_MAX_METERS  = 3200;  // >3.2km (2 miles) = zero score

  // ptLookup resolved by the parallel affordability loader (or from cache above)
  const ptLookup = ptRef.lookup;

  // Tight search radius for scoring (~8km), wide radius for data-coverage check (~50km)
  const NEAR_DEG = 0.08;
  const DATA_DEG = 0.45;
  const CHUNK = 300; // yield to browser every N cells

  const features = fc.features;

  // ─── Flood pre-pass: compute worst-case severity score for every cell ───
  // Flood points are only considered if they fall **within the cell itself**.
  // We compute the cell's half-diagonal in metres from its corner coordinates and
  // use that as the search radius.  This means a 1mile cell only looks ~1.1km from
  // its centre — a flood zone in the next valley simply doesn't count.
  // Score = max severityWeight among all flood points inside the cell (no proximity
  // weighting needed — if it's in the cell, it counts at full strength).
  //
  // Country-aware data coverage: cells carry a `country` field (E/W/S/N) from the
  // Westminster constituency boundaries. EA flood data only covers England, so
  // cells outside England are marked hasData=false and excluded from flood scoring.
  // For cells with no constituency match (offshore etc.) we fall back to the 50km
  // spatial presence check.
  type FloodMeta = { rawImpact: number; hasData: boolean };
  const floodMeta: FloodMeta[] = new Array(features.length);
  for (let i = 0; i < features.length; i++) {
    const coords = features[i].geometry?.coordinates?.[0];
    if (!coords || coords.length < 4) { floodMeta[i] = { rawImpact: 0, hasData: false }; continue; }
    const cLon = (coords[0][0] + coords[2][0]) / 2;
    const cLat = (coords[0][1] + coords[2][1]) / 2;

    // Cell half-diagonal in metres (centre → corner)
    const cellHalfDiagM = haversineDistanceMeters(cLat, cLon, coords[2][1], coords[2][0]);
    // Convert to degrees for the spatial-grid query (rough approximation is fine here)
    const cellQueryDeg = Math.max(cellHalfDiagM / 100000, 0.005); // floor 0.005° ≈ 550m

    // Authoritative country check: if the cell has a known country, use it directly.
    // EA flood data only covers England (country=="E").
    const cellCountry: string = features[i].properties?.country ?? "";
    if (cellCountry === "W" || cellCountry === "S" || cellCountry === "N") {
      floodMeta[i] = { rawImpact: 0, hasData: false }; continue;
    }
    if (cellCountry !== "E") {
      // Country unknown (no constituency match) — fall back to spatial presence check
      if (querySpatialGrid(floodGrid, cLon, cLat, DATA_DEG).length === 0) {
        floodMeta[i] = { rawImpact: 0, hasData: false }; continue;
      }
    }
    // Query only within the cell's own footprint
    const cellFloodPoints = querySpatialGrid(floodGrid, cLon, cLat, cellQueryDeg);
    let raw = 0;
    for (const fp of cellFloodPoints) {
      const d = haversineDistanceMeters(cLat, cLon, fp.lat, fp.lon);
      if (d <= cellHalfDiagM) {
        const risk = Number(fp.riskScore ?? 0);
        // severityWeight: high-risk=5, medium=1, low=0.1, very-low=0.05
        const severityWeight = risk >= 4 ? 5 : risk >= 3 ? 1 : risk >= 2 ? 0.1 : risk >= 1 ? 0.05 : 0;
        // Max (not sum) — worst point in cell, density-independent
        raw = Math.max(raw, severityWeight);
      }
    }
    floodMeta[i] = { rawImpact: raw, hasData: true };
  }
  // Hybrid flood scoring — based on severity of flood points WITHIN each cell:
  //   rawImpact values: 0 (none), 0.05 (very-low), 0.1 (low), 1.0 (medium), 5.0 (high)
  //   Threshold = 0.5: only medium (1.0) and high (5.0) risk points trigger relative ranking.
  //   Low/very-low in-cell points get absolute safe scores so they don't look red
  //   when ranked against cells that also only have low-risk points.
  const FLOOD_RISK_THRESHOLD = 0.5; // medium-risk (sw=1) or higher in the cell
  const _floodBatchSorted = floodMeta
    .filter(fm => fm && fm.hasData && fm.rawImpact >= FLOOD_RISK_THRESHOLD)
    .map(fm => fm.rawImpact)
    .sort((a, b) => a - b);
  const _floodBatchMax = _floodBatchSorted.length > 0 ? _floodBatchSorted[_floodBatchSorted.length - 1] : 0;

  for (let i = 0; i < features.length; i++) {
    // Yield to browser between chunks so UI stays responsive
    if (i > 0 && i % CHUNK === 0) await new Promise<void>((r) => setTimeout(r, 0));

    const feature = features[i];
    const props = feature.properties ?? {};
    const coords = feature.geometry?.coordinates?.[0];
    if (!coords || coords.length < 4) { props.index_score = 0; continue; }

    const cLon = (coords[0][0] + coords[2][0]) / 2;
    const cLat = (coords[0][1] + coords[2][1]) / 2;

    // — Region bbox filter: tag cells outside ALL selected areas with ix_oor=1 —
    // A 10 km buffer is added around each bbox so nearby cells just outside a border still show.
    // 10 km ≈ 0.090° lat; for lon we use the centroid latitude to keep it accurate across GB.
    // We use a dedicated flag (ix_oor) rather than zeroing the score so the filter can
    // distinguish "outside region" from "inside region but scored 0 (poor match)" — the
    // latter should still be visible in Area only / Weak areas modes.
    if (prefs.regionBboxes && prefs.regionBboxes.length > 0) {
      const bufLat = 0.090; // ~10 km in latitude
      const bufLon = 0.090 / Math.cos(cLat * Math.PI / 180); // ~10 km in longitude at this latitude
      const inAny = prefs.regionBboxes.some(([minLon, minLat, maxLon, maxLat]) =>
        cLon >= minLon - bufLon && cLon <= maxLon + bufLon &&
        cLat >= minLat - bufLat && cLat <= maxLat + bufLat
      );
      if (!inAny) { props.index_score = 0; (props as any).ix_oor = 1; continue; }
    }
    (props as any).ix_oor = 0; // clear flag from any previous scoring run

    let totalWeight = 0;
    let totalScore = 0;

    // 1) Affordability
    let affordScore = 0.5;
    if (prefs.affordWeight > 0) {
      // Always prefer selected house-type median lookup for affordability, so
      // ALL/D/S/T/F references are consistent with Find My Area settings.
      //
      // UK-wide typical ratios of property-type median relative to the ALL-types median.
      // Used to estimate affordability when no type-specific data exists for a cell
      // (e.g. a London cell with no detached transactions is still almost certainly
      // unaffordable at ~1.55× the overall median — don't silently score it neutral).
      const TYPE_RATIO: Record<string, number> = { ALL: 1.0, D: 1.55, S: 1.10, T: 0.85, F: 0.70 };
      const gx = Number(props.gx); const gy = Number(props.gy);
      let cellValue = 0;
      // 0 = real data  1 = no data at all  2 = estimated via type-ratio from overall median
      let affordDataQuality = 1;
      if (ptLookup && Number.isFinite(gx) && Number.isFinite(gy)) {
        const lookedUp = ptLookup.get(`${gx}_${gy}`);
        if (lookedUp != null && lookedUp > 0) {
          cellValue = lookedUp;
          affordDataQuality = 0;
          // Outlier guard: when a model estimate is available (blend mode, 1mile grid),
          // check if the raw actual deviates strongly from the estimate.
          // Two tiers:
          //   < 0.3× estimate  → almost certainly a different asset class (park/mobile homes,
          //                       garages, commercial) — ignore the actual entirely regardless
          //                       of how many sales there were.
          //   0.3–0.6× or >1.7× → sparse-data outlier — blend toward the estimate; cells
          //                       with 20+ sales earn full trust in the actual.
          const estRaw = Number(props.estimated_median ?? 0);
          if (estRaw > 0) {
            // Type-adjust the ALL-type estimate to match the indexPT property type
            const fromRatio = TYPE_RATIO[state.propertyType] ?? 1.0;
            const toRatio   = TYPE_RATIO[indexPT] ?? 1.0;
            const adjustedEst = estRaw * (toRatio / fromRatio);
            const outlierRatio = lookedUp / adjustedEst;
            if (outlierRatio < 0.3) {
              // Extreme divergence — asset class mismatch (e.g. park homes at £22k vs
              // residential estimate of £450k). Discard the actual entirely.
              cellValue = adjustedEst;
              affordDataQuality = 2;
            } else if (outlierRatio < 0.6 || outlierRatio > 1.7) {
              // Moderate outlier — blend proportionally by sales count.
              // 20+ sales earns full trust in the actual.
              const txCount = Number(props.tx_count ?? 0);
              const actualTrust = Math.min(1, txCount / 20);
              cellValue = actualTrust * lookedUp + (1 - actualTrust) * adjustedEst;
              affordDataQuality = 2; // blended — treat as estimated
            }
          }
        } else {
          // Type-specific data missing for this cell — estimate from the overall/displayed
          // cell median using the ratio of the desired type to the current map filter type.
          const baseVal = Number(props[metricProp] ?? 0) || 0;
          if (baseVal > 0) {
            const fromRatio = TYPE_RATIO[state.propertyType] ?? 1.0;
            const toRatio   = TYPE_RATIO[indexPT] ?? 1.0;
            cellValue = baseVal * (toRatio / fromRatio);
            affordDataQuality = 2;
          }
        }
      } else {
        const fallback = Number(props[metricProp] ?? 0) || 0;
        if (fallback > 0) {
          cellValue = fallback;
          affordDataQuality = 0;
        }
      }
      props.ix_av = cellValue > 0 ? cellValue : null;
      props.ix_an = affordDataQuality;
      if (cellValue > 0 && Number.isFinite(prefs.budget) && prefs.budget > 0) {
        const ratio = cellValue / prefs.budget;
        affordScore = Math.max(0, Math.min(1, (1.6 - ratio) / 0.9));
      } else {
        affordScore = 0.5;
      }
      totalScore += prefs.affordWeight * affordScore;
      totalWeight += prefs.affordWeight;
    }
    props.ix_a = affordScore;

    // 2) Flood risk — severity of flood points contained within this cell.
    //    rawImpact = max severityWeight: high-risk→5, medium→1, low→0.1, very-low→0.05, none→0
    //    Only medium+ in-cell risk triggers relative ranking; low/none get absolute safe scores.
    let floodScore = 0.5;
    let floodNoData = false;
    if (prefs.floodWeight > 0) {
      const fm = floodMeta[i];
      if (!fm || !fm.hasData) {
        // No dataset coverage (Wales, Scotland, etc.) — exclude from scoring entirely.
        // Don't add to totalWeight so the missing criterion doesn't pull the score
        // toward neutral; other criteria score the area on its actual merits.
        floodNoData = true;
        floodScore = 0.5;
      } else {
        const r = fm.rawImpact; // max severityWeight among flood points inside this cell
        if (r === 0) {
          // No flood points inside the cell → definitively safe
          floodScore = 1.00;
        } else if (r < 0.08) {
          // Only very-low risk points (risk=1, sw=0.05) in cell → safe
          floodScore = 0.92;
        } else if (r < FLOOD_RISK_THRESHOLD) {
          // Only low risk points (risk=2, sw=0.1) in cell → safe-ish
          floodScore = 0.82;
        } else if (_floodBatchMax === 0) {
          // All cells in batch are below threshold — guard
          floodScore = 0.82;
        } else {
          // Medium (sw=1.0) or high (sw=5.0) risk inside the cell.
          // Rank relative to other at-risk cells in this batch.
          let lo = 0, hi = _floodBatchSorted.length - 1, pos = 0;
          while (lo <= hi) {
            const m = (lo + hi) >> 1;
            if (_floodBatchSorted[m] <= r) { pos = m; lo = m + 1; } else hi = m - 1;
          }
          // rank ∈ (0, 1]: 1 = riskiest in batch, near-0 = least risky above threshold
          const rank = (pos + 1) / _floodBatchSorted.length;
          // Safest above-threshold cell ≈ 0.75, riskiest ≈ 0.03
          floodScore = Math.max(0.03, Math.min(0.75, 0.75 - 0.72 * rank));
        }
        totalScore += prefs.floodWeight * floodScore;
        totalWeight += prefs.floodWeight;
      }
    }
    props.ix_f = floodScore;
    props.ix_fn = floodNoData ? 1 : 0;

    // 3) School quality — distinguish "no nearby school" from "no data area"
    let schoolScore = 0.5;
    let schoolNoData = false;
    if (prefs.schoolWeight > 0) {
      // Ofsted covers England only. Use country field for authoritative detection;
      // fall back to spatial presence check for cells with no constituency match.
      const cellCountry: string = props.country ?? "";
      const noSchoolCoverage =
        cellCountry === "W" || cellCountry === "S" || cellCountry === "N"
          ? true
          : cellCountry !== "E"
            ? querySpatialGrid(schoolGrid, cLon, cLat, DATA_DEG).length === 0
            : false;
      if (noSchoolCoverage) {
        // No dataset coverage (Wales/Scotland use different inspectorates).
        // Exclude from scoring — same principle as flood: don't reward or penalise
        // areas where we simply have no data.
        schoolNoData = true;
        schoolScore = 0.5;
      } else {
        // Use ALL nearby schools (within 8km), weighted by distance.
        // This avoids over-rewarding a single good school in an area with many weaker schools.
        let weightedSum = 0;
        let weightSum = 0;
        for (const sp of querySpatialGrid(schoolGrid, cLon, cLat, NEAR_DEG)) {
          const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
          if (d < 8000) {
            const q = sp.qualityScore; // already 0-1 from pipeline rank_percentiles
            const w = 1 / Math.max(d, 500); // closer schools matter more
            weightedSum += q * w;
            weightSum += w;
          }
        }
        schoolScore = weightSum > 0 ? (weightedSum / weightSum) : 0.5;
        totalScore += prefs.schoolWeight * schoolScore;
        totalWeight += prefs.schoolWeight;
      }
    }
    props.ix_s = schoolScore;
    props.ix_sn = schoolNoData ? 1 : 0;

    // 3b) Primary school walking distance
    let primarySchoolScore = 0.5;
    let primarySchoolNoData = false;
    const primaryW = prefs.primarySchoolWeight ?? 0;
    if (primaryW > 0) {
      const cellC: string = props.country ?? "";
      const noPrimary =
        cellC === "W" || cellC === "S" || cellC === "N"
          ? true
          : cellC !== "E"
            ? !primarySchoolGrid || querySpatialGrid(primarySchoolGrid, cLon, cLat, DATA_DEG).length === 0
            : false;
      if (noPrimary) {
        primarySchoolNoData = true;
        primarySchoolScore = 0.5;
      } else if (primarySchoolGrid) {
        // Find nearest primary school of any grade
        let minDist = Infinity;
        for (const sp of querySpatialGrid(primarySchoolGrid, cLon, cLat, NEAR_DEG)) {
          const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
          if (d < minDist) minDist = d;
        }
        if (minDist <= PRIMARY_WALK_GOOD_METERS) {
          primarySchoolScore = 1.0;
        } else if (minDist >= PRIMARY_WALK_MAX_METERS) {
          primarySchoolScore = 0.0;
        } else {
          primarySchoolScore = 1 - (minDist - PRIMARY_WALK_GOOD_METERS) / (PRIMARY_WALK_MAX_METERS - PRIMARY_WALK_GOOD_METERS);
        }
      }
      totalScore += primaryW * primarySchoolScore;
      totalWeight += primaryW;
    }
    props.ix_p  = primarySchoolScore;
    props.ix_pn = primarySchoolNoData ? 1 : 0;

    // 4) Train station proximity — score by distance to nearest station
    // When trainMaxDistMiles is set (Must mode):
    //   - The cap distance IS the "good" threshold; score is 1 up to the cap.
    //   - Beyond the cap, score is 0 and the veto multiplier zeroes the cell.
    //   - Within the cap, score scales 1→0.5 from 0 to cap (so "0.5 miles away" in a
    //     5-mile cap area still scores better than "4.9 miles away").
    //   - Cap < 0.5 miles → treat as 0.5 miles (cell is ~1 mile wide; closer is impossible to guarantee).
    // When no cap (normal mode): linear decay from 1 at 1 mile → 0 at 10 miles.
    let trainScore = 0.5;
    let trainNoData = false;
    if (prefs.trainWeight > 0) {
      const capMiles = prefs.trainMaxDistMiles != null ? Math.max(0.5, prefs.trainMaxDistMiles) : null;
      const capMeters = capMiles != null ? capMiles * 1_609.34 : null;
      // Effective "good" threshold: cap when set, else 1 mile
      const goodMeters = capMeters ?? STATION_GOOD_DISTANCE_METERS;
      // Effective "zero" threshold: cap when set, else 10 miles
      const maxMeters  = capMeters ?? STATION_MAX_DISTANCE_METERS;

      // Wide check: any station data within ~80km?
      const wideStation = stationGrid ? querySpatialGrid(stationGrid, cLon, cLat, DATA_DEG * 3) : [];
      if (wideStation.length === 0) {
        trainNoData = true;
        trainScore = 0.5;
      } else {
        let minDist = Infinity;
        for (const sp of wideStation) {
          const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
          if (d < minDist) minDist = d;
        }
        if (capMeters != null) {
          // Cap mode: hard zero beyond cap, smooth 1.0→0.5 within cap
          if (minDist > capMeters) {
            trainScore = 0.0; // beyond cap — will be zeroed by veto
          } else {
            // Scale 1.0 at 0 metres → 0.5 at exactly the cap
            trainScore = 1.0 - 0.5 * (minDist / capMeters);
          }
        } else {
          // Normal mode: full score within 1 mile, linear decay to 0 at 10 miles
          if (minDist <= goodMeters) {
            trainScore = 1.0;
          } else if (minDist >= maxMeters) {
            trainScore = 0.0;
          } else {
            trainScore = 1 - (minDist - goodMeters) / (maxMeters - goodMeters);
          }
        }
        totalScore += prefs.trainWeight * trainScore;
        totalWeight += prefs.trainWeight;
      }
    }
    props.ix_t = trainScore;
    props.ix_tn = trainNoData ? 1 : 0;

    // 5) Community age — use age_score from census cell data (already backfilled)
    let ageScore = 0.5;
    const ageW = prefs.ageWeight ?? 0;
    if (ageW > 0) {
      const rawAgeScore = Number(props.age_score ?? NaN);
      if (Number.isFinite(rawAgeScore)) {
        // direction: "young" → high age_score is better; "old" → low age_score is better
        ageScore = (prefs.ageDirection ?? "young") === "old" ? 1 - rawAgeScore : rawAgeScore;
      }
      // If no data: neutral 0.5
      totalScore += ageW * ageScore;
      totalWeight += ageW;
    }
    props.ix_ag = ageScore;

    // 6) Crime safety — use crime_local_score (relative to local area, 0-100, higher=safer)
    let crimeScore = 0.5;
    const crimeW = prefs.crimeWeight ?? 0;
    if (crimeW > 0) {
      const rawCrimeScore = Number(props.crime_local_score ?? NaN);
      if (Number.isFinite(rawCrimeScore)) {
        crimeScore = Math.max(0, Math.min(1, rawCrimeScore / 100));
      }
      totalScore += crimeW * crimeScore;
      totalWeight += crimeW;
    }
    props.ix_cr = crimeScore;

    // 7) EPC heating fuel preference
    let epcFuelScore = -1; // -1 = no data
    const epcFuelW = prefs.epcFuelWeight ?? 0;
    if (epcFuelW > 0) {
      const fuelPref = prefs.epcFuelPreference ?? "gas";
      let rawFuelPct: number;
      if (fuelPref === "no_gas") {
        // "no_gas" = non-gas areas: score is % NOT on gas (1 - pct_gas/100)
        const pctGas = Number(props.pct_gas ?? NaN);
        rawFuelPct = Number.isFinite(pctGas) ? 100 - pctGas : NaN;
      } else {
        rawFuelPct = Number((props as any)[`pct_${fuelPref}`] ?? NaN);
      }
      if (Number.isFinite(rawFuelPct)) {
        epcFuelScore = Math.max(0, Math.min(1, rawFuelPct / 100));
        totalScore += epcFuelW * epcFuelScore;
        totalWeight += epcFuelW;
      }
      // If no EPC data for this cell: skip weight entirely (don't penalise or reward)
    }
    props.ix_epc_fuel = epcFuelScore;

    // 8) Broadband speed — score = min(1, avg_speed / threshold) where threshold
    //    is derived from the tier the user selected (3→30Mb, 6→100Mb, 10→300Mb).
    let broadbandScore = 0.5;
    let broadbandNoData = false;
    const broadbandW = prefs.broadbandWeight ?? 0;
    if (broadbandW > 0) {
      const bbThreshold = broadbandW === 10 ? 300 : broadbandW === 6 ? 100 : 30;
      const avgSpeed = Number(props.bb_avg_speed ?? NaN);
      if (!Number.isFinite(avgSpeed)) {
        broadbandNoData = true;
      } else {
        broadbandScore = Math.min(1, avgSpeed / bbThreshold);
        totalScore += broadbandW * broadbandScore;
        totalWeight += broadbandW;
      }
    }
    props.ix_bb = broadbandScore;

    // 9) Bus stop & metro/tram proximity — score = max(busScore, metroScore)
    let busTransitScore = 0.5;
    let busTransitNoData = false;
    if (busW > 0) {
      const wideBus = _indexBusStopGrid ? querySpatialGrid(_indexBusStopGrid, cLon, cLat, DATA_DEG) : [];
      const wideMetro = _indexMetroTramGrid ? querySpatialGrid(_indexMetroTramGrid, cLon, cLat, DATA_DEG) : [];
      if (wideBus.length === 0 && wideMetro.length === 0) {
        busTransitNoData = true;
      } else {
        let minBusDist = Infinity;
        if (_indexBusStopGrid) {
          for (const sp of querySpatialGrid(_indexBusStopGrid, cLon, cLat, 0.027)) {
            const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
            if (d < minBusDist) minBusDist = d;
          }
        }
        let busScore = 0.0;
        if (minBusDist <= BUS_STOP_GREAT_METERS) {
          busScore = 1.0;
        } else if (minBusDist < BUS_STOP_MAX_METERS) {
          busScore = 1 - (minBusDist - BUS_STOP_GREAT_METERS) / (BUS_STOP_MAX_METERS - BUS_STOP_GREAT_METERS);
        }
        let minMetroDist = Infinity;
        if (_indexMetroTramGrid) {
          for (const sp of querySpatialGrid(_indexMetroTramGrid, cLon, cLat, 0.09)) {
            const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
            if (d < minMetroDist) minMetroDist = d;
          }
        }
        let metroScore = 0.0;
        if (minMetroDist <= METRO_TRAM_GREAT_METERS) {
          metroScore = 1.0;
        } else if (minMetroDist < METRO_TRAM_MAX_METERS) {
          metroScore = 1 - (minMetroDist - METRO_TRAM_GREAT_METERS) / (METRO_TRAM_MAX_METERS - METRO_TRAM_GREAT_METERS);
        }
        busTransitScore = Math.max(busScore, metroScore);
        totalScore += busW * busTransitScore;
        totalWeight += busW;
      }
    }
    props.ix_bus = busTransitScore;
    props.ix_busn = busTransitNoData ? 1 : 0;

    // 10) Pharmacy proximity
    let pharmacyScore = 0.5;
    let pharmacyNoData = false;
    if (pharmW > 0) {
      const widePharm = _indexPharmacyGrid ? querySpatialGrid(_indexPharmacyGrid, cLon, cLat, DATA_DEG) : [];
      if (widePharm.length === 0) {
        pharmacyNoData = true;
      } else if (_indexPharmacyGrid) {
        let minPharmDist = Infinity;
        for (const sp of querySpatialGrid(_indexPharmacyGrid, cLon, cLat, 0.09)) {
          const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
          if (d < minPharmDist) minPharmDist = d;
        }
        if (minPharmDist <= PHARMACY_GREAT_METERS) {
          pharmacyScore = 1.0;
        } else if (minPharmDist <= PHARMACY_MAX_METERS) {
          pharmacyScore = 1 - (minPharmDist - PHARMACY_GREAT_METERS) / (PHARMACY_MAX_METERS - PHARMACY_GREAT_METERS);
        } else {
          pharmacyScore = 0.0;
        }
        totalScore += pharmW * pharmacyScore;
        totalWeight += pharmW;
      }
    }
    props.ix_phm = pharmacyScore;
    props.ix_phmn = pharmacyNoData ? 1 : 0;

    // 11) Pub/bar score = 60% average-distance score + 40% count score.
    // Average distance: mean of all pubs within PUB_MAX_METERS, scored same
    // scale as before (≤GREAT=1.0, ≥MAX=0.0). Using the average rather than
    // nearest means 8 pubs at 600m avg scores better than 1 pub at 600m.
    // Count score: 1=0.2, 3=0.6, 5+=1.0 (capped).
    // Single 0.04° (~4.4km) grid query covers PUB_MAX_METERS (2.5km) with margin.
    let pubScore = 0.5;
    let pubNoData = false;
    if (pubW > 0) {
      if (!_indexPubGrid) {
        pubNoData = true;
      } else {
        let pubDistSum = 0;
        let pubInRangeCount = 0;
        let pubAnyFound = false;
        for (const sp of querySpatialGrid(_indexPubGrid, cLon, cLat, 0.04)) {
          pubAnyFound = true;
          const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
          if (d <= PUB_MAX_METERS) { pubDistSum += d; pubInRangeCount++; }
        }
        if (!pubAnyFound) {
          pubNoData = true;
        } else if (pubInRangeCount > 0) {
          const avgPubDist = pubDistSum / pubInRangeCount;
          const pubAvgDistScore = avgPubDist <= PUB_GREAT_METERS ? 1.0
            : 1 - (avgPubDist - PUB_GREAT_METERS) / (PUB_MAX_METERS - PUB_GREAT_METERS);
          const pubCountScore = Math.min(1.0, pubInRangeCount / 5);
          pubScore = 0.6 * pubAvgDistScore + 0.4 * pubCountScore;
        } else {
          pubScore = 0.0;
        }
        if (!pubNoData) { totalScore += pubW * pubScore; totalWeight += pubW; }
      }
    }
    props.ix_pub = pubScore;
    props.ix_pubn = pubNoData ? 1 : 0;

    // 12) Supermarket / food shop score = 60% average-distance + 40% count.
    // 0.05° (~5.5km) query covers SUPERMARKET_MAX_METERS (4km) with margin.
    let supermarketScore = 0.5;
    let supermarketNoData = false;
    if (smktW > 0) {
      if (!_indexSupermarketGrid) {
        supermarketNoData = true;
      } else {
        let smktDistSum = 0;
        let smktInRangeCount = 0;
        let smktAnyFound = false;
        for (const sp of querySpatialGrid(_indexSupermarketGrid, cLon, cLat, 0.05)) {
          smktAnyFound = true;
          const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
          if (d <= SUPERMARKET_MAX_METERS) { smktDistSum += d; smktInRangeCount++; }
        }
        if (!smktAnyFound) {
          supermarketNoData = true;
        } else if (smktInRangeCount > 0) {
          const avgSmktDist = smktDistSum / smktInRangeCount;
          const smktAvgDistScore = avgSmktDist <= SUPERMARKET_GREAT_METERS ? 1.0
            : 1 - (avgSmktDist - SUPERMARKET_GREAT_METERS) / (SUPERMARKET_MAX_METERS - SUPERMARKET_GREAT_METERS);
          const smktCountScore = Math.min(1.0, smktInRangeCount / 5);
          supermarketScore = 0.6 * smktAvgDistScore + 0.4 * smktCountScore;
        } else {
          supermarketScore = 0.0;
        }
        if (!supermarketNoData) { totalScore += smktW * supermarketScore; totalWeight += smktW; }
      }
    }
    props.ix_smkt = supermarketScore;
    props.ix_smktn = supermarketNoData ? 1 : 0;

    // 13) Coast proximity (placeholder)
    if (prefs.coastWeight > 0) {
      totalScore += prefs.coastWeight * 0.5;
      totalWeight += prefs.coastWeight;
    }

    // ── Veto / deal-breaker logic ────────────────────────────────────────────
    // A pure weighted average lets great scores in other areas compensate for a
    // terrible score in something you've said you rely on. Instead, each factor
    // that scores BELOW neutral (< 0.5) and carries meaningful weight applies a
    // multiplicative drag that grows with both weight and shortfall.
    //   shortfall = how far below neutral (0 → score=0.5, 1 → score=0)
    //   veto multiplier *= 1 − vetoW × shortfall × 0.5
    // The effective weight is capped at 2.0: scores at coarser grids are inherently
    // less precise, and a hard-zero veto from weight=10 would nuke entire large cells
    // based on one river edge.  The cap still allows:
    //   vetoW=2, score=0.0: multiplier = 0    (absolute worst → hard zero ✓)
    //   vetoW=2, score=0.3: multiplier = 0.6  (40% drag — noticeably penalised)
    //   vetoW=2, score=0.4: multiplier = 0.8  (20% drag)
    const VETO_WEIGHT_CAP = 2.0;
    let vetoMultiplier = 1.0;
    // Affordability: cap scales with budget-strictness level so Must/Prefer/Guide differ:
    //   Must(10)   cap=4.0 → worst-case mult=0   (hard zero when 60%+ over budget)
    //   Prefer(6)  cap=1.6 → worst-case mult=0.2  (strong penalty but not a hard zero)
    //   Guide(3)   cap=1.0 → worst-case mult=0.5  (rough halving when way over budget)
    if (prefs.affordWeight > 0 && affordScore < 0.5) {
      const shortfall = (0.5 - affordScore) / 0.5;
      const affordVetoCap = prefs.affordWeight >= 10 ? 4.0 : prefs.affordWeight >= 6 ? 1.6 : 1.0;
      vetoMultiplier *= Math.max(0, 1 - Math.min(prefs.affordWeight, affordVetoCap) * shortfall * 0.5);
    }
    if (prefs.floodWeight > 0 && !floodNoData && floodScore < 0.5) {
      const shortfall = (0.5 - floodScore) / 0.5;
      // Cap scales with the chosen risk-tolerance level so Must/Avoid/Allow differ meaningfully:
      //   Must(10)  cap=2.0 → worst-case mult≈0.06 (near-zero for high-risk cells)
      //   Avoid(4)  cap=1.4 → worst-case mult≈0.34 (strong penalty but survivable)
      //   Allow(2)  cap=0.75 → worst-case mult≈0.65 (light nudge only)
      const floodVetoCap = prefs.floodWeight >= 10 ? 2.0 : prefs.floodWeight >= 4 ? 1.4 : 0.75;
      vetoMultiplier *= Math.max(0, 1 - Math.min(prefs.floodWeight, floodVetoCap) * shortfall * 0.5);
    }
    if (prefs.schoolWeight > 0 && !schoolNoData && schoolScore < 0.5) {
      const shortfall = (0.5 - schoolScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - Math.min(prefs.schoolWeight, VETO_WEIGHT_CAP) * shortfall * 0.5);
    }
    if (primaryW > 0 && !primarySchoolNoData && primarySchoolScore < 0.5) {
      const shortfall = (0.5 - primarySchoolScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - Math.min(primaryW, VETO_WEIGHT_CAP) * shortfall * 0.5);
    }
    if (prefs.trainWeight > 0 && !trainNoData && trainScore < 0.5) {
      if (prefs.trainMaxDistMiles != null && trainScore === 0) {
        // Hard cap exceeded — absolute veto regardless of weight slider
        vetoMultiplier = 0;
      } else {
        const shortfall = (0.5 - trainScore) / 0.5;
        vetoMultiplier *= Math.max(0, 1 - Math.min(prefs.trainWeight, VETO_WEIGHT_CAP) * shortfall * 0.5);
      }
    }
    if (crimeW > 0 && crimeScore < 0.5) {
      const shortfall = (0.5 - crimeScore) / 0.5;
      // Same per-level caps as flood (both are risk-tolerance criteria):
      //   Must(10)  cap=2.0 → worst-case mult≈0    (near-zero for high-crime cells)
      //   Avoid(4)  cap=1.4 → worst-case mult≈0.3  (strong penalty but survivable)
      //   Allow(2)  cap=0.75 → worst-case mult≈0.6 (light nudge only)
      const crimeVetoCap = crimeW >= 10 ? 2.0 : crimeW >= 4 ? 1.4 : 0.75;
      vetoMultiplier *= Math.max(0, 1 - Math.min(crimeW, crimeVetoCap) * shortfall * 0.5);
    }
    if (busW > 0 && !busTransitNoData && busTransitScore < 0.5) {
      const shortfall = (0.5 - busTransitScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - Math.min(busW, VETO_WEIGHT_CAP) * shortfall * 0.5);
    }
    if (pharmW > 0 && !pharmacyNoData && pharmacyScore < 0.5) {
      const shortfall = (0.5 - pharmacyScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - Math.min(pharmW, VETO_WEIGHT_CAP) * shortfall * 0.5);
    }
    if (pubW > 0 && !pubNoData && pubScore < 0.5) {
      const shortfall = (0.5 - pubScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - Math.min(pubW, VETO_WEIGHT_CAP) * shortfall * 0.5);
    }
    if (smktW > 0 && !supermarketNoData && supermarketScore < 0.5) {
      const shortfall = (0.5 - supermarketScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - Math.min(smktW, VETO_WEIGHT_CAP) * shortfall * 0.5);
    }

    const baseScore = totalWeight > 0 ? totalScore / totalWeight : 0.5;
    props.index_score = totalWeight > 0 ? Math.max(0, baseScore * vetoMultiplier) : -1;
  }

  // Cache sorted scores immediately — before setData hands data off to the MapLibre worker.
  // computeRelativeThreshold reads this cache; reading src._data after setData is unreliable.
  // When regions are active, only include in-region cells (ix_oor=0) so that "top 1%"
  // means top 1% of cells *within the selected area*, not top 1% of all UK cells.
  {
    const hasRegions = (prefs.regionBboxes?.length ?? 0) > 0;
    const arr: number[] = [];
    for (const f of fc.features) {
      const fp = (f as any)?.properties;
      const s = fp?.index_score;
      if (typeof s === "number" && s >= 0) {
        if (!hasRegions || (fp?.ix_oor ?? 0) === 0) arr.push(s);
      }
    }
    arr.sort((a, b) => a - b);
    _indexSortedScores = arr;
  }

  src.setData(fc as any);

  if (map.getLayer("cells-fill")) {
    const baseOpacityExpr = [
      "case", ["<", ["get", "index_score"], 0], 0.12,
      ["interpolate", ["linear"], ["get", "index_score"],
        0, 0.25, 0.3, 0.4, 0.7, 0.65, 1, 0.85],
    ] as any;
    map.setPaintProperty("cells-fill", "fill-color", [
      "case", ["<", ["get", "index_score"], 0], "#888888",
      ["interpolate", ["linear"], ["get", "index_score"],
        0,    "#d73027",
        0.25, "#f46d43",
        0.5,  "#ffffbf",
        0.75, "#66bd63",
        1,    "#1a9850"],
    ] as any);
    map.setPaintProperty("cells-fill", "fill-opacity", baseOpacityExpr);
  }
  applyCombinedCellFilters(map, state, prefs);
  return true;
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

function getFillColorExpression(metric: Metric, easy = false) {
  if (metric === "median") {
    // Use estimated_median for coloring when tx_count is low and an estimate exists
    const medianValue = [
      "case",
      ["all", ["<", ["get", "tx_count"], 4], [">", ["coalesce", ["get", "estimated_median"], 0], 0]],
      ["get", "estimated_median"],
      ["get", "median"],
    ];
    if (easy) return [
      "interpolate", ["linear"], medianValue,
      100000,  "#440154", // dark purple (cheap) — Viridis
      200000,  "#3b528b",
      300000,  "#21918c",
      400000,  "#3dbc74",
      550000,  "#9fda3a",
      700000,  "#d8e219",
      850000,  "#f2f022",
      1000000, "#fde725", // bright yellow (expensive)
    ] as any;
    return [
    "interpolate", ["linear"], medianValue,
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

  if (metric === "median_ppsf") {
    if (easy) return [
      "interpolate", ["linear"], ["get", "median"],
      100, "#440154",
      150, "#3b528b",
      200, "#21918c",
      250, "#3dbc74",
      325, "#9fda3a",
      400, "#d8e219",
      500, "#f2f022",
      650, "#fde725",
    ] as any;
    return [
      "interpolate", ["linear"], ["get", "median"],
      100,  "#2c7bb6",
      150,  "#00a6ca",
      200,  "#00ccbc",
      250,  "#90eb9d",
      325,  "#ffffbf",
      400,  "#fdae61",
      500,  "#f46d43",
      650,  "#d73027",
    ] as any;
  }

  if (metric === "delta_gbp") {
    if (easy) return [
      "interpolate", ["linear"], ["get", "delta_gbp"],
      -300000, "#543005", // extreme reduction: dark brown
      -150000, "#bf812d", // reduction: brown
      -50000,  "#dfc27d", // mild reduction: tan
      0,       "#f5f5f5", // neutral
      50000,   "#80cdc1", // increase: light teal
      150000,  "#35978f", // more increase: teal
      300000,  "#003c30", // extreme increase: dark teal
    ] as any;
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

  if (easy) return [
    "interpolate", ["linear"], ["get", "delta_pct"],
    -30, "#543005", // extreme reduction: dark brown
    -15, "#bf812d", // reduction: brown
    -5,  "#dfc27d", // mild reduction: tan
    0,   "#f5f5f5", // neutral
    5,   "#80cdc1", // increase: light teal
    15,  "#35978f", // more increase: teal
    30,  "#003c30", // extreme increase: dark teal
  ] as any;
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

function normalizePostcodeSearch(value: string) {
  return value.replace(/\s+/g, "").toUpperCase().trim();
}

function getCellFeatureAtLngLat(map: maplibregl.Map, lng: number, lat: number) {
  const point = map.project([lng, lat]);
  const features = map.queryRenderedFeatures(point, { layers: ["cells-fill"] }) as any[];
  return features.length ? features[0] : null;
}

function setFloodSearchFocus(map: maplibregl.Map, entry: FloodSearchEntry | null) {
  const source = map.getSource("flood-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  if (!entry) {
    source.setData({ type: "FeatureCollection", features: [] } as any);
    return;
  }

  source.setData(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            postcode: entry.postcode,
            risk_score: entry.riskScore,
          },
          geometry: {
            type: "Point",
            coordinates: [entry.lon, entry.lat],
          },
        },
      ],
    } as any
  );
}

function setSchoolSearchFocus(
  map: maplibregl.Map,
  nearest: (SchoolSearchEntry & { distanceMeters?: number }) | null,
  nearestGood: (SchoolSearchEntry & { distanceMeters?: number }) | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("school-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: {
        role: "nearest",
        school_name: nearest.schoolName,
        postcode: nearest.postcode,
      },
      geometry: {
        type: "Point",
        coordinates: [nearest.lon, nearest.lat],
      },
    });

    if (requested) {
      features.push({
        type: "Feature",
        properties: {
          role: "nearest_link",
          label: "School",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [requested.lon, requested.lat],
            [nearest.lon, nearest.lat],
          ],
        },
      });
    }
  }

  if (nearestGood) {
    features.push({
      type: "Feature",
      properties: {
        role: "nearest_good",
        school_name: nearestGood.schoolName,
        postcode: nearestGood.postcode,
      },
      geometry: {
        type: "Point",
        coordinates: [nearestGood.lon, nearestGood.lat],
      },
    });

    if (requested) {
      features.push({
        type: "Feature",
        properties: {
          role: "nearest_good_link",
          label: "Best school",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [requested.lon, requested.lat],
            [nearestGood.lon, nearestGood.lat],
          ],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

async function lookupPostcodeCoords(postcodeKey: string): Promise<{ lon: number; lat: number } | null> {
  const encoded = encodeURIComponent(postcodeKey);
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encoded}`);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const lon = Number(data?.result?.longitude);
    const lat = Number(data?.result?.latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat };
  } catch {
    return null;
  }
}

function setPostcodeSearchMarker(
  map: maplibregl.Map,
  coords: { lon: number; lat: number } | null
) {
  const source = map.getSource("postcode-search-marker") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  if (!coords) {
    source.setData({ type: "FeatureCollection", features: [] } as any);
    return;
  }

  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [coords.lon, coords.lat] },
      },
    ],
  } as any);
}

function setFloodSearchContext(
  map: maplibregl.Map,
  context: { requested: { lon: number; lat: number }; nearest: { lon: number; lat: number } } | null
) {
  const source = map.getSource("flood-search-context") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  if (!context) {
    source.setData({ type: "FeatureCollection", features: [] } as any);
    return;
  }

  source.setData(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { role: "requested" },
          geometry: {
            type: "Point",
            coordinates: [context.requested.lon, context.requested.lat],
          },
        },
        {
          type: "Feature",
          properties: { role: "link", label: "Flood zone" },
          geometry: {
            type: "LineString",
            coordinates: [
              [context.requested.lon, context.requested.lat],
              [context.nearest.lon, context.nearest.lat],
            ],
          },
        },
      ],
    } as any
  );
}

function findNearestFloodEntryByDistance(
  lng: number,
  lat: number,
  entries: FloodSearchEntry[],
  maxDistanceMeters = Number.POSITIVE_INFINITY
) {
  if (!entries.length) return null;

  let best: (FloodSearchEntry & { distanceMeters: number }) | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const distanceMeters = haversineDistanceMeters(lat, lng, entry.lat, entry.lon);
    if (distanceMeters < bestDistance) {
      bestDistance = distanceMeters;
      best = { ...entry, distanceMeters };
    }
  }

  if (!best) return null;
  return best.distanceMeters <= maxDistanceMeters ? best : null;
}

function findNearestSchoolEntryByDistance(
  lng: number,
  lat: number,
  entries: SchoolSearchEntry[],
  maxDistanceMeters = Number.POSITIVE_INFINITY
) {
  if (!entries.length) return null;

  let best: (SchoolSearchEntry & { distanceMeters: number }) | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const distanceMeters = haversineDistanceMeters(lat, lng, entry.lat, entry.lon);
    if (distanceMeters < bestDistance) {
      bestDistance = distanceMeters;
      best = { ...entry, distanceMeters };
    }
  }

  if (!best) return null;
  return best.distanceMeters <= maxDistanceMeters ? best : null;
}

function riskBandFromScore(score: number) {
  if (score >= 4) return "High";
  if (score >= 3) return "Medium";
  if (score >= 2) return "Low";
  if (score >= 1) return "Very low";
  return "None";
}

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000;
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function animateToPostcodeTarget(map: maplibregl.Map, center: [number, number], targetZoom: number) {
  const currentZoom = map.getZoom();
  const finalZoom = Math.max(currentZoom, targetZoom);

  map.stop();

  if (finalZoom - currentZoom > 3) {
    map.jumpTo({
      center,
      zoom: Math.max(currentZoom + 2, finalZoom - 2),
    });
  }

  map.easeTo({
    center,
    zoom: finalZoom,
    duration: 650,
    essential: true,
  });
}

async function getFloodSearchEntries(
  cacheRef: { current: FloodSearchEntry[] | null },
  promiseRef: { current: Promise<FloodSearchEntry[]> | null }
): Promise<FloodSearchEntry[]> {
  if (cacheRef.current) return cacheRef.current;
  if (promiseRef.current) return promiseRef.current;

  promiseRef.current = (async () => {
    const res = await fetch("/api/flood?plain=1", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Flood search load failed (${res.status})`);
    }

    const payload = (await res.json()) as { features?: any[] };
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const next: FloodSearchEntry[] = [];

    for (const feature of features) {
      const coordinates = feature?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

      const properties = feature?.properties ?? {};
      const postcodeRaw = String(properties.postcode ?? "").trim();
      if (!postcodeRaw) continue;

      const postcodeKeyRaw = String(properties.postcode_key ?? postcodeRaw);
      const postcodeKey = normalizePostcodeSearch(postcodeKeyRaw);
      if (!postcodeKey) continue;

      next.push({
        postcode: postcodeRaw,
        postcodeKey,
        riskScore: Number(properties.risk_score ?? 0) || 0,
        lon,
        lat,
      });
    }

    cacheRef.current = next;
    return next;
  })();

  try {
    return await promiseRef.current;
  } finally {
    promiseRef.current = null;
  }
}

async function getSchoolSearchEntries(
  cacheRef: { current: SchoolSearchEntry[] | null },
  promiseRef: { current: Promise<SchoolSearchEntry[]> | null }
): Promise<SchoolSearchEntry[]> {
  if (cacheRef.current) return cacheRef.current;
  if (promiseRef.current) return promiseRef.current;

  promiseRef.current = (async () => {
    const res = await fetch("/api/schools?plain=1", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`School search load failed (${res.status})`);
    }

    const payload = (await res.json()) as { features?: any[] };
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const next: SchoolSearchEntry[] = [];

    for (const feature of features) {
      const coordinates = feature?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

      const properties = feature?.properties ?? {};
      const schoolName = String(properties.school_name ?? "").trim();
      const postcode = String(properties.postcode ?? "").trim().toUpperCase();
      if (!schoolName || !postcode) continue;

      const postcodeKey = normalizePostcodeSearch(String(properties.postcode_key ?? postcode));
      if (!postcodeKey) continue;

      const qualityScore = Number(properties.quality_score ?? NaN);
      if (!Number.isFinite(qualityScore)) continue;

      next.push({
        schoolName,
        postcode,
        postcodeKey,
        qualityScore,
        qualityBand: String(properties.quality_band ?? "").trim() || "Unknown",
        isGood: Boolean(properties.is_good),
        lon,
        lat,
      });
    }

    cacheRef.current = next;
    return next;
  })();

  try {
    return await promiseRef.current;
  } finally {
    promiseRef.current = null;
  }
}

async function getStationSearchEntries(
  cacheRef: { current: StationSearchEntry[] | null },
  promiseRef: { current: Promise<StationSearchEntry[]> | null }
): Promise<StationSearchEntry[]> {
  if (cacheRef.current) return cacheRef.current;
  if (promiseRef.current) return promiseRef.current;

  promiseRef.current = (async () => {
    const res = await fetch("/api/stations?plain=1", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Station search load failed (${res.status})`);
    }

    const payload = (await res.json()) as { features?: any[] };
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const next: StationSearchEntry[] = [];

    for (const feature of features) {
      const coordinates = feature?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

      const properties = feature?.properties ?? {};
      const name = String(properties.name ?? "").trim();
      if (!name) continue;

      next.push({
        name,
        code: String(properties.code ?? "").trim(),
        owner: String(properties.owner ?? "").trim(),
        lon,
        lat,
      });
    }

    cacheRef.current = next;
    return next;
  })();

  try {
    return await promiseRef.current;
  } finally {
    promiseRef.current = null;
  }
}

function setPrimarySchoolSearchFocus(
  map: maplibregl.Map,
  nearest: { lon: number; lat: number; name: string; urn: string } | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("primary-school-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: { role: "nearest", name: nearest.name, urn: nearest.urn },
      geometry: { type: "Point", coordinates: [nearest.lon, nearest.lat] },
    });
    if (requested) {
      features.push({
        type: "Feature",
        properties: { role: "link" },
        geometry: {
          type: "LineString",
          coordinates: [[requested.lon, requested.lat], [nearest.lon, nearest.lat]],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

function setCrimeSearchFocus(
  map: maplibregl.Map,
  nearest: { lon: number; lat: number; lsoa_name: string; lsoa_code: string } | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("crime-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: { role: "nearest", lsoa_name: nearest.lsoa_name, lsoa_code: nearest.lsoa_code },
      geometry: { type: "Point", coordinates: [nearest.lon, nearest.lat] },
    });
    if (requested) {
      features.push({
        type: "Feature",
        properties: { role: "link" },
        geometry: {
          type: "LineString",
          coordinates: [[requested.lon, requested.lat], [nearest.lon, nearest.lat]],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

function setStationSearchFocus(
  map: maplibregl.Map,
  nearest: (StationSearchEntry & { distanceMeters: number }) | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("station-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: { role: "nearest", station_name: nearest.name, code: nearest.code },
      geometry: { type: "Point", coordinates: [nearest.lon, nearest.lat] },
    });

    if (requested) {
      features.push({
        type: "Feature",
        properties: { role: "link", label: "Station" },
        geometry: {
          type: "LineString",
          coordinates: [
            [requested.lon, requested.lat],
            [nearest.lon, nearest.lat],
          ],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

function setBusStopSearchFocus(
  map: maplibregl.Map,
  nearest: { lon: number; lat: number; name: string } | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("bus-stop-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: { role: "nearest", name: nearest.name },
      geometry: { type: "Point", coordinates: [nearest.lon, nearest.lat] },
    });
    if (requested) {
      features.push({
        type: "Feature",
        properties: { role: "link", label: "Bus stop" },
        geometry: {
          type: "LineString",
          coordinates: [[requested.lon, requested.lat], [nearest.lon, nearest.lat]],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

function setPharmacySearchFocus(
  map: maplibregl.Map,
  nearest: { lon: number; lat: number; name: string } | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("pharmacy-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: { role: "nearest", name: nearest.name },
      geometry: { type: "Point", coordinates: [nearest.lon, nearest.lat] },
    });
    if (requested) {
      features.push({
        type: "Feature",
        properties: { role: "link", label: "Pharmacy" },
        geometry: {
          type: "LineString",
          coordinates: [[requested.lon, requested.lat], [nearest.lon, nearest.lat]],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

function setPubSearchFocus(
  map: maplibregl.Map,
  nearest: { lon: number; lat: number; name: string } | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("pub-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: { role: "nearest", name: nearest.name },
      geometry: { type: "Point", coordinates: [nearest.lon, nearest.lat] },
    });
    if (requested) {
      features.push({
        type: "Feature",
        properties: { role: "link", label: "Pub" },
        geometry: {
          type: "LineString",
          coordinates: [[requested.lon, requested.lat], [nearest.lon, nearest.lat]],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

function setSupermarketSearchFocus(
  map: maplibregl.Map,
  nearest: { lon: number; lat: number; name: string } | null,
  requested: { lon: number; lat: number } | null
) {
  const source = map.getSource("supermarket-search-focus") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const features: any[] = [];
  if (nearest) {
    features.push({
      type: "Feature",
      properties: { role: "nearest", name: nearest.name },
      geometry: { type: "Point", coordinates: [nearest.lon, nearest.lat] },
    });
    if (requested) {
      features.push({
        type: "Feature",
        properties: { role: "link", label: "Food shop" },
        geometry: {
          type: "LineString",
          coordinates: [[requested.lon, requested.lat], [nearest.lon, nearest.lat]],
        },
      });
    }
  }

  source.setData({ type: "FeatureCollection", features } as any);
}

function findNearestStationByDistance(
  lng: number,
  lat: number,
  entries: StationSearchEntry[],
  maxDistanceMeters = Number.POSITIVE_INFINITY
): (StationSearchEntry & { distanceMeters: number }) | null {
  if (!entries.length) return null;

  let best: (StationSearchEntry & { distanceMeters: number }) | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const distanceMeters = haversineDistanceMeters(lat, lng, entry.lat, entry.lon);
    if (distanceMeters < bestDistance) {
      bestDistance = distanceMeters;
      best = { ...entry, distanceMeters };
    }
  }

  if (!best) return null;
  return best.distanceMeters <= maxDistanceMeters ? best : null;
}

function findNearestPostcodeMatch(query: string, entries: FloodSearchEntry[]): FloodSearchEntry | null {
  if (!entries.length) return null;

  const queryOutcode = deriveSearchOutcode(query);
  let best: FloodSearchEntry | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const entryKey = entry.postcodeKey;
    if (!entryKey) continue;

    const entryOutcode = deriveSearchOutcode(entryKey);
    const sameOutcodePenalty = queryOutcode && entryOutcode && queryOutcode === entryOutcode ? 0 : 3;
    const distance = levenshteinDistance(query, entryKey);
    const score = distance + sameOutcodePenalty;

    if (score < bestScore) {
      bestScore = score;
      best = entry;
      if (score === 0) break;
    }
  }

  return best;
}

function findNearestSchoolPostcodeMatch(query: string, entries: SchoolSearchEntry[]): SchoolSearchEntry | null {
  if (!entries.length) return null;

  const queryOutcode = deriveSearchOutcode(query);
  let best: SchoolSearchEntry | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const entryKey = entry.postcodeKey;
    if (!entryKey) continue;

    const entryOutcode = deriveSearchOutcode(entryKey);
    const sameOutcodePenalty = queryOutcode && entryOutcode && queryOutcode === entryOutcode ? 0 : 3;
    const distance = levenshteinDistance(query, entryKey);
    const score = distance + sameOutcodePenalty;

    if (score < bestScore) {
      bestScore = score;
      best = entry;
      if (score === 0) break;
    }
  }

  return best;
}

function pickRepresentativeHierarchyMatch(map: maplibregl.Map, entries: FloodSearchEntry[]): FloodSearchEntry {
  if (entries.length === 1) return entries[0];

  const center = map.getCenter();
  let best = entries[0];
  let bestDistance = haversineDistanceMeters(center.lat, center.lng, best.lat, best.lon);

  for (let i = 1; i < entries.length; i += 1) {
    const candidate = entries[i];
    const distance = haversineDistanceMeters(center.lat, center.lng, candidate.lat, candidate.lon);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function deriveSearchOutcode(postcodeKey: string): string {
  const text = normalizePostcodeSearch(postcodeKey);
  if (text.length <= 3) return text;
  return text.slice(0, text.length - 3);
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = prev[j] + 1;
      const insertion = curr[j - 1] + 1;
      const substitution = prev[j - 1] + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}





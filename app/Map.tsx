"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type GridSize = "1km" | "5km" | "10km" | "25km";
type Metric = "median" | "median_ppsf" | "delta_gbp" | "delta_pct";
type ValueFilterMode = "off" | "lte" | "gte";
type FloodOverlayMode = "off" | "on" | "on_hide_cells";
type SchoolOverlayMode = "off" | "on" | "on_hide_cells";
type StationOverlayMode = "off" | "on" | "on_hide_cells";
type VoteOverlayMode = "off" | "on";
type VoteColorScale = "relative" | "absolute";

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
  stationOverlayMode?: StationOverlayMode;
  voteOverlayMode?: VoteOverlayMode;
  voteColorScale?: VoteColorScale;
};

export type IndexPrefs = {
  budget: number;           // target price (median GBP or PPSF depending on metric)
  propertyType: "ALL" | "D" | "S" | "T" | "F"; // property type for affordability
  affordWeight: number;     // 0-10 importance
  floodWeight: number;      // 0-10 importance
  schoolWeight: number;     // 0-10 importance
  trainWeight: number;      // 0-10 importance (nearest station distance)
  coastWeight: number;      // 0-10 importance (placeholder for now)
  indexFilterMode?: "off" | "lte" | "gte";
  indexFilterThreshold?: number; // 0..1
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
};

function isDeltaMetric(metric: Metric) {
  return metric === "delta_gbp" || metric === "delta_pct";
}

function metricPropName(metric: Metric): "median" | "delta_gbp" | "delta_pct" {
  if (metric === "delta_gbp" || metric === "delta_pct") return metric;
  return "median";
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

const VOTE_CELLS_DATA_VERSION = process.env.NEXT_PUBLIC_VOTE_CELLS_DATA_VERSION ?? "20260222b";

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
  const locateMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [postcodeCell, setPostcodeCell] = useState<string | null>(null);
  const [postcodeItems, setPostcodeItems] = useState<string[]>([]);
  const [postcodeTotal, setPostcodeTotal] = useState(0);
  const [postcodeOffset, setPostcodeOffset] = useState(0);
  const [postcodeLoading, setPostcodeLoading] = useState(false);
  const [postcodeError, setPostcodeError] = useState<string | null>(null);
  const [scotlandNote, setScotlandNote] = useState<string | null>(null);
  const [postcodeMaxPrice, setPostcodeMaxPrice] = useState<number | null>(null);
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


  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    easyColoursRef.current = easyColours ?? false;
  }, [easyColours]);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    onPostcodeSearchResultRef.current = onPostcodeSearchResult;
  }, [onPostcodeSearchResult]);

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

  map.addSource("station-overlay", {
    type: "geojson",
    data: "/api/stations?plain=1",
    cluster: true,
    clusterMaxZoom: 9,
    clusterRadius: 40,
  });

  map.addSource("station-search-focus", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addSource("postcode-search-marker", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
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
    id: "cells-fill",
    type: "fill",
    source: "cells",
    paint: {
      "fill-color": getFillColorExpression(state.metric, easyColoursRef.current),
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
      "text-field": "🚂",
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 6, 13, 8, 17, 10, 22] as any,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-anchor": "center",
    },
    paint: {
      "text-halo-color": "rgba(0,0,0,0.6)",
      "text-halo-width": 1.2,
      "text-opacity": 0.97,
    },
  });

  // ── Station search focus layers ──
  // Rail casing (wide white base — ballast/sleeper ground)
  map.addLayer({
    id: "station-search-focus-rail-casing",
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

  const showSchoolPointPopup = (e: any) => {
    const f = e.features?.[0] as any;
    if (!f) return;

    const p = f.properties || {};
    const schoolName = String(p.school_name ?? "School");
    const postcode = String(p.postcode ?? p.postcode_key ?? "Unknown postcode");
    const qualityScore = Number(p.quality_score ?? NaN);
    const qualityBand = String(p.quality_band ?? "Unknown");
    const schoolNameHtml = escapeHtml(schoolName);
    const postcodeHtml = escapeHtml(postcode);
    const qualityBandHtml = escapeHtml(qualityBand);

    const html = `
      <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
        <div style="font-weight: 700; margin-bottom: 4px;">${schoolNameHtml}</div>
        <div>Postcode: <b>${postcodeHtml}</b></div>
        <div>School quality: <b>${qualityBandHtml}</b></div>
        <div>Score: <b>${Number.isFinite(qualityScore) ? qualityScore.toFixed(3) : "N/A"}</b></div>
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

  map.on("click", "flood-overlay-points", (e) => {
    if (!useFloodPopupMode()) return;
    showFloodPointPopup(e);
  });

  map.on("click", "flood-overlay-clusters", (e) => {
    if (!useFloodPopupMode()) return;
    showFloodClusterPopup(e);
  });

  map.on("click", "flood-overlay-cluster-count", (e) => {
    if (!useFloodPopupMode()) return;
    showFloodClusterPopup(e);
  });

  map.on("click", "school-overlay-points", (e) => {
    if (!useSchoolPopupMode()) return;
    showSchoolPointPopup(e);
  });

  map.on("click", "school-overlay-clusters", (e) => {
    if (!useSchoolPopupMode()) return;
    showSchoolClusterPopup(e);
  });

  map.on("click", "school-overlay-cluster-count", (e) => {
    if (!useSchoolPopupMode()) return;
    showSchoolClusterPopup(e);
  });

  map.on("mousemove", "cells-fill", (e) => {
    const voteMode = stateRef.current.voteOverlayMode ?? "off";
    if (useFloodPopupMode() || useSchoolPopupMode()) {
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

        let html = `<div style="font-family:system-ui;font-size:12px;line-height:1.4;min-width:180px;max-width:210px;">`;
        const totalCol = totalScore < 0.35 ? "#ef4444" : totalScore < 0.55 ? "#fb923c" : totalScore < 0.72 ? "#facc15" : "#4ade80";
        html += `<div style="font-weight:700;margin-bottom:7px;font-size:13px;">🗺️ Match score: <span style="color:${totalCol}">${Math.round(totalScore * 100)}%</span></div>`;
        const ptLabels: Record<string, string> = { ALL: "All types", D: "Detached", S: "Semi", T: "Terraced", F: "Flat" };
        const ptLabel = ptLabels[prefs.propertyType ?? "ALL"] ?? "";
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
        if (prefs.floodWeight > 0)  html += wRow("🌊 Flood safety",   prefs.floodWeight,  bar(Number(p.ix_f ?? 0.5), p.ix_fn === 1));
        if (prefs.schoolWeight > 0) html += wRow("🏫 Schools",        prefs.schoolWeight, bar(Number(p.ix_s ?? 0.5), p.ix_sn === 1));
        if (prefs.trainWeight > 0)  html += wRow("🚂 Train station",  prefs.trainWeight,  bar(Number(p.ix_t ?? 0.5), p.ix_tn === 1));
        if (prefs.coastWeight > 0)  html += wRow("🏖️ Coast",          prefs.coastWeight,  bar(0.5, true));
        html += `</div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        return;
      }
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
      html = `
        <div style="font-family: system-ui; font-size: 12px; line-height: 1.25;">
          <div style="font-weight: 700; margin-bottom: 4px;">${metricTitle}</div>
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
    if (useFloodPopupMode() || useSchoolPopupMode()) {
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
    void fetchPostcodesRef.current(gx, gy, 0, false);
  });

  // Initial real data load
  const initFc = await setRealData(map, state, geoCacheRef.current, undefined, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current);
  if (initFc) cellFcRef.current = initFc;
  if (indexPrefsRef.current) {
    void applyIndexScoring(map, indexPrefsRef.current, stateRef.current, cellFcRef.current ?? undefined).then((ok) => {
      if (ok) { prevIndexActiveRef.current = true; onIndexScoringAppliedRef.current?.(); }
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
    setIsLoading(true);

    const debounceMs = 200;
    const timeoutId = setTimeout(() => {
      setRealData(map, state, geoCacheRef.current, abortController.signal, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current)
        .then((fc) => {
          if (fc) cellFcRef.current = fc;
          if (indexPrefsRef.current) {
            void applyIndexScoring(map, indexPrefsRef.current, stateRef.current, cellFcRef.current ?? undefined).then((ok) => {
              if (ok) { prevIndexActiveRef.current = true; onIndexScoringAppliedRef.current?.(); }
            });
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
  }, [state.grid, state.propertyType, state.newBuild, state.endMonth, state.metric, state.voteOverlayMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("load", () => applyValueFilter(map, stateRef.current, indexPrefsRef.current));
      return;
    }

    applyValueFilter(map, state, indexPrefsRef.current);
  }, [state.metric, state.valueFilterMode, state.valueThreshold]);

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
          const ok = await applyIndexScoring(map, indexPrefs, stateRef.current, cellFcRef.current ?? undefined);
          if (ok) onIndexScoringAppliedRef.current?.();
        })();
      } else {
        applyCombinedCellFilters(map, stateRef.current, indexPrefs);
      }
    } else if (prevIndexActiveRef.current) {
      // Restore opacity then re-apply quantile colour mapping (NOT static getFillColorExpression)
      if (map.getLayer("cells-fill")) {
        const hideCells =
          (stateRef.current.floodOverlayMode ?? "off") === "on_hide_cells" ||
          (stateRef.current.schoolOverlayMode ?? "off") === "on_hide_cells";
        map.setPaintProperty("cells-fill", "fill-opacity", hideCells ? 0.09 : 0.42);
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
    const stationMode = state.stationOverlayMode ?? "off";
    const floodVisibility = floodMode === "off" ? "none" : "visible";
    const schoolVisibility = schoolMode === "off" ? "none" : "visible";
    const stationVisibility = stationMode === "off" ? "none" : "visible";
    const hideCellsMode = floodMode === "on_hide_cells" || schoolMode === "on_hide_cells" || stationMode === "on_hide_cells";

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
        if (schoolMode === "off") setSchoolSearchFocus(map, null, null, null);

        // Station layer visibility
        if (map.getLayer("station-overlay-points")) map.setLayoutProperty("station-overlay-points", "visibility", stationVisibility);
        if (map.getLayer("station-overlay-clusters")) map.setLayoutProperty("station-overlay-clusters", "visibility", stationVisibility);
        if (map.getLayer("station-overlay-cluster-count")) map.setLayoutProperty("station-overlay-cluster-count", "visibility", stationVisibility);
        if (stationMode === "off") setStationSearchFocus(map, null, null);

        // Cell opacity — applied in the same call so it cannot be skipped by a mid-layout bail
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
  }, [state.floodOverlayMode, state.schoolOverlayMode, state.stationOverlayMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Use getLayer check rather than isStyleLoaded() — sources loading asynchronously
    // can cause isStyleLoaded() to return false even on a live map.
    if (!map.getLayer("cells-fill")) return;

    const mode = state.voteOverlayMode ?? "off";
    const scale = state.voteColorScale ?? "relative";

    try {
      if (mode === "off") {
        void ensureAggregatesAndUpdate(map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColoursRef.current);
      } else {
        applyVoteOverlayColorFromSource(map, scale);
      }
    } catch (e) {
      // ignore
    }
  }, [state.voteOverlayMode, state.voteColorScale, onLegendChange]);

  // Re-apply colour ramps whenever the easy-colours (colourblind) preference changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("cells-fill")) return;
    const mode = stateRef.current.voteOverlayMode ?? "off";
    if (mode !== "off") return; // vote overlay controls its own colours
    void ensureAggregatesAndUpdate(
      map, stateRef.current, geoCacheRef.current, onLegendChange, onStatsUpdateRef.current, easyColours ?? false
    );
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
        style={{ display: "none" }}
      />
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
  easy = false
): Promise<any> {
  // Determine if we're fetching delta or regular data
  const isDelta = isDeltaMetric(state.metric);
  const endpoint = isDelta ? "/api/deltas" : "/api/cells";

  const endMonth = isDelta ? undefined : state.endMonth ?? "LATEST";
  const cacheKey = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth ?? "LATEST"}|${VOTE_CELLS_DATA_VERSION}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    const src = map.getSource("cells") as maplibregl.GeoJSONSource;
    src.setData(cached);
    if ((state.voteOverlayMode ?? "off") !== "off") {
      applyVoteOverlayColorFromSource(map, state.voteColorScale ?? "relative", cached);
    }
    await ensureAggregatesAndUpdate(map, state, cache, onLegendChange, onStatsUpdate, easy);
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
  if ((state.voteOverlayMode ?? "off") !== "off") {
    applyVoteOverlayColorFromSource(map, state.voteColorScale ?? "relative", fc);
  }
  await ensureAggregatesAndUpdate(map, state, cache, onLegendChange, onStatsUpdate, easy);
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
  easy = false
) {
  try {
    const voteModeActive = (state.voteOverlayMode ?? "off") !== "off";
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

      if (!voteModeActive && map.getLayer("cells-fill")) {
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
    const key25 = `25km|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth}|${VOTE_CELLS_DATA_VERSION}`;
    let fc25 = cache.get(key25);

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
    const keyCur = `${state.grid}|${state.propertyType}|${state.newBuild}|${state.metric}|${endMonth}|${VOTE_CELLS_DATA_VERSION}`;
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
        const colors = makeTailColors(easy);
        const safeBreaks = ensureStrictlyIncreasingBreaks(breaks);
        const expr = buildTailColorExpression(metricPropName(state.metric), safeBreaks, colors, true);
        if (!voteModeActive && map.getLayer("cells-fill")) {
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
          const expr = buildTailColorExpression(metricPropName(state.metric), linearBreaks, colors, true);
          if (!voteModeActive && map.getLayer("cells-fill")) {
            map.setPaintProperty("cells-fill", "fill-color", expr);
          }
          if (onLegendChange) {
            onLegendChange({ kind: "median", breaks: linearBreaks, colors, probs: QUANTILE_PROBS });
          }
        } else {
          if (!voteModeActive && map.getLayer("cells-fill")) {
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
    const raw = Number(p[metricProp] ?? NaN);
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

  const prop = metricPropName(state.metric);

  // Coalesce missing values to 0 so the filter behaves deterministically.
  return [op, ["coalesce", ["get", prop], 0], threshold] as any;
}

function buildIndexFilter(indexPrefs: IndexPrefs | null | undefined) {
  if (!indexPrefs) return null;
  const mode = indexPrefs.indexFilterMode ?? "off";
  if (mode === "off") return null;
  const threshold = Math.max(0, Math.min(1, Number(indexPrefs.indexFilterThreshold ?? 0.6)));
  const op = mode === "lte" ? "<=" : ">=";
  return [op, ["coalesce", ["get", "index_score"], 0], threshold] as any;
}

function applyCombinedCellFilters(
  map: maplibregl.Map,
  state: MapState,
  indexPrefs: IndexPrefs | null | undefined
) {
  const valueFilter = buildValueFilter(state);
  const indexFilter = buildIndexFilter(indexPrefs);
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
    prefs.trainWeight,
    prefs.coastWeight,
  ].join("|");
}

/* ─── Index "Find My Area" scoring ─── */

// Module-level cache for overlay data + spatial grid indexes (built once per session)
let _indexFloodCache: Array<{ lon: number; lat: number; riskScore: number }> | null = null;
let _indexSchoolCache: Array<{ lon: number; lat: number; qualityScore: number; isGood: boolean }> | null = null;
let _indexStationCache: Array<{ lon: number; lat: number; name: string; code: string }> | null = null;
let _indexCellsCache: { key: string; lookup: Map<string, number> } | null = null;

type SpatialGrid<T> = { buckets: Map<number, T[]>; cellSize: number };
let _indexFloodGrid: SpatialGrid<{ lon: number; lat: number; riskScore: number }> | null = null;
let _indexSchoolGrid: SpatialGrid<{ lon: number; lat: number; qualityScore: number; isGood: boolean }> | null = null;
let _indexStationGrid: SpatialGrid<{ lon: number; lat: number; name: string; code: string }> | null = null;

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

  // — Fetch flood data once, build grid index —
  if (_indexFloodCache === null) {
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
  }

  // — Fetch school data once, build grid index —
  if (_indexSchoolCache === null) {
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
          }));
      } else {
        _indexSchoolCache = [];
      }
    } catch {
      _indexSchoolCache = [];
    }
    _indexSchoolGrid = null;
  }

  // — Fetch station data once, build grid index —
  if (_indexStationCache === null) {
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
  }

  // Build spatial grid indexes (skipped if already built)
  const GRID_CELL = 0.12; // ~13km buckets
  if (_indexFloodGrid === null) _indexFloodGrid = buildSpatialGrid(_indexFloodCache!, GRID_CELL);
  if (_indexSchoolGrid === null) _indexSchoolGrid = buildSpatialGrid(_indexSchoolCache!, GRID_CELL);
  if (_indexStationGrid === null && _indexStationCache !== null) _indexStationGrid = buildSpatialGrid(_indexStationCache, GRID_CELL);

  const floodGrid = _indexFloodGrid;
  const schoolGrid = _indexSchoolGrid;
  const stationGrid = _indexStationGrid;
  const metricProp = metricPropName(state.metric);

  // — Fetch property-type-specific cell data for affordability reference —
  let ptLookup: Map<string, number> | null = null;
  const indexPT = prefs.propertyType ?? "ALL";
  if (prefs.affordWeight > 0) {
    const isDelta = isDeltaMetric(state.metric);
    const endpoint = isDelta ? "/api/deltas" : "/api/cells";
    const endMonth = isDelta ? undefined : state.endMonth ?? "LATEST";
    const ptKey = `${state.grid}|${indexPT}|${state.newBuild}|${state.metric}|${endMonth ?? "LATEST"}`;
    if (_indexCellsCache?.key === ptKey) {
      ptLookup = _indexCellsCache.lookup;
    } else {
      try {
        const qs = new URLSearchParams({ grid: state.grid, propertyType: indexPT, newBuild: state.newBuild ?? "ALL" });
        if (!isDelta) { qs.set("metric", state.metric); qs.set("endMonth", endMonth!); }
        const res = await fetch(`${endpoint}?${qs.toString()}`);
        if (res.ok) {
          const payload = (await res.json()) as any;
          const rows: any[] = Array.isArray(payload?.features) ? payload.features : (Array.isArray(payload?.rows) ? payload.rows : []);
          ptLookup = new Map<string, number>();
          for (const item of rows) {
            const p = item?.properties ?? item;
            const gx = Number(p.gx); const gy = Number(p.gy);
            const val = Number(p[metricProp] ?? 0) || 0;
            if (Number.isFinite(gx) && Number.isFinite(gy) && val > 0) {
              ptLookup.set(`${gx}_${gy}`, val);
            }
          }
          _indexCellsCache = { key: ptKey, lookup: ptLookup };
        }
      } catch { /* use existing cell values */ }
    }
  }

  // Tight search radius for scoring (~8km), wide radius for data-coverage check (~50km)
  const NEAR_DEG = 0.08;
  const DATA_DEG = 0.45;
  const CHUNK = 300; // yield to browser every N cells

  const features = fc.features;

  // ─── Flood pre-pass: compute raw impact for every cell, collect for percentile ranking ───
  type FloodMeta = { rawImpact: number; hasData: boolean; hasInCellRisk: boolean };
  const floodMeta: FloodMeta[] = new Array(features.length);
  const floodRawPositive: number[] = []; // only cells with actual flood impact > 0
  for (let i = 0; i < features.length; i++) {
    const coords = features[i].geometry?.coordinates?.[0];
    if (!coords || coords.length < 4) { floodMeta[i] = { rawImpact: 0, hasData: false, hasInCellRisk: false }; continue; }
    const cLon = (coords[0][0] + coords[2][0]) / 2;
    const cLat = (coords[0][1] + coords[2][1]) / 2;
    if (querySpatialGrid(floodGrid, cLon, cLat, DATA_DEG).length === 0) {
      floodMeta[i] = { rawImpact: 0, hasData: false, hasInCellRisk: false }; continue;
    }
    const minLon = Math.min(coords[0][0], coords[2][0]);
    const maxLon = Math.max(coords[0][0], coords[2][0]);
    const minLat = Math.min(coords[0][1], coords[2][1]);
    const maxLat = Math.max(coords[0][1], coords[2][1]);
    const nearFloodPoints = querySpatialGrid(floodGrid, cLon, cLat, NEAR_DEG);
    const hasInCellRisk = nearFloodPoints.some((fp) => fp.lon >= minLon && fp.lon <= maxLon && fp.lat >= minLat && fp.lat <= maxLat);
    if (!hasInCellRisk) {
      floodMeta[i] = { rawImpact: 0, hasData: true, hasInCellRisk: false };
      continue;
    }
    let raw = 0;
    for (const fp of nearFloodPoints) {
      const d = haversineDistanceMeters(cLat, cLon, fp.lat, fp.lon);
      if (d < 8000) {
        const proximity = 1 - d / 8000;
        const risk = Number(fp.riskScore ?? 0);
        // Strongly prioritise medium/high risk over low risk for relative flood-zone scoring.
        // Requested weighting: low ≈ 10x less than medium, high ≈ 5x more than medium.
        const severityWeight = risk >= 4 ? 5 : risk >= 3 ? 1 : risk >= 2 ? 0.1 : risk >= 1 ? 0.05 : 0;
        raw += severityWeight * proximity * proximity;
      }
    }
    floodMeta[i] = { rawImpact: raw, hasData: true, hasInCellRisk: true };
    if (raw > 0) floodRawPositive.push(raw);
  }
  floodRawPositive.sort((a, b) => a - b);
  const nFloodPos = floodRawPositive.length;
  // Binary upper-bound search → percentile rank (0 = safest, 1 = worst)
  const floodPercentileRank = (v: number): number => {
    let lo = 0, hi = nFloodPos;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (floodRawPositive[mid] <= v) lo = mid + 1; else hi = mid; }
    return nFloodPos > 0 ? lo / nFloodPos : 0;
  };

  for (let i = 0; i < features.length; i++) {
    // Yield to browser between chunks so UI stays responsive
    if (i > 0 && i % CHUNK === 0) await new Promise<void>((r) => setTimeout(r, 0));

    const feature = features[i];
    const props = feature.properties ?? {};
    const coords = feature.geometry?.coordinates?.[0];
    if (!coords || coords.length < 4) { props.index_score = 0; continue; }

    const cLon = (coords[0][0] + coords[2][0]) / 2;
    const cLat = (coords[0][1] + coords[2][1]) / 2;

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
      if (cellValue > 0 && prefs.budget > 0) {
        const ratio = cellValue / prefs.budget;
        affordScore = Math.max(0, Math.min(1, (1.6 - ratio) / 0.9));
      } else {
        affordScore = 0.5;
      }
      totalScore += prefs.affordWeight * affordScore;
      totalWeight += prefs.affordWeight;
    }
    props.ix_a = affordScore;

    // 2) Flood risk — relative/percentile: score vs all other cells in England (pre-computed)
    let floodScore = 0.5;
    let floodNoData = false;
    if (prefs.floodWeight > 0) {
      const fm = floodMeta[i];
      if (!fm || !fm.hasData) {
        // No dataset coverage (Wales, Scotland) — neutral
        floodNoData = true;
        floodScore = 0.5;
      } else if (!fm.hasInCellRisk || fm.rawImpact === 0) {
        // Has coverage but no flood zones within 8km → genuinely safe (top score)
        floodScore = 1.0;
      } else {
        // Percentile rank relative to all flood-impacted cells in the UK
        // rank 0 = least impacted → score 1.0; rank 1 = most impacted → score 0.0
        const rank = floodPercentileRank(fm.rawImpact);
        floodScore = Math.max(0, 1 - rank);
      }
      totalScore += prefs.floodWeight * floodScore;
      totalWeight += prefs.floodWeight;
    }
    props.ix_f = floodScore;
    props.ix_fn = floodNoData ? 1 : 0;

    // 3) School quality — distinguish "no nearby school" from "no data area"
    let schoolScore = 0.5;
    let schoolNoData = false;
    if (prefs.schoolWeight > 0) {
      // Wide check: any school data within ~50km?
      const wideSchool = querySpatialGrid(schoolGrid, cLon, cLat, DATA_DEG);
      if (wideSchool.length === 0) {
        // No dataset coverage (Wales/Scotland use different inspectorates) → neutral
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
      }
      totalScore += prefs.schoolWeight * schoolScore;
      totalWeight += prefs.schoolWeight;
    }
    props.ix_s = schoolScore;
    props.ix_sn = schoolNoData ? 1 : 0;

    // 4) Train station proximity — score by distance to nearest station
    let trainScore = 0.5;
    let trainNoData = false;
    if (prefs.trainWeight > 0) {
      // Wide check: any station data within ~80km?
      const wideStation = stationGrid ? querySpatialGrid(stationGrid, cLon, cLat, DATA_DEG * 3) : [];
      if (wideStation.length === 0) {
        // No dataset coverage (e.g. remote island with no station data) → neutral
        trainNoData = true;
        trainScore = 0.5;
      } else {
        // Find nearest station
        let minDist = Infinity;
        for (const sp of wideStation) {
          const d = haversineDistanceMeters(cLat, cLon, sp.lat, sp.lon);
          if (d < minDist) minDist = d;
        }
        if (minDist <= STATION_GOOD_DISTANCE_METERS) {
          trainScore = 1.0; // within 1 mile — full score
        } else if (minDist >= STATION_MAX_DISTANCE_METERS) {
          trainScore = 0.0; // beyond 20 miles — zero
        } else {
          // Linear decay between 1 mile and 20 miles
          trainScore = 1 - (minDist - STATION_GOOD_DISTANCE_METERS) / (STATION_MAX_DISTANCE_METERS - STATION_GOOD_DISTANCE_METERS);
        }
      }
      totalScore += prefs.trainWeight * trainScore;
      totalWeight += prefs.trainWeight;
    }
    props.ix_t = trainScore;
    props.ix_tn = trainNoData ? 1 : 0;

    // 5) Coast proximity (placeholder)
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
    //   veto multiplier *= 1 − weight × shortfall × 0.5
    // At weight=1, score=0 (worst case): multiplier = 0.5 — halves the base score.
    // At weight=0.2, score=0: multiplier = 0.9 — barely noticeable.
    // Affordability is excluded because it already has budget-relative semantics.
    let vetoMultiplier = 1.0;
    if (prefs.floodWeight > 0 && !floodNoData && floodScore < 0.5) {
      const shortfall = (0.5 - floodScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - prefs.floodWeight * shortfall * 0.5);
    }
    if (prefs.schoolWeight > 0 && !schoolNoData && schoolScore < 0.5) {
      const shortfall = (0.5 - schoolScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - prefs.schoolWeight * shortfall * 0.5);
    }
    if (prefs.trainWeight > 0 && !trainNoData && trainScore < 0.5) {
      const shortfall = (0.5 - trainScore) / 0.5;
      vetoMultiplier *= Math.max(0, 1 - prefs.trainWeight * shortfall * 0.5);
    }

    const baseScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    props.index_score = Math.max(0, baseScore * vetoMultiplier);
  }

  src.setData(fc as any);

  if (map.getLayer("cells-fill")) {
    const baseOpacityExpr = [
      "interpolate", ["linear"], ["get", "index_score"],
      0, 0.25, 0.3, 0.4, 0.7, 0.65, 1, 0.85,
    ] as any;
    map.setPaintProperty("cells-fill", "fill-color", [
      "interpolate", ["linear"], ["get", "index_score"],
      0,    "#d73027",
      0.25, "#f46d43",
      0.5,  "#ffffbf",
      0.75, "#66bd63",
      1,    "#1a9850",
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
    if (easy) return [
      "interpolate", ["linear"], ["get", "median"],
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
          properties: { role: "link" },
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
        properties: { role: "link" },
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





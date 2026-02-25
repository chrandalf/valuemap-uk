# Index Scoring (Area Suitability Score)

## Purpose

Allows users to score every visible grid cell by weighted criteria (affordability, flood risk, school quality, coastline proximity) to produce a composite suitability index shown as a map overlay.

## Location

Client-side logic in `app/Map.tsx` and `app/page.tsx`. No server-side component — scoring happens in the browser using data already loaded for the map layers.

## User-Facing Inputs (`IndexPrefs`)

```typescript
type IndexPrefs = {
  budget: number;           // target price in GBP (or £/sqft if metric=median_ppsf)
  propertyType: "ALL" | "D" | "S" | "T" | "F";
  affordWeight: number;     // 0–10
  floodWeight: number;      // 0–10
  schoolWeight: number;     // 0–10
  coastWeight: number;      // 0–10 (placeholder, not yet implemented)
  indexFilterMode?: "off" | "lte" | "gte";
  indexFilterThreshold?: number;  // 0..1
};
```

Default weights: `affordWeight=5, floodWeight=5, schoolWeight=5, coastWeight=0`.

## State Management

`indexApplied` (in `page.tsx`) is a frozen snapshot applied when the user clicks "Score areas". The live slider values (`indexBudget`, `indexAffordWeight`, etc.) do not trigger a re-score until the button is clicked. This avoids excessive re-computation during slider drag.

```typescript
const computedIndexPrefs: IndexPrefs | null = useMemo(() => {
  if (!indexActive) return null;
  return {
    budget: indexApplied.budget,
    // ... other applied values
    indexFilterMode: indexSuitabilityMode,
    indexFilterThreshold: indexSuitabilityThreshold / 100,
  };
}, [indexActive, indexToken, indexApplied, indexSuitabilityMode, indexSuitabilityThreshold]);
```

`indexToken` is incremented on button click to force re-evaluation even if values are unchanged.

## Scoring Logic (Map.tsx)

The index score per cell is computed inside the MapLibre GL data expression or a post-fetch JavaScript loop over the loaded `ApiRow[]` array. The composite score formula follows this pattern:

1. **Affordability sub-score**: `1 - abs(median - budget) / budget` clamped to `[0, 1]`. Cells near the budget score highest; cells far above or below score lower.

2. **Flood sub-score**: derived from the flood overlay data (if loaded). Cells with no flood risk score `1.0`; high-risk cells score `0.0`.

3. **School sub-score**: derived from the school overlay (if loaded). Uses the `quality_score` [0, 1] of the nearest school within range.

4. **Coast sub-score**: placeholder weight, currently always `0` contribution.

5. **Composite**: weights are normalised (divided by their sum) before multiplying by sub-scores:
```
index = (affordWeight * afford + floodWeight * flood + schoolWeight * school)
        / (affordWeight + floodWeight + schoolWeight)
```

6. **Filter**: if `indexFilterMode = "lte"`, cells with `index > threshold` are hidden (show only affordable / low-risk areas); `"gte"` hides cells below threshold.

## Visual Output

When `indexActive` is true, the standard price colour ramp is replaced by the index colour ramp. The ramp runs from a cold colour (low suitability) to a warm colour (high suitability). The legend panel updates to show the index scale rather than price breaks.

## Limitations

- Coast weight is implemented as a UI control but not wired to actual coastline distance data. Setting it > 0 has no effect on scoring.
- Flood and school sub-scores require their respective overlays to be loaded. If the overlays are off, those dimensions are either zeroed or omitted from the weighted sum.
- Scoring is entirely client-side. Large datasets (1km grid) may cause visible lag when re-scoring.

# KS4 2024/25 schools: analysis + integration plan

## What is usable in this file

Input analyzed: `202425_performance_tables_schools_revised.csv`

- Total rows: **40,285**
- Rows at school-level overall total (`breakdown_topic=Total`, `breakdown=Total`): **5,755**
- Rows with core headline metrics present (`attainment8_average`, `engmath_95_percent`, `ebacc_aps_average`): **4,738**
- Missing/suppression markers observed in core metrics: **`z`**, **`c`**
- `progress8_average` currently has no numeric values for this release (as expected from DfE notes)

Identifiers present for joining:
- `school_urn`
- `school_laestab`
- `school_name`
- `la_name`
- `establishment_type_group`

Important limitation:
- No postcode/lat/lon in this file, so geographic mapping requires a separate school reference dataset (e.g., GIAS) joined via `school_urn`.

## Suggested "good vs bad" measure

Use a **relative quality score** from 0..1 built from percentile ranks of the headline attainment measures:

- `attainment8_average` (weight 0.35)
- `engmath_95_percent` (weight 0.35)
- `ebacc_aps_average` (weight 0.20)
- `ebacc_entering_percent` (weight 0.10)

Formula:

`quality_score = 0.35*rank(att8) + 0.35*rank(engmath95) + 0.20*rank(ebacc_aps) + 0.10*rank(ebacc_entering)`

Interpretation bands:
- `<0.10` Very weak
- `0.10-0.25` Weak
- `0.25-0.40` Below average
- `0.40-0.60` Average
- `0.60-0.75` Good
- `0.75-0.90` Strong
- `>=0.90` Excellent

Confidence flag (for map UX):
- `low` if `pupil_count < 20`
- `medium` if `20 <= pupil_count < 60`
- `high` if `>= 60`

## Outputs already generated

Script added: `pipeline/build_school_scores.py`

Generated files:
- `public/data/school_scores_202425.csv` (all school types)
- `public/data/school_scores_202425_mainstream.csv` (`--mainstream-only`, excludes independent/special groups)

## Recommended integration into valuemap

1. **Create geocoded school master**
   - Bring in GIAS (or equivalent) with `URN -> postcode/easting/northing`.
   - Join to `school_scores_202425_mainstream.csv` on `school_urn`.

2. **Assign schools to grid cells**
   - Convert coordinates to your map CRS and assign each school to 1km/5km/10km/25km cells (same pattern as vote-cell assets).

3. **Publish cell-level school assets**
   - Per cell store at least:
     - `school_count`
     - `school_quality_mean` (weighted by pupil count)
     - `school_quality_median`
     - `school_good_share` (share of schools with `quality_score >= 0.60`)
     - `school_conf_low_share`

4. **UI/legend behavior**
   - Add a school overlay toggle with a diverging scale:
     - red = weaker outcomes
     - neutral = average
     - blue/green = stronger outcomes
   - Add a "sample size" warning when `school_count` is small.

5. **Interpretation safeguards**
   - Label as attainment-based (not value-added/progress) due to current Progress 8 publication gap.
   - Expose confidence and school count in popups.

## Why this is robust enough for first release

- Uses published headline KS4 outcomes directly.
- Avoids Progress 8 (currently unavailable/unreliable for this cycle).
- Separates score (performance) from confidence (cohort stability), which reduces overinterpretation of tiny cohorts.

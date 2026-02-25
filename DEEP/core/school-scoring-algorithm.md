# School Scoring Algorithm

## Purpose

Converts DfE KS4 (GCSE) performance data into a normalised `quality_score` [0, 1] per school, suitable for geographic overlay on the map.

## Source Files

- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_school_scores.py` — scores from performance tables CSV (used for `--mainstream-only` overlay)
- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_school_postcode_scores.py` — scores from KS4 revised CSV (includes school postcodes for geocoding)
- `/Users/bsr/repos/repos-external/valuemap-uk/pipeline/build_school_overlay_points.py` — converts scored CSV to GeoJSON overlay

## Input Source Data

| File | Purpose |
|---|---|
| `pipeline/data/raw/schools/202425_performance_tables_schools_revised.csv` | DfE performance tables — used by `build_school_scores.py` |
| `pipeline/data/raw/schools/england_ks4revised.csv` | KS4 revised with school postcodes — used by `build_school_postcode_scores.py` |

## Scoring Metrics

Four KS4 metrics are combined. Both scripts use identical weights:

| Metric | DfE Column | Weight | Description |
|---|---|---|---|
| `att8` | `ATT8SCR` / `attainment8_average` | **0.35** | Attainment 8 average score |
| `em95` | `PTL2BASICS_95` / `engmath_95_percent` | **0.35** | % achieving grade 5+ in English + Maths |
| `ebaps` | `EBACCAPS` / `ebacc_aps_average` | **0.20** | EBacc average point score |
| `ebacc_enter` | `PTEBACC_E_PTQ_EE` / `ebent` | **0.10** | % entering EBacc |

Schools missing `att8`, `em95`, or `ebaps` are excluded (all three core metrics required).

## Algorithm

### Step 1 — Percentile ranking within cohort

For each metric, all valid values are sorted. Each school receives a rank in `[0, 1]`:
```python
def rank_percentiles(records, key):
    values = sorted(r[key] for r in records if r[key] is not None)
    n = len(values)
    for r in records:
        pos = bisect_right(values, r[key]) - 1
        r[f"{key}_rank"] = max(0.0, min(1.0, pos / (n - 1)))
```
Schools with a missing metric receive rank `0.5` (median).

### Step 2 — Weighted composite score

```python
quality_score = (
    0.35 * att8_rank +
    0.35 * em95_rank +
    0.20 * ebaps_rank +
    0.10 * ebacc_enter_rank
)
```

Result is in `[0, 1]`. Higher = better performing relative to the scoring cohort.

### Step 3 — Quality band

| Score range | Band |
|---|---|
| < 0.10 | Very weak |
| 0.10 – 0.25 | Weak |
| 0.25 – 0.40 | Below average |
| 0.40 – 0.60 | Average |
| 0.60 – 0.75 | Good |
| 0.75 – 0.90 | Strong |
| >= 0.90 | Excellent |

### Step 4 — Score confidence

Based on pupil count (`TOTPUPS`):

| Pupils | Confidence |
|---|---|
| < 20 | low |
| 20 – 59 | medium |
| >= 60 | high |

## Mainstream Filter

Both scripts support `--mainstream-only` to exclude independent and special schools from the scoring baseline. This ensures the percentile ranking reflects the state-school population.

`build_school_scores.py` uses `establishment_type_group` field:
```python
def is_mainstream_type(etg):
    text = etg.strip().lower()
    return ("special" not in text) and ("independent" not in text)
```

`build_school_postcode_scores.py` uses `NFTYPE` code:
```python
def is_mainstream_nftype(code):
    text = code.strip().upper()
    if text.startswith("IND"): return False  # independent
    if text.endswith("S"):     return False  # special
    return True
```

The pipeline produces mainstream-only variants as the default overlay output.

## Output Schema

Intermediate CSV fields (both scorers):
```
urn, school_name, la_name, postcode, postcode_key, outcode,
att8, em95, ebaps, ebacc_enter,
att8_rank, em95_rank, ebaps_rank, ebacc_enter_rank,
quality_score, quality_band, score_confidence
```

## GeoJSON Overlay

`build_school_overlay_points.py` geocodes the scored CSV using postcode coordinates, emitting `school_overlay_points.geojson.gz` with one Point feature per school.

Feature properties include `quality_score`, `quality_band`, `score_confidence`, `school_name`, `outcode`. These drive the map circle colour/size in `Map.tsx`.

## Design Notes

- Percentile ranking not raw scores: raw DfE scores are not comparable across years because the scoring methodology changes. Percentile ranks are stable relative comparisons within the same dataset year.
- Weights are heuristic (att8 + em95 dominate at 70% combined). No public rationale documented; the remaining 30% captures curriculum breadth.
- Scotland is absent: this scorer only covers England (DfE data). Scotland school data is not integrated.

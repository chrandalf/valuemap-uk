#!/usr/bin/env python3
"""
Build primary school Ofsted overlay GeoJSON from the Ofsted Management Information CSV.

Data source (download manually or via --download flag):
  https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes
  File: "Management information - state-funded schools - latest inspections as at ..."
  Save as: pipeline/data/raw/schools/ofsted_mi_state_schools.csv

Input:  ofsted_mi_state_schools.csv
Output: primary_school_overlay_points.geojson.gz

Uses postcodes.io batch lookup with the shared local cache to avoid repeated geocoding.

Ofsted Overall Effectiveness grades:
    1 = Outstanding
    2 = Good
    3 = Requires improvement
    4 = Inadequate
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

from paths import (
    INTERMEDIATE_SCHOOL_POSTCODE_CACHE,
    MODEL_PRIMARY_SCHOOL_OVERLAY_POINTS,
    RAW_OFSTED_MI,
    ensure_pipeline_dirs,
)

# ── Data constants ──────────────────────────────────────────────────────────

OFSTED_MI_URL = (
    "https://assets.publishing.service.gov.uk/media/698b20be95285e721cd7127d/"
    "Management_information_-_state-funded_schools_-_latest_inspections_as_at_31_Jan_2026.csv"
)

# Phases to include — Primary and Middle deemed primary
PRIMARY_PHASES = {"Primary", "Middle deemed primary"}

GRADE_LABELS: Dict[int, str] = {
    0: "Not graded",
    1: "Outstanding",
    2: "Good",
    3: "Requires improvement",
    4: "Inadequate",
}

# Colour per grade (for reference — used in Map.tsx)
GRADE_COLOURS: Dict[int, str] = {
    1: "#16a34a",  # green — Outstanding
    2: "#2563eb",  # blue  — Good
    3: "#f59e0b",  # amber — Requires improvement
    4: "#dc2626",  # red   — Inadequate
}

# Column name aliases — Ofsted MI column names vary slightly across years.
# Listed in preference order; first match wins.
# NOTE: From ~Nov 2024 Ofsted moved to a report card format. The CSV now exposes
# "Latest OEIF overall effectiveness" (the last old-style grade) alongside new
# report-card theme scores.  We still use the OEIF grade so the overlay remains
# comparable with the secondary-school overlay.
_COL_ALIASES: Dict[str, List[str]] = {
    "urn":            ["URN", "urn"],
    "school_name":    ["School name", "SCHNAME", "School Name"],
    "phase":          ["Ofsted phase", "Phase of education", "PHASE", "Ofsted Phase"],
    "effectiveness":  [
        "Latest OEIF overall effectiveness",   # post-Nov 2024 report-card format
        "Overall effectiveness",               # older format
        "Overall Effectiveness",
        "OVERALL_EFFECTIVENESS",
    ],
    "inspection_date": [
        "Inspection start date of latest OEIF graded inspection",  # post-Nov 2024
        "Inspection date",                                          # older format
        "Date of latest section 5 inspection",
        "INSPDATE",
    ],
    "postcode":       ["Postcode", "POSTCODE", "Post code"],
    "la_name":        ["LA name", "Local authority", "LA Name", "LANAME"],
    # Ungraded (monitoring) inspection — used as a fallback when no OEIF grade exists.
    # Schools with 'School remains Good/Outstanding' have a clear implied grade.
    "ungraded_outcome": ["Ungraded inspection overall outcome"],
    "ungraded_date":   ["Date of latest ungraded inspection"],
}


def _find_col(headers: List[str], key: str) -> Optional[str]:
    """Return the actual header matching one of the aliases for `key`, or None."""
    for alias in _COL_ALIASES.get(key, []):
        if alias in headers:
            return alias
    return None


def normalize_postcode_key(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").upper()).strip()


def parse_grade(raw: str) -> Optional[int]:
    """Parse Overall Effectiveness to int 1-4, returning None if not a valid grade."""
    cleaned = raw.strip()
    if not cleaned:
        return None
    # Try direct integer
    try:
        v = int(cleaned)
        if 1 <= v <= 4:
            return v
    except ValueError:
        pass
    # Word-form fallback
    lower = cleaned.lower()
    if "outstanding" in lower:
        return 1
    if "good" in lower:
        return 2
    if "requires" in lower:
        return 3
    if "inadequate" in lower:
        return 4
    return None


def parse_ungraded_outcome(raw: str) -> Optional[int]:
    """Infer a 1-4 grade from an ungraded inspection outcome.

    Only returns a grade for unambiguous outcomes ('School remains Good/Outstanding').
    Returns None for ambiguous outcomes like 'Standards maintained' or 'Improved significantly'.
    """
    cleaned = raw.strip().lower()
    if not cleaned or cleaned in ("null", ""):
        return None
    if "remains outstanding" in cleaned:
        return 1
    if "remains good" in cleaned:
        return 2
    if "remains requires improvement" in cleaned:
        return 3
    if "remains inadequate" in cleaned:
        return 4
    return None


def read_cache(path: Path) -> Dict[str, dict]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_cache(path: Path, payload: Dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def batch(iterable: List[str], size: int) -> List[List[str]]:
    return [iterable[i : i + size] for i in range(0, len(iterable), size)]


def fetch_postcodes_batch(keys: List[str], timeout: int = 40) -> Dict[str, dict]:
    url = "https://api.postcodes.io/postcodes"
    payload = {"postcodes": keys}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        parsed = json.loads(resp.read().decode("utf-8"))

    out: Dict[str, dict] = {}
    for item in (parsed.get("result") or []):
        query = normalize_postcode_key(item.get("query") or "")
        result = item.get("result")
        if not query:
            continue
        if not result:
            out[query] = {"ok": False}
            continue
        lon = result.get("longitude")
        lat = result.get("latitude")
        if lon is None or lat is None:
            out[query] = {"ok": False}
            continue
        out[query] = {
            "ok": True,
            "postcode": result.get("postcode"),
            "longitude": float(lon),
            "latitude": float(lat),
        }
    return out


def download_ofsted_csv(dest: Path) -> None:
    """Download the latest Ofsted MI CSV to dest."""
    print(f"Downloading Ofsted MI CSV from gov.uk …")
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(OFSTED_MI_URL, dest)
    print(f"Saved to {dest}  ({dest.stat().st_size / 1_048_576:.1f} MB)")


def load_rows(path: Path, phases: Optional[set] = None) -> List[dict]:
    """Load and filter rows from the Ofsted MI CSV."""
    if phases is None:
        phases = PRIMARY_PHASES

    rows: List[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as f:
        reader = csv.DictReader(f)
        headers = list(reader.fieldnames or [])

        col = {key: _find_col(headers, key) for key in _COL_ALIASES}
        missing = [k for k, v in col.items() if v is None]
        if missing:
            # Print a helpful message listing the actual headers found
            print(f"WARNING: Could not find columns for: {missing}")
            print(f"Available headers: {headers[:30]}")
            if col["urn"] is None or col["postcode"] is None or col["effectiveness"] is None:
                raise ValueError(
                    "Required columns (URN / Postcode / Overall effectiveness) not found in CSV. "
                    "Check the file format and update _COL_ALIASES if needed."
                )

        for row in reader:
            # Filter by phase
            if col["phase"]:
                phase = row[col["phase"]].strip()
                if phase not in phases:
                    continue
            else:
                # No phase column — include everything (all-phase file fallback)
                phase = "Primary"

            # Parse grade — try OEIF graded inspection first, fall back to ungraded outcome
            eff_raw = row[col["effectiveness"]].strip() if col["effectiveness"] else ""
            grade = parse_grade(eff_raw)
            ungraded_fallback = False
            if grade is None:
                outcome_raw = row[col["ungraded_outcome"]].strip() if col["ungraded_outcome"] else ""
                grade = parse_ungraded_outcome(outcome_raw)
                if grade is not None:
                    ungraded_fallback = True
            # grade 0 = no formal Ofsted grade available (include on map as grey point)
            if grade is None:
                grade = 0

            # Extract fields
            urn = row[col["urn"]].strip() if col["urn"] else ""
            if not urn:
                continue

            school_name = row[col["school_name"]].strip() if col["school_name"] else ""
            postcode_raw = row[col["postcode"]].strip() if col["postcode"] else ""
            la_name = row[col["la_name"]].strip() if col["la_name"] else ""
            # For ungraded-outcome fallbacks, prefer the ungraded inspection date
            def _date(raw: str) -> str:
                s = raw.strip()
                return "" if s.upper() == "NULL" else s

            if ungraded_fallback and col["ungraded_date"]:
                insp_date = _date(row[col["ungraded_date"]])
            elif col["ungraded_date"] and grade == 0:
                insp_date = _date(row[col["ungraded_date"]])
            else:
                insp_date = _date(row[col["inspection_date"]]) if col["inspection_date"] else ""
            postcode_key = normalize_postcode_key(postcode_raw)

            if not postcode_key:
                continue

            rows.append({
                "urn": urn,
                "school_name": school_name,
                "phase": phase,
                "ofsted_grade": grade,
                "ofsted_label": GRADE_LABELS[grade],
                "postcode": postcode_raw.upper(),
                "postcode_key": postcode_key,
                "la": la_name,
                "inspection_date": insp_date,
            })

    return rows


def build_geojson(rows: List[dict], coords: Dict[str, dict]) -> dict:
    features = []
    for row in rows:
        c = coords.get(row["postcode_key"])
        if not c or not c.get("ok"):
            continue
        lon = c.get("longitude")
        lat = c.get("latitude")
        if lon is None or lat is None:
            continue

        urn = row["urn"]
        feature = {
            "type": "Feature",
            "properties": {
                "urn":             urn,
                "name":            row["school_name"],
                "phase":           row["phase"],
                "ofsted_grade":    row["ofsted_grade"],
                "ofsted_label":    row["ofsted_label"],
                "postcode":        row["postcode"] or c.get("postcode") or row["postcode_key"],
                "la":              row["la"],
                "inspection_date": row["inspection_date"],
                "link":            f"https://reports.ofsted.gov.uk/provider/21/{urn}",
            },
            "geometry": {
                "type": "Point",
                "coordinates": [float(lon), float(lat)],
            },
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}


def write_geojson_gz(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build primary school Ofsted overlay GeoJSON")
    p.add_argument("--input",      default=str(RAW_OFSTED_MI),                       help="Ofsted MI CSV path")
    p.add_argument("--output",     default=str(MODEL_PRIMARY_SCHOOL_OVERLAY_POINTS),  help="Output GeoJSON .gz path")
    p.add_argument("--cache",      default=str(INTERMEDIATE_SCHOOL_POSTCODE_CACHE),   help="Postcode coordinate cache JSON")
    p.add_argument("--download",   action="store_true",                               help="Download latest Ofsted MI CSV first")
    p.add_argument("--batch-size", type=int, default=100,                             help="Postcodes.io batch size (max 100)")
    p.add_argument("--pause-ms",   type=int, default=40,                              help="Pause between API batches (ms)")
    p.add_argument("--all-phases", action="store_true",                               help="Include all school phases (not just primary)")
    return p.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()
    input_path  = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    cache_path  = Path(args.cache).resolve()

    if args.download:
        download_ofsted_csv(input_path)

    if not input_path.exists():
        raise FileNotFoundError(
            f"Ofsted MI CSV not found at {input_path}.\n"
            "Download it from:\n"
            "  https://www.gov.uk/government/statistical-data-sets/"
            "monthly-management-information-ofsteds-school-inspections-outcomes\n"
            "or run with --download to fetch automatically."
        )

    phases = None if args.all_phases else PRIMARY_PHASES

    print(f"Loading rows from {input_path} …")
    rows = load_rows(input_path, phases=phases)
    print(f"Primary school rows with valid grade: {len(rows)}")

    # Grade distribution
    from collections import Counter
    dist = Counter(row["ofsted_label"] for row in rows)
    for label, count in sorted(dist.items()):
        print(f"  {label}: {count}")

    all_postcodes = sorted({row["postcode_key"] for row in rows if row["postcode_key"]})
    print(f"Unique postcodes to geocode: {len(all_postcodes)}")

    cache = read_cache(cache_path)
    missing = [pc for pc in all_postcodes if pc not in cache]
    print(f"Postcodes missing from cache: {len(missing)}")

    batch_size = max(1, min(100, int(args.batch_size)))
    pause_secs = max(0, int(args.pause_ms)) / 1000

    for i, chunk in enumerate(batch(missing, batch_size), start=1):
        try:
            fetched = fetch_postcodes_batch(chunk)
            cache.update(fetched)
        except Exception as exc:
            print(f"  Batch {i} error: {exc}")
            for pc in chunk:
                cache.setdefault(pc, {"ok": False})
        if pause_secs > 0:
            time.sleep(pause_secs)
        if i % 20 == 0:
            print(f"  Geocoding batch {i}, cache size={len(cache)}")

    write_cache(cache_path, cache)

    geojson = build_geojson(rows, cache)
    write_geojson_gz(output_path, geojson)

    features = geojson.get("features") or []
    grade_dist = Counter(f["properties"]["ofsted_label"] for f in features)
    print(f"\nGeoJSON features: {len(features)}")
    for label, count in sorted(grade_dist.items()):
        print(f"  {count} × {label}")
    print(f"\nOutput: {output_path}")


if __name__ == "__main__":
    main()

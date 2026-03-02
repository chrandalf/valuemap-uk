#!/usr/bin/env python3
"""
Build crime score overlay GeoJSON from data.police.uk bulk archive.

Crime data: Open Government Licence v3.0  https://data.police.uk/
Coverage:   England, Wales, Northern Ireland  (Scotland = BTP only – excluded)

Steps
-----
1. Download latest.zip (~1.6 GB) from data.police.uk unless --no-download
2. Scan all *-street.csv files inside the zip; keep only the 12 most recent months
3. Aggregate per LSOA: violent / property / ASB / other crime counts
4. Derive LSOA centroid as the mean of the crime snap-point coordinates
5. Join population from ONS Census 2021 LSOA age data (ts007a_age_lsoa21.csv)
6. Compute rates per 1,000 residents (annualised over the 12 months)
7. Compute inverse-percentile scores: 100 = lowest crime, 0 = highest crime
8. Output:
     crime_overlay_lsoa.geojson.gz   → MODEL_CRIME_DIR  (then staged to PUBLISH)
     crime_analysis.csv              → MODEL_CRIME_DIR   (for inspection)

Crime-type tier definitions
---------------------------
violent:  violence-and-sexual-offences, robbery
property: burglary, bicycle-theft, criminal-damage-arson, other-theft,
          shoplifting, theft-from-the-person, vehicle-crime
asb:      anti-social-behaviour
other:    drugs, other-crime, public-order, possession-of-weapons

Usage
-----
  python build_crime_overlay.py               # download + build
  python build_crime_overlay.py --no-download # use the cached latest.zip
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import shutil
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

from paths import (
    MODEL_CRIME_DIR,
    MODEL_CRIME_OVERLAY,
    PUBLISH_CRIME_DIR,
    RAW_CENSUS_AGE_LSOA,
    RAW_CRIME_LATEST_ZIP,
    ensure_pipeline_dirs,
)

# ── Crime-type tier mapping ────────────────────────────────────────────────────

VIOLENT_TYPES: frozenset[str] = frozenset({
    "violence-and-sexual-offences",
    "robbery",
})
PROPERTY_TYPES: frozenset[str] = frozenset({
    "burglary",
    "bicycle-theft",
    "criminal-damage-arson",
    "other-theft",
    "shoplifting",
    "theft-from-the-person",
    "vehicle-crime",
})
ASB_TYPES: frozenset[str] = frozenset({
    "anti-social-behaviour",
})
# Anything else goes into "other" (drugs, public-order, possession-of-weapons, …)

# ── Download ───────────────────────────────────────────────────────────────────

ARCHIVE_URL = "https://data.police.uk/data/archive/latest.zip"


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}  →  {dest}")
    req = urllib.request.Request(url, headers={"User-Agent": "valuemap-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        downloaded = 0
        chunk_size = 1024 * 1024  # 1 MB
        tmp = dest.with_suffix(".tmp")
        with open(tmp, "wb") as fh:
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                fh.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    mb = downloaded / (1024 * 1024)
                    print(f"\r  {mb:.0f} MB  ({pct:.1f}%)     ", end="", flush=True)
        print()  # newline after progress
    tmp.rename(dest)
    print(f"Download complete: {dest.stat().st_size / (1024 * 1024):.0f} MB")


# ── ZIP parsing ────────────────────────────────────────────────────────────────

def _collect_month_members(zf: zipfile.ZipFile) -> Dict[str, List[str]]:
    """Return {YYYY-MM: [member_name, …]} for all *-street.csv members."""
    months: Dict[str, List[str]] = defaultdict(list)
    for name in zf.namelist():
        if not name.endswith("-street.csv"):
            continue
        # Typical path: 2025-11/avon-and-somerset/2025-11-avon-and-somerset-street.csv
        parts = name.split("/")
        month_dir = parts[0] if len(parts) >= 2 else ""
        if len(month_dir) == 7 and month_dir[4] == "-":
            months[month_dir].append(name)
    return months


def _pick_latest_months(months_map: Dict[str, List[str]], n: int = 12) -> List[str]:
    """Return the n most recent YYYY-MM keys, sorted descending."""
    return sorted(months_map.keys(), reverse=True)[:n]


# ── CSV processing ─────────────────────────────────────────────────────────────

# Per-LSOA accumulators
_LsoaAcc = Dict[str, object]  # lsoa_code → dict of counts + coord sums


def _make_acc() -> dict:
    return {
        "lsoa_name": "",
        "violent": 0,
        "property": 0,
        "asb": 0,
        "other": 0,
        "lat_sum": 0.0,
        "lon_sum": 0.0,
        "n_coords": 0,
    }


def _tier(crime_type: str) -> str:
    t = crime_type.lower().strip()
    if t in VIOLENT_TYPES:
        return "violent"
    if t in PROPERTY_TYPES:
        return "property"
    if t in ASB_TYPES:
        return "asb"
    return "other"


def _parse_csv_bytes(raw: bytes, acc: Dict[str, dict]) -> Tuple[int, int]:
    """Parse one force-month street CSV and accumulate into acc.
    Returns (rows_processed, rows_skipped)."""
    processed = 0
    skipped = 0
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace")))
    for row in reader:
        lsoa_code = (row.get("LSOA code") or "").strip()
        crime_type = (row.get("Crime type") or "").strip()
        lat_s = (row.get("Latitude") or "").strip()
        lon_s = (row.get("Longitude") or "").strip()

        if not lsoa_code or not crime_type:
            skipped += 1
            continue

        # Scotland: LSOA codes start with S (DataZones) — skip
        if lsoa_code.startswith("S"):
            skipped += 1
            continue

        if lsoa_code not in acc:
            acc[lsoa_code] = _make_acc()

        entry = acc[lsoa_code]
        if not entry["lsoa_name"]:
            entry["lsoa_name"] = (row.get("LSOA name") or "").strip()

        t = _tier(crime_type)
        entry[t] += 1  # type: ignore[operator]

        try:
            lat = float(lat_s)
            lon = float(lon_s)
            if -90 <= lat <= 90 and -180 <= lon <= 180 and lat != 0 and lon != 0:
                entry["lat_sum"] += lat  # type: ignore[operator]
                entry["lon_sum"] += lon  # type: ignore[operator]
                entry["n_coords"] += 1  # type: ignore[operator]
        except (ValueError, TypeError):
            pass

        processed += 1
    return processed, skipped


# ── Population data ────────────────────────────────────────────────────────────

def _load_population(path: Path) -> Dict[str, int]:
    """Load LSOA21 population from ONS Census age CSV.
    Returns {lsoa_code: total_population}."""
    pop: Dict[str, int] = {}
    if not path.exists():
        print(f"  WARNING: Population file not found: {path}")
        return pop
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            code = (row.get("geography_code") or "").strip()
            total_s = (row.get("total") or "").strip()
            if code and total_s:
                try:
                    pop[code] = int(float(total_s))
                except ValueError:
                    pass
    print(f"  Population records loaded: {len(pop):,}")
    return pop


# ── Scoring ────────────────────────────────────────────────────────────────────

def _invert_scores(rates: List[float]) -> List[float]:
    """Convert a list of rates into 0-100 scores where LOWER rate → HIGHER score.
    Uses rank-based percentile: lowest rate = 100, highest rate = 0.
    Ties get the same score (the best score within the tied group)."""
    n = len(rates)
    if n == 0:
        return []
    if n == 1:
        return [50.0]
    # Sort with original index, assign rank
    indexed = sorted(enumerate(rates), key=lambda x: x[1])
    scores = [0.0] * n
    i = 0
    while i < n:
        # Find the end of the tied group
        j = i
        while j < n - 1 and indexed[j + 1][1] == indexed[j][1]:
            j += 1
        # All items in [i, j] share the same rate.
        # Give them the score corresponding to rank i (best within the group).
        score = round(100.0 * (1.0 - i / (n - 1)), 1)
        for k in range(i, j + 1):
            scores[indexed[k][0]] = score
        i = j + 1
    return scores


# ── GeoJSON output ─────────────────────────────────────────────────────────────

def _build_geojson(
    acc: Dict[str, dict],
    pop: Dict[str, int],
    months_used: int,
) -> dict:
    """Build the GeoJSON FeatureCollection from accumulator + population data."""
    features = []
    lsoa_codes = list(acc.keys())

    # ── Rates per 1,000 residents (annualised to 12 months)  ──────────────────
    ann_factor = 12.0 / max(months_used, 1)  # scale if we had fewer than 12 months

    def _rate(count: int, population: int) -> float:
        if population <= 0:
            return 0.0
        return round(count / population * 1000 * ann_factor, 2)

    total_rates: List[float] = []
    violent_rates: List[float] = []
    property_rates: List[float] = []
    asb_rates: List[float] = []

    row_data = []
    for code in lsoa_codes:
        e = acc[code]
        if e["n_coords"] == 0:
            continue  # no valid coordinates → skip
        pop_n = pop.get(code, 0)
        total = e["violent"] + e["property"] + e["asb"] + e["other"]
        tr = _rate(total, pop_n)
        vr = _rate(e["violent"], pop_n)
        pr = _rate(e["property"], pop_n)
        ar = _rate(e["asb"], pop_n)
        total_rates.append(tr)
        violent_rates.append(vr)
        property_rates.append(pr)
        asb_rates.append(ar)
        row_data.append((code, e, pop_n, total, tr, vr, pr, ar))

    # ── Compute inverse-percentile scores  ────────────────────────────────────
    total_scores = _invert_scores(total_rates)
    violent_scores = _invert_scores(violent_rates)
    property_scores = _invert_scores(property_rates)
    asb_scores = _invert_scores(asb_rates)

    for i, (code, e, pop_n, total, tr, vr, pr, ar) in enumerate(row_data):
        lat = e["lat_sum"] / e["n_coords"]
        lon = e["lon_sum"] / e["n_coords"]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": {
                "lsoa_code": code,
                "lsoa_name": e["lsoa_name"],
                "population": pop_n,
                "months": months_used,
                "total_crimes": total,
                "violent_crimes": e["violent"],
                "property_crimes": e["property"],
                "asb_crimes": e["asb"],
                "other_crimes": e["other"],
                "total_rate": tr,      # per 1,000 residents/yr
                "violent_rate": vr,
                "property_rate": pr,
                "asb_rate": ar,
                "crime_score": total_scores[i],    # 100 = safest
                "violent_score": violent_scores[i],
                "property_score": property_scores[i],
                "asb_score": asb_scores[i],
            },
        })

    return {"type": "FeatureCollection", "features": features}


# ── Analysis CSV ───────────────────────────────────────────────────────────────

def _write_analysis(features: list, out_path: Path) -> None:
    """Write a sorted analysis CSV for inspection."""
    rows = [f["properties"] for f in features]
    rows.sort(key=lambda r: r["total_rate"], reverse=True)
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    print(f"  Analysis CSV: {out_path}  ({len(rows):,} rows)")


def _print_stats(features: list) -> None:
    rates = [f["properties"]["total_rate"] for f in features]
    if not rates:
        print("  No features – cannot compute stats")
        return
    rates.sort()
    n = len(rates)
    def pct(p: float) -> float:
        idx = int(p / 100 * (n - 1))
        return rates[idx]
    print(f"  Features:  {n:,}")
    print(f"  Total-rate per 1k/yr  (crimes/1000 residents, annualised)")
    print(f"    p10: {pct(10):.1f}    p25: {pct(25):.1f}    p50: {pct(50):.1f}    p75: {pct(75):.1f}    p90: {pct(90):.1f}    max: {rates[-1]:.1f}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Build crime overlay GeoJSON from data.police.uk archive")
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Skip download – use the already-cached latest.zip",
    )
    parser.add_argument(
        "--months",
        type=int,
        default=12,
        help="Number of most-recent months to include (default: 12)",
    )
    args = parser.parse_args()

    ensure_pipeline_dirs()

    # ── 1. Download ────────────────────────────────────────────────────────────
    if args.no_download:
        if not RAW_CRIME_LATEST_ZIP.exists():
            sys.exit(f"ERROR: --no-download specified but file not found: {RAW_CRIME_LATEST_ZIP}")
        print(f"Using cached zip: {RAW_CRIME_LATEST_ZIP}  ({RAW_CRIME_LATEST_ZIP.stat().st_size / (1024*1024):.0f} MB)")
    else:
        _download(ARCHIVE_URL, RAW_CRIME_LATEST_ZIP)

    # ── 2. Scan zip for street CSVs  ────────────────────────────────────────────
    print("Scanning zip for street-level CSV members …")
    with zipfile.ZipFile(RAW_CRIME_LATEST_ZIP, "r") as zf:
        months_map = _collect_month_members(zf)
        all_months = sorted(months_map.keys(), reverse=True)
        print(f"  Available months: {all_months[0]} → {all_months[-1]}  ({len(all_months)} total)")
        chosen = _pick_latest_months(months_map, args.months)
        print(f"  Using months: {chosen[-1]} → {chosen[0]}  ({len(chosen)} months)")
        members_to_process = [m for month in chosen for m in months_map[month]]
        print(f"  CSV files to process: {len(members_to_process):,}")

        # ── 3. Parse CSVs and accumulate per LSOA ─────────────────────────────
        acc: Dict[str, dict] = {}
        total_rows = 0
        total_skipped = 0
        for idx, member in enumerate(members_to_process, 1):
            raw = zf.read(member)
            p, s = _parse_csv_bytes(raw, acc)
            total_rows += p
            total_skipped += s
            if idx % 100 == 0 or idx == len(members_to_process):
                print(f"\r  Processed {idx:,}/{len(members_to_process):,} CSVs  |  "
                      f"{total_rows:,} rows  |  {len(acc):,} LSOAs  ", end="", flush=True)
        print()

    print(f"\nTotal rows processed: {total_rows:,}  |  skipped: {total_skipped:,}")
    print(f"Unique LSOAs (England/Wales/NI): {len(acc):,}")

    # ── 4. Population data  ────────────────────────────────────────────────────
    print(f"\nLoading population data from {RAW_CENSUS_AGE_LSOA.name} …")
    pop = _load_population(RAW_CENSUS_AGE_LSOA)

    matched = sum(1 for code in acc if code in pop)
    print(f"  LSOAs with population match: {matched:,} / {len(acc):,}")

    # ── 5-7. Build GeoJSON with rates + scores ────────────────────────────────
    print("\nBuilding GeoJSON …")
    geojson = _build_geojson(acc, pop, len(chosen))
    features = geojson["features"]
    print(f"  Features after coord filtering: {len(features):,}")
    print("\nDistribution stats:")
    _print_stats(features)

    # ── 8. Write outputs  ──────────────────────────────────────────────────────
    MODEL_CRIME_DIR.mkdir(parents=True, exist_ok=True)
    PUBLISH_CRIME_DIR.mkdir(parents=True, exist_ok=True)

    model_gz = MODEL_CRIME_OVERLAY
    print(f"\nWriting {model_gz} …")
    payload = json.dumps(geojson, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(model_gz, "wb", compresslevel=9) as fh:
        fh.write(payload)
    print(f"  Written: {model_gz.stat().st_size / (1024*1024):.2f} MB (gzipped)")

    publish_gz = PUBLISH_CRIME_DIR / model_gz.name
    shutil.copy2(model_gz, publish_gz)
    print(f"  Staged:  {publish_gz}")

    analysis_csv = MODEL_CRIME_DIR / "crime_analysis.csv"
    _write_analysis(features, analysis_csv)

    print("\nDone.")


if __name__ == "__main__":
    main()

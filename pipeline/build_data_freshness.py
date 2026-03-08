#!/usr/bin/env python3
"""Build data_freshness.json — a manifest of per-dataset data-as-of dates.

Derives dates from the raw source files on disk wherever possible, so the
data sources panel in the UI always reflects the actual pipeline state rather
than hand-coded strings.  Run as a standalone step or via upload_model_assets_to_r2.py.

Output: pipeline/data/publish/data_freshness.json (not gzipped — it's tiny)
"""
from __future__ import annotations

import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from paths import (
    MODEL_BROADBAND_DIR,
    PUBLISH_CRIME_DIR,
    PUBLISH_DIR,
    PUBLISH_FLOOD_DIR,
    PUBLISH_SCHOOLS_DIR,
    PUBLISH_STATIONS_DIR,
    PUBLISH_VOTE_DIR,
    RAW_BROADBAND_DIR,
    RAW_CENSUS_AGE_LSOA,
    RAW_CRIME_LATEST_ZIP,
    RAW_OFSTED_MI,
    RAW_SCHOOL_PERF,
    PUBLISH_PROPERTY_DIR,
)

OUTPUT_PATH = PUBLISH_DIR / "data_freshness.json"


def _mtime_iso(path: Path) -> str | None:
    """Return ISO-8601 UTC date string for the mtime of path, or None."""
    if not path.exists():
        return None
    ts = path.stat().st_mtime
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def _derive_house_prices_date() -> tuple[str, str]:
    """Return (data_date YYYY-MM-DD, label) from the cells partition structure."""
    cells_root = PUBLISH_PROPERTY_DIR / "cells"
    # Walk the /cells/{grid}/median/ directories for YYYY-MM-DD folder names
    dates: list[str] = []
    for grid_dir in cells_root.iterdir():
        median_dir = grid_dir / "median"
        if not median_dir.is_dir():
            continue
        for d in median_dir.iterdir():
            if d.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d.name):
                dates.append(d.name)
    if dates:
        latest = sorted(dates)[-1]
        label = datetime.strptime(latest, "%Y-%m-%d").strftime("%b %Y")
        return latest, label
    # fallback: mtime of any property publish file
    fallback = _mtime_iso(PUBLISH_PROPERTY_DIR / "country_cells_5km.json.gz") or "2025-12-01"
    return fallback, datetime.strptime(fallback, "%Y-%m-%d").strftime("%b %Y")


def _derive_crime_date() -> tuple[str, str]:
    """Return latest YYYY-MM-01 from the crime zip's entry paths."""
    if not RAW_CRIME_LATEST_ZIP.exists():
        fallback = _mtime_iso(PUBLISH_CRIME_DIR / "crime_cells_5km.json.gz") or "2025-09-01"
        return fallback, datetime.strptime(fallback, "%Y-%m-%d").strftime("%b %Y")
    months: list[str] = []
    with zipfile.ZipFile(RAW_CRIME_LATEST_ZIP) as z:
        for name in z.namelist():
            months.extend(re.findall(r"\d{4}-\d{2}", name))
    if months:
        latest = sorted(set(months))[-1]
        data_date = f"{latest}-01"
        label = datetime.strptime(data_date, "%Y-%m-%d").strftime("%b %Y")
        return data_date, label
    fallback = _mtime_iso(PUBLISH_CRIME_DIR / "crime_cells_5km.json.gz") or "2025-09-01"
    return fallback, datetime.strptime(fallback, "%Y-%m-%d").strftime("%b %Y")


def _derive_broadband_date() -> tuple[str, str]:
    """Parse YYYYMM from the Ofcom broadband zip filename."""
    if RAW_BROADBAND_DIR.is_dir():
        for f in RAW_BROADBAND_DIR.iterdir():
            m = re.match(r"(\d{4})(\d{2})_fixed_broadband", f.name)
            if m:
                data_date = f"{m.group(1)}-{m.group(2)}-01"
                label = datetime.strptime(data_date, "%Y-%m-%d").strftime("%b %Y")
                return data_date, label
    fallback = _mtime_iso(MODEL_BROADBAND_DIR / "broadband_cells_5km.json.gz") or "2025-07-01"
    return fallback, datetime.strptime(fallback, "%Y-%m-%d").strftime("%b %Y")


def _derive_schools_date() -> tuple[str, str]:
    """Derive academic-year end date from the performance tables filename."""
    if RAW_SCHOOL_PERF.exists():
        m = re.search(r"(\d{4})(\d{2})_", RAW_SCHOOL_PERF.name)
        if m:
            # e.g. 202425_ → academic year 2024-25, data published spring of end year
            end_year = int(m.group(1)) + 1
            data_date = f"{end_year}-04-01"
            label = f"{m.group(1)}–{m.group(2)}"
            return data_date, label
    fallback = _mtime_iso(PUBLISH_SCHOOLS_DIR / "school_overlay_points.geojson.gz") or "2025-04-01"
    return fallback, datetime.strptime(fallback, "%Y-%m-%d").strftime("%b %Y")


def _derive_ofsted_date() -> tuple[str, str]:
    """Ofsted MI file mtime as a proxy for the Ofsted inspection refresh date."""
    mtime = _mtime_iso(RAW_OFSTED_MI)
    if mtime:
        label = datetime.strptime(mtime, "%Y-%m-%d").strftime("%b %Y")
        return mtime, label
    return _derive_schools_date()


def build_freshness() -> dict:
    now = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")

    house_prices_date, house_prices_label = _derive_house_prices_date()
    crime_date, crime_label = _derive_crime_date()
    broadband_date, broadband_label = _derive_broadband_date()
    schools_date, schools_label = _derive_schools_date()
    ofsted_date, ofsted_label = _derive_ofsted_date()

    flood_date = _mtime_iso(PUBLISH_FLOOD_DIR / "flood_postcode_lookup.json.gz") or "2025-12-01"
    stations_date = _mtime_iso(PUBLISH_STATIONS_DIR / "station_overlay_points.geojson.gz") or "2026-01-01"
    postcodes_date = _mtime_iso(Path(__file__).parent / "data" / "raw" / "property" / "ONSPD_Online_latest_Postcode_Centroids_.csv") or "2025-11-01"

    def label_from_date(d: str) -> str:
        try:
            return datetime.strptime(d, "%Y-%m-%d").strftime("%b %Y")
        except ValueError:
            return d

    return {
        "generated_at": now,
        "datasets": {
            "house_prices": {
                "data_date": house_prices_date,
                "label": house_prices_label,
                "source": "HM Land Registry + Registers of Scotland",
            },
            "crime": {
                "data_date": crime_date,
                "label": crime_label,
                "source": "Home Office Police.uk (LSOA records)",
            },
            "flood": {
                "data_date": flood_date,
                "label": label_from_date(flood_date),
                "source": "Environment Agency Flood Risk Register",
            },
            "schools_secondary": {
                "data_date": schools_date,
                "label": schools_label,
                "source": "DfE / Ofsted inspections & KS4 GCSE",
            },
            "schools_primary": {
                "data_date": ofsted_date,
                "label": ofsted_label,
                "source": "DfE / Ofsted inspections",
            },
            "stations": {
                "data_date": stations_date,
                "label": label_from_date(stations_date),
                "source": "Network Rail / OpenStreetMap",
            },
            "epc": {
                # EPC source data coverage is Q4 2024; we track this statically since
                # the DLUHC file has no date in its name
                "data_date": "2024-12-01",
                "label": "Q4 2024",
                "source": "DLUHC — Domestic EPC Register",
            },
            "broadband": {
                "data_date": broadband_date,
                "label": broadband_label,
                "source": "Ofcom Connected Nations broadband data",
            },
            "community_age": {
                # Census 2021 is a fixed one-time dataset
                "data_date": "2021-03-21",
                "label": "Census 2021",
                "source": "ONS Census 2021 age distributions",
            },
            "commute": {
                "data_date": "2021-03-21",
                "label": "Census 2021",
                "source": "ONS Census 2021 travel-to-work",
            },
            "election": {
                "data_date": "2024-07-04",
                "label": "Jul 2024",
                "source": "Electoral Commission — General Election 2024",
            },
            "postcodes": {
                "data_date": postcodes_date,
                "label": label_from_date(postcodes_date),
                "source": "ONS ONSPD postcode centroids",
            },
        },
    }


def main() -> None:
    PUBLISH_DIR.mkdir(parents=True, exist_ok=True)
    manifest = build_freshness()
    OUTPUT_PATH.write_text(json.dumps(manifest, indent=2))
    print(f"Written {OUTPUT_PATH}")
    for key, ds in manifest["datasets"].items():
        print(f"  {key:25s}  {ds['label']}")


if __name__ == "__main__":
    main()

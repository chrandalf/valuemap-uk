"""
Build planning application overlay GeoJSON from MHCLG / planning.data.gov.uk.

Source: https://files.planning.data.gov.uk/dataset/planning-application.csv
Licence: Open Government Licence v3.0

Coverage note: only LPAs that submit data in the standardised format are
included (~half of English councils as of 2025). No geometry is available
for applications without a point value in the national dataset — these are
skipped. Wales, Scotland and Northern Ireland are not covered.

Output: MODEL_TRANSIT_DIR / planning_application_overlay_points.geojson.gz
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from paths import MODEL_TRANSIT_DIR  # noqa: E402

CSV_URL = "https://files.planning.data.gov.uk/dataset/planning-application.csv"

# Bounding box for Great Britain (exclude stray overseas data)
LON_MIN, LON_MAX = -8.2, 2.0
LAT_MIN, LAT_MAX = 49.8, 60.9

DESC_MAX_LEN = 200  # truncate long descriptions in the output


def download_csv() -> str:
    print(f"Downloading planning application data from {CSV_URL} ...")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "valuemap-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    mb = len(data) / 1024 / 1024
    print(f"Downloaded {mb:.1f} MB")
    return data.decode("utf-8", errors="replace")


def parse_point(wkt: str) -> tuple[float, float] | None:
    """Parse 'POINT (lon lat)' WKT, returning (lon, lat) or None."""
    wkt = wkt.strip()
    if not wkt.startswith("POINT"):
        return None
    inner = wkt[wkt.index("(") + 1 : wkt.index(")")]
    parts = inner.split()
    if len(parts) != 2:
        return None
    try:
        lon, lat = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    return lon, lat


def normalise_decision(decision: str, status: str) -> str:
    """Map raw decision/status values to a canonical short code."""
    d = decision.strip().lower()
    s = status.strip().lower()
    if d.startswith("approv") or d.startswith("permit") or d.startswith("granted") or d == "approve":
        return "approved"
    if d.startswith("refus") or d == "refuse":
        return "refused"
    if "prior" in d and "not required" in d:
        return "prior_approval"
    if d == "withdrawn" or s == "withdrawn":
        return "withdrawn"
    if s in ("registered", "appeal lodged", ""):
        return "pending"
    return "other"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build planning application overlay GeoJSON from MHCLG Planning Data"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=MODEL_TRANSIT_DIR / "planning_application_overlay_points.geojson.gz",
        help="Output path for the GeoJSON.gz file",
    )
    args = parser.parse_args()

    print("Step 1: Download CSV ...")
    raw = download_csv()

    print("Step 2: Parse and build GeoJSON ...")
    reader = csv.DictReader(io.StringIO(raw))

    features: list[dict] = []
    skipped_no_point = 0
    skipped_out_of_bounds = 0
    skipped_ended = 0

    decision_counts: dict[str, int] = {}

    for row in reader:
        def val(k: str) -> str:
            return (row.get(k) or "").strip()

        # Skip withdrawn ended entries that have an end-date set
        if val("end-date"):
            skipped_ended += 1
            continue

        pt_wkt = val("point")
        if not pt_wkt:
            skipped_no_point += 1
            continue

        coords = parse_point(pt_wkt)
        if coords is None:
            skipped_no_point += 1
            continue

        lon, lat = coords
        if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
            skipped_out_of_bounds += 1
            continue

        decision_raw = val("planning-decision")
        status_raw = val("planning-application-status")
        decision = normalise_decision(decision_raw, status_raw)

        decision_counts[decision] = decision_counts.get(decision, 0) + 1

        desc = val("description")
        if len(desc) > DESC_MAX_LEN:
            desc = desc[:DESC_MAX_LEN].rstrip() + "…"

        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "ref": val("reference"),
                    "address": val("address-text"),
                    "description": desc,
                    "decision": decision,
                    "start_date": val("start-date"),
                    "decision_date": val("decision-date"),
                    "doc_url": val("documentation-url"),
                },
            }
        )

    print(f"  Parsed {len(features)} features")
    print(f"  Skipped {skipped_ended} ended/withdrawn records")
    print(f"  Skipped {skipped_no_point} with no point coordinates")
    print(f"  Skipped {skipped_out_of_bounds} out-of-bounds")
    for d, n in sorted(decision_counts.items(), key=lambda x: -x[1]):
        print(f"    {d:<20}: {n:,}")

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    print("Step 3: Write output ...")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(geojson, separators=(",", ":")).encode("utf-8")
    with gzip.open(args.output, "wb", compresslevel=6) as f:
        f.write(encoded)

    size_mb = args.output.stat().st_size / 1024 / 1024
    print(f"Wrote {len(features):,} features → {args.output} ({size_mb:.2f} MB gz)")
    print("Done.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from paths import (
    INTERMEDIATE_SCHOOL_POSTCODE_SCORES_MAINSTREAM,
    INTERMEDIATE_SCHOOL_SCORES_MAINSTREAM,
    MODEL_DIR,
    MODEL_FLOOD_DIR,
    MODEL_SCHOOLS_DIR,
    MODEL_STATIONS_DIR,
    MODEL_VOTE_DIR,
    PUBLIC_DATA_DIR,
    PUBLISH_DIR,
    ensure_pipeline_dirs,
)

SCRIPT_DIR = Path(__file__).resolve().parent


def run_step(label: str, args: list[str]) -> None:
    cmd = [sys.executable, *args]
    print(f"\n[{label}] {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def copy_model_to_public() -> None:
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src in MODEL_DIR.rglob("*"):
        if not src.is_file():
            continue
        dst = PUBLIC_DATA_DIR / src.name
        shutil.copy2(src, dst)
        copied += 1
    print(f"Copied {copied} model artifacts to {PUBLIC_DATA_DIR}")


def copy_model_to_publish() -> None:
    PUBLISH_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src in MODEL_DIR.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(MODEL_DIR)
        dst = PUBLISH_DIR / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    print(f"Copied {copied} model artifacts to {PUBLISH_DIR}")


def run_schools(include_non_mainstream: bool) -> None:
    if include_non_mainstream:
        run_step(
            "schools-score-all",
            [str(SCRIPT_DIR / "build_school_scores.py")],
        )

    run_step(
        "schools-score-mainstream",
        [
            str(SCRIPT_DIR / "build_school_scores.py"),
            "--mainstream-only",
            "--output",
            str(INTERMEDIATE_SCHOOL_SCORES_MAINSTREAM),
        ],
    )

    if include_non_mainstream:
        run_step(
            "schools-postcode-all",
            [str(SCRIPT_DIR / "build_school_postcode_scores.py")],
        )

    run_step(
        "schools-postcode-mainstream",
        [
            str(SCRIPT_DIR / "build_school_postcode_scores.py"),
            "--mainstream-only",
            "--output",
            str(INTERMEDIATE_SCHOOL_POSTCODE_SCORES_MAINSTREAM),
        ],
    )

    run_step(
        "schools-overlay-points",
        [
            str(SCRIPT_DIR / "build_school_overlay_points.py"),
            "--input",
            str(INTERMEDIATE_SCHOOL_POSTCODE_SCORES_MAINSTREAM),
            "--output",
            str(MODEL_SCHOOLS_DIR / "school_overlay_points.geojson.gz"),
        ],
    )


def run_property() -> None:
    run_step(
        "property-build",
        [
            str(SCRIPT_DIR / "build_property_artifacts.py"),
        ],
    )

    run_step(
        "property-assets",
        [
            str(SCRIPT_DIR / "prepare_property_assets.py"),
        ],
    )


def run_flood() -> None:
    run_step(
        "flood-assets",
        [
            str(SCRIPT_DIR / "build_flood_postcode_assets.py"),
            "--out-dir",
            str(MODEL_FLOOD_DIR),
        ],
    )


def run_stations() -> None:
    run_step(
        "stations-overlay-points",
        [
            str(SCRIPT_DIR / "build_station_overlay_points.py"),
            "--output",
            str(MODEL_STATIONS_DIR / "station_overlay_points.geojson.gz"),
        ],
    )


def run_crime() -> None:
    """
    Build LSOA crime overlay, then snap to all 4 grid sizes.
    Requires: raw crime CSVs in pipeline/data/raw/crime/ and ONSPD in raw/property/.
    """
    run_step(
        "crime-overlay",
        [str(SCRIPT_DIR / "build_crime_overlay.py")],
    )
    run_step(
        "crime-cells",
        [str(SCRIPT_DIR / "build_crime_cells.py")],
    )


def run_vote() -> None:
    run_step(
        "vote-blocks",
        [
            str(SCRIPT_DIR / "build_vote_blocks.py"),
            "--out-dir",
            str(MODEL_VOTE_DIR),
        ],
    )

    run_step(
        "vote-overlay-geojson",
        [
            str(SCRIPT_DIR / "build_vote_overlay_geojson.py"),
            "--votes",
            str(MODEL_VOTE_DIR / "ge2024_vote_blocks_by_constituency.csv"),
            "--out",
            str(MODEL_VOTE_DIR / "ge2024_vote_blocks_map.geojson"),
        ],
    )

    run_step(
        "vote-cells",
        [
            str(SCRIPT_DIR / "build_vote_cells_by_grid.py"),
            "--vote-geojson",
            str(MODEL_VOTE_DIR / "ge2024_vote_blocks_map.geojson"),
            "--output-dir",
            str(MODEL_VOTE_DIR),
        ],
    )


def run_census() -> None:
    """
    Fetch ONS Census 2021 age and commute data from the Nomis API, then build
    per-cell grids for all 4 grid sizes.  Data is skipped if the raw CSV already
    exists (safe to re-run).
    Uploads via: python pipeline/upload_age_cells_to_r2.py
                 python pipeline/upload_commute_cells_to_r2.py
    """
    run_step("census-age-fetch",     [str(SCRIPT_DIR / "fetch_age_data.py")])
    run_step("census-age-cells",     [str(SCRIPT_DIR / "build_age_cells.py")])
    run_step("census-commute-fetch", [str(SCRIPT_DIR / "fetch_commute_data.py")])
    run_step("census-commute-cells", [str(SCRIPT_DIR / "build_commute_cells.py")])


def run_primary_schools() -> None:
    """
    Build the primary school Ofsted overlay GeoJSON.
    The Ofsted MI CSV is auto-downloaded from gov.uk (--download flag).
    Output is staged inside MODEL_SCHOOLS_DIR and uploaded by
    upload_model_assets_to_r2.py (included in the default schools group).
    """
    run_step(
        "primary-schools-overlay",
        [
            str(SCRIPT_DIR / "build_primary_school_ofsted_overlay.py"),
            "--download",
            "--output",
            str(MODEL_SCHOOLS_DIR / "primary_school_overlay_points.geojson.gz"),
        ],
    )


def run_epc() -> None:
    """
    Build EPC fuel and age-band cell grids from the MHCLG bulk EPC download.
    Requires: raw/epc/all-domestic-certificates.zip downloaded manually from
              https://epc.opendatacommunities.org/domestic/search (free registration).
    Uploads via: upload_model_assets_to_r2.py (--skip-epc to omit).
    """
    run_step("epc-enrich", [str(SCRIPT_DIR / "build_epc_enriched.py")])
    run_step("epc-cells",  [str(SCRIPT_DIR / "build_epc_cells.py")])


def run_country_lookup() -> None:
    """
    Build slim country-lookup assets (country_cells_{grid}.json.gz and
    country_by_outward.json.gz) from vote cell outputs and ONSPD.
    Must run AFTER run_vote() since it reads the staged vote cell files.
    Uploads via: python pipeline/_upload_country_assets.py
    """
    run_step("country-lookup", [str(SCRIPT_DIR / "build_country_lookup_assets.py")])


def run_broadband() -> None:
    """
    Build broadband speed cells (broadband_cells_{grid}.json.gz) from
    Ofcom fixed broadband coverage data (OA level) joined to ONSPD.
    Requires: pipeline/data/raw/broadband/202507_fixed_broadband_coverage_r01.zip
              (or any *coverage*.zip from Ofcom Connected Nations)
    """
    run_step("broadband", [str(SCRIPT_DIR / "build_broadband_cells.py")])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ValueMap pipeline in the correct order")
    parser.add_argument("--skip-property", action="store_true", help="Skip property asset staging")
    parser.add_argument("--skip-schools", action="store_true", help="Skip school scoring and overlay generation")
    parser.add_argument("--skip-flood", action="store_true", help="Skip flood asset generation")
    parser.add_argument("--skip-stations", action="store_true", help="Skip train station overlay generation")
    parser.add_argument("--skip-vote", action="store_true", help="Skip vote artifact generation")
    parser.add_argument("--skip-crime", action="store_true", help="Skip crime overlay and cell generation")
    parser.add_argument("--skip-census", action="store_true", help="Skip Census age and commute fetch + cell generation (Nomis API, no key needed)")
    parser.add_argument("--skip-primary-schools", action="store_true", help="Skip primary school Ofsted overlay generation (auto-downloads Ofsted MI CSV)")
    parser.add_argument("--skip-epc", action="store_true", help="Skip EPC cell generation (requires all-domestic-certificates.zip manually downloaded)")
    parser.add_argument("--skip-country-lookup", action="store_true", help="Skip country-lookup asset generation (must run after vote step)")
    parser.add_argument("--skip-broadband", action="store_true", help="Skip broadband cell generation (requires 202507_fixed_broadband_coverage_r01.zip in raw/broadband/)")
    parser.add_argument(
        "--mainstream-only",
        action="store_true",
        help="Only generate mainstream school score variants (skip non-mainstream outputs)",
    )
    parser.add_argument(
        "--publish-public",
        action="store_true",
        help="Copy final model artifacts into public/data for local inspection",
    )
    parser.add_argument(
        "--no-publish-r2-staging",
        action="store_true",
        help="Do not copy model artifacts into pipeline/data/publish before R2 upload",
    )
    return parser.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()

    if not args.skip_property:
        run_property()

    if not args.skip_schools:
        run_schools(include_non_mainstream=not args.mainstream_only)

    if not args.skip_flood:
        run_flood()

    if not args.skip_stations:
        run_stations()

    if not args.skip_vote:
        run_vote()

    if not args.skip_crime:
        run_crime()

    if not args.skip_census:
        run_census()

    if not args.skip_primary_schools:
        run_primary_schools()

    if not args.skip_epc:
        run_epc()

    if not args.skip_country_lookup:
        run_country_lookup()

    if not args.skip_broadband:
        run_broadband()

    if not args.no_publish_r2_staging:
        copy_model_to_publish()

    if args.publish_public:
        copy_model_to_public()

    print("\nPipeline run completed.")


if __name__ == "__main__":
    main()

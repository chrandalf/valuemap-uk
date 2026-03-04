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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ValueMap pipeline in the correct order")
    parser.add_argument("--skip-property", action="store_true", help="Skip property asset staging")
    parser.add_argument("--skip-schools", action="store_true", help="Skip school scoring and overlay generation")
    parser.add_argument("--skip-flood", action="store_true", help="Skip flood asset generation")
    parser.add_argument("--skip-stations", action="store_true", help="Skip train station overlay generation")
    parser.add_argument("--skip-vote", action="store_true", help="Skip vote artifact generation")
    parser.add_argument("--skip-crime", action="store_true", help="Skip crime overlay and cell generation")
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

    if not args.no_publish_r2_staging:
        copy_model_to_publish()

    if args.publish_public:
        copy_model_to_public()

    print("\nPipeline run completed.")


if __name__ == "__main__":
    main()

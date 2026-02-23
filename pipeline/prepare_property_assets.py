#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from paths import (
    MODEL_PROPERTY_DIR,
    PUBLISH_PROPERTY_DIR,
    RAW_PROPERTY_DIR,
    ROOT,
    REQUIRED_PROPERTY_ASSET_NAMES,
    ensure_pipeline_dirs,
)


def resolve_source_dir(explicit_source: str | None) -> Path:
    if explicit_source:
        return Path(explicit_source).expanduser().resolve()
    return MODEL_PROPERTY_DIR


def candidate_source_dirs(primary: Path) -> list[Path]:
    base = ROOT
    candidates = [
        primary,
        base / "out" / "data",
        base / "public" / "data",
        base / "pipeline" / "data" / "model" / "property",
        base / "pipeline" / "data" / "publish" / "property",
    ]

    unique: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path.resolve()) if path.exists() else str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def copy_required_assets(source_dir: Path, output_dir: Path) -> tuple[list[Path], list[str], list[Path]]:
    copied: list[Path] = []
    missing: list[str] = []
    searched: list[Path] = []

    sources = candidate_source_dirs(source_dir)
    for source in sources:
        if source.exists():
            searched.append(source)

    for name in REQUIRED_PROPERTY_ASSET_NAMES:
        src = None
        for source in sources:
            candidate = source / name
            if candidate.exists():
                src = candidate
                break

        dst = output_dir / name
        if src is None:
            missing.append(name)
            continue
        try:
            if src.resolve() == dst.resolve():
                copied.append(dst)
                continue
        except Exception:
            pass
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(dst)

    return copied, missing, searched


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage required property artifacts for model/R2 upload")
    parser.add_argument(
        "--source-dir",
        default=None,
        help="Directory containing prebuilt property artifacts (default: pipeline/data/model/property)",
    )
    parser.add_argument(
        "--output-dir",
        default=str(PUBLISH_PROPERTY_DIR),
        help="Destination for staged property artifacts (default: pipeline/data/publish/property)",
    )
    return parser.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()

    source_dir = resolve_source_dir(args.source_dir)
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not source_dir.exists():
        raise SystemExit(f"Property source directory not found: {source_dir}")

    copied, missing, searched = copy_required_assets(source_dir, output_dir)

    print(f"Property source: {source_dir}")
    print(f"Property output: {output_dir}")
    if searched:
        print("Searched locations:")
        for path in searched:
            print(f"  - {path}")
    print(f"Copied files: {len(copied)}")
    for path in copied:
        print(f"  - {path.name}")

    if missing:
        names = "\n- ".join(missing)
        raise SystemExit(
            "Missing required property artifacts in source directory:\n- "
            + names
            + "\n\nPlace these files into pipeline/data/raw/property (or pass --source-dir)."
        )


if __name__ == "__main__":
    main()

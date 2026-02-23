#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path

from paths import PUBLISH_FLOOD_DIR, PUBLISH_SCHOOLS_DIR, PUBLISH_VOTE_DIR


def env_value(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value and value.strip():
            return value.strip()
    return ""


def build_client(account_id: str, access_key: str, secret_key: str):
    import importlib

    boto3 = importlib.import_module("boto3")
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


def collect_assets(
    vote_dir: Path,
    schools_dir: Path,
    flood_dir: Path,
    include_vote: bool,
    include_schools: bool,
    include_flood: bool,
) -> list[Path]:
    files: list[Path] = []
    if include_vote:
        files.extend(
            [
                vote_dir / "vote_cells_1km.json.gz",
                vote_dir / "vote_cells_5km.json.gz",
                vote_dir / "vote_cells_10km.json.gz",
                vote_dir / "vote_cells_25km.json.gz",
            ]
        )
    if include_schools:
        files.append(schools_dir / "school_overlay_points.geojson.gz")
    if include_flood:
        files.extend(
            [
                flood_dir / "flood_postcode_lookup.json.gz",
                flood_dir / "flood_outcode_summary.json.gz",
                flood_dir / "flood_postcode_points.geojson.gz",
            ]
        )
    return files


def content_type_for(path: Path) -> str:
    if path.name.endswith(".geojson.gz"):
        return "application/geo+json"
    if path.name.endswith(".json.gz"):
        return "application/json"
    return "application/gzip"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload staged model assets to Cloudflare R2")
    parser.add_argument("--vote-dir", default=str(PUBLISH_VOTE_DIR), help="Staged vote assets directory")
    parser.add_argument("--schools-dir", default=str(PUBLISH_SCHOOLS_DIR), help="Staged schools assets directory")
    parser.add_argument("--flood-dir", default=str(PUBLISH_FLOOD_DIR), help="Staged flood assets directory")
    parser.add_argument("--prefix", default=None, help="Optional R2 object prefix (overrides R2_PREFIX)")
    parser.add_argument("--skip-vote", action="store_true", help="Skip vote asset uploads")
    parser.add_argument("--skip-schools", action="store_true", help="Skip schools asset uploads")
    parser.add_argument("--skip-flood", action="store_true", help="Skip flood asset uploads")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    vote_dir = Path(args.vote_dir)
    schools_dir = Path(args.schools_dir)
    flood_dir = Path(args.flood_dir)

    include_vote = not args.skip_vote
    include_schools = not args.skip_schools
    include_flood = not args.skip_flood

    if not (include_vote or include_schools or include_flood):
        raise SystemExit("Nothing to upload. Enable at least one asset group.")

    files = collect_assets(vote_dir, schools_dir, flood_dir, include_vote, include_schools, include_flood)
    missing = [str(path) for path in files if not path.exists()]
    if missing:
        raise SystemExit("Missing staged files:\n- " + "\n- ".join(missing))

    account_id = env_value("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
    bucket_name = env_value("R2_BUCKET", "R2_BUCKET_NAME") or "valuemap-uk"
    access_key = env_value("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "S3_ACCESS_KEY")
    secret_key = env_value("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "S3_SECRET_KEY", "TOKEN_VALUE")
    prefix = (args.prefix if args.prefix is not None else env_value("R2_PREFIX")).strip("/")

    if not all([account_id, bucket_name, access_key, secret_key]):
        raise SystemExit(
            "Missing R2 credentials. Set R2_ACCOUNT_ID/CLOUDFLARE_ACCOUNT_ID, "
            "R2_BUCKET, R2_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID), and "
            "R2_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)."
        )

    try:
        s3 = build_client(account_id, access_key, secret_key)
    except ModuleNotFoundError:
        raise SystemExit("boto3 is not installed. Install with: pip install boto3")

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    print("R2 endpoint:", endpoint)
    print("R2 bucket:", bucket_name)
    print("R2 prefix:", prefix or "<none>")

    s3.head_bucket(Bucket=bucket_name)
    print("Bucket access check: OK")

    for path in files:
        object_key = f"{prefix}/{path.name}" if prefix else path.name
        s3.upload_file(
            str(path),
            bucket_name,
            object_key,
            ExtraArgs={
                "ContentType": content_type_for(path),
                "ContentEncoding": "gzip",
                "CacheControl": "public, max-age=86400",
            },
        )
        print(f"Uploaded: {object_key}")

    print(f"R2 upload finished: {len(files)} succeeded, 0 failed")


if __name__ == "__main__":
    main()

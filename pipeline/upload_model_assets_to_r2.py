#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from paths import (
    MODEL_EPC_DIR,
    MODEL_PROPERTY_DIR,
    PUBLISH_CRIME_DIR,
    PUBLISH_DIR,
    PUBLISH_FLOOD_DIR,
    PUBLISH_PROPERTY_DIR,
    PUBLISH_SCHOOLS_DIR,
    PUBLISH_STATIONS_DIR,
    PUBLISH_TRANSIT_DIR,
    PUBLISH_VOTE_DIR,
    R2_ARCHIVE_DIR,
    REQUIRED_PROPERTY_ASSET_NAMES,
    MODEL_BROADBAND_DIR,
)


def env_value(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value and value.strip():
            return value.strip()
    return ""


def build_client(account_id: str, access_key: str, secret_key: str):
    import importlib

    boto3 = importlib.import_module("boto3")
    config_mod = importlib.import_module("botocore.config")
    config = config_mod.Config(
        response_checksum_validation="when_required",
        request_checksum_calculation="when_required",
    )
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=config,
    )


def collect_assets(
    vote_dir: Path,
    schools_dir: Path,
    flood_dir: Path,
    property_dir: Path,
    stations_dir: Path,
    crime_dir: Path,
    epc_dir: Path,
    model_property_dir: Path,
    broadband_dir: Path,
    transit_dir: Path,
    include_vote: bool,
    include_schools: bool,
    include_flood: bool,
    include_property: bool,
    include_stations: bool,
    include_crime: bool,
    include_epc: bool,
    include_model: bool,
    include_broadband: bool,
    include_transit: bool,
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
        files.append(schools_dir / "primary_school_overlay_points.geojson.gz")
    if include_stations:
        files.append(stations_dir / "station_overlay_points.geojson.gz")
    if include_flood:
        files.extend(
            [
                flood_dir / "flood_postcode_lookup.json.gz",
                flood_dir / "flood_outcode_summary.json.gz",
                flood_dir / "flood_postcode_points.geojson.gz",
            ]
        )
    if include_property:
        files.extend(property_dir / name for name in REQUIRED_PROPERTY_ASSET_NAMES)
        # Include partitioned cell files (cells/{grid}/{metric}/{endMonth}/*.json.gz)
        cells_dir = property_dir / "cells"
        if cells_dir.is_dir():
            for partition_file in sorted(cells_dir.rglob("*.json.gz")):
                files.append(partition_file)
            # Also include manifest files
            for manifest_file in sorted(cells_dir.rglob("_manifest.json")):
                files.append(manifest_file)
    if include_crime:
        files.append(crime_dir / "crime_overlay_lsoa.geojson.gz")
        for grid in ("1km", "5km", "10km", "25km"):
            p = crime_dir / f"crime_cells_{grid}.json.gz"
            if p.exists():
                files.append(p)
    if include_epc:
        for kind in ("fuel", "age"):
            for grid in ("1km", "5km", "10km", "25km"):
                p = epc_dir / f"epc_{kind}_cells_{grid}.json.gz"
                if p.exists():
                    files.append(p)
    if include_model:
        for pt in ("ALL", "D", "S", "T", "F"):
            for nb in ("ALL", "Y", "N"):
                p = model_property_dir / f"modelled_1km_{pt}_{nb}.json.gz"
                if p.exists():
                    files.append(p)
    if include_broadband:
        for grid in ("1km", "5km", "10km", "25km"):
            p = broadband_dir / f"broadband_cells_{grid}.json.gz"
            if p.exists():
                files.append(p)
    if include_transit:
        for name in (
            "bus_stop_overlay_points.geojson.gz",
            "metro_tram_overlay_points.geojson.gz",
            "pharmacy_overlay_points.geojson.gz",
            "listed_building_overlay_points.geojson.gz",
        ):
            p = transit_dir / name
            if p.exists():
                files.append(p)
    return files


def content_type_for(path: Path) -> str:
    if path.name.endswith(".geojson.gz"):
        return "application/geo+json"
    if path.name.endswith(".json"):
        return "application/json"
    # .json.gz and other .gz files are stored as raw gzip bytes — use application/gzip.
    # Do NOT set ContentEncoding: gzip, as that causes boto3 to decompress the body
    # before uploading, storing plain bytes instead of the compressed file.
    return "application/gzip"


def object_keys_for_files(files: list[Path], prefix: str, property_dir: Path | None = None) -> list[str]:
    keys: list[str] = []
    for path in files:
        # For partition files under cells/, preserve the relative directory structure
        if property_dir and path.is_relative_to(property_dir / "cells"):
            rel = path.relative_to(property_dir)
            object_key = f"{prefix}/{rel.as_posix()}" if prefix else rel.as_posix()
        else:
            object_key = f"{prefix}/{path.name}" if prefix else path.name
        keys.append(object_key)
    return keys


def _is_not_found_error(exc: Exception) -> bool:
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    code = str(response.get("Error", {}).get("Code", "")).strip()
    return code in {"404", "NoSuchKey", "NotFound"}


def backup_remote_objects(
    s3,
    bucket_name: str,
    object_keys: list[str],
    backup_dir: Path,
    prefix: str,
) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    prefix_label = (prefix.replace("/", "_") if prefix else "root")
    archive_path = backup_dir / f"r2_backup_{timestamp}_{prefix_label}.zip"

    manifest = {
        "created_at_utc": timestamp,
        "bucket": bucket_name,
        "prefix": prefix,
        "object_count_requested": len(object_keys),
        "objects": [],
    }

    downloaded = 0
    missing = 0
    with TemporaryDirectory() as tmp_dir, ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as zf:
        tmp_root = Path(tmp_dir)
        for object_key in object_keys:
            info = {
                "key": object_key,
                "status": "downloaded",
                "size": None,
                "etag": None,
                "last_modified": None,
            }
            try:
                head = s3.head_object(Bucket=bucket_name, Key=object_key)
                info["size"] = int(head.get("ContentLength", 0))
                info["etag"] = str(head.get("ETag", "")).strip('"')
                last_modified = head.get("LastModified")
                if last_modified is not None:
                    info["last_modified"] = last_modified.isoformat()
                tmp_file = tmp_root / Path(object_key).name
                obj = s3.get_object(Bucket=bucket_name, Key=object_key)
                if info["size"] is None and obj.get("ContentLength") is not None:
                    info["size"] = int(obj.get("ContentLength", 0))
                body = obj["Body"]
                with open(tmp_file, "wb") as fh:
                    while True:
                        chunk = body.read(1024 * 1024)
                        if not chunk:
                            break
                        fh.write(chunk)
                body.close()
                zf.write(tmp_file, arcname=f"objects/{object_key}")
                downloaded += 1
            except Exception as exc:
                if _is_not_found_error(exc):
                    info["status"] = "missing"
                    missing += 1
                else:
                    raise
            manifest["objects"].append(info)

        manifest["object_count_downloaded"] = downloaded
        manifest["object_count_missing"] = missing
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    print(f"R2 backup archive created: {archive_path}")
    print(f"R2 backup summary: requested={len(object_keys)} downloaded={downloaded} missing={missing}")
    return archive_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload staged model assets to Cloudflare R2")
    parser.add_argument("--vote-dir", default=str(PUBLISH_VOTE_DIR), help="Staged vote assets directory")
    parser.add_argument("--schools-dir", default=str(PUBLISH_SCHOOLS_DIR), help="Staged schools assets directory")
    parser.add_argument("--stations-dir", default=str(PUBLISH_STATIONS_DIR), help="Staged stations assets directory")
    parser.add_argument("--flood-dir", default=str(PUBLISH_FLOOD_DIR), help="Staged flood assets directory")
    parser.add_argument("--property-dir", default=str(PUBLISH_PROPERTY_DIR), help="Staged property assets directory")
    parser.add_argument("--prefix", default=None, help="Optional R2 object prefix (overrides R2_PREFIX)")
    parser.add_argument("--skip-property", action="store_true", help="Skip property asset uploads")
    parser.add_argument("--skip-vote", action="store_true", help="Skip vote asset uploads")
    parser.add_argument("--skip-schools", action="store_true", help="Skip schools asset uploads")
    parser.add_argument("--skip-stations", action="store_true", help="Skip stations asset uploads")
    parser.add_argument("--skip-flood", action="store_true", help="Skip flood asset uploads")
    parser.add_argument("--crime-dir", default=str(PUBLISH_CRIME_DIR), help="Staged crime assets directory")
    parser.add_argument("--skip-crime", action="store_true", help="Skip crime overlay upload")
    parser.add_argument("--epc-dir", default=str(MODEL_EPC_DIR), help="EPC cell assets directory")
    parser.add_argument("--skip-epc", action="store_true", help="Skip EPC cell upload")
    parser.add_argument("--skip-model", action="store_true", help="Skip modelled price estimate upload")
    parser.add_argument("--broadband-dir", default=str(MODEL_BROADBAND_DIR), help="Broadband cell assets directory")
    parser.add_argument("--skip-broadband", action="store_true", help="Skip broadband cell upload")
    parser.add_argument("--transit-dir", default=str(PUBLISH_TRANSIT_DIR), help="Staged transit assets directory")
    parser.add_argument("--skip-transit", action="store_true", help="Skip bus stop, metro/tram, and pharmacy overlay upload")
    parser.add_argument(
        "--no-backup-before-upload",
        action="store_true",
        help="Skip pre-upload backup archive of current remote R2 objects",
    )
    parser.add_argument(
        "--backup-dir",
        default=str(R2_ARCHIVE_DIR),
        help="Directory for pre-upload R2 backup archives",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    vote_dir = Path(args.vote_dir)
    schools_dir = Path(args.schools_dir)
    stations_dir = Path(args.stations_dir)
    flood_dir = Path(args.flood_dir)
    property_dir = Path(args.property_dir)
    crime_dir = Path(args.crime_dir)
    epc_dir = Path(args.epc_dir)
    broadband_dir = Path(args.broadband_dir)
    transit_dir = Path(args.transit_dir)

    include_vote = not args.skip_vote
    include_schools = not args.skip_schools
    include_stations = not args.skip_stations
    include_flood = not args.skip_flood
    include_property = not args.skip_property
    include_crime = not args.skip_crime
    include_epc = not args.skip_epc
    include_model = not args.skip_model
    include_broadband = not args.skip_broadband
    include_transit = not args.skip_transit
    backup_before_upload = not args.no_backup_before_upload
    backup_dir = Path(args.backup_dir)

    only_freshness = not (include_vote or include_schools or include_stations or include_flood or include_property or include_crime or include_epc or include_model or include_broadband or include_transit)

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

    if not only_freshness:
        files = collect_assets(
            vote_dir,
            schools_dir,
            flood_dir,
            property_dir,
            stations_dir,
            crime_dir,
            epc_dir,
            MODEL_PROPERTY_DIR,
            broadband_dir,
            transit_dir,
            include_vote,
            include_schools,
            include_flood,
            include_property,
            include_stations,
            include_crime,
            include_epc,
            include_model,
            include_broadband,
            include_transit,
        )
        missing = [str(path) for path in files if not path.exists()]
        if missing:
            raise SystemExit("Missing staged files:\n- " + "\n- ".join(missing))

        object_keys = object_keys_for_files(files, prefix, property_dir=property_dir if include_property else None)
        if backup_before_upload:
            backup_remote_objects(
                s3=s3,
                bucket_name=bucket_name,
                object_keys=object_keys,
                backup_dir=backup_dir,
                prefix=prefix,
            )

        for path, object_key in zip(files, object_keys):
            extra_args: dict = {
                "ContentType": content_type_for(path),
                "CacheControl": "public, max-age=86400",
            }
            s3.upload_file(
                str(path),
                bucket_name,
                object_key,
                ExtraArgs=extra_args,
            )
            print(f"Uploaded: {object_key}")

        print(f"R2 upload finished: {len(files)} succeeded, 0 failed")

    # Always regenerate and upload data_freshness.json (regardless of skip flags)
    print("\n[freshness] Regenerating data_freshness.json ...")
    from build_data_freshness import build_freshness, OUTPUT_PATH as FRESHNESS_PATH
    freshness = build_freshness()
    FRESHNESS_PATH.write_text(__import__("json").dumps(freshness, indent=2))
    freshness_key = f"{prefix}/data_freshness.json" if prefix else "data_freshness.json"
    s3.upload_file(
        str(FRESHNESS_PATH),
        bucket_name,
        freshness_key,
        ExtraArgs={"ContentType": "application/json", "CacheControl": "public, max-age=3600"},
    )
    print(f"Uploaded: {freshness_key}")


if __name__ == "__main__":
    main()

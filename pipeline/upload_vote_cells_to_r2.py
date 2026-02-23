#!/usr/bin/env python3
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from paths import PUBLISH_VOTE_DIR, R2_ARCHIVE_DIR


def env_value(*keys: str) -> str:
    for k in keys:
        value = os.getenv(k)
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


def _is_not_found_error(exc: Exception) -> bool:
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    code = str(response.get("Error", {}).get("Code", "")).strip()
    return code in {"404", "NoSuchKey", "NotFound"}


def backup_remote_objects(s3, bucket_name: str, object_keys: list[str], backup_dir: Path, prefix: str) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    prefix_label = (prefix.replace("/", "_") if prefix else "root")
    archive_path = backup_dir / f"r2_backup_{timestamp}_{prefix_label}_vote.zip"

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


def main():
    parser = argparse.ArgumentParser(description="Upload vote_cells_<grid>.json.gz artifacts to Cloudflare R2")
    parser.add_argument("--data-dir", default=str(PUBLISH_VOTE_DIR), help="Directory containing vote_cells_*.json.gz")
    parser.add_argument("--prefix", default=None, help="Optional R2 object prefix (overrides R2_PREFIX)")
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
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    files = [
        data_dir / "vote_cells_1km.json.gz",
        data_dir / "vote_cells_5km.json.gz",
        data_dir / "vote_cells_10km.json.gz",
        data_dir / "vote_cells_25km.json.gz",
    ]

    missing = [str(p) for p in files if not p.exists()]
    if missing:
      raise SystemExit("Missing files:\n- " + "\n- ".join(missing))

    account_id = env_value("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
    bucket_name = env_value("R2_BUCKET", "R2_BUCKET_NAME") or "valuemap-uk"
    access_key = env_value("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "S3_ACCESS_KEY")
    secret_key = env_value("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "S3_SECRET_KEY", "TOKEN_VALUE")
    prefix = (args.prefix if args.prefix is not None else env_value("R2_PREFIX")).strip("/")
    backup_before_upload = not args.no_backup_before_upload
    backup_dir = Path(args.backup_dir)

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

    object_keys = [f"{prefix}/{path.name}" if prefix else path.name for path in files]
    if backup_before_upload:
        backup_remote_objects(
            s3=s3,
            bucket_name=bucket_name,
            object_keys=object_keys,
            backup_dir=backup_dir,
            prefix=prefix,
        )

    for path, object_key in zip(files, object_keys):
        s3.upload_file(
            str(path),
            bucket_name,
            object_key,
            ExtraArgs={"ContentType": "application/gzip", "CacheControl": "public, max-age=86400"},
        )
        print(f"Uploaded to R2: {object_key}")

    print("R2 upload finished: 4 succeeded, 0 failed")


if __name__ == "__main__":
    main()

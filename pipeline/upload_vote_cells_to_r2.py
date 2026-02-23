#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

from paths import PUBLISH_VOTE_DIR


def env_value(*keys: str) -> str:
    for k in keys:
        value = os.getenv(k)
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


def main():
    parser = argparse.ArgumentParser(description="Upload vote_cells_<grid>.json.gz artifacts to Cloudflare R2")
    parser.add_argument("--data-dir", default=str(PUBLISH_VOTE_DIR), help="Directory containing vote_cells_*.json.gz")
    parser.add_argument("--prefix", default=None, help="Optional R2 object prefix (overrides R2_PREFIX)")
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
            ExtraArgs={"ContentType": "application/gzip", "CacheControl": "public, max-age=86400"},
        )
        print(f"Uploaded to R2: {object_key}")

    print("R2 upload finished: 4 succeeded, 0 failed")


if __name__ == "__main__":
    main()

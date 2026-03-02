"""Quick targeted upload of just the two new country lookup assets to R2."""
import os, sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from pathlib import Path
from upload_model_assets_to_r2 import build_client, content_type_for

PUBLISH_PROPERTY_DIR = Path(__file__).parent / "data" / "publish" / "property"

FILES = [
    PUBLISH_PROPERTY_DIR / "country_cells_1km.json.gz",
    PUBLISH_PROPERTY_DIR / "country_cells_5km.json.gz",
    PUBLISH_PROPERTY_DIR / "country_cells_10km.json.gz",
    PUBLISH_PROPERTY_DIR / "country_cells_25km.json.gz",
    PUBLISH_PROPERTY_DIR / "country_by_outward.json.gz",
]

def env(*keys):
    for k in keys:
        v = os.getenv(k, "").strip()
        if v: return v
    return ""

account_id  = env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
bucket_name = env("R2_BUCKET", "R2_BUCKET_NAME") or "valuemap-uk"
access_key  = env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "S3_ACCESS_KEY")
secret_key  = env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "S3_SECRET_KEY", "TOKEN_VALUE")
prefix      = env("R2_PREFIX").strip("/")

if not all([account_id, access_key, secret_key]):
    raise SystemExit("Missing R2 credentials")

s3 = build_client(account_id, access_key, secret_key)
s3.head_bucket(Bucket=bucket_name)
print(f"Bucket: {bucket_name}  Prefix: {prefix or '<none>'}")

for path in FILES:
    key = f"{prefix}/{path.name}" if prefix else path.name
    extra = {"ContentType": content_type_for(path), "CacheControl": "public, max-age=86400"}
    if path.name.endswith(".gz"):
        extra["ContentEncoding"] = "gzip"
    s3.upload_file(str(path), bucket_name, key, ExtraArgs=extra)
    print(f"  Uploaded {key}  ({path.stat().st_size/1024:.1f} KB)")

print("Done.")

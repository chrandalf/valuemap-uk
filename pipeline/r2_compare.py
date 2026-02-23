import os
from pathlib import Path
import json

import boto3


def env_value(*keys):
    for key in keys:
        value = os.getenv(key)
        if value and value.strip():
            return value.strip()
    return ""


account_id = env_value("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
bucket = env_value("R2_BUCKET", "R2_BUCKET_NAME") or "valuemap-uk"
access = env_value("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "S3_ACCESS_KEY")
secret = env_value("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "S3_SECRET_KEY", "TOKEN_VALUE")
prefix = env_value("R2_PREFIX").strip("/")

if not all([account_id, bucket, access, secret]):
    raise SystemExit("Missing R2 credentials in environment")

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
    aws_access_key_id=access,
    aws_secret_access_key=secret,
    region_name="auto",
)

objs = []
kwargs = {"Bucket": bucket}
if prefix:
    kwargs["Prefix"] = prefix + "/"

while True:
    response = s3.list_objects_v2(**kwargs)
    for obj in response.get("Contents", []):
        objs.append({"Key": obj["Key"], "Size": int(obj["Size"])})
    if not response.get("IsTruncated"):
        break
    kwargs["ContinuationToken"] = response["NextContinuationToken"]

local = []
for path in sorted(Path("pipeline/data/publish").rglob("*")):
    if path.is_file():
        local.append({
            "name": path.name,
            "path": str(path).replace("\\", "/"),
            "size": path.stat().st_size,
        })

r2_by_name = {}
for obj in objs:
    name = obj["Key"].split("/")[-1]
    if name not in r2_by_name or obj["Size"] > r2_by_name[name]["Size"]:
        r2_by_name[name] = obj

local_by_name = {entry["name"]: entry for entry in local}
common = sorted(set(local_by_name) & set(r2_by_name))
missing = sorted(set(local_by_name) - set(r2_by_name))
extra = sorted(set(r2_by_name) - set(local_by_name))

pairs = []
for name in common:
    local_size = local_by_name[name]["size"]
    r2_size = r2_by_name[name]["Size"]
    diff = r2_size - local_size
    rel = abs(diff) / max(local_size, 1)
    pairs.append(
        {
            "name": name,
            "local_size": local_size,
            "r2_size": r2_size,
            "diff_bytes": diff,
            "diff_pct": round(rel * 100, 2),
            "huge_diff": (abs(diff) > 100_000 and rel > 0.20),
            "r2_key": r2_by_name[name]["Key"],
        }
    )

huge = [pair for pair in pairs if pair["huge_diff"]]

report = {
    "bucket": bucket,
    "prefix": prefix,
    "r2_count": len(objs),
    "local_count": len(local),
    "matched_count": len(common),
    "missing_in_r2": missing,
    "extra_in_r2": extra,
    "huge_diffs": huge,
    "r2_files": sorted(objs, key=lambda item: item["Key"]),
    "pairs": pairs,
}

report_path = Path("pipeline/data/r2_compare_report.json")
report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

print(f"bucket={bucket}")
print(f"prefix={prefix or '<none>'}")
print(f"r2_count={len(objs)} local_count={len(local)} matched={len(common)}")
print(f"missing_in_r2={len(missing)}")
for item in missing:
    print(f"  MISSING {item}")
print(f"extra_in_r2={len(extra)}")
for item in extra:
    print(f"  EXTRA {item}")
print(f"huge_diffs={len(huge)}")
for item in huge:
    print(
        "  HUGE "
        f"{item['name']} local={item['local_size']} r2={item['r2_size']} diff_pct={item['diff_pct']}"
    )
print(f"report={report_path}")

from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path

import pandas as pd


DEFAULT_INPUT = "/kaggle/input/datasets/mexwell/open-flood-risk-by-postcode/open_flood_risk_by_postcode.csv"
DEFAULT_OUT = "/kaggle/working/flood_outputs"

RISK_SCORE = {
    "none": 0,
    "very low": 1,
    "low": 2,
    "medium": 3,
    "high": 4,
}


def normalize_colname(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def pick_column(columns: list[str], candidates: list[str]) -> str:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    raise ValueError(f"Missing expected column. Tried: {candidates}")


def normalize_postcode_key(value: str) -> str:
    return re.sub(r"\s+", "", str(value).upper()).strip()


def derive_outcode(postcode_key: str) -> str:
    text = postcode_key.strip().upper()
    if not text:
        return ""
    match = re.match(r"^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$", text)
    if match:
        return match.group(1)
    return text[:-3] if len(text) > 3 else text


def to_float_or_none(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(number):
        return None
    return number


def to_int_or_none(value: object) -> int | None:
    number = to_float_or_none(value)
    if number is None:
        return None
    return int(round(number))


def to_str_or_none(value: object) -> str | None:
    if pd.isna(value):
        return None
    return str(value)


def write_json_gz(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)


def build_assets(input_csv: Path, out_dir: Path) -> None:
    df = pd.read_csv(input_csv, dtype=str)
    df.columns = [normalize_colname(c) for c in df.columns]

    cols = list(df.columns)
    postcode_col = pick_column(cols, ["postcode", "pcds", "pcd7", "pcd8"])
    band_col = pick_column(cols, ["prob_4band", "prob4band", "risk_band"])
    pub_date_col = pick_column(cols, ["pub_date", "publish_date", "publication_date"])
    suitability_col = pick_column(cols, ["suitability"])
    ins_col = pick_column(cols, ["risk_for_insurance_sop", "risk_for_insurance", "insurance_risk"])
    east_col = pick_column(cols, ["easting", "east1m", "x"])
    north_col = pick_column(cols, ["northing", "north1m", "y"])
    lat_col = pick_column(cols, ["latitude", "lat"])
    lon_col = pick_column(cols, ["longitude", "lon", "lng"])

    work = df[[postcode_col, band_col, pub_date_col, suitability_col, ins_col, east_col, north_col, lat_col, lon_col]].copy()
    work = work.rename(
        columns={
            postcode_col: "postcode",
            band_col: "risk_band",
            pub_date_col: "pub_date",
            suitability_col: "suitability",
            ins_col: "risk_for_insurance_sop",
            east_col: "easting",
            north_col: "northing",
            lat_col: "latitude",
            lon_col: "longitude",
        }
    )

    work["postcode"] = work["postcode"].astype("string").str.strip().str.upper()
    work = work[work["postcode"].notna() & (work["postcode"].str.len() > 0)]
    work["postcode_key"] = work["postcode"].map(normalize_postcode_key)
    work["outcode"] = work["postcode_key"].map(derive_outcode)

    work["risk_band"] = work["risk_band"].astype("string").str.strip()
    work["risk_band_norm"] = work["risk_band"].str.lower().fillna("none")
    work["risk_score"] = work["risk_band_norm"].map(RISK_SCORE).fillna(0).astype(int)

    work["pub_date_ts"] = pd.to_datetime(
        work["pub_date"],
        errors="coerce",
        format="mixed",
        dayfirst=True,
    )

    work = work.sort_values(["postcode_key", "risk_score", "pub_date_ts"], ascending=[True, False, False])
    dedup = work.drop_duplicates(subset=["postcode_key"], keep="first").copy()

    postcode_lookup: dict[str, dict[str, object]] = {}
    for row in dedup.itertuples(index=False):
        postcode_lookup[row.postcode_key] = {
            "postcode": row.postcode,
            "outcode": row.outcode,
            "risk_band": to_str_or_none(row.risk_band),
            "risk_score": int(row.risk_score),
            "suitability": to_str_or_none(row.suitability),
            "risk_for_insurance_sop": to_str_or_none(row.risk_for_insurance_sop),
            "pub_date": to_str_or_none(row.pub_date),
            "easting": to_int_or_none(row.easting),
            "northing": to_int_or_none(row.northing),
            "latitude": to_float_or_none(row.latitude),
            "longitude": to_float_or_none(row.longitude),
        }

    outcode_summary = (
        dedup.groupby("outcode", dropna=False)
        .agg(
            postcode_count=("postcode_key", "count"),
            max_risk_score=("risk_score", "max"),
            mean_risk_score=("risk_score", "mean"),
            high_count=("risk_band_norm", lambda s: int((s == "high").sum())),
            medium_count=("risk_band_norm", lambda s: int((s == "medium").sum())),
            low_count=("risk_band_norm", lambda s: int((s == "low").sum())),
            very_low_count=("risk_band_norm", lambda s: int((s == "very low").sum())),
            none_count=("risk_band_norm", lambda s: int((s == "none").sum())),
        )
        .reset_index()
    )

    outcode_payload = []
    for row in outcode_summary.itertuples(index=False):
        outcode_payload.append(
            {
                "outcode": "" if pd.isna(row.outcode) else str(row.outcode),
                "postcode_count": int(row.postcode_count),
                "max_risk_score": int(row.max_risk_score),
                "mean_risk_score": round(float(row.mean_risk_score), 3),
                "high_count": int(row.high_count),
                "medium_count": int(row.medium_count),
                "low_count": int(row.low_count),
                "very_low_count": int(row.very_low_count),
                "none_count": int(row.none_count),
            }
        )

    point_features = []
    for row in dedup.itertuples(index=False):
        lon = to_float_or_none(row.longitude)
        lat = to_float_or_none(row.latitude)
        if lon is None or lat is None:
            continue
        point_features.append(
            {
                "type": "Feature",
                "properties": {
                    "postcode": row.postcode,
                    "postcode_key": row.postcode_key,
                    "outcode": row.outcode,
                    "risk_band": to_str_or_none(row.risk_band),
                    "risk_score": int(row.risk_score),
                    "suitability": to_str_or_none(row.suitability),
                    "risk_for_insurance_sop": to_str_or_none(row.risk_for_insurance_sop),
                    "pub_date": to_str_or_none(row.pub_date),
                    "easting": to_int_or_none(row.easting),
                    "northing": to_int_or_none(row.northing),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat],
                },
            }
        )

    geojson = {"type": "FeatureCollection", "features": point_features}

    write_json_gz(out_dir / "flood_postcode_lookup.json.gz", postcode_lookup)
    write_json_gz(out_dir / "flood_outcode_summary.json.gz", outcode_payload)
    write_json_gz(out_dir / "flood_postcode_points.geojson.gz", geojson)

    manifest = {
        "input_csv": str(input_csv),
        "postcodes": len(postcode_lookup),
        "outcodes": len(outcode_payload),
        "geojson_points": len(point_features),
        "files": {
            "postcode_lookup": "flood_postcode_lookup.json.gz",
            "outcode_summary": "flood_outcode_summary.json.gz",
            "postcode_points_geojson": "flood_postcode_points.geojson.gz",
        },
    }
    (out_dir / "flood_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build postcode-level flood assets for ValueMap.")
    parser.add_argument("--input-csv", type=Path, default=Path(DEFAULT_INPUT), help="Source flood CSV path")
    parser.add_argument("--out-dir", type=Path, default=Path(DEFAULT_OUT), help="Output folder")

    # Notebook kernels (Kaggle/Colab/Jupyter) inject args like "-f <kernel.json>".
    # parse_known_args keeps CLI behaviour while ignoring those unrelated args.
    args, _unknown = parser.parse_known_args()

    build_assets(args.input_csv, args.out_dir)
    print(f"Wrote flood assets to: {args.out_dir}")

#!/usr/bin/env python3
"""
Build postcode-ready KS4 school quality scores from england_ks4revised.csv.

This file includes school-level postcode (`PCODE`) and attainment metrics,
which can be wrangled into a map-ready dataset keyed by postcode/outcode.
"""

from __future__ import annotations

import argparse
import csv
import re
from bisect import bisect_right
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from paths import (
    INTERMEDIATE_SCHOOL_POSTCODE_SCORES,
    RAW_SCHOOL_KS4,
    ensure_pipeline_dirs,
)

MISSING_MARKERS = {"", "na", "np", "ne", "supp", "null", "x", "z", "c"}

# KS4 revised columns in england_ks4revised.csv
METRIC_COLUMNS = {
    "att8": "ATT8SCR",                  # Attainment 8 average score
    "em95": "PTL2BASICS_95",           # % achieving 9-5 (English + maths)
    "ebaps": "EBACCAPS",               # EBacc APS average
    "ebacc_enter": "PTEBACC_E_PTQ_EE", # % entering EBacc
    "pupils": "TOTPUPS",               # Total pupils at end KS4
}

DEFAULT_WEIGHTS = {
    "att8": 0.35,
    "em95": 0.35,
    "ebaps": 0.20,
    "ebacc_enter": 0.10,
}


def parse_num(value: Optional[str]) -> Optional[float]:
    text = (value or "").strip()
    if not text:
        return None
    lowered = text.lower()
    if lowered in MISSING_MARKERS:
        return None
    if text.endswith("%"):
        text = text[:-1].strip()
    try:
        return float(text)
    except ValueError:
        return None


def normalize_postcode_key(value: Optional[str]) -> str:
    return re.sub(r"\s+", "", str(value or "").upper()).strip()


def derive_outcode(postcode_key: str) -> str:
    text = postcode_key.strip().upper()
    if not text:
        return ""
    match = re.match(r"^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$", text)
    if match:
        return match.group(1)
    return text[:-3] if len(text) > 3 else text


def rank_percentiles(records: List[dict], key: str) -> None:
    values = sorted(r[key] for r in records if r[key] is not None)
    n = len(values)
    if n <= 1:
        for r in records:
            r[f"{key}_rank"] = 0.5
        return

    for r in records:
        v = r[key]
        if v is None:
            r[f"{key}_rank"] = 0.5
            continue
        pos = bisect_right(values, v) - 1
        r[f"{key}_rank"] = max(0.0, min(1.0, pos / (n - 1)))


def band_for_score(score: float) -> str:
    if score < 0.10:
        return "Very weak"
    if score < 0.25:
        return "Weak"
    if score < 0.40:
        return "Below average"
    if score < 0.60:
        return "Average"
    if score < 0.75:
        return "Good"
    if score < 0.90:
        return "Strong"
    return "Excellent"


def confidence_for_pupil_count(pupil_count: Optional[float]) -> str:
    p = pupil_count or 0.0
    if p < 20:
        return "low"
    if p < 60:
        return "medium"
    return "high"


def is_mainstream_nftype(code: str) -> bool:
    text = (code or "").strip().upper()
    if not text:
        return True
    if text.startswith("IND"):
        return False
    if text.endswith("S"):
        return False
    return True


def load_records(path: Path, mainstream_only: bool) -> List[dict]:
    records: List[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            urn = (row.get("URN") or "").strip()
            if not urn:
                continue

            rec_type = (row.get("RECTYPE") or "").strip()
            if rec_type not in {"1", "2"}:
                continue

            nftype = (row.get("NFTYPE") or "").strip().upper()
            mainstream = is_mainstream_nftype(nftype)
            if mainstream_only and not mainstream:
                continue

            postcode = (row.get("PCODE") or "").strip().upper()
            postcode_key = normalize_postcode_key(postcode)

            record = {
                "urn": urn,
                "lea": (row.get("LEA") or "").strip(),
                "estab": (row.get("ESTAB") or "").strip(),
                "school_name": (row.get("SCHNAME") or "").strip(),
                "town": (row.get("TOWN") or "").strip(),
                "postcode": postcode,
                "postcode_key": postcode_key,
                "outcode": derive_outcode(postcode_key),
                "nftype": nftype,
                "mainstream_like": 1 if mainstream else 0,
                "att8": parse_num(row.get(METRIC_COLUMNS["att8"])),
                "em95": parse_num(row.get(METRIC_COLUMNS["em95"])),
                "ebaps": parse_num(row.get(METRIC_COLUMNS["ebaps"])),
                "ebacc_enter": parse_num(row.get(METRIC_COLUMNS["ebacc_enter"])),
                "pupils": parse_num(row.get(METRIC_COLUMNS["pupils"])),
            }

            has_core = (
                record["att8"] is not None
                and record["em95"] is not None
                and record["ebaps"] is not None
            )
            if not has_core:
                continue

            records.append(record)

    return records


def score_records(records: List[dict]) -> None:
    for metric in ("att8", "em95", "ebaps", "ebacc_enter"):
        rank_percentiles(records, metric)

    for r in records:
        r["quality_score"] = (
            DEFAULT_WEIGHTS["att8"] * r["att8_rank"]
            + DEFAULT_WEIGHTS["em95"] * r["em95_rank"]
            + DEFAULT_WEIGHTS["ebaps"] * r["ebaps_rank"]
            + DEFAULT_WEIGHTS["ebacc_enter"] * r["ebacc_enter_rank"]
        )
        r["quality_band"] = band_for_score(r["quality_score"])
        r["score_confidence"] = confidence_for_pupil_count(r["pupils"])


def write_output(path: Path, records: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "urn",
        "lea",
        "estab",
        "school_name",
        "town",
        "postcode",
        "postcode_key",
        "outcode",
        "nftype",
        "mainstream_like",
        "pupils",
        "att8",
        "em95",
        "ebaps",
        "ebacc_enter",
        "att8_rank",
        "em95_rank",
        "ebaps_rank",
        "ebacc_enter_rank",
        "quality_score",
        "quality_band",
        "score_confidence",
    ]

    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in sorted(records, key=lambda x: x["quality_score"]):
            writer.writerow(r)


def quantile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    i = int((len(values) - 1) * p)
    i = max(0, min(len(values) - 1, i))
    return values[i]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build postcode-ready KS4 school quality scores")
    parser.add_argument("--input", default=str(RAW_SCHOOL_KS4), help="Path to england_ks4revised.csv")
    parser.add_argument("--output", default=str(INTERMEDIATE_SCHOOL_POSTCODE_SCORES), help="Output CSV path")
    parser.add_argument(
        "--mainstream-only",
        action="store_true",
        help="Exclude likely independent/special NFTYPE school groups from scoring",
    )
    return parser.parse_args()


def main() -> None:
    ensure_pipeline_dirs()
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    records = load_records(input_path, mainstream_only=args.mainstream_only)
    score_records(records)
    write_output(output_path, records)

    scores = sorted(r["quality_score"] for r in records)
    has_postcode = sum(1 for r in records if r["postcode_key"])
    print(f"Scored schools: {len(records)}")
    print(f"Rows with postcode: {has_postcode}")
    if scores:
        print(
            "Score quantiles:",
            {
                "p10": round(quantile(scores, 0.10), 4),
                "p25": round(quantile(scores, 0.25), 4),
                "p50": round(quantile(scores, 0.50), 4),
                "p75": round(quantile(scores, 0.75), 4),
                "p90": round(quantile(scores, 0.90), 4),
            },
        )


if __name__ == "__main__":
    main()

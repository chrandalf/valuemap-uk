#!/usr/bin/env python3
"""
Build a per-school KS4 quality score from DfE performance tables.

Input expected: 202425_performance_tables_schools_revised.csv
Output: CSV with one row per school (Total/Total breakdown) plus normalized score,
banding, and a confidence flag based on cohort size.
"""

from __future__ import annotations

import argparse
import csv
from bisect import bisect_right
from pathlib import Path
from typing import Dict, Iterable, List, Optional

MISSING_MARKERS = {"", "z", "c", "x", "na", "null", "supp"}

CORE_METRICS = {
    "att8": "attainment8_average",
    "em95": "engmath_95_percent",
    "ebaps": "ebacc_aps_average",
    "ebent": "ebacc_entering_percent",
    "pupils": "pupil_count",
}

DEFAULT_WEIGHTS = {
    "att8": 0.35,
    "em95": 0.35,
    "ebaps": 0.20,
    "ebent": 0.10,
}


def parse_num(value: Optional[str]) -> Optional[float]:
    text = (value or "").strip().lower()
    if text in MISSING_MARKERS:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def read_total_rows(path: Path) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("breakdown_topic") or "").strip() != "Total":
                continue
            if (row.get("breakdown") or "").strip() != "Total":
                continue
            out.append(row)
    return out


def is_mainstream_type(establishment_type_group: str) -> bool:
    text = establishment_type_group.strip().lower()
    if not text:
        return True
    return ("special" not in text) and ("independent" not in text)


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


def quantile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    i = int((len(values) - 1) * p)
    i = max(0, min(len(values) - 1, i))
    return values[i]


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


def build_scored_rows(rows: Iterable[Dict[str, str]], mainstream_only: bool) -> List[dict]:
    records: List[dict] = []
    for row in rows:
        etg = (row.get("establishment_type_group") or "").strip()
        mainstream = is_mainstream_type(etg)
        if mainstream_only and not mainstream:
            continue

        record = {
            "school_urn": (row.get("school_urn") or "").strip(),
            "school_laestab": (row.get("school_laestab") or "").strip(),
            "school_name": (row.get("school_name") or "").strip(),
            "la_name": (row.get("la_name") or "").strip(),
            "establishment_type_group": etg,
            "mainstream_like": 1 if mainstream else 0,
            "att8": parse_num(row.get(CORE_METRICS["att8"])),
            "em95": parse_num(row.get(CORE_METRICS["em95"])),
            "ebaps": parse_num(row.get(CORE_METRICS["ebaps"])),
            "ebent": parse_num(row.get(CORE_METRICS["ebent"])),
            "pupils": parse_num(row.get(CORE_METRICS["pupils"])),
        }

        has_core = (
            record["att8"] is not None
            and record["em95"] is not None
            and record["ebaps"] is not None
        )
        if not has_core:
            continue

        records.append(record)

    for metric in ("att8", "em95", "ebaps", "ebent"):
        rank_percentiles(records, metric)

    for r in records:
        r["quality_score"] = (
            DEFAULT_WEIGHTS["att8"] * r["att8_rank"]
            + DEFAULT_WEIGHTS["em95"] * r["em95_rank"]
            + DEFAULT_WEIGHTS["ebaps"] * r["ebaps_rank"]
            + DEFAULT_WEIGHTS["ebent"] * r["ebent_rank"]
        )
        r["quality_band"] = band_for_score(r["quality_score"])
        r["score_confidence"] = confidence_for_pupil_count(r["pupils"])

    return records


def write_csv(path: Path, rows: List[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "school_urn",
        "school_laestab",
        "school_name",
        "la_name",
        "establishment_type_group",
        "mainstream_like",
        "pupils",
        "att8",
        "em95",
        "ebaps",
        "ebent",
        "att8_rank",
        "em95_rank",
        "ebaps_rank",
        "ebent_rank",
        "quality_score",
        "quality_band",
        "score_confidence",
    ]

    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build per-school KS4 quality scores from DfE performance tables")
    p.add_argument("--input", required=True, help="Path to 202425_performance_tables_schools_revised.csv")
    p.add_argument("--output", required=True, help="Output CSV path (e.g. public/data/school_scores_202425.csv)")
    p.add_argument(
        "--mainstream-only",
        action="store_true",
        help="Keep only mainstream-like schools for scoring baseline (exclude independent/special)",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    rows = read_total_rows(input_path)
    scored = build_scored_rows(rows, mainstream_only=args.mainstream_only)
    scored.sort(key=lambda r: r["quality_score"])

    write_csv(output_path, scored)

    scores = [r["quality_score"] for r in scored]
    print(f"Input total rows: {len(rows)}")
    print(f"Scored schools: {len(scored)}")
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

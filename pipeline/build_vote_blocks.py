from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


DEFAULT_INPUT_CANDIDATES = [
    Path.cwd() / "HoC-GE2024-results-by-candidate.csv",
    Path.cwd().parent / "HoC-GE2024-results-by-candidate.csv",
    Path.home() / "Downloads" / "HoC-GE2024-results-by-candidate.csv",
]


@dataclass(frozen=True)
class BlockConfig:
    progressive: set[str]
    conservative: set[str]
    popular_right: set[str]


def normalize_party(value: object) -> str:
    text = "" if value is None else str(value)
    return " ".join(text.strip().lower().split())


def default_block_config() -> BlockConfig:
    return BlockConfig(
        progressive={
            "labour",
            "labour party",
            "co-operative party",
            "labour and co-operative party",
            "liberal democrat",
            "liberal democrats",
            "green",
            "green party",
            "green party of england and wales",
            "scottish national party",
            "snp",
            "plaid cymru",
            "alliance",
            "alliance alliance party of northern ireland",
            "social democratic and labour party",
            "sdlp",
            "sinn fein",
            "sinn féin",
            "workers party of britain",
            "workers party of britain gb",
            "social democratic party",
            "independent socialist",
            "independent workers party",
        },
        conservative={
            "conservative",
            "conservative and unionist party",
            "scottish conservative and unionist",
            "ulster unionist party",
            "uup",
            "democratic unionist party",
            "dup",
        },
        popular_right={
            "reform uk",
            "reform uk party",
            "uk independence party",
            "ukip",
            "heritage party",
            "britain first",
            "english democrats",
            "british democratic party",
            "freedom alliance",
            "for britain movement",
        },
    )


def infer_block(party_name: str, party_abbr: str, config: BlockConfig) -> str:
    candidates = [normalize_party(party_name), normalize_party(party_abbr)]

    for name in candidates:
        if name in config.progressive:
            return "progressive"
    for name in candidates:
        if name in config.conservative:
            return "conservative"
    for name in candidates:
        if name in config.popular_right:
            return "popular_right"

    return "other"


def resolve_input_path(explicit_input: Optional[str]) -> Path:
    if explicit_input:
        p = Path(explicit_input).expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(f"Input file not found: {p}")
        return p

    for candidate in DEFAULT_INPUT_CANDIDATES:
        if candidate.exists():
            return candidate.resolve()

    searched = "\n - " + "\n - ".join(str(p) for p in DEFAULT_INPUT_CANDIDATES)
    raise FileNotFoundError(
        "Could not find HoC GE2024 candidate CSV. Looked in:" + searched
    )


def validate_columns(fieldnames: Iterable[str], required: Iterable[str]) -> None:
    present = {str(name).lstrip("\ufeff").strip() for name in fieldnames}
    missing = [c for c in required if c not in present]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")


def safe_pct(numerator: int, denominator: int) -> float:
    if denominator == 0:
        return 0.0
    return float(numerator) / float(denominator)


def to_int(value: object) -> int:
    if value is None:
        return 0
    text = str(value).strip()
    if text == "":
        return 0
    try:
        return int(float(text))
    except Exception:
        return 0


def build_outputs(rows_raw: list[dict[str, str]], config: BlockConfig) -> tuple[list[dict], list[dict], dict]:
    required = [
        "ONS ID",
        "Constituency name",
        "Region name",
        "Country name",
        "Party name",
        "Party abbreviation",
        "Votes",
    ]
    validate_columns(rows_raw[0].keys() if rows_raw else [], required)

    by_constituency: dict[tuple[str, str, str, str], dict[str, int]] = {}
    for row in rows_raw:
        key = (
            str(row.get("ONS ID", "")).strip(),
            str(row.get("Constituency name", "")).strip(),
            str(row.get("Region name", "")).strip(),
            str(row.get("Country name", "")).strip(),
        )
        votes = to_int(row.get("Votes"))
        block = infer_block(row.get("Party name", ""), row.get("Party abbreviation", ""), config)

        if key not in by_constituency:
            by_constituency[key] = {
                "progressive": 0,
                "conservative": 0,
                "popular_right": 0,
                "other": 0,
            }
        by_constituency[key][block] += votes

    constituency: list[dict] = []
    for (ons_id, constituency_name, region, country), blocks in by_constituency.items():
        votes_progressive = int(blocks["progressive"])
        votes_conservative = int(blocks["conservative"])
        votes_popular_right = int(blocks["popular_right"])
        votes_other = int(blocks["other"])
        votes_total = votes_progressive + votes_conservative + votes_popular_right + votes_other

        constituency.append(
            {
                "ons_id": ons_id,
                "constituency": constituency_name,
                "region": region,
                "country": country,
                "votes_progressive": votes_progressive,
                "votes_conservative": votes_conservative,
                "votes_popular_right": votes_popular_right,
                "votes_other": votes_other,
                "votes_total": votes_total,
                "pct_progressive": safe_pct(votes_progressive, votes_total),
                "pct_conservative": safe_pct(votes_conservative, votes_total),
                "pct_popular_right": safe_pct(votes_popular_right, votes_total),
                "pct_other": safe_pct(votes_other, votes_total),
            }
        )

    constituency.sort(key=lambda x: (x["country"], x["region"], x["constituency"]))

    region_acc: dict[tuple[str, str], dict[str, int]] = {}
    for row in constituency:
        key = (row["region"], row["country"])
        if key not in region_acc:
            region_acc[key] = {
                "votes_progressive": 0,
                "votes_conservative": 0,
                "votes_popular_right": 0,
                "votes_other": 0,
                "votes_total": 0,
            }
        region_acc[key]["votes_progressive"] += int(row["votes_progressive"])
        region_acc[key]["votes_conservative"] += int(row["votes_conservative"])
        region_acc[key]["votes_popular_right"] += int(row["votes_popular_right"])
        region_acc[key]["votes_other"] += int(row["votes_other"])
        region_acc[key]["votes_total"] += int(row["votes_total"])

    region_rows: list[dict] = []
    for (region_name, country_name), agg in region_acc.items():
        vt = int(agg["votes_total"])
        vp = int(agg["votes_progressive"])
        vc = int(agg["votes_conservative"])
        vr = int(agg["votes_popular_right"])
        vo = int(agg["votes_other"])
        region_rows.append(
            {
                "region": region_name,
                "country": country_name,
                "votes_progressive": vp,
                "votes_conservative": vc,
                "votes_popular_right": vr,
                "votes_other": vo,
                "votes_total": vt,
                "pct_progressive": safe_pct(vp, vt),
                "pct_conservative": safe_pct(vc, vt),
                "pct_popular_right": safe_pct(vr, vt),
                "pct_other": safe_pct(vo, vt),
            }
        )
    region_rows.sort(key=lambda x: (x["country"], x["region"]))

    uk_votes_progressive = sum(int(r["votes_progressive"]) for r in constituency)
    uk_votes_conservative = sum(int(r["votes_conservative"]) for r in constituency)
    uk_votes_popular_right = sum(int(r["votes_popular_right"]) for r in constituency)
    uk_votes_other = sum(int(r["votes_other"]) for r in constituency)
    uk_votes_total = uk_votes_progressive + uk_votes_conservative + uk_votes_popular_right + uk_votes_other

    uk = {
        "scope": "UK",
        "votes_progressive": uk_votes_progressive,
        "votes_conservative": uk_votes_conservative,
        "votes_popular_right": uk_votes_popular_right,
        "votes_other": uk_votes_other,
        "votes_total": uk_votes_total,
        "pct_progressive": safe_pct(uk_votes_progressive, uk_votes_total),
        "pct_conservative": safe_pct(uk_votes_conservative, uk_votes_total),
        "pct_popular_right": safe_pct(uk_votes_popular_right, uk_votes_total),
        "pct_other": safe_pct(uk_votes_other, uk_votes_total),
    }

    return constituency, region_rows, uk


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_outputs(constituency: list[dict], region: list[dict], uk: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_const = out_dir / "ge2024_vote_blocks_by_constituency.csv"
    json_const = out_dir / "ge2024_vote_blocks_by_constituency.json"

    csv_region = out_dir / "ge2024_vote_blocks_by_region.csv"
    json_region = out_dir / "ge2024_vote_blocks_by_region.json"

    json_uk = out_dir / "ge2024_vote_blocks_uk_summary.json"

    constituency_fields = [
        "ons_id",
        "constituency",
        "region",
        "country",
        "votes_progressive",
        "votes_conservative",
        "votes_popular_right",
        "votes_other",
        "votes_total",
        "pct_progressive",
        "pct_conservative",
        "pct_popular_right",
        "pct_other",
    ]
    region_fields = [
        "region",
        "country",
        "votes_progressive",
        "votes_conservative",
        "votes_popular_right",
        "votes_other",
        "votes_total",
        "pct_progressive",
        "pct_conservative",
        "pct_popular_right",
        "pct_other",
    ]

    write_csv(csv_const, constituency, constituency_fields)
    with open(json_const, "w", encoding="utf-8") as f:
        json.dump(constituency, f, indent=2, ensure_ascii=False)

    write_csv(csv_region, region, region_fields)
    with open(json_region, "w", encoding="utf-8") as f:
        json.dump(region, f, indent=2, ensure_ascii=False)

    with open(json_uk, "w", encoding="utf-8") as f:
        json.dump([uk], f, indent=2, ensure_ascii=False)

    print(f"Wrote: {csv_const}")
    print(f"Wrote: {json_const}")
    print(f"Wrote: {csv_region}")
    print(f"Wrote: {json_region}")
    print(f"Wrote: {json_uk}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build GE2024 vote bloc percentages (progressive / conservative / popular right) "
            "from candidate-level results CSV."
        )
    )
    parser.add_argument(
        "--input",
        type=str,
        default=None,
        help="Path to HoC-GE2024-results-by-candidate.csv. If omitted, script searches common locations.",
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default=str(Path.cwd() / "public" / "data"),
        help="Output directory for build-ready CSV/JSON files.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = resolve_input_path(args.input)
    out_dir = Path(args.out_dir).expanduser().resolve()

    print(f"Input: {input_path}")
    print(f"Output dir: {out_dir}")

    with open(input_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows_raw = [
            {str(k).lstrip("\ufeff").strip(): v for k, v in row.items()}
            for row in reader
        ]

    if not rows_raw:
        raise RuntimeError("Input CSV contains no rows")

    constituency, region, uk = build_outputs(rows_raw, default_block_config())

    write_outputs(constituency, region, uk, out_dir)

    print("\nSummary")
    print(
        f"UK vote shares -> Progressive: {uk['pct_progressive']:.1%}, "
        f"Conservative: {uk['pct_conservative']:.1%}, "
        f"Popular Right: {uk['pct_popular_right']:.1%}, "
        f"Other: {uk['pct_other']:.1%}"
    )


if __name__ == "__main__":
    main()

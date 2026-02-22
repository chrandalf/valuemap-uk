from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def load_votes(path: Path) -> dict[str, dict[str, float | str]]:
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    votes: dict[str, dict[str, float | str]] = {}
    for row in rows:
        ons_id = str(row.get("ons_id", "")).strip()
        if not ons_id:
            continue
        votes[ons_id] = {
            "constituency": str(row.get("constituency", "")).strip(),
            "region": str(row.get("region", "")).strip(),
            "country": str(row.get("country", "")).strip(),
            "pct_progressive": float(row.get("pct_progressive", 0.0) or 0.0),
            "pct_conservative": float(row.get("pct_conservative", 0.0) or 0.0),
            "pct_popular_right": float(row.get("pct_popular_right", 0.0) or 0.0),
            "pct_other": float(row.get("pct_other", 0.0) or 0.0),
            "votes_total": int(float(row.get("votes_total", 0) or 0)),
        }
    return votes


def thin_ring(ring: list, step: int) -> list:
    if step <= 1 or len(ring) <= 8:
        return ring
    keep = [ring[0]]
    keep.extend(ring[i] for i in range(step, len(ring) - 1, step))
    keep.append(ring[-1])
    if keep[0] != keep[-1]:
        keep.append(keep[0])
    return keep


def thin_geometry(geom: dict, step: int) -> dict:
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])

    if gtype == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [thin_ring(ring, step) for ring in coords],
        }
    if gtype == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [[thin_ring(ring, step) for ring in poly] for poly in coords],
        }
    return geom


def main() -> None:
    parser = argparse.ArgumentParser(description="Build constituency overlay GeoJSON with vote block percentages")
    parser.add_argument(
        "--boundary",
        type=str,
        default="c:/Users/chris/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFE_2463071003872310654.geojson",
    )
    parser.add_argument(
        "--votes",
        type=str,
        default="public/data/ge2024_vote_blocks_by_constituency.csv",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="public/data/ge2024_vote_blocks_map.geojson",
    )
    parser.add_argument(
        "--thin-step",
        type=int,
        default=6,
        help="Keep every Nth coordinate in polygon rings to reduce file size",
    )
    args = parser.parse_args()

    boundary_path = Path(args.boundary).expanduser().resolve()
    votes_path = Path(args.votes).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()

    if not boundary_path.exists():
        raise FileNotFoundError(f"Boundary file not found: {boundary_path}")
    if not votes_path.exists():
        raise FileNotFoundError(f"Votes CSV not found: {votes_path}")

    votes = load_votes(votes_path)

    with open(boundary_path, "r", encoding="utf-8") as f:
        boundary = json.load(f)

    features = boundary.get("features", [])
    out_features = []
    matched = 0

    for feature in features:
        props = feature.get("properties") or {}
        pcon = str(props.get("PCON24CD", "")).strip()
        vote = votes.get(pcon)
        if not vote:
            continue

        matched += 1
        geom = thin_geometry(feature.get("geometry") or {}, max(1, int(args.thin_step)))
        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    "ons_id": pcon,
                    "constituency": vote["constituency"],
                    "region": vote["region"],
                    "country": vote["country"],
                    "pct_progressive": vote["pct_progressive"],
                    "pct_conservative": vote["pct_conservative"],
                    "pct_popular_right": vote["pct_popular_right"],
                    "pct_other": vote["pct_other"],
                    "votes_total": vote["votes_total"],
                },
                "geometry": geom,
            }
        )

    out_geo = {
        "type": "FeatureCollection",
        "features": out_features,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_geo, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote: {out_path}")
    print(f"Matched features: {matched} / {len(features)}")


if __name__ == "__main__":
    main()

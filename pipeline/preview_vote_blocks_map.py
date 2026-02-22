from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Iterable


def load_vote_blocks(vote_csv_path: Path) -> dict[str, dict[str, float]]:
    with open(vote_csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    out: dict[str, dict[str, float]] = {}
    for row in rows:
        ons_id = str(row.get("ons_id", "")).strip()
        if not ons_id:
            continue
        out[ons_id] = {
            "pct_progressive": float(row.get("pct_progressive", 0.0) or 0.0),
            "pct_conservative": float(row.get("pct_conservative", 0.0) or 0.0),
            "pct_popular_right": float(row.get("pct_popular_right", 0.0) or 0.0),
        }
    return out


def iter_all_coords(geometry: dict) -> Iterable[tuple[float, float]]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])

    if gtype == "Polygon":
        for ring in coords:
            for lon, lat in ring:
                yield float(lon), float(lat)
    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                for lon, lat in ring:
                    yield float(lon), float(lat)


def project(lon: float, lat: float, min_lon: float, min_lat: float, scale: float, pad: float, max_lat: float) -> tuple[float, float]:
    x = pad + (lon - min_lon) * scale
    y = pad + (max_lat - lat) * scale
    return x, y


def lerp(a: int, b: int, t: float) -> int:
    return int(round(a + (b - a) * t))


def color_for_value(value: float, hi_rgb: tuple[int, int, int]) -> str:
    t = max(0.0, min(1.0, value))
    lo = (248, 250, 252)
    r = lerp(lo[0], hi_rgb[0], t)
    g = lerp(lo[1], hi_rgb[1], t)
    b = lerp(lo[2], hi_rgb[2], t)
    return f"rgb({r},{g},{b})"


def geometry_to_svg_paths(
    geometry: dict,
    min_lon: float,
    min_lat: float,
    max_lat: float,
    scale: float,
    pad: float,
    offset_x: float,
    metric_value: float,
    hi_rgb: tuple[int, int, int],
) -> list[str]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    paths: list[str] = []

    def ring_to_path(ring: list[list[float]]) -> str:
        pts = []
        for lon, lat in ring:
            x, y = project(float(lon), float(lat), min_lon, min_lat, scale, pad, max_lat)
            pts.append(f"{x + offset_x:.2f},{y:.2f}")
        return "M " + " L ".join(pts) + " Z"

    fill = color_for_value(metric_value, hi_rgb)

    if gtype == "Polygon":
        for ring in coords:
            if not ring:
                continue
            d = ring_to_path(ring)
            paths.append(f'<path d="{d}" fill="{fill}" stroke="rgba(20,20,20,0.22)" stroke-width="0.25"/>')

    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                if not ring:
                    continue
                d = ring_to_path(ring)
                paths.append(f'<path d="{d}" fill="{fill}" stroke="rgba(20,20,20,0.22)" stroke-width="0.25"/>')

    return paths


def build_svg(boundary_geojson_path: Path, votes_by_constituency_path: Path, out_svg_path: Path) -> None:
    votes = load_vote_blocks(votes_by_constituency_path)

    with open(boundary_geojson_path, "r", encoding="utf-8") as f:
        geo = json.load(f)

    features = geo.get("features", [])
    if not features:
        raise RuntimeError("Boundary file has no features")

    min_lon = float("inf")
    min_lat = float("inf")
    max_lon = float("-inf")
    max_lat = float("-inf")

    for feature in features:
        geometry = feature.get("geometry") or {}
        for lon, lat in iter_all_coords(geometry):
            min_lon = min(min_lon, lon)
            min_lat = min(min_lat, lat)
            max_lon = max(max_lon, lon)
            max_lat = max(max_lat, lat)

    if not all(v != float("inf") and v != float("-inf") for v in [min_lon, min_lat, max_lon, max_lat]):
        raise RuntimeError("Failed to compute boundary extent")

    panel_w = 500
    panel_h = 760
    pad = 18
    map_w = panel_w - 2 * pad
    map_h = panel_h - 2 * pad

    sx = map_w / (max_lon - min_lon)
    sy = map_h / (max_lat - min_lat)
    scale = min(sx, sy)

    metrics = [
        ("pct_progressive", "Progressive share", (34, 197, 94)),
        ("pct_conservative", "Conservative share", (37, 99, 235)),
        ("pct_popular_right", "Popular Right share", (217, 119, 6)),
    ]

    gap = 22
    title_h = 60
    footer_h = 70
    width = panel_w * 3 + gap * 2
    height = panel_h + title_h + footer_h

    parts: list[str] = []
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">')
    parts.append('<rect width="100%" height="100%" fill="#0b1220"/>')
    parts.append('<text x="24" y="34" fill="#f8fafc" font-size="22" font-family="Segoe UI, Arial" font-weight="700">GE 2024 vote blocs — constituency preview</text>')
    parts.append('<text x="24" y="54" fill="#cbd5e1" font-size="13" font-family="Segoe UI, Arial">Joined by PCON24CD (boundary) ↔ ons_id (vote output)</text>')

    matched = 0
    missing = 0

    for idx, (metric_key, label, hi_rgb) in enumerate(metrics):
        panel_x = idx * (panel_w + gap)
        parts.append(
            f'<rect x="{panel_x + 6}" y="{title_h}" width="{panel_w - 12}" height="{panel_h}" rx="10" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)"/>'
        )
        parts.append(
            f'<text x="{panel_x + 22}" y="{title_h + 28}" fill="#e2e8f0" font-size="16" font-family="Segoe UI, Arial" font-weight="700">{label}</text>'
        )

        offset_x = panel_x
        for feature in features:
            props = feature.get("properties") or {}
            pcon = str(props.get("PCON24CD", "")).strip()
            vote_row = votes.get(pcon)
            if vote_row is None:
                value = 0.0
                if idx == 0:
                    missing += 1
            else:
                value = float(vote_row.get(metric_key, 0.0))
                if idx == 0:
                    matched += 1

            geom = feature.get("geometry") or {}
            paths = geometry_to_svg_paths(
                geom,
                min_lon=min_lon,
                min_lat=min_lat,
                max_lat=max_lat,
                scale=scale,
                pad=pad,
                offset_x=offset_x,
                metric_value=value,
                hi_rgb=hi_rgb,
            )
            for path in paths:
                parts.append(path)

        # legend strip
        legend_x = panel_x + 26
        legend_y = title_h + panel_h - 34
        legend_w = panel_w - 52
        steps = 20
        for s in range(steps):
            t0 = s / (steps - 1)
            c = color_for_value(t0, hi_rgb)
            x = legend_x + (legend_w * s / steps)
            w = legend_w / steps + 0.8
            parts.append(f'<rect x="{x:.2f}" y="{legend_y}" width="{w:.2f}" height="10" fill="{c}" stroke="none"/>')
        parts.append(f'<text x="{legend_x}" y="{legend_y + 24}" fill="#cbd5e1" font-size="11" font-family="Segoe UI, Arial">0%</text>')
        parts.append(f'<text x="{legend_x + legend_w - 22}" y="{legend_y + 24}" fill="#cbd5e1" font-size="11" font-family="Segoe UI, Arial">100%</text>')

    parts.append(
        f'<text x="24" y="{height - 28}" fill="#94a3b8" font-size="12" font-family="Segoe UI, Arial">Constituencies in boundary file: {len(features)} · matched vote rows: {matched} · unmatched: {missing}</text>'
    )
    parts.append("</svg>")

    out_svg_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_svg_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))

    print(f"Wrote preview SVG: {out_svg_path}")
    print(f"Boundaries: {len(features)} | matched votes: {matched} | unmatched: {missing}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate preview SVG map for GE2024 vote blocs")
    parser.add_argument(
        "--boundary",
        type=str,
        default="c:/Users/chris/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFE_2463071003872310654.geojson",
        help="Path to Westminster 2024 boundary GeoJSON",
    )
    parser.add_argument(
        "--votes",
        type=str,
        default="public/data/ge2024_vote_blocks_by_constituency.csv",
        help="Path to constituency vote-block CSV",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="public/data/ge2024_vote_blocks_preview.svg",
        help="Output SVG path",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    boundary = Path(args.boundary).expanduser().resolve()
    votes = Path(args.votes).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()

    if not boundary.exists():
        raise FileNotFoundError(f"Boundary file not found: {boundary}")
    if not votes.exists():
        raise FileNotFoundError(f"Votes file not found: {votes}")

    build_svg(boundary, votes, out)


if __name__ == "__main__":
    main()

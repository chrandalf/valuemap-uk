from __future__ import annotations

import argparse
import sys
import json
import csv
import io
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


BASE_URL = "https://environment.data.gov.uk/flood-monitoring"

FLOODS_CSV_COLUMNS = [
    "@id",
    "description",
    "eaAreaName",
    "eaRegionName",
    "floodArea.@id",
    "floodArea.county",
    "floodArea.notation",
    "floodArea.polygon",
    "floodArea.riverOrSea",
    "floodAreaID",
    "isTidal",
    "message",
    "severity",
    "severityLevel",
    "timeMessageChanged",
    "timeRaised",
    "timeSeverityChanged",
]

FLOODS_MIN_COLUMNS = [
    "floodAreaID",
    "description",
    "severity",
    "severityLevel",
    "timeRaised",
    "timeMessageChanged",
    "timeSeverityChanged",
    "latitude",
    "longitude",
    "floodArea.polygon",
]


class FloodMonitoringApiClient:
    def __init__(self, base_url: str = BASE_URL, timeout_seconds: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = urlencode({k: v for k, v in (params or {}).items() if v is not None}, doseq=True)
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{query}"

        req = Request(url, headers={"Accept": "application/json"})
        try:
            with urlopen(req, timeout=self.timeout_seconds) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload)
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} for {url}\n{body}") from exc
        except URLError as exc:
            raise RuntimeError(f"Connection error for {url}: {exc}") from exc

    def _get_text(self, absolute_url: str) -> str:
        req = Request(absolute_url, headers={"Accept": "text/csv"})
        try:
            with urlopen(req, timeout=self.timeout_seconds) as response:
                return response.read().decode("utf-8")
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} for {absolute_url}\n{body}") from exc
        except URLError as exc:
            raise RuntimeError(f"Connection error for {absolute_url}: {exc}") from exc

    def list_floods(self, **params: Any) -> dict[str, Any]:
        return self._get("/id/floods", params)

    def list_stations(self, **params: Any) -> dict[str, Any]:
        return self._get("/id/stations", params)

    def list_flood_areas(self, **params: Any) -> dict[str, Any]:
        return self._get("/id/floodAreas", params)

    def get_station(self, station_id: str) -> dict[str, Any]:
        return self._get(f"/id/stations/{quote(station_id, safe='')}")

    def get_flood_area(self, area_id: str) -> dict[str, Any]:
        return self._get(f"/id/floodAreas/{quote(area_id, safe='')}")

    def get_measure(self, measure_id: str) -> dict[str, Any]:
        return self._get(f"/id/measures/{quote(measure_id, safe='')}")

    def get_measure_readings(self, measure_id: str, **params: Any) -> dict[str, Any]:
        return self._get(f"/id/measures/{quote(measure_id, safe='')}/readings", params)

    def get_archive_readings_csv(self, target_date: date, full: bool = False) -> str:
        stamp = target_date.strftime("%Y-%m-%d")
        prefix = "readings-full" if full else "readings"
        url = f"{self.base_url}/archive/{prefix}-{stamp}.csv"
        return self._get_text(url)


def parse_key_value_pairs(values: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"Invalid --param '{value}'. Expected format key=value")
        key, raw = value.split("=", 1)
        key = key.strip()
        if not key:
            raise ValueError(f"Invalid --param '{value}'. Key cannot be empty")
        parsed[key] = raw.strip()
    return parsed


def write_json(path: Path, payload: dict[str, Any], pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        text = json.dumps(payload, indent=2, ensure_ascii=False)
    else:
        text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")


def normalize_csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    text = " ".join(text.split())
    return text


def flatten_record(record: dict[str, Any], prefix: str = "") -> dict[str, str]:
    flat: dict[str, str] = {}
    for key, value in record.items():
        name = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            flat.update(flatten_record(value, name))
        elif isinstance(value, list):
            flat[name] = normalize_csv_value(json.dumps(value, ensure_ascii=False))
        else:
            flat[name] = normalize_csv_value(value)
    return flat


def records_from_payload(payload: dict[str, Any]) -> list[dict[str, str]]:
    items = payload.get("items")
    if isinstance(items, list):
        return [flatten_record(item) for item in items if isinstance(item, dict)]
    if isinstance(items, dict):
        return [flatten_record(items)]
    if isinstance(payload, dict):
        return [flatten_record(payload)]
    return []


def records_to_csv_text(records: list[dict[str, str]]) -> str:
    if not records:
        return ""

    columns: list[str] = []
    seen: set[str] = set()
    for row in records:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                columns.append(key)

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in records:
        writer.writerow({k: row.get(k, "") for k in columns})
    return buffer.getvalue()


def records_to_csv_text_with_columns(records: list[dict[str, str]], columns: list[str]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in records:
        writer.writerow({k: row.get(k, "") for k in columns})
    return buffer.getvalue()


def normalize_floods_records(records: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for row in records:
        normalized.append({key: row.get(key, "") for key in FLOODS_CSV_COLUMNS})
    return normalized


def pick_first_value(record: dict[str, str], keys: list[str]) -> str:
    for key in keys:
        value = record.get(key, "")
        if value != "":
            return value
    return ""


def enrich_flood_records_with_coords(
    client: FloodMonitoringApiClient,
    records: list[dict[str, str]],
) -> list[dict[str, str]]:
    cache: dict[str, dict[str, str]] = {}
    enriched: list[dict[str, str]] = []

    for row in records:
        area_id = row.get("floodAreaID", "")
        lat = pick_first_value(row, ["latitude", "lat", "floodArea.latitude", "floodArea.lat"])
        lon = pick_first_value(row, ["longitude", "long", "lon", "floodArea.longitude", "floodArea.long", "floodArea.lon"])

        if (lat == "" or lon == "") and area_id:
            if area_id not in cache:
                try:
                    area_payload = client.get_flood_area(area_id)
                    area_items = area_payload.get("items")
                    if isinstance(area_items, dict):
                        flat = flatten_record(area_items)
                    elif isinstance(area_items, list) and area_items and isinstance(area_items[0], dict):
                        flat = flatten_record(area_items[0])
                    else:
                        flat = {}
                    cache[area_id] = flat
                except Exception:
                    cache[area_id] = {}

            area_flat = cache.get(area_id, {})
            if lat == "":
                lat = pick_first_value(area_flat, ["lat", "latitude"])
            if lon == "":
                lon = pick_first_value(area_flat, ["long", "lon", "longitude"])

        next_row = dict(row)
        next_row["latitude"] = lat
        next_row["longitude"] = lon
        enriched.append(next_row)

    return enriched


def normalize_floods_min_records(records: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for row in records:
        normalized.append({
            "floodAreaID": row.get("floodAreaID", ""),
            "description": row.get("description", ""),
            "severity": row.get("severity", ""),
            "severityLevel": row.get("severityLevel", ""),
            "timeRaised": row.get("timeRaised", ""),
            "timeMessageChanged": row.get("timeMessageChanged", ""),
            "timeSeverityChanged": row.get("timeSeverityChanged", ""),
            "latitude": row.get("latitude", ""),
            "longitude": row.get("longitude", ""),
            "floodArea.polygon": row.get("floodArea.polygon", ""),
        })
    return normalized


def write_csv(path: Path, records: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(records_to_csv_text(records), encoding="utf-8", newline="")


def write_csv_with_columns(path: Path, records: list[dict[str, str]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(records_to_csv_text_with_columns(records, columns), encoding="utf-8", newline="")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Query the UK Environment Agency flood-monitoring API (environment.data.gov.uk)."
    )
    parser.add_argument(
        "--endpoint",
        required=False,
        choices=["floods", "stations", "areas", "station", "area", "measure", "readings", "archive-readings"],
        help="Which API endpoint to call.",
    )
    parser.add_argument("--station-id", help="Station ID for --endpoint station")
    parser.add_argument("--area-id", help="Flood area ID for --endpoint area")
    parser.add_argument("--measure-id", help="Measure ID for --endpoint measure/readings")
    parser.add_argument("--date", dest="single_date", help="Date in YYYY-MM-DD format (for archive-readings)")
    parser.add_argument("--start-date", help="Start date in YYYY-MM-DD (for archive-readings)")
    parser.add_argument("--end-date", help="End date in YYYY-MM-DD (for archive-readings)")
    parser.add_argument("--archive-full", action="store_true", help="Use readings-full archive files (for archive-readings)")
    parser.add_argument(
        "--param",
        action="append",
        default=[],
        help="Additional query params in key=value form. Repeat for multiple params.",
    )
    parser.add_argument("--timeout", type=int, default=30, help="Request timeout in seconds")
    parser.add_argument("--output", type=Path, default=None, help="Optional path to write output file")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument(
        "--format",
        choices=["csv", "json"],
        default="csv",
        help="Output format (default: csv)",
    )
    parser.add_argument(
        "--flood-fields",
        choices=["minimal", "full"],
        default="minimal",
        help="For floods CSV output, choose field profile (default: minimal).",
    )
    return parser


def parse_iso_date(value: str, name: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"Invalid {name}: '{value}'. Expected YYYY-MM-DD") from exc


def iter_dates(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def merge_archive_csv_texts(chunks: list[str]) -> str:
    merged_lines: list[str] = []
    header: str | None = None
    for chunk in chunks:
        lines = chunk.splitlines()
        if not lines:
            continue
        current_header = lines[0]
        if header is None:
            header = current_header
            merged_lines.append(header)
        elif current_header != header:
            raise RuntimeError("Archive CSV headers differ across dates; cannot merge safely")
        merged_lines.extend(lines[1:])
    return "\n".join(merged_lines) + ("\n" if merged_lines else "")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args, _unknown = parser.parse_known_args(argv)

    if not args.endpoint:
        print("No --endpoint provided; defaulting to floods query (all available current items).")
        args.endpoint = "floods"

    params = parse_key_value_pairs(args.param)
    client = FloodMonitoringApiClient(timeout_seconds=max(1, args.timeout))

    if args.endpoint == "floods":
        payload = client.list_floods(**params)
    elif args.endpoint == "stations":
        payload = client.list_stations(**params)
    elif args.endpoint == "areas":
        payload = client.list_flood_areas(**params)
    elif args.endpoint == "station":
        if not args.station_id:
            raise ValueError("--station-id is required for --endpoint station")
        payload = client.get_station(args.station_id)
    elif args.endpoint == "area":
        if not args.area_id:
            raise ValueError("--area-id is required for --endpoint area")
        payload = client.get_flood_area(args.area_id)
    elif args.endpoint == "measure":
        if not args.measure_id:
            raise ValueError("--measure-id is required for --endpoint measure")
        payload = client.get_measure(args.measure_id)
    else:
        if args.endpoint == "readings":
            if not args.measure_id:
                raise ValueError("--measure-id is required for --endpoint readings")
            payload = client.get_measure_readings(args.measure_id, **params)
        else:
            if args.single_date:
                start = parse_iso_date(args.single_date, "--date")
                end = start
            else:
                if not args.start_date or not args.end_date:
                    raise ValueError("For --endpoint archive-readings, provide --date OR both --start-date and --end-date")
                start = parse_iso_date(args.start_date, "--start-date")
                end = parse_iso_date(args.end_date, "--end-date")
            if end < start:
                raise ValueError("--end-date cannot be earlier than --start-date")

            chunks: list[str] = []
            fetched = 0
            skipped = 0
            for day in iter_dates(start, end):
                try:
                    chunks.append(client.get_archive_readings_csv(day, full=args.archive_full))
                    fetched += 1
                except RuntimeError as exc:
                    if "HTTP 404" in str(exc):
                        skipped += 1
                        continue
                    raise
            merged_csv = merge_archive_csv_texts(chunks)
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(merged_csv, encoding="utf-8", newline="")
                print(f"Wrote response to: {args.output}")
                print(f"Archive dates fetched: {fetched}, missing/skipped: {skipped}")
            else:
                print(merged_csv, end="")
                print(f"# Archive dates fetched: {fetched}, missing/skipped: {skipped}")
            return 0

    if args.output:
        if args.format == "csv":
            records = records_from_payload(payload)
            if args.endpoint == "floods":
                records = enrich_flood_records_with_coords(client, records)
                if args.flood_fields == "minimal":
                    write_csv_with_columns(args.output, normalize_floods_min_records(records), FLOODS_MIN_COLUMNS)
                else:
                    write_csv_with_columns(args.output, normalize_floods_records(records), FLOODS_CSV_COLUMNS)
            else:
                write_csv(args.output, records)
        else:
            write_json(args.output, payload, pretty=args.pretty)
        print(f"Wrote response to: {args.output}")
    else:
        if args.format == "csv":
            records = records_from_payload(payload)
            if args.endpoint == "floods":
                records = enrich_flood_records_with_coords(client, records)
                if args.flood_fields == "minimal":
                    print(records_to_csv_text_with_columns(normalize_floods_min_records(records), FLOODS_MIN_COLUMNS), end="")
                else:
                    print(records_to_csv_text_with_columns(normalize_floods_records(records), FLOODS_CSV_COLUMNS), end="")
            else:
                print(records_to_csv_text(records), end="")
        else:
            if args.pretty:
                print(json.dumps(payload, indent=2, ensure_ascii=False))
            else:
                print(json.dumps(payload, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    exit_code = main(sys.argv[1:])
    if "ipykernel" not in sys.modules:
        raise SystemExit(exit_code)

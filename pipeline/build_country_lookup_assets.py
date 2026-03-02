"""
Build two slim country-lookup assets:

1. country_cells_1km.json.gz
   Nested dict {str(gx_km): {str(gy_km): country_char}}
   Derived from vote_cells_1km.json.gz which already has country on every row.
   ~44 KB compressed — safe to load in a Worker cold-start alongside any partition.

2. country_by_outward.json.gz
   Dict {outward_code: country_char}  e.g. {"SW1A": "E", "EH1": "S", "CF10": "W"}
   Derived from ONSPD via easting/northing → 1km grid lookup first, then
   country_cells_1km as the source of truth.
   ~50 KB compressed — useful for any future postcode-based verification.

Writes outputs to:
  pipeline/data/publish/property/country_cells_1km.json.gz
  pipeline/data/publish/property/country_by_outward.json.gz
"""

import csv
import gzip
import io
import json
import pathlib
import collections
import sys

from paths import RAW_DIR, PUBLISH_DIR

# ── Paths ─────────────────────────────────────────────────────────────────────
VOTE_1KM = PUBLISH_DIR / "vote" / "vote_cells_1km.json.gz"
ONSPD_CSV = RAW_DIR / "property" / "ONSPD_Online_latest_Postcode_Centroids_.csv"
OUT_DIR = PUBLISH_DIR / "property"
OUT_DIR.mkdir(parents=True, exist_ok=True)

OUT_CELLS = OUT_DIR / "country_cells_1km.json.gz"
OUT_OUTWARD = OUT_DIR / "country_by_outward.json.gz"

# ── Country code normalisation ─────────────────────────────────────────────────
# CTRY25CD values in ONSPD → single-char country used throughout the codebase
CTRY_MAP = {
    "E92000001": "E",  # England
    "S92000003": "S",  # Scotland
    "W92000004": "W",  # Wales
    "N92000002": "N",  # Northern Ireland
}


def gzip_json(obj) -> bytes:
    """Serialise obj as JSON then gzip compress at level 9."""
    raw = json.dumps(obj, separators=(",", ":")).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9) as gz:
        gz.write(raw)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Build country_cells_1km from vote_cells_1km
# ══════════════════════════════════════════════════════════════════════════════
print("Loading vote_cells_1km.json.gz …")
with gzip.open(VOTE_1KM) as f:
    vote_rows = json.load(f)

print(f"  {len(vote_rows):,} rows loaded")

# Validate country coverage
missing = [r for r in vote_rows if not r.get("country")]
if missing:
    print(f"  WARNING: {len(missing)} rows missing country — will be omitted")

country_dist = collections.Counter(r["country"] for r in vote_rows if r.get("country"))
print("  Country distribution:", dict(country_dist))

# Build nested dict: gx_km → gy_km → country_char
# Using str keys so JSON serialisation produces a plain object (fast Map lookup in JS)
nested: dict[str, dict[str, str]] = {}
for r in vote_rows:
    c = r.get("country")
    if not c:
        continue
    gx_k = str(r["gx"] // 1000)
    gy_k = str(r["gy"] // 1000)
    if gx_k not in nested:
        nested[gx_k] = {}
    nested[gx_k][gy_k] = c

print(f"  Nested dict: {len(nested)} gx buckets, {sum(len(v) for v in nested.values()):,} cells")

data = gzip_json(nested)
OUT_CELLS.write_bytes(data)
print(f"  Written {OUT_CELLS}  ({len(data)/1024:.1f} KB compressed)")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Build outward-code → country from ONSPD
# ══════════════════════════════════════════════════════════════════════════════
print()
print("Building outward-code → country from ONSPD …")

if not ONSPD_CSV.exists():
    print(f"  ONSPD not found at {ONSPD_CSV} — skipping outward table")
    sys.exit(0)

print(f"  Source: {ONSPD_CSV}  ({ONSPD_CSV.stat().st_size / 1024 / 1024:.0f} MB)")

# For each outward code we want the single definitive country.
# Occasionally an outward spans a border (rare edge case); we pick majority.
outward_votes: dict[str, collections.Counter] = {}

total = 0
skipped_ctry = 0
skipped_term = 0

with open(ONSPD_CSV, encoding="utf-8-sig") as fh:
    reader = csv.DictReader(fh)
    for row in reader:
        total += 1
        if total % 1_000_000 == 0:
            print(f"  … {total:,} rows")

        # Skip terminated postcodes (DOTERM != '')
        if row.get("DOTERM", "").strip():
            skipped_term += 1
            continue

        ctry25 = row.get("CTRY25CD", "").strip()
        country = CTRY_MAP.get(ctry25)
        if not country:
            skipped_ctry += 1
            continue

        pcds = row.get("PCDS", "").strip()
        if not pcds:
            continue

        # Outward code = everything before the space, e.g. "SW1A 1AA" → "SW1A"
        outward = pcds.split(" ")[0].upper()
        if outward not in outward_votes:
            outward_votes[outward] = collections.Counter()
        outward_votes[outward][country] += 1

print(f"  Total rows read: {total:,}")
print(f"  Skipped (terminated): {skipped_term:,}  (no CTRY code): {skipped_ctry:,}")
print(f"  Unique outward codes: {len(outward_votes):,}")

# Pick the majority country per outward code
ambiguous = []
outward_country: dict[str, str] = {}
for outward, counter in sorted(outward_votes.items()):
    winner, winner_n = counter.most_common(1)[0]
    total_n = sum(counter.values())
    outward_country[outward] = winner
    if len(counter) > 1:
        ambiguous.append((outward, dict(counter)))

print(f"  Ambiguous outward codes (span >1 country): {len(ambiguous)}")
for ow, dist in ambiguous[:20]:
    print(f"    {ow}: {dist}")

# Country summary
country_totals = collections.Counter(outward_country.values())
print("  Country totals:", dict(country_totals))

data2 = gzip_json(outward_country)
OUT_OUTWARD.write_bytes(data2)
print(f"  Written {OUT_OUTWARD}  ({len(data2)/1024:.1f} KB compressed)")

# Show a few examples
sample_e = [(k, v) for k, v in outward_country.items() if v == "E"][:5]
sample_s = [(k, v) for k, v in outward_country.items() if v == "S"][:5]
sample_w = [(k, v) for k, v in outward_country.items() if v == "W"][:5]
sample_n = [(k, v) for k, v in outward_country.items() if v == "N"][:5]
print()
print("Sample E:", sample_e)
print("Sample S:", sample_s)
print("Sample W:", sample_w)
print("Sample N:", sample_n)

print()
print("Done.")

"""
build_epc_enriched.py

Reads all 347 domestic EPC LA certificate files from the MHCLG bulk download ZIP
and produces a single enriched, gzip-compressed CSV containing the fields needed
for the ValueMap pipeline (existing fields + fuel type, EPC rating, property
characteristics, retrofit signals and renewables).

No deduplication is done here — all historical records are kept so that the
downstream model step can take the latest inspection per property.

Usage (from repo root, with .venv-7 active):
    python pipeline/build_epc_enriched.py

    # Override defaults:
    python pipeline/build_epc_enriched.py \
        --input  pipeline/data/raw/epc/all-domestic-certificates.zip \
        --output pipeline/data/raw/epc/epc_enriched_all.csv.gz

Output:
    pipeline/data/raw/epc/epc_enriched_all.csv.gz   (~500 MB, ~17 M rows, 31 cols)

Columns saved
─────────────────────────────────────────────────────────────────────────────
Currently used by pipeline:
  POSTCODE            Full postcode  (used to derive postcode_key)
  ADDRESS1            First address line (used to extract PAON)
  TOTAL_FLOOR_AREA    m²
  NUMBER_HABITABLE_ROOMS
  FLOOR_HEIGHT        Mean storey height (m)
  BUILT_FORM          Detached / Semi-Detached / Mid-Terrace etc.
  INSPECTION_DATE     Date of energy assessment (YYYY-MM-DD)

Fuel / heating (NEW):
  MAINS_GAS_FLAG      Y / N  ← single-field gas presence signal
  MAIN_FUEL           Normalised fuel category (see FUEL_MAP below)
  MAIN_FUEL_RAW       Original MAIN_FUEL value before normalisation
  MAINHEAT_DESCRIPTION  Free-text heating system description
  SECONDHEAT_DESCRIPTION  Secondary heating description

EPC rating & efficiency (NEW):
  CURRENT_ENERGY_RATING     A–G band
  CURRENT_ENERGY_EFFICIENCY SAP score (1–100)
  POTENTIAL_ENERGY_RATING   A–G band if recommendations followed
  POTENTIAL_ENERGY_EFFICIENCY  SAP score potential

Carbon & running costs (NEW):
  CO2_EMISSIONS_CURRENT       tonnes/year
  CO2_EMISS_CURR_PER_FLOOR_AREA  kg/m²/year
  HEATING_COST_CURRENT        £/year estimated

Property characteristics (NEW):
  PROPERTY_TYPE         House / Flat / Bungalow / Maisonette
  CONSTRUCTION_AGE_BAND Decade band e.g. "England and Wales: 1967-1975"
  TENURE                Owner-occupied / rental (private) / rental (social)
  TRANSACTION_TYPE      marketed sale / rental / new dwelling etc.
  NUMBER_HEATED_ROOMS

Insulation & fabric (NEW):
  WALLS_DESCRIPTION     Cavity / Solid / Timber etc.
  ROOF_DESCRIPTION      Pitched / Flat + insulation level
  MULTI_GLAZE_PROPORTION  % of windows double/triple glazed
  LOW_ENERGY_LIGHTING     % low-energy light fittings

Renewables (NEW):
  SOLAR_WATER_HEATING_FLAG  Y / N
  PHOTO_SUPPLY              % of energy from solar PV
  WIND_TURBINE_COUNT

Deduplication key (NEW):
  UPRN                Unique Property Reference Number (blank for older records)
─────────────────────────────────────────────────────────────────────────────

COLUMNS REVIEWED BUT EXCLUDED (and why)
─────────────────────────────────────────────────────────────────────────────
LMK_KEY                       Internal certificate key — UPRN preferred
ADDRESS2 / ADDRESS3           Not needed for PAON matching
BUILDING_REFERENCE_NUMBER     Internal
LOCAL_AUTHORITY / _LABEL      Derivable from postcode
CONSTITUENCY / _LABEL         Derivable from postcode
COUNTY                        Derivable from postcode
POSTTOWN                      Derivable from postcode
LODGEMENT_DATE / _DATETIME    Using INSPECTION_DATE instead
ENVIRONMENT_IMPACT_CURRENT/POTENTIAL  Less meaningful for lay users
ENERGY_CONSUMPTION_CURRENT/POTENTIAL  SAP score + CO2 already capture this
LIGHTING_COST_CURRENT/POTENTIAL       Minor cost component
HOT_WATER_COST_CURRENT/POTENTIAL      Minor cost component
ENERGY_TARIFF                 Mostly blank / legacy field
FLOOR_LEVEL                   Niche flat detail
FLAT_TOP_STOREY / _STOREY_COUNT  Too niche
MAIN_HEATING_CONTROLS         Limited overlay value
GLAZED_TYPE / GLAZED_AREA     Covered by MULTI_GLAZE_PROPORTION
EXTENSION_COUNT               Niche
NUMBER_OPEN_FIREPLACES        Niche
HOTWATER_DESCRIPTION + EFF    Minor
FLOOR_DESCRIPTION + EFF       Too granular
WINDOWS_DESCRIPTION + EFF     MULTI_GLAZE_PROPORTION covers intent
WALLS_ENERGY_EFF + ENV_EFF    Description is more informative
SECONDHEAT_EFF + ENV          Not needed
ROOF_ENERGY_EFF + ENV         Description is more informative
MAINHEAT_ENERGY_EFF + ENV     MAIN_FUEL + description covers intent
MAINHEATCONT_DESCRIPTION+EFF  Too granular — heating controls
LIGHTING_DESCRIPTION + EFF    LOW_ENERGY_LIGHTING covers intent
HEAT_LOSS_CORRIDOR / UNHEATED_CORRIDOR_LENGTH  Flat-specific, niche
MECHANICAL_VENTILATION        Niche
ADDRESS (col 81)              Duplicate of ADDRESS1
FIXED_LIGHTING_OUTLETS_COUNT  Too granular
LOW_ENERGY_FIXED_LIGHT_COUNT  Use LOW_ENERGY_LIGHTING % instead
UPRN_SOURCE                   Not needed
REPORT_TYPE                   Not needed

RECOMMENDATIONS.CSV (not processed here)
  Each certificate can have 0–n improvement recommendations with
  IMPROVEMENT_SUMMARY_TEXT, IMPROVEMENT_DESCR_TEXT, INDICATIVE_COST.
  Could power a future "retrofit potential" overlay but requires a
  separate aggregation pass (join on LMK_KEY). Left for a later stage.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import argparse
import gzip
import sys
import zipfile
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PIPELINE_DIR = Path(__file__).parent
RAW_EPC_DIR = PIPELINE_DIR / "data" / "raw" / "epc"

DEFAULT_INPUT = RAW_EPC_DIR / "all-domestic-certificates.zip"
DEFAULT_OUTPUT = RAW_EPC_DIR / "epc_enriched_all.csv.gz"

# ---------------------------------------------------------------------------
# Column selection
# ---------------------------------------------------------------------------
# Columns to read from each LA certificates.csv (in order we want in output)
KEEP_COLS: list[str] = [
    # ── Currently used by pipeline ──────────────────────────────────────────
    "POSTCODE",
    "ADDRESS1",
    "TOTAL_FLOOR_AREA",
    "NUMBER_HABITABLE_ROOMS",
    "FLOOR_HEIGHT",
    "BUILT_FORM",
    "INSPECTION_DATE",
    # ── Fuel / heating ───────────────────────────────────────────────────────
    "MAINS_GAS_FLAG",
    "MAIN_FUEL",           # we add MAIN_FUEL_RAW + normalised MAIN_FUEL below
    "MAINHEAT_DESCRIPTION",
    "SECONDHEAT_DESCRIPTION",
    # ── EPC rating & efficiency ───────────────────────────────────────────────
    "CURRENT_ENERGY_RATING",
    "CURRENT_ENERGY_EFFICIENCY",
    "POTENTIAL_ENERGY_RATING",
    "POTENTIAL_ENERGY_EFFICIENCY",
    # ── Carbon & running costs ────────────────────────────────────────────────
    "CO2_EMISSIONS_CURRENT",
    "CO2_EMISS_CURR_PER_FLOOR_AREA",
    "HEATING_COST_CURRENT",
    # ── Property characteristics ──────────────────────────────────────────────
    "PROPERTY_TYPE",
    "CONSTRUCTION_AGE_BAND",
    "TENURE",
    "TRANSACTION_TYPE",
    "NUMBER_HEATED_ROOMS",
    # ── Insulation & fabric ───────────────────────────────────────────────────
    "WALLS_DESCRIPTION",
    "ROOF_DESCRIPTION",
    "MULTI_GLAZE_PROPORTION",
    "LOW_ENERGY_LIGHTING",
    # ── Renewables ────────────────────────────────────────────────────────────
    "SOLAR_WATER_HEATING_FLAG",
    "PHOTO_SUPPLY",
    "WIND_TURBINE_COUNT",
    # ── Deduplication key ─────────────────────────────────────────────────────
    "UPRN",
]

# ---------------------------------------------------------------------------
# Fuel normalisation map
# The raw MAIN_FUEL field contains legacy "backwards compatibility" variants.
# We map everything to a clean 8-category label.
# ---------------------------------------------------------------------------
FUEL_MAP: dict[str, str] = {
    # Gas
    "mains gas (not community)": "gas",
    "mains gas (community)": "gas_community",
    # Legacy gas strings
    "mains gas - this is for backwards compatibility only and should not be used": "gas",
    "gas (not community)": "gas",
    "gas": "gas",
    # Electricity
    "electricity (not community)": "electric",
    "electricity (community)": "electric_community",
    "electricity - this is for backwards compatibility only and should not be used": "electric",
    "electricity": "electric",
    "electric": "electric",
    # Oil
    "oil (not community)": "oil",
    "oil - this is for backwards compatibility only and should not be used": "oil",
    "oil": "oil",
    # LPG
    "lpg (not community)": "lpg",
    "lpg": "lpg",
    # Biomass / solid fuel
    "biomass": "biomass",
    "solid fuel: coal": "solid_fuel",
    "house coal": "solid_fuel",
    "smokeless coal": "solid_fuel",
    "anthracite": "solid_fuel",
    "wood logs": "biomass",
    "wood chips": "biomass",
    "wood pellets (in bags, delivered)": "biomass",
    "wood pellets (bulk, delivered)": "biomass",
    "dual fuel appliance (mineral and wood)": "solid_fuel",
    # Heat networks / community
    "heat from boilers - waste combustion": "heat_network",
    "heat from boilers - biomass": "heat_network",
    "heat from boilers - biogas": "heat_network",
    "waste combustion": "heat_network",
    # Renewable heat
    "renewable heating (not community)": "renewable",
    "b30d (not community)": "other",
    "b30k (not community)": "other",
}

def normalise_fuel(raw: str | None) -> str:
    if pd.isna(raw) or raw is None:
        return "unknown"
    key = str(raw).strip().lower()
    return FUEL_MAP.get(key, "other")


# ---------------------------------------------------------------------------
# Processing
# ---------------------------------------------------------------------------

def process_zip(input_path: Path, output_path: Path) -> None:
    print(f"Input : {input_path}")
    print(f"Output: {output_path}")

    if not input_path.exists():
        sys.exit(f"ERROR: Input file not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(input_path, "r") as outer_zip:
        cert_entries = sorted(
            [n for n in outer_zip.namelist() if n.endswith("certificates.csv")]
        )
        total_las = len(cert_entries)
        print(f"Found {total_las} LA certificate files\n")

        # Open output once and stream-write
        with gzip.open(output_path, "wt", encoding="utf-8", newline="") as out_fh:
            header_written = False
            grand_total = 0

            for idx, entry in enumerate(cert_entries, 1):
                la_name = entry.split("/")[0]
                try:
                    with outer_zip.open(entry) as csv_fh:
                        # Read header to know which KEEP_COLS are present
                        header_row = pd.read_csv(csv_fh, nrows=0, dtype="string")
                        present_cols = [c for c in KEEP_COLS if c in header_row.columns]

                    # Re-open to read data (can't seek in ZipExtFile)
                    with outer_zip.open(entry) as csv_fh:
                        chunks = pd.read_csv(
                            csv_fh,
                            usecols=present_cols,
                            dtype="string",
                            low_memory=False,
                            chunksize=100_000,
                        )
                        la_rows = 0
                        for chunk in chunks:
                            # Add any KEEP_COLS missing from this LA as blank columns
                            for col in KEEP_COLS:
                                if col not in chunk.columns:
                                    chunk[col] = pd.NA

                            # Reorder to canonical order
                            chunk = chunk[KEEP_COLS].copy()

                            # Fuel normalisation
                            chunk.insert(
                                chunk.columns.get_loc("MAIN_FUEL") + 1,
                                "MAIN_FUEL_RAW",
                                chunk["MAIN_FUEL"],
                            )
                            chunk["MAIN_FUEL"] = chunk["MAIN_FUEL_RAW"].map(normalise_fuel)

                            chunk.to_csv(
                                out_fh,
                                index=False,
                                header=not header_written,
                            )
                            header_written = True
                            la_rows += len(chunk)

                    grand_total += la_rows
                    print(f"  [{idx:3d}/{total_las}] {la_name:<55} {la_rows:>8,} rows")

                except Exception as exc:  # noqa: BLE001
                    print(f"  [{idx:3d}/{total_las}] WARNING: skipped {la_name}: {exc}")

    print(f"\nDone. Total rows written: {grand_total:,}")
    size_mb = output_path.stat().st_size / 1_048_576
    print(f"Output file size: {size_mb:.1f} MB  ({output_path})")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract enriched EPC fields from all-domestic-certificates.zip"
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help=f"Path to all-domestic-certificates.zip (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help=f"Output .csv.gz path (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    process_zip(Path(args.input), Path(args.output))


if __name__ == "__main__":
    main()

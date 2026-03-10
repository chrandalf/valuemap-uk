from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_DIR = ROOT / "pipeline"
PIPELINE_DATA_DIR = PIPELINE_DIR / "data"
ARCHIVE_DIR = PIPELINE_DATA_DIR / "archive"
R2_ARCHIVE_DIR = ARCHIVE_DIR / "r2"

RAW_DIR = PIPELINE_DATA_DIR / "raw"
INTERMEDIATE_DIR = PIPELINE_DATA_DIR / "intermediate"
MODEL_DIR = PIPELINE_DATA_DIR / "model"
PUBLISH_DIR = PIPELINE_DATA_DIR / "publish"

RAW_SCHOOLS_DIR = RAW_DIR / "schools"
RAW_FLOOD_DIR = RAW_DIR / "flood"
RAW_ELECTIONS_DIR = RAW_DIR / "elections"
RAW_GEOGRAPHY_DIR = RAW_DIR / "geography"
RAW_PROPERTY_DIR = RAW_DIR / "property"
RAW_EPC_DIR = RAW_DIR / "epc"
RAW_STATIONS_DIR = RAW_DIR / "Stations"
RAW_CENSUS_DIR = RAW_DIR / "census"

INTERMEDIATE_SCHOOLS_DIR = INTERMEDIATE_DIR / "schools"
INTERMEDIATE_PROPERTY_DIR = INTERMEDIATE_DIR / "property"
INTERMEDIATE_EPC_DIR = INTERMEDIATE_DIR / "epc"
INTERMEDIATE_STATIONS_DIR = INTERMEDIATE_DIR / "stations"

MODEL_SCHOOLS_DIR = MODEL_DIR / "schools"
MODEL_FLOOD_DIR = MODEL_DIR / "flood"
MODEL_VOTE_DIR = MODEL_DIR / "vote"
MODEL_EPC_DIR = MODEL_DIR / "epc"
MODEL_PROPERTY_DIR = MODEL_DIR / "property"
MODEL_STATIONS_DIR = MODEL_DIR / "stations"
MODEL_CENSUS_DIR = MODEL_DIR / "census"

PUBLISH_SCHOOLS_DIR = PUBLISH_DIR / "schools"
PUBLISH_FLOOD_DIR = PUBLISH_DIR / "flood"
PUBLISH_VOTE_DIR = PUBLISH_DIR / "vote"
PUBLISH_EPC_DIR = PUBLISH_DIR / "epc"
PUBLISH_PROPERTY_DIR = PUBLISH_DIR / "property"
PUBLISH_STATIONS_DIR = PUBLISH_DIR / "stations"

MODEL_TRANSIT_DIR = MODEL_DIR / "transit"
PUBLISH_TRANSIT_DIR = PUBLISH_DIR / "transit"
MODEL_BUS_STOP_OVERLAY_POINTS = MODEL_TRANSIT_DIR / "bus_stop_overlay_points.geojson.gz"
MODEL_METRO_TRAM_OVERLAY_POINTS = MODEL_TRANSIT_DIR / "metro_tram_overlay_points.geojson.gz"
MODEL_PHARMACY_OVERLAY_POINTS = MODEL_TRANSIT_DIR / "pharmacy_overlay_points.geojson.gz"

PUBLIC_DATA_DIR = ROOT / "public" / "data"

RAW_SCHOOL_KS4 = RAW_SCHOOLS_DIR / "england_ks4revised.csv"
RAW_SCHOOL_PERF = RAW_SCHOOLS_DIR / "202425_performance_tables_schools_revised.csv"
RAW_OFSTED_MI = RAW_SCHOOLS_DIR / "ofsted_mi_state_schools.csv"
RAW_FLOOD_POSTCODE_CSV = RAW_FLOOD_DIR / "open_flood_risk_by_postcode.csv"
RAW_ELECTION_CANDIDATE_CSV = RAW_ELECTIONS_DIR / "HoC-GE2024-results-by-candidate.csv"
RAW_WESTMINSTER_BOUNDARY_GEOJSON = RAW_GEOGRAPHY_DIR / "Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFE_2463071003872310654.geojson"

INTERMEDIATE_SCHOOL_POSTCODE_SCORES = INTERMEDIATE_SCHOOLS_DIR / "school_postcode_scores_202425.csv"
INTERMEDIATE_SCHOOL_POSTCODE_SCORES_MAINSTREAM = INTERMEDIATE_SCHOOLS_DIR / "school_postcode_scores_202425_mainstream.csv"
INTERMEDIATE_SCHOOL_SCORES = INTERMEDIATE_SCHOOLS_DIR / "school_scores_202425.csv"
INTERMEDIATE_SCHOOL_SCORES_MAINSTREAM = INTERMEDIATE_SCHOOLS_DIR / "school_scores_202425_mainstream.csv"
INTERMEDIATE_SCHOOL_POSTCODE_CACHE = INTERMEDIATE_SCHOOLS_DIR / "school_postcode_coords_cache.json"

MODEL_SCHOOL_OVERLAY_POINTS = MODEL_SCHOOLS_DIR / "school_overlay_points.geojson.gz"
MODEL_PRIMARY_SCHOOL_OVERLAY_POINTS = MODEL_SCHOOLS_DIR / "primary_school_overlay_points.geojson.gz"
MODEL_STATION_OVERLAY_POINTS = MODEL_STATIONS_DIR / "station_overlay_points.geojson.gz"
MODEL_FLOOD_POSTCODE_LOOKUP = MODEL_FLOOD_DIR / "flood_postcode_lookup.json.gz"
MODEL_FLOOD_OUTCODE_SUMMARY = MODEL_FLOOD_DIR / "flood_outcode_summary.json.gz"
MODEL_FLOOD_POSTCODE_POINTS = MODEL_FLOOD_DIR / "flood_postcode_points.geojson.gz"

RAW_CRIME_DIR = RAW_DIR / "crime"
RAW_CRIME_LATEST_ZIP = RAW_CRIME_DIR / "latest.zip"

MODEL_CRIME_DIR = MODEL_DIR / "crime"
MODEL_CRIME_OVERLAY = MODEL_CRIME_DIR / "crime_overlay_lsoa.geojson.gz"
MODEL_CRIME_CELLS_TEMPLATE = MODEL_CRIME_DIR / "crime_cells_{grid}.json.gz"

PUBLISH_CRIME_DIR = PUBLISH_DIR / "crime"

RAW_CENSUS_COMMUTE_LSOA = RAW_CENSUS_DIR / "ts058_commute_lsoa21.csv"
RAW_CENSUS_AGE_LSOA = RAW_CENSUS_DIR / "ts007a_age_lsoa21.csv"
MODEL_CENSUS_COMMUTE_CELLS_TEMPLATE = MODEL_CENSUS_DIR / "commute_cells_{grid}.json.gz"
MODEL_CENSUS_AGE_CELLS_TEMPLATE = MODEL_CENSUS_DIR / "age_cells_{grid}.json.gz"

RAW_BROADBAND_DIR = RAW_DIR / "broadband"
MODEL_BROADBAND_DIR = MODEL_DIR / "broadband"
MODEL_BROADBAND_CELLS_TEMPLATE = MODEL_BROADBAND_DIR / "broadband_cells_{grid}.json.gz"

MODEL_EPC_FUEL_CELLS_TEMPLATE = MODEL_EPC_DIR / "epc_fuel_cells_{grid}.json.gz"
MODEL_EPC_AGE_CELLS_TEMPLATE  = MODEL_EPC_DIR / "epc_age_cells_{grid}.json.gz"

MODEL_VOTE_BLOCKS_BY_CONSTITUENCY_CSV = MODEL_VOTE_DIR / "ge2024_vote_blocks_by_constituency.csv"
MODEL_VOTE_BLOCKS_MAP_GEOJSON = MODEL_VOTE_DIR / "ge2024_vote_blocks_map.geojson"

REQUIRED_PROPERTY_ASSET_NAMES = [
    "grid_1km_full.json.gz",
    "grid_5km_full.json.gz",
    "grid_10km_full.json.gz",
    "grid_25km_full.json.gz",
    "grid_1km_ppsf_full.json.gz",
    "grid_5km_ppsf_full.json.gz",
    "grid_10km_ppsf_full.json.gz",
    "grid_25km_ppsf_full.json.gz",
    "deltas_overall_5km.json.gz",
    "deltas_overall_10km.json.gz",
    "deltas_overall_25km.json.gz",
    "postcode_outcode_index_1km.json.gz",
    "postcode_outcode_index_5km.json.gz",
    "postcode_outcode_index_10km.json.gz",
    "postcode_outcode_index_25km.json.gz",
    # Slim country lookup assets (built by build_country_lookup_assets.py)
    "country_cells_1km.json.gz",
    "country_cells_5km.json.gz",
    "country_cells_10km.json.gz",
    "country_cells_25km.json.gz",
    "country_by_outward.json.gz",
]


def ensure_pipeline_dirs() -> None:
    for p in [
        RAW_SCHOOLS_DIR,
        RAW_FLOOD_DIR,
        RAW_ELECTIONS_DIR,
        RAW_GEOGRAPHY_DIR,
        RAW_PROPERTY_DIR,
        RAW_EPC_DIR,
        RAW_STATIONS_DIR,
        INTERMEDIATE_SCHOOLS_DIR,
        INTERMEDIATE_PROPERTY_DIR,
        INTERMEDIATE_EPC_DIR,
        MODEL_SCHOOLS_DIR,
        MODEL_FLOOD_DIR,
        MODEL_VOTE_DIR,
        MODEL_EPC_DIR,
        MODEL_PROPERTY_DIR,
        PUBLISH_SCHOOLS_DIR,
        PUBLISH_FLOOD_DIR,
        PUBLISH_VOTE_DIR,
        PUBLISH_EPC_DIR,
        PUBLISH_PROPERTY_DIR,
        PUBLISH_STATIONS_DIR,
        R2_ARCHIVE_DIR,
        MODEL_STATIONS_DIR,
        INTERMEDIATE_STATIONS_DIR,
        RAW_CENSUS_DIR,
        MODEL_CENSUS_DIR,
        RAW_CRIME_DIR,
        MODEL_CRIME_DIR,
        PUBLISH_CRIME_DIR,
        RAW_BROADBAND_DIR,
        MODEL_BROADBAND_DIR,
        MODEL_TRANSIT_DIR,
        PUBLISH_TRANSIT_DIR,
    ]:
        p.mkdir(parents=True, exist_ok=True)

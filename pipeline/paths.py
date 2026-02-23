from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_DIR = ROOT / "pipeline"
PIPELINE_DATA_DIR = PIPELINE_DIR / "data"

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

INTERMEDIATE_SCHOOLS_DIR = INTERMEDIATE_DIR / "schools"
INTERMEDIATE_PROPERTY_DIR = INTERMEDIATE_DIR / "property"
INTERMEDIATE_EPC_DIR = INTERMEDIATE_DIR / "epc"

MODEL_SCHOOLS_DIR = MODEL_DIR / "schools"
MODEL_FLOOD_DIR = MODEL_DIR / "flood"
MODEL_VOTE_DIR = MODEL_DIR / "vote"
MODEL_EPC_DIR = MODEL_DIR / "epc"

PUBLISH_SCHOOLS_DIR = PUBLISH_DIR / "schools"
PUBLISH_FLOOD_DIR = PUBLISH_DIR / "flood"
PUBLISH_VOTE_DIR = PUBLISH_DIR / "vote"
PUBLISH_EPC_DIR = PUBLISH_DIR / "epc"

PUBLIC_DATA_DIR = ROOT / "public" / "data"

RAW_SCHOOL_KS4 = RAW_SCHOOLS_DIR / "england_ks4revised.csv"
RAW_SCHOOL_PERF = RAW_SCHOOLS_DIR / "202425_performance_tables_schools_revised.csv"
RAW_FLOOD_POSTCODE_CSV = RAW_FLOOD_DIR / "open_flood_risk_by_postcode.csv"
RAW_ELECTION_CANDIDATE_CSV = RAW_ELECTIONS_DIR / "HoC-GE2024-results-by-candidate.csv"
RAW_WESTMINSTER_BOUNDARY_GEOJSON = RAW_GEOGRAPHY_DIR / "Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFE_2463071003872310654.geojson"

INTERMEDIATE_SCHOOL_POSTCODE_SCORES = INTERMEDIATE_SCHOOLS_DIR / "school_postcode_scores_202425.csv"
INTERMEDIATE_SCHOOL_POSTCODE_SCORES_MAINSTREAM = INTERMEDIATE_SCHOOLS_DIR / "school_postcode_scores_202425_mainstream.csv"
INTERMEDIATE_SCHOOL_SCORES = INTERMEDIATE_SCHOOLS_DIR / "school_scores_202425.csv"
INTERMEDIATE_SCHOOL_SCORES_MAINSTREAM = INTERMEDIATE_SCHOOLS_DIR / "school_scores_202425_mainstream.csv"
INTERMEDIATE_SCHOOL_POSTCODE_CACHE = INTERMEDIATE_SCHOOLS_DIR / "school_postcode_coords_cache.json"

MODEL_SCHOOL_OVERLAY_POINTS = MODEL_SCHOOLS_DIR / "school_overlay_points.geojson.gz"
MODEL_FLOOD_POSTCODE_LOOKUP = MODEL_FLOOD_DIR / "flood_postcode_lookup.json.gz"
MODEL_FLOOD_OUTCODE_SUMMARY = MODEL_FLOOD_DIR / "flood_outcode_summary.json.gz"
MODEL_FLOOD_POSTCODE_POINTS = MODEL_FLOOD_DIR / "flood_postcode_points.geojson.gz"

MODEL_VOTE_BLOCKS_BY_CONSTITUENCY_CSV = MODEL_VOTE_DIR / "ge2024_vote_blocks_by_constituency.csv"
MODEL_VOTE_BLOCKS_MAP_GEOJSON = MODEL_VOTE_DIR / "ge2024_vote_blocks_map.geojson"


def ensure_pipeline_dirs() -> None:
    for p in [
        RAW_SCHOOLS_DIR,
        RAW_FLOOD_DIR,
        RAW_ELECTIONS_DIR,
        RAW_GEOGRAPHY_DIR,
        RAW_PROPERTY_DIR,
        RAW_EPC_DIR,
        INTERMEDIATE_SCHOOLS_DIR,
        INTERMEDIATE_PROPERTY_DIR,
        INTERMEDIATE_EPC_DIR,
        MODEL_SCHOOLS_DIR,
        MODEL_FLOOD_DIR,
        MODEL_VOTE_DIR,
        MODEL_EPC_DIR,
        PUBLISH_SCHOOLS_DIR,
        PUBLISH_FLOOD_DIR,
        PUBLISH_VOTE_DIR,
        PUBLISH_EPC_DIR,
    ]:
        p.mkdir(parents=True, exist_ok=True)

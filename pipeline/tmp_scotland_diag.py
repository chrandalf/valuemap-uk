from pathlib import Path
import sys

sys.path.insert(0, str(Path("pipeline").resolve()))
from build_property_artifacts import load_pp, load_scotland_properties, load_onspd

pp = load_pp(Path("pipeline/data/raw/property/pp-2025.txt"), years_back=10)
anchor = pp["month"].max()
scot = load_scotland_properties(Path("pipeline/data/raw/property/Scotland_properties.csv"), years_back=10, anchor_month=anchor)
onspd = load_onspd(Path("pipeline/data/raw/property/ONSPD_Online_latest_Postcode_Centroids_.csv"))
matched = scot.merge(onspd[["postcode_key"]], on="postcode_key", how="inner")

months = sorted(scot["month"].dt.strftime("%Y-%m-%d").unique().tolist()) if not scot.empty else []
print(f"pp_latest_month={anchor.strftime('%Y-%m-%d')}")
print(f"scotland_rows_after_window_shift={len(scot)}")
print(f"scotland_rows_matching_onspd={len(matched)}")
print(f"scotland_unique_months={len(months)} first={months[0] if months else None} last={months[-1] if months else None}")

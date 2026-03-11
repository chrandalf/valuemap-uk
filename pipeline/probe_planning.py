"""Quick probe of planning.data.gov.uk to understand available datasets with geometry."""
import csv
import io
import json
import urllib.request

BASE = "https://www.planning.data.gov.uk"


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "valuemap/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


# 1. planning-application CSV columns
print("=== planning-application CSV columns ===")
url = "https://files.planning.data.gov.uk/dataset/planning-application.csv"
req = urllib.request.Request(url, headers={"User-Agent": "valuemap/1.0", "Range": "bytes=0-8000"})
with urllib.request.urlopen(req, timeout=20) as r:
    data = r.read().decode("utf-8", errors="replace")
reader = csv.DictReader(io.StringIO(data))
rows = []
for i, row in enumerate(reader):
    rows.append(row)
    if i >= 2:
        break
print("Columns:", list(rows[0].keys()))
print()
for row in rows[:2]:
    print({k: v for k, v in row.items() if v.strip()})
print()

# 2. conservation-area - check geometry
print("=== conservation-area sample ===")
d = fetch(f"{BASE}/entity.json?dataset=conservation-area&limit=3")
for e in d.get("entities", []):
    has_pt = bool(e.get("point", "").strip())
    geo_len = len(e.get("geometry", ""))
    name = e.get("name", "")[:40]
    print(f"  name={name:<40}  point={has_pt}  geo_len={geo_len}")
print()

# 3. article-4-direction - check geometry
print("=== article-4-direction sample ===")
try:
    d2 = fetch(f"{BASE}/entity.json?dataset=article-4-direction&limit=3")
    for e in d2.get("entities", []):
        has_pt = bool(e.get("point", "").strip())
        geo_len = len(e.get("geometry", ""))
        name = e.get("name", "")[:40]
        print(f"  name={name:<40}  point={has_pt}  geo_len={geo_len}")
except Exception as ex:
    print(f"  Error: {ex}")
print()

# 4. tree-preservation-order - check geometry
print("=== tree-preservation-order sample ===")
try:
    d3 = fetch(f"{BASE}/entity.json?dataset=tree-preservation-order&limit=3")
    for e in d3.get("entities", []):
        has_pt = bool(e.get("point", "").strip())
        geo_len = len(e.get("geometry", ""))
        name = e.get("name", "")[:40]
        print(f"  name={name:<40}  point={has_pt}  geo_len={geo_len}")
    # Count total
    d3c = fetch(f"{BASE}/entity.json?dataset=tree-preservation-order&limit=1")
    print(f"  total count: {d3c.get('count')}")
except Exception as ex:
    print(f"  Error: {ex}")
print()

# 5. Check which datasets have bulk CSV downloads and reasonable counts
print("=== Datasets with counts ===")
interesting = [
    "planning-application",
    "conservation-area",
    "article-4-direction",
    "article-4-direction-area",
    "tree-preservation-order",
    "tree-preservation-zone",
    "brownfield-land",
    "heritage-at-risk",
    "scheduled-monument",
]
for ds in interesting:
    try:
        d = fetch(f"{BASE}/entity.json?dataset={ds}&limit=1")
        count = d.get("count", "?")
        entities = d.get("entities", [])
        if entities:
            e = entities[0]
            has_pt = bool(e.get("point", "").strip())
            geo_len = len(e.get("geometry", ""))
        else:
            has_pt = False
            geo_len = 0
        print(f"  {ds:<40}  count={count:<8}  point={has_pt}  geo_len={geo_len}")
    except Exception as ex:
        print(f"  {ds:<40}  ERROR: {ex}")

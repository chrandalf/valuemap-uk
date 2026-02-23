import gzip
import json
from pathlib import Path

base = Path('pipeline/data/publish/property')
for grid in ['1km', '5km', '10km', '25km']:
    ppsf = base / f'grid_{grid}_ppsf_full.json.gz'
    rows = json.loads(gzip.decompress(ppsf.read_bytes()).decode('utf-8'))
    has_ppsf = any('median_ppsf' in row for row in rows[:1000])
    print(f"{grid}: rows={len(rows)} has_median_ppsf={has_ppsf}")
    if rows:
        print('  keys=', sorted(rows[0].keys()))

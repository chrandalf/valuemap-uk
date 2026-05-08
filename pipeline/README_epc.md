# EPC data connectors

This folder includes a lightweight Python client for the UK EPC API so you can
pull domestic and non-domestic data in Kaggle (or locally) before uploading to
Cloudflare.

## Setup

1. Request an EPC API key: <https://epc.opendatacommunities.org/>.
2. Export your key (or pass it directly to the client):

```bash
export EPC_API_KEY="your-key-here"
```

## Usage in Kaggle or local notebooks

```python
from epc_connectors import load_epc_client

client = load_epc_client()

# Search domestic EPCs by postcode
results = client.search_domestic(postcode="SW1A 1AA", rows=10)

# Iterate with pagination
records = list(client.iter_domestic_search(postcode="SW1A 1AA", rows=100))

# Pull a certificate + recommendations by LMK key
lmk_key = records[0]["lmk-key"]
certificate = client.get_domestic_certificate(lmk_key)
recommendations = client.get_domestic_recommendations(lmk_key)
```

## Notes

- The API uses HTTP Basic Auth with the API key as the username.
- For non-domestic data, use `search_non_domestic()` and the matching
  `get_non_domestic_*` methods.
- The connector intentionally avoids any dependency on the main app code.

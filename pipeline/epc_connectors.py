"""EPC API connectors for Kaggle or local pipelines.

This module wraps the UK EPC (Energy Performance Certificate) API with
simple helpers for search and detail endpoints.

Docs: https://epc.opendatacommunities.org/docs/api
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Iterator, Optional

import os
import time
import requests


DEFAULT_BASE_URL = "https://epc.opendatacommunities.org/api/v1"
DEFAULT_USER_AGENT = "valuemap-uk-epc-connector/1.0"


@dataclass
class EpcConfig:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    user_agent: str = DEFAULT_USER_AGENT
    timeout_s: int = 30


class EpcClient:
    """Client for EPC API endpoints (domestic and non-domestic)."""

    def __init__(self, config: EpcConfig) -> None:
        self.config = config
        self.session = requests.Session()
        self.session.auth = (config.api_key, "")
        self.session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": config.user_agent,
            }
        )

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.config.base_url}/{path.lstrip('/')}"
        response = self.session.get(url, params=params or {}, timeout=self.config.timeout_s)
        response.raise_for_status()
        return response.json()

    def search_domestic(self, **params: Any) -> Dict[str, Any]:
        """Search EPC domestic certificates.

        Example params: postcode, uprn, address, local-authority, const-key,
        from-date, to-date, current-energy-efficiency, etc.
        """
        return self._get("domestic/search", params=params)

    def search_non_domestic(self, **params: Any) -> Dict[str, Any]:
        """Search EPC non-domestic certificates."""
        return self._get("non-domestic/search", params=params)

    def get_domestic_certificate(self, lmk_key: str) -> Dict[str, Any]:
        return self._get(f"domestic/certificate/{lmk_key}")

    def get_domestic_recommendations(self, lmk_key: str) -> Dict[str, Any]:
        return self._get(f"domestic/recommendations/{lmk_key}")

    def get_non_domestic_certificate(self, lmk_key: str) -> Dict[str, Any]:
        return self._get(f"non-domestic/certificate/{lmk_key}")

    def get_non_domestic_recommendations(self, lmk_key: str) -> Dict[str, Any]:
        return self._get(f"non-domestic/recommendations/{lmk_key}")

    def iter_domestic_search(
        self,
        rows: int = 100,
        start: int = 0,
        sleep_s: float = 0.1,
        **params: Any,
    ) -> Iterator[Dict[str, Any]]:
        """Iterate all domestic search results with pagination.

        Yields each record (dict). Uses rows/start pagination.
        """
        current = start
        while True:
            payload = dict(params)
            payload.update({"rows": rows, "start": current})
            data = self.search_domestic(**payload)
            records = data.get("rows") or data.get("result") or []
            if not records:
                break
            for record in records:
                yield record
            current += rows
            time.sleep(sleep_s)

    def iter_non_domestic_search(
        self,
        rows: int = 100,
        start: int = 0,
        sleep_s: float = 0.1,
        **params: Any,
    ) -> Iterator[Dict[str, Any]]:
        """Iterate all non-domestic search results with pagination."""
        current = start
        while True:
            payload = dict(params)
            payload.update({"rows": rows, "start": current})
            data = self.search_non_domestic(**payload)
            records = data.get("rows") or data.get("result") or []
            if not records:
                break
            for record in records:
                yield record
            current += rows
            time.sleep(sleep_s)


def load_epc_client(
    api_key: Optional[str] = None,
    base_url: str = DEFAULT_BASE_URL,
    user_agent: str = DEFAULT_USER_AGENT,
    timeout_s: int = 30,
) -> EpcClient:
    """Create an EpcClient from an explicit key or env var.

    Environment variables (first found wins):
    - EPC_API_KEY
    - UK_EPC_API_KEY
    """
    resolved_key = api_key or os.getenv("EPC_API_KEY") or os.getenv("UK_EPC_API_KEY")
    if not resolved_key:
        raise ValueError("Missing EPC API key. Set EPC_API_KEY or pass api_key.")
    config = EpcConfig(api_key=resolved_key, base_url=base_url, user_agent=user_agent, timeout_s=timeout_s)
    return EpcClient(config)


def example_usage() -> Dict[str, Any]:
    """Lightweight example for notebooks; returns first page of domestic search."""
    client = load_epc_client()
    return client.search_domestic(postcode="SW1A 1AA", rows=5)


__all__ = [
    "EpcClient",
    "EpcConfig",
    "load_epc_client",
    "example_usage",
]

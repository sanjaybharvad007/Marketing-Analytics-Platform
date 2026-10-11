"""Search performance from the Search Console Search Analytics API (`searchanalytics.query`)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from map_pipelines.demo.search import search_rows
from map_pipelines.demo.world import DemoWorld
from map_pipelines.models import DateWindow, Mode
from map_pipelines.retry import with_retry
from map_pipelines.sources.base import SourceNotConfigured

DIMENSIONS = ("date", "page", "query", "country", "device")
ROW_LIMIT = 25_000
READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"


def flatten_row(row: dict[str, Any]) -> dict[str, Any]:
    """Turn an API row (`keys` in dimension order plus metrics) into a flat dict."""
    keys = row.get("keys") or []
    if len(keys) != len(DIMENSIONS):
        raise ValueError(f"expected {len(DIMENSIONS)} keys, got {len(keys)}")
    flat: dict[str, Any] = dict(zip(DIMENSIONS, keys, strict=True))
    flat["clicks"] = row.get("clicks", 0)
    flat["impressions"] = row.get("impressions", 0)
    flat["position"] = row.get("position", 0.0)
    return flat


class GscDemoSource:
    name = "gsc"
    mode: Mode = "demo"

    def __init__(self, world: DemoWorld) -> None:
        self._world = world

    def fetch(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        for day in window.dates():
            for row in search_rows(self._world, day):
                yield flatten_row(row)


class GscLiveSource:
    """Pages through searchanalytics.query 25,000 rows at a time using startRow.

    `service` is a googleapiclient Resource for the `searchconsole` v1 API;
    when omitted it is built from Application Default Credentials.
    """

    name = "gsc"
    mode: Mode = "live"

    def __init__(self, site_url: str, service: Any | None = None) -> None:
        if not site_url:
            raise SourceNotConfigured("GSC_SITE_URL is not set")
        self._site_url = site_url
        self._service = service

    def _get_service(self) -> Any:
        if self._service is None:
            try:
                import google.auth
                from googleapiclient.discovery import build
            except ImportError as error:
                raise SourceNotConfigured(
                    "Install the Google extra to use the live Search Console source: "
                    'pip install "map-pipelines[google]"'
                ) from error
            credentials, _ = google.auth.default(scopes=[READONLY_SCOPE])
            self._service = build(
                "searchconsole", "v1", credentials=credentials, cache_discovery=False
            )
        return self._service

    @staticmethod
    def build_body(window: DateWindow, start_row: int) -> dict[str, Any]:
        return {
            "startDate": window.start.isoformat(),
            "endDate": window.end.isoformat(),
            "dimensions": list(DIMENSIONS),
            "type": "web",
            "dataState": "final",
            "rowLimit": ROW_LIMIT,
            "startRow": start_row,
        }

    def fetch(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        service = self._get_service()
        start_row = 0
        while True:
            body = self.build_body(window, start_row)
            response = with_retry(
                lambda body=body: (
                    service.searchanalytics().query(siteUrl=self._site_url, body=body).execute()
                ),
                description="gsc.searchanalytics.query",
            )
            rows = response.get("rows", [])
            for row in rows:
                yield flatten_row(row)
            if len(rows) < ROW_LIMIT:
                break
            start_row += ROW_LIMIT

"""Web analytics from the GA4 Data API (`properties.runReport`)."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from typing import Any

from map_pipelines.demo.traffic import traffic_rows
from map_pipelines.demo.world import DemoWorld
from map_pipelines.models import DateWindow, Mode
from map_pipelines.retry import with_retry
from map_pipelines.sources.base import SourceNotConfigured

DIMENSIONS = (
    "date",
    "pagePath",
    "sessionDefaultChannelGroup",
    "deviceCategory",
    # ISO 3166-1 alpha-2, which avoids mapping localised country names.
    "countryId",
)
METRICS = ("sessions", "totalUsers", "engagedSessions", "keyEvents", "totalRevenue")
PAGE_SIZE = 100_000


def report_rows(response: Any) -> Iterator[dict[str, str]]:
    """Flatten a RunReportResponse into dicts keyed by dimension and metric name.

    Works on the protobuf response or any object with the same attributes,
    which keeps the mapping testable without the Google client installed.
    """
    dimension_names = [header.name for header in response.dimension_headers]
    metric_names = [header.name for header in response.metric_headers]
    for row in response.rows:
        record = {
            name: value.value
            for name, value in zip(dimension_names, row.dimension_values, strict=True)
        }
        record.update(
            {name: value.value for name, value in zip(metric_names, row.metric_values, strict=True)}
        )
        yield record


class Ga4DemoSource:
    name = "ga4"
    mode: Mode = "demo"

    def __init__(self, world: DemoWorld) -> None:
        self._world = world

    def fetch(self, window: DateWindow) -> Iterable[dict[str, str]]:
        for day in window.dates():
            yield from traffic_rows(self._world, day)


class Ga4LiveSource:
    """Pages through runReport for the requested window.

    `client` is a `BetaAnalyticsDataClient`; when omitted it is created from
    Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS).
    """

    name = "ga4"
    mode: Mode = "live"

    def __init__(self, property_id: str, client: Any | None = None) -> None:
        if not property_id:
            raise SourceNotConfigured("GA4_PROPERTY_ID is not set")
        self._property = f"properties/{property_id}"
        self._client = client

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                from google.analytics.data_v1beta import BetaAnalyticsDataClient
            except ImportError as error:
                raise SourceNotConfigured(
                    "Install the Google extra to use the live GA4 source: "
                    'pip install "map-pipelines[google]"'
                ) from error
            self._client = BetaAnalyticsDataClient()
        return self._client

    def build_request(self, window: DateWindow, offset: int) -> dict[str, Any]:
        return {
            "property": self._property,
            "date_ranges": [
                {"start_date": window.start.isoformat(), "end_date": window.end.isoformat()}
            ],
            "dimensions": [{"name": name} for name in DIMENSIONS],
            "metrics": [{"name": name} for name in METRICS],
            "limit": PAGE_SIZE,
            "offset": offset,
            "keep_empty_rows": False,
        }

    def fetch(self, window: DateWindow) -> Iterable[dict[str, str]]:
        client = self._get_client()
        offset = 0
        while True:
            request = self.build_request(window, offset)
            response = with_retry(
                lambda request=request: client.run_report(request=request),
                description="ga4.runReport",
            )
            page = list(report_rows(response))
            yield from page
            offset += len(page)
            if not page or offset >= int(getattr(response, "row_count", 0) or 0):
                break

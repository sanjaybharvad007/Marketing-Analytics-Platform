"""Synthetic Search Console rows in the shape the Search Analytics API returns."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from typing import Any

from map_pipelines.demo import rng
from map_pipelines.demo.world import DemoWorld, expected_ctr, visibility

# Search Console reports lower-case ISO alpha-3 countries and upper-case devices.
_GSC_COUNTRY = {"US": "usa", "CA": "can", "GB": "gbr", "DE": "deu", "AU": "aus"}
_DEVICE_POSITION_OFFSET = {"desktop": 0.0, "mobile": 0.4, "tablet": 0.2}
_DEVICE_CTR = {"desktop": 1.1, "mobile": 1.0, "tablet": 0.9}


def search_rows(world: DemoWorld, day: date) -> Iterator[dict[str, Any]]:
    """Yield one API-shaped row per (page, query, country, device) with impressions."""
    seed = world.seed
    weekday = world.weekday_factor(day)
    trend = world.trend(day)
    for query in world.queries:
        story = world.demand_story(query.page, day)
        if story <= 0:
            continue
        position_today = world.position_on(query, day)
        daily_demand = query.demand * visibility(position_today) * weekday * trend * story
        url = world.url(query.page)
        devices = world.device_shares(query.page)
        for country, country_share in world.country_shares(query).items():
            country_offset = rng.between(seed, -0.8, 1.6, "cpos", query.query, country)
            for device, device_share in devices.items():
                key = (query.query, country, device, day)
                expected = daily_demand * country_share * device_share
                impressions = rng.stochastic_round(
                    seed, expected * rng.noise(seed, 0.25, "impr", *key), "impr", *key
                )
                if impressions == 0:
                    continue
                position = min(
                    max(position_today + country_offset + _DEVICE_POSITION_OFFSET[device], 1.0),
                    100.0,
                )
                ctr = min(expected_ctr(position) * query.ctr_factor * _DEVICE_CTR[device], 0.65)
                clicks = min(
                    impressions,
                    rng.stochastic_round(
                        seed, impressions * ctr * rng.noise(seed, 0.2, "ctr", *key), "clk", *key
                    ),
                )
                yield {
                    "keys": [
                        day.isoformat(),
                        url,
                        query.query,
                        _GSC_COUNTRY[country],
                        device.upper(),
                    ],
                    "clicks": clicks,
                    "impressions": impressions,
                    "ctr": clicks / impressions,
                    "position": round(position, 2),
                }

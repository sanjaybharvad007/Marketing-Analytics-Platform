"""Synthetic GA4 rows keyed by the Data API's dimension and metric names."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date

from map_pipelines.demo import catalog, rng
from map_pipelines.demo.catalog import DemoPage
from map_pipelines.demo.world import DemoWorld

# Non-organic channel volume relative to a page's organic sessions.
_CHANNEL_MIX: dict[str, dict[str, float]] = {
    "home": {
        "Direct": 2.2,
        "Paid Search": 0.5,
        "Email": 0.35,
        "Organic Social": 0.12,
        "Referral": 0.15,
    },
    "landing": {
        "Direct": 0.6,
        "Paid Search": 1.1,
        "Email": 1.2,
        "Organic Social": 0.3,
        "Referral": 0.1,
    },
    "category": {
        "Direct": 0.25,
        "Paid Search": 0.9,
        "Email": 0.2,
        "Organic Social": 0.05,
        "Referral": 0.05,
    },
    "product": {
        "Direct": 0.2,
        "Paid Search": 0.7,
        "Email": 0.15,
        "Organic Social": 0.08,
        "Referral": 0.06,
    },
    "article": {"Direct": 0.08, "Email": 0.1, "Organic Social": 0.22, "Referral": 0.08},
    "guide": {"Direct": 0.07, "Email": 0.06, "Organic Social": 0.1, "Referral": 0.1},
    "store": {"Direct": 0.3, "Paid Search": 0.1, "Organic Social": 0.05, "Referral": 0.15},
}
_ENGAGEMENT = {
    "Organic Search": 0.62,
    "Direct": 0.55,
    "Paid Search": 0.48,
    "Email": 0.66,
    "Organic Social": 0.41,
    "Referral": 0.58,
}
_CONVERSION_RATE = {
    "product": 0.032,
    "category": 0.018,
    "landing": 0.015,
    "home": 0.012,
    "store": 0.008,
    "guide": 0.0045,
    "article": 0.003,
}
_CHANNEL_CONVERSION = {
    "Organic Search": 1.0,
    "Direct": 1.15,
    "Paid Search": 0.9,
    "Email": 1.5,
    "Organic Social": 0.5,
    "Referral": 0.8,
}
_DEVICE_CONVERSION = {"desktop": 1.3, "mobile": 0.8, "tablet": 1.0}
_ORDER_VALUE = {"product": 148.0, "category": 132.0, "landing": 118.0, "home": 124.0}
# Organic sessions exceed Search Console clicks: other engines, unreported queries.
_ORGANIC_UPLIFT = 1.25


def _channel_volume(world: DemoWorld, page: DemoPage, channel: str, day: date) -> float:
    page_type = world.page_class(page).page_type
    organic = world.expected_organic_clicks(page) * _ORGANIC_UPLIFT
    if channel == "Organic Search":
        return organic * world.demand_story(page, day)
    if world.age(day) > page.age_days:
        return 0.0
    volume = organic * _CHANNEL_MIX[page_type].get(channel, 0.0)
    if channel == "Email":
        # Newsletters go out on Tuesdays and Thursdays.
        volume *= 2.3 if day.weekday() in (1, 3) else 0.55
    elif channel == "Paid Search" and 30 <= world.age(day) <= 44:
        # A two-week campaign burst about a month before the anchor.
        volume *= 1.6
    elif channel == "Organic Social":
        volume *= rng.noise(world.seed, 0.5, "social", day)
    return volume


def traffic_rows(world: DemoWorld, day: date) -> Iterator[dict[str, str]]:
    """Yield one row per (page, channel, device, country) that had sessions."""
    seed = world.seed
    stamp = day.strftime("%Y%m%d")
    seasonal = world.weekday_factor(day) * world.trend(day)
    for page in world.pages:
        page_type = world.page_class(page).page_type
        conversion_rate = _CONVERSION_RATE[page_type]
        order_value = _ORDER_VALUE.get(page_type, 0.0)
        devices = world.device_shares(page)
        countries = world.page_country_shares(page)
        for channel in catalog.CHANNELS:
            volume = _channel_volume(world, page, channel, day) * seasonal
            if volume <= 0:
                continue
            for country, country_share in countries.items():
                for device, device_share in devices.items():
                    key = (page.path, channel, country, device, day)
                    sessions = rng.stochastic_round(
                        seed,
                        volume * country_share * device_share * rng.noise(seed, 0.18, "s", *key),
                        "s",
                        *key,
                    )
                    if sessions == 0:
                        continue
                    users = max(1, round(sessions * rng.between(seed, 0.82, 0.92, "u", *key)))
                    engaged = min(
                        sessions,
                        round(
                            sessions * _ENGAGEMENT[channel] * rng.between(seed, 0.9, 1.1, "e", *key)
                        ),
                    )
                    conversions = min(
                        sessions,
                        rng.stochastic_round(
                            seed,
                            sessions
                            * conversion_rate
                            * _CHANNEL_CONVERSION[channel]
                            * _DEVICE_CONVERSION[device],
                            "c",
                            *key,
                        ),
                    )
                    revenue = conversions * order_value * rng.between(seed, 0.75, 1.3, "rev", *key)
                    yield {
                        "date": stamp,
                        "pagePath": page.path,
                        "sessionDefaultChannelGroup": channel,
                        "deviceCategory": device,
                        "countryId": country,
                        "sessions": str(sessions),
                        "totalUsers": str(users),
                        "engagedSessions": str(engaged),
                        "keyEvents": str(conversions),
                        "totalRevenue": f"{revenue:.2f}",
                    }

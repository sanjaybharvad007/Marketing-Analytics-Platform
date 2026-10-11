from __future__ import annotations

import logging
from datetime import date

import pytest

from map_pipelines.config import Settings
from map_pipelines.demo.world import DemoWorld
from map_pipelines.etl.transforms import TransformContext
from map_pipelines.sources.mentions import TrackedBrand
from map_pipelines.transform.classify import BrandClassifier

ANCHOR = date(2026, 6, 1)
SEED = 20260101


@pytest.fixture(autouse=True)
def _package_logging() -> None:
    """Emit every package log record during tests.

    The CLI logs at INFO; with the default WARNING level a log call whose
    `extra` collides with a LogRecord attribute would only fail in real runs.
    """
    logging.getLogger("map_pipelines").setLevel(logging.DEBUG)


@pytest.fixture
def settings() -> Settings:
    """Settings built from defaults only, ignoring any local .env file."""
    return Settings(_env_file=None, demo_anchor_date=ANCHOR, demo_seed=SEED)


@pytest.fixture(scope="session")
def world() -> DemoWorld:
    return DemoWorld(SEED, ANCHOR)


@pytest.fixture
def ctx() -> TransformContext:
    return TransformContext(
        site_url="https://www.northpeak.example",
        brand=BrandClassifier(r"north\s*-?\s*peak|northpeek"),
    )


@pytest.fixture
def brand() -> TrackedBrand:
    return TrackedBrand("Northpeak Outfitters", "northpeak.example", aliases=("Northpeak",))


@pytest.fixture
def competitors() -> tuple[TrackedBrand, ...]:
    return (
        TrackedBrand("Summit & Co", "summitandco.example"),
        TrackedBrand("TrailForge", "trailforge.example"),
        TrackedBrand("Alpenway", "alpenway.example"),
    )

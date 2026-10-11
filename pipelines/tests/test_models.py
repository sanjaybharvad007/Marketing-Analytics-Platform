from datetime import date

import pytest
from pydantic import ValidationError

from map_pipelines.models import AiResultRecord, DateWindow, GscRecord


def test_window_days_and_dates() -> None:
    window = DateWindow(start=date(2026, 5, 30), end=date(2026, 6, 2))
    assert window.days == 4
    assert window.dates()[0] == date(2026, 5, 30)
    assert window.dates()[-1] == date(2026, 6, 2)


def test_window_rejects_reversed_range() -> None:
    with pytest.raises(ValidationError):
        DateWindow(start=date(2026, 6, 2), end=date(2026, 6, 1))


def test_trailing_window_is_inclusive() -> None:
    window = DateWindow.trailing(3, date(2026, 6, 10))
    assert (window.start, window.end) == (date(2026, 6, 8), date(2026, 6, 10))


def test_chunks_cover_the_window_without_overlap() -> None:
    window = DateWindow(start=date(2026, 1, 1), end=date(2026, 1, 31))
    chunks = window.chunks(14)
    assert [chunk.days for chunk in chunks] == [14, 14, 3]
    assert chunks[0].start == window.start
    assert chunks[-1].end == window.end
    covered = [day for chunk in chunks for day in chunk.dates()]
    assert covered == window.dates()


def test_gsc_record_rejects_more_clicks_than_impressions() -> None:
    with pytest.raises(ValidationError, match="clicks exceed impressions"):
        GscRecord(
            date=date(2026, 6, 1),
            url="https://www.northpeak.example/",
            query="tents",
            country="US",
            device="mobile",
            clicks=5,
            impressions=4,
            sum_position=8.0,
        )


def test_gsc_record_rejects_lowercase_country() -> None:
    with pytest.raises(ValidationError):
        GscRecord(
            date=date(2026, 6, 1),
            url="https://www.northpeak.example/",
            query="tents",
            country="us",
            device="mobile",
            clicks=1,
            impressions=4,
            sum_position=8.0,
        )


def test_ai_record_rank_requires_mention() -> None:
    with pytest.raises(ValidationError, match="brand_rank"):
        AiResultRecord(
            date=date(2026, 6, 1),
            prompt_id=1,
            engine="claude",
            brand_mentioned=False,
            brand_rank=2,
        )


def test_ai_record_cited_url_requires_citation() -> None:
    with pytest.raises(ValidationError, match="cited_url"):
        AiResultRecord(
            date=date(2026, 6, 1),
            prompt_id=1,
            engine="claude",
            brand_mentioned=True,
            brand_rank=1,
            cited=False,
            cited_url="https://www.northpeak.example/",
        )

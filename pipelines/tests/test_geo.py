import pytest

from map_pipelines.transform.geo import normalize_country, normalize_device


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("US", "US"),
        ("us", "US"),
        ("usa", "US"),
        ("GBR", "GB"),
        ("deu", "DE"),
        ("aus", "AU"),
        ("can", "CA"),
        (" ca ", "CA"),
        ("zzz", "ZZ"),
        ("XX", "ZZ"),
        ("", "ZZ"),
        (None, "ZZ"),
        ("United States", "ZZ"),
    ],
)
def test_normalize_country(value: str | None, expected: str) -> None:
    assert normalize_country(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("desktop", "desktop"),
        ("MOBILE", "mobile"),
        ("Tablet", "tablet"),
        ("smart tv", "desktop"),
    ],
)
def test_normalize_device(value: str, expected: str) -> None:
    assert normalize_device(value) == expected


def test_unknown_device_raises() -> None:
    with pytest.raises(ValueError, match="unknown device"):
        normalize_device("fridge")

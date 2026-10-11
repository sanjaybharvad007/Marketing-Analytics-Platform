import pytest

from map_pipelines.transform.urls import (
    ForeignUrlError,
    is_local_origin,
    normalize_url,
    url_path,
)

SITE = "https://www.northpeak.example"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/blog/post", "https://www.northpeak.example/blog/post/"),
        ("/blog/post/", "https://www.northpeak.example/blog/post/"),
        ("/Blog/Post", "https://www.northpeak.example/blog/post/"),
        ("/", "https://www.northpeak.example/"),
        ("https://www.northpeak.example", "https://www.northpeak.example/"),
        ("http://northpeak.example/sale", "https://www.northpeak.example/sale/"),
        ("HTTPS://WWW.NORTHPEAK.EXAMPLE/sale/", "https://www.northpeak.example/sale/"),
        ("www.northpeak.example/sale/", "https://www.northpeak.example/sale/"),
        ("/guides//tents///", "https://www.northpeak.example/guides/tents/"),
        ("/guides/tents/#sizing", "https://www.northpeak.example/guides/tents/"),
        ("/files/size-chart.pdf", "https://www.northpeak.example/files/size-chart.pdf"),
    ],
)
def test_normalize_url_canonical_form(raw: str, expected: str) -> None:
    assert normalize_url(raw, SITE) == expected


def test_tracking_parameters_are_dropped_and_others_sorted() -> None:
    url = normalize_url("/sale/?utm_source=news&size=m&gclid=abc&color=red&fbclid=1", SITE)
    assert url == "https://www.northpeak.example/sale/?color=red&size=m"


def test_all_tracking_parameters_leave_no_query_string() -> None:
    assert (
        normalize_url("/sale/?utm_campaign=x&_ga=1", SITE) == "https://www.northpeak.example/sale/"
    )


def test_foreign_host_is_rejected() -> None:
    with pytest.raises(ForeignUrlError):
        normalize_url("https://www.summitandco.example/tents/", SITE)


def test_lookalike_host_is_rejected() -> None:
    with pytest.raises(ForeignUrlError):
        normalize_url("https://northpeak.example.evil.test/", SITE)


def test_empty_url_is_rejected() -> None:
    with pytest.raises(ValueError, match="empty"):
        normalize_url("   ", SITE)


def test_normalisation_is_idempotent() -> None:
    once = normalize_url("/Blog/Post?b=2&a=1", SITE)
    assert normalize_url(once, SITE) == once


def test_url_path_keeps_query() -> None:
    assert url_path("https://www.northpeak.example/sale/?size=m") == "/sale/?size=m"
    assert url_path("https://www.northpeak.example/") == "/"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("http://localhost:8200/", True),
        ("http://127.0.0.1:8200/guides/", True),
        ("http://[::1]:8200/", True),
        ("http://demo-site:8200/", True),
        ("https://www.northpeak.example/", False),
        ("https://localhost.northpeak.example/", False),
        ("not a url", False),
    ],
)
def test_is_local_origin(url: str, expected: bool) -> None:
    assert is_local_origin(url) is expected

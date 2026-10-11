import pytest

from map_pipelines.transform.classify import (
    BrandClassifier,
    PathRule,
    classify_intent,
    classify_path,
)


@pytest.mark.parametrize(
    ("path", "section", "page_type"),
    [
        ("/", "landing", "home"),
        ("/blog/", "blog", "landing"),
        ("/blog/winter-camping-checklist/", "blog", "article"),
        ("/guides/how-to-fit-a-backpack/", "guides", "guide"),
        ("/products/ridgeline-2p-tent/", "products", "product"),
        ("/categories/tents/", "categories", "category"),
        ("/stores/", "stores", "landing"),
        ("/stores/denver/", "stores", "store"),
        ("/sale/", "landing", "landing"),
        ("/account/orders/123/", "other", "other"),
        ("/sale/?size=m", "landing", "landing"),
    ],
)
def test_classify_path(path: str, section: str, page_type: str) -> None:
    result = classify_path(path)
    assert (result.section, result.page_type) == (section, page_type)


def test_first_matching_rule_wins() -> None:
    rules = (
        PathRule(r"^/blog/news/", "news", "article"),
        PathRule(r"^/blog/", "blog", "article"),
    )
    assert classify_path("/blog/news/launch/", rules).section == "news"
    assert classify_path("/blog/other/", rules).section == "blog"


@pytest.mark.parametrize(
    "query",
    [
        "northpeak",
        "North Peak outfitters",
        "north-peak tents",
        "northpeek jacket",
        "NORTHPEAK sale",
    ],
)
def test_brand_queries(query: str) -> None:
    assert BrandClassifier(r"north\s*-?\s*peak|northpeek").is_brand(query)


@pytest.mark.parametrize("query", ["north face jacket", "peak design bag", "best tents", "north"])
def test_non_brand_queries(query: str) -> None:
    assert not BrandClassifier(r"north\s*-?\s*peak|northpeek").is_brand(query)


@pytest.mark.parametrize(
    ("query", "intent"),
    [
        ("how to waterproof a tent", "informational"),
        ("what is a tent footprint", "informational"),
        ("sleeping bag rating chart", "informational"),
        ("best backpacking tents", "commercial"),
        ("down vs synthetic sleeping bag", "commercial"),
        ("ridgeline 2p tent review", "commercial"),
        ("hiking boots", "commercial"),
        ("hiking boots sale", "transactional"),
        ("camping store near me", "transactional"),
        ("buy trekking poles", "transactional"),
        ("layering system for alpine climbing trips", "informational"),
    ],
)
def test_classify_intent(query: str, intent: str) -> None:
    assert classify_intent(query) == intent


def test_brand_queries_are_navigational() -> None:
    assert classify_intent("northpeak sale", is_brand=True) == "navigational"

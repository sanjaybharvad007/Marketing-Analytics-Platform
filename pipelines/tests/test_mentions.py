"""The answer parser: mentions, rank order, citations, sentiment, excerpts."""

from __future__ import annotations

import pytest

from map_pipelines.sources.mentions import (
    TrackedBrand,
    analyse_answer,
    brand_sentiment,
    extract_urls,
    strip_links,
)

Brands = tuple[TrackedBrand, ...]


def test_brand_named_first_ranks_first(brand: TrackedBrand, competitors: Brands) -> None:
    text = "Northpeak Outfitters and Summit & Co both make solid two-person tents."
    result = analyse_answer(text, brand, competitors)
    assert result.brand_mentioned is True
    assert result.brand_rank == 1
    assert result.competitors_mentioned == ("Summit & Co",)


def test_rank_counts_competitors_named_earlier(brand: TrackedBrand, competitors: Brands) -> None:
    text = (
        "TrailForge is the usual pick. Summit & Co is a close second. "
        "Northpeak is worth a look, and Alpenway covers the budget end."
    )
    result = analyse_answer(text, brand, competitors)
    assert result.brand_rank == 3
    assert result.competitors_mentioned == ("TrailForge", "Summit & Co", "Alpenway")


def test_absent_brand_has_no_rank_or_sentiment(brand: TrackedBrand, competitors: Brands) -> None:
    result = analyse_answer("Summit & Co makes the warmest bags.", brand, competitors)
    assert result.brand_mentioned is False
    assert result.brand_rank is None
    assert result.sentiment is None
    assert result.competitors_mentioned == ("Summit & Co",)


def test_no_brands_at_all(brand: TrackedBrand, competitors: Brands) -> None:
    result = analyse_answer("Focus on fit and weight rather than a brand.", brand, competitors)
    assert result.brand_mentioned is False
    assert result.competitors_mentioned == ()
    assert result.cited is False


@pytest.mark.parametrize(
    "text",
    [
        "northpeak outfitters has good tents",
        "NORTHPEAK is fine",
        "Try **Northpeak Outfitters** first.",
        "I like Northpeak's return policy.",
        "North-peak? No: Northpeak.",
        "(Northpeak)",
        "Northpeak\nOutfitters stocks it.",
    ],
)
def test_mention_variants_are_detected(text: str, brand: TrackedBrand, competitors: Brands) -> None:
    assert analyse_answer(text, brand, competitors).brand_mentioned is True


@pytest.mark.parametrize(
    "text",
    [
        "Northpeakish designs are common.",
        "The north peak of the mountain is exposed.",
        "Visit northpeakoutlet for deals.",
    ],
)
def test_partial_words_are_not_mentions(
    text: str, brand: TrackedBrand, competitors: Brands
) -> None:
    assert analyse_answer(text, brand, competitors).brand_mentioned is False


@pytest.mark.parametrize(
    "text",
    [
        "Summit & Co is popular.",
        "Summit and Co is popular.",
        "summit &co is popular",
        "Summit + Co",
    ],
)
def test_ampersand_and_spelling_variants(
    text: str, brand: TrackedBrand, competitors: Brands
) -> None:
    assert analyse_answer(text, brand, competitors).competitors_mentioned == ("Summit & Co",)


def test_hostname_alone_is_a_citation_but_not_a_mention(
    brand: TrackedBrand, competitors: Brands
) -> None:
    text = "Compare specs before buying.\n\nSources: https://www.northpeak.example/guides/tents/"
    result = analyse_answer(text, brand, competitors)
    assert result.brand_mentioned is False
    assert result.cited is True
    assert result.cited_url == "https://www.northpeak.example/guides/tents/"


def test_first_brand_url_is_reported_without_trailing_punctuation(
    brand: TrackedBrand, competitors: Brands
) -> None:
    text = (
        "Summit & Co (https://www.summitandco.example/tents/) and Northpeak "
        "(https://northpeak.example/sale/). See also https://www.northpeak.example/about/."
    )
    result = analyse_answer(text, brand, competitors)
    assert result.cited_url == "https://northpeak.example/sale/"


def test_markdown_link_label_counts_as_mention(brand: TrackedBrand, competitors: Brands) -> None:
    text = "A good guide is [Northpeak's tent guide](https://www.northpeak.example/guides/tents/)."
    result = analyse_answer(text, brand, competitors)
    assert result.brand_mentioned is True
    assert result.cited is True


def test_lookalike_domain_is_not_a_citation(brand: TrackedBrand, competitors: Brands) -> None:
    text = "Northpeak is listed at https://northpeak.example.reviews.test/ and https://notnorthpeak.example/."
    result = analyse_answer(text, brand, competitors)
    assert result.brand_mentioned is True
    assert result.cited is False


def test_subdomain_is_a_citation(brand: TrackedBrand, competitors: Brands) -> None:
    result = analyse_answer("See https://help.northpeak.example/returns", brand, competitors)
    assert result.cited_url == "https://help.northpeak.example/returns"


def test_extract_urls_deduplicates_in_order() -> None:
    text = "a https://a.example/x, b https://b.example/y. again https://a.example/x"
    assert extract_urls(text) == ["https://a.example/x", "https://b.example/y"]


def test_strip_links_keeps_markdown_labels() -> None:
    assert strip_links("see [the guide](https://x.example/g) or https://y.example").strip() == (
        "see the guide or"
    )


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Northpeak is frequently recommended for durable gear.", "positive"),
        ("Northpeak gets mixed reviews; shipping is slow.", "negative"),
        ("Northpeak also sells tents.", "neutral"),
        ("Northpeak is not recommended for winter use.", "negative"),
        ("Northpeak isn't unreliable, whatever forums say.", "positive"),
        ("Summit & Co is excellent. Northpeak also sells tents.", "neutral"),
        ("Summit & Co is poor. Northpeak is excellent and reliable.", "positive"),
    ],
)
def test_sentiment(text: str, expected: str, brand: TrackedBrand) -> None:
    assert brand_sentiment(text, brand) == expected


def test_sentiment_only_reads_sentences_naming_the_brand(brand: TrackedBrand) -> None:
    text = (
        "Alpenway is overpriced and flimsy. Northpeak is a reliable pick. TrailForge is the worst."
    )
    assert brand_sentiment(text, brand) == "positive"


def test_excerpt_is_short_text_unchanged(brand: TrackedBrand, competitors: Brands) -> None:
    result = analyse_answer("Northpeak   is\nfine.", brand, competitors)
    assert result.answer_excerpt == "Northpeak is fine."


def test_long_excerpt_is_truncated_around_the_mention(
    brand: TrackedBrand, competitors: Brands
) -> None:
    text = ("filler " * 300) + "Northpeak is a reliable pick. " + ("tail " * 300)
    result = analyse_answer(text, brand, competitors, excerpt_chars=200)
    assert "Northpeak" in result.answer_excerpt
    assert result.answer_excerpt.startswith("… ")
    assert result.answer_excerpt.endswith(" …")
    assert len(result.answer_excerpt) <= 204


def test_long_excerpt_without_mention_starts_at_the_beginning(
    brand: TrackedBrand, competitors: Brands
) -> None:
    result = analyse_answer("word " * 400, brand, competitors, excerpt_chars=100)
    assert result.answer_excerpt.startswith("word word")
    assert len(result.answer_excerpt) <= 102


def test_excerpt_drops_a_source_label_left_empty_by_link_removal(
    brand: TrackedBrand, competitors: Brands
) -> None:
    text = (
        "Northpeak Outfitters is a reliable pick.\n\n"
        "Sources: https://www.northpeak.example/about/, https://www.trailforge.example/tents/"
    )
    result = analyse_answer(text, brand, competitors)
    assert result.cited is True
    assert result.answer_excerpt == "Northpeak Outfitters is a reliable pick."

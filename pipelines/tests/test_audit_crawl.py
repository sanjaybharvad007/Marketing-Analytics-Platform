"""Crawler, HTML parsing and the full audit against the bundled demo site (in-process)."""

from __future__ import annotations

import asyncio
from collections import Counter

import httpx
import pytest

from map_pipelines import demo_site
from map_pipelines.audit.crawler import Crawler
from map_pipelines.audit.parse import parse_page
from map_pipelines.audit.rules import run_rules
from map_pipelines.audit.runner import AuditReport, run_audit
from map_pipelines.audit.site import CrawlResult, Fetch
from map_pipelines.llm import OfflineProvider

PUBLIC = "https://www.northpeak.example"

HTML = """<!doctype html>
<html><head>
<title>Tent Guide</title><title>Second title</title>
<meta name="description" content="About tents.">
<meta name="ROBOTS" content="noindex, follow">
<link rel="canonical" href="/guides/tents/">
<meta property="og:title" content="Tent Guide">
<script type="application/ld+json">{"@graph": [{"@type": "Article"}, {"@type": ["HowTo", "Article"]}]}</script>
<script type="application/ld+json">{not valid json</script>
</head><body>
<header><nav><a href="/">Home</a> many navigation words here that must not count</nav></header>
<main>
<h1>Choosing  a <em>tent</em></h1>
<p>One two three four five. Don't split contractions.</p>
<img src="/a.jpg"><img src="/b.jpg" alt=""><img src="/c.jpg" alt="A tent">
<a href="/guides/packs/#fit">Packs</a>
<a href="http://www.northpeak.example/sale/">Sale</a>
<a href="https://other.example/x">Elsewhere</a>
<a href="mailto:help@northpeak.example">Mail</a>
<a href="#top">Top</a>
<script>var ignored = "words in script";</script>
</main>
<footer>Footer words do not count either.</footer>
</body></html>"""


def _parse(html: str = HTML):
    url = f"{PUBLIC}/guides/tents/"
    fetch = Fetch(url=url, status=200, final_url=url, chain=(url,), elapsed_ms=10)
    return parse_page(
        url,
        fetch,
        html,
        is_internal=lambda target: "northpeak.example" in target,
        to_public=lambda target: target.replace("http://", "https://"),
    )


def test_parse_head_fields() -> None:
    page = _parse()
    assert page.titles == ["Tent Guide", "Second title"]
    assert page.meta_description == "About tents."
    assert page.noindex is True
    assert page.canonical == f"{PUBLIC}/guides/tents/"
    assert page.open_graph == {"og:title": "Tent Guide"}
    assert page.structured_data_types == ["Article", "HowTo"]


def test_parse_body_fields() -> None:
    page = _parse()
    assert page.h1 == ["Choosing a tent"]
    assert [(image.src, image.alt) for image in page.images] == [
        ("/a.jpg", None),
        ("/b.jpg", ""),
        ("/c.jpg", "A tent"),
    ]
    # h1 (3) + paragraph (8) + five link labels; nav, footer and script are excluded.
    assert page.word_count == 16


def test_parse_links_resolves_and_classifies() -> None:
    links = {link.raw: link for link in _parse().links}
    assert set(links) == {
        "/",
        "/guides/packs/#fit",
        "http://www.northpeak.example/sale/",
        "https://other.example/x",
    }
    assert links["/guides/packs/#fit"].url == f"{PUBLIC}/guides/packs/"
    assert links["http://www.northpeak.example/sale/"].url == f"{PUBLIC}/sale/"
    assert links["https://other.example/x"].internal is False


def test_parse_page_without_head_or_main() -> None:
    page = _parse("<p>Just five words right here</p>")
    assert page.titles == []
    assert page.canonical is None
    assert page.word_count == 5


@pytest.fixture(scope="module")
def crawl() -> CrawlResult:
    async def run() -> CrawlResult:
        site = demo_site.StaticSite()
        async with httpx.AsyncClient(transport=demo_site.transport(site)) as client:
            return await Crawler("http://localhost:8200/", client, public_origin=PUBLIC).crawl()

    return asyncio.run(run())


def test_crawl_finds_every_page(crawl: CrawlResult) -> None:
    assert len(crawl.pages) == 25
    assert f"{PUBLIC}/" in crawl.pages
    assert all(url.startswith(PUBLIC) for url in crawl.pages)


def test_crawl_respects_robots(crawl: CrawlResult) -> None:
    assert crawl.skipped_by_robots == {f"{PUBLIC}/cart/"}
    assert f"{PUBLIC}/cart/" not in crawl.fetches


def test_crawl_reads_the_sitemap(crawl: CrawlResult) -> None:
    assert len(crawl.sitemap_urls) == 26
    assert f"{PUBLIC}/trade-in/" in crawl.sitemap_urls


def test_crawl_records_redirect_chains(crawl: CrawlResult) -> None:
    fetch = crawl.fetches[f"{PUBLIC}/winter-sale/"]
    assert fetch.chain == (f"{PUBLIC}/winter-sale/", f"{PUBLIC}/sale-2025/", f"{PUBLIC}/sale/")
    assert fetch.redirects == 2
    assert fetch.status == 200


def test_crawl_records_errors_and_inlinks(crawl: CrawlResult) -> None:
    assert crawl.fetches[f"{PUBLIC}/blog/tent-care-basics/"].status == 404
    assert crawl.inlinks[f"{PUBLIC}/blog/tent-care-basics/"] == {
        f"{PUBLIC}/blog/best-backpacking-tents-2025/"
    }
    assert f"{PUBLIC}/trade-in/" not in crawl.inlinks


def test_demo_site_has_each_planted_problem_exactly_where_expected(crawl: CrawlResult) -> None:
    found = {(issue.rule, issue.url.removeprefix(PUBLIC)) for issue in run_rules(crawl)}
    expected = {
        ("noindex_in_sitemap", "/products/frostline-20-sleeping-bag/"),
        ("title_missing", "/stores/boulder/"),
        ("canonical_mismatch", "/products/traverse-55-backpack/"),
        ("broken_internal_link", "/blog/best-backpacking-tents-2025/"),
        ("sitemap_url_error", "/blog/ultralight-backpacking-gear-list/"),
        ("title_too_long", "/categories/backpacks/"),
        ("title_too_short", "/blog/winter-camping-checklist/"),
        ("title_duplicate", "/about/"),
        ("title_duplicate", "/blog/gear-repair-at-home/"),
        ("meta_description_missing", "/guides/how-to-fit-a-backpack/"),
        ("meta_description_too_long", "/about/"),
        ("meta_description_too_short", "/stores/denver/"),
        ("meta_description_duplicate", "/categories/tents/"),
        ("meta_description_duplicate", "/categories/sleeping-bags/"),
        ("h1_missing", "/blog/down-vs-synthetic-sleeping-bags/"),
        ("h1_multiple", "/guides/sleeping-bag-temperature-ratings/"),
        ("canonical_missing", "/blog/down-vs-synthetic-sleeping-bags/"),
        ("thin_content", "/guides/tent-footprint-guide/"),
        ("image_alt_missing", "/products/basecamp-4p-tent/"),
        ("structured_data_missing", "/products/skyline-ul-1p-tent/"),
        ("open_graph_missing", "/products/skyline-ul-1p-tent/"),
        ("redirect_chain", "/blog/winter-camping-checklist/"),
        ("insecure_link", "/blog/best-backpacking-tents-2025/"),
        ("slow_response", "/products/basecamp-4p-tent/"),
        ("orphan_page", "/trade-in/"),
    }
    assert found == expected


def test_run_audit_scores_and_summarises() -> None:
    async def run() -> AuditReport:
        site = demo_site.StaticSite()
        async with httpx.AsyncClient(transport=demo_site.transport(site)) as client:
            return await run_audit(
                "http://localhost:8200/", OfflineProvider(), public_origin=PUBLIC, client=client
            )

    report = asyncio.run(run())
    assert report.pages_crawled == 25
    assert report.site_url == PUBLIC
    assert Counter(issue.severity for issue in report.issues) == {
        "critical": 1,
        "high": 4,
        "medium": 10,
        "low": 10,
    }
    assert 80 < report.health_score < 95
    assert report.summary_source == "heuristic"
    assert "Health score" in report.summary.headline


def test_static_site_blocks_path_traversal_and_private_files() -> None:
    site = demo_site.StaticSite()
    assert site.respond("/../pyproject.toml").status == 404
    assert site.respond("/_server.json").status == 404
    assert site.respond("/robots.txt").status == 200
    assert site.respond("/winter-sale/").headers["Location"] == "/sale-2025/"
    assert site.respond("/products/basecamp-4p-tent/").delay == pytest.approx(1.2)

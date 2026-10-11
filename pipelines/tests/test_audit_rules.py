"""One or more tests per audit rule, on hand-built pages."""

from __future__ import annotations

from map_pipelines.audit.rules import RULES, AuditConfig, run_rules
from map_pipelines.audit.site import CrawlResult, Fetch, Image, Link, Page

SITE = "https://www.northpeak.example"
GOOD_DESCRIPTION = (
    "A complete guide to choosing a backpacking tent, covering capacity, weight and weather."
)


def fetch(
    url: str, status: int = 200, chain: tuple[str, ...] | None = None, ms: float = 120
) -> Fetch:
    chain = chain or (url,)
    return Fetch(url=url, status=status, final_url=chain[-1], chain=chain, elapsed_ms=ms)


def page(path: str = "/guides/tents/", **overrides) -> Page:
    url = f"{SITE}{path}"
    values = {
        "url": url,
        "fetch": fetch(url),
        "titles": ["How to Choose a Backpacking Tent"],
        "meta_description": GOOD_DESCRIPTION,
        "h1": ["How to choose a backpacking tent"],
        "canonical": url,
        "word_count": 900,
        "structured_data_types": ["Article"],
        "open_graph": {"og:title": "t", "og:description": "d", "og:image": "i"},
    }
    values.update(overrides)
    return Page(**values)


def crawl(
    *pages: Page, sitemap: set[str] | None = None, fetches: dict | None = None
) -> CrawlResult:
    result = CrawlResult(site_url=SITE)
    for item in pages:
        result.pages[item.url] = item
        result.fetches[item.url] = item.fetch
        for link in item.links:
            if link.internal:
                result.inlinks.setdefault(link.url, set()).add(item.url)
    result.fetches.update(fetches or {})
    result.sitemap_urls = sitemap or set()
    return result


def rules_for(result: CrawlResult, config: AuditConfig | None = None) -> list[str]:
    return [issue.rule for issue in run_rules(result, config)]


def link(path: str, raw: str | None = None, internal: bool = True) -> Link:
    return Link(url=f"{SITE}{path}" if internal else path, raw=raw or path, internal=internal)


def test_a_clean_page_has_no_issues() -> None:
    assert run_rules(crawl(page())) == []


def test_every_rule_has_metadata() -> None:
    assert len(RULES) >= 22
    for info in RULES.values():
        assert info.severity in {"critical", "high", "medium", "low"}
        assert info.title
        assert info.fix


# --- titles ---------------------------------------------------------------


def test_title_missing() -> None:
    issues = run_rules(crawl(page(titles=[])))
    assert [(i.rule, i.severity) for i in issues] == [("title_missing", "high")]


def test_title_too_long() -> None:
    issues = run_rules(crawl(page(titles=["T" * 61])))
    assert [i.rule for i in issues] == ["title_too_long"]
    assert issues[0].details["length"] == 61


def test_title_at_the_limit_is_fine() -> None:
    assert rules_for(crawl(page(titles=["T" * 60]))) == []


def test_title_too_short() -> None:
    assert rules_for(crawl(page(titles=["Tents"]))) == ["title_too_short"]


def test_title_duplicate_flags_every_page_in_the_group() -> None:
    a = page("/a/", titles=["Northpeak Outfitters Gear"])
    b = page("/b/", titles=["northpeak outfitters gear "])
    c = page("/c/", titles=["Something Else Entirely"])
    issues = [i for i in run_rules(crawl(a, b, c)) if i.rule == "title_duplicate"]
    assert {i.url for i in issues} == {a.url, b.url}
    assert issues[0].details["duplicates"] == [b.url]


def test_noindex_pages_are_ignored_for_duplicates() -> None:
    a = page("/a/", titles=["Same Title For Both Pages"])
    b = page("/b/", titles=["Same Title For Both Pages"], robots="noindex")
    assert "title_duplicate" not in rules_for(crawl(a, b))


# --- meta descriptions ------------------------------------------------------


def test_meta_description_missing() -> None:
    assert rules_for(crawl(page(meta_description=None))) == ["meta_description_missing"]
    assert rules_for(crawl(page(meta_description="   "))) == ["meta_description_missing"]


def test_meta_description_too_long_and_too_short() -> None:
    assert rules_for(crawl(page(meta_description="d" * 161))) == ["meta_description_too_long"]
    assert rules_for(crawl(page(meta_description="Our store."))) == ["meta_description_too_short"]


def test_meta_description_duplicate() -> None:
    a, b = page("/a/"), page("/b/")
    assert rules_for(crawl(a, b)).count("meta_description_duplicate") == 2


def test_thresholds_are_configurable() -> None:
    config = AuditConfig(title_max=20, description_max=50)
    assert set(rules_for(crawl(page()), config)) == {"title_too_long", "meta_description_too_long"}


# --- headings, canonical, indexability ---------------------------------------


def test_h1_missing_and_multiple() -> None:
    assert rules_for(crawl(page(h1=[]))) == ["h1_missing"]
    assert rules_for(crawl(page(h1=[""]))) == ["h1_missing"]
    issues = run_rules(crawl(page(h1=["One", "Two"])))
    assert [i.rule for i in issues] == ["h1_multiple"]
    assert issues[0].details["headings"] == ["One", "Two"]


def test_canonical_missing() -> None:
    assert rules_for(crawl(page(canonical=None))) == ["canonical_missing"]


def test_canonical_mismatch() -> None:
    issues = run_rules(crawl(page(canonical=f"{SITE}/guides/other/")))
    assert [(i.rule, i.severity) for i in issues] == [("canonical_mismatch", "high")]


def test_canonical_trailing_slash_difference_is_tolerated() -> None:
    assert rules_for(crawl(page(canonical=f"{SITE}/guides/tents"))) == []


def test_noindex_in_sitemap_is_critical() -> None:
    item = page(robots="noindex, follow")
    issues = run_rules(crawl(item, sitemap={item.url}))
    assert ("noindex_in_sitemap", "critical") in [(i.rule, i.severity) for i in issues]


def test_noindex_outside_sitemap_is_intentional() -> None:
    assert "noindex_in_sitemap" not in rules_for(crawl(page(robots="noindex")))


# --- content -------------------------------------------------------------------


def test_thin_content() -> None:
    issues = run_rules(crawl(page(word_count=120)))
    assert [i.rule for i in issues] == ["thin_content"]
    assert issues[0].details["word_count"] == 120
    assert rules_for(crawl(page(word_count=200))) == []


def test_image_alt_missing_ignores_decorative_images() -> None:
    images = [
        Image("/a.jpg", None),
        Image("/b.jpg", ""),
        Image("/c.jpg", "A tent"),
        Image("/d.jpg", None),
    ]
    issues = run_rules(crawl(page(images=images)))
    assert [i.rule for i in issues] == ["image_alt_missing"]
    assert issues[0].details == {"images": ["/a.jpg", "/d.jpg"], "count": 2}


def test_structured_data_missing_only_on_content_and_product_pages() -> None:
    assert rules_for(crawl(page("/products/tent/", structured_data_types=[]))) == [
        "structured_data_missing"
    ]
    assert rules_for(crawl(page("/blog/post/", structured_data_types=[]))) == [
        "structured_data_missing"
    ]
    assert rules_for(crawl(page("/stores/denver/", structured_data_types=[]))) == []


def test_open_graph_missing_lists_absent_tags() -> None:
    issues = run_rules(crawl(page(open_graph={"og:title": "t"})))
    assert [i.rule for i in issues] == ["open_graph_missing"]
    assert issues[0].details["missing"] == ["og:description", "og:image"]


# --- links ---------------------------------------------------------------------


def test_broken_internal_link() -> None:
    dead = f"{SITE}/blog/gone/"
    item = page(links=[link("/blog/gone/"), link("/blog/ok/")])
    result = crawl(
        item, fetches={dead: fetch(dead, 404), f"{SITE}/blog/ok/": fetch(f"{SITE}/blog/ok/")}
    )
    issues = run_rules(result)
    assert [(i.rule, i.severity) for i in issues] == [("broken_internal_link", "high")]
    assert issues[0].details["links"] == [{"url": dead, "status": 404}]


def test_external_links_are_not_checked() -> None:
    item = page(links=[link("https://other.example/x", internal=False)])
    assert rules_for(crawl(item)) == []


def test_redirect_chain_needs_two_hops() -> None:
    one_hop = f"{SITE}/old/"
    two_hops = f"{SITE}/older/"
    item = page(links=[link("/old/"), link("/older/")])
    result = crawl(
        item,
        fetches={
            one_hop: fetch(one_hop, chain=(one_hop, f"{SITE}/new/")),
            two_hops: fetch(two_hops, chain=(two_hops, one_hop, f"{SITE}/new/")),
        },
    )
    issues = run_rules(result)
    assert [i.rule for i in issues] == ["redirect_chain"]
    assert [entry["url"] for entry in issues[0].details["links"]] == [two_hops]


def test_insecure_link_looks_at_the_raw_href() -> None:
    item = page(
        links=[
            link("/sale/", raw="http://www.northpeak.example/sale/"),
            link("http://other.example/", internal=False),
            link("/ok/", raw="https://www.northpeak.example/ok/"),
        ]
    )
    issues = [i for i in run_rules(crawl(item)) if i.rule == "insecure_link"]
    assert issues[0].details["links"] == [
        "http://other.example/",
        "http://www.northpeak.example/sale/",
    ]


def test_slow_response() -> None:
    url = f"{SITE}/guides/tents/"
    assert rules_for(crawl(page(fetch=fetch(url, ms=801)))) == ["slow_response"]
    assert rules_for(crawl(page(fetch=fetch(url, ms=800)))) == []


# --- sitemap -------------------------------------------------------------------


def test_orphan_page() -> None:
    hub = page("/", links=[link("/linked/")])
    linked = page(
        "/linked/", titles=["A Linked Page With Its Own Title"], meta_description="x" * 80
    )
    orphan = page(
        "/orphan/", titles=["An Orphan Page With Its Own Title"], meta_description="y" * 80
    )
    result = crawl(hub, linked, orphan, sitemap={linked.url, orphan.url})
    issues = [i for i in run_rules(result) if i.rule == "orphan_page"]
    assert [i.url for i in issues] == [orphan.url]


def test_self_link_does_not_rescue_an_orphan() -> None:
    orphan = page("/orphan/", links=[link("/orphan/")])
    assert "orphan_page" in rules_for(crawl(orphan, sitemap={orphan.url}))


def test_sitemap_url_error_for_dead_and_redirected_urls() -> None:
    dead = f"{SITE}/gone/"
    moved = f"{SITE}/moved/"
    result = crawl(
        page(),
        sitemap={dead, moved},
        fetches={dead: fetch(dead, 404), moved: fetch(moved, chain=(moved, f"{SITE}/new/"))},
    )
    issues = [i for i in run_rules(result) if i.rule == "sitemap_url_error"]
    assert {i.url for i in issues} == {dead, moved}
    assert all(i.severity == "high" for i in issues)


def test_issues_are_sorted_by_severity() -> None:
    item = page(titles=[], robots="noindex", word_count=10, open_graph={})
    severities = [i.severity for i in run_rules(crawl(item, sitemap={item.url}))]
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    assert severities == sorted(severities, key=order.__getitem__)
    assert severities[0] == "critical"

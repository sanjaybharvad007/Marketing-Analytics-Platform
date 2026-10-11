"""The audit rule set.

A rule is a function from the crawl result to issues. Page-level rules are
written against one page and lifted with `per_page`; they only look at
indexable pages (HTTP 200 HTML that was not redirected). Thresholds live in
`AuditConfig` so a site can tune them.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from urllib.parse import urlsplit

from map_pipelines.audit.site import CrawlResult, Issue, Page, Severity
from map_pipelines.transform.classify import classify_path


@dataclass(frozen=True)
class AuditConfig:
    title_min: int = 15
    title_max: int = 60
    description_min: int = 70
    description_max: int = 160
    thin_content_words: int = 200
    slow_response_ms: float = 800.0
    required_open_graph: tuple[str, ...] = ("og:title", "og:description", "og:image")
    structured_data_page_types: tuple[str, ...] = ("product", "article", "guide")


@dataclass(frozen=True)
class RuleInfo:
    rule: str
    severity: Severity
    title: str
    fix: str


Rule = Callable[[CrawlResult, AuditConfig], Iterable[Issue]]
PageRule = Callable[[Page, CrawlResult, AuditConfig], Iterable[Issue]]

RULES: dict[str, RuleInfo] = {}
_CHECKS: list[Rule] = []


def _register(info: RuleInfo) -> None:
    RULES[info.rule] = info


def _issue(rule: str, url: str, message: str, **details: object) -> Issue:
    return Issue(
        rule=rule, severity=RULES[rule].severity, url=url, message=message, details=details
    )


def site_rule(*infos: RuleInfo) -> Callable[[Rule], Rule]:
    def decorate(check: Rule) -> Rule:
        for info in infos:
            _register(info)
        _CHECKS.append(check)
        return check

    return decorate


def per_page(*infos: RuleInfo) -> Callable[[PageRule], PageRule]:
    def decorate(check: PageRule) -> PageRule:
        def lifted(result: CrawlResult, config: AuditConfig) -> Iterator[Issue]:
            for page in result.pages.values():
                yield from check(page, result, config)

        for info in infos:
            _register(info)
        _CHECKS.append(lifted)
        return check

    return decorate


def _group_duplicates(result: CrawlResult, value: Callable[[Page], str | None]) -> list[list[Page]]:
    groups: dict[str, list[Page]] = defaultdict(list)
    for page in result.pages.values():
        text = (value(page) or "").strip().lower()
        if text and not page.noindex:
            groups[text].append(page)
    return [pages for pages in groups.values() if len(pages) > 1]


# --- titles -------------------------------------------------------------------


@per_page(
    RuleInfo(
        "title_missing",
        "high",
        "Missing title tag",
        "Add a unique, descriptive <title> to each page.",
    ),
    RuleInfo(
        "title_too_long",
        "low",
        "Title too long",
        "Shorten titles to about 60 characters so they are not truncated in results.",
    ),
    RuleInfo(
        "title_too_short",
        "low",
        "Title too short",
        "Expand short titles so they describe the page and include its main term.",
    ),
)
def check_title(page: Page, _: CrawlResult, config: AuditConfig) -> Iterator[Issue]:
    title = page.title
    if not title:
        yield _issue("title_missing", page.url, "The page has no <title>.")
    elif len(title) > config.title_max:
        yield _issue(
            "title_too_long",
            page.url,
            f"Title is {len(title)} characters (limit {config.title_max}).",
            title=title,
            length=len(title),
        )
    elif len(title) < config.title_min:
        yield _issue(
            "title_too_short",
            page.url,
            f"Title is only {len(title)} characters.",
            title=title,
            length=len(title),
        )


@site_rule(
    RuleInfo(
        "title_duplicate",
        "medium",
        "Duplicate title tags",
        "Give each page its own title; duplicates make pages compete for the same query.",
    )
)
def check_duplicate_titles(result: CrawlResult, _: AuditConfig) -> Iterator[Issue]:
    for pages in _group_duplicates(result, lambda page: page.title):
        urls = sorted(page.url for page in pages)
        for page in pages:
            yield _issue(
                "title_duplicate",
                page.url,
                f"Title is shared with {len(pages) - 1} other page(s).",
                title=page.title,
                duplicates=[url for url in urls if url != page.url],
            )


# --- meta descriptions ----------------------------------------------------------


@per_page(
    RuleInfo(
        "meta_description_missing",
        "medium",
        "Missing meta description",
        "Write a meta description that summarises the page in one or two sentences.",
    ),
    RuleInfo(
        "meta_description_too_long",
        "low",
        "Meta description too long",
        "Keep meta descriptions under about 160 characters.",
    ),
    RuleInfo(
        "meta_description_too_short",
        "low",
        "Meta description too short",
        "Expand very short meta descriptions to at least 70 characters.",
    ),
)
def check_meta_description(page: Page, _: CrawlResult, config: AuditConfig) -> Iterator[Issue]:
    description = (page.meta_description or "").strip()
    if not description:
        yield _issue("meta_description_missing", page.url, "The page has no meta description.")
    elif len(description) > config.description_max:
        yield _issue(
            "meta_description_too_long",
            page.url,
            f"Meta description is {len(description)} characters (limit {config.description_max}).",
            length=len(description),
        )
    elif len(description) < config.description_min:
        yield _issue(
            "meta_description_too_short",
            page.url,
            f"Meta description is only {len(description)} characters.",
            length=len(description),
        )


@site_rule(
    RuleInfo(
        "meta_description_duplicate",
        "low",
        "Duplicate meta descriptions",
        "Write a distinct meta description for each page.",
    )
)
def check_duplicate_descriptions(result: CrawlResult, _: AuditConfig) -> Iterator[Issue]:
    for pages in _group_duplicates(result, lambda page: page.meta_description):
        urls = sorted(page.url for page in pages)
        for page in pages:
            yield _issue(
                "meta_description_duplicate",
                page.url,
                f"Meta description is shared with {len(pages) - 1} other page(s).",
                duplicates=[url for url in urls if url != page.url],
            )


# --- headings, canonical, indexability -----------------------------------------


@per_page(
    RuleInfo("h1_missing", "medium", "Missing H1", "Add one H1 that states the page's topic."),
    RuleInfo(
        "h1_multiple",
        "low",
        "Multiple H1 headings",
        "Keep a single H1 and demote the others to H2.",
    ),
)
def check_h1(page: Page, _: CrawlResult, __: AuditConfig) -> Iterator[Issue]:
    headings = [heading for heading in page.h1 if heading]
    if not headings:
        yield _issue("h1_missing", page.url, "The page has no H1 heading.")
    elif len(headings) > 1:
        yield _issue(
            "h1_multiple",
            page.url,
            f"The page has {len(headings)} H1 headings.",
            headings=headings,
        )


@per_page(
    RuleInfo(
        "canonical_missing",
        "medium",
        "Missing canonical tag",
        "Add a self-referencing rel=canonical link to every indexable page.",
    ),
    RuleInfo(
        "canonical_mismatch",
        "high",
        "Canonical points to a different URL",
        "Point the canonical at the page's own URL unless it is a deliberate duplicate.",
    ),
)
def check_canonical(page: Page, _: CrawlResult, __: AuditConfig) -> Iterator[Issue]:
    if page.noindex:
        return
    if not page.canonical:
        yield _issue("canonical_missing", page.url, "The page has no rel=canonical link.")
    elif page.canonical.rstrip("/") != page.url.rstrip("/"):
        yield _issue(
            "canonical_mismatch",
            page.url,
            f"Canonical points to {page.canonical}.",
            canonical=page.canonical,
        )


@per_page(
    RuleInfo(
        "noindex_in_sitemap",
        "critical",
        "Noindex on a page listed in the sitemap",
        "Remove the noindex directive, or drop the URL from the sitemap if it should stay hidden.",
    )
)
def check_noindex(page: Page, result: CrawlResult, _: AuditConfig) -> Iterator[Issue]:
    if page.noindex and page.url in result.sitemap_urls:
        yield _issue(
            "noindex_in_sitemap",
            page.url,
            "The page is in the sitemap but carries a noindex directive.",
            robots=page.robots,
        )


# --- content ----------------------------------------------------------------------


@per_page(
    RuleInfo(
        "thin_content",
        "medium",
        "Thin content",
        "Expand the page to answer the query fully, or consolidate it into a stronger page.",
    )
)
def check_thin_content(page: Page, _: CrawlResult, config: AuditConfig) -> Iterator[Issue]:
    if not page.noindex and page.word_count < config.thin_content_words:
        yield _issue(
            "thin_content",
            page.url,
            f"Only {page.word_count} words of main content.",
            word_count=page.word_count,
        )


@per_page(
    RuleInfo(
        "image_alt_missing",
        "low",
        "Images without alt text",
        'Describe each meaningful image in its alt attribute; use alt="" for decoration.',
    )
)
def check_image_alt(page: Page, _: CrawlResult, __: AuditConfig) -> Iterator[Issue]:
    missing = [image.src for image in page.images if image.alt is None]
    if missing:
        yield _issue(
            "image_alt_missing",
            page.url,
            f"{len(missing)} image(s) have no alt attribute.",
            images=missing[:20],
            count=len(missing),
        )


@per_page(
    RuleInfo(
        "structured_data_missing",
        "low",
        "Missing structured data",
        "Add JSON-LD (Product, Article or HowTo) so the page is eligible for rich results.",
    )
)
def check_structured_data(page: Page, _: CrawlResult, config: AuditConfig) -> Iterator[Issue]:
    page_type = classify_path(urlsplit(page.url).path).page_type
    if page_type in config.structured_data_page_types and not page.structured_data_types:
        yield _issue(
            "structured_data_missing",
            page.url,
            f"No JSON-LD structured data on a {page_type} page.",
            page_type=page_type,
        )


@per_page(
    RuleInfo(
        "open_graph_missing",
        "low",
        "Missing Open Graph tags",
        "Add og:title, og:description and og:image so shared links render a preview.",
    )
)
def check_open_graph(page: Page, _: CrawlResult, config: AuditConfig) -> Iterator[Issue]:
    missing = [tag for tag in config.required_open_graph if tag not in page.open_graph]
    if missing:
        yield _issue(
            "open_graph_missing",
            page.url,
            f"Missing Open Graph tags: {', '.join(missing)}.",
            missing=missing,
        )


# --- links ------------------------------------------------------------------------


@per_page(
    RuleInfo(
        "broken_internal_link",
        "high",
        "Broken internal links",
        "Update or remove links that point at pages returning an error.",
    ),
    RuleInfo(
        "redirect_chain",
        "medium",
        "Links through a redirect chain",
        "Link straight to the final URL and collapse chained redirects into one hop.",
    ),
)
def check_links(page: Page, result: CrawlResult, _: AuditConfig) -> Iterator[Issue]:
    broken: list[dict[str, object]] = []
    chained: list[dict[str, object]] = []
    for link in page.links:
        fetch = result.fetches.get(link.url) if link.internal else None
        if fetch is None:
            continue
        if fetch.status >= 400:
            broken.append({"url": link.url, "status": fetch.status})
        elif fetch.redirects >= 2:
            chained.append({"url": link.url, "chain": list(fetch.chain)})
    if broken:
        yield _issue(
            "broken_internal_link",
            page.url,
            f"{len(broken)} internal link(s) return an error.",
            links=broken,
        )
    if chained:
        yield _issue(
            "redirect_chain",
            page.url,
            f"{len(chained)} internal link(s) pass through two or more redirects.",
            links=chained,
        )


@per_page(
    RuleInfo(
        "insecure_link",
        "medium",
        "Non-HTTPS links",
        "Change http:// links to https:// to avoid redirects and mixed-content warnings.",
    )
)
def check_insecure_links(page: Page, _: CrawlResult, __: AuditConfig) -> Iterator[Issue]:
    insecure = sorted({link.raw for link in page.links if link.raw.lower().startswith("http://")})
    if insecure:
        yield _issue(
            "insecure_link",
            page.url,
            f"{len(insecure)} link(s) use http://.",
            links=insecure,
        )


@per_page(
    RuleInfo(
        "slow_response",
        "medium",
        "Slow server response",
        "Profile the template or add caching; aim for a response under 800 ms.",
    )
)
def check_slow_response(page: Page, _: CrawlResult, config: AuditConfig) -> Iterator[Issue]:
    if page.fetch.elapsed_ms > config.slow_response_ms:
        yield _issue(
            "slow_response",
            page.url,
            f"Responded in {page.fetch.elapsed_ms:.0f} ms.",
            elapsed_ms=page.fetch.elapsed_ms,
        )


# --- sitemap ----------------------------------------------------------------------


@site_rule(
    RuleInfo(
        "orphan_page",
        "medium",
        "Orphan pages",
        "Link to the page from a relevant hub or remove it from the sitemap.",
    ),
    RuleInfo(
        "sitemap_url_error",
        "high",
        "Sitemap lists a URL that does not resolve",
        "Remove dead or redirected URLs from the sitemap so it only lists live pages.",
    ),
)
def check_sitemap(result: CrawlResult, _: AuditConfig) -> Iterator[Issue]:
    for url in sorted(result.sitemap_urls):
        fetch = result.fetches.get(url)
        if fetch is None:
            continue
        if fetch.status >= 400 or fetch.redirects > 0:
            yield _issue(
                "sitemap_url_error",
                url,
                f"Sitemap URL returns {fetch.status}"
                + (f" after {fetch.redirects} redirect(s)." if fetch.redirects else "."),
                status=fetch.status,
                final_url=fetch.final_url,
            )
        elif url in result.pages and not (result.inlinks.get(url, set()) - {url}):
            yield _issue(
                "orphan_page",
                url,
                "The page is in the sitemap but no crawled page links to it.",
            )


def run_rules(result: CrawlResult, config: AuditConfig | None = None) -> list[Issue]:
    """Apply every rule and return issues in a stable order."""
    config = config or AuditConfig()
    issues = [issue for check in _CHECKS for issue in check(result, config)]
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(issues, key=lambda issue: (order[issue.severity], issue.rule, issue.url))

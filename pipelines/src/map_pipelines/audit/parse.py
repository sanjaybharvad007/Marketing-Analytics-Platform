"""Extract the audited facts from an HTML document."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from urllib.parse import urldefrag, urljoin

from bs4 import BeautifulSoup, Tag

from map_pipelines.audit.site import Fetch, Image, Link, Page

_BOILERPLATE = ("script", "style", "noscript", "template", "nav", "header", "footer", "aside")
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'\u2019-]*")
_SKIPPED_SCHEMES = ("mailto:", "tel:", "javascript:", "data:", "#")


def _text(tag: Tag | None) -> str:
    return " ".join(tag.get_text(" ", strip=True).split()) if tag else ""


def _attr(tag: Tag, name: str) -> str | None:
    value = tag.get(name)
    if isinstance(value, list):
        value = " ".join(value)
    return value.strip() if isinstance(value, str) else None


def _json_ld_types(soup: BeautifulSoup) -> list[str]:
    types: list[str] = []

    def collect(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                collect(item)
        elif isinstance(node, dict):
            declared = node.get("@type")
            for value in declared if isinstance(declared, list) else [declared]:
                if isinstance(value, str) and value not in types:
                    types.append(value)
            collect(node.get("@graph"))

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            collect(json.loads(script.string or ""))
        except json.JSONDecodeError:
            continue
    return types


def _word_count(soup: BeautifulSoup) -> int:
    """Words in the main content, ignoring navigation and other boilerplate."""
    root = soup.find("main") or soup.find("article") or soup.body or soup
    clone = BeautifulSoup(str(root), "html.parser")
    for tag in clone.find_all(_BOILERPLATE):
        tag.decompose()
    return len(_WORD.findall(clone.get_text(" ")))


def parse_page(
    url: str,
    fetch: Fetch,
    html: str,
    *,
    is_internal: Callable[[str], bool],
    to_public: Callable[[str], str],
) -> Page:
    """Build a Page from fetched HTML.

    `is_internal` decides whether an absolute URL belongs to the audited site;
    `to_public` rewrites a crawl-origin URL into its public form.
    """
    soup = BeautifulSoup(html, "html.parser")
    head = soup.head or soup
    page = Page(url=url, fetch=fetch)

    page.titles = [text for tag in head.find_all("title") if (text := _text(tag))]
    for meta in head.find_all("meta"):
        name = (_attr(meta, "name") or "").lower()
        prop = (_attr(meta, "property") or "").lower()
        content = _attr(meta, "content") or ""
        if name == "description" and page.meta_description is None:
            page.meta_description = content
        elif name == "robots":
            page.robots = content
        elif prop.startswith("og:") and content:
            page.open_graph.setdefault(prop, content)

    canonical = head.find("link", rel=lambda value: value and "canonical" in value)
    if isinstance(canonical, Tag) and (href := _attr(canonical, "href")):
        page.canonical = to_public(urljoin(url, href))

    page.h1 = [_text(tag) for tag in soup.find_all("h1")]
    page.word_count = _word_count(soup)
    page.structured_data_types = _json_ld_types(soup)
    page.images = [
        Image(src=_attr(img, "src") or "", alt=_attr(img, "alt")) for img in soup.find_all("img")
    ]

    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        raw = _attr(anchor, "href") or ""
        if not raw or raw.lower().startswith(_SKIPPED_SCHEMES):
            continue
        absolute, _ = urldefrag(urljoin(url, raw))
        if not absolute.lower().startswith(("http://", "https://")):
            continue
        internal = is_internal(absolute)
        target = to_public(absolute) if internal else absolute
        if (target, raw) in seen:
            continue
        seen.add((target, raw))
        page.links.append(Link(url=target, raw=raw, internal=internal))
    return page

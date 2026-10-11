"""Breadth-first site crawler with a concurrency limit and robots.txt support."""

from __future__ import annotations

import asyncio
import time
import xml.etree.ElementTree as ET
from urllib.parse import urldefrag, urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx

from map_pipelines.audit.parse import parse_page
from map_pipelines.audit.site import CrawlResult, Fetch
from map_pipelines.logs import get_logger

log = get_logger("audit.crawler")

USER_AGENT = "MAPAuditBot/1.0"
MAX_REDIRECTS = 8
_SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _bare_host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


class Crawler:
    """Crawl one site.

    `base_url` is where requests are sent. `public_origin` is the origin the
    site is published under; set it when crawling a staging or local copy so
    absolute links and canonicals to the public host count as internal and
    reported URLs use the public host.
    """

    def __init__(
        self,
        base_url: str,
        client: httpx.AsyncClient,
        *,
        public_origin: str | None = None,
        concurrency: int = 5,
        max_pages: int = 500,
        timeout: float = 15.0,
    ) -> None:
        self._crawl_origin = _origin(base_url)
        self._public_origin = _origin(public_origin) if public_origin else self._crawl_origin
        self._start = self.to_public(urldefrag(base_url).url)
        if not urlsplit(self._start).path:
            self._start += "/"
        self._client = client
        self._semaphore = asyncio.Semaphore(concurrency)
        self._max_pages = max_pages
        self._timeout = timeout
        self._robots = RobotFileParser()
        self._robots.parse([])

    # --- URL mapping --------------------------------------------------------

    def is_internal(self, url: str) -> bool:
        return _bare_host(url) in {_bare_host(self._crawl_origin), _bare_host(self._public_origin)}

    def to_public(self, url: str) -> str:
        parts = urlsplit(url)
        public = urlsplit(self._public_origin)
        return urlunsplit((public.scheme, public.netloc, parts.path or "/", parts.query, ""))

    def _to_crawl(self, url: str) -> str:
        parts = urlsplit(url)
        crawl = urlsplit(self._crawl_origin)
        return urlunsplit((crawl.scheme, crawl.netloc, parts.path or "/", parts.query, ""))

    def _allowed(self, url: str) -> bool:
        return self._robots.can_fetch(USER_AGENT, urlsplit(url).path or "/")

    # --- fetching -------------------------------------------------------------

    async def _get(self, url: str) -> httpx.Response:
        async with self._semaphore:
            return await self._client.get(
                self._to_crawl(url),
                headers={"User-Agent": USER_AGENT},
                follow_redirects=False,
                timeout=self._timeout,
            )

    async def _fetch(self, url: str) -> tuple[Fetch, str | None]:
        """Request `url`, following internal redirects manually to record the chain."""
        chain = [url]
        current = url
        try:
            while True:
                started = time.perf_counter()
                response = await self._get(current)
                elapsed_ms = (time.perf_counter() - started) * 1000
                location = response.headers.get("location")
                if response.is_redirect and location and len(chain) <= MAX_REDIRECTS:
                    target, _ = urldefrag(urljoin(current, location))
                    if not self.is_internal(target):
                        chain.append(target)
                        return self._fetched(url, response.status_code, chain, elapsed_ms), None
                    current = self.to_public(target)
                    if current in chain:
                        chain.append(current)
                        return (
                            self._fetched(url, 508, chain, elapsed_ms, error="redirect loop"),
                            None,
                        )
                    chain.append(current)
                    continue
                content_type = response.headers.get("content-type", "")
                html = (
                    response.text
                    if response.status_code == 200 and "html" in content_type.lower()
                    else None
                )
                return (
                    self._fetched(url, response.status_code, chain, elapsed_ms, content_type),
                    html,
                )
        except httpx.HTTPError as error:
            return self._fetched(
                url, 599, chain, 0.0, error=f"{type(error).__name__}: {error}"
            ), None

    @staticmethod
    def _fetched(
        url: str,
        status: int,
        chain: list[str],
        elapsed_ms: float,
        content_type: str = "",
        error: str | None = None,
    ) -> Fetch:
        return Fetch(
            url=url,
            status=status,
            final_url=chain[-1],
            chain=tuple(chain),
            elapsed_ms=round(elapsed_ms, 1),
            content_type=content_type,
            error=error,
        )

    async def _load_robots(self) -> list[str]:
        """Parse robots.txt and return the sitemap URLs it declares."""
        try:
            response = await self._get(self._public_origin + "/robots.txt")
        except httpx.HTTPError:
            return []
        if response.status_code != 200:
            return []
        self._robots.parse(response.text.splitlines())
        return list(self._robots.site_maps() or [])

    async def _load_sitemap(self, url: str, depth: int = 0) -> set[str]:
        try:
            response = await self._get(url)
        except httpx.HTTPError:
            return set()
        if response.status_code != 200:
            return set()
        try:
            root = ET.fromstring(response.content)
        except ET.ParseError:
            log.warning("sitemap is not valid XML", extra={"url": url})
            return set()
        locations = {(element.text or "").strip() for element in root.iter(f"{_SITEMAP_NS}loc")} - {
            ""
        }
        if root.tag == f"{_SITEMAP_NS}sitemapindex" and depth == 0:
            nested = await asyncio.gather(
                *(self._load_sitemap(self.to_public(loc), depth + 1) for loc in locations)
            )
            return set().union(*nested)
        return {self.to_public(loc) for loc in locations if self.is_internal(loc)}

    # --- crawl ----------------------------------------------------------------

    async def crawl(self) -> CrawlResult:
        result = CrawlResult(site_url=self._public_origin)
        sitemaps = await self._load_robots() or [self._public_origin + "/sitemap.xml"]
        for sitemap in sitemaps:
            result.sitemap_urls |= await self._load_sitemap(self.to_public(sitemap))

        queued: set[str] = set()
        frontier: list[str] = []

        def enqueue(url: str) -> None:
            if url in queued:
                return
            if not self._allowed(url):
                result.skipped_by_robots.add(url)
                return
            if len(queued) >= self._max_pages:
                return
            queued.add(url)
            frontier.append(url)

        enqueue(self._start)
        for url in sorted(result.sitemap_urls):
            enqueue(url)

        while frontier:
            batch, frontier[:] = list(frontier), []
            fetched = await asyncio.gather(*(self._fetch(url) for url in batch))
            for url, (fetch, html) in zip(batch, fetched, strict=True):
                result.fetches[url] = fetch
                if html is None or fetch.final_url != url:
                    # Redirect targets are queued and parsed under their own URL.
                    if fetch.ok and self.is_internal(fetch.final_url):
                        enqueue(fetch.final_url)
                    continue
                page = parse_page(
                    url, fetch, html, is_internal=self.is_internal, to_public=self.to_public
                )
                result.pages[url] = page
                for link in page.links:
                    if not link.internal:
                        continue
                    result.inlinks.setdefault(link.url, set()).add(url)
                    enqueue(link.url)

        log.info(
            "crawl finished",
            extra={
                "pages": len(result.pages),
                "requests": len(result.fetches),
                "sitemap_urls": len(result.sitemap_urls),
                "robots_skipped": len(result.skipped_by_robots),
            },
        )
        return result

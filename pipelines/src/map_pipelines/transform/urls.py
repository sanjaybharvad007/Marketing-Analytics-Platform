"""URL normalisation so that GA4 paths, GSC URLs and SEO-tool URLs join on one key."""

from __future__ import annotations

import posixpath
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PARAMS = frozenset(
    {"gclid", "gbraid", "wbraid", "fbclid", "msclkid", "mc_cid", "mc_eid", "srsltid", "_ga", "_gl"}
)
_TRACKING_PREFIXES = ("utm_",)
_FILE_EXTENSION = re.compile(r"\.[a-z0-9]{2,5}$")


class ForeignUrlError(ValueError):
    """The URL belongs to a different site than the one being tracked."""


def _bare_host(host: str) -> str:
    return host.lower().removeprefix("www.")


def _clean_path(path: str) -> str:
    path = path.strip() or "/"
    if not path.startswith("/"):
        path = "/" + path
    trailing = path.endswith("/")
    path = posixpath.normpath(re.sub(r"/{2,}", "/", path)).lower()
    if path == "/":
        return path
    if trailing or not _FILE_EXTENSION.search(path):
        path += "/"
    return path


def _clean_query(query: str) -> str:
    kept = [
        (key, value)
        for key, value in parse_qsl(query, keep_blank_values=False)
        if key.lower() not in TRACKING_PARAMS and not key.lower().startswith(_TRACKING_PREFIXES)
    ]
    return urlencode(sorted(kept))


def normalize_url(raw: str, site_url: str) -> str:
    """Return the canonical absolute URL for a path or URL on the tracked site.

    - accepts a bare path ("/blog/post") or an absolute URL in any scheme/host casing
    - forces the scheme and host of `site_url` (www and non-www are the same site)
    - lower-cases the path, collapses duplicate slashes and adds a trailing slash
      to extension-less paths
    - drops fragments and tracking parameters, sorts the remaining parameters

    Raises ForeignUrlError when the URL points at another host.
    """
    site = urlsplit(site_url)
    value = raw.strip()
    if not value:
        raise ValueError("empty URL")

    if value.startswith("/"):
        parts = urlsplit(value)
        path, query = parts.path, parts.query
    else:
        if "://" not in value:
            value = "https://" + value
        parts = urlsplit(value)
        if _bare_host(parts.hostname or "") != _bare_host(site.hostname or ""):
            raise ForeignUrlError(f"{raw!r} is not on {site.hostname}")
        path, query = parts.path, parts.query

    return urlunsplit((site.scheme, site.netloc, _clean_path(path), _clean_query(query), ""))


def url_path(url: str) -> str:
    """Path component of a normalised URL, including any kept query string."""
    parts = urlsplit(url)
    return f"{parts.path}?{parts.query}" if parts.query else parts.path


def is_local_origin(url: str) -> bool:
    """True for loopback addresses and single-label hosts such as a container name.

    Such a URL is a local copy of a site, never the address it is published under.
    """
    host = (urlsplit(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"} or (host != "" and "." not in host)

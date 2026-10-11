"""Serve the static demo site, over HTTP for `map audit` and in-process for seeding and tests.

Besides plain files the site directory holds `_server.json`, which declares
redirects and artificial response delays so the audit has redirect chains and
a slow page to find.
"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from map_pipelines.config import PIPELINES_ROOT

DEFAULT_SITE_DIR = PIPELINES_ROOT / "demo_site"
_NOT_FOUND = (
    b"<!doctype html><html lang='en'><head><title>Page not found</title></head>"
    b"<body><h1>Page not found</h1></body></html>"
)


@dataclass(frozen=True)
class SiteResponse:
    status: int
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)
    delay: float = 0.0


class StaticSite:
    def __init__(self, root: Path = DEFAULT_SITE_DIR) -> None:
        self.root = root.resolve()
        if not self.root.is_dir():
            raise FileNotFoundError(f"demo site directory not found: {self.root}")
        config_path = self.root / "_server.json"
        config = json.loads(config_path.read_text("utf-8")) if config_path.is_file() else {}
        self._redirects: dict[str, str] = config.get("redirects", {})
        self._delays: dict[str, float] = config.get("delays", {})

    def respond(self, raw_path: str) -> SiteResponse:
        path = urlsplit(raw_path).path or "/"
        delay = float(self._delays.get(path, 0.0))
        if path in self._redirects:
            return SiteResponse(301, headers={"Location": self._redirects[path]}, delay=delay)

        relative = path.lstrip("/")
        candidate = (self.root / relative).resolve()
        if path.endswith("/") or candidate.is_dir():
            candidate = candidate / "index.html"
        inside_root = candidate.is_relative_to(self.root)
        if not inside_root or not candidate.is_file() or candidate.name.startswith("_"):
            return SiteResponse(
                404, _NOT_FOUND, {"Content-Type": "text/html; charset=utf-8"}, delay
            )
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type.endswith("xml"):
            content_type += "; charset=utf-8"
        return SiteResponse(200, candidate.read_bytes(), {"Content-Type": content_type}, delay)


def transport(site: StaticSite) -> httpx.MockTransport:
    """An httpx transport that answers from the site directory without a socket."""

    async def handler(request: httpx.Request) -> httpx.Response:
        response = site.respond(request.url.path)
        if response.delay:
            await asyncio.sleep(response.delay)
        return httpx.Response(response.status, headers=response.headers, content=response.body)

    return httpx.MockTransport(handler)


def make_server(site: StaticSite, host: str, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "MAPDemoSite/1.0"

        def do_GET(self) -> None:
            response = site.respond(self.path)
            if response.delay:
                time.sleep(response.delay)
            self.send_response(response.status)
            for name, value in response.headers.items():
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(response.body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response.body)

        do_HEAD = do_GET

        def log_message(self, format: str, *args: object) -> None:
            pass  # keep the terminal quiet; the crawler logs what it fetched

    return ThreadingHTTPServer((host, port), Handler)

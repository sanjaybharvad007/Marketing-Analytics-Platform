"""SEO-tool data from CSV exports ("organic keywords" reports) and the demo generator.

SEO suites change their export headers from time to time, so the column
mapping is data: two presets ship here and a custom mapping can be supplied as
JSON (see docs/pipelines.md).
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field, fields
from datetime import date, datetime
from pathlib import Path
from typing import Any

from map_pipelines.demo.seo import domain_rows, keyword_rows
from map_pipelines.demo.world import DemoWorld
from map_pipelines.logs import get_logger
from map_pipelines.models import DateWindow, Mode
from map_pipelines.sources.base import SourceNotConfigured

log = get_logger("sources.seo_csv")

_FILENAME_DATE = re.compile(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})")
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
_INTENTS = ("informational", "commercial", "transactional", "navigational")
DOMAIN_METRICS_PREFIX = "domain-metrics"


@dataclass(frozen=True)
class ColumnMapping:
    """Which CSV header holds which field. Optional fields may be None."""

    keyword: str
    position: str
    url: str
    search_volume: str | None = None
    difficulty: str | None = None
    cpc: str | None = None
    intent: str | None = None
    serp_features: str | None = None
    date: str | None = None
    date_formats: tuple[str, ...] = field(default=("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y"))

    @classmethod
    def from_json(cls, text: str) -> ColumnMapping:
        raw = json.loads(text)
        allowed = {item.name for item in fields(cls)}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"unknown mapping keys: {sorted(unknown)}")
        if "date_formats" in raw:
            raw["date_formats"] = tuple(raw["date_formats"])
        return cls(**raw)


PRESETS: dict[str, ColumnMapping] = {
    "semrush": ColumnMapping(
        keyword="Keyword",
        position="Position",
        url="URL",
        search_volume="Search Volume",
        difficulty="Keyword Difficulty",
        cpc="CPC",
        intent="Keyword Intents",
        serp_features="SERP Features by Keyword",
        date="Timestamp",
    ),
    "ahrefs": ColumnMapping(
        keyword="Keyword",
        position="Current position",
        url="Current URL",
        search_volume="Volume",
        difficulty="KD",
        cpc="CPC",
        serp_features="SERP features",
        date="Current date",
    ),
}


def resolve_mapping(preset_or_path: str) -> ColumnMapping:
    """Return a preset by name, or load a mapping from a JSON file path."""
    if preset_or_path in PRESETS:
        return PRESETS[preset_or_path]
    path = Path(preset_or_path)
    if path.is_file():
        return ColumnMapping.from_json(path.read_text(encoding="utf-8"))
    raise ValueError(
        f"{preset_or_path!r} is neither a preset ({', '.join(PRESETS)}) nor a mapping file"
    )


def decode_export(data: bytes) -> str:
    """Decode an export; some tools write UTF-16 with a BOM, most write UTF-8."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    return data.decode("utf-8-sig")


def _delimiter(sample: str) -> str:
    """Pick the delimiter by counting candidates in the header line."""
    header = sample.splitlines()[0] if sample else ""
    counts = {delimiter: header.count(delimiter) for delimiter in (",", "\t", ";")}
    best = max(counts, key=lambda key: counts[key])
    return best if counts[best] else ","


def _number(value: str | None) -> float | None:
    if value is None:
        return None
    match = _NUMBER.search(value.replace(",", ""))
    return float(match.group(0)) if match else None


def _position(value: str | None) -> int | None:
    """A ranking position from 1 to 100; anything else means "not ranking".

    Tools write "100+" or ">100" for keywords outside the tracked depth.
    """
    if value is None or "+" in value or ">" in value:
        return None
    number = _number(value)
    if number is None or number < 1 or number > 100:
        return None
    return round(number)


def _intent(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.lower()
    return next((intent for intent in _INTENTS if intent in lowered), None)


def _features(value: str | None) -> list[str]:
    """Split a SERP-features cell on commas, semicolons or pipes into snake_case names."""
    if not value:
        return []
    cleaned = (
        re.sub(r"[^a-z0-9]+", "_", part.strip().lower()).strip("_")
        for part in re.split(r"[,;|]", value)
    )
    return list(dict.fromkeys(part for part in cleaned if part))


def _date(value: str | None, formats: Iterable[str]) -> date | None:
    if not value:
        return None
    text = value.strip()
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def date_from_filename(name: str) -> date | None:
    match = _FILENAME_DATE.search(name)
    if not match:
        return None
    try:
        return date(*(int(part) for part in match.groups()))
    except ValueError:
        return None


def read_keyword_csv(
    text: str, mapping: ColumnMapping, default_date: date
) -> Iterator[dict[str, Any]]:
    """Yield normalised ranking rows from the text of a keyword export.

    Rows without a keyword are skipped. A row's date comes from the mapped
    date column when present and parseable, otherwise `default_date`.
    """
    reader = csv.DictReader(io.StringIO(text), delimiter=_delimiter(text))
    headers = [header.strip() for header in (reader.fieldnames or [])]
    reader.fieldnames = headers
    for required in (mapping.keyword, mapping.position, mapping.url):
        if required not in headers:
            raise ValueError(f"column {required!r} not found; export has {headers}")

    def cell(row: dict[str, str], column: str | None) -> str | None:
        if column is None:
            return None
        value = row.get(column)
        return value.strip() if isinstance(value, str) else None

    for row in reader:
        keyword = (cell(row, mapping.keyword) or "").lower()
        if not keyword:
            continue
        position = _position(cell(row, mapping.position))
        volume = _number(cell(row, mapping.search_volume))
        difficulty = _number(cell(row, mapping.difficulty))
        yield {
            "date": _date(cell(row, mapping.date), mapping.date_formats) or default_date,
            "keyword": keyword,
            "position": position,
            "url": (cell(row, mapping.url) or None) if position is not None else None,
            "search_volume": round(volume) if volume is not None and volume >= 0 else 0,
            "difficulty": (
                min(round(difficulty), 100) if difficulty is not None and difficulty >= 0 else None
            ),
            "cpc": _number(cell(row, mapping.cpc)),
            "intent": _intent(cell(row, mapping.intent)),
            "serp_features": _features(cell(row, mapping.serp_features)),
        }


def read_domain_metrics_csv(text: str, own_domain: str) -> Iterator[dict[str, Any]]:
    """Yield domain metric rows from a CSV with date, domain, authority_score,
    referring_domains and backlinks columns."""
    reader = csv.DictReader(io.StringIO(text), delimiter=_delimiter(text))
    for row in reader:
        domain = (row.get("domain") or "").strip().lower().removeprefix("www.")
        day = _date(row.get("date"), ("%Y-%m-%d",))
        if not domain or day is None:
            continue
        yield {
            "date": day,
            "domain": domain,
            "is_own": domain == own_domain.lower().removeprefix("www."),
            "authority_score": round(_number(row.get("authority_score")) or 0),
            "referring_domains": round(_number(row.get("referring_domains")) or 0),
            "backlinks": round(_number(row.get("backlinks")) or 0),
        }


class SeoDemoSource:
    name = "seo"
    mode: Mode = "demo"

    def __init__(self, world: DemoWorld) -> None:
        self._world = world

    def fetch(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        for day in window.dates():
            yield from keyword_rows(self._world, day)

    def fetch_domain_metrics(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        for day in window.dates():
            yield from domain_rows(self._world, day)


class SeoCsvSource:
    """Reads every keyword export in a directory whose date falls in the window.

    A file's date is taken from its name (for example
    `organic-keywords-2026-10-01.csv`); rows may override it through the mapped
    date column. Files named `domain-metrics*.csv` hold domain authority data.
    """

    name = "seo"
    mode: Mode = "live"

    def __init__(self, export_dir: Path, mapping: ColumnMapping, own_domain: str) -> None:
        if not export_dir.is_dir():
            raise SourceNotConfigured(f"SEO_EXPORT_DIR does not exist: {export_dir}")
        self._dir = export_dir
        self._mapping = mapping
        self._own_domain = own_domain

    def _files(self) -> list[Path]:
        return sorted(self._dir.glob("*.csv"))

    def fetch(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        for path in self._files():
            if path.name.startswith(DOMAIN_METRICS_PREFIX):
                continue
            file_date = date_from_filename(path.name)
            if file_date is None:
                log.warning("skipping export without a date in its name", extra={"file": path.name})
                continue
            if not window.start <= file_date <= window.end:
                continue
            text = decode_export(path.read_bytes())
            for row in read_keyword_csv(text, self._mapping, file_date):
                if window.start <= row["date"] <= window.end:
                    yield row

    def fetch_domain_metrics(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        for path in self._files():
            if not path.name.startswith(DOMAIN_METRICS_PREFIX):
                continue
            text = decode_export(path.read_bytes())
            for row in read_domain_metrics_csv(text, self._own_domain):
                if window.start <= row["date"] <= window.end:
                    yield row


class SeoRowsSource:
    """Rows that were already parsed, for a one-off import of a single export."""

    name = "seo"
    mode: Mode = "live"

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def fetch(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        return [row for row in self._rows if window.start <= row["date"] <= window.end]

    def fetch_domain_metrics(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        return []

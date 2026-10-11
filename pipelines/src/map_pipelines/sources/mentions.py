"""Parse an answer-engine response for brand mentions, citations and sentiment.

The parser is deliberately simple and deterministic: regular expressions over
the answer text, no model calls. It answers four questions about one answer:
was the brand named, in what order relative to tracked competitors, was a URL
on the brand's domain cited, and was the tone around the brand positive,
neutral or negative.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import urlsplit

_URL = re.compile(r"https?://[^\s<>\[\]()\"']+", re.IGNORECASE)
_MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[*])|\n+")
_TRAILING_PUNCTUATION = ".,;:!?)'\""
# A "Sources:" label left with nothing after it once the links are removed.
_EMPTY_SOURCE_LIST = re.compile(
    r"\s*\b(?:sources?|references?|citations?)\s*:(?:[\s,;]|\[\d+\])*$", re.IGNORECASE
)

_POSITIVE = frozenset(
    """
    recommend recommended recommends best excellent great reliable durable trusted
    favorite favourite standout outstanding top quality well-made well-regarded praised
    popular impressive solid strong generous affordable comfortable leading loved
    dependable
    """.split()
)
_NEGATIVE = frozenset(
    """
    avoid poor worst unreliable disappointing overpriced complaints complaint flimsy
    mixed slow inconsistent problem problems issues defective lacking mediocre expensive
    criticized criticised weak cheaply
    """.split()
)
_NEGATIONS = frozenset(
    {"not", "no", "never", "n't", "isn't", "aren't", "wasn't", "don't", "hardly"}
)
_WORD = re.compile(r"[a-z]+(?:[-'][a-z]+)*")


@dataclass(frozen=True)
class TrackedBrand:
    name: str
    domain: str
    aliases: tuple[str, ...] = ()

    @property
    def terms(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys((self.name, *self.aliases)))


@dataclass(frozen=True)
class AnswerAnalysis:
    brand_mentioned: bool
    brand_rank: int | None
    cited: bool
    cited_url: str | None
    sentiment: str | None
    competitors_mentioned: tuple[str, ...]
    answer_excerpt: str


def _term_pattern(term: str) -> re.Pattern[str]:
    """Regex for one brand term, tolerant of spacing, hyphens and "&"/"and"."""
    pieces: list[str] = []
    for token in re.findall(r"&|[^\s&\-]+", term):
        if token == "&" or token.lower() == "and":
            pieces.append(r"(?:&|and|\+)")
        else:
            pieces.append(re.escape(token).replace(r"\'", "['\u2019]?"))
    body = r"[\s\-]*".join(pieces)
    return re.compile(rf"(?<![\w]){body}(?![\w])", re.IGNORECASE)


def _first_mention(text: str, brand: TrackedBrand) -> int | None:
    offsets = [match.start() for term in brand.terms if (match := _term_pattern(term).search(text))]
    return min(offsets) if offsets else None


def extract_urls(text: str) -> list[str]:
    """All http(s) URLs in the answer, in order, without trailing punctuation."""
    urls: list[str] = []
    for match in _URL.finditer(text):
        url = match.group(0).rstrip(_TRAILING_PUNCTUATION)
        if url not in urls:
            urls.append(url)
    return urls


def _on_domain(url: str, domain: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    domain = domain.lower().removeprefix("www.")
    return host == domain or host.endswith("." + domain)


def strip_links(text: str) -> str:
    """Remove URLs (keeping markdown link labels) so hostnames do not count as mentions."""
    without_markdown = _MARKDOWN_LINK.sub(lambda match: match.group(1), text)
    return _URL.sub(" ", without_markdown)


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in _SENTENCE_BREAK.split(text) if part.strip()]


def _sentence_score(sentence: str) -> int:
    words = _WORD.findall(sentence.lower())
    score = 0
    for index, word in enumerate(words):
        polarity = (word in _POSITIVE) - (word in _NEGATIVE)
        if polarity == 0:
            continue
        window = words[max(0, index - 3) : index]
        if any(prior in _NEGATIONS or prior.endswith("n't") for prior in window):
            polarity = -polarity
        score += polarity
    return score


def brand_sentiment(text: str, brand: TrackedBrand) -> str | None:
    """Tone of the sentences that name the brand; None when it is not named."""
    patterns = [_term_pattern(term) for term in brand.terms]
    relevant = [
        sentence
        for sentence in _sentences(text)
        if any(pattern.search(sentence) for pattern in patterns)
    ]
    if not relevant:
        return None
    score = sum(_sentence_score(sentence) for sentence in relevant)
    if score > 0:
        return "positive"
    if score < 0:
        return "negative"
    return "neutral"


def _excerpt(text: str, focus: int | None, limit: int) -> str:
    collapsed = _EMPTY_SOURCE_LIST.sub("", re.sub(r"\s+", " ", text).strip())
    if len(collapsed) <= limit:
        return collapsed
    start = 0
    if focus is not None and focus > limit // 2:
        # Offsets shift slightly after collapsing whitespace; close enough for an excerpt.
        start = min(focus - limit // 3, len(collapsed) - limit)
        start = collapsed.rfind(" ", 0, start) + 1
    end = collapsed.rfind(" ", start, start + limit)
    if end <= start:
        end = start + limit
    prefix = "… " if start > 0 else ""
    suffix = " …" if end < len(collapsed) else ""
    return f"{prefix}{collapsed[start:end]}{suffix}"


def analyse_answer(
    text: str,
    brand: TrackedBrand,
    competitors: Sequence[TrackedBrand],
    *,
    excerpt_chars: int = 600,
) -> AnswerAnalysis:
    """Analyse one answer for the brand and the tracked competitors."""
    prose = strip_links(text)
    brand_offset = _first_mention(prose, brand)

    competitor_offsets = [
        (offset, competitor.name)
        for competitor in competitors
        if (offset := _first_mention(prose, competitor)) is not None
    ]
    competitor_offsets.sort()

    brand_rank = None
    if brand_offset is not None:
        brand_rank = 1 + sum(1 for offset, _ in competitor_offsets if offset < brand_offset)

    cited_url = next((url for url in extract_urls(text) if _on_domain(url, brand.domain)), None)

    return AnswerAnalysis(
        brand_mentioned=brand_offset is not None,
        brand_rank=brand_rank,
        cited=cited_url is not None,
        cited_url=cited_url,
        sentiment=brand_sentiment(prose, brand),
        competitors_mentioned=tuple(name for _, name in competitor_offsets),
        answer_excerpt=_excerpt(
            prose if brand_offset is not None else text, brand_offset, excerpt_chars
        ),
    )

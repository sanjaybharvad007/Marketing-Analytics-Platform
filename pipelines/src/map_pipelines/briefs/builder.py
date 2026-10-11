"""Build a structured content brief from search data.

`heuristic_brief` is a pure function of its inputs and always available.
`build_brief` asks the configured LLM for the same structure and falls back to
the heuristic when no provider is configured or the reply cannot be validated.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

from map_pipelines.llm import Generated, LLMProvider, generate_structured

Intent = Literal["informational", "commercial", "transactional", "navigational"]

_STOPWORDS = frozenset(
    """
    a an and are as at be best by can do does for from how i in is it my of on or should
    the to vs what when where which who why with you your near me
    """.split()
)
_QUESTION = re.compile(r"^(how|what|why|when|where|who|which|do|does|is|are|can|should)\b")
_TOKEN = re.compile(r"[a-z0-9]+")
_LONE_I = re.compile(r"\bi\b")
_SUPERLATIVE = re.compile(r"^(best|top|cheap|cheapest|good)\s+")
_WORD_COUNT = {
    "guide": 1800,
    "article": 1500,
    "category": 600,
    "product": 500,
    "landing": 700,
    "home": 500,
    "store": 400,
    "other": 800,
}
SYSTEM_PROMPT = (
    "You are a senior content strategist. You write briefs a writer can follow without "
    "further research. Use only the search data provided; do not invent statistics."
)


class OutlineSection(BaseModel):
    heading: str = Field(min_length=2, max_length=160)
    subheadings: list[str] = Field(default_factory=list, max_length=8)


class InternalLink(BaseModel):
    url: str
    title: str
    reason: str = Field(max_length=240)


class RankingSnapshot(BaseModel):
    position: float | None = None
    url: str | None = None
    search_volume: int | None = None


class ContentBrief(BaseModel):
    primary_keyword: str = Field(min_length=1, max_length=200)
    secondary_keywords: list[str] = Field(default_factory=list, max_length=12)
    working_titles: list[str] = Field(min_length=1, max_length=5)
    search_intent: Intent
    intent_summary: str = Field(min_length=10, max_length=600)
    outline: list[OutlineSection] = Field(min_length=3, max_length=12)
    questions: list[str] = Field(default_factory=list, max_length=10)
    entities: list[str] = Field(default_factory=list, max_length=20)
    internal_links: list[InternalLink] = Field(default_factory=list, max_length=6)
    meta_description: str = Field(min_length=20, max_length=170)
    target_word_count: int = Field(ge=200, le=6000)
    current_ranking: RankingSnapshot = Field(default_factory=RankingSnapshot)


@dataclass(frozen=True)
class RelatedQuery:
    query: str
    impressions: int = 0
    clicks: int = 0
    position: float | None = None


@dataclass(frozen=True)
class CandidatePage:
    url: str
    title: str
    clicks: int = 0
    page_type: str = "other"


@dataclass(frozen=True)
class BriefInputs:
    title: str
    target_keyword: str
    intent: Intent
    page_type: str
    target_url: str | None = None
    related_queries: Sequence[RelatedQuery] = field(default_factory=tuple)
    candidate_pages: Sequence[CandidatePage] = field(default_factory=tuple)
    ranking: RankingSnapshot = field(default_factory=RankingSnapshot)
    brand_name: str = "our store"


def tokens(text: str) -> list[str]:
    """Lower-case content words, with trivial plural folding."""
    words = [word for word in _TOKEN.findall(text.lower()) if word not in _STOPWORDS]
    return [word[:-1] if len(word) > 3 and word.endswith("s") else word for word in words]


def _title_case(text: str) -> str:
    small = {"a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "vs", "with"}
    words = text.split()
    return " ".join(
        word if word in small and index else word[:1].upper() + word[1:]
        for index, word in enumerate(words)
    )


def _sentence(text: str) -> str:
    text = text.strip()
    return text[:1].upper() + text[1:]


def _as_heading(query: str) -> str:
    """Turn a question-shaped search query into a heading.

    Queries are typed in lower case and without punctuation: "what size tent
    do i need". "How to ..." reads as a heading without a question mark; the
    other forms get one.
    """
    text = _sentence(_LONE_I.sub("I", query.strip().rstrip("?")))
    return text if text.lower().startswith("how to ") else text + "?"


def _topic(keyword: str) -> str:
    """The keyword without a leading superlative: "best hiking boots" -> "hiking boots"."""
    return _SUPERLATIVE.sub("", keyword).strip() or keyword


def _overlap(left: Sequence[str], right: Sequence[str]) -> int:
    return len(set(left) & set(right))


def rank_related(keyword: str, queries: Sequence[RelatedQuery]) -> list[RelatedQuery]:
    """Related queries sharing a content word with the keyword, most relevant first."""
    key_tokens = tokens(keyword)
    scored = [
        (_overlap(key_tokens, tokens(query.query)), query.impressions, query)
        for query in queries
        if query.query.lower() != keyword.lower()
    ]
    relevant = [item for item in scored if item[0] > 0]
    relevant.sort(key=lambda item: (-item[0], -item[1], item[2].query))
    return [query for _, _, query in relevant]


def pick_internal_links(inputs: BriefInputs, limit: int = 4) -> list[InternalLink]:
    """Choose existing pages on the same topic, favouring ones that already earn clicks."""
    key_tokens = tokens(f"{inputs.target_keyword} {inputs.title}")
    scored: list[tuple[int, int, CandidatePage]] = []
    for page in inputs.candidate_pages:
        if inputs.target_url and page.url.rstrip("/") == inputs.target_url.rstrip("/"):
            continue
        shared = _overlap(key_tokens, tokens(f"{page.title} {page.url.rsplit('/', 2)[-2]}"))
        if shared:
            scored.append((shared, page.clicks, page))
    scored.sort(key=lambda item: (-item[0], -item[1], item[2].url))
    links: list[InternalLink] = []
    for shared, _, page in scored[:limit]:
        role = (
            "product or category page to convert"
            if page.page_type in ("product", "category")
            else "supporting reading"
        )
        links.append(
            InternalLink(
                url=page.url,
                title=page.title,
                reason=f"Shares {shared} topic term(s) with the target keyword; {role}.",
            )
        )
    return links


def _working_titles(keyword: str, intent: Intent, page_type: str) -> list[str]:
    subject = _title_case(keyword)
    if _QUESTION.match(keyword.lower()):
        return [f"{subject}: A Practical Guide", f"{subject}? What to Know First", subject]
    if intent == "commercial":
        return [
            f"{subject}: How to Pick the Right One",
            f"{subject} Compared: What Matters and What Doesn't",
            f"{subject} Buying Guide",
        ]
    if intent == "transactional" or page_type in ("category", "product"):
        return [f"{subject}", f"Shop {subject}", f"{subject}: Sizes, Specs and Prices"]
    return [
        f"{subject}: A Complete Guide",
        f"{subject} Explained",
        f"Everything You Need to Know About {subject}",
    ]


def _outline(
    keyword: str, intent: Intent, questions: list[str], modifiers: list[str]
) -> list[OutlineSection]:
    subject = _title_case(keyword)
    topic = _topic(keyword)
    sections = [OutlineSection(heading=f"What to know about {topic}")]
    if intent in ("commercial", "transactional"):
        sections.append(
            OutlineSection(
                heading=f"How to compare {topic}",
                subheadings=[_title_case(modifier) for modifier in modifiers[:4]]
                or ["Key specifications", "Price ranges", "Fit and sizing"],
            )
        )
        sections.append(OutlineSection(heading=f"Our recommended {topic}"))
    else:
        sections.append(
            OutlineSection(
                heading=f"{subject} step by step",
                subheadings=[_title_case(modifier) for modifier in modifiers[:4]],
            )
        )
        sections.append(OutlineSection(heading="Common mistakes to avoid"))
    for question in questions[:3]:
        sections.append(OutlineSection(heading=question))
    sections.append(
        OutlineSection(heading="Frequently asked questions", subheadings=questions[3:6])
    )
    return sections


def _intent_summary(keyword: str, intent: Intent) -> str:
    return {
        "informational": f"Searchers want to understand {keyword} and leave able to act on it. "
        "Lead with a direct answer, then depth.",
        "commercial": f"Searchers are comparing options for {keyword} before buying. "
        "They need criteria, trade-offs and specific recommendations.",
        "transactional": f"Searchers are ready to buy {keyword}. "
        "Make products, prices and availability visible immediately.",
        "navigational": f"Searchers are looking for a specific destination for {keyword}. "
        "Confirm they are in the right place and route them onward.",
    }[intent]


def _meta_description(keyword: str, intent: Intent, brand: str) -> str:
    text = {
        "informational": f"Learn {keyword} with clear steps, common mistakes to avoid and "
        "answers to the questions hikers ask most.",
        "commercial": f"Compare {keyword} by weight, durability and price, with tested picks "
        "and advice on choosing the right one for your trips.",
        "transactional": f"Shop {keyword} at {brand}. Free returns, expert fit "
        "advice and gear tested on the trail.",
        "navigational": f"Find {keyword} at {brand}, with opening hours, services "
        "and what is in stock.",
    }[intent]
    return text if len(text) <= 160 else text[:157].rsplit(" ", 1)[0] + "..."


def heuristic_brief(inputs: BriefInputs) -> ContentBrief:
    """Deterministic brief built from the related queries and candidate pages."""
    keyword = inputs.target_keyword.strip().lower() or inputs.title.lower()
    related = rank_related(keyword, inputs.related_queries)
    key_tokens = set(tokens(keyword))

    questions = [
        _as_heading(query.query) for query in related if _QUESTION.match(query.query.lower())
    ]
    # Terms that keep appearing next to the keyword in related searches.
    term_counts: Counter[str] = Counter()
    for query in related:
        for token in tokens(query.query):
            if token not in key_tokens and not token.isdigit():
                term_counts[token] += max(query.impressions, 1)
    entities = [term for term, _ in term_counts.most_common(10)]
    modifiers = [query.query for query in related if not _QUESTION.match(query.query.lower())]

    words = _WORD_COUNT.get(inputs.page_type, 800)
    if inputs.ranking.position is None or inputs.ranking.position > 10:
        words = round(words * 1.2 / 50) * 50  # not on page one yet: go deeper

    return ContentBrief(
        primary_keyword=keyword,
        secondary_keywords=[query.query for query in related[:8]],
        working_titles=_working_titles(keyword, inputs.intent, inputs.page_type),
        search_intent=inputs.intent,
        intent_summary=_intent_summary(_topic(keyword), inputs.intent),
        outline=_outline(keyword, inputs.intent, questions, modifiers),
        questions=questions[:8],
        entities=entities,
        internal_links=pick_internal_links(inputs),
        meta_description=_meta_description(_topic(keyword), inputs.intent, inputs.brand_name),
        target_word_count=words,
        current_ranking=inputs.ranking,
    )


def build_prompt(inputs: BriefInputs) -> str:
    related = rank_related(inputs.target_keyword, inputs.related_queries)[:20]
    lines = [
        f'Write a content brief for a {inputs.page_type} page titled "{inputs.title}".',
        f"Primary keyword: {inputs.target_keyword}",
        f"Search intent: {inputs.intent}",
    ]
    if inputs.ranking.position is not None:
        lines.append(
            f"The site currently ranks at position {inputs.ranking.position:.0f} "
            f"with {inputs.ranking.url}."
        )
    lines.append("\nRelated queries from Search Console (query | impressions | avg position):")
    lines += [
        f"- {query.query} | {query.impressions} | "
        f"{'n/a' if query.position is None else f'{query.position:.1f}'}"
        for query in related
    ] or ["- none available"]
    lines.append("\nExisting pages you may choose internal links from (url | title):")
    lines += [f"- {page.url} | {page.title}" for page in inputs.candidate_pages[:40]] or ["- none"]
    lines.append(
        "\nInternal links must use URLs from the list above. "
        "The meta description must be at most 160 characters."
    )
    return "\n".join(lines)


def build_brief(provider: LLMProvider, inputs: BriefInputs) -> Generated[ContentBrief]:
    """LLM-written brief when a provider is configured, heuristic otherwise.

    Links an LLM invents are dropped; if none of its links are real pages the
    heuristic's link choices are used instead.
    """
    generated = generate_structured(
        provider,
        system=SYSTEM_PROMPT,
        prompt=build_prompt(inputs),
        schema=ContentBrief,
        fallback=lambda: heuristic_brief(inputs),
        max_tokens=2500,
    )
    if generated.source == "heuristic":
        return generated
    known = {page.url for page in inputs.candidate_pages}
    links = [link for link in generated.value.internal_links if link.url in known]
    brief = generated.value.model_copy(
        update={
            "internal_links": links or pick_internal_links(inputs),
            "current_ranking": inputs.ranking,
        }
    )
    return Generated(brief, "llm")

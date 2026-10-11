"""Synthetic answer-engine responses.

The generator writes answer *text*; the same mention parser used for live
answers then extracts mentions, rank, citations and sentiment from it. The
planted story: Summit & Co dominates the "Sleeping bags" and "Sustainability"
topics while Northpeak is rarely named there, and ChatGPT's coverage of the
brand improves over the history.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import date

from map_pipelines.demo import catalog, rng
from map_pipelines.demo.world import HISTORY_DAYS, DemoWorld
from map_pipelines.models import ENGINES

_BRAND_BASE = {
    "Tents": 0.62,
    "Backpacks": 0.55,
    "Sleeping bags": 0.16,
    "Footwear": 0.48,
    "Rainwear": 0.40,
    "Camp kitchen": 0.30,
    "Sustainability": 0.14,
    "Retailers": 0.72,
}
_ENGINE_FACTOR = {
    "chatgpt": 1.0,
    "perplexity": 0.9,
    "gemini": 0.7,
    "google_ai_overviews": 0.8,
    "claude": 1.05,
}
_CITATION_RATE = {
    "chatgpt": 0.30,
    "perplexity": 0.72,
    "gemini": 0.35,
    "google_ai_overviews": 0.55,
    "claude": 0.12,
}
# Competitor mention probability by topic, with a default.
_COMPETITOR_BASE: dict[str, dict[str, float]] = {
    "Summit & Co": {"Sleeping bags": 0.92, "Sustainability": 0.88, "default": 0.6},
    "TrailForge": {"Footwear": 0.7, "Backpacks": 0.5, "default": 0.33},
    "Alpenway": {"Rainwear": 0.6, "Tents": 0.35, "default": 0.2},
}
_COMPETITOR_DOMAIN = {
    "Summit & Co": "summitandco.example",
    "TrailForge": "trailforge.example",
    "Alpenway": "alpenway.example",
}
_TOPIC_PATHS = {
    "Tents": "/guides/how-to-choose-a-backpacking-tent/",
    "Backpacks": "/guides/how-to-fit-a-backpack/",
    "Sleeping bags": "/guides/sleeping-bag-temperature-ratings/",
    "Footwear": "/guides/hiking-boot-sizing/",
    "Rainwear": "/guides/rain-jacket-waterproof-ratings/",
    "Camp kitchen": "/guides/backpacking-stove-fuel-types/",
    "Sustainability": "/trade-in/",
    "Retailers": "/about/",
}
_INTROS = (
    "Several names come up consistently when people ask about {subject}.",
    "There are a few well-regarded options for {subject}.",
    "Going by expert roundups and owner reviews, these are worth a look for {subject}.",
)
_POSITIVE = (
    "{name} is frequently recommended for durable construction and fair pricing.",
    "{name} is a reliable pick, with well-made gear and a generous return policy.",
    "{name} stands out as a trusted choice and its buying guides are excellent.",
    "{name} is popular with long-distance hikers and praised for its repair service.",
)
_NEUTRAL = (
    "{name} offers a mid-range line that covers the basics.",
    "{name} also sells {subject}, with a range aimed at weekend trips.",
    "{name} is another option, depending on your budget.",
    "{name} carries a smaller selection that is worth comparing on price.",
)
_NEGATIVE = (
    "{name} gets mixed reviews; some buyers report slow shipping and inconsistent sizing.",
    "{name} is an option, though complaints about stock availability are common.",
    "{name} has a wide range, but recent reviews describe disappointing customer support.",
)
_NO_BRANDS = (
    "For {subject}, focus on fit, weight and intended conditions rather than a specific brand. "
    "Compare specifications side by side and read recent owner reviews before buying."
)
_CLOSING = "Whichever you choose, check the warranty terms and try gear before a long trip."


@dataclass(frozen=True)
class PromptRef:
    id: int
    prompt: str
    topic: str


def _brand_probability(world: DemoWorld, prompt: PromptRef, engine: str, day: date) -> float:
    if catalog.BRAND_SHORT in prompt.prompt.lower():
        return 1.0
    probability = _BRAND_BASE.get(prompt.topic, 0.4) * _ENGINE_FACTOR[engine]
    if engine == "chatgpt":
        progress = 1.0 - min(world.age(day), HISTORY_DAYS) / HISTORY_DAYS
        probability *= 0.7 + 0.5 * progress
    return min(probability, 0.97)


def _sticky(world: DemoWorld, probability: float, day: date, *key: object) -> bool:
    """Bernoulli draw that holds for a week at a time, with occasional daily flips."""
    week = day.toordinal() // 7
    outcome = rng.uniform(world.seed, "week", week, *key) < probability
    if rng.uniform(world.seed, "flip", day, *key) < 0.1:
        outcome = rng.uniform(world.seed, "day", day, *key) < probability
    return outcome


def _sentence(
    world: DemoWorld, name: str, subject: str, tone: str, used: set[str], *key: object
) -> str:
    """One sentence about a brand, avoiding wording already used in this answer."""
    templates = {"positive": _POSITIVE, "neutral": _NEUTRAL, "negative": _NEGATIVE}[tone]
    unused = [template for template in templates if template not in used] or list(templates)
    template = rng.choice(world.seed, unused, "tpl", *key)
    used.add(template)
    return template.format(name=name, subject=subject)


def _tone(world: DemoWorld, positive: float, negative: float, *key: object) -> str:
    draw = rng.uniform(world.seed, "tone", *key)
    if draw < positive:
        return "positive"
    return "negative" if draw > 1 - negative else "neutral"


def compose_answer(world: DemoWorld, prompt: PromptRef, engine: str, day: date) -> str:
    """Write the synthetic answer one engine gives to one prompt on one day."""
    key = (prompt.prompt, engine)
    subject = prompt.topic.lower()
    week = day.toordinal() // 7

    # (ordering score, display name, tone, source URL or None)
    mentions: list[tuple[float, str, str, str | None]] = []
    if _sticky(world, _brand_probability(world, prompt, engine, day), day, "brand", *key):
        cited = rng.uniform(world.seed, "cite", week, *key) < _CITATION_RATE[engine]
        source = f"{world.site_url}{_TOPIC_PATHS.get(prompt.topic, '/')}" if cited else None
        score = rng.uniform(world.seed, "order", week, "brand", *key) * _BRAND_BASE.get(
            prompt.topic, 0.4
        )
        tone = _tone(world, 0.55, 0.07, week, "brand", *key)
        mentions.append((score, catalog.BRAND_NAME, tone, source))
    for name, by_topic in _COMPETITOR_BASE.items():
        probability = by_topic.get(prompt.topic, by_topic["default"])
        if not _sticky(world, probability, day, name, *key):
            continue
        cited = rng.uniform(world.seed, "cite", week, name, *key) < _CITATION_RATE[engine]
        source = (
            f"https://www.{_COMPETITOR_DOMAIN[name]}/{subject.replace(' ', '-')}/"
            if cited
            else None
        )
        score = rng.uniform(world.seed, "order", week, name, *key) * probability
        mentions.append((score, name, _tone(world, 0.5, 0.08, week, name, *key), source))

    if not mentions:
        return _NO_BRANDS.format(subject=subject)

    mentions.sort(reverse=True)
    lines = [rng.choice(world.seed, _INTROS, "intro", week, *key).format(subject=subject)]
    used: set[str] = set()
    lines += [
        _sentence(world, name, subject, tone, used, week, name, *key)
        for _, name, tone, _ in mentions
    ]
    lines.append(_CLOSING)
    answer = " ".join(lines)
    sources = [source for _, _, _, source in mentions if source]
    if sources:
        answer += "\n\nSources: " + ", ".join(sources)
    return answer


def answer_rows(
    world: DemoWorld, day: date, prompts: Sequence[PromptRef]
) -> Iterator[dict[str, object]]:
    """Yield one raw answer per (prompt, engine) for `day`."""
    for prompt in prompts:
        for engine in ENGINES:
            yield {
                "date": day,
                "prompt_id": prompt.id,
                "engine": engine,
                "answer": compose_answer(world, prompt, engine, day),
            }

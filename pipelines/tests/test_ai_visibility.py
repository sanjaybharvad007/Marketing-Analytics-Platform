from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

import httpx
import pytest

from map_pipelines.config import Settings
from map_pipelines.demo import catalog
from map_pipelines.demo.ai import PromptRef, answer_rows
from map_pipelines.demo.world import DemoWorld
from map_pipelines.etl.transforms import to_ai_records
from map_pipelines.llm.base import LLMError
from map_pipelines.models import DateWindow
from map_pipelines.sources.ai_visibility import (
    AiVisibilityDemoSource,
    AiVisibilityLiveSource,
    build_engines,
)
from map_pipelines.sources.base import SourceNotConfigured
from map_pipelines.sources.mentions import TrackedBrand

PROMPTS = [PromptRef(index, p.prompt, p.topic) for index, p in enumerate(catalog.AI_PROMPTS, 1)]


def _records(world: DemoWorld, brand: TrackedBrand, competitors, days: int = 14):
    rows = [
        row
        for offset in range(1, days + 1)
        for row in answer_rows(world, world.anchor - timedelta(days=offset), PROMPTS)
    ]
    records, rejected = to_ai_records(rows, brand, competitors)
    assert rejected == 0
    return records


def test_demo_answers_parse_into_valid_records(world, brand, competitors) -> None:
    records = _records(world, brand, competitors, days=3)
    assert len(records) == 3 * 40 * 5
    mentioned = [record for record in records if record.brand_mentioned]
    assert mentioned
    assert all(record.brand_rank is not None for record in mentioned)
    assert all(record.sentiment is not None for record in mentioned)
    assert all(
        record.cited_url.startswith("https://www.northpeak.example/")
        for record in records
        if record.cited
    )


def test_demo_data_carries_the_visibility_gap(world, brand, competitors) -> None:
    """Summit & Co dominates sleeping-bag prompts while Northpeak is rarely named."""
    topic_of = {prompt.id: prompt.topic for prompt in PROMPTS}
    records = [
        r for r in _records(world, brand, competitors) if topic_of[r.prompt_id] == "Sleeping bags"
    ]
    brand_rate = sum(r.brand_mentioned for r in records) / len(records)
    summit_rate = sum("Summit & Co" in r.competitors_mentioned for r in records) / len(records)
    assert brand_rate < 0.3
    assert summit_rate > 0.75


def test_prompts_naming_the_brand_always_mention_it(world, brand, competitors) -> None:
    named = {prompt.id for prompt in PROMPTS if "northpeak" in prompt.prompt.lower()}
    assert named
    records = [r for r in _records(world, brand, competitors, days=5) if r.prompt_id in named]
    assert all(record.brand_mentioned for record in records)


def test_demo_answers_do_not_repeat_a_sentence_for_two_brands(world) -> None:
    """Each brand in one answer is described in different words."""
    day = world.anchor - timedelta(days=1)
    names = ("Northpeak Outfitters", "Summit & Co", "TrailForge", "Alpenway")
    checked = 0
    for row in answer_rows(world, day, PROMPTS):
        body = str(row["answer"]).split("\n\nSources:")[0]
        sentences = [part for part in body.split(". ") if part.startswith(names)]
        patterns = []
        for sentence in sentences:
            name = next(name for name in names if sentence.startswith(name))
            patterns.append(sentence.removeprefix(name))
        if len(patterns) >= 2:
            checked += 1
            assert len(set(patterns)) == len(patterns), row["answer"]
    assert checked > 50


def test_every_engine_is_covered(world, brand, competitors) -> None:
    counts = Counter(record.engine for record in _records(world, brand, competitors, days=1))
    assert set(counts) == {"chatgpt", "perplexity", "gemini", "google_ai_overviews", "claude"}


def test_demo_source_yields_one_row_per_prompt_engine_day(world) -> None:
    window = DateWindow(start=date(2026, 5, 20), end=date(2026, 5, 21))
    rows = list(AiVisibilityDemoSource(world, PROMPTS[:3]).fetch(window))
    assert len(rows) == 2 * 3 * 5


class FakeProvider:
    name = "fake"

    def __init__(self, answer: str | None) -> None:
        self._answer = answer
        self.prompts: list[str] = []

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        self.prompts.append(prompt)
        if self._answer is None:
            raise LLMError("rate limited")
        return self._answer


def test_live_source_asks_each_engine_each_prompt_and_dates_rows_at_window_end() -> None:
    engines = {
        "chatgpt": FakeProvider("Northpeak is great."),
        "claude": FakeProvider("Try Alpenway."),
    }
    window = DateWindow(start=date(2026, 5, 29), end=date(2026, 5, 31))
    rows = list(AiVisibilityLiveSource(engines, PROMPTS[:2]).fetch(window))
    assert len(rows) == 4
    assert {row["date"] for row in rows} == {date(2026, 5, 31)}
    assert engines["chatgpt"].prompts == [PROMPTS[0].prompt, PROMPTS[1].prompt]


def test_live_source_skips_a_failing_engine() -> None:
    engines = {"chatgpt": FakeProvider(None), "claude": FakeProvider("Northpeak.")}
    window = DateWindow(start=date(2026, 5, 31), end=date(2026, 5, 31))
    rows = list(AiVisibilityLiveSource(engines, PROMPTS[:2]).fetch(window))
    assert [row["engine"] for row in rows] == ["claude", "claude"]


def test_live_source_fails_when_nothing_answered() -> None:
    window = DateWindow(start=date(2026, 5, 31), end=date(2026, 5, 31))
    source = AiVisibilityLiveSource({"chatgpt": FakeProvider(None)}, PROMPTS[:1])
    with pytest.raises(LLMError, match="no engine returned"):
        list(source.fetch(window))


def test_live_source_requires_an_engine() -> None:
    with pytest.raises(SourceNotConfigured):
        AiVisibilityLiveSource({}, PROMPTS)


def test_build_engines_only_includes_configured_ones() -> None:
    assert build_engines(Settings(_env_file=None)) == {}
    settings = Settings(
        _env_file=None,
        ai_engine_perplexity_api_key="k",
        ai_engine_perplexity_model="m",
        ai_engine_claude_api_key="k",
        ai_engine_claude_model="m",
        ai_engine_gemini_api_key="k",  # no model: stays disabled
    )
    assert set(build_engines(settings, client=httpx.Client())) == {"perplexity", "claude"}

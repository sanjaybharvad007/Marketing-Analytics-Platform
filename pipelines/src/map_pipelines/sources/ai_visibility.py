"""AI visibility: ask answer engines the tracked prompts and keep their raw answers."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import httpx

from map_pipelines.config import Settings
from map_pipelines.demo.ai import PromptRef, answer_rows
from map_pipelines.demo.world import DemoWorld
from map_pipelines.llm.anthropic import AnthropicProvider
from map_pipelines.llm.base import LLMError, LLMProvider
from map_pipelines.llm.openai_compat import OpenAICompatibleProvider
from map_pipelines.logs import get_logger
from map_pipelines.models import DateWindow, Mode
from map_pipelines.sources.base import SourceNotConfigured

log = get_logger("sources.ai_visibility")


class AiVisibilityDemoSource:
    name = "ai_visibility"
    mode: Mode = "demo"

    def __init__(self, world: DemoWorld, prompts: Sequence[PromptRef]) -> None:
        self._world = world
        self._prompts = prompts

    def fetch(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        for day in window.dates():
            yield from answer_rows(self._world, day, self._prompts)


def build_engines(settings: Settings, client: httpx.Client | None = None) -> dict[str, LLMProvider]:
    """Engines with credentials configured.

    ChatGPT, Perplexity and Gemini are reached through their OpenAI-compatible
    chat endpoints, Claude through the Messages API. Google AI Overviews has
    no public API and therefore no live connector.
    """
    engines: dict[str, LLMProvider] = {}
    timeout = settings.llm_timeout_seconds
    compatible = {
        "chatgpt": (
            settings.ai_engine_chatgpt_api_key,
            settings.ai_engine_chatgpt_model,
            settings.ai_engine_chatgpt_base_url,
        ),
        "perplexity": (
            settings.ai_engine_perplexity_api_key,
            settings.ai_engine_perplexity_model,
            settings.ai_engine_perplexity_base_url,
        ),
        "gemini": (
            settings.ai_engine_gemini_api_key,
            settings.ai_engine_gemini_model,
            settings.ai_engine_gemini_base_url,
        ),
    }
    for engine, (api_key, model, base_url) in compatible.items():
        if api_key and model:
            engines[engine] = OpenAICompatibleProvider(
                api_key, model, base_url=base_url, timeout=timeout, client=client
            )
    if settings.ai_engine_claude_api_key and settings.ai_engine_claude_model:
        engines["claude"] = AnthropicProvider(
            settings.ai_engine_claude_api_key,
            settings.ai_engine_claude_model,
            base_url=settings.anthropic_base_url,
            timeout=timeout,
            client=client,
        )
    return engines


class AiVisibilityLiveSource:
    """Asks every configured engine every active prompt.

    An engine can only be asked "now", so all rows carry the window's end date
    regardless of how long the window is. A failing engine is logged and
    skipped; the run fails only when no engine answered anything.
    """

    name = "ai_visibility"
    mode: Mode = "live"

    def __init__(self, engines: Mapping[str, LLMProvider], prompts: Sequence[PromptRef]) -> None:
        if not engines:
            raise SourceNotConfigured(
                "No answer engine is configured; set AI_ENGINE_<NAME>_API_KEY and _MODEL"
            )
        self._engines = engines
        self._prompts = prompts

    def fetch(self, window: DateWindow) -> Iterable[dict[str, Any]]:
        answered = 0
        failures = 0
        for prompt in self._prompts:
            for engine, provider in self._engines.items():
                try:
                    answer = provider.complete(prompt.prompt, max_tokens=700)
                except LLMError as error:
                    failures += 1
                    log.warning(
                        "engine did not answer",
                        extra={"engine": engine, "prompt_id": prompt.id, "error": str(error)},
                    )
                    continue
                answered += 1
                yield {
                    "date": window.end,
                    "prompt_id": prompt.id,
                    "engine": engine,
                    "answer": answer,
                }
        if self._prompts and answered == 0:
            raise LLMError(f"no engine returned an answer ({failures} failures)")

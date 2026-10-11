"""Build the configured provider from settings."""

from __future__ import annotations

import httpx

from map_pipelines.config import Settings
from map_pipelines.llm.anthropic import AnthropicProvider
from map_pipelines.llm.base import LLMProvider, OfflineProvider
from map_pipelines.llm.openai_compat import OpenAICompatibleProvider


def build_provider(settings: Settings, client: httpx.Client | None = None) -> LLMProvider:
    """Return the provider selected by LLM_PROVIDER (offline when unset)."""
    if settings.llm_provider == "anthropic":
        return AnthropicProvider(
            settings.anthropic_api_key,
            settings.anthropic_model,
            base_url=settings.anthropic_base_url,
            timeout=settings.llm_timeout_seconds,
            client=client,
        )
    if settings.llm_provider == "openai":
        return OpenAICompatibleProvider(
            settings.openai_api_key,
            settings.openai_model,
            base_url=settings.openai_base_url,
            timeout=settings.llm_timeout_seconds,
            client=client,
        )
    return OfflineProvider()

"""Provider protocol and the offline provider."""

from __future__ import annotations

from typing import Protocol


class LLMError(RuntimeError):
    """The provider could not produce a usable completion."""


class LLMProvider(Protocol):
    name: str

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        """Return the model's text reply to a single user prompt."""
        ...


class OfflineProvider:
    """No model at all.

    Callers pass a deterministic heuristic as the fallback to
    `generate_structured` / `generate_text`; with this provider the heuristic
    is always what runs, so every script works without an API key.
    """

    name = "offline"

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        raise LLMError("the offline provider does not generate text")

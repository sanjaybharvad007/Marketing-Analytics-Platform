"""Anthropic Messages API over plain HTTP."""

from __future__ import annotations

import httpx

from map_pipelines.llm.base import LLMError
from map_pipelines.retry import with_retry

API_VERSION = "2023-06-01"


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        base_url: str = "https://api.anthropic.com",
        timeout: float = 60.0,
        client: httpx.Client | None = None,
        max_attempts: int = 3,
    ) -> None:
        if not api_key:
            raise LLMError("ANTHROPIC_API_KEY is not set")
        self._api_key = api_key
        self._model = model
        self._url = f"{base_url.rstrip('/')}/v1/messages"
        self._client = client or httpx.Client(timeout=timeout)
        self._max_attempts = max_attempts

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        body: dict[str, object] = {
            "model": self._model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            body["system"] = system

        def send() -> httpx.Response:
            response = self._client.post(
                self._url,
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": API_VERSION,
                    "content-type": "application/json",
                },
                json=body,
            )
            response.raise_for_status()
            return response

        try:
            response = with_retry(
                send, attempts=self._max_attempts, description="anthropic.messages"
            )
            blocks = response.json().get("content", [])
        except (httpx.HTTPError, ValueError) as error:
            raise LLMError(f"Anthropic request failed: {error}") from error

        text = "".join(
            block.get("text", "")
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        )
        if not text.strip():
            raise LLMError("Anthropic returned no text content")
        return text

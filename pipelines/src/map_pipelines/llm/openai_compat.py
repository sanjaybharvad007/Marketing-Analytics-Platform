"""Chat Completions API as implemented by OpenAI and compatible services."""

from __future__ import annotations

import httpx

from map_pipelines.llm.base import LLMError
from map_pipelines.retry import with_retry


class OpenAICompatibleProvider:
    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        base_url: str = "https://api.openai.com/v1",
        timeout: float = 60.0,
        client: httpx.Client | None = None,
        max_attempts: int = 3,
    ) -> None:
        if not api_key:
            raise LLMError("OPENAI_API_KEY is not set")
        if not model:
            raise LLMError("OPENAI_MODEL is not set")
        self._api_key = api_key
        self._model = model
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._client = client or httpx.Client(timeout=timeout)
        self._max_attempts = max_attempts

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        def send() -> httpx.Response:
            response = self._client.post(
                self._url,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"model": self._model, "messages": messages, "max_tokens": max_tokens},
            )
            response.raise_for_status()
            return response

        try:
            response = with_retry(send, attempts=self._max_attempts, description="openai.chat")
            choices = response.json().get("choices") or []
            text = choices[0]["message"]["content"] if choices else ""
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            raise LLMError(f"Chat completion request failed: {error}") from error

        if not isinstance(text, str) or not text.strip():
            raise LLMError("Chat completion returned no text content")
        return text

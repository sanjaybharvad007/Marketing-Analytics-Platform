"""LLM providers against a mocked transport, and the structured-output helper."""

from __future__ import annotations

import json

import httpx
import pytest
from pydantic import BaseModel, Field

from map_pipelines.config import Settings
from map_pipelines.llm import (
    LLMError,
    OfflineProvider,
    build_provider,
    generate_structured,
    generate_text,
)
from map_pipelines.llm.anthropic import AnthropicProvider
from map_pipelines.llm.openai_compat import OpenAICompatibleProvider
from map_pipelines.llm.structured import extract_json


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_anthropic_request_and_response() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "text", "text": "Hello"},
                    {"type": "tool_use", "id": "x", "name": "t", "input": {}},
                    {"type": "text", "text": " world"},
                ]
            },
        )

    provider = AnthropicProvider("sk-test", "claude-sonnet-5-5", client=_client(handler))
    assert provider.complete("Hi", system="Be brief", max_tokens=50) == "Hello world"
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["headers"]["x-api-key"] == "sk-test"
    assert seen["headers"]["anthropic-version"] == "2023-06-01"
    assert seen["body"] == {
        "model": "claude-sonnet-5-5",
        "max_tokens": 50,
        "system": "Be brief",
        "messages": [{"role": "user", "content": "Hi"}],
    }


def test_anthropic_omits_system_when_not_given() -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]})

    AnthropicProvider("k", "m", client=_client(handler)).complete("Hi")
    assert "system" not in bodies[0]


def test_anthropic_http_error_becomes_llm_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"type": "authentication_error"}})

    provider = AnthropicProvider("bad", "m", client=_client(handler), max_attempts=1)
    with pytest.raises(LLMError, match="401"):
        provider.complete("Hi")


def test_anthropic_empty_content_is_an_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"content": []})

    with pytest.raises(LLMError, match="no text"):
        AnthropicProvider("k", "m", client=_client(handler)).complete("Hi")


def test_anthropic_requires_a_key() -> None:
    with pytest.raises(LLMError, match="ANTHROPIC_API_KEY"):
        AnthropicProvider("", "m")


def test_openai_compatible_request_and_response() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200, json={"choices": [{"message": {"role": "assistant", "content": "Hi!"}}]}
        )

    provider = OpenAICompatibleProvider(
        "sk-o", "some-model", base_url="https://llm.internal.example/v1/", client=_client(handler)
    )
    assert provider.complete("Hello", system="sys", max_tokens=10) == "Hi!"
    assert seen["url"] == "https://llm.internal.example/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-o"
    assert seen["body"] == {
        "model": "some-model",
        "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "Hello"}],
        "max_tokens": 10,
    }


def test_openai_compatible_malformed_response() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    provider = OpenAICompatibleProvider("k", "m", client=_client(handler))
    with pytest.raises(LLMError, match="no text"):
        provider.complete("Hi")


def test_openai_compatible_requires_a_model() -> None:
    with pytest.raises(LLMError, match="OPENAI_MODEL"):
        OpenAICompatibleProvider("k", "")


def test_build_provider_follows_settings() -> None:
    assert build_provider(Settings(_env_file=None)).name == "offline"
    anthropic = Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="k")
    assert build_provider(anthropic, client=httpx.Client()).name == "anthropic"
    openai = Settings(_env_file=None, llm_provider="openai", openai_api_key="k", openai_model="m")
    assert build_provider(openai, client=httpx.Client()).name == "openai"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('{"a": 1}', {"a": 1}),
        ('Here you go:\n```json\n{"a": [1, 2]}\n```\nAnything else?', {"a": [1, 2]}),
        ('Note {not json} then {"a": {"b": "}"}} trailing', {"a": {"b": "}"}}),
        ("[1, 2]", [1, 2]),
    ],
)
def test_extract_json(text: str, expected: object) -> None:
    assert extract_json(text) == expected


def test_extract_json_without_json_raises() -> None:
    with pytest.raises(ValueError, match="no JSON"):
        extract_json("I could not do that.")


class Verdict(BaseModel):
    label: str = Field(min_length=1)
    score: int = Field(ge=0, le=10)


class ScriptedProvider:
    name = "scripted"

    def __init__(self, *replies: str | Exception) -> None:
        self._replies = list(replies)
        self.prompts: list[str] = []

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        self.prompts.append(prompt)
        reply = self._replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def _fallback() -> Verdict:
    return Verdict(label="heuristic", score=5)


def test_structured_valid_first_reply() -> None:
    provider = ScriptedProvider('{"label": "good", "score": 8}')
    result = generate_structured(provider, prompt="Rate it", schema=Verdict, fallback=_fallback)
    assert (result.value.label, result.source) == ("good", "llm")
    assert "JSON Schema" in provider.prompts[0]


def test_structured_repairs_once_with_the_validation_error() -> None:
    provider = ScriptedProvider('{"label": "good", "score": 99}', '{"label": "good", "score": 9}')
    result = generate_structured(provider, prompt="Rate it", schema=Verdict, fallback=_fallback)
    assert (result.value.score, result.source) == (9, "llm")
    assert len(provider.prompts) == 2
    assert "rejected" in provider.prompts[1]
    assert '"score": 99' in provider.prompts[1]


def test_structured_falls_back_after_two_invalid_replies() -> None:
    provider = ScriptedProvider("not json", '{"label": "", "score": 1}')
    result = generate_structured(provider, prompt="Rate it", schema=Verdict, fallback=_fallback)
    assert (result.value.label, result.source) == ("heuristic", "heuristic")
    assert len(provider.prompts) == 2


def test_structured_falls_back_on_provider_error_without_retrying() -> None:
    provider = ScriptedProvider(LLMError("503"))
    result = generate_structured(provider, prompt="Rate it", schema=Verdict, fallback=_fallback)
    assert result.source == "heuristic"
    assert len(provider.prompts) == 1


def test_offline_provider_always_uses_the_heuristic() -> None:
    result = generate_structured(OfflineProvider(), prompt="x", schema=Verdict, fallback=_fallback)
    assert result.source == "heuristic"
    with pytest.raises(LLMError):
        OfflineProvider().complete("x")


def test_generate_text_paths() -> None:
    assert (
        generate_text(ScriptedProvider("  Fine week. "), prompt="x", fallback=lambda: "h").value
        == "Fine week."
    )
    failed = generate_text(ScriptedProvider(LLMError("x")), prompt="x", fallback=lambda: "h")
    assert (failed.value, failed.source) == ("h", "heuristic")
    assert generate_text(OfflineProvider(), prompt="x", fallback=lambda: "h").source == "heuristic"

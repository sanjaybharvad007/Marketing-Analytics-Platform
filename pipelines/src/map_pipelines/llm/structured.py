"""Ask a provider for JSON, validate it with pydantic, repair once, then fall back."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ValidationError

from map_pipelines.llm.base import LLMError, LLMProvider
from map_pipelines.logs import get_logger

log = get_logger("llm")
M = TypeVar("M", bound=BaseModel)
T = TypeVar("T")


@dataclass(frozen=True)
class Generated(Generic[T]):
    value: T
    source: Literal["llm", "heuristic"]


def extract_json(text: str) -> object:
    """Parse the first JSON object or array in a model reply.

    Tolerates code fences and prose around the JSON. Raises ValueError when
    no parseable JSON value is found.
    """
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char not in "{[":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        return value
    raise ValueError("no JSON object found in the reply")


def _json_instructions(schema: type[BaseModel]) -> str:
    return (
        "\n\nReply with a single JSON object and nothing else. It must validate against "
        f"this JSON Schema:\n{json.dumps(schema.model_json_schema(), separators=(',', ':'))}"
    )


def generate_structured(
    provider: LLMProvider,
    *,
    prompt: str,
    schema: type[M],
    fallback: Callable[[], M],
    system: str | None = None,
    max_tokens: int = 2000,
) -> Generated[M]:
    """Return a validated `schema` instance from the provider, or the fallback.

    One repair attempt is made when the first reply is not valid; any provider
    error or a second invalid reply yields the heuristic fallback instead.
    """
    if provider.name == "offline":
        return Generated(fallback(), "heuristic")

    request = prompt + _json_instructions(schema)
    reply = ""
    for attempt in (1, 2):
        try:
            reply = provider.complete(request, system=system, max_tokens=max_tokens)
            return Generated(schema.model_validate(extract_json(reply)), "llm")
        except LLMError as error:
            log.warning("llm call failed, using heuristic", extra={"error": str(error)})
            break
        except (ValueError, ValidationError) as error:
            log.warning(
                "llm reply failed validation",
                extra={"attempt": attempt, "error": str(error)[:300]},
            )
            request = (
                f"{prompt}{_json_instructions(schema)}\n\nYour previous reply was:\n{reply}\n\n"
                f"It was rejected: {str(error)[:800]}\nReply again with only the corrected JSON."
            )
    return Generated(fallback(), "heuristic")


def generate_text(
    provider: LLMProvider,
    *,
    prompt: str,
    fallback: Callable[[], str],
    system: str | None = None,
    max_tokens: int = 800,
) -> Generated[str]:
    """Return free text from the provider, or the heuristic fallback on any failure."""
    if provider.name == "offline":
        return Generated(fallback(), "heuristic")
    try:
        return Generated(
            provider.complete(prompt, system=system, max_tokens=max_tokens).strip(), "llm"
        )
    except LLMError as error:
        log.warning("llm call failed, using heuristic", extra={"error": str(error)})
        return Generated(fallback(), "heuristic")

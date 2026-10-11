"""Retry with exponential backoff for transient failures."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

import httpx
import psycopg

from map_pipelines.logs import get_logger

T = TypeVar("T")
log = get_logger("retry")

RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


class TransientError(Exception):
    """Raise from a connector to request a retry."""


def is_transient(error: BaseException) -> bool:
    if isinstance(error, TransientError | httpx.TransportError | TimeoutError):
        return True
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in RETRYABLE_STATUS
    if isinstance(error, psycopg.OperationalError):
        return True
    # google-api-core errors expose `.code`; treat rate limits and 5xx as transient
    # without importing the optional dependency.
    code = getattr(error, "code", None)
    status = getattr(getattr(error, "resp", None), "status", None)
    for candidate in (code, status):
        try:
            if int(candidate) in RETRYABLE_STATUS:
                return True
        except (TypeError, ValueError):
            continue
    return False


def with_retry(
    operation: Callable[[], T],
    *,
    attempts: int = 4,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    sleep: Callable[[float], None] = time.sleep,
    description: str = "operation",
) -> T:
    """Run `operation`, retrying transient errors with exponential backoff.

    Non-transient errors and the final failed attempt propagate unchanged.
    """
    if attempts < 1:
        raise ValueError("attempts must be at least 1")
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as error:
            if attempt == attempts or not is_transient(error):
                raise
            delay = min(max_delay, base_delay * 2 ** (attempt - 1))
            log.warning(
                "transient error, retrying",
                extra={
                    "what": description,
                    "attempt": attempt,
                    "delay_s": delay,
                    "error": repr(error),
                },
            )
            sleep(delay)
    raise AssertionError("unreachable")

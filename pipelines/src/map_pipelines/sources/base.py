"""The contract every connector implements."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, Protocol, runtime_checkable

from map_pipelines.models import DateWindow, Mode

RawRow = Mapping[str, Any]


class SourceNotConfigured(RuntimeError):
    """A live source was requested but its credentials or settings are missing."""


@runtime_checkable
class Source(Protocol):
    """Yields raw rows for an inclusive date window.

    Rows are plain mappings in the vocabulary of the upstream API or export;
    the pipeline's transform step validates and normalises them. Demo and live
    implementations of one source yield the same shape so that everything
    downstream of `fetch` is shared.
    """

    name: str
    mode: Mode

    def fetch(self, window: DateWindow) -> Iterable[RawRow]: ...

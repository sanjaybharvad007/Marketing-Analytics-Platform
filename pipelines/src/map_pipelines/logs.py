"""Structured logging: key=value lines for humans, JSON lines for log collectors."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

_RESERVED = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


def _extra_fields(record: logging.LogRecord) -> dict[str, Any]:
    return {key: value for key, value in record.__dict__.items() if key not in _RESERVED}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
            **_extra_fields(record),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        stamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        fields = " ".join(f"{key}={value}" for key, value in _extra_fields(record).items())
        line = f"{stamp} {record.levelname:<7} {record.getMessage()}"
        if fields:
            line = f"{line}  {fields}"
        if record.exc_info:
            line = f"{line}\n{self.formatException(record.exc_info)}"
        return line


def configure_logging(log_format: str = "console", level: str = "INFO") -> None:
    """Send package logs to stderr so stdout stays clean for command output."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter() if log_format == "json" else ConsoleFormatter())
    root = logging.getLogger("map_pipelines")
    root.handlers = [handler]
    root.setLevel(level.upper())
    root.propagate = False


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"map_pipelines.{name}")

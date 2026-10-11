"""The tracked prompts asked by the AI-visibility pipeline.

Demo mode seeds its own prompts. For a real site the list is maintained in a
CSV file with the columns `prompt`, `topic` and, optionally, `intent`, and
loaded with `map import-prompts`.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

import psycopg
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from map_pipelines.models import Intent


class PromptRow(BaseModel):
    model_config = ConfigDict(frozen=True, str_strip_whitespace=True)

    prompt: str = Field(min_length=5, max_length=500)
    topic: str = Field(min_length=1, max_length=80)
    intent: Intent = "informational"

    @field_validator("intent", mode="before")
    @classmethod
    def _default_intent(cls, value: object) -> object:
        return "informational" if value is None or str(value).strip() == "" else str(value).lower()


class PromptFileError(ValueError):
    """The prompt file is missing a column or has an invalid row."""


@dataclass(frozen=True)
class PromptImport:
    added: int
    updated: int
    deactivated: int


def read_prompts_csv(text: str) -> list[PromptRow]:
    """Parse and validate a prompt file. Duplicate prompts keep their last row."""
    reader = csv.DictReader(io.StringIO(text))
    columns = {(name or "").strip().lower() for name in reader.fieldnames or []}
    missing = {"prompt", "topic"} - columns
    if missing:
        raise PromptFileError(f"missing column(s): {', '.join(sorted(missing))}")

    rows: dict[str, PromptRow] = {}
    for line, raw in enumerate(reader, start=2):
        record = {(key or "").strip().lower(): value for key, value in raw.items()}
        if not any((value or "").strip() for value in record.values()):
            continue
        try:
            row = PromptRow(
                prompt=record.get("prompt") or "",
                topic=record.get("topic") or "",
                intent=record.get("intent"),
            )
        except ValidationError as error:
            problem = error.errors()[0]
            field = ".".join(str(part) for part in problem["loc"])
            raise PromptFileError(f"line {line}: {field}: {problem['msg']}") from error
        rows[row.prompt] = row
    return list(rows.values())


def import_prompts(
    conn: psycopg.Connection, rows: list[PromptRow], *, deactivate_missing: bool = False
) -> PromptImport:
    """Upsert prompts by their text and, on request, retire those not in `rows`.

    Retired prompts are marked inactive rather than deleted, so their stored
    answers stay in the reports.
    """
    existing = {row[0] for row in conn.execute("SELECT prompt FROM ai_prompts").fetchall()}
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO ai_prompts (prompt, topic, intent, active) VALUES (%s, %s, %s, true)
            ON CONFLICT (prompt) DO UPDATE
               SET topic = EXCLUDED.topic, intent = EXCLUDED.intent, active = true
            """,
            [(row.prompt, row.topic, row.intent) for row in rows],
        )
    deactivated = 0
    if deactivate_missing:
        deactivated = conn.execute(
            "UPDATE ai_prompts SET active = false WHERE active AND NOT (prompt = ANY(%s))",
            ([row.prompt for row in rows],),
        ).rowcount
    added = sum(1 for row in rows if row.prompt not in existing)
    return PromptImport(added=added, updated=len(rows) - added, deactivated=deactivated)

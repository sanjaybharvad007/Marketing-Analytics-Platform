"""Prompt imports against a real database."""

from __future__ import annotations

import pytest

from map_pipelines.db import Database, fetch_all
from map_pipelines.etl.pipelines import active_prompts
from map_pipelines.prompts import PromptRow, import_prompts

pytestmark = pytest.mark.integration


def test_import_adds_updates_and_retires_prompts(db: Database) -> None:
    tents = PromptRow(prompt="What is the best two-person tent?", topic="Tents")
    stoves = PromptRow(prompt="Which stove is lightest?", topic="Stoves", intent="commercial")
    with db.connection() as conn:
        first = import_prompts(conn, [tents, stoves])
    assert (first.added, first.updated, first.deactivated) == (2, 0, 0)

    # Same prompt text with a new topic is an update, not a second prompt.
    moved = PromptRow(prompt=stoves.prompt, topic="Camp kitchen", intent="commercial")
    with db.connection() as conn:
        second = import_prompts(conn, [moved], deactivate_missing=True)
        rows = fetch_all(conn, "SELECT prompt, topic, intent, active FROM ai_prompts ORDER BY id")
        asked = active_prompts(conn)
    assert (second.added, second.updated, second.deactivated) == (0, 1, 1)
    assert rows == [
        (tents.prompt, "Tents", "informational", False),
        (stoves.prompt, "Camp kitchen", "commercial", True),
    ]
    assert [prompt.prompt for prompt in asked] == [stoves.prompt]

    # Importing a retired prompt again brings it back.
    with db.connection() as conn:
        third = import_prompts(conn, [tents])
        assert len(active_prompts(conn)) == 2
    assert (third.added, third.updated, third.deactivated) == (0, 1, 0)

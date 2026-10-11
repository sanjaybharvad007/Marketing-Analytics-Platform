from __future__ import annotations

import pytest

from map_pipelines.prompts import PromptFileError, PromptRow, read_prompts_csv


def test_reads_prompts_with_optional_intent() -> None:
    text = (
        "prompt,topic,intent\n"
        "What is the best two-person tent?,Tents,commercial\n"
        "How do sleeping bag ratings work?,Sleeping bags,\n"
    )
    assert read_prompts_csv(text) == [
        PromptRow(prompt="What is the best two-person tent?", topic="Tents", intent="commercial"),
        PromptRow(prompt="How do sleeping bag ratings work?", topic="Sleeping bags"),
    ]


def test_headers_are_case_insensitive_and_blank_lines_are_skipped() -> None:
    text = "Prompt, Topic\n  Which rain jackets last longest?  , Rainwear \n,\n"
    rows = read_prompts_csv(text)
    assert rows == [PromptRow(prompt="Which rain jackets last longest?", topic="Rainwear")]
    assert rows[0].intent == "informational"


def test_duplicate_prompts_keep_the_last_row() -> None:
    text = "prompt,topic\nWhich stove is lightest?,Stoves\nWhich stove is lightest?,Camp kitchen\n"
    assert [row.topic for row in read_prompts_csv(text)] == ["Camp kitchen"]


def test_missing_column_is_reported() -> None:
    with pytest.raises(PromptFileError, match=r"missing column\(s\): topic"):
        read_prompts_csv("prompt\nWhich stove is lightest?\n")


@pytest.mark.parametrize(
    ("line", "field"),
    [
        ("Hi?,Tents,", "prompt"),
        ("Which stove is lightest?,,", "topic"),
        ("Which stove is lightest?,Stoves,urgent", "intent"),
    ],
)
def test_invalid_rows_name_the_line_and_field(line: str, field: str) -> None:
    with pytest.raises(PromptFileError, match=rf"line 2: {field}: "):
        read_prompts_csv(f"prompt,topic,intent\n{line}\n")

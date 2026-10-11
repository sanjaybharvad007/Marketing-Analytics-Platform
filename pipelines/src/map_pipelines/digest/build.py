"""Weekly digest: KPI movement, winners and losers, audit status, AI visibility."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from map_pipelines.api_client import PlatformApi
from map_pipelines.llm import Generated, LLMProvider, generate_text
from map_pipelines.models import ENGINE_LABELS

SYSTEM_PROMPT = (
    "You write the weekly marketing performance note for a busy team. Three to five "
    "sentences, plain language, lead with what changed most, no headings or bullet points, "
    "and use only the figures provided."
)

# key, label, format, whether an increase is good
KPI_SPEC: tuple[tuple[str, str, str, bool], ...] = (
    ("sessions", "Sessions", "number", True),
    ("users", "Users", "number", True),
    ("conversions", "Conversions", "number", True),
    ("clicks", "Organic clicks", "number", True),
    ("impressions", "Impressions", "number", True),
    ("ctr", "CTR", "percent", True),
    ("position", "Average position", "position", False),
    ("ai_visibility_score", "AI visibility score", "score", True),
)


@dataclass(frozen=True)
class DigestData:
    period: dict[str, str]
    previous_period: dict[str, str] | None
    kpis: dict[str, dict[str, float | None]]
    winners: list[dict[str, Any]] = field(default_factory=list)
    losers: list[dict[str, Any]] = field(default_factory=list)
    audit: dict[str, Any] | None = None
    ai: dict[str, Any] | None = None


def fetch(api: PlatformApi, date_range: str = "7d") -> DigestData:
    overview = api.get("metrics/overview", range=date_range, compare="previous")
    movers = {
        direction: api.request(
            "GET",
            "seo/pages",
            params={
                "range": date_range,
                "compare": "previous",
                "sort": "clicks_delta",
                "dir": direction,
                "page_size": 5,
            },
        ).data
        for direction in ("desc", "asc")
    }
    return DigestData(
        period=overview["range"],
        previous_period=overview.get("compare"),
        kpis=overview["kpis"],
        winners=[row for row in movers["desc"] if (row.get("clicks_delta") or 0) > 0],
        losers=[row for row in movers["asc"] if (row.get("clicks_delta") or 0) < 0],
        audit=api.get("audits/latest"),
        ai=api.get("ai-visibility/summary", range=date_range, compare="previous"),
    )


def change(value: float | None, previous: float | None) -> float | None:
    """Relative change, or None when it cannot be computed."""
    if value is None or previous in (None, 0):
        return None
    return (value - previous) / previous


def format_value(value: float | None, kind: str) -> str:
    if value is None:
        return "n/a"
    if kind == "percent":
        return f"{value:.2%}"
    if kind == "position":
        return f"{value:.1f}"
    if kind == "score":
        return f"{value:.1f}"
    return f"{value:,.0f}"


def format_change(value: float | None, previous: float | None, kind: str) -> str:
    if value is None or previous is None:
        return "n/a"
    if kind in ("position", "score"):
        return f"{value - previous:+.1f}"
    relative = change(value, previous)
    return "n/a" if relative is None else f"{relative:+.1%}"


def _kpi_rows(data: DigestData) -> list[tuple[str, str, str, str]]:
    rows = []
    for key, label, kind, _ in KPI_SPEC:
        kpi = data.kpis.get(key) or {}
        value, previous = kpi.get("value"), kpi.get("previous")
        rows.append(
            (
                label,
                format_value(value, kind),
                format_value(previous, kind),
                format_change(value, previous, kind),
            )
        )
    return rows


def _in_sentence(label: str) -> str:
    """Lower-case a KPI label for mid-sentence use, leaving acronyms such as CTR alone."""
    return label if label.isupper() else label.lower()


def _join(items: list[str]) -> str:
    """Join with commas and a final "and"."""
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def heuristic_narrative(data: DigestData) -> str:
    """Rule-based summary: biggest KPI moves, top mover pages, audit and AI status."""
    moves: list[tuple[float, str]] = []
    for key, label, kind, _ in KPI_SPEC:
        kpi = data.kpis.get(key) or {}
        relative = change(kpi.get("value"), kpi.get("previous"))
        if relative is None or kind in ("position", "score"):
            continue
        moves.append((relative, label))
    sentences: list[str] = []
    if moves:
        moves.sort(key=lambda item: abs(item[0]), reverse=True)
        described = [
            f"{_in_sentence(label)} {'rose' if relative > 0 else 'fell'} {abs(relative):.1%}"
            for relative, label in moves[:3]
        ]
        sentences.append(f"Week over week, {_join(described)}.")
    position = data.kpis.get("position") or {}
    if position.get("value") is not None and position.get("previous") is not None:
        delta = position["value"] - position["previous"]
        if abs(delta) >= 0.1:
            sentences.append(
                f"Average position {'improved' if delta < 0 else 'slipped'} by {abs(delta):.1f} "
                f"to {position['value']:.1f}."
            )
    if data.winners:
        top = data.winners[0]
        sentences.append(
            f"The biggest gain came from {top['path']} (+{top['clicks_delta']:,.0f} clicks)."
        )
    if data.losers:
        bottom = data.losers[0]
        sentences.append(
            f"The largest drop was {bottom['path']} ({bottom['clicks_delta']:,.0f} clicks)."
        )
    if data.audit and data.audit.get("run"):
        severe = data.audit["counts"]["by_severity"]
        urgent = severe.get("critical", 0) + severe.get("high", 0)
        sentences.append(
            f"The latest site audit scored {float(data.audit['run']['health_score']):.0f}/100 "
            f"with {urgent} critical or high-severity issue(s) open."
        )
    if data.ai and data.ai.get("score") is not None and data.ai.get("score_prev") is not None:
        delta = data.ai["score"] - data.ai["score_prev"]
        sentences.append(
            f"AI visibility is at {data.ai['score']:.1f}, "
            f"{'up' if delta >= 0 else 'down'} {abs(delta):.1f} points."
        )
    return " ".join(sentences) or "No data was available for this period."


def build_prompt(data: DigestData) -> str:
    lines = [f"Period {data.period['from']} to {data.period['to']} versus the previous period.", ""]
    lines += [
        f"{label}: {current} (previous {previous}, change {delta})"
        for label, current, previous, delta in _kpi_rows(data)
    ]
    if data.winners:
        lines.append("\nPages gaining clicks:")
        lines += [f"- {row['path']}: {row['clicks_delta']:+,.0f}" for row in data.winners]
    if data.losers:
        lines.append("\nPages losing clicks:")
        lines += [f"- {row['path']}: {row['clicks_delta']:+,.0f}" for row in data.losers]
    if data.audit and data.audit.get("run"):
        lines.append(
            f"\nSite audit health score {data.audit['run']['health_score']}, open issues by "
            f"severity {data.audit['counts']['by_severity']}."
        )
    return "\n".join(lines)


def _table(headers: tuple[str, ...], rows: list[tuple[str, ...]]) -> list[str]:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(" --- " for _ in headers) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return lines


def _mover_rows(rows: list[dict[str, Any]]) -> list[tuple[str, ...]]:
    return [
        (
            row["path"],
            f"{row['clicks']:,.0f}",
            f"{row.get('clicks_prev') or 0:,.0f}",
            f"{row['clicks_delta']:+,.0f}",
        )
        for row in rows
    ]


def render(data: DigestData, narrative: Generated[str]) -> str:
    """Render the digest as Markdown."""
    written_by = "language model" if narrative.source == "llm" else "rules"
    lines = [
        f"# Weekly marketing digest: {data.period['from']} to {data.period['to']}",
        "",
        narrative.value,
        "",
        f"_Summary written by {written_by}._",
        "",
        "## KPIs",
        "",
        *_table(("Metric", "This period", "Previous", "Change"), _kpi_rows(data)),
        "",
    ]
    if data.winners:
        lines += [
            "## Pages gaining clicks",
            "",
            *_table(("Page", "Clicks", "Previous", "Change"), _mover_rows(data.winners)),
            "",
        ]
    if data.losers:
        lines += [
            "## Pages losing clicks",
            "",
            *_table(("Page", "Clicks", "Previous", "Change"), _mover_rows(data.losers)),
            "",
        ]
    if data.audit and data.audit.get("run"):
        run = data.audit["run"]
        severity = data.audit["counts"]["by_severity"]
        lines += [
            "## Site audit",
            "",
            f"Health score **{float(run['health_score']):.1f}** across {run['pages_crawled']} "
            f"pages. Open issues: {severity.get('critical', 0)} critical, "
            f"{severity.get('high', 0)} high, {severity.get('medium', 0)} medium, "
            f"{severity.get('low', 0)} low.",
            "",
        ]
        top_rules = data.audit["counts"].get("by_rule", [])[:5]
        if top_rules:
            lines += [f"- {row['rule']} ({row['severity']}): {row['count']}" for row in top_rules]
            lines.append("")
    if data.ai and data.ai.get("score") is not None:
        lines += ["## AI visibility", ""]
        previous = data.ai.get("score_prev")
        delta = "" if previous is None else f" ({data.ai['score'] - previous:+.1f} points)"
        lines.append(
            f"Visibility score **{data.ai['score']:.1f}**{delta}; brand mentioned in "
            f"{data.ai['mention_rate']:.0%} of answers, cited in {data.ai['citation_rate']:.0%}."
        )
        lines.append("")
        engines = data.ai.get("by_engine") or []
        if engines:
            lines += _table(
                ("Engine", "Score", "Mention rate", "Citation rate"),
                [
                    (
                        ENGINE_LABELS.get(row["engine"], row["engine"]),
                        f"{row['score']:.1f}",
                        f"{row['mention_rate']:.0%}",
                        f"{row['citation_rate']:.0%}",
                    )
                    for row in engines
                ],
            )
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def build_digest(
    api: PlatformApi, provider: LLMProvider, date_range: str = "7d"
) -> tuple[DigestData, str]:
    data = fetch(api, date_range)
    narrative = generate_text(
        provider,
        system=SYSTEM_PROMPT,
        prompt=build_prompt(data),
        fallback=lambda: heuristic_narrative(data),
    )
    return data, render(data, narrative)

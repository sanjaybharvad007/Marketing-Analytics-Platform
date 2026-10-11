"""Prioritised audit summary: written by the LLM when configured, by rules otherwise."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence

from pydantic import BaseModel, Field

from map_pipelines.audit.rules import RULES
from map_pipelines.audit.score import SEVERITY_WEIGHT
from map_pipelines.audit.site import Issue
from map_pipelines.llm import Generated, LLMProvider, generate_structured

SYSTEM_PROMPT = (
    "You are a technical SEO lead writing for a marketing team. Be specific and brief. "
    "Prioritise by likely impact on organic traffic, and only cite numbers given to you."
)


class Priority(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    why: str = Field(min_length=3, max_length=400)
    action: str = Field(min_length=3, max_length=400)


class AuditSummary(BaseModel):
    headline: str = Field(min_length=3, max_length=300)
    priorities: list[Priority] = Field(min_length=1, max_length=5)
    quick_wins: list[str] = Field(default_factory=list, max_length=5)

    def to_text(self) -> str:
        lines = [self.headline, "", "Priorities"]
        for index, priority in enumerate(self.priorities, start=1):
            lines.append(f"{index}. {priority.title}: {priority.why} {priority.action}")
        if self.quick_wins:
            lines += ["", "Quick wins"]
            lines += [f"- {item}" for item in self.quick_wins]
        return "\n".join(lines)


def _rule_stats(issues: Sequence[Issue]) -> list[tuple[str, int, float]]:
    """(rule, count, impact) sorted by impact = count x severity weight."""
    counts = Counter(issue.rule for issue in issues)
    stats = [
        (rule, count, count * SEVERITY_WEIGHT[RULES[rule].severity])
        for rule, count in counts.items()
    ]
    return sorted(stats, key=lambda item: (-item[2], item[0]))


def heuristic_summary(issues: Sequence[Issue], pages_crawled: int, score: float) -> AuditSummary:
    if not issues:
        return AuditSummary(
            headline=f"No issues found across {pages_crawled} pages. Health score {score:.0f}.",
            priorities=[
                Priority(
                    title="Keep monitoring",
                    why="The crawl found nothing to fix.",
                    action="Re-run the audit after each release.",
                )
            ],
        )
    stats = _rule_stats(issues)
    by_severity = Counter(issue.severity for issue in issues)
    serious = by_severity["critical"] + by_severity["high"]
    headline = (
        f"Health score {score:.0f}/100 across {pages_crawled} pages: {len(issues)} issues, "
        f"{serious} of them critical or high severity."
    )
    priorities = [
        Priority(
            title=RULES[rule].title,
            why=f"{count} page(s) affected ({RULES[rule].severity} severity).",
            action=RULES[rule].fix,
        )
        for rule, count, _ in stats[:4]
    ]
    quick_wins = [
        f"{RULES[rule].title} on {count} page(s): {RULES[rule].fix}"
        for rule, count, _ in stats
        if RULES[rule].severity == "low"
    ][:3]
    return AuditSummary(headline=headline, priorities=priorities, quick_wins=quick_wins)


def build_prompt(issues: Sequence[Issue], pages_crawled: int, score: float) -> str:
    lines = [
        f"Site audit: {pages_crawled} pages crawled, health score {score:.1f}/100, "
        f"{len(issues)} issues.",
        "",
        "Issues by rule (rule | severity | pages affected | example URL):",
    ]
    examples = {issue.rule: issue.url for issue in reversed(issues)}
    for rule, count, _ in _rule_stats(issues):
        lines.append(f"- {RULES[rule].title} | {RULES[rule].severity} | {count} | {examples[rule]}")
    lines += [
        "",
        "Write a headline sentence, up to four priorities (title, why it matters, concrete "
        "action) and up to three quick wins.",
    ]
    return "\n".join(lines)


def summarise(
    provider: LLMProvider, issues: Sequence[Issue], pages_crawled: int, score: float
) -> Generated[AuditSummary]:
    return generate_structured(
        provider,
        system=SYSTEM_PROMPT,
        prompt=build_prompt(issues, pages_crawled, score),
        schema=AuditSummary,
        fallback=lambda: heuristic_summary(issues, pages_crawled, score),
    )

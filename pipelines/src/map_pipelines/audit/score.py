"""Site health score."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from map_pipelines.audit.site import Issue

SEVERITY_WEIGHT = {"critical": 10.0, "high": 5.0, "medium": 2.0, "low": 0.5}
# A single page cannot lose more than this, however many issues it has.
PAGE_PENALTY_CAP = 20.0


def health_score(issues: Iterable[Issue], pages_crawled: int) -> float:
    """Score from 0 to 100.

    Each issue costs its page a penalty by severity (critical 10, high 5,
    medium 2, low 0.5), capped at 20 per page. The score is the share of the
    maximum possible penalty that was *not* incurred:

        100 * (1 - sum(page penalties) / (pages * 20))

    so a site with no issues scores 100 and one where every page hits the cap
    scores 0.
    """
    if pages_crawled <= 0:
        return 0.0
    penalties: dict[str, float] = defaultdict(float)
    for issue in issues:
        penalties[issue.url] += SEVERITY_WEIGHT[issue.severity]
    total = sum(min(penalty, PAGE_PENALTY_CAP) for penalty in penalties.values())
    # URLs that only appear in issues (dead sitemap entries) still count as pages.
    pages = max(pages_crawled, len(penalties))
    return round(max(0.0, 100.0 * (1.0 - total / (pages * PAGE_PENALTY_CAP))), 1)

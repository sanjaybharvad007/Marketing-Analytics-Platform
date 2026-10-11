from __future__ import annotations

import json

import httpx

from map_pipelines.api_client import PlatformApi
from map_pipelines.briefs.builder import (
    BriefInputs,
    CandidatePage,
    ContentBrief,
    RankingSnapshot,
    RelatedQuery,
    build_brief,
    build_prompt,
    heuristic_brief,
    pick_internal_links,
    rank_related,
    tokens,
)
from map_pipelines.briefs.runner import fulfil_requested_briefs
from map_pipelines.llm import OfflineProvider

SITE = "https://www.northpeak.example"
QUERIES = [
    RelatedQuery("sleeping bag temperature ratings", 19000, 570, 9.0),
    RelatedQuery("what temperature sleeping bag do i need", 6200, 180, 7.5),
    RelatedQuery("how to choose a sleeping bag", 4100, 60, 14.2),
    RelatedQuery("down sleeping bags", 8800, 120, 16.0),
    RelatedQuery("20 degree sleeping bag", 5100, 90, 11.0),
    RelatedQuery("is down warmer than synthetic", 1500, 70, 5.0),
    RelatedQuery("hiking boots", 30000, 300, 12.0),
    RelatedQuery("how to waterproof a tent", 7000, 400, 4.0),
]
PAGES = [
    CandidatePage(
        f"{SITE}/guides/sleeping-bag-temperature-ratings/",
        "Sleeping Bag Temperature Ratings Explained",
        900,
        "guide",
    ),
    CandidatePage(f"{SITE}/categories/sleeping-bags/", "Sleeping Bags", 1400, "category"),
    CandidatePage(
        f"{SITE}/blog/down-vs-synthetic-sleeping-bags/",
        "Down vs Synthetic Sleeping Bags",
        700,
        "article",
    ),
    CandidatePage(f"{SITE}/categories/hiking-boots/", "Hiking Boots and Shoes", 2500, "category"),
    CandidatePage(
        f"{SITE}/guides/how-to-choose-a-sleeping-bag/", "How to Choose a Sleeping Bag", 0, "guide"
    ),
]


def inputs(**overrides) -> BriefInputs:
    values = {
        "title": "Sleeping Bag Buying Guide",
        "target_keyword": "how to choose a sleeping bag",
        "intent": "informational",
        "page_type": "guide",
        "target_url": f"{SITE}/guides/how-to-choose-a-sleeping-bag/",
        "related_queries": QUERIES,
        "candidate_pages": PAGES,
        "ranking": RankingSnapshot(position=14.2, url=PAGES[0].url, search_volume=4400),
        "brand_name": "Northpeak Outfitters",
    }
    values.update(overrides)
    return BriefInputs(**values)


def test_tokens_drop_stopwords_and_fold_plurals() -> None:
    assert tokens("How to choose the best Sleeping Bags") == ["choose", "sleeping", "bag"]


def test_rank_related_orders_by_overlap_then_impressions() -> None:
    related = [query.query for query in rank_related("how to choose a sleeping bag", QUERIES)]
    assert "how to choose a sleeping bag" not in related
    assert "hiking boots" not in related
    assert "how to waterproof a tent" not in related
    # Two shared words ("sleeping", "bag") beat none; ties resolved by impressions.
    assert related[0] == "sleeping bag temperature ratings"
    assert related.index("down sleeping bags") < related.index("20 degree sleeping bag")


def test_internal_links_share_the_topic_and_skip_the_target_page() -> None:
    links = pick_internal_links(inputs())
    urls = [link.url for link in links]
    assert f"{SITE}/guides/how-to-choose-a-sleeping-bag/" not in urls
    assert f"{SITE}/categories/hiking-boots/" not in urls
    assert urls[0] == f"{SITE}/categories/sleeping-bags/"  # same overlap, most clicks
    assert "convert" in links[0].reason


def test_heuristic_brief_is_complete_and_valid() -> None:
    brief = heuristic_brief(inputs())
    assert isinstance(brief, ContentBrief)
    assert brief.primary_keyword == "how to choose a sleeping bag"
    assert brief.search_intent == "informational"
    assert 1 <= len(brief.working_titles) <= 5
    assert len(brief.outline) >= 3
    assert brief.questions == ["What temperature sleeping bag do I need?"]
    assert "temperature" in brief.entities
    assert "sleeping" not in brief.entities
    assert len(brief.internal_links) >= 2
    assert 20 <= len(brief.meta_description) <= 160
    assert brief.current_ranking.position == 14.2


def test_question_queries_become_readable_headings() -> None:
    queries = [
        RelatedQuery("how to wash a down sleeping bag", 900),
        RelatedQuery("what size sleeping bag do i need", 700),
        RelatedQuery("is a sleeping bag liner worth it?", 500),
    ]
    brief = heuristic_brief(inputs(related_queries=queries))
    # Sentence case, "I" capitalised, and no question mark on "How to ...".
    assert brief.questions == [
        "How to wash a down sleeping bag",
        "What size sleeping bag do I need?",
        "Is a sleeping bag liner worth it?",
    ]


def test_word_count_grows_when_not_on_page_one() -> None:
    off_page_one = heuristic_brief(inputs())
    on_page_one = heuristic_brief(inputs(ranking=RankingSnapshot(position=4.0)))
    assert on_page_one.target_word_count == 1800
    assert off_page_one.target_word_count == 2150


def test_commercial_brief_uses_comparison_structure() -> None:
    brief = heuristic_brief(
        inputs(
            title="Best Sleeping Bags",
            target_keyword="best sleeping bags",
            intent="commercial",
            page_type="article",
        )
    )
    headings = [section.heading for section in brief.outline]
    # The superlative is dropped where it would read badly mid-sentence.
    assert headings[:3] == [
        "What to know about sleeping bags",
        "How to compare sleeping bags",
        "Our recommended sleeping bags",
    ]
    assert brief.meta_description.startswith("Compare sleeping bags by ")
    assert brief.working_titles[0] == "Best Sleeping Bags: How to Pick the Right One"


def test_transactional_meta_description_names_the_brand() -> None:
    brief = heuristic_brief(
        inputs(target_keyword="buy sleeping bags", intent="transactional", page_type="category")
    )
    assert "Northpeak Outfitters" in brief.meta_description


def test_brief_without_search_data_still_validates() -> None:
    brief = heuristic_brief(
        inputs(related_queries=[], candidate_pages=[], ranking=RankingSnapshot())
    )
    assert brief.questions == []
    assert brief.internal_links == []
    assert len(brief.outline) >= 3


def test_heuristic_brief_is_deterministic() -> None:
    assert heuristic_brief(inputs()) == heuristic_brief(inputs())


def test_prompt_contains_the_search_data() -> None:
    prompt = build_prompt(inputs())
    assert "Primary keyword: how to choose a sleeping bag" in prompt
    assert "sleeping bag temperature ratings | 19000 | 9.0" in prompt
    assert f"{SITE}/categories/sleeping-bags/ | Sleeping Bags" in prompt
    assert "position 14" in prompt


class JsonProvider:
    name = "json"

    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        return "```json\n" + json.dumps(self._payload) + "\n```"


def test_llm_brief_drops_links_to_pages_that_do_not_exist() -> None:
    payload = heuristic_brief(inputs()).model_dump(mode="json")
    payload["working_titles"] = ["LLM Title"]
    payload["internal_links"] = [
        {"url": f"{SITE}/invented-page/", "title": "Invented", "reason": "made up"},
        {
            "url": f"{SITE}/categories/sleeping-bags/",
            "title": "Sleeping Bags",
            "reason": "relevant",
        },
    ]
    payload["current_ranking"] = {"position": 1, "url": "https://wrong.example/"}
    result = build_brief(JsonProvider(payload), inputs())
    assert result.source == "llm"
    assert result.value.working_titles == ["LLM Title"]
    assert [link.url for link in result.value.internal_links] == [
        f"{SITE}/categories/sleeping-bags/"
    ]
    # Ranking facts come from data, never from the model.
    assert result.value.current_ranking.position == 14.2


def test_llm_brief_with_only_invented_links_uses_heuristic_links() -> None:
    payload = heuristic_brief(inputs()).model_dump(mode="json")
    payload["internal_links"] = [{"url": "https://nope.example/", "title": "x", "reason": "y"}]
    result = build_brief(JsonProvider(payload), inputs())
    assert [link.url for link in result.value.internal_links] == [
        link.url for link in pick_internal_links(inputs())
    ]


def test_offline_build_uses_the_heuristic() -> None:
    result = build_brief(OfflineProvider(), inputs())
    assert result.source == "heuristic"
    assert result.value == heuristic_brief(inputs())


def _api(handler) -> PlatformApi:
    return PlatformApi(
        "http://app.test", "t", client=httpx.Client(transport=httpx.MockTransport(handler))
    )


def test_runner_reads_requested_plans_and_writes_briefs_back() -> None:
    written: dict[str, dict] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v1/")
        params = dict(request.url.params)
        if request.method == "PUT":
            body = json.loads(request.content)
            if path == "plans/8/brief" and body["status"] == "ready":
                return httpx.Response(
                    422, json={"error": {"code": "validation_error", "message": "bad brief"}}
                )
            written[path] = body
            return httpx.Response(200, json={"data": {"id": 1}, "meta": {}})
        if path == "plans":
            assert params["brief_status"] == "requested"
            plans = [
                {
                    "id": 7,
                    "title": "Sleeping Bag Buying Guide",
                    "target_keyword": "how to choose a sleeping bag",
                    "intent": "informational",
                    "page_type": "guide",
                    "target_url": None,
                },
                {
                    "id": 8,
                    "title": "Broken Plan",
                    "target_keyword": "tents",
                    "intent": "commercial",
                    "page_type": "article",
                    "target_url": None,
                },
            ]
            return httpx.Response(200, json={"data": plans, "meta": {"total_pages": 1}})
        if path == "seo/queries":
            rows = [
                {
                    "query": q.query,
                    "impressions": q.impressions,
                    "clicks": q.clicks,
                    "position": q.position,
                }
                for q in QUERIES
                if params["q"] in q.query
            ]
            return httpx.Response(200, json={"data": rows, "meta": {"total_pages": 1}})
        if path == "seo/keywords":
            rows = [
                {
                    "keyword": "how to choose a sleeping bag",
                    "position": 14,
                    "url": PAGES[0].url,
                    "search_volume": 4400,
                }
            ]
            return httpx.Response(200, json={"data": rows, "meta": {"total_pages": 1}})
        if path == "seo/pages":
            rows = [
                {
                    "url": p.url,
                    "path": p.url.removeprefix(SITE),
                    "title": p.title,
                    "clicks": p.clicks,
                    "page_type": p.page_type,
                }
                for p in PAGES
            ]
            return httpx.Response(200, json={"data": rows, "meta": {"total_pages": 1}})
        raise AssertionError(f"unexpected request {request.method} {path}")

    outcomes = fulfil_requested_briefs(
        _api(handler), OfflineProvider(), brand_name="Northpeak Outfitters"
    )
    assert [(o.plan_id, o.status) for o in outcomes] == [(7, "ready"), (8, "failed")]
    ready = written["plans/7/brief"]
    assert ready["status"] == "ready"
    assert ready["generated_by"] == "heuristic"
    assert ready["brief"]["current_ranking"] == {
        "position": 14.0,
        "url": PAGES[0].url,
        "search_volume": 4400,
    }
    ContentBrief.model_validate(ready["brief"])
    assert written["plans/8/brief"]["status"] == "failed"
    assert "bad brief" in written["plans/8/brief"]["error"]


def test_runner_with_nothing_requested_makes_no_other_calls() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={"data": [], "meta": {"total_pages": 1}})

    assert fulfil_requested_briefs(_api(handler), OfflineProvider(), brand_name="x") == []
    assert calls == ["/api/v1/plans"]

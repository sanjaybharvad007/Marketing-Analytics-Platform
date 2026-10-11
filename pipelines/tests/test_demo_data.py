"""The demo generators must be deterministic and must carry the planted stories."""

from __future__ import annotations

from datetime import date, timedelta

from conftest import ANCHOR, SEED
from map_pipelines.demo import catalog, rng
from map_pipelines.demo.ai import PromptRef, answer_rows
from map_pipelines.demo.search import search_rows
from map_pipelines.demo.seo import TRACKED_KEYWORDS, domain_rows, keyword_rows
from map_pipelines.demo.traffic import traffic_rows
from map_pipelines.demo.world import DemoWorld

DAY = ANCHOR - timedelta(days=10)


def test_uniform_is_stable_and_in_range() -> None:
    first = rng.uniform(1, "a", DAY)
    assert first == rng.uniform(1, "a", DAY)
    assert 0 <= first < 1
    assert first != rng.uniform(2, "a", DAY)
    assert first != rng.uniform(1, "b", DAY)


def test_stochastic_round_preserves_expectation() -> None:
    total = sum(rng.stochastic_round(7, 0.3, index) for index in range(20_000))
    assert 5_600 < total < 6_400
    assert rng.stochastic_round(7, 0.0, "x") == 0
    assert rng.stochastic_round(7, 3.0, "x") == 3


def test_catalogue_size(world: DemoWorld) -> None:
    assert len(world.pages) == 60
    assert len({page.path for page in world.pages}) == 60
    assert 280 <= len(world.queries) <= 320
    assert len(catalog.AI_PROMPTS) == 40


def test_catalogue_has_brand_and_non_brand_queries(world: DemoWorld) -> None:
    brand = [query for query in world.queries if query.is_brand]
    assert 20 <= len(brand) <= 60
    assert all(query.base_position < 2 for query in brand)


def test_striking_distance_queries_sit_between_8_and_20(world: DemoWorld) -> None:
    striking = [q for q in world.queries if q.query in catalog.STRIKING_DISTANCE_QUERIES]
    assert len(striking) == len(catalog.STRIKING_DISTANCE_QUERIES)
    assert all(8 <= query.base_position <= 20 for query in striking)


def test_search_rows_are_identical_across_runs() -> None:
    first = list(search_rows(DemoWorld(SEED, ANCHOR), DAY))
    second = list(search_rows(DemoWorld(SEED, ANCHOR), DAY))
    assert first == second
    assert len(first) > 1_000


def test_traffic_rows_are_identical_across_runs() -> None:
    first = list(traffic_rows(DemoWorld(SEED, ANCHOR), DAY))
    second = list(traffic_rows(DemoWorld(SEED, ANCHOR), DAY))
    assert first == second
    assert len(first) > 500


def test_a_different_seed_changes_the_data() -> None:
    assert list(search_rows(DemoWorld(SEED, ANCHOR), DAY)) != list(
        search_rows(DemoWorld(SEED + 1, ANCHOR), DAY)
    )


def test_search_row_shape_matches_the_api(world: DemoWorld) -> None:
    row = next(search_rows(world, DAY))
    assert set(row) == {"keys", "clicks", "impressions", "ctr", "position"}
    day, page, _query, country, device = row["keys"]
    assert day == DAY.isoformat()
    assert page.startswith("https://www.northpeak.example/")
    assert country in {"usa", "can", "gbr", "deu", "aus"}
    assert device in {"DESKTOP", "MOBILE", "TABLET"}
    assert row["impressions"] > 0
    assert row["clicks"] <= row["impressions"]
    assert 1 <= row["position"] <= 100


def test_traffic_row_shape_matches_the_api(world: DemoWorld) -> None:
    row = next(traffic_rows(world, DAY))
    assert set(row) == {
        "date",
        "pagePath",
        "sessionDefaultChannelGroup",
        "deviceCategory",
        "countryId",
        "sessions",
        "totalUsers",
        "engagedSessions",
        "keyEvents",
        "totalRevenue",
    }
    assert row["date"] == DAY.strftime("%Y%m%d")
    assert int(row["totalUsers"]) <= int(row["sessions"])
    assert int(row["engagedSessions"]) <= int(row["sessions"])


def _clicks(world: DemoWorld, days: list[date], prefix: str) -> int:
    return sum(
        row["clicks"]
        for day in days
        for row in search_rows(world, day)
        if row["keys"][1].startswith(f"https://www.northpeak.example{prefix}")
    )


def test_guides_section_grows(world: DemoWorld) -> None:
    early = [ANCHOR - timedelta(days=age) for age in (110, 109, 108)]
    late = [ANCHOR - timedelta(days=age) for age in (5, 4, 3)]
    assert _clicks(world, late, "/guides/") > 1.3 * _clicks(world, early, "/guides/")


def test_decaying_page_loses_clicks(world: DemoWorld) -> None:
    path = "/blog/winter-camping-checklist/"
    before = [ANCHOR - timedelta(days=age) for age in (60, 59, 58, 57)]
    after = [ANCHOR - timedelta(days=age) for age in (4, 3, 2, 1)]
    assert _clicks(world, after, path) < 0.75 * _clicks(world, before, path)


def test_new_product_has_no_data_before_launch(world: DemoWorld) -> None:
    before_launch = ANCHOR - timedelta(days=60)
    paths = {row["pagePath"] for row in traffic_rows(world, before_launch)}
    assert "/products/skyline-ul-1p-tent/" not in paths
    assert "/products/skyline-ul-1p-tent/" in {row["pagePath"] for row in traffic_rows(world, DAY)}


def test_weekly_seasonality(world: DemoWorld) -> None:
    sunday = ANCHOR - timedelta(days=(ANCHOR.weekday() + 1) % 7 or 7)
    friday = sunday - timedelta(days=2)
    assert sunday.weekday() == 6
    assert friday.weekday() == 4
    assert world.weekday_factor(sunday) > world.weekday_factor(friday)


def test_keyword_rows(world: DemoWorld) -> None:
    rows = list(keyword_rows(world, DAY))
    assert len(rows) == TRACKED_KEYWORDS
    assert rows == list(keyword_rows(world, DAY))
    ranked = [row for row in rows if row["position"] is not None]
    assert all(1 <= row["position"] <= 100 for row in ranked)
    assert all(row["url"] for row in ranked)
    assert all(row["search_volume"] % 10 == 0 for row in rows)


def test_domain_rows_cover_brand_and_competitors(world: DemoWorld) -> None:
    rows = list(domain_rows(world, DAY))
    assert [row["domain"] for row in rows if row["is_own"]] == ["northpeak.example"]
    assert len(rows) == 4
    assert all(0 <= row["authority_score"] <= 100 for row in rows)


def test_answers_are_deterministic(world: DemoWorld) -> None:
    prompts = [PromptRef(index, p.prompt, p.topic) for index, p in enumerate(catalog.AI_PROMPTS, 1)]
    first = list(answer_rows(world, DAY, prompts))
    assert first == list(answer_rows(world, DAY, prompts))
    assert len(first) == 40 * 5
    assert all(row["answer"] for row in first)

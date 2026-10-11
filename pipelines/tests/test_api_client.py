from __future__ import annotations

import httpx
import pytest

from map_pipelines.api_client import ApiError, PlatformApi


def _api(handler, token: str = "tok") -> PlatformApi:
    return PlatformApi(
        "http://app.test/",
        token,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        attempts=1,
    )


def test_get_unwraps_data_and_sends_bearer_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://app.test/api/v1/seo/queries?country=US%2CCA&page=2"
        assert request.headers["authorization"] == "Bearer tok"
        return httpx.Response(200, json={"data": [{"query": "tents"}], "meta": {"total": 1}})

    assert _api(handler).get("seo/queries", country=["US", "CA"], page=2, device=None) == [
        {"query": "tents"}
    ]


def test_no_token_sends_no_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "authorization" not in request.headers
        return httpx.Response(200, json={"data": {}})

    _api(handler, token="").get("health")


def test_error_envelope_becomes_api_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={
                "error": {
                    "code": "validation_error",
                    "message": "Invalid input",
                    "details": [{"path": "title"}],
                }
            },
        )

    with pytest.raises(ApiError) as caught:
        _api(handler).post("plans", {})
    assert (caught.value.status, caught.value.code) == (422, "validation_error")
    assert caught.value.details == [{"path": "title"}]


def test_unauthorized() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401, json={"error": {"code": "unauthorized", "message": "Missing token"}}
        )

    with pytest.raises(ApiError, match="401 unauthorized"):
        _api(handler).post("tasks", {"title": "x"})


def test_server_error_and_unreachable_are_reported() -> None:
    def failing(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="down")

    with pytest.raises(ApiError) as caught:
        _api(failing).get("health")
    assert caught.value.status == 503

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(ApiError, match="cannot reach"):
        _api(refused).get("health")


def test_post_returns_meta_and_status() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"id": 4}, "meta": {"deduplicated": True}})

    result = _api(handler).post("tasks", {"title": "x", "dedupe_key": "k"})
    assert (result.data, result.meta, result.status) == ({"id": 4}, {"deduplicated": True}, 200)


def test_paginate_walks_pages_and_honours_limit() -> None:
    pages_requested: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        pages_requested.append(page)
        rows = [{"n": (page - 1) * 2 + offset} for offset in (1, 2)]
        return httpx.Response(200, json={"data": rows, "meta": {"total_pages": 3}})

    api = _api(handler)
    assert [row["n"] for row in api.paginate("plans", page_size=2)] == [1, 2, 3, 4, 5, 6]
    assert pages_requested == [1, 2, 3]
    pages_requested.clear()
    assert [row["n"] for row in api.paginate("plans", page_size=2, limit=3)] == [1, 2, 3]
    assert pages_requested == [1, 2]

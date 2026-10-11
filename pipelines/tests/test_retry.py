import httpx
import pytest

from map_pipelines.retry import TransientError, is_transient, with_retry


def test_returns_first_success_without_sleeping() -> None:
    sleeps: list[float] = []
    assert with_retry(lambda: 42, sleep=sleeps.append) == 42
    assert sleeps == []


def test_retries_transient_errors_with_exponential_backoff() -> None:
    calls = {"n": 0}
    sleeps: list[float] = []

    def flaky() -> str:
        calls["n"] += 1
        if calls["n"] < 4:
            raise TransientError("try again")
        return "done"

    assert with_retry(flaky, attempts=5, base_delay=1.0, sleep=sleeps.append) == "done"
    assert sleeps == [1.0, 2.0, 4.0]


def test_backoff_is_capped() -> None:
    sleeps: list[float] = []

    def always() -> None:
        raise TransientError("no")

    with pytest.raises(TransientError):
        with_retry(always, attempts=6, base_delay=10.0, max_delay=25.0, sleep=sleeps.append)
    assert sleeps == [10.0, 20.0, 25.0, 25.0, 25.0]


def test_non_transient_errors_are_not_retried() -> None:
    calls = {"n": 0}

    def broken() -> None:
        calls["n"] += 1
        raise ValueError("bad input")

    with pytest.raises(ValueError, match="bad input"):
        with_retry(broken, sleep=lambda _: None)
    assert calls["n"] == 1


def _status_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://api.example/")
    return httpx.HTTPStatusError(
        "x", request=request, response=httpx.Response(status, request=request)
    )


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_retryable_http_statuses(status: int) -> None:
    assert is_transient(_status_error(status))


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_client_errors_are_not_transient(status: int) -> None:
    assert not is_transient(_status_error(status))


def test_google_style_errors_are_recognised_by_code() -> None:
    class QuotaError(Exception):
        code = 429

    class HttpError(Exception):
        class resp:
            status = 503

    assert is_transient(QuotaError())
    assert is_transient(HttpError())
    assert is_transient(httpx.ConnectError("refused"))
    assert not is_transient(KeyError("x"))


def test_attempts_must_be_positive() -> None:
    with pytest.raises(ValueError, match="attempts"):
        with_retry(lambda: 1, attempts=0)

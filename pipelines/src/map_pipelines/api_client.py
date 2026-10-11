"""Client for the platform's REST API, used by the audit, brief, opportunity and digest scripts."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any

import httpx

from map_pipelines.retry import with_retry


class ApiError(RuntimeError):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.details = details


@dataclass(frozen=True)
class ApiResult:
    data: Any
    meta: dict[str, Any]
    status: int


def _clean(params: Mapping[str, Any] | None) -> dict[str, Any]:
    """Drop None values and join lists with commas, the API's multi-value format."""
    cleaned: dict[str, Any] = {}
    for key, value in (params or {}).items():
        if value is None:
            continue
        cleaned[key] = ",".join(str(v) for v in value) if isinstance(value, list | tuple) else value
    return cleaned


class PlatformApi:
    """Wraps the JSON envelope: returns `data`/`meta`, raises ApiError on `error`."""

    def __init__(
        self,
        base_url: str,
        token: str = "",
        *,
        client: httpx.Client | None = None,
        timeout: float = 30.0,
        attempts: int = 3,
    ) -> None:
        self._base = base_url.rstrip("/") + "/api/v1"
        self._headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._client = client or httpx.Client(timeout=timeout)
        self._attempts = attempts

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Any = None,
    ) -> ApiResult:
        def send() -> httpx.Response:
            response = self._client.request(
                method,
                f"{self._base}/{path.lstrip('/')}",
                params=_clean(params),
                json=json,
                headers=self._headers,
            )
            if response.status_code >= 500:
                response.raise_for_status()
            return response

        try:
            response = with_retry(send, attempts=self._attempts, description=f"{method} {path}")
        except httpx.HTTPStatusError as error:
            raise ApiError(error.response.status_code, "server_error", str(error)) from error
        except httpx.TransportError as error:
            raise ApiError(0, "unreachable", f"cannot reach {self._base}: {error}") from error

        if response.status_code == 204:
            return ApiResult(None, {}, 204)
        try:
            body = response.json()
        except ValueError as error:
            raise ApiError(response.status_code, "invalid_response", "body is not JSON") from error
        if response.status_code >= 400:
            problem = body.get("error", {}) if isinstance(body, dict) else {}
            raise ApiError(
                response.status_code,
                problem.get("code", "error"),
                problem.get("message", response.reason_phrase),
                problem.get("details"),
            )
        return ApiResult(body.get("data"), body.get("meta") or {}, response.status_code)

    def get(self, path: str, **params: Any) -> Any:
        return self.request("GET", path, params=params).data

    def post(self, path: str, payload: Any) -> ApiResult:
        return self.request("POST", path, json=payload)

    def put(self, path: str, payload: Any) -> ApiResult:
        return self.request("PUT", path, json=payload)

    def patch(self, path: str, payload: Any) -> ApiResult:
        return self.request("PATCH", path, json=payload)

    def paginate(
        self, path: str, *, page_size: int = 100, limit: int | None = None, **params: Any
    ) -> Iterator[dict[str, Any]]:
        """Yield rows across pages until the collection, or `limit`, is exhausted."""
        page = 1
        yielded = 0
        while True:
            result = self.request(
                "GET", path, params={**params, "page": page, "page_size": page_size}
            )
            rows = result.data or []
            for row in rows:
                yield row
                yielded += 1
                if limit is not None and yielded >= limit:
                    return
            if page >= int(result.meta.get("total_pages", 1)) or not rows:
                return
            page += 1

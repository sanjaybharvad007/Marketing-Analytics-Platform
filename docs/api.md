# REST API

The web app serves a JSON API under `/api/v1`. It exposes the same services
the pages use, so the API and the UI always agree. The automation scripts in
`pipelines/` are its main client.

A machine-readable description is at `GET /api/v1/openapi.json` (OpenAPI 3.1,
generated from the request schemas).

- [Conventions](#conventions)
- [Health and OpenAPI](#health-and-openapi)
- [Metrics](#metrics)
- [SEO](#seo)
- [AI visibility](#ai-visibility)
- [Plans](#plans)
- [Tasks](#tasks)
- [Audits](#audits)
- [Pipeline runs](#pipeline-runs)
- [Saved views](#saved-views)

The examples below were run in order against a freshly seeded demo database
with these two variables set:

```bash
export API=http://localhost:3000/api/v1
export API_TOKEN=dev-token-change-me    # the value of API_TOKEN in .env
```

Demo data is generated relative to the day it is seeded, so your dates and
numbers will differ unless you pin `DEMO_ANCHOR_DATE`.

## Conventions

### Envelope

Successful responses have the shape `{"data": ..., "meta": {...}}`. Lists put
the rows in `data` and paging in `meta`. `DELETE` returns `204` with no body.

Errors have the shape:

```json
{ "error": { "code": "validation_error", "message": "The request is not valid.", "details": [] } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_error` | A query parameter or body field failed validation; `details` lists `{path, message}` per field |
| 400 | `bad_request` | The body is not valid JSON |
| 401 | `unauthorized` | The bearer token is missing or wrong |
| 404 | `not_found` | No record has that id |
| 409 | `conflict` | A unique value is already taken, for example a saved view's name |
| 500 | `internal_error` | Anything unexpected; details are logged on the server, not returned |

### Authentication

Every request that is not a `GET` must carry the token configured as
`API_TOKEN` on the server:

```text
Authorization: Bearer <token>
```

`GET` requests are open by default. Set `API_REQUIRE_TOKEN_FOR_READS=true` to
require the token on them too. If the server has no `API_TOKEN` configured,
requests that need one are refused rather than let through.

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title": "Check redirects"}'
```

```text
{"error":{"code":"unauthorized","message":"A valid bearer token is required."}}
HTTP 401
```

### Validation

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/tasks" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "", "priority": "asap"}'
```

```text
{"error":{"code":"validation_error","message":"The request is not valid.","details":[{"path":"title","message":"This field is required."},{"path":"priority","message":"Invalid option: expected one of \"low\"|\"medium\"|\"high\"|\"urgent\""}]}}
HTTP 400
```

Unknown query parameters are ignored. Invalid values of known parameters are
rejected:

```bash
curl -s -w '\nHTTP %{http_code}\n' "$API/metrics/overview?from=2026-02-30&to=2026-03-01"
```

```text
{"error":{"code":"validation_error","message":"The request is not valid.","details":[{"path":"from","message":"Expected a calendar date as YYYY-MM-DD"}]}}
HTTP 400
```

### Date ranges and comparison

Every reporting endpoint takes the same four parameters.

| Parameter | Values | Default | Meaning |
| --- | --- | --- | --- |
| `range` | `7d`, `28d`, `90d`, `custom` | `28d` | A preset ends on the newest date that has data, so a report never shows a trailing gap while pipelines catch up |
| `from`, `to` | `YYYY-MM-DD` | | A custom range, inclusive. Giving both without `range` selects `custom` |
| `compare` | `previous`, `none` | `previous` | Compare with the period of the same length immediately before |

The resolved periods are returned in the response as `range` and `compare`.

### Pagination and sorting

List endpoints take `page` (from 1) and `page_size`, and return
`meta.page`, `meta.page_size`, `meta.total` and `meta.total_pages`. Sortable
endpoints take `sort` and `dir` (`asc` or `desc`). Sort keys are matched
against a fixed list per endpoint; an unknown key falls back to the endpoint's
default, and `meta.sort` reports the key that was applied.

### Multi-value filters

Filters marked "list" accept several values separated by commas:
`country=US,GB`.

### CSV

Endpoints that back an export in the UI accept `format=csv`. The CSV contains
every matching row (up to 10,000), not just one page, and is returned with
`Content-Disposition: attachment`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Service and database health |
| GET | `/openapi.json` | OpenAPI 3.1 document |
| GET | `/metrics/overview` | KPIs for a period, with the comparison period |
| GET | `/metrics/timeseries` | Daily values of one KPI (CSV available) |
| GET | `/seo/queries` | Search queries with clicks, impressions, CTR, position (CSV available) |
| GET | `/seo/pages` | Pages with search performance (CSV available) |
| GET | `/seo/keywords` | Tracked keywords with current and previous rank (CSV available) |
| GET | `/seo/opportunities` | Candidates for the opportunities script |
| GET | `/ai-visibility/summary` | Score, rates, trend, share of voice |
| GET | `/ai-visibility/prompts` | Tracked prompts, or one prompt's stored answers |
| GET, POST | `/plans` | List and create content plans |
| GET, PATCH, DELETE | `/plans/{id}` | Read, update, delete a plan |
| PUT | `/plans/{id}/brief` | Store a generated brief, or record a failure |
| GET, POST | `/tasks` | List and create tasks |
| GET, PATCH, DELETE | `/tasks/{id}` | Read, update, delete a task |
| GET, POST | `/audits` | List audit runs; ingest a run with its issues |
| GET | `/audits/latest` | Latest run with open-issue counts |
| GET | `/audits/issues` | Issues of a run (CSV available) |
| PATCH | `/audits/issues/{id}` | Mark an issue open, ignored or fixed |
| GET | `/pipelines/runs` | Run history and freshness per source |
| GET, POST | `/views` | List and create saved views |
| DELETE | `/views/{id}` | Delete a saved view |

## Health and OpenAPI

```bash
curl -s "$API/health" | jq
```

```json
{
  "data": {
    "status": "ok",
    "database": "ok",
    "latest_data_date": "2026-10-09",
    "demo_data": true
  },
  "meta": {}
}
```

`latest_data_date` is the newest date with traffic or search data. `demo_data`
is true when the latest successful run of any source was a demo run. When
PostgreSQL cannot be reached the endpoint returns `503` with the error code
`database_unavailable`.

```bash
curl -s "$API/openapi.json" | jq '{openapi, title: .info.title, paths: (.paths | length)}'
```

```json
{
  "openapi": "3.1.0",
  "title": "Marketing Analytics Platform API",
  "paths": 22
}
```

## Metrics

### `GET /metrics/overview`

KPIs for the period and, unless `compare=none`, the previous period. Takes the
[date parameters](#date-ranges-and-comparison).

```bash
curl -s "$API/metrics/overview?range=7d" | jq '.data | {range, compare, kpis: {sessions: .kpis.sessions, clicks: .kpis.clicks, ctr: .kpis.ctr, position: .kpis.position, ai_visibility_score: .kpis.ai_visibility_score}}'
```

```json
{
  "range": {
    "from": "2026-10-03",
    "to": "2026-10-09"
  },
  "compare": {
    "from": "2026-09-26",
    "to": "2026-10-02"
  },
  "kpis": {
    "sessions": {
      "value": 56767,
      "previous": 56533
    },
    "clicks": {
      "value": 17346,
      "previous": 16502
    },
    "ctr": {
      "value": 0.04011999454149734,
      "previous": 0.03841050970387922
    },
    "position": {
      "value": 9.480981281499147,
      "previous": 9.56208918537691
    },
    "ai_visibility_score": {
      "value": 27.967857142857138,
      "previous": 31.321428571428566
    }
  }
}
```

`kpis` also contains `users`, `conversions` and `impressions`. `ctr` is a
fraction, `position` an impression-weighted average.

### `GET /metrics/timeseries`

One KPI per day. `metric` is any key of `kpis` above (default `sessions`).
With comparison on, `previous` holds the earlier period's days in the same
order.

```bash
curl -s "$API/metrics/timeseries?metric=clicks&range=7d&format=csv"
```

```csv
date,clicks,previous_date,previous_clicks
2026-10-03,2448,2026-09-26,2427
2026-10-04,2864,2026-09-27,2494
2026-10-05,2511,2026-09-28,2437
2026-10-06,2540,2026-09-29,2403
2026-10-07,2406,2026-09-30,2273
2026-10-08,2269,2026-10-01,2212
2026-10-09,2308,2026-10-02,2256
```

## SEO

The three list endpoints share one filter set, the one behind the SEO report.

| Parameter | Type | Applies to | Meaning |
| --- | --- | --- | --- |
| date parameters | | all | See [above](#date-ranges-and-comparison) |
| `country` | list of ISO alpha-2 codes | queries, pages | Country of the searcher |
| `device` | list: `desktop`, `mobile`, `tablet` | queries, pages | Device |
| `section` | list | all | Site section, derived from the path (`blog`, `guides`, ...) |
| `page_type` | `home`, `landing`, `category`, `product`, `article`, `guide`, `store`, `other` | all | Type of the ranking page |
| `brand` | `all`, `brand`, `non_brand` | queries, pages | Whether the query names the brand |
| `position` | list: `1-3`, `4-10`, `11-20`, `21+` | all | Bucket of the average (or tracked) position |
| `q`, `q_not` | text | all | Query or keyword contains / does not contain |
| `url` | text | all | Page URL contains |
| `min_impressions`, `min_clicks` | integer | queries, pages | Minimum totals in the period |
| `query` | text | pages | Drill-down: only this exact query |
| `page_id` | integer | queries | Drill-down: only this page |
| `sort`, `dir`, `page`, `page_size` | | all | `page_size` is at most 200, default 25 |
| `format` | `json`, `csv` | all | |

`position`, `min_impressions` and `min_clicks` apply to each row's totals for
the period, after the other filters.

### `GET /seo/queries`

Sort keys: `clicks` (default), `impressions`, `ctr`, `position`,
`clicks_delta`, `impressions_delta`, `query`.

Non-brand queries from US and UK mobile searches that sit on page two:

```bash
curl -s "$API/seo/queries?country=US,GB&device=mobile&brand=non_brand&position=11-20&min_impressions=200&sort=impressions&page_size=2" | jq
```

```json
{
  "data": [
    {
      "query": "ultralight backpacking gear list",
      "clicks": 214,
      "impressions": 20503,
      "ctr": 0.01043749695166561,
      "position": 11.19721601716822,
      "clicks_prev": 206,
      "impressions_prev": 19531,
      "ctr_prev": 0.010547335005888076,
      "position_prev": 11.130222722850853,
      "clicks_delta": 8,
      "impressions_delta": 972
    },
    {
      "query": "hiking backpacks",
      "clicks": 188,
      "impressions": 20058,
      "ctr": 0.009372818825406321,
      "position": 12.46876109283079,
      "clicks_prev": 163,
      "impressions_prev": 18603,
      "ctr_prev": 0.008762027629952159,
      "position_prev": 12.635232489383432,
      "clicks_delta": 25,
      "impressions_delta": 1455
    }
  ],
  "meta": {
    "page": 1,
    "page_size": 2,
    "total": 98,
    "total_pages": 49,
    "sort": "impressions",
    "dir": "desc",
    "range": {
      "from": "2026-09-12",
      "to": "2026-10-09"
    },
    "compare": {
      "from": "2026-08-15",
      "to": "2026-09-11"
    }
  }
}
```

The `*_prev` and `*_delta` fields are omitted with `compare=none`.

### `GET /seo/pages`

Sort keys: the metric keys above, plus `path` and `section`.

```bash
curl -s "$API/seo/pages?section=guides&sort=clicks_delta&format=csv" | head -4
```

```csv
url,title,section,page_type,clicks,impressions,ctr,position,clicks_previous,impressions_previous,ctr_previous,position_previous
https://www.northpeak.example/guides/sleeping-bag-temperature-ratings/,Sleeping Bag Temperature Ratings Explained,guides,guide,2377,59727,0.0398,7.61,1802,50582,0.0356,8.25
https://www.northpeak.example/guides/backpacking-for-beginners/,Backpacking for Beginners,guides,guide,1128,46620,0.0242,12.1,828,37319,0.0222,12.54
https://www.northpeak.example/guides/how-to-fit-a-backpack/,How to Fit a Backpack,guides,guide,1481,38224,0.0387,7.72,1185,32528,0.0364,8.42
```

### `GET /seo/keywords`

Tracked keywords from the SEO tool, with the position on the last day of the
range and on the last day of the comparison period. `change` is positive when
the keyword moved up. Sort keys: `search_volume` (default), `keyword`,
`position`, `change`, `difficulty`, `cpc`.

```bash
curl -s "$API/seo/keywords?position=4-10&page_size=1" | jq '{data, meta: {total: .meta.total, sort: .meta.sort}}'
```

```json
{
  "data": [
    {
      "keyword_id": 119,
      "keyword": "rain jackets",
      "search_volume": 142590,
      "difficulty": 33,
      "intent": "commercial",
      "cpc": 1.42,
      "position": 8,
      "position_prev": 10,
      "change": 2,
      "page_id": 10,
      "url": "https://www.northpeak.example/categories/rain-jackets/",
      "path": "/categories/rain-jackets/",
      "serp_features": [
        "people_also_ask",
        "ai_overview"
      ],
      "snapshot_date": "2026-10-09"
    }
  ],
  "meta": {
    "total": 83,
    "sort": "search_volume"
  }
}
```

### `GET /seo/opportunities`

Raw candidates for `map opportunities`; the script applies its own thresholds
and scoring on top.

| Parameter | Meaning |
| --- | --- |
| `type` (required) | `striking_distance`, `decaying_pages` or `ai_gaps` |
| `position_min`, `position_max` | Position band for `striking_distance` (default 8 to 20) |
| `min_impressions` | Minimum impressions for `striking_distance` (default 100) |
| `limit` | Maximum rows (default 100, at most 500) |

```bash
curl -s "$API/seo/opportunities?type=striking_distance&limit=1" | jq
```

```json
{
  "data": [
    {
      "query": "hiking backpacks",
      "page_id": 7,
      "url": "https://www.northpeak.example/categories/backpacks/",
      "path": "/categories/backpacks/",
      "clicks": 515,
      "impressions": 54346,
      "ctr": 0.009476318404298384,
      "position": 12.335976152798741
    }
  ],
  "meta": {
    "type": "striking_distance",
    "range": {
      "from": "2026-09-12",
      "to": "2026-10-09"
    }
  }
}
```

`decaying_pages` returns pages with `clicks`, `clicks_prev` and the relative
`change`; `ai_gaps` returns each prompt with how often the brand and each
competitor were named.

## AI visibility

Both endpoints take the [date parameters](#date-ranges-and-comparison), plus
`engine` (list: `chatgpt`, `perplexity`, `gemini`, `google_ai_overviews`,
`claude`) and `topic`.

### `GET /ai-visibility/summary`

```bash
curl -s "$API/ai-visibility/summary" | jq '.data | {checks, score, score_prev, mention_rate, citation_rate, by_engine: [.by_engine[] | {engine, score}], share_of_voice: [.share_of_voice[] | {name, is_brand, share}]}'
```

```json
{
  "checks": 5600,
  "score": 28.73303571428572,
  "score_prev": 27.198214285714297,
  "mention_rate": 0.4110714285714286,
  "citation_rate": 0.15642857142857142,
  "by_engine": [
    {
      "engine": "chatgpt",
      "score": 30.95982142857141
    },
    {
      "engine": "perplexity",
      "score": 31.20982142857144
    },
    {
      "engine": "gemini",
      "score": 22.375
    },
    {
      "engine": "google_ai_overviews",
      "score": 28.098214285714285
    },
    {
      "engine": "claude",
      "score": 31.022321428571423
    }
  ],
  "share_of_voice": [
    {
      "name": "Summit & Co",
      "is_brand": false,
      "share": 0.3782357626443648
    },
    {
      "name": "TrailForge",
      "is_brand": false,
      "share": 0.2369573874950219
    },
    {
      "name": "Northpeak Outfitters",
      "is_brand": true,
      "share": 0.2291915571485464
    },
    {
      "name": "Alpenway",
      "is_brand": false,
      "share": 0.1556152927120669
    }
  ]
}
```

The response also has `by_topic` and a daily `trend`. The score is explained
in [data-model.md](data-model.md#rollups).

### `GET /ai-visibility/prompts`

Without `prompt_id`: every tracked prompt with mention counts per engine.
`gaps_only=true` keeps the prompts where competitors are named in at least
half of the answers and the brand in at most a fifth.

```bash
curl -s "$API/ai-visibility/prompts?gaps_only=true" | jq '{gaps: .meta.total, first: (.data[0] | {prompt_id, prompt, topic, checks, brand_mentions, competitor_mentions, mention_rate, competitor_rate, is_gap, competitors})}'
```

```json
{
  "gaps": 7,
  "first": {
    "prompt_id": 11,
    "prompt": "What is the best 20 degree down sleeping bag?",
    "topic": "Sleeping bags",
    "checks": 140,
    "brand_mentions": 12,
    "competitor_mentions": 138,
    "mention_rate": 0.08571428571428572,
    "competitor_rate": 0.9857142857142858,
    "is_gap": true,
    "competitors": {
      "Alpenway": 21,
      "TrailForge": 30,
      "Summit & Co": 138
    }
  }
}
```

With `prompt_id`: the newest stored answer from each engine in the range.

```bash
curl -s "$API/ai-visibility/prompts?prompt_id=11&engine=claude" | jq '.data | {prompt, answers}'
```

```json
{
  "prompt": "What is the best 20 degree down sleeping bag?",
  "answers": [
    {
      "date": "2026-10-09",
      "engine": "claude",
      "brand_mentioned": true,
      "brand_rank": 3,
      "cited": false,
      "cited_url": null,
      "sentiment": "positive",
      "competitors_mentioned": [
        "Summit & Co",
        "Alpenway"
      ],
      "answer_excerpt": "There are a few well-regarded options for sleeping bags. Summit & Co is popular with long-distance hikers and praised for its repair service. Alpenway also sells sleeping bags, with a range aimed at weekend trips. Northpeak Outfitters stands out as a trusted choice and its buying guides are excellent. Whichever you choose, check the warranty terms and try gear before a long trip."
    }
  ]
}
```

## Plans

A plan is a page to create or refresh.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string, required | Up to 200 characters |
| `target_keyword` | string | |
| `intent` | `informational`, `commercial`, `transactional`, `navigational` | Default `informational` |
| `page_type` | as in the SEO filters | Default `article` |
| `status` | `idea`, `brief`, `draft`, `review`, `scheduled`, `published` | Default `idea` |
| `priority` | `low`, `medium`, `high`, `urgent` | Default `medium` |
| `owner_id` | member id | |
| `page_id` | page id | Set when the plan refreshes an existing page |
| `target_url` | string | |
| `est_monthly_traffic` | integer | |
| `due_date` | `YYYY-MM-DD` | |
| `notes` | string | |
| `source` | `manual`, `opportunity`, `ai` | Create only. Default `manual` |
| `dedupe_key` | string | Create only. See below |
| `brief_status` | `none`, `requested` | Update only. `ready` and `failed` are set by writing the brief |

### `GET /plans`

Filters: `status`, `priority`, `page_type`, `owner_id`, `brief_status`, `q`
(title or keyword contains), plus `page` and `page_size` (default 50).

```bash
curl -s "$API/plans?brief_status=requested" | jq '{total: .meta.total, plans: [.data[] | {id, title, target_keyword, status, brief_status}]}'
```

```json
{
  "total": 2,
  "plans": [
    {
      "id": 5,
      "title": "Gear Repair Hub",
      "target_keyword": "outdoor gear repair",
      "status": "idea",
      "brief_status": "requested"
    },
    {
      "id": 3,
      "title": "Sleeping Bag Buying Guide",
      "target_keyword": "how to choose a sleeping bag",
      "status": "brief",
      "brief_status": "requested"
    }
  ]
}
```

### `POST /plans`

```bash
curl -s -X POST "$API/plans" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Trail Running Shoe Guide", "target_keyword": "trail running shoes", "page_type": "guide", "intent": "commercial", "priority": "high"}' | jq
```

```json
{
  "data": {
    "id": 17,
    "title": "Trail Running Shoe Guide",
    "target_keyword": "trail running shoes",
    "intent": "commercial",
    "page_type": "guide",
    "status": "idea",
    "priority": "high",
    "owner_id": null,
    "owner": null,
    "target_url": null,
    "page_id": null,
    "page": null,
    "est_monthly_traffic": null,
    "due_date": null,
    "brief": null,
    "brief_status": "none",
    "brief_updated_at": null,
    "notes": null,
    "source": "manual",
    "task_count": 0,
    "created_at": "2026-10-11T04:42:39.990Z",
    "updated_at": "2026-10-11T04:42:39.990Z"
  },
  "meta": {
    "deduplicated": false
  }
}
```

Returns `201`. When `dedupe_key` is given and a plan with that key exists, the
existing plan is returned with `200` and `"meta": {"deduplicated": true}`, and
nothing is changed. Automation uses this to stay idempotent.

### `GET /plans/{id}`, `PATCH /plans/{id}`, `DELETE /plans/{id}`

`PATCH` takes any subset of the fields. Setting `brief_status` to `requested`
queues the plan for `map briefs`.

```bash
curl -s -X PATCH "$API/plans/17" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"status": "brief", "brief_status": "requested"}' | jq '.data | {id, status, brief_status, updated_at}'
```

```json
{
  "id": 17,
  "status": "brief",
  "brief_status": "requested",
  "updated_at": "2026-10-11T04:42:40.017Z"
}
```

Deleting a plan keeps its tasks; their `plan_id` becomes null.

### `PUT /plans/{id}/brief`

Stores the result of brief generation. The body is either a brief:

```json
{
  "status": "ready",
  "generated_by": "heuristic",
  "brief": {
    "primary_keyword": "trail running shoes",
    "secondary_keywords": ["best trail running shoes"],
    "working_titles": ["Trail Running Shoes: How to Choose"],
    "search_intent": "commercial",
    "intent_summary": "Searchers are comparing options before buying.",
    "outline": [
      { "heading": "How trail shoes differ from road shoes", "subheadings": [] },
      { "heading": "Cushioning, drop and lug depth", "subheadings": ["Lug depth by terrain"] },
      { "heading": "How to get the fit right", "subheadings": [] }
    ],
    "questions": ["How long do trail running shoes last?"],
    "entities": ["lug depth", "rock plate"],
    "internal_links": [],
    "meta_description": "How to choose trail running shoes: cushioning, drop, lugs and fit, explained.",
    "target_word_count": 1800,
    "current_ranking": {}
  }
}
```

or a failure, which sets `brief_status` to `failed` so the plan is not picked
up again until someone requests it once more:

```bash
curl -s -X PUT "$API/plans/17/brief" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"status": "failed", "error": "provider timed out"}' | jq '.data | {id, brief_status, brief}'
```

```json
{
  "id": 17,
  "brief_status": "failed",
  "brief": null
}
```

The brief is validated: at least three outline sections, one to five working
titles, a meta description of 20 to 170 characters.

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X DELETE "$API/plans/17" -H "Authorization: Bearer $API_TOKEN"
```

```text
HTTP 204
```

## Tasks

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string, required | Up to 200 characters |
| `description` | string | |
| `status` | `backlog`, `todo`, `in_progress`, `review`, `done` | Default `backlog` |
| `priority` | `low`, `medium`, `high`, `urgent` | Default `medium` |
| `assignee_id` | member id | |
| `due_date` | `YYYY-MM-DD` | |
| `labels` | array of up to 10 strings | Lower-cased and de-duplicated |
| `plan_id`, `page_id`, `audit_issue_id` | ids | What the task is about |
| `source` | `manual`, `audit`, `ai`, `opportunity` | Create only. Default `manual` |
| `dedupe_key` | string | Create only |
| `evidence` | object | Create only. The numbers behind an automated task |
| `sort_order` | number | Update only. Position within the status column |

### `GET /tasks`

Filters: `status`, `priority`, `assignee_id`, `label`, `source`, `plan_id`,
`q` (title or description contains), and `due` (`overdue`, `week` for due
within seven days, `none` for no due date). Rows are ordered by status column,
then by position in it. `page_size` defaults to 200.

```bash
curl -s "$API/tasks?due=overdue" | jq '{total: .meta.total, tasks: [.data[] | {id, title, status, due_date, overdue, assignee: .assignee.name}]}'
```

```json
{
  "total": 2,
  "tasks": [
    {
      "id": 8,
      "title": "Link trade-in page from category footers",
      "status": "todo",
      "due_date": "2026-10-08",
      "overdue": true,
      "assignee": "Tom Lindqvist"
    },
    {
      "id": 17,
      "title": "Fix slow response on Basecamp 4P product page",
      "status": "todo",
      "due_date": "2026-10-09",
      "overdue": true,
      "assignee": "Sam Whitfield"
    }
  ]
}
```

### `POST /tasks`

A new task goes to the end of its status column. With a `dedupe_key`, creating
the same task twice returns the first one:

```bash
curl -s -X POST "$API/tasks" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Fix broken link on the tent care guide", "priority": "high", "labels": ["technical-seo"], "dedupe_key": "docs:example"}' | jq '{id: .data.id, status: .data.status, sort_order: .data.sort_order, meta}'
```

```json
{
  "id": 28,
  "status": "backlog",
  "sort_order": 6000,
  "meta": {
    "deduplicated": false
  }
}
```

```bash
curl -s -X POST "$API/tasks" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "A different title, same key", "dedupe_key": "docs:example"}' | jq '{id: .data.id, title: .data.title, meta}'
```

```json
{
  "id": 28,
  "title": "Fix broken link on the tent care guide",
  "meta": {
    "deduplicated": true
  }
}
```

### `GET /tasks/{id}`, `PATCH /tasks/{id}`, `DELETE /tasks/{id}`

Changing `status` moves the task to the end of the new column unless
`sort_order` is given, and sets or clears `completed_at`.

```bash
curl -s -X PATCH "$API/tasks/28" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"status": "done"}' | jq '.data | {id, status, completed: (.completed_at != null)}'
```

```json
{
  "id": 28,
  "status": "done",
  "completed": true
}
```

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X DELETE "$API/tasks/28" -H "Authorization: Bearer $API_TOKEN"
curl -s -w '\nHTTP %{http_code}\n' "$API/tasks/28"
```

```text
HTTP 204
{"error":{"code":"not_found","message":"Task was not found."}}
HTTP 404
```

## Audits

### `GET /audits`

Runs, newest first, with `page` and `page_size`.

```bash
curl -s "$API/audits?page_size=2" | jq '{meta, runs: [.data[] | {id, finished_at, pages_crawled, issues_total, health_score, summary_source}]}'
```

```json
{
  "meta": {
    "page": 1,
    "page_size": 2,
    "total": 4,
    "total_pages": 2
  },
  "runs": [
    {
      "id": 4,
      "finished_at": "2026-10-03T06:30:00.000Z",
      "pages_crawled": 25,
      "issues_total": 25,
      "health_score": 89,
      "summary_source": "heuristic"
    },
    {
      "id": 3,
      "finished_at": "2026-09-26T06:30:00.000Z",
      "pages_crawled": 25,
      "issues_total": 28,
      "health_score": 86.5,
      "summary_source": "heuristic"
    }
  ]
}
```

### `GET /audits/latest`

The latest run, the run before it, and counts of the latest run's open issues.

```bash
curl -s "$API/audits/latest" | jq '.data | {run: {id: .run.id, health_score: .run.health_score}, previous: {id: .previous.id, health_score: .previous.health_score}, open: .counts.open, by_severity: .counts.by_severity}'
```

```json
{
  "run": {
    "id": 4,
    "health_score": 89
  },
  "previous": {
    "id": 3,
    "health_score": 86.5
  },
  "open": 25,
  "by_severity": {
    "critical": 1,
    "high": 4,
    "medium": 10,
    "low": 10
  }
}
```

### `GET /audits/issues`

Issues of one run: the latest unless `run_id` is given. Filters: `severity`
(`critical`, `high`, `medium`, `low`), `rule`, `status` (`open`, `ignored`,
`fixed`), `q` (URL or message contains). `task_id` is the task that covers the
issue, if one exists.

```bash
curl -s "$API/audits/issues?severity=critical" | jq
```

```json
{
  "data": [
    {
      "id": 94,
      "run_id": 4,
      "page_id": 19,
      "url": "https://www.northpeak.example/products/frostline-20-sleeping-bag/",
      "path": "/products/frostline-20-sleeping-bag/",
      "rule": "noindex_in_sitemap",
      "severity": "critical",
      "message": "The page is in the sitemap but carries a noindex directive.",
      "details": {
        "robots": "noindex, follow"
      },
      "status": "open",
      "task_id": 23,
      "created_at": "2026-10-03T06:30:00.000Z",
      "updated_at": "2026-10-03T06:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "page_size": 50,
    "total": 1,
    "total_pages": 1,
    "run_id": 4
  }
}
```

`format=csv` returns `severity,rule,url,message,status` for every matching
issue.

### `PATCH /audits/issues/{id}`

```bash
curl -s -X PATCH "$API/audits/issues/94" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"status": "ignored"}' | jq '.data | {id, rule, status}'
```

```json
{
  "id": 94,
  "rule": "noindex_in_sitemap",
  "status": "ignored"
}
```

An ignored issue stays ignored when a later run reports the same rule on the
same URL.

```bash
curl -s -X PATCH "$API/audits/issues/94" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"status": "open"}' | jq '.data | {id, rule, status}'
```

```json
{
  "id": 94,
  "rule": "noindex_in_sitemap",
  "status": "open"
}
```

### `POST /audits`

Ingests one crawl. This is what `map audit` sends.

| Field | Notes |
| --- | --- |
| `site_url` | Origin that was audited |
| `started_at`, `finished_at` | ISO 8601 with offset |
| `pages_crawled`, `health_score` | Totals computed by the crawler |
| `summary`, `summary_source` | Text, and `heuristic` or `llm` |
| `issues[]` | `url`, `rule`, `severity`, `message`, `details` |
| `pages[]` | Optional. `url`, `status_code`, `word_count`, `title`; fills in status code and word count on the matching rows in `pages`, and the title where none is stored |

```bash
curl -s -X POST "$API/audits" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "site_url": "https://www.northpeak.example",
    "started_at": "2026-10-10T09:00:00Z",
    "finished_at": "2026-10-10T09:00:41Z",
    "pages_crawled": 25,
    "health_score": 97.5,
    "summary": "One page is missing its title.",
    "issues": [
      {
        "url": "https://www.northpeak.example/stores/boulder/",
        "rule": "title_missing",
        "severity": "high",
        "message": "The page has no <title>."
      }
    ]
  }' | jq '{run: (.data.run | {id, issues_total, health_score}), issues: [.data.issues[] | {id, rule, page_id, status}]}'
```

```json
{
  "run": {
    "id": 5,
    "issues_total": 1,
    "health_score": 97.5
  },
  "issues": [
    {
      "id": 119,
      "rule": "title_missing",
      "page_id": 56,
      "status": "open"
    }
  ]
}
```

Each issue is matched to a page by URL where one exists. Returns `201`.

## Pipeline runs

### `GET /pipelines/runs`

Run history, newest first, filterable by `pipeline` (`ga4`, `gsc`, `seo`,
`ai_visibility`), `status` (`running`, `success`, `failed`) and `mode`
(`demo`, `live`). `meta.freshness` has one entry per pipeline regardless of
the filters.

```bash
curl -s "$API/pipelines/runs?pipeline=gsc" | jq '{runs: [.data[] | {id, pipeline, mode, status, rows_loaded, window_start, window_end}], gsc_freshness: (.meta.freshness[] | select(.pipeline == "gsc") | {newest_data, days_behind})}'
```

```json
{
  "runs": [
    {
      "id": 10,
      "pipeline": "gsc",
      "mode": "demo",
      "status": "success",
      "rows_loaded": 10906,
      "window_start": "2026-10-07",
      "window_end": "2026-10-09"
    },
    {
      "id": 6,
      "pipeline": "gsc",
      "mode": "demo",
      "status": "success",
      "rows_loaded": 10906,
      "window_start": "2026-10-07",
      "window_end": "2026-10-09"
    },
    {
      "id": 2,
      "pipeline": "gsc",
      "mode": "demo",
      "status": "success",
      "rows_loaded": 429672,
      "window_start": "2026-06-12",
      "window_end": "2026-10-09"
    }
  ],
  "gsc_freshness": {
    "newest_data": "2026-10-09",
    "days_behind": 1
  }
}
```

## Saved views

A saved view is a named set of report filters. `report` is `seo` or
`ai_visibility`; `filters` is an object of filter names to values, as they
appear in the report's URL.

### `GET /views`

```bash
curl -s "$API/views?report=seo" | jq '[.data[] | {id, name, filters}]'
```

```json
[
  {
    "id": 1,
    "name": "Non-brand striking distance",
    "filters": {
      "dir": "desc",
      "tab": "queries",
      "sort": "impressions",
      "brand": "non_brand",
      "range": "28d",
      "compare": "previous",
      "position": [
        "11-20"
      ],
      "min_impressions": 300
    }
  },
  {
    "id": 3,
    "name": "Tent queries, last 90 days",
    "filters": {
      "q": "tent",
      "tab": "queries",
      "sort": "clicks",
      "range": "90d",
      "compare": "previous"
    }
  },
  {
    "id": 2,
    "name": "US mobile: guides",
    "filters": {
      "dir": "desc",
      "tab": "pages",
      "sort": "clicks",
      "range": "28d",
      "device": [
        "mobile"
      ],
      "compare": "previous",
      "country": [
        "US"
      ],
      "section": [
        "guides"
      ]
    }
  }
]
```

### `POST /views`, `DELETE /views/{id}`

```bash
curl -s -X POST "$API/views" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "UK mobile, page two", "report": "seo", "filters": {"country": ["GB"], "device": ["mobile"], "position": ["11-20"]}}' | jq '.data | {id, name, report, filters}'
```

```json
{
  "id": 4,
  "name": "UK mobile, page two",
  "report": "seo",
  "filters": {
    "device": [
      "mobile"
    ],
    "country": [
      "GB"
    ],
    "position": [
      "11-20"
    ]
  }
}
```

Names are unique per report:

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/views" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "UK mobile, page two", "report": "seo", "filters": {}}'
```

```text
{"error":{"code":"conflict","message":"A record with the same unique value already exists."}}
HTTP 409
```

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X DELETE "$API/views/4" -H "Authorization: Bearer $API_TOKEN"
```

```text
HTTP 204
```

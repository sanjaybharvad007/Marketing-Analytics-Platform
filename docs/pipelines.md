# Pipelines and scripts

Everything in `pipelines/` is driven by one command, `map`, installed with the
package:

```bash
python3 -m venv pipelines/.venv
pipelines/.venv/bin/pip install -e "pipelines[dev]"      # add ,google for the live Google sources
pipelines/.venv/bin/map --help
```

| Command | What it does |
| --- | --- |
| `map migrate` | Apply pending SQL migrations from `db/migrations` |
| `map seed-demo [--days 120] [--reset]` | Migrate, load demo data for every source, and create the demo workspace |
| `map run <ga4\|gsc\|seo\|ai-visibility\|all>` | Extract, transform and load one pipeline or all of them |
| `map status` | Freshness per source |
| `map import-seo-csv FILE` | Load one SEO-tool keyword export |
| `map import-prompts FILE` | Load the prompts tracked for AI visibility |
| `map serve-demo-site` | Serve the bundled demo site for `map audit` |
| `map audit` | Crawl a site, apply the technical SEO rules, publish the run |
| `map briefs` | Write briefs for plans whose brief was requested |
| `map opportunities` | Detect opportunities and file them as tasks and plan ideas |
| `map digest` | Write the weekly Markdown digest |

Configuration comes from the environment or the `.env` file at the repository
root; see `.env.example`.

## Running a pipeline

```bash
map run all --mode demo                       # last three days, every source
map run gsc --mode live --days 7              # one source, a longer trailing window
map run ga4 --mode live --from 2026-01-01 --to 2026-03-31    # backfill
map run all --mode live --fail-fast           # stop at the first failure
```

- **Window.** By default a run covers the three days ending yesterday. GA4 and
  Search Console both revise recent days, so each nightly run re-pulls them.
  `--days N` widens the trailing window; `--from` and `--to` set an explicit
  one.
- **Idempotence.** Rows are staged with `COPY` and merged on the table's
  natural key, and rows for the staged dates that the source no longer returns
  are removed. Running the same window twice leaves the same rows.
- **Chunks and retries.** Long windows are loaded 14 days per transaction.
  Calls that fail with a timeout, a connection error, HTTP 429 or a 5xx are
  retried up to four times with exponential backoff.
- **Bookkeeping.** Every run is recorded in `pipeline_runs`. When `all` is
  run, a failing pipeline is recorded and the others still run, unless
  `--fail-fast` is given. The exit code is non-zero if any pipeline failed.
- **Rollups.** After a successful load the materialized views are refreshed
  concurrently.
- **Rejected rows.** A row that fails validation is logged, counted and
  skipped. The count is shown in the run's summary table.

Example output:

```text
$ map run all --mode demo --days 3
Window 2026-10-07 to 2026-10-09 (demo mode)
┏━━━━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━┓
┃ Pipeline      ┃ Status  ┃ Rows loaded ┃ Rejected ┃ Seconds ┃ Error ┃
┡━━━━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━┩
│ ga4           │ success │ 6,123       │ 0        │ 1.5     │       │
│ gsc           │ success │ 10,906      │ 0        │ 2.7     │       │
│ seo           │ success │ 492         │ 0        │ 0.1     │       │
│ ai_visibility │ success │ 600         │ 0        │ 0.4     │       │
└───────────────┴─────────┴─────────────┴──────────┴─────────┴───────┘
```

## Connectors

Each source has a demo and a live implementation of the same small interface:
`fetch(window)` yields raw rows in the upstream API's format. The transform
and load code does not know which one it is reading from.

### GA4 (`sources/ga4.py`)

Calls `properties.runReport` on the GA4 Data API.

| Dimensions | Metrics |
| --- | --- |
| `date`, `pagePath`, `sessionDefaultChannelGroup`, `deviceCategory`, `countryId` | `sessions`, `totalUsers`, `engagedSessions`, `keyEvents` (stored as conversions), `totalRevenue` |

Results are paged 100,000 rows at a time. `countryId` is used instead of the
country name because it is already an ISO code. Smart-TV traffic is counted as
desktop.

To go live:

1. `pip install -e "pipelines[google]"`.
2. Create a Google Cloud service account and download its JSON key.
3. In GA4 Admin, add the service account's email to the property with the
   Viewer role.
4. Set `GOOGLE_APPLICATION_CREDENTIALS` to the key file and `GA4_PROPERTY_ID`
   to the numeric property ID.
5. `map run ga4 --mode live --days 7`.

### Search Console (`sources/gsc.py`)

Calls `searchanalytics.query` with the dimensions `date`, `page`, `query`,
`country` and `device`, search type `web`, and `dataState: final`, 25,000 rows
per request with `startRow` paging.

Position is converted to an impression-weighted sum on the way in (see
[data-model.md](data-model.md#gsc_daily)), country codes from alpha-3 to
alpha-2, and each query is flagged as brand or non-brand with
`BRAND_QUERY_PATTERN`. URLs on other hosts are rejected.

To go live, use the same service account: add its email as a user of the
Search Console property and set `GSC_SITE_URL` to the property exactly as
Search Console names it (`sc-domain:example.com` or
`https://www.example.com/`).

Search Console anonymises rare queries, so query-level rows add up to less
than the property totals. That is a property of the API, not of the load.

### SEO tool exports (`sources/seo_csv.py`)

Rank trackers are read from CSV exports rather than vendor APIs.

- **Nightly:** put keyword exports in `SEO_EXPORT_DIR` (default
  `pipelines/exports`). The date is taken from the file name, for example
  `positions-2026-10-01.csv`. `map run seo --mode live` loads the files whose
  date falls in the window.
- **One file:** `map import-seo-csv positions-2026-10-01.csv --mapping ahrefs`.

Column names are mapped by a preset or a JSON file:

| Field | `semrush` | `ahrefs` |
| --- | --- | --- |
| keyword | `Keyword` | `Keyword` |
| position | `Position` | `Current position` |
| url | `URL` | `Current URL` |
| search volume | `Search Volume` | `Volume` |
| difficulty | `Keyword Difficulty` | `KD` |
| CPC | `CPC` | `CPC` |
| intent | `Keyword Intents` | not exported; inferred from the keyword |
| SERP features | `SERP Features by Keyword` | `SERP features` |
| date | `Timestamp` | `Current date` |

A custom mapping names the columns of any other export:

```json
{
  "keyword": "term",
  "position": "rank",
  "url": "landing_page",
  "search_volume": "volume",
  "serp_features": "features"
}
```

Pass it with `--mapping path/to/mapping.json`, or set `SEO_CSV_PRESET` to the
path. The reader detects comma, tab or semicolon delimiters and UTF-8 or
UTF-16 encodings, and treats a position such as `100+` as "not ranking".

Domain authority is read from files named `domain-metrics*.csv` with the
columns `date,domain,authority_score,referring_domains,backlinks`.

### AI visibility (`sources/ai_visibility.py`, `sources/mentions.py`)

Each run asks every configured answer engine every active prompt in
`ai_prompts`, then parses the answer text.

Prompts are kept in a CSV file and loaded with `map import-prompts`:

```csv
prompt,topic,intent
What is the best two-person backpacking tent?,Tents,commercial
How do sleeping bag temperature ratings work?,Sleeping bags,informational
```

`intent` is optional. Importing again updates topics and re-activates prompts;
`--replace` also deactivates prompts that are no longer in the file. Their
history stays.

An engine is asked when both `AI_ENGINE_<NAME>_API_KEY` and
`AI_ENGINE_<NAME>_MODEL` are set:

| Engine | Called through |
| --- | --- |
| `CHATGPT` | OpenAI chat completions |
| `PERPLEXITY` | Perplexity's OpenAI-compatible endpoint |
| `GEMINI` | Gemini's OpenAI-compatible endpoint |
| `CLAUDE` | Anthropic Messages API |

Google AI Overviews has no public API. The engine exists in the data model and
in demo data, but there is no live connector for it.

An engine can only be asked "now", so a live run stores its answers under the
last day of the window. A failing engine is logged and skipped; the run fails
only if no engine answered.

The parser (`mentions.py`) is deterministic and makes no model calls. For each
answer it records:

- **brand mentioned**: the brand name or one of `BRAND_ALIASES` appears,
  tolerant of spacing, hyphens and `&`/`and`. A URL on the brand's domain does
  not count as a mention.
- **brand rank**: its position among the tracked brands in order of first
  mention.
- **cited**: the answer contains a URL on the brand's domain; the first such
  URL is stored.
- **sentiment**: positive, neutral or negative, from a word list applied to
  the sentences that name the brand, with simple negation handling.
- **competitors mentioned**, from `COMPETITORS`.

## Demo data

`map seed-demo` generates 120 days for the fictional retailer Northpeak
Outfitters (`https://www.northpeak.example`): about 60 pages, 300 search
queries, 160 tracked keywords, 40 AI prompts, five countries and three
devices, plus a workspace of members, plans, tasks, saved views and four
weekly audit runs.

The generator (`demo/`) is deterministic. Each value is a pure function of
`DEMO_SEED`, the anchor date and the entity it belongs to, so re-running any
window reproduces the same rows, and two machines with the same seed and
anchor date get the same database. The anchor defaults to today; set
`DEMO_ANCHOR_DATE` to pin it.

Patterns planted in the data, so the reports have something to show:

- weekly seasonality, with weekends stronger than midweek;
- the guides section growing through the period, and a product launched part
  of the way through;
- two blog posts losing clicks and positions (the opportunities script finds
  them as decaying pages);
- a set of non-brand queries sitting at positions 8 to 20 with high
  impressions (striking distance);
- one competitor, Summit & Co, named in most AI answers about sleeping bags
  and sustainability while Northpeak rarely is (AI-visibility gaps).

Demo sources emit rows in the upstream format (GA4's `YYYYMMDD` dates, Search
Console's `keys` arrays and alpha-3 countries), and the demo answer engine
writes answer text that the real mention parser then analyses. Demo runs
therefore exercise the same transform and load code as live runs.

## Scripts

The four scripts talk to the web app's REST API (`API_BASE_URL`, `API_TOKEN`),
so the web app must be running. They are safe to re-run.

### `map audit`

```bash
map serve-demo-site &            # the bundled site, on http://localhost:8200
map audit                        # crawls it and publishes the run
map audit --url https://www.example.com/ --max-pages 300
map audit --no-publish           # print the findings only
```

The crawler starts from the given URL, reads `robots.txt` and the sitemap,
follows internal links breadth-first with bounded concurrency, and records
status codes, response times and redirect chains. It parses static HTML; it
does not run JavaScript.

When the crawl URL is a local copy of the site (localhost or a container
name), `--public-origin` (default `SITE_URL`) is the address the site is
published under, so issues and pages are stored with their public URLs.

Rules (`audit/rules.py`):

| Rule | Severity | Finds |
| --- | --- | --- |
| `noindex_in_sitemap` | critical | Noindex on a page listed in the sitemap |
| `title_missing` | high | Missing title tag |
| `canonical_mismatch` | high | Canonical points to a different URL |
| `broken_internal_link` | high | Internal links to pages that return an error |
| `sitemap_url_error` | high | Sitemap lists a URL that does not resolve |
| `title_duplicate` | medium | Title shared with other pages |
| `meta_description_missing` | medium | Missing meta description |
| `h1_missing` | medium | Missing H1 |
| `canonical_missing` | medium | Missing canonical tag |
| `thin_content` | medium | Fewer than 200 words of main content |
| `redirect_chain` | medium | Internal links that pass through two or more redirects |
| `insecure_link` | medium | Links that use `http://` |
| `slow_response` | medium | Response slower than 800 ms |
| `orphan_page` | medium | In the sitemap, but no crawled page links to it |
| `title_too_long`, `title_too_short` | low | Title outside 15 to 60 characters |
| `meta_description_too_long`, `meta_description_too_short` | low | Description outside 70 to 160 characters |
| `meta_description_duplicate` | low | Description shared with other pages |
| `h1_multiple` | low | More than one H1 |
| `image_alt_missing` | low | Images without an alt attribute |
| `structured_data_missing` | low | No JSON-LD on a product, article or guide page |
| `open_graph_missing` | low | Missing `og:title`, `og:description` or `og:image` |

The health score is `100 * (1 - penalties / (pages * 20))`, where each issue
costs its page 10, 5, 2 or 0.5 points by severity, capped at 20 per page.

Publishing stores the run through `POST /audits` and opens one task per
critical or high issue. Tasks are keyed by rule and URL, so an issue that
persists across audits keeps its original task, and an issue marked "ignored"
in the UI does not get one.

The bundled demo site (`pipelines/demo_site`) is 25 pages with one or two of
each problem planted, and produces 25 issues.

### `map briefs`

Picks up plans whose brief was requested in the planner
(`brief_status = requested`). For each plan it gathers, through the API, the
queries related to the target keyword with their clicks and positions, the
tracked keyword's volume and current rank, and candidate pages for internal
links. From those it builds a brief: working titles, search intent, an
outline, questions to answer, terms to cover, internal links, a meta
description and a target length. The result is stored with
`PUT /plans/{id}/brief`; a plan that fails is marked `failed`.

### `map opportunities`

```bash
map opportunities --dry-run      # detect and print only
map opportunities                # file the top eight of each kind
```

| Kind | Detected when | Filed as |
| --- | --- | --- |
| Striking distance | A query averages position 8 to 20 with at least 500 impressions and a CTR below 75% of the benchmark for its position. Scored by the clicks gained from reaching position 5 | Task |
| Decaying page | A page had at least 100 clicks in the previous period and lost 25% or more. Scored by clicks lost | Task |
| AI-visibility gap | Competitors are named in at least half of the answers to a prompt and the brand in at most a fifth | Plan idea |

Each record carries a dedupe key (`opportunity:striking:<query>`,
`opportunity:decay:<url>`, `opportunity:ai-gap:<prompt id>`), so a second run
reports existing records instead of creating new ones:

```text
25 opportunities found; 0 new record(s) created, 17 already existed.
```

### `map digest`

Builds a Markdown digest for a period (`--range 7d` by default): KPIs against
the previous period, the pages gaining and losing the most clicks, the latest
audit, and AI visibility by engine. It is written to
`pipelines/reports/digest-<end date>.md` and printed to standard output.

## Using an LLM

Three outputs are prose: the audit summary, the brief and the digest's opening
paragraph. `LLM_PROVIDER` selects who writes them.

| `LLM_PROVIDER` | Settings | Behaviour |
| --- | --- | --- |
| `offline` (default) | none | Rule-based text. No network calls |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic Messages API |
| `openai` | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | Any OpenAI-compatible chat completions endpoint |

The numbers and findings are always computed by code. The model is asked to
write them up as JSON matching a schema; the reply is validated, the model
gets one chance to correct an invalid reply, and the rule-based version is
used if that fails or the provider is unreachable. Stored audits and briefs
record which of the two wrote them (`summary_source`, `generated_by`).

## Scheduling

The pipelines are plain batch commands. A typical schedule:

```cron
# m  h  dom mon dow
30   5  *   *   *    cd /srv/map && pipelines/.venv/bin/map run all --mode live --days 3
0    6  *   *   *    cd /srv/map && pipelines/.venv/bin/map opportunities
0    6  *   *   1    cd /srv/map && pipelines/.venv/bin/map audit --url https://www.example.com/
30   6  *   *   1    cd /srv/map && pipelines/.venv/bin/map digest
```

`.github/workflows/pipelines.yml` is the same nightly run as a scheduled
GitHub Actions workflow. It stays disabled until the repository variable
`PIPELINES_ENABLED` is set to `true`, and reads its credentials from
repository secrets.

Set `LOG_FORMAT=json` in scheduled environments to get one JSON object per log
line.

## Adding a source

1. Write a class with `name`, `mode` and `fetch(window)` in `sources/`, with a
   demo twin that yields rows in the same shape.
2. Add a record model in `models.py` and a transform in `etl/transforms.py`.
3. Add a migration for the table, with a natural primary key, and a load in
   `etl/load.py`.
4. Register the pipeline in `etl/pipelines.py`.
5. Mirror the table in `web/src/db/schema.ts`; the schema-drift test fails
   until it matches.

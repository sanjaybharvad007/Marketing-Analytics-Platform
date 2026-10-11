# Marketing Analytics Platform

An internal tool for a marketing team: reporting on web analytics, search and
AI visibility, planning pages, and managing the work that comes out of both.

- **Web app** (`web/`): Next.js and TypeScript. Dashboards, an SEO report with
  URL-stored filters, an AI-visibility report, a page planner, a kanban board,
  site audits, and a REST API over the same data.
- **Pipelines** (`pipelines/`): a Python package with the `map` command. It
  loads GA4, Search Console, SEO-tool exports and answer-engine results into
  PostgreSQL, and runs the scripts that audit a site, write content briefs,
  file opportunities as tasks, and produce a weekly digest.
- **Database** (`db/migrations/`): one PostgreSQL schema, defined in plain SQL,
  shared by both sides.

The repository ships a deterministic demo dataset for a fictional retailer,
Northpeak Outfitters, so everything runs without credentials. The UI shows a
"Demo data" marker whenever the latest successful run of any source was a demo
run.

![Overview dashboard](docs/images/overview.png)

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Screenshots](#screenshots)
- [Configuration](#configuration)
- [Going live](#going-live)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Limitations](#limitations)

Further reading: [architecture](docs/architecture.md),
[data model](docs/data-model.md), [REST API](docs/api.md),
[pipelines and scripts](docs/pipelines.md).

## What it does

| Area | What you get | Where it lives |
| --- | --- | --- |
| Overview | KPIs with change against the previous period, traffic trend, sessions by channel, pages gaining and losing clicks, data freshness, open audit issues, tasks due | `web/src/app/page.tsx`, `web/src/lib/services/overview.ts` |
| SEO report | Queries, pages and tracked keywords with filters for date range and comparison, country, device, section, page type, brand or non-brand, position bucket, query text, URL, minimum impressions and clicks. Filters live in the URL. Server-side sorting and pagination, per-column deltas, a trend that follows the filters, drill-down, CSV export, saved views | `web/src/app/reports/seo/`, `web/src/lib/filters/`, `web/src/lib/services/seo.ts` |
| AI visibility | Visibility score, mention and citation rate by answer engine, share of voice against competitors, per-prompt results with the stored answers, and the prompts where competitors are named and the brand is not | `web/src/app/reports/ai-visibility/`, `web/src/lib/services/ai-visibility.ts`, `pipelines/src/map_pipelines/sources/mentions.py` |
| Planner | Content plans as a table or a status pipeline, linked to existing pages and their current metrics, with a structured brief per plan | `web/src/app/planner/`, `web/src/lib/services/plans.ts` |
| Work | Kanban board with drag and drop, list view, filters, tasks linked to plans, pages and audit issues | `web/src/app/work/`, `web/src/components/work/`, `web/src/lib/services/tasks.ts` |
| Audits | Crawl results per run: health score, summary, issues by rule and severity, issue triage, task creation | `web/src/app/audits/`, `pipelines/src/map_pipelines/audit/` |
| Pipelines page | Freshness per source and the run history | `web/src/app/pipelines/`, `web/src/lib/services/pipelines.ts` |
| REST API | The same services under `/api/v1`, with an OpenAPI document generated from the Zod schemas | `web/src/app/api/v1/`, `web/src/lib/api/` |
| Data pipelines | Connectors for GA4, Search Console, SEO-tool CSV exports and answer engines, each with a demo and a live source; idempotent loads; run bookkeeping | `pipelines/src/map_pipelines/sources/`, `pipelines/src/map_pipelines/etl/` |
| Automation scripts | `map audit`, `map briefs`, `map opportunities`, `map digest`. They read and write through the REST API and can use an LLM for the prose | `pipelines/src/map_pipelines/{audit,briefs,opportunities,digest,llm}/` |

The scripts work without an LLM. With `LLM_PROVIDER=offline` (the default) the
audit summary, the briefs and the digest narrative are produced by rules. With
a provider configured, the model writes them, its JSON is validated against a
schema, and the rule-based version is the fallback when the model's answer
does not validate.

## Architecture

```mermaid
flowchart LR
  subgraph Sources
    GA4[GA4 Data API]
    GSC[Search Console API]
    SEO[SEO-tool CSV exports]
    ENG[Answer engines]
  end

  subgraph pipelines["pipelines/ (Python, map CLI)"]
    ETL[Connectors and ETL]
    SCRIPTS[audit, briefs,<br/>opportunities, digest]
  end

  PG[(PostgreSQL)]

  subgraph web["web/ (Next.js)"]
    SVC[Services]
    UI[Pages and server actions]
    API[REST API /api/v1]
  end

  GA4 --> ETL
  GSC --> ETL
  SEO --> ETL
  ENG --> ETL
  ETL -->|COPY, upsert, refresh rollups| PG
  PG <--> SVC
  SVC --> UI
  SVC --> API
  API -->|metrics, plans, opportunities| SCRIPTS
  SCRIPTS -->|audit runs, briefs, tasks| API
```

The pipelines are the only writers of the source tables. The web app owns the
workflow tables (plans, tasks, audits, saved views), and the scripts reach
those through the REST API with a bearer token, never through SQL. Pages and
REST handlers call the same service functions, so a number on a dashboard and
the same number from the API come from one query. See
[docs/architecture.md](docs/architecture.md).

## Quickstart

You need Docker, Python 3.11 or newer and Node.js 20.12 or newer. The project
is developed on Python 3.13 and Node.js 22.

```bash
# 1. Configuration: the defaults work for local development.
cp .env.example .env

# 2. PostgreSQL 16 on localhost:5432.
docker compose up -d --wait postgres

# 3. Pipelines: install, create the schema, load the demo dataset.
python3 -m venv pipelines/.venv
pipelines/.venv/bin/pip install -e "pipelines[dev]"
pipelines/.venv/bin/map migrate
pipelines/.venv/bin/map seed-demo        # about a minute; 120 days of data

# 4. Web app on http://localhost:3000.
cd web
npm ci
npm run dev
```

If you already run PostgreSQL 16, skip step 2 and set `DATABASE_URL` in `.env`.
The database needs the `pg_trgm` extension, which ships with PostgreSQL.

`make setup`, `make db`, `make seed` and `make dev` wrap the same commands;
`make help` lists the rest.

### Run the automation scripts

With the web app running, in a second terminal at the repository root:

```bash
pipelines/.venv/bin/map serve-demo-site &   # a small site with planted SEO problems, on :8200
pipelines/.venv/bin/map audit               # crawl it, publish the run, open tasks for severe issues
pipelines/.venv/bin/map briefs              # write briefs for plans marked "Request AI brief"
pipelines/.venv/bin/map opportunities       # file striking-distance, decay and AI-gap findings
pipelines/.venv/bin/map digest              # weekly Markdown digest in pipelines/reports/
```

Each script is safe to run again: tasks and plan ideas carry a dedupe key, so
a second run reports the existing records instead of creating duplicates.

To load new days the way a nightly job would:

```bash
pipelines/.venv/bin/map run all --mode demo --days 3
pipelines/.venv/bin/map status
```

### Everything in Docker

```bash
docker compose up --build
```

This starts PostgreSQL, applies the migrations, loads the demo data and serves
the production build of the web app on port 3000. The CLI is available as a
one-off container:

```bash
docker compose --profile tools run --rm pipelines status
```

## Screenshots

| | |
| --- | --- |
| SEO report with filters applied ![SEO report](docs/images/seo-report.png) | AI visibility ![AI visibility](docs/images/ai-visibility.png) |
| Planner ![Planner](docs/images/planner.png) | A content brief ![Content brief](docs/images/planner-brief.png) |
| Work board ![Work board](docs/images/board.png) | Audits ![Audits](docs/images/audits.png) |
| Pipelines ![Pipelines](docs/images/pipelines.png) | Overview, dark theme ![Overview in the dark theme](docs/images/overview-dark.png) |

The images are captured from the demo dataset by `npm run screenshots` in
`web/`.

## Configuration

Both sides read one `.env` file at the repository root; real environment
variables take precedence. `.env.example` documents every variable. The ones
that matter most:

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | both | `postgres://postgres:postgres@localhost:5432/marketing` | PostgreSQL connection string |
| `API_TOKEN` | both | empty | Bearer token for API writes. The API refuses writes while it is empty |
| `API_REQUIRE_TOKEN_FOR_READS` | web | `false` | Also require the token on `GET` requests |
| `API_BASE_URL` | pipelines | `http://localhost:3000` | Where the scripts reach the web app |
| `SITE_URL`, `BRAND_NAME` | both | Northpeak demo values | The tracked site and brand |
| `BRAND_ALIASES`, `BRAND_QUERY_PATTERN`, `COMPETITORS` | pipelines | Northpeak demo values | How brand queries, brand mentions and competitors are recognised |
| `DEMO_SEED`, `DEMO_ANCHOR_DATE` | pipelines | `20260101`, today | Make the demo dataset reproducible |
| `GA4_PROPERTY_ID`, `GSC_SITE_URL`, `GOOGLE_APPLICATION_CREDENTIALS` | pipelines | empty | Live Google sources |
| `SEO_EXPORT_DIR`, `SEO_CSV_PRESET` | pipelines | `pipelines/exports`, `semrush` | Where SEO-tool exports are read from and how their columns map |
| `AI_ENGINE_<NAME>_API_KEY`, `AI_ENGINE_<NAME>_MODEL` | pipelines | empty | Answer engines asked in live mode (`CHATGPT`, `PERPLEXITY`, `GEMINI`, `CLAUDE`) |
| `LLM_PROVIDER` | pipelines | `offline` | `offline`, `anthropic` or `openai` (any OpenAI-compatible endpoint) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | pipelines | empty, `claude-sonnet-5-5` | Used when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | pipelines | empty | Used when `LLM_PROVIDER=openai` |
| `LOG_FORMAT`, `LOG_LEVEL` | pipelines | `console`, `INFO` | `json` writes one object per line |

## Going live

Demo and live sources sit behind the same interface, and demo sources emit rows
in the upstream API's own vocabulary, so the transforms and loads that run on
demo data are the ones that run on real data. Switching a source to live is a
matter of credentials and `--mode live`.

1. **Start from an empty database.** Demo and live rows share tables, so do not
   mix them: `map migrate` on a new database, without `seed-demo`.
2. **Describe the site.** Set `SITE_URL`, `BRAND_NAME`, `BRAND_ALIASES`,
   `BRAND_QUERY_PATTERN` and `COMPETITORS`.
3. **GA4 and Search Console.** Install the Google client libraries with
   `pip install -e "pipelines[google]"`. Create a service account, give it
   Viewer access to the GA4 property and add it as a user on the Search Console
   property, then set `GOOGLE_APPLICATION_CREDENTIALS`, `GA4_PROPERTY_ID` and
   `GSC_SITE_URL`.
4. **SEO tool.** Export tracked keywords as CSV into `SEO_EXPORT_DIR` with the
   date in the file name (`positions-2026-10-01.csv`). Semrush and Ahrefs
   column names are built in; any other layout takes a small JSON mapping.
5. **AI visibility.** Load the prompts to track with
   `map import-prompts prompts.csv`, then set a key and model for each engine
   you want asked.
6. **Backfill, then schedule.**
   ```bash
   map run ga4 --mode live --from 2026-01-01 --to 2026-09-30
   map run gsc --mode live --from 2026-06-01 --to 2026-09-30
   map run all --mode live --days 3      # the nightly command
   ```
   `.github/workflows/pipelines.yml` shows the nightly run as a scheduled
   GitHub Actions job; the same command works from cron.
7. **LLM.** Set `LLM_PROVIDER` and its key to have a model write the audit
   summary, the briefs and the digest narrative.
8. **Access.** Set a long random `API_TOKEN`, and put the web app behind your
   own authentication (see [Limitations](#limitations)).

[docs/pipelines.md](docs/pipelines.md) covers each connector in detail.

## Testing

```bash
make test        # both suites, integration tests included
make lint        # ruff, eslint, tsc, prettier
make e2e         # Playwright, against a production build and the demo data
```

Integration tests need a second database that they are free to wipe:

```bash
docker compose exec postgres createdb -U postgres marketing_test
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/marketing_test
```

Without `TEST_DATABASE_URL` those tests are skipped and the rest still run.

| Suite | Command | Covers |
| --- | --- | --- |
| Pipelines | `cd pipelines && .venv/bin/pytest` | URL, country and device normalisation; the demo generator's determinism and planted stories; each connector's request building and response mapping against fakes; CSV presets and custom mappings; the mention parser; LLM JSON extraction, validation, repair and fallback; audit rules, crawler, scoring; briefs, opportunity detection, digest; migrations and idempotent loads against PostgreSQL |
| Web | `cd web && npm test` | Filter parsing and serialisation round-trips, the SQL condition builder, date-range maths, formatters, API validation and auth, CSV output, the OpenAPI document, a check that the Drizzle schema matches the live database, and service-level tests against PostgreSQL |
| Browser | `cd web && npm run build && npm run e2e` | Every page in both themes with no console errors, the SEO filters (URL, table, back and forward, saved views, CSV download), drag and drop on the board persisting after a reload, creating, editing and deleting plans and tasks |

CI (`.github/workflows/ci.yml`) runs the pipelines and web suites, both with a
PostgreSQL service, plus lint, type-check, formatting and the production
build. The browser tests are run locally.

## Project structure

```text
.
├── db/migrations/           SQL migrations: the single definition of the schema
├── pipelines/
│   ├── src/map_pipelines/
│   │   ├── sources/         GA4, Search Console, SEO CSV, answer engines; mention parser
│   │   ├── demo/            deterministic demo dataset generator
│   │   ├── transform/       URL, country, device and brand normalisation
│   │   ├── etl/             validation, COPY and upsert loads, run bookkeeping
│   │   ├── llm/             provider abstraction and validated structured output
│   │   ├── audit/           crawler, rules, health score, summary
│   │   ├── briefs/          content brief builder
│   │   ├── opportunities/   striking distance, decay and AI-gap detection
│   │   ├── digest/          weekly Markdown digest
│   │   └── cli.py           the `map` command
│   ├── demo_site/           static site with planted SEO problems, for `map audit`
│   └── tests/
├── web/
│   ├── src/app/             pages and /api/v1 route handlers
│   ├── src/components/      UI components, charts, feature views
│   ├── src/db/              Drizzle schema mirror and client
│   ├── src/lib/services/    queries and mutations shared by pages and the API
│   ├── src/lib/filters/     URL filter schemas, SQL conditions, chips
│   ├── src/lib/api/         envelope, auth, validation, CSV, OpenAPI
│   ├── src/lib/actions/     server actions used by the UI
│   └── e2e/                 Playwright specs
├── docs/                    architecture, data model, API and pipeline docs
├── docker-compose.yml
└── Makefile
```

## Limitations

- **No user accounts.** There is no login, SSO or per-user permission. It is a
  single-tenant internal tool: the pages and their server actions are open to
  anyone who can reach the app, and the REST API is protected by one shared
  token. Run it behind your own authenticating proxy or VPN.
- **Live connectors are tested against fakes.** The GA4, Search Console and
  LLM integrations are covered by unit tests that check request construction
  and response handling with stand-in clients. The test suite makes no calls
  to the real services.
- **The demo data is synthetic.** It is generated to contain recognisable
  patterns (a growing section, decaying pages, queries just off page one, a
  competitor ahead in AI answers) and says nothing about real search behaviour.
- **AI visibility is an approximation.** Live mode asks each engine's API, and
  an API answer can differ from what the consumer product shows a signed-in
  user. Google AI Overviews has no public API, so that engine has demo data
  only. Mentions, rank and sentiment come from a rule-based English parser,
  not a model.
- **SEO-tool data arrives as CSV exports**, not through the vendors' APIs.
- **"Users" is a sum of daily users.** A person who visits on two days counts
  twice in any multi-day total, because daily rows cannot be deduplicated.
- **The crawler reads static HTML.** It does not execute JavaScript, stays on
  one host and stops at 500 pages by default.
- **Rollups are refreshed in full** after each load. That is quick at this
  data size; a much larger site would want incremental aggregation.
- **Timestamps are shown in UTC**, and saved views exist for the SEO report
  only.

## License

MIT. See [LICENSE](LICENSE).

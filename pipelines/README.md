# map-pipelines

The Python side of the Marketing Analytics Platform: source connectors, the
ETL that loads them into PostgreSQL, and the scripts that audit a site, write
content briefs, file opportunities and produce a weekly digest. It installs
one command, `map`.

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"        # add ",google" for the live GA4 and Search Console sources
.venv/bin/map --help
```

Configuration is read from environment variables or the `.env` file at the
repository root (see `../.env.example`).

```bash
.venv/bin/map migrate                    # create or update the schema
.venv/bin/map seed-demo                  # load the demo dataset
.venv/bin/map run all --mode demo        # load the last three days again
.venv/bin/map status
```

## Layout

```text
src/map_pipelines/
  cli.py            the `map` command
  config.py         settings
  db.py             connection pool, COPY staging helpers
  migrate.py        SQL migration runner
  models.py         validated record types
  prompts.py        tracked-prompt import
  api_client.py     client for the web app's REST API
  sources/          GA4, Search Console, SEO CSV, answer engines, mention parser
  demo/             deterministic demo data generator
  transform/        URL, country, device and brand normalisation
  etl/              transforms, loads, pipeline definitions, runner
  llm/              providers and validated structured output
  audit/            crawler, rules, health score, summary
  briefs/           content brief builder
  opportunities/    opportunity detection and filing
  digest/           weekly digest
demo_site/          static site with planted SEO problems, for `map audit`
tests/              unit tests; tests/integration needs PostgreSQL
```

## Tests

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/pytest

# Integration tests need a database they may wipe.
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/marketing_test .venv/bin/pytest
```

Full documentation is in [`../docs/pipelines.md`](../docs/pipelines.md).

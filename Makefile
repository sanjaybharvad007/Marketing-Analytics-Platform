# Common tasks for local development. Run `make help` for the list.

VENV := pipelines/.venv
MAP  := $(VENV)/bin/map
TEST_DATABASE_URL ?= postgres://postgres:postgres@localhost:5432/marketing_test

.DEFAULT_GOAL := help
.PHONY: help setup env db db-test db-stop migrate seed reseed pipelines status dev build start \
        demo-site audit briefs opportunities digest test test-web test-pipelines e2e screenshots \
        lint format clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Setup ----------------------------------------------------------------------

setup: env ## Create the Python venv, install both sides' dependencies
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install --upgrade pip
	$(VENV)/bin/pip install -e "pipelines[dev]"
	cd web && npm ci

env: ## Create .env from .env.example if it does not exist
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")

# --- Database -------------------------------------------------------------------

db: ## Start PostgreSQL in Docker and wait until it accepts connections
	docker compose up -d --wait postgres

db-test: ## Create the database used by the integration tests
	docker compose exec postgres createdb -U postgres marketing_test || true

db-stop: ## Stop the Docker services (data is kept in the pgdata volume)
	docker compose down

migrate: ## Apply pending SQL migrations
	$(MAP) migrate

seed: ## Migrate, then load the demo dataset and workspace
	$(MAP) seed-demo

reseed: ## Empty every table and load the demo dataset again
	$(MAP) seed-demo --reset

pipelines: ## Run all pipelines in demo mode for the last three days
	$(MAP) run all --mode demo --days 3

status: ## Show data freshness per source
	$(MAP) status

# --- Web app --------------------------------------------------------------------

dev: ## Start the web app in development mode on http://localhost:3000
	cd web && npm run dev

build: ## Build the web app for production
	cd web && npm run build

start: ## Serve the production build on http://localhost:3000
	cd web && npm run start

# --- Scripts that talk to the running web app ---------------------------------------

demo-site: ## Serve the bundled demo site on http://localhost:8200 for `make audit`
	$(MAP) serve-demo-site

audit: ## Crawl the demo site and publish the audit
	$(MAP) audit

briefs: ## Write briefs for plans whose brief was requested
	$(MAP) briefs

opportunities: ## File tasks and plan ideas for detected opportunities
	$(MAP) opportunities

digest: ## Write the weekly digest to pipelines/reports
	$(MAP) digest

# --- Quality ----------------------------------------------------------------------

test: test-pipelines test-web ## Run both test suites (integration tests included)

test-pipelines: ## Python tests; integration tests use TEST_DATABASE_URL
	cd pipelines && TEST_DATABASE_URL=$(TEST_DATABASE_URL) .venv/bin/pytest

test-web: ## Vitest unit and integration tests
	cd web && TEST_DATABASE_URL=$(TEST_DATABASE_URL) npm test

e2e: ## Playwright browser tests against a production build and the demo data
	cd web && npm run build && npm run e2e

screenshots: ## Regenerate docs/images from a production build
	cd web && npm run build && npm run screenshots

lint: ## Lint, type-check and check formatting on both sides
	cd pipelines && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd web && npm run lint && npm run typecheck && npm run format:check

format: ## Apply formatters on both sides
	cd pipelines && .venv/bin/ruff check --fix . && .venv/bin/ruff format .
	cd web && npm run format

clean: ## Remove build output and caches (keeps node_modules and the venv)
	rm -rf web/.next web/test-results web/playwright-report web/tsconfig.tsbuildinfo
	rm -rf pipelines/.pytest_cache pipelines/.ruff_cache pipelines/reports
	find pipelines -name __pycache__ -type d -prune -exec rm -rf {} +

# syntax=docker/dockerfile:1
# Build context: the repository root, because the image also carries db/migrations.
#
# The package is installed in editable mode under /app/pipelines so the image
# keeps the repository layout the defaults expect: migrations in /app/db/migrations,
# the demo site in /app/pipelines/demo_site, digests in /app/pipelines/reports.

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV LOG_FORMAT=json

RUN useradd --create-home --uid 10001 app

WORKDIR /app/pipelines
COPY pipelines/pyproject.toml pipelines/README.md ./
COPY pipelines/src ./src
RUN pip install -e ".[google]"

COPY pipelines/demo_site ./demo_site
COPY db/migrations /app/db/migrations
RUN mkdir -p reports exports && chown -R app:app reports exports

USER app
ENTRYPOINT ["map"]
CMD ["--help"]

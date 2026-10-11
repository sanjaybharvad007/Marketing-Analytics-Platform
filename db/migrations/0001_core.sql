-- Core reference tables shared by every pipeline and by the web app.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- One row per canonical URL of the tracked site. Pipelines upsert pages as
-- they encounter them; the audit crawler fills in status code and word count.
CREATE TABLE pages (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    url           text        NOT NULL UNIQUE,
    path          text        NOT NULL,
    title         text,
    section       text        NOT NULL DEFAULT 'other',
    page_type     text        NOT NULL DEFAULT 'other'
        CHECK (page_type IN ('home', 'landing', 'category', 'product', 'article', 'guide', 'store', 'other')),
    status_code   integer     CHECK (status_code BETWEEN 100 AND 599),
    word_count    integer     CHECK (word_count >= 0),
    published_at  timestamptz,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pages_section_idx ON pages (section);
CREATE INDEX pages_path_trgm_idx ON pages USING gin (path gin_trgm_ops);

CREATE TABLE members (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text        NOT NULL,
    email      text        NOT NULL UNIQUE,
    role       text        NOT NULL,
    color      text        NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per pipeline execution. The web app reads this for freshness and
-- for the "Demo data" indicator.
CREATE TABLE pipeline_runs (
    id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pipeline     text        NOT NULL CHECK (pipeline IN ('ga4', 'gsc', 'seo', 'ai_visibility')),
    mode         text        NOT NULL CHECK (mode IN ('demo', 'live')),
    status       text        NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    rows_loaded  integer     NOT NULL DEFAULT 0 CHECK (rows_loaded >= 0),
    window_start date        NOT NULL,
    window_end   date        NOT NULL,
    error        text,
    CHECK (window_end >= window_start)
);

CREATE INDEX pipeline_runs_pipeline_started_idx ON pipeline_runs (pipeline, started_at DESC);

-- Tables owned by the web app: page planning, work management, audits and
-- saved report views. Automation writes to them through the REST API only.

CREATE TABLE content_plans (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title               text        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    target_keyword      text,
    intent              text        NOT NULL DEFAULT 'informational'
        CHECK (intent IN ('informational', 'commercial', 'transactional', 'navigational')),
    page_type           text        NOT NULL DEFAULT 'article'
        CHECK (page_type IN ('home', 'landing', 'category', 'product', 'article', 'guide', 'store', 'other')),
    status              text        NOT NULL DEFAULT 'idea'
        CHECK (status IN ('idea', 'brief', 'draft', 'review', 'scheduled', 'published')),
    priority            text        NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    owner_id            integer     REFERENCES members (id) ON DELETE SET NULL,
    target_url          text,
    -- Set when the plan refreshes a page that already exists.
    page_id             integer     REFERENCES pages (id) ON DELETE SET NULL,
    est_monthly_traffic integer     CHECK (est_monthly_traffic >= 0),
    due_date            date,
    brief               jsonb,
    brief_status        text        NOT NULL DEFAULT 'none'
        CHECK (brief_status IN ('none', 'requested', 'ready', 'failed')),
    brief_updated_at    timestamptz,
    notes               text,
    source              text        NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'opportunity', 'ai')),
    dedupe_key          text        UNIQUE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_plans_status_idx ON content_plans (status);
CREATE INDEX content_plans_brief_status_idx ON content_plans (brief_status) WHERE brief_status = 'requested';

CREATE TRIGGER content_plans_set_updated_at
    BEFORE UPDATE ON content_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_runs (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_url       text         NOT NULL,
    started_at     timestamptz  NOT NULL,
    finished_at    timestamptz  NOT NULL,
    pages_crawled  integer      NOT NULL CHECK (pages_crawled >= 0),
    issues_total   integer      NOT NULL CHECK (issues_total >= 0),
    health_score   numeric(5,1) NOT NULL CHECK (health_score BETWEEN 0 AND 100),
    summary        text,
    summary_source text         NOT NULL DEFAULT 'heuristic'
        CHECK (summary_source IN ('heuristic', 'llm')),
    created_at     timestamptz  NOT NULL DEFAULT now(),
    CHECK (finished_at >= started_at)
);

CREATE TABLE audit_issues (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id     integer     NOT NULL REFERENCES audit_runs (id) ON DELETE CASCADE,
    page_id    integer     REFERENCES pages (id) ON DELETE SET NULL,
    url        text        NOT NULL,
    rule       text        NOT NULL,
    severity   text        NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    message    text        NOT NULL,
    details    jsonb       NOT NULL DEFAULT '{}',
    status     text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ignored', 'fixed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, rule, url)
);

CREATE INDEX audit_issues_run_severity_idx ON audit_issues (run_id, severity);
CREATE INDEX audit_issues_rule_url_idx ON audit_issues (rule, url);

CREATE TRIGGER audit_issues_set_updated_at
    BEFORE UPDATE ON audit_issues
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tasks (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title          text             NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    description    text,
    status         text             NOT NULL DEFAULT 'backlog'
        CHECK (status IN ('backlog', 'todo', 'in_progress', 'review', 'done')),
    priority       text             NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assignee_id    integer          REFERENCES members (id) ON DELETE SET NULL,
    due_date       date,
    labels         text[]           NOT NULL DEFAULT '{}',
    -- Position within a board column. Fractional so a move touches one row.
    sort_order     double precision NOT NULL DEFAULT 0,
    plan_id        integer          REFERENCES content_plans (id) ON DELETE SET NULL,
    page_id        integer          REFERENCES pages (id) ON DELETE SET NULL,
    audit_issue_id integer          REFERENCES audit_issues (id) ON DELETE SET NULL,
    source         text             NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'audit', 'ai', 'opportunity')),
    -- Automation sets this so that re-running a script never opens the same task twice.
    dedupe_key     text             UNIQUE,
    evidence       jsonb,
    completed_at   timestamptz,
    created_at     timestamptz      NOT NULL DEFAULT now(),
    updated_at     timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX tasks_status_order_idx ON tasks (status, sort_order);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id);
CREATE INDEX tasks_due_date_idx ON tasks (due_date) WHERE status <> 'done';
CREATE INDEX tasks_labels_idx ON tasks USING gin (labels);

CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE saved_views (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    report     text        NOT NULL CHECK (report IN ('seo', 'ai_visibility')),
    filters    jsonb       NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report, name)
);

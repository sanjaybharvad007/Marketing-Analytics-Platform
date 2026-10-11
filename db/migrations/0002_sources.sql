-- Fact tables loaded by the pipelines. Every table has a natural primary key
-- so that loads are idempotent upserts (INSERT ... ON CONFLICT DO UPDATE).

-- Web analytics (GA4 Data API).
CREATE TABLE ga_daily (
    date             date          NOT NULL,
    page_id          integer       NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
    channel          text          NOT NULL,
    device           text          NOT NULL CHECK (device IN ('desktop', 'mobile', 'tablet')),
    country          char(2)       NOT NULL,
    sessions         integer       NOT NULL CHECK (sessions >= 0),
    users            integer       NOT NULL CHECK (users >= 0),
    engaged_sessions integer       NOT NULL CHECK (engaged_sessions >= 0),
    conversions      integer       NOT NULL CHECK (conversions >= 0),
    revenue          numeric(12,2) NOT NULL DEFAULT 0 CHECK (revenue >= 0),
    loaded_at        timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (date, page_id, channel, device, country)
);

CREATE INDEX ga_daily_page_date_idx ON ga_daily (page_id, date);

-- Search performance (Google Search Console Search Analytics API).
-- Position is stored as an impression-weighted sum so that
-- avg_position = sum(sum_position) / sum(impressions) holds at any grain.
CREATE TABLE gsc_daily (
    date         date             NOT NULL,
    page_id      integer          NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
    query        text             NOT NULL,
    country      char(2)          NOT NULL,
    device       text             NOT NULL CHECK (device IN ('desktop', 'mobile', 'tablet')),
    clicks       integer          NOT NULL CHECK (clicks >= 0),
    impressions  integer          NOT NULL CHECK (impressions >= 0),
    sum_position double precision NOT NULL CHECK (sum_position >= 0),
    is_brand     boolean          NOT NULL DEFAULT false,
    loaded_at    timestamptz      NOT NULL DEFAULT now(),
    PRIMARY KEY (date, page_id, query, country, device),
    CHECK (clicks <= impressions)
);

CREATE INDEX gsc_daily_query_date_idx ON gsc_daily (query, date);
CREATE INDEX gsc_daily_page_date_idx ON gsc_daily (page_id, date);
CREATE INDEX gsc_daily_query_trgm_idx ON gsc_daily USING gin (query gin_trgm_ops);

-- SEO tool data: tracked keywords and their daily ranking snapshots.
CREATE TABLE keywords (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    keyword       text         NOT NULL UNIQUE,
    search_volume integer      NOT NULL DEFAULT 0 CHECK (search_volume >= 0),
    difficulty    smallint     CHECK (difficulty BETWEEN 0 AND 100),
    intent        text         NOT NULL DEFAULT 'informational'
        CHECK (intent IN ('informational', 'commercial', 'transactional', 'navigational')),
    cpc           numeric(8,2) CHECK (cpc >= 0),
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE keyword_rankings (
    date          date        NOT NULL,
    keyword_id    integer     NOT NULL REFERENCES keywords (id) ON DELETE CASCADE,
    page_id       integer     REFERENCES pages (id) ON DELETE SET NULL,
    -- NULL means the site was not found in the tracked depth for that day.
    position      smallint    CHECK (position BETWEEN 1 AND 100),
    serp_features text[]      NOT NULL DEFAULT '{}',
    loaded_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (date, keyword_id)
);

CREATE INDEX keyword_rankings_keyword_date_idx ON keyword_rankings (keyword_id, date DESC);
CREATE INDEX keyword_rankings_page_idx ON keyword_rankings (page_id);

CREATE TABLE domain_metrics_daily (
    date              date        NOT NULL,
    domain            text        NOT NULL,
    is_own            boolean     NOT NULL DEFAULT false,
    authority_score   smallint    NOT NULL CHECK (authority_score BETWEEN 0 AND 100),
    referring_domains integer     NOT NULL CHECK (referring_domains >= 0),
    backlinks         integer     NOT NULL CHECK (backlinks >= 0),
    loaded_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (date, domain)
);

-- AI visibility: prompts we track and what each answer engine said.
CREATE TABLE ai_prompts (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prompt     text        NOT NULL UNIQUE,
    topic      text        NOT NULL,
    intent     text        NOT NULL DEFAULT 'informational'
        CHECK (intent IN ('informational', 'commercial', 'transactional', 'navigational')),
    active     boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_visibility_results (
    date                  date        NOT NULL,
    prompt_id             integer     NOT NULL REFERENCES ai_prompts (id) ON DELETE CASCADE,
    engine                text        NOT NULL
        CHECK (engine IN ('chatgpt', 'perplexity', 'gemini', 'google_ai_overviews', 'claude')),
    brand_mentioned       boolean     NOT NULL,
    -- 1 = first brand named in the answer; NULL when the brand is absent.
    brand_rank            smallint    CHECK (brand_rank >= 1),
    cited                 boolean     NOT NULL DEFAULT false,
    cited_url             text,
    sentiment             text        CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    competitors_mentioned text[]      NOT NULL DEFAULT '{}',
    answer_excerpt        text        NOT NULL DEFAULT '',
    loaded_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (date, prompt_id, engine),
    CHECK (brand_mentioned OR brand_rank IS NULL),
    CHECK (cited OR cited_url IS NULL)
);

CREATE INDEX ai_visibility_results_prompt_idx ON ai_visibility_results (prompt_id, date DESC);

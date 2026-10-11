-- Rollups behind the dashboards. Each has a unique index so the pipelines can
-- run REFRESH MATERIALIZED VIEW CONCURRENTLY after a load without blocking reads.

-- Traffic by day, section and the three GA4 breakdown dimensions.
CREATE MATERIALIZED VIEW mv_traffic_daily AS
SELECT
    g.date,
    p.section,
    g.channel,
    g.device,
    g.country,
    sum(g.sessions)::integer         AS sessions,
    sum(g.users)::integer            AS users,
    sum(g.engaged_sessions)::integer AS engaged_sessions,
    sum(g.conversions)::integer      AS conversions,
    sum(g.revenue)::numeric(14,2)    AS revenue
FROM ga_daily g
JOIN pages p ON p.id = g.page_id
GROUP BY g.date, p.section, g.channel, g.device, g.country;

CREATE UNIQUE INDEX mv_traffic_daily_key ON mv_traffic_daily (date, section, channel, device, country);

-- Search performance per page and day with the query dimension folded away.
-- The SEO report reads this instead of gsc_daily whenever no query-text
-- filter is active.
CREATE MATERIALIZED VIEW mv_search_page_daily AS
SELECT
    s.date,
    s.page_id,
    s.country,
    s.device,
    s.is_brand,
    sum(s.clicks)::integer      AS clicks,
    sum(s.impressions)::integer AS impressions,
    sum(s.sum_position)         AS sum_position
FROM gsc_daily s
GROUP BY s.date, s.page_id, s.country, s.device, s.is_brand;

CREATE UNIQUE INDEX mv_search_page_daily_key
    ON mv_search_page_daily (date, page_id, country, device, is_brand);
CREATE INDEX mv_search_page_daily_page_idx ON mv_search_page_daily (page_id, date);

-- AI visibility counts per day, engine and topic. brand_rank is bucketed so
-- the visibility score can be computed from this rollup alone.
CREATE MATERIALIZED VIEW mv_ai_visibility_daily AS
SELECT
    r.date,
    r.engine,
    p.topic,
    count(*)::integer                                      AS checks,
    count(*) FILTER (WHERE r.brand_mentioned)::integer     AS mentioned,
    count(*) FILTER (WHERE r.cited)::integer               AS cited,
    count(*) FILTER (WHERE r.brand_rank = 1)::integer      AS rank_1,
    count(*) FILTER (WHERE r.brand_rank = 2)::integer      AS rank_2,
    count(*) FILTER (WHERE r.brand_rank = 3)::integer      AS rank_3,
    count(*) FILTER (WHERE r.brand_rank >= 4)::integer     AS rank_4_plus,
    count(*) FILTER (WHERE r.sentiment = 'positive')::integer AS positive,
    count(*) FILTER (WHERE r.sentiment = 'negative')::integer AS negative
FROM ai_visibility_results r
JOIN ai_prompts p ON p.id = r.prompt_id
GROUP BY r.date, r.engine, p.topic;

CREATE UNIQUE INDEX mv_ai_visibility_daily_key ON mv_ai_visibility_daily (date, engine, topic);

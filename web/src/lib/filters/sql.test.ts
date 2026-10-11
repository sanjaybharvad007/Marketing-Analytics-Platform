import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseSeoPageState, type SeoFilters } from "./seo";
import {
  andAll,
  inList,
  needsPageJoin,
  needsQueryDimension,
  orderBy,
  positionCondition,
  searchHavingConditions,
  searchRowConditions,
} from "./sql";

const dialect = new PgDialect();
const RANGE = { from: "2026-05-01", to: "2026-05-28" };

/** Render a fragment the way Postgres receives it: text with $n placeholders, plus parameters. */
function render(fragment: SQL): { text: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment);
  return { text: query.sql.replace(/\s+/g, " ").trim(), params: query.params };
}

function filters(query: string): SeoFilters {
  return parseSeoPageState(new URLSearchParams(query));
}

describe("searchRowConditions", () => {
  it("always restricts the date range", () => {
    const { text, params } = render(andAll(searchRowConditions(filters(""), RANGE)));
    expect(text).toBe("s.date BETWEEN $1 AND $2");
    expect(params).toEqual(["2026-05-01", "2026-05-28"]);
  });

  it("binds every filter value as a parameter", () => {
    const state = filters(
      "country=US,CA&device=mobile&brand=non_brand&q=tent&q_not=best&section=guides,blog" +
        "&page_type=guide&url=/guides/&page_id=7&query=how+to+pitch+a+tent",
    );
    const { text, params } = render(andAll(searchRowConditions(state, RANGE)));
    expect(text).toBe(
      "s.date BETWEEN $1 AND $2 AND s.country IN ($3, $4) AND s.device IN ($5) AND NOT s.is_brand " +
        "AND s.page_id = $6 AND s.query ILIKE $7 AND s.query NOT ILIKE $8 AND s.query = $9 " +
        "AND p.section IN ($10, $11) AND p.page_type = $12 AND p.url ILIKE $13",
    );
    expect(params).toEqual([
      "2026-05-01",
      "2026-05-28",
      "US",
      "CA",
      "mobile",
      7,
      "%tent%",
      "%best%",
      "how to pitch a tent",
      "guides",
      "blog",
      "guide",
      "%/guides/%",
    ]);
  });

  it("keeps hostile input out of the SQL text", () => {
    const hostile = "'; DROP TABLE pages; --";
    const { text, params } = render(
      andAll(searchRowConditions(filters(`q=${encodeURIComponent(hostile)}`), RANGE)),
    );
    expect(text).toBe("s.date BETWEEN $1 AND $2 AND s.query ILIKE $3");
    expect(text).not.toContain("DROP");
    expect(params[2]).toBe(`%${hostile}%`);
  });

  it("escapes LIKE wildcards in user text", () => {
    const { params } = render(andAll(searchRowConditions(filters("q=100%25_wool"), RANGE)));
    expect(params[2]).toBe("%100\\%\\_wool%");
  });

  it("selects brand queries", () => {
    expect(render(andAll(searchRowConditions(filters("brand=brand"), RANGE))).text).toContain(
      "AND s.is_brand",
    );
  });
});

describe("having conditions", () => {
  it("is empty without aggregate filters", () => {
    expect(searchHavingConditions(filters(""))).toEqual([]);
  });

  it("combines position buckets with OR and thresholds with AND", () => {
    const { text, params } = render(
      andAll(
        searchHavingConditions(filters("position=1-3,21%2B&min_impressions=500&min_clicks=10")),
      ),
    );
    const position = "sum(s.sum_position) / NULLIF(sum(s.impressions), 0)";
    expect(text).toBe(
      `((${position} > $1 AND ${position} <= $2) OR ${position} > $3) ` +
        "AND sum(s.impressions) >= $4 AND sum(s.clicks) >= $5",
    );
    expect(params).toEqual([0, 3, 20, 500, 10]);
  });

  it("uses inclusive upper bounds for each bucket", () => {
    const column = sql`r.position`;
    expect(render(positionCondition(column, ["4-10"])!)).toEqual({
      text: "((r.position > $1 AND r.position <= $2))",
      params: [3, 10],
    });
    expect(render(positionCondition(column, ["11-20"])!).params).toEqual([10, 20]);
    expect(positionCondition(column, [])).toBeNull();
  });
});

describe("source selection", () => {
  it("needs the query-level table only for query-text filters", () => {
    expect(needsQueryDimension(filters("country=US&section=blog"))).toBe(false);
    expect(needsQueryDimension(filters("q=tent"))).toBe(true);
    expect(needsQueryDimension(filters("q_not=tent"))).toBe(true);
    expect(needsQueryDimension(filters("query=tents"))).toBe(true);
  });

  it("joins pages only for page-attribute filters", () => {
    expect(needsPageJoin(filters("country=US&q=tent"))).toBe(false);
    expect(needsPageJoin(filters("section=blog"))).toBe(true);
    expect(needsPageJoin(filters("page_type=guide"))).toBe(true);
    expect(needsPageJoin(filters("url=/blog/"))).toBe(true);
  });
});

describe("orderBy", () => {
  const allowed = { clicks: sql`cur.clicks`, query: sql`cur.key` };

  it("uses allowlisted columns", () => {
    const order = orderBy(allowed, "query", "asc", "clicks");
    expect(order.key).toBe("query");
    expect(render(order.clause).text).toBe("cur.key ASC NULLS LAST");
  });

  it("falls back for unknown or hostile keys", () => {
    for (const key of [
      undefined,
      "position",
      "clicks; DROP TABLE pages",
      "constructor",
      "__proto__",
    ]) {
      const order = orderBy(allowed, key, "desc", "clicks");
      expect(order.key).toBe("clicks");
      expect(render(order.clause).text).toBe("cur.clicks DESC NULLS LAST");
    }
  });
});

describe("helpers", () => {
  it("renders IN lists with one parameter per value", () => {
    expect(render(inList(sql`s.country`, ["US", "CA", "GB"]))).toEqual({
      text: "s.country IN ($1, $2, $3)",
      params: ["US", "CA", "GB"],
    });
  });

  it("renders an empty condition list as TRUE", () => {
    expect(render(andAll([])).text).toBe("TRUE");
  });
});

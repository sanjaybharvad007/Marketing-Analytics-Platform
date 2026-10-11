import { describe, expect, it } from "vitest";
import { clearFilters, describeSeoFilters, removeChip } from "./chips";
import {
  parseSeoPageState,
  seoFilterSchema,
  type SeoPageState,
  seoStateToParams,
  viewFilters,
} from "./seo";

const FULL_QUERY =
  "range=custom&from=2026-05-01&to=2026-05-31&compare=none&country=US%2CCA&device=mobile%2Ctablet" +
  "&section=guides%2Cblog&page_type=guide&brand=non_brand&position=4-10%2C11-20&q=tent&q_not=best" +
  "&url=%2Fguides%2F&min_impressions=100&min_clicks=5&sort=impressions&dir=asc&page=3&page_size=50" +
  "&tab=pages&metric=ctr";

describe("parseSeoPageState", () => {
  it("applies defaults to an empty query", () => {
    expect(parseSeoPageState({})).toEqual({
      range: "28d",
      compare: "previous",
      country: [],
      device: [],
      section: [],
      brand: "all",
      position: [],
      dir: "desc",
      page: 1,
      page_size: 25,
      tab: "queries",
      metric: "clicks",
    });
  });

  it("parses every filter", () => {
    const state = parseSeoPageState(new URLSearchParams(FULL_QUERY));
    expect(state).toMatchObject({
      range: "custom",
      from: "2026-05-01",
      to: "2026-05-31",
      compare: "none",
      country: ["US", "CA"],
      device: ["mobile", "tablet"],
      section: ["guides", "blog"],
      page_type: "guide",
      brand: "non_brand",
      position: ["4-10", "11-20"],
      q: "tent",
      q_not: "best",
      url: "/guides/",
      min_impressions: 100,
      min_clicks: 5,
      sort: "impressions",
      dir: "asc",
      page: 3,
      page_size: 50,
      tab: "pages",
      metric: "ctr",
    });
  });

  it("upper-cases country codes", () => {
    expect(parseSeoPageState({ country: "us,gb" }).country).toEqual(["US", "GB"]);
  });

  it("ignores malformed values instead of failing", () => {
    const state = parseSeoPageState({
      device: "mobile,fridge",
      position: "1-2",
      min_impressions: "-5",
      page: "0",
      page_size: "100000",
      sort: "clicks; DROP TABLE pages",
      brand: "maybe",
      from: "2026-99-99",
      q: "tent",
    });
    expect(state.device).toEqual([]);
    expect(state.position).toEqual([]);
    expect(state.min_impressions).toBeUndefined();
    expect(state.page).toBe(1);
    expect(state.page_size).toBe(25);
    expect(state.sort).toBeUndefined();
    expect(state.brand).toBe("all");
    expect(state.from).toBeUndefined();
    expect(state.q).toBe("tent");
  });
});

describe("URL round trip", () => {
  it("serialises to the same query it was parsed from", () => {
    const state = parseSeoPageState(new URLSearchParams(FULL_QUERY));
    const params = seoStateToParams(state);
    expect(parseSeoPageState(params)).toEqual(state);
    expect(new Set(params.keys())).toEqual(new Set(new URLSearchParams(FULL_QUERY).keys()));
  });

  it("produces an empty query for the default state", () => {
    expect(seoStateToParams(parseSeoPageState({})).toString()).toBe("");
  });

  it("is stable: parse then serialise twice gives the same string", () => {
    const once = seoStateToParams(parseSeoPageState(new URLSearchParams(FULL_QUERY))).toString();
    const twice = seoStateToParams(parseSeoPageState(new URLSearchParams(once))).toString();
    expect(twice).toBe(once);
  });

  it("saves views without the page number", () => {
    const state = parseSeoPageState({ q: "tent", page: "4", country: "US,CA" });
    expect(viewFilters(state)).toEqual({ q: "tent", country: "US,CA" });
  });
});

describe("strict schema (API)", () => {
  it("rejects what the lenient page parser would drop", () => {
    const result = seoFilterSchema.safeParse({ device: "fridge", page: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0]).sort()).toEqual(["device", "page"]);
    }
  });
});

describe("filter chips", () => {
  const state: SeoPageState = parseSeoPageState(new URLSearchParams(FULL_QUERY));

  it("describes each active filter", () => {
    const labels = describeSeoFilters(state).map((chip) => chip.label);
    expect(labels).toEqual([
      "Country: United States",
      "Country: Canada",
      "Device: Mobile",
      "Device: Tablet",
      "Section: Guides",
      "Section: Blog",
      "Page type: Guide",
      "Non-brand queries",
      "Position 4-10",
      "Position 11-20",
      'Query contains "tent"',
      'Query does not contain "best"',
      'URL contains "/guides/"',
      "Impressions ≥ 100",
      "Clicks ≥ 5",
    ]);
  });

  it("has no chips for the default state", () => {
    expect(describeSeoFilters(parseSeoPageState({}))).toEqual([]);
  });

  it("names a drilled-down page by its path", () => {
    const chips = describeSeoFilters(parseSeoPageState({ page_id: "7" }), { pageLabel: "/sale/" });
    expect(chips).toEqual([{ key: "page_id", label: "Page: /sale/" }]);
  });

  it("removes one value of a multi-value filter and resets the page", () => {
    const [, canada] = describeSeoFilters(state);
    const next = removeChip(state, canada!);
    expect(next.country).toEqual(["US"]);
    expect(next.device).toEqual(["mobile", "tablet"]);
    expect(next.page).toBe(1);
  });

  it("removes scalar filters", () => {
    const chips = describeSeoFilters(state);
    const brand = chips.find((chip) => chip.key === "brand")!;
    const query = chips.find((chip) => chip.key === "q")!;
    expect(removeChip(state, brand).brand).toBe("all");
    expect(removeChip(state, query).q).toBeUndefined();
  });

  it("clears data filters but keeps dates, tab, metric and sort", () => {
    const cleared = clearFilters(state);
    expect(describeSeoFilters(cleared)).toEqual([]);
    expect(cleared).toMatchObject({
      range: "custom",
      from: "2026-05-01",
      to: "2026-05-31",
      compare: "none",
      tab: "pages",
      metric: "ctr",
      sort: "impressions",
      dir: "asc",
      page: 1,
    });
  });
});

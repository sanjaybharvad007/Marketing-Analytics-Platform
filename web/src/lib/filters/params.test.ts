import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  containsPattern,
  csv,
  escapeLike,
  normalizeParams,
  parseLenient,
  serializeParams,
} from "./params";

describe("normalizeParams", () => {
  it("joins repeated keys and drops empty values", () => {
    const params = new URLSearchParams("country=US&country=CA&q=&device=mobile&x=%20");
    expect(normalizeParams(params)).toEqual({ country: "US,CA", device: "mobile" });
  });

  it("accepts the record Next.js passes to pages", () => {
    expect(
      normalizeParams({ country: ["US", "CA"], q: "tent", missing: undefined, blank: "" }),
    ).toEqual({
      country: "US,CA",
      q: "tent",
    });
  });
});

describe("csv", () => {
  const schema = csv(z.enum(["a", "b", "c"]));

  it("splits, trims and removes duplicates", () => {
    expect(schema.parse("a, b,a,,c")).toEqual(["a", "b", "c"]);
    expect(schema.parse(["b", "b"])).toEqual(["b"]);
  });

  it("rejects values outside the item schema", () => {
    expect(schema.safeParse("a,z").success).toBe(false);
  });
});

describe("parseLenient", () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    brand: z.enum(["all", "brand"]).default("all"),
    q: z.string().min(1).optional(),
  });

  it("keeps valid fields and replaces invalid ones with their defaults", () => {
    expect(parseLenient(schema, { page: "abc", brand: "brand", q: "tent" })).toEqual({
      page: 1,
      brand: "brand",
      q: "tent",
    });
    expect(parseLenient(schema, { page: "3", brand: "nope" })).toEqual({ page: 3, brand: "all" });
  });

  it("ignores unknown keys", () => {
    expect(parseLenient(schema, { utm_source: "x" })).toEqual({ page: 1, brand: "all" });
  });
});

describe("serializeParams", () => {
  const schema = z.object({
    range: z.enum(["7d", "28d"]).default("28d"),
    country: csv(z.string()).default([]),
    q: z.string().optional(),
    page: z.coerce.number().default(1),
  });

  it("omits defaults, undefined and empty values", () => {
    expect(
      serializeParams(schema, { range: "28d", country: [], q: undefined, page: 1 }).toString(),
    ).toBe("");
  });

  it("writes arrays as comma-separated values in schema order", () => {
    const params = serializeParams(schema, {
      page: 2,
      q: "tent",
      country: ["US", "CA"],
      range: "7d",
    });
    expect(params.toString()).toBe("range=7d&country=US%2CCA&q=tent&page=2");
  });
});

describe("LIKE escaping", () => {
  it("escapes wildcards and backslashes so user text matches literally", () => {
    expect(escapeLike("50%_off\\now")).toBe("50\\%\\_off\\\\now");
    expect(containsPattern("a_b")).toBe("%a\\_b%");
  });
});

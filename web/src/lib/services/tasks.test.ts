import { describe, expect, it } from "vitest";
import { isGap } from "./ai-visibility";
import { orderBetween } from "./tasks";

describe("orderBetween", () => {
  it("lands halfway between two neighbours", () => {
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(1000, 1000.5)).toBe(1000.25);
  });

  it("steps past a single neighbour", () => {
    expect(orderBetween(3000, null)).toBe(4000);
    expect(orderBetween(null, 1000)).toBe(0);
    expect(orderBetween(null, -500)).toBe(-1500);
  });

  it("starts an empty column at one step", () => {
    expect(orderBetween(null, null)).toBe(1000);
  });

  it("always sorts strictly between its neighbours", () => {
    let before = 1000;
    const after = 1001;
    for (let i = 0; i < 20; i += 1) {
      const next = orderBetween(before, after);
      expect(next).toBeGreaterThan(before);
      expect(next).toBeLessThan(after);
      before = next;
    }
  });
});

describe("isGap", () => {
  it("needs competitors in most answers and the brand in few", () => {
    expect(isGap({ checks: 140, brand_mentions: 12, competitor_mentions: 138 })).toBe(true);
    expect(isGap({ checks: 140, brand_mentions: 28, competitor_mentions: 70 })).toBe(true);
  });

  it("is not a gap when the brand is present, competitors are absent, or data is thin", () => {
    expect(isGap({ checks: 140, brand_mentions: 60, competitor_mentions: 138 })).toBe(false);
    expect(isGap({ checks: 140, brand_mentions: 5, competitor_mentions: 30 })).toBe(false);
    expect(isGap({ checks: 4, brand_mentions: 0, competitor_mentions: 4 })).toBe(false);
  });
});

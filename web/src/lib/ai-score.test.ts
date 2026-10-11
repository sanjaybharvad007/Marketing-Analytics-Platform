import { describe, expect, it } from "vitest";
import { SCORE_WEIGHTS, visibilityScore } from "./ai-score";

const none = { checks: 10, rank1: 0, rank2: 0, rank3: 0, rank4Plus: 0, cited: 0 };

describe("visibilityScore", () => {
  it("is null without answers", () => {
    expect(visibilityScore({ ...none, checks: 0 })).toBeNull();
  });

  it("is 0 when the brand never appears and 100 when always first and cited", () => {
    expect(visibilityScore(none)).toBe(0);
    expect(visibilityScore({ ...none, rank1: 10, cited: 10 })).toBeCloseTo(100);
  });

  it("weights mentions by rank and adds the citation bonus", () => {
    expect(visibilityScore({ ...none, rank1: 10 })).toBeCloseTo(70);
    expect(visibilityScore({ ...none, rank2: 10 })).toBeCloseTo(50);
    expect(visibilityScore({ ...none, rank3: 5, rank4Plus: 5 })).toBeCloseTo(30);
    expect(visibilityScore({ ...none, rank2: 4, cited: 2 })).toBeCloseTo(26);
  });

  it("never rewards a later mention more than an earlier one", () => {
    const { rank1, rank2, rank3, rank4Plus, cited } = SCORE_WEIGHTS;
    expect(rank1).toBeGreaterThan(rank2);
    expect(rank2).toBeGreaterThan(rank3);
    expect(rank3).toBeGreaterThan(rank4Plus);
    expect(rank1 + cited).toBeCloseTo(1);
  });
});

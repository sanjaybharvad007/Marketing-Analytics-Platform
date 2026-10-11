import { describe, expect, it } from "vitest";
import {
  addDays,
  alignPrevious,
  daysInRange,
  eachDay,
  isIsoDate,
  previousPeriod,
  resolvePeriods,
  resolveRange,
} from "./dates";

const ANCHOR = "2026-06-30";

describe("isIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-6-1")).toBe(false);
    expect(isIsoDate("yesterday")).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30"); // DST change in Europe
  });
});

describe("resolveRange", () => {
  it("ends presets at the anchor and counts days inclusively", () => {
    expect(resolveRange({ range: "7d" }, ANCHOR)).toEqual({ from: "2026-06-24", to: ANCHOR });
    expect(resolveRange({ range: "28d" }, ANCHOR)).toEqual({ from: "2026-06-03", to: ANCHOR });
    expect(daysInRange(resolveRange({ range: "90d" }, ANCHOR))).toBe(90);
  });

  it("uses a valid custom range as given, even past the anchor", () => {
    const custom = resolveRange({ range: "custom", from: "2026-05-01", to: "2026-05-10" }, ANCHOR);
    expect(custom).toEqual({ from: "2026-05-01", to: "2026-05-10" });
  });

  it("falls back to 28 days for an incomplete, invalid or reversed custom range", () => {
    const fallback = resolveRange({ range: "28d" }, ANCHOR);
    expect(resolveRange({ range: "custom", from: "2026-05-01" }, ANCHOR)).toEqual(fallback);
    expect(resolveRange({ range: "custom", from: "2026-05-10", to: "2026-05-01" }, ANCHOR)).toEqual(
      fallback,
    );
    expect(resolveRange({ range: "custom", from: "nope", to: "2026-05-01" }, ANCHOR)).toEqual(
      fallback,
    );
  });
});

describe("previousPeriod", () => {
  it("is the same length and ends the day before the range starts", () => {
    const current = { from: "2026-06-03", to: "2026-06-30" };
    const previous = previousPeriod(current);
    expect(previous).toEqual({ from: "2026-05-06", to: "2026-06-02" });
    expect(daysInRange(previous)).toBe(daysInRange(current));
  });

  it("handles a single day", () => {
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-01" })).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
  });
});

describe("resolvePeriods", () => {
  it("returns no previous period when comparison is off", () => {
    expect(resolvePeriods({ range: "7d", compare: "none" }, ANCHOR).previous).toBeNull();
    expect(resolvePeriods({ range: "7d", compare: "previous" }, ANCHOR).previous).toEqual({
      from: "2026-06-17",
      to: "2026-06-23",
    });
  });
});

describe("eachDay and alignPrevious", () => {
  it("lists every day in order", () => {
    expect(eachDay({ from: "2026-02-27", to: "2026-03-02" })).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("pairs days by offset and leaves gaps undefined", () => {
    const current = { from: "2026-06-08", to: "2026-06-10" };
    const previous = previousPeriod(current);
    const values = new Map([
      ["2026-06-05", 10],
      ["2026-06-07", 30],
    ]);
    expect(alignPrevious(current, previous, values)).toEqual([
      { date: "2026-06-08", previousDate: "2026-06-05", value: 10 },
      { date: "2026-06-09", previousDate: "2026-06-06", value: undefined },
      { date: "2026-06-10", previousDate: "2026-06-07", value: 30 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeDelta,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatInteger,
  formatMetric,
  formatPercent,
  formatPosition,
  initials,
  relativeDays,
} from "./format";

describe("number formatting", () => {
  it("keeps small numbers exact and compacts large ones", () => {
    expect(formatCompact(1284)).toBe("1,284");
    expect(formatCompact(9999)).toBe("9,999");
    expect(formatCompact(12940)).toBe("12.9K");
    expect(formatCompact(4_210_000)).toBe("4.2M");
    expect(formatCompact(-15_300)).toBe("-15.3K");
  });

  it("formats integers, percentages, positions and currency", () => {
    expect(formatInteger(1234567.6)).toBe("1,234,568");
    expect(formatPercent(0.0653)).toBe("6.5%");
    expect(formatPercent(0.0653, 2)).toBe("6.53%");
    expect(formatPosition(8.75)).toBe("8.8");
    expect(formatCurrency(1083786)).toBe("$1.1M");
    expect(formatCurrency(840)).toBe("$840");
  });

  it("shows a dash for missing values", () => {
    for (const format of [
      formatCompact,
      formatInteger,
      formatPercent,
      formatPosition,
      formatCurrency,
    ]) {
      expect(format(null)).toBe("–");
      expect(format(undefined)).toBe("–");
      expect(format(Number.NaN)).toBe("–");
    }
  });

  it("dispatches by metric format", () => {
    expect(formatMetric(0.0447, "percent")).toBe("4.47%");
    expect(formatMetric(9.14, "position")).toBe("9.1");
    expect(formatMetric(28.73, "score")).toBe("28.7");
    expect(formatMetric(455096, "number")).toBe("455.1K");
  });
});

describe("computeDelta", () => {
  it("reports relative change for counts", () => {
    expect(computeDelta(110, 100)).toEqual({ label: "+10.0%", direction: "up", tone: "good" });
    expect(computeDelta(90, 100)).toEqual({ label: "-10.0%", direction: "down", tone: "bad" });
  });

  it("reports percentage points for rates", () => {
    expect(computeDelta(0.0653, 0.0669, "percent")).toEqual({
      label: "-0.16 pt",
      direction: "down",
      tone: "bad",
    });
  });

  it("treats a lower average position as an improvement", () => {
    expect(computeDelta(8.2, 9.0, "position", false)).toEqual({
      label: "-0.8",
      direction: "down",
      tone: "good",
    });
    expect(computeDelta(9.6, 9.0, "position", false)?.tone).toBe("bad");
  });

  it("reports absolute points for scores", () => {
    expect(computeDelta(31.2, 29.0, "score")).toEqual({
      label: "+2.2",
      direction: "up",
      tone: "good",
    });
  });

  it("is flat when the rounded change is zero", () => {
    expect(computeDelta(100.01, 100)).toEqual({
      label: "0.0%",
      direction: "flat",
      tone: "neutral",
    });
    expect(computeDelta(8.75, 8.79, "position", false)?.direction).toBe("flat");
    expect(computeDelta(0, 0)?.direction).toBe("flat");
  });

  it("returns null when there is nothing to compare with", () => {
    expect(computeDelta(5, null)).toBeNull();
    expect(computeDelta(null, 5)).toBeNull();
    expect(computeDelta(5, 0)).toBeNull();
  });
});

describe("dates", () => {
  it("formats ISO dates without shifting time zones", () => {
    expect(formatDate("2026-10-09")).toBe("Oct 9");
    expect(formatDate("2026-01-01", "long")).toBe("Jan 1, 2026");
    expect(formatDate(null)).toBe("–");
    expect(formatDate("garbage")).toBe("–");
  });

  it("formats ranges, repeating the year only when it differs", () => {
    expect(formatDateRange("2026-09-12", "2026-10-09")).toBe("Sep 12 to Oct 9, 2026");
    expect(formatDateRange("2025-12-20", "2026-01-16")).toBe("Dec 20, 2025 to Jan 16, 2026");
  });

  it("formats timestamps in UTC", () => {
    expect(formatDateTime("2026-10-03T06:30:00.000Z")).toBe("Oct 3, 06:30 UTC");
    expect(formatDateTime(null)).toBe("–");
  });

  it("describes whole-day distances", () => {
    expect(relativeDays("2026-10-10", "2026-10-10")).toBe("today");
    expect(relativeDays("2026-10-11", "2026-10-10")).toBe("tomorrow");
    expect(relativeDays("2026-10-09", "2026-10-10")).toBe("yesterday");
    expect(relativeDays("2026-10-15", "2026-10-10")).toBe("in 5 days");
    expect(relativeDays("2026-10-08", "2026-10-10")).toBe("2 days ago");
  });
});

it("builds initials from the first two names", () => {
  expect(initials("Maya Okafor")).toBe("MO");
  expect(initials("  priya   natarajan  kumar ")).toBe("PN");
  expect(initials("Cher")).toBe("C");
});

/** Number and date formatting used across tables, tiles, charts and CSV-free UI text. */

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const EMPTY = "–";

export type MetricFormat = "number" | "percent" | "position" | "score" | "currency";

export function formatInteger(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? EMPTY : integer.format(Math.round(value));
}

/** 1,284 stays exact; 12,940 becomes 12.9K; 4,210,000 becomes 4.2M. */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return Math.abs(value) < 10_000 ? integer.format(Math.round(value)) : compact.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatPosition(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? EMPTY : value.toFixed(1);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return EMPTY;
  return `$${Math.abs(value) < 10_000 ? integer.format(Math.round(value)) : compact.format(value)}`;
}

export function formatMetric(value: number | null | undefined, format: MetricFormat): string {
  switch (format) {
    case "percent":
      return formatPercent(value, 2);
    case "position":
    case "score":
      return formatPosition(value);
    case "currency":
      return formatCurrency(value);
    default:
      return formatCompact(value);
  }
}

export type Direction = "up" | "down" | "flat";

export interface Delta {
  /** Text such as "+12.4%" or "-0.8". */
  label: string;
  direction: Direction;
  /** Whether the movement is an improvement, a regression, or neither. */
  tone: "good" | "bad" | "neutral";
}

/**
 * Change between two period values.
 *
 * Counts and rates are compared relatively ("+12.4%"); positions and scores
 * are compared in absolute points ("-0.8") because a percentage of a rank is
 * not meaningful. `higherIsBetter` is false for average position.
 */
export function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  format: MetricFormat = "number",
  higherIsBetter = true,
): Delta | null {
  if (current == null || previous == null || Number.isNaN(current) || Number.isNaN(previous)) {
    return null;
  }
  const absolute = format === "position" || format === "score";
  let change: number;
  let label: string;
  if (absolute) {
    change = current - previous;
    label = `${change > 0 ? "+" : ""}${change.toFixed(1)}`;
  } else if (format === "percent") {
    // Rates move in percentage points.
    change = (current - previous) * 100;
    label = `${change > 0 ? "+" : ""}${change.toFixed(2)} pt`;
  } else {
    if (previous === 0) return current === 0 ? flat("0.0%") : null;
    change = (current - previous) / Math.abs(previous);
    label = `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;
  }
  const rounded = Number(label.replace(/[^0-9.-]/g, ""));
  if (rounded === 0) return flat(label.replace(/^[+-]/, ""));
  const direction: Direction = change > 0 ? "up" : "down";
  const improved = higherIsBetter ? change > 0 : change < 0;
  return { label, direction, tone: improved ? "good" : "bad" };
}

function flat(label: string): Delta {
  return { label, direction: "flat", tone: "neutral" };
}

export function formatDate(
  iso: string | null | undefined,
  style: "short" | "long" = "short",
): string {
  if (!iso) return EMPTY;
  const value = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(value.getTime())) return EMPTY;
  return (style === "short" ? shortDate : longDate).format(value);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return EMPTY;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? EMPTY : `${dateTime.format(date)} UTC`;
}

export function formatDateRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDate(from, sameYear ? "short" : "long")} to ${formatDate(to, "long")}`;
}

/** "3 days ago", "in 2 days", "today". Works on whole days. */
export function relativeDays(iso: string, today: string): string {
  const diff = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

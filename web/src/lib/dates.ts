/**
 * Date-range maths on ISO calendar dates ("2026-06-01").
 *
 * Everything is computed in UTC on plain dates so results never depend on the
 * server's or the browser's time zone. Ranges are inclusive on both ends.
 */

export const RANGE_PRESETS = ["7d", "28d", "90d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type RangeKey = RangePreset | "custom";

export const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "90d": "Last 90 days",
  custom: "Custom range",
};

const PRESET_DAYS: Record<RangePreset, number> = { "7d": 7, "28d": 28, "90d": 90 };
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  from: string;
  to: string;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function toTime(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function toIso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toIso(toTime(iso) + days * DAY_MS);
}

/** Number of days in an inclusive range. */
export function daysInRange(range: DateRange): number {
  return Math.round((toTime(range.to) - toTime(range.from)) / DAY_MS) + 1;
}

export function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface RangeInput {
  range: RangeKey;
  from?: string;
  to?: string;
}

/**
 * Turn a preset or custom selection into concrete dates.
 *
 * Presets end at `anchor`, the newest date that has data, so "last 28 days"
 * always shows 28 full days even when the pipelines are a few days behind.
 * An incomplete or reversed custom range falls back to the 28-day preset.
 */
export function resolveRange(input: RangeInput, anchor: string): DateRange {
  if (input.range === "custom") {
    const { from, to } = input;
    if (from && to && isIsoDate(from) && isIsoDate(to) && from <= to) return { from, to };
    return resolveRange({ range: "28d" }, anchor);
  }
  return { from: addDays(anchor, -(PRESET_DAYS[input.range] - 1)), to: anchor };
}

/** The period of equal length that ends the day before `range` starts. */
export function previousPeriod(range: DateRange): DateRange {
  const length = daysInRange(range);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(length - 1)), to };
}

export interface ResolvedPeriods {
  current: DateRange;
  previous: DateRange | null;
}

export function resolvePeriods(
  input: RangeInput & { compare: "previous" | "none" },
  anchor: string,
): ResolvedPeriods {
  const current = resolveRange(input, anchor);
  return { current, previous: input.compare === "previous" ? previousPeriod(current) : null };
}

/**
 * Pair each day of the current period with the same-offset day of the
 * previous period, for drawing both on one time axis.
 */
export function alignPrevious<T>(
  current: DateRange,
  previous: DateRange,
  previousByDate: ReadonlyMap<string, T>,
): Array<{ date: string; previousDate: string; value: T | undefined }> {
  return eachDay(current).map((date, index) => {
    const previousDate = addDays(previous.from, index);
    return { date, previousDate, value: previousByDate.get(previousDate) };
  });
}

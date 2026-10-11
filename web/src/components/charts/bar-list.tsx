import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface BarListRow {
  key: string;
  label: string;
  value: number;
  /** The value as shown at the bar's tip. */
  display: string;
  /** Supporting text under the bar: a share, a delta. */
  note?: ReactNode;
  href?: string;
  /** In emphasis mode, the one row drawn in the accent hue. */
  emphasized?: boolean;
}

/**
 * Horizontal bars for comparing a handful of categories. Every bar uses the
 * same hue (length already encodes the value) and carries its number, so the
 * chart needs neither legend nor tooltip. With `emphasis`, one row is
 * highlighted and the rest recede to grey.
 */
export function BarList({
  rows,
  emphasis = false,
  className,
  ariaLabel,
}: {
  rows: BarListRow[];
  emphasis?: boolean;
  className?: string;
  ariaLabel: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <ul aria-label={ariaLabel} className={cn("flex flex-col gap-3", className)}>
      {rows.map((row) => {
        const width = max > 0 ? Math.max((row.value / max) * 100, row.value > 0 ? 1 : 0) : 0;
        const labelClass = cn("truncate text-ink", row.emphasized && "font-semibold");
        return (
          <li key={row.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              {row.href ? (
                <Link
                  href={row.href}
                  title={row.label}
                  className={cn(labelClass, "hover:text-accent-text hover:underline")}
                >
                  {row.label}
                </Link>
              ) : (
                <span title={row.label} className={labelClass}>
                  {row.label}
                </span>
              )}
              <span className="num shrink-0 font-semibold text-ink">{row.display}</span>
            </div>
            <div aria-hidden="true" className="mt-1 h-1.5">
              <div
                style={{ width: `${width}%` }}
                className={cn(
                  "h-full rounded-r-[4px]",
                  emphasis && !row.emphasized ? "bg-series-muted" : "bg-series-1",
                )}
              />
            </div>
            {row.note ? <div className="num mt-1 text-xs text-ink-3">{row.note}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

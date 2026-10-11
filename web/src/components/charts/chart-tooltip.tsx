import type { ReactNode } from "react";

export interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

/** One tooltip for every series at the hovered x: values lead, labels follow. */
export function ChartTooltip({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: TooltipRow[];
  footer?: ReactNode;
}) {
  return (
    <div className="min-w-36 rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm shadow-md">
      <p className="mb-1 text-xs text-ink-3">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              style={{ backgroundColor: row.color }}
              className="h-0.5 w-3 shrink-0 rounded-full"
            />
            <span className="num font-semibold text-ink">{row.value}</span>
            <span className="text-ink-3">{row.label}</span>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

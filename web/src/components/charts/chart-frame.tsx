"use client";

import { ChartLine, Table2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

export interface LegendItem {
  label: string;
  /** CSS colour, usually a `var(--series-n)` token. */
  color: string;
  /** Mirrors the mark: a stroke for lines, a block for bars and areas. */
  shape?: "line" | "rect";
}

export interface ChartTable {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            style={{ backgroundColor: item.color }}
            className={
              item.shape === "rect" ? "size-2.5 rounded-[2px]" : "h-0.5 w-3.5 rounded-full"
            }
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Card around a chart: title, legend, and a switch to the same data as a
 * table, so no value is reachable only by hovering.
 */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  legend?: LegendItem[];
  table: ChartTable;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Panel className={cn("flex min-w-0 flex-col", className)}>
      <PanelHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={showTable}
              onClick={() => setShowTable((value) => !value)}
            >
              {showTable ? (
                <ChartLine aria-hidden="true" className="size-3.5" />
              ) : (
                <Table2 aria-hidden="true" className="size-3.5" />
              )}
              {showTable ? "Chart" : "Table"}
            </Button>
          </>
        }
      />
      {legend && legend.length > 1 && !showTable ? (
        <Legend items={legend} className="px-4 pb-1" />
      ) : null}
      <div className="min-w-0 flex-1 px-4 pt-1 pb-3">
        {showTable ? (
          <div className="scroll-thin max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {table.columns.map((column, index) => (
                    <th
                      key={column}
                      scope="col"
                      className={cn(
                        "narrow sticky top-0 border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-2",
                        index === 0 ? "text-left" : "text-right",
                      )}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, index) => (
                      <td
                        key={index}
                        className={cn(
                          "border-b border-line px-3 py-1.5 last:border-b-0",
                          index === 0 ? "text-left" : "num text-right",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </Panel>
  );
}

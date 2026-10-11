"use client";

import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { type DateRange, isIsoDate, RANGE_LABELS, RANGE_PRESETS, type RangeKey } from "@/lib/dates";
import { formatDateRange } from "@/lib/format";
import { Button, buttonClass } from "./button";
import { Input } from "./field";
import { Popover } from "./popover";

export interface DateSelection {
  range: RangeKey;
  from?: string;
  to?: string;
  compare: "previous" | "none";
}

/**
 * Date range control: presets as rows, the comparison switch, and a custom
 * range tucked into the footer.
 */
export function DateRangePicker({
  value,
  resolved,
  maxDate,
  onChange,
}: {
  value: DateSelection;
  /** The concrete dates the current selection resolves to. */
  resolved: DateRange;
  maxDate: string;
  onChange: (next: DateSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(resolved.from);
  const [to, setTo] = useState(resolved.to);
  const fromId = useId();
  const toId = useId();
  const compareId = useId();
  const customValid = isIsoDate(from) && isIsoDate(to) && from <= to;

  function choose(next: DateSelection) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFrom(resolved.from);
          setTo(resolved.to);
        }
      }}
      className="w-72 p-1"
      trigger={
        <button type="button" className={buttonClass("secondary", "md", "gap-2")}>
          <CalendarDays aria-hidden="true" className="size-4 text-ink-3" />
          <span className="font-semibold">{RANGE_LABELS[value.range]}</span>
          <span className="num hidden text-ink-3 sm:inline">
            {formatDateRange(resolved.from, resolved.to)}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 text-ink-3" />
        </button>
      }
    >
      <ul>
        {RANGE_PRESETS.map((preset) => {
          const active = value.range === preset;
          return (
            <li key={preset}>
              <button
                type="button"
                onClick={() => choose({ range: preset, compare: value.compare })}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-3",
                  active && "font-semibold",
                )}
              >
                {RANGE_LABELS[preset]}
                {active ? <Check aria-hidden="true" className="size-4" strokeWidth={2.5} /> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-1 border-t border-line px-2.5 py-2">
        <label htmlFor={compareId} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            id={compareId}
            type="checkbox"
            className="size-3.5 accent-(--accent)"
            checked={value.compare === "previous"}
            onChange={(event) =>
              choose({ ...value, compare: event.target.checked ? "previous" : "none" })
            }
          />
          Compare to previous period
        </label>
      </div>

      <form
        className="border-t border-line px-2.5 pt-2 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (customValid) choose({ range: "custom", from, to, compare: value.compare });
        }}
      >
        <p className="mb-1.5 flex items-center justify-between text-sm text-ink-2">
          Custom range
          {value.range === "custom" ? (
            <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
          ) : null}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={fromId} className="sr-only">
              From
            </label>
            <Input
              id={fromId}
              type="date"
              value={from}
              max={to || maxDate}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={toId} className="sr-only">
              To
            </label>
            <Input
              id={toId}
              type="date"
              value={to}
              min={from}
              max={maxDate}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="mt-2 w-full justify-center"
          disabled={!customValid}
        >
          Apply custom range
        </Button>
      </form>
    </Popover>
  );
}

"use client";

import { useFilterNavigation } from "@/components/shell/navigation";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { DateRange } from "@/lib/dates";
import { type OverviewPageState, overviewStateToParams } from "@/lib/filters/overview";

export function OverviewControls({
  state,
  resolved,
  maxDate,
}: {
  state: OverviewPageState;
  resolved: DateRange;
  maxDate: string;
}) {
  const { navigate } = useFilterNavigation();
  return (
    <DateRangePicker
      value={state}
      resolved={resolved}
      maxDate={maxDate}
      onChange={(next) => navigate(overviewStateToParams(next))}
    />
  );
}

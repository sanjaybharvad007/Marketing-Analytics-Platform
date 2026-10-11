"use client";

import { useFilterNavigation } from "@/components/shell/navigation";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { Segmented } from "@/components/ui/segmented";
import type { DateRange } from "@/lib/dates";
import { type Engine, ENGINE_LABELS, ENGINES } from "@/lib/domain";
import { type AiPageState, aiStateToParams } from "@/lib/filters/ai";

const SHOW_OPTIONS = [
  { value: "all", label: "All prompts" },
  { value: "gaps", label: "Gaps only" },
] as const;

export function AiFilterBar({
  state,
  resolved,
  maxDate,
  topics,
}: {
  state: AiPageState;
  resolved: DateRange;
  maxDate: string;
  topics: string[];
}) {
  const { navigate } = useFilterNavigation();
  const update = (changes: Partial<AiPageState>) =>
    navigate(aiStateToParams({ ...state, ...changes, prompt: undefined }));

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Report filters">
      <DateRangePicker
        value={state}
        resolved={resolved}
        maxDate={maxDate}
        onChange={(next) =>
          update({ range: next.range, from: next.from, to: next.to, compare: next.compare })
        }
      />
      <MultiSelect
        label="Engine"
        options={ENGINES.map((engine) => ({ value: engine, label: ENGINE_LABELS[engine] }))}
        selected={state.engine}
        onChange={(engine) => update({ engine: engine as Engine[] })}
      />
      <div className="w-48">
        <label htmlFor="ai-topic" className="sr-only">
          Topic
        </label>
        <Select
          id="ai-topic"
          value={state.topic ?? ""}
          onChange={(event) => update({ topic: event.target.value || undefined })}
        >
          <option value="">All topics</option>
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </Select>
      </div>
      <Segmented
        label="Prompts shown"
        options={SHOW_OPTIONS}
        value={state.show}
        onChange={(show) => update({ show })}
      />
    </div>
  );
}

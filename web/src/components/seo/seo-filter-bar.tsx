"use client";

import { Download, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFilterNavigation } from "@/components/shell/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Field, Input, Select } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { Popover } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import type { DateRange } from "@/lib/dates";
import { countryLabel, DEVICES, humanize, PAGE_TYPES, type PageType } from "@/lib/domain";
import {
  POSITION_BUCKETS,
  type PositionBucket,
  type SeoPageState,
  seoStateToParams,
} from "@/lib/filters/seo";
import type { SavedView } from "@/lib/services/views";
import { SavedViews } from "./saved-views";

const BRAND_OPTIONS = [
  { value: "all", label: "All queries" },
  { value: "brand", label: "Brand" },
  { value: "non_brand", label: "Non-brand" },
] as const;

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  const text = String(value ?? "").trim();
  if (text === "") return undefined;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function textOrUndefined(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text === "" ? undefined : text.slice(0, 200);
}

export function SeoFilterBar({
  state,
  resolved,
  maxDate,
  countries,
  sections,
  views,
}: {
  state: SeoPageState;
  resolved: DateRange;
  maxDate: string;
  countries: string[];
  sections: string[];
  views: SavedView[];
}) {
  const { navigate } = useFilterNavigation();
  const [moreOpen, setMoreOpen] = useState(false);
  const keywordsTab = state.tab === "keywords";

  /** Apply a change and return to the first page of results. */
  function update(changes: Partial<SeoPageState>) {
    navigate(seoStateToParams({ ...state, ...changes, page: 1 }));
  }

  function applyMore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pageType = String(form.get("page_type") ?? "");
    update({
      q: textOrUndefined(form.get("q")),
      q_not: textOrUndefined(form.get("q_not")),
      url: textOrUndefined(form.get("url")),
      page_type: (PAGE_TYPES as readonly string[]).includes(pageType)
        ? (pageType as PageType)
        : undefined,
      min_impressions: numberOrUndefined(form.get("min_impressions")),
      min_clicks: numberOrUndefined(form.get("min_clicks")),
    });
    setMoreOpen(false);
  }

  const moreCount = [
    state.q,
    state.q_not,
    state.url,
    state.page_type,
    state.min_impressions,
    state.min_clicks,
  ].filter((value) => value !== undefined).length;

  const exportParams = seoStateToParams({ ...state, page: 1 });
  exportParams.delete("tab");
  exportParams.delete("metric");
  exportParams.delete("page_size");
  exportParams.set("format", "csv");

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
      {keywordsTab ? null : (
        <>
          <MultiSelect
            label="Country"
            options={countries.map((code) => ({ value: code, label: countryLabel(code) }))}
            selected={state.country}
            onChange={(country) => update({ country })}
          />
          <MultiSelect
            label="Device"
            options={DEVICES.map((device) => ({ value: device, label: humanize(device) }))}
            selected={state.device}
            onChange={(device) => update({ device: device as SeoPageState["device"] })}
          />
        </>
      )}
      <MultiSelect
        label="Section"
        options={sections.map((section) => ({ value: section, label: humanize(section) }))}
        selected={state.section}
        onChange={(section) => update({ section })}
      />
      <MultiSelect
        label="Position"
        options={POSITION_BUCKETS.map((bucket) => ({ value: bucket, label: bucket }))}
        selected={state.position}
        onChange={(position) => update({ position: position as PositionBucket[] })}
      />
      {keywordsTab ? null : (
        <Segmented
          label="Brand or non-brand queries"
          options={BRAND_OPTIONS}
          value={state.brand}
          onChange={(brand) => update({ brand })}
        />
      )}

      <Popover
        open={moreOpen}
        onOpenChange={setMoreOpen}
        className="w-80 p-3"
        trigger={
          <button type="button" className={buttonClass("secondary", "md")}>
            <SlidersHorizontal aria-hidden="true" className="size-3.5 text-ink-3" />
            More filters
            {moreCount > 0 ? (
              <span className="num rounded-sm bg-accent-soft px-1 text-xs font-semibold text-accent-text">
                {moreCount}
              </span>
            ) : null}
          </button>
        }
      >
        <form
          onSubmit={applyMore}
          className="flex flex-col gap-3"
          key={seoStateToParams(state).toString()}
        >
          <Field label={keywordsTab ? "Keyword contains" : "Query contains"}>
            {(props) => (
              <Input name="q" defaultValue={state.q ?? ""} placeholder="tent" {...props} />
            )}
          </Field>
          <Field label={keywordsTab ? "Keyword does not contain" : "Query does not contain"}>
            {(props) => (
              <Input
                name="q_not"
                defaultValue={state.q_not ?? ""}
                placeholder="review"
                {...props}
              />
            )}
          </Field>
          <Field label="URL contains">
            {(props) => (
              <Input name="url" defaultValue={state.url ?? ""} placeholder="/guides/" {...props} />
            )}
          </Field>
          <Field label="Page type">
            {(props) => (
              <Select name="page_type" defaultValue={state.page_type ?? ""} {...props}>
                <option value="">Any</option>
                {PAGE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {humanize(type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {keywordsTab ? null : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min. impressions">
                {(props) => (
                  <Input
                    name="min_impressions"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    defaultValue={state.min_impressions ?? ""}
                    {...props}
                  />
                )}
              </Field>
              <Field label="Min. clicks">
                {(props) => (
                  <Input
                    name="min_clicks"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    defaultValue={state.min_clicks ?? ""}
                    {...props}
                  />
                )}
              </Field>
            </div>
          )}
          <Button type="submit" variant="primary" className="justify-center">
            Apply filters
          </Button>
        </form>
      </Popover>

      <div className="ml-auto flex items-center gap-2">
        <SavedViews state={state} views={views} />
        <a
          href={`/api/v1/seo/${state.tab}?${exportParams}`}
          download
          className={buttonClass("secondary", "md")}
          data-testid="export-csv"
        >
          <Download aria-hidden="true" className="size-3.5 text-ink-3" />
          Export CSV
        </a>
      </div>
    </div>
  );
}

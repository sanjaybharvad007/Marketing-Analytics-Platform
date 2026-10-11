/** Human-readable descriptions of the active SEO filters, for the chip row. */
import { countryLabel, humanize } from "@/lib/domain";
import { type SeoFilterKey, type SeoPageState } from "./seo";

export interface FilterChip {
  key: SeoFilterKey;
  label: string;
  /** For multi-value filters: the single value this chip removes. */
  value?: string;
}

export function describeSeoFilters(
  state: SeoPageState,
  lookups: { pageLabel?: string } = {},
): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const code of state.country) {
    chips.push({ key: "country", value: code, label: `Country: ${countryLabel(code)}` });
  }
  for (const device of state.device) {
    chips.push({ key: "device", value: device, label: `Device: ${humanize(device)}` });
  }
  for (const section of state.section) {
    chips.push({ key: "section", value: section, label: `Section: ${humanize(section)}` });
  }
  if (state.page_type) {
    chips.push({ key: "page_type", label: `Page type: ${humanize(state.page_type)}` });
  }
  if (state.brand !== "all") {
    chips.push({
      key: "brand",
      label: state.brand === "brand" ? "Brand queries" : "Non-brand queries",
    });
  }
  for (const bucket of state.position) {
    chips.push({ key: "position", value: bucket, label: `Position ${bucket}` });
  }
  if (state.q) chips.push({ key: "q", label: `Query contains "${state.q}"` });
  if (state.q_not) chips.push({ key: "q_not", label: `Query does not contain "${state.q_not}"` });
  if (state.url) chips.push({ key: "url", label: `URL contains "${state.url}"` });
  if (state.min_impressions !== undefined) {
    chips.push({ key: "min_impressions", label: `Impressions ≥ ${state.min_impressions}` });
  }
  if (state.min_clicks !== undefined) {
    chips.push({ key: "min_clicks", label: `Clicks ≥ ${state.min_clicks}` });
  }
  if (state.query) chips.push({ key: "query", label: `Query: ${state.query}` });
  if (state.page_id) {
    chips.push({ key: "page_id", label: `Page: ${lookups.pageLabel ?? `#${state.page_id}`}` });
  }
  return chips;
}

/** The state with one chip's filter removed, back on page 1. */
export function removeChip(state: SeoPageState, chip: FilterChip): SeoPageState {
  const next: SeoPageState = { ...state, page: 1 };
  switch (chip.key) {
    case "country":
      next.country = state.country.filter((value) => value !== chip.value);
      break;
    case "device":
      next.device = state.device.filter((value) => value !== chip.value);
      break;
    case "section":
      next.section = state.section.filter((value) => value !== chip.value);
      break;
    case "position":
      next.position = state.position.filter((value) => value !== chip.value);
      break;
    case "brand":
      next.brand = "all";
      break;
    default:
      delete next[chip.key];
  }
  return next;
}

/** The state with every data filter cleared; dates, tab, metric and sort are kept. */
export function clearFilters(state: SeoPageState): SeoPageState {
  return {
    range: state.range,
    from: state.from,
    to: state.to,
    compare: state.compare,
    tab: state.tab,
    metric: state.metric,
    sort: state.sort,
    dir: state.dir,
    page_size: state.page_size,
    page: 1,
    country: [],
    device: [],
    section: [],
    brand: "all",
    position: [],
  };
}

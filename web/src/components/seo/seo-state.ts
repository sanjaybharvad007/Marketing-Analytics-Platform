import { type SeoPageState, seoStateToParams } from "@/lib/filters/seo";

/** Href of the SEO report with part of the state replaced. */
export function seoHref(state: SeoPageState, changes: Partial<SeoPageState> = {}): string {
  const query = seoStateToParams({ ...state, ...changes }).toString();
  return query ? `/reports/seo?${query}` : "/reports/seo";
}

/** Toggle sort: a new column starts descending; the active one flips. */
export function sortHref(state: SeoPageState, activeSort: string, key: string): string {
  const dir = activeSort === key && state.dir === "desc" ? "asc" : "desc";
  return seoHref(state, { sort: key, dir, page: 1 });
}

export function sortState(
  state: SeoPageState,
  activeSort: string,
  key: string,
): "asc" | "desc" | null {
  return activeSort === key ? state.dir : null;
}

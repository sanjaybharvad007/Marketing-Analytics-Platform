/** Column definitions for the SEO report's CSV exports. */
import type { KeywordRow, PageRow, QueryRow, SearchMetrics } from "@/lib/services/seo";
import { type CsvColumn, rounded } from "./csv";

/** Rows in one CSV export; the API never streams more than this. */
export const EXPORT_LIMIT = 10_000;

function metricColumns<Row extends SearchMetrics>(compare: boolean): CsvColumn<Row>[] {
  const current: CsvColumn<Row>[] = [
    { header: "clicks", value: (row) => row.clicks },
    { header: "impressions", value: (row) => row.impressions },
    { header: "ctr", value: (row) => rounded(row.ctr, 4) },
    { header: "position", value: (row) => rounded(row.position, 2) },
  ];
  if (!compare) return current;
  return [
    ...current,
    { header: "clicks_previous", value: (row) => row.clicks_prev },
    { header: "impressions_previous", value: (row) => row.impressions_prev },
    { header: "ctr_previous", value: (row) => rounded(row.ctr_prev, 4) },
    { header: "position_previous", value: (row) => rounded(row.position_prev, 2) },
  ];
}

export function queryColumns(compare: boolean): CsvColumn<QueryRow>[] {
  return [{ header: "query", value: (row) => row.query }, ...metricColumns<QueryRow>(compare)];
}

export function pageColumns(compare: boolean): CsvColumn<PageRow>[] {
  return [
    { header: "url", value: (row) => row.url },
    { header: "title", value: (row) => row.title },
    { header: "section", value: (row) => row.section },
    { header: "page_type", value: (row) => row.page_type },
    ...metricColumns<PageRow>(compare),
  ];
}

export function keywordColumns(compare: boolean): CsvColumn<KeywordRow>[] {
  const columns: CsvColumn<KeywordRow>[] = [
    { header: "keyword", value: (row) => row.keyword },
    { header: "position", value: (row) => row.position },
  ];
  if (compare) {
    columns.push(
      { header: "position_previous", value: (row) => row.position_prev },
      { header: "change", value: (row) => row.change },
    );
  }
  return [
    ...columns,
    { header: "search_volume", value: (row) => row.search_volume },
    { header: "difficulty", value: (row) => row.difficulty },
    { header: "intent", value: (row) => row.intent },
    { header: "cpc", value: (row) => row.cpc },
    { header: "url", value: (row) => row.url },
    { header: "serp_features", value: (row) => row.serp_features.join(" ") },
    { header: "snapshot_date", value: (row) => row.snapshot_date },
  ];
}

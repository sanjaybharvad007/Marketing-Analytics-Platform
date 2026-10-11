import { csvResponse, toCsv } from "@/lib/api/csv";
import { ok, pageMeta } from "@/lib/api/envelope";
import { parseWith, route, wantsCsv } from "@/lib/api/handler";
import { resolveQueryPeriods } from "@/lib/api/periods";
import { seoQuerySchema } from "@/lib/api/queries";
import { EXPORT_LIMIT, keywordColumns } from "@/lib/api/seo-export";
import { listKeywords } from "@/lib/services/seo";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const { format: _format, ...filters } = parseWith(seoQuerySchema, query);
  const periods = await resolveQueryPeriods(filters, query);

  if (wantsCsv(query)) {
    const all = await listKeywords({ ...filters, page: 1, page_size: EXPORT_LIMIT }, periods);
    const csv = toCsv(keywordColumns(periods.previous !== null), all.rows);
    return csvResponse(`seo-keywords-${periods.current.from}-${periods.current.to}.csv`, csv);
  }
  const result = await listKeywords(filters, periods);
  return ok(result.rows, {
    ...pageMeta(result.total, filters.page, filters.page_size),
    sort: result.sort,
    dir: filters.dir,
    range: periods.current,
    compare: periods.previous,
  });
});

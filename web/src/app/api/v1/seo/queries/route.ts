import { csvResponse, toCsv } from "@/lib/api/csv";
import { ok, pageMeta } from "@/lib/api/envelope";
import { parseWith, route, wantsCsv } from "@/lib/api/handler";
import { resolveQueryPeriods } from "@/lib/api/periods";
import { seoQuerySchema } from "@/lib/api/queries";
import { EXPORT_LIMIT, queryColumns } from "@/lib/api/seo-export";
import { listQueries } from "@/lib/services/seo";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const { format: _format, ...filters } = parseWith(seoQuerySchema, query);
  const periods = await resolveQueryPeriods(filters, query);

  if (wantsCsv(query)) {
    const all = await listQueries({ ...filters, page: 1, page_size: EXPORT_LIMIT }, periods);
    const csv = toCsv(queryColumns(periods.previous !== null), all.rows);
    return csvResponse(`seo-queries-${periods.current.from}-${periods.current.to}.csv`, csv);
  }
  const result = await listQueries(filters, periods);
  return ok(result.rows, {
    ...pageMeta(result.total, filters.page, filters.page_size),
    sort: result.sort,
    dir: filters.dir,
    range: periods.current,
    compare: periods.previous,
  });
});

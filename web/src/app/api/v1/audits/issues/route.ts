import { csvResponse, toCsv } from "@/lib/api/csv";
import { ok, pageMeta } from "@/lib/api/envelope";
import { parseWith, route, wantsCsv } from "@/lib/api/handler";
import { issueListSchema } from "@/lib/api/schemas";
import { EXPORT_LIMIT } from "@/lib/api/seo-export";
import { listIssues } from "@/lib/services/audits";

export const dynamic = "force-dynamic";

/** Issues of one audit run; the latest run unless `run_id` is given. */
export const GET = route(async ({ query }) => {
  const parsed = parseWith(issueListSchema, query);

  if (wantsCsv(query)) {
    const all = await listIssues({ ...parsed, page: 1, page_size: EXPORT_LIMIT });
    const csv = toCsv(
      [
        { header: "severity", value: (row) => row.severity },
        { header: "rule", value: (row) => row.rule },
        { header: "url", value: (row) => row.url },
        { header: "message", value: (row) => row.message },
        { header: "status", value: (row) => row.status },
      ],
      all.rows,
    );
    return csvResponse(`audit-issues-run-${all.run_id ?? "none"}.csv`, csv);
  }
  const { rows, total, run_id } = await listIssues(parsed);
  return ok(rows, { ...pageMeta(total, parsed.page, parsed.page_size), run_id });
});

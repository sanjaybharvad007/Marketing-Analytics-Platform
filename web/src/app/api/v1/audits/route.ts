import { created, ok, pageMeta } from "@/lib/api/envelope";
import { parseWith, readJson, route } from "@/lib/api/handler";
import { auditRunsQuerySchema } from "@/lib/api/queries";
import { auditIngestSchema } from "@/lib/api/schemas";
import { ingestAudit, listRuns } from "@/lib/services/audits";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const parsed = parseWith(auditRunsQuerySchema, query);
  const { rows, total } = await listRuns(parsed.page, parsed.page_size);
  return ok(rows, pageMeta(total, parsed.page, parsed.page_size));
});

/** Ingest one crawl: the run, its issues and per-page facts. Returns the stored issue ids. */
export const POST = route(async ({ request }) => {
  const input = await readJson(request, auditIngestSchema);
  return created(await ingestAudit(input));
});

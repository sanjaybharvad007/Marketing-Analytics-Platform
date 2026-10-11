import { ok } from "@/lib/api/envelope";
import { route } from "@/lib/api/handler";
import { getAuditOverview } from "@/lib/services/audits";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(await getAuditOverview()));

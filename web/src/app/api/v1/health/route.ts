import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ok } from "@/lib/api/envelope";
import { ApiError } from "@/lib/api/errors";
import { route } from "@/lib/api/handler";
import { getDataAnchor, getWorkspaceStatus } from "@/lib/services/meta";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    throw new ApiError(503, "database_unavailable", "The database is not reachable.");
  }
  const [latest, status] = await Promise.all([getDataAnchor(), getWorkspaceStatus()]);
  return ok({
    status: "ok",
    database: "ok",
    latest_data_date: status.hasData ? latest : null,
    demo_data: status.demo,
  });
});

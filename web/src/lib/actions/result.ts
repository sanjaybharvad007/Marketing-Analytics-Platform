/** Shared plumbing for server actions: a serialisable result and error mapping. */
import { z } from "zod";
import { ApiError, fromDatabaseError } from "@/lib/api/errors";

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; message: string; fieldErrors?: Record<string, string> };

/**
 * Run a mutation and turn validation, not-found and constraint errors into a
 * result the client can show. Unexpected errors are logged and reported
 * generically.
 */
export async function runAction<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (raw) {
    if (raw instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of raw.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      return { ok: false, message: "Check the highlighted fields.", fieldErrors };
    }
    const error = fromDatabaseError(raw);
    if (error instanceof ApiError) return { ok: false, message: error.message };
    console.error("Server action failed", raw);
    return { ok: false, message: "Something went wrong. Try again." };
  }
}

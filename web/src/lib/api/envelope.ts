/** The JSON envelope: `{ data, meta }` on success, `{ error }` on failure. */
import { ApiError, fromDatabaseError } from "./errors";

export interface Meta {
  [key: string]: unknown;
}

export interface PageMeta extends Meta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export function pageMeta(total: number, page: number, pageSize: number): PageMeta {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function ok<T>(data: T, meta: Meta = {}, status = 200): Response {
  return Response.json({ data, meta }, { status });
}

export function created<T>(data: T, meta: Meta = {}): Response {
  return ok(data, meta, 201);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function errorResponse(error: unknown): Response {
  const mapped = fromDatabaseError(error);
  if (mapped instanceof ApiError) {
    const body = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
      },
    };
    const headers: HeadersInit =
      mapped.status === 401 ? { "WWW-Authenticate": 'Bearer realm="api"' } : {};
    return Response.json(body, { status: mapped.status, headers });
  }
  console.error("Unhandled API error", error);
  return Response.json(
    { error: { code: "internal_error", message: "An unexpected error occurred." } },
    { status: 500 },
  );
}

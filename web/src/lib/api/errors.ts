/** Errors that map onto HTTP responses. Services throw these; route handlers serialise them. */

export interface ErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);

export const validationError = (details: ErrorDetail[]) =>
  new ApiError(400, "validation_error", "The request is not valid.", details);

export const unauthorized = (message = "A valid bearer token is required.") =>
  new ApiError(401, "unauthorized", message);

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} was not found.`);

export const conflict = (message: string) => new ApiError(409, "conflict", message);

interface PostgresError {
  code: string;
  constraint_name?: string;
  detail?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

/** Find a PostgreSQL error on an exception or anywhere in its `cause` chain. */
function findPostgresError(error: unknown): PostgresError | null {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (isPostgresError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Translate constraint violations into client errors. Anything else is
 * returned unchanged for the caller to treat as an internal error.
 */
export function fromDatabaseError(error: unknown): unknown {
  const pg = findPostgresError(error);
  if (!pg) return error;
  if (pg.code === "23505") return conflict("A record with the same unique value already exists.");
  if (pg.code === "23503") return badRequest("A referenced record does not exist.");
  if (pg.code === "23514") return badRequest("A value is outside the allowed range.");
  return error;
}

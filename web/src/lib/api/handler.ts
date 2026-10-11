/** Wrapper shared by every route handler: auth, parameter parsing, error envelope. */
import type { NextRequest } from "next/server";
import type { z } from "zod";
import { env } from "@/lib/env";
import { normalizeParams } from "@/lib/filters/params";
import { authorize } from "./auth";
import { errorResponse } from "./envelope";
import { badRequest, type ErrorDetail, notFound, validationError } from "./errors";

export interface RouteContext<P> {
  request: NextRequest;
  params: P;
  /** Search params with repeated keys joined by commas and empty values dropped. */
  query: Record<string, string>;
}

type Handler<P> = (context: RouteContext<P>) => Promise<Response> | Response;

export function route<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    try {
      const { API_TOKEN, API_REQUIRE_TOKEN_FOR_READS } = env();
      authorize(request.method, request.headers.get("authorization"), {
        token: API_TOKEN,
        requireForReads: API_REQUIRE_TOKEN_FOR_READS,
      });
      return await handler({
        request,
        params: await segment.params,
        query: normalizeParams(request.nextUrl.searchParams),
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function issuesToDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Validate input against a schema, raising a 400 with per-field details. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(issuesToDetails(result.error));
  return result.data;
}

export async function readJson<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
  return parseWith(schema, body);
}

/** Parse a numeric path segment; anything else cannot name a record. */
export function idParam(value: string, what: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value)) throw notFound(what);
  return Number(value);
}

export function wantsCsv(query: Record<string, string>): boolean {
  return query.format === "csv";
}

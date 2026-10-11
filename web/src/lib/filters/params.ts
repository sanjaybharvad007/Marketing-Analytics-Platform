/** Shared building blocks for filter schemas and their URL encoding. */
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";

export type RawParams = Record<string, string | string[] | undefined>;

/**
 * Flatten Next.js search params (or URLSearchParams) into a plain record.
 * Repeated keys are joined with commas, the same encoding multi-select
 * filters use; empty values are dropped so `?q=` means "no filter".
 */
export function normalizeParams(input: RawParams | URLSearchParams): Record<string, string> {
  const entries: Array<[string, string]> = [];
  if (input instanceof URLSearchParams) {
    for (const key of new Set(input.keys())) entries.push([key, input.getAll(key).join(",")]);
  } else {
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) entries.push([key, Array.isArray(value) ? value.join(",") : value]);
    }
  }
  return Object.fromEntries(entries.filter(([, value]) => value.trim() !== ""));
}

/** Comma-separated list in the URL, deduplicated array in code. */
export function csv<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => {
    if (Array.isArray(value)) return [...new Set(value)];
    if (typeof value !== "string") return value;
    return [
      ...new Set(
        value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      ),
    ];
  }, z.array(item).max(50));
}

export const isoDate = z.string().refine(isIsoDate, "Expected a calendar date as YYYY-MM-DD");

export const searchText = z.string().trim().min(1).max(200);
export const positiveInt = z.coerce.number().int().positive();
export const nonNegativeInt = z.coerce.number().int().min(0);

export const dateParams = {
  range: z.enum(["7d", "28d", "90d", "custom"]).default("28d"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  compare: z.enum(["previous", "none"]).default("previous"),
};

export const pagingParams = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
};

export const sortDirection = z.enum(["asc", "desc"]);

/**
 * Parse for page rendering: a malformed parameter is ignored (its default
 * applies) instead of failing the whole page. Every field of `schema` must be
 * optional or have a default.
 */
export function parseLenient<S extends z.ZodObject>(
  schema: S,
  input: Record<string, unknown>,
): z.output<S> {
  const first = schema.safeParse(input);
  if (first.success) return first.data;
  const invalid = new Set(first.error.issues.map((issue) => String(issue.path[0])));
  const cleaned = Object.fromEntries(Object.entries(input).filter(([key]) => !invalid.has(key)));
  return schema.parse(cleaned);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return left === right;
}

/**
 * Encode filter values as URL search params, leaving out anything equal to
 * its default so shared links stay short and stable.
 */
export function serializeParams<S extends z.ZodObject>(
  schema: S,
  values: Partial<z.output<S>>,
): URLSearchParams {
  const defaults = schema.parse({}) as Record<string, unknown>;
  const params = new URLSearchParams();
  for (const key of Object.keys(schema.shape)) {
    const value = (values as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === "") continue;
    if (sameValue(value, defaults[key])) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

/** Escape `%`, `_` and `\` so user text matches literally inside LIKE/ILIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function containsPattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

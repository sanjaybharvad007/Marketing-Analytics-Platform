/** Bearer-token check for the REST API. */
import { createHash, timingSafeEqual } from "node:crypto";
import { unauthorized } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface AuthConfig {
  token: string;
  requireForReads: boolean;
}

/** Compare two secrets in constant time, whatever their lengths. */
export function tokensMatch(presented: string, expected: string): boolean {
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Throw 401 unless the request may proceed.
 *
 * Writes always need the token. Reads need it only when `requireForReads`
 * is set. With no token configured on the server, writes are refused rather
 * than left open.
 */
export function authorize(method: string, authorization: string | null, config: AuthConfig): void {
  const isRead = SAFE_METHODS.has(method.toUpperCase());
  if (isRead && !config.requireForReads) return;
  if (!config.token) {
    throw unauthorized("API_TOKEN is not configured on the server, so this request is refused.");
  }
  const presented = bearerToken(authorization);
  if (!presented || !tokensMatch(presented, config.token)) throw unauthorized();
}

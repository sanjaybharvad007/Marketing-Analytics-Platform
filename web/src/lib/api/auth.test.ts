import { describe, expect, it } from "vitest";
import { authorize, bearerToken, tokensMatch } from "./auth";
import { ApiError } from "./errors";

const OPEN_READS = { token: "s3cret", requireForReads: false };
const CLOSED_READS = { token: "s3cret", requireForReads: true };

function attempt(method: string, header: string | null, config = OPEN_READS): number {
  try {
    authorize(method, header, config);
    return 200;
  } catch (error) {
    return error instanceof ApiError ? error.status : 500;
  }
}

describe("tokensMatch", () => {
  it("matches only identical tokens, whatever their length", () => {
    expect(tokensMatch("s3cret", "s3cret")).toBe(true);
    expect(tokensMatch("s3cret", "s3creT")).toBe(false);
    expect(tokensMatch("s3", "s3cret")).toBe(false);
    expect(tokensMatch("", "s3cret")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer   abc")).toBe("abc");
  });

  it("returns null for other schemes or malformed headers", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
  });
});

describe("authorize", () => {
  it("lets reads through without a token by default", () => {
    expect(attempt("GET", null)).toBe(200);
    expect(attempt("HEAD", null)).toBe(200);
  });

  it("requires the token on every write", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(attempt(method, null)).toBe(401);
      expect(attempt(method, "Bearer wrong")).toBe(401);
      expect(attempt(method, "Bearer s3cret")).toBe(200);
    }
  });

  it("requires the token on reads when configured", () => {
    expect(attempt("GET", null, CLOSED_READS)).toBe(401);
    expect(attempt("GET", "Bearer s3cret", CLOSED_READS)).toBe(200);
  });

  it("refuses writes when the server has no token configured", () => {
    const unconfigured = { token: "", requireForReads: false };
    expect(attempt("POST", "Bearer anything", unconfigured)).toBe(401);
    expect(attempt("POST", "Bearer ", unconfigured)).toBe(401);
    expect(attempt("GET", null, unconfigured)).toBe(200);
  });
});

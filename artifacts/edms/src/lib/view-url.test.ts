/**
 * DEBT-008 reproducer + regression for the frontend view-token URL construction.
 *
 * Proves the OLD manual `${url}?vt=${token}` is broken for R2/S3 serve URLs (which
 * already have `?orgId=…`), and that withViewToken() produces a valid, parseable URL
 * for every backend shape.
 */
import { describe, it, expect } from "vitest";
import { withViewToken } from "./view-url.js";

// Parse the query of a possibly-relative URL the way a server would (first '?' onwards).
function query(url: string): URLSearchParams {
  const q = url.indexOf("?");
  return new URLSearchParams(q === -1 ? "" : url.slice(q + 1));
}

const R2_SERVE = "/api/storage/r2-object/org_15%2Fprojects%2F16%2F1699_report.pdf?orgId=15";
const S3_SERVE = "/api/storage/s3-object/15%2F16%2Fdocument%2F1699_report.pdf?orgId=15";
const ONP_SERVE = "/api/storage/onpremise/15/16/document/1699_report.pdf";
const TOKEN = "eyJhbGciOi.TESTTOKEN.sig";

describe("DEBT-008 reproducer — the OLD manual concatenation is broken for R2/S3", () => {
  it("`${url}?vt=${token}` on a serve URL that already has ?orgId swallows vt (unparseable)", () => {
    const bad = `${R2_SERVE}?vt=${TOKEN}`; // the pattern used across the UI before the fix
    // The browser/server parse everything after the FIRST '?' as one query string:
    expect(bad).toContain("?orgId=15?vt="); // malformed double '?'
    expect(query(bad).get("vt")).toBeNull(); // vt is NOT a real param → 401 on navigation
  });
});

describe("DEBT-008 regression — withViewToken() produces a valid URL for every backend", () => {
  it("R2 (has ?orgId): vt is a real param AND orgId is preserved", () => {
    const url = withViewToken(R2_SERVE, TOKEN);
    const q = query(url);
    expect(q.get("vt")).toBe(TOKEN);
    expect(q.get("orgId")).toBe("15");
    expect(url).not.toContain("?orgId=15?vt="); // no malformed double '?'
    // the encoded object key in the PATH is untouched
    expect(url.startsWith("/api/storage/r2-object/org_15%2Fprojects%2F16%2F1699_report.pdf?")).toBe(true);
  });

  it("S3 (has ?orgId): vt parseable, orgId preserved", () => {
    const q = query(withViewToken(S3_SERVE, TOKEN));
    expect(q.get("vt")).toBe(TOKEN);
    expect(q.get("orgId")).toBe("15");
  });

  it("on-premise (no query): appends ?vt correctly", () => {
    const url = withViewToken(ONP_SERVE, TOKEN);
    expect(query(url).get("vt")).toBe(TOKEN);
    expect(url).toBe(`${ONP_SERVE}?vt=${encodeURIComponent(TOKEN)}`.replace(/%2E/g, "."));
  });

  it("supports extra params (e.g. ct for preview) alongside vt + existing orgId", () => {
    const q = query(withViewToken(R2_SERVE, TOKEN, { ct: "application/pdf" }));
    expect(q.get("vt")).toBe(TOKEN);
    expect(q.get("orgId")).toBe("15");
    expect(q.get("ct")).toBe("application/pdf");
  });
});

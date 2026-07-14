/**
 * storage-serve-url.test.ts — B2.3b-1 / F2
 *
 * Pure-function proof of the canonical serve-URL contract shared between serve-
 * URL CREATION (the storage adapters) and VERIFICATION (the download guard).
 *
 * For every backend the STORED serve URL (what the adapter writes to
 * document_files.file_url) and the REQUEST path the serve route reconstructs
 * from Express-decoded params MUST canonicalise to the SAME identity — otherwise
 * the guard would miss that backend. S3/R2 are the ones that regressed before
 * F2: their stored form carries an encodeURIComponent'd key + ?orgId query the
 * request path does not have.
 */
import { describe, it, expect } from "vitest";
import { canonicalizeStorageServeUrl } from "../lib/storage-serve-url.js";
import { s3ServeUrl, r2ServeUrl } from "../lib/orgStorage.js";

const ORG = 7;

/** What the serve route rebuilds from Express params (:objectKey is decoded). */
const s3RequestPath = (key: string) => `/api/storage/s3-object/${key}`;
const r2RequestPath = (key: string) => `/api/storage/r2-object/${key}`;

describe("canonicalizeStorageServeUrl — stored form == request form (per backend)", () => {
  it("S3: encoded-key + ?orgId stored form matches the decoded request path", () => {
    const key = `${ORG}/1/document/1712000000000_report.pdf`;
    const stored = s3ServeUrl(ORG, key); // /api/storage/s3-object/<enc(key)>?orgId=7
    expect(stored).toContain("%2F");     // sanity: the stored key really is encoded
    expect(stored).toContain("?orgId=7");
    expect(canonicalizeStorageServeUrl(stored)).toBe(canonicalizeStorageServeUrl(s3RequestPath(key)));
  });

  it("R2: encoded-key + ?orgId stored form matches the decoded request path", () => {
    const key = `org_${ORG}/projects/1/1712000000000_plan.pdf`;
    const stored = r2ServeUrl(ORG, key);
    expect(canonicalizeStorageServeUrl(stored)).toBe(canonicalizeStorageServeUrl(r2RequestPath(key)));
  });

  it("on-premise: identical stored/request path canonicalises equal", () => {
    const stored = `/api/storage/onpremise/${ORG}/1/general/1712000000000_spec.pdf`;
    expect(canonicalizeStorageServeUrl(stored)).toBe(canonicalizeStorageServeUrl(stored));
  });

  it("cloud/GCS: object path canonicalises equal", () => {
    const stored = `/api/storage/objects/uploads/1712000000000_photo.png`;
    expect(canonicalizeStorageServeUrl(stored)).toBe(canonicalizeStorageServeUrl(stored));
  });
});

describe("canonicalizeStorageServeUrl — tamper resistance & precision", () => {
  it("query params (orgId, order, extras) are irrelevant to identity", () => {
    const base = `/api/storage/s3-object/${encodeURIComponent("7/1/document/x.pdf")}`;
    expect(canonicalizeStorageServeUrl(`${base}?orgId=7`))
      .toBe(canonicalizeStorageServeUrl(`${base}?foo=bar&orgId=7`));
    expect(canonicalizeStorageServeUrl(`${base}?orgId=7`))
      .toBe(canonicalizeStorageServeUrl(base));
  });

  it("re-encoding the same key yields the same identity", () => {
    const key = "7/1/document/x.pdf";
    const encodedOnce = `/api/storage/s3-object/${encodeURIComponent(key)}`;
    const decodedPath = `/api/storage/s3-object/${key}`;
    expect(canonicalizeStorageServeUrl(encodedOnce)).toBe(canonicalizeStorageServeUrl(decodedPath));
  });

  it("duplicate slashes and a trailing slash are normalised away", () => {
    expect(canonicalizeStorageServeUrl("/api/storage//objects///a/b.pdf/"))
      .toBe("/api/storage/objects/a/b.pdf");
  });

  it("DIFFERENT objects do NOT collide (near-identical paths stay distinct)", () => {
    const a = canonicalizeStorageServeUrl(s3ServeUrl(ORG, `${ORG}/1/document/near_a.pdf`));
    const b = canonicalizeStorageServeUrl(s3ServeUrl(ORG, `${ORG}/1/document/near_b.pdf`));
    expect(a).not.toBe(b);
  });

  it("malformed percent-encoding does not throw (falls back to raw path)", () => {
    expect(() => canonicalizeStorageServeUrl("/api/storage/s3-object/%E0%A4%A")).not.toThrow();
  });
});

/**
 * storage-access.test.ts — DEBT-010 F8 invariant tests.
 *
 * The invariant under test: an INTERNAL /api/storage/* (or /objects/*) URL is never
 * handed to the browser for navigation/download without a valid `vt`, and a failure to
 * obtain a token THROWS instead of falling back to the raw URL.
 *
 * Runs in the project's `node` test env (no jsdom); the few browser globals the module
 * touches (localStorage, window.open, document.createElement, URL) are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isInternalStorageUrl,
  resolveAuthenticatedStorageUrl,
  openStorageFile,
  downloadStorageFile,
} from "./storage-access";

const R2 = "/api/storage/r2-object/org_15%2Fprojects%2F16%2F1699_report.pdf?orgId=15";
const S3 = "/api/storage/s3-object/15%2F16%2Fdocument%2F1699_report.pdf?orgId=15";
const ONP = "/api/storage/onpremise/15/16/document/1699_report.pdf";
const EXTERNAL = "https://cdn.example.com/file.pdf";

const hasNoRawInternal = (u: string) => !(isInternalStorageUrl(u) && !/[?&]vt=/.test(u));

function tokenFetch(ok: boolean, body: unknown = { token: "TVT" }) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
    blob: async () => ({ size: 1 }),
  });
}

function stubWindowOpen(ret: unknown) {
  const openSpy = vi.fn().mockReturnValue(ret);
  vi.stubGlobal("window", { open: openSpy });
  return openSpy;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => "BEARER", setItem: () => {} });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} });
  vi.stubGlobal("document", {
    createElement: () => ({ href: "", download: "", rel: "", click: () => {} }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("resolveAuthenticatedStorageUrl", () => {
  it("returns external URLs unchanged, no fetch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await resolveAuthenticatedStorageUrl(EXTERNAL)).toBe(EXTERNAL);
    expect(f).not.toHaveBeenCalled();
  });

  it.each([R2, S3, ONP])("appends a real vt to internal URL: %s", async (url) => {
    vi.stubGlobal("fetch", tokenFetch(true));
    const out = await resolveAuthenticatedStorageUrl(url);
    expect(out).toMatch(/[?&]vt=TVT/);
    expect(hasNoRawInternal(out)).toBe(true);
  });

  it("THROWS (never returns raw) when the token request fails", async () => {
    vi.stubGlobal("fetch", tokenFetch(false));
    await expect(resolveAuthenticatedStorageUrl(R2)).rejects.toThrow();
  });

  it("THROWS when the response carries no token", async () => {
    vi.stubGlobal("fetch", tokenFetch(true, {}));
    await expect(resolveAuthenticatedStorageUrl(R2)).rejects.toThrow();
  });
});

describe("openStorageFile — never navigates to a raw internal URL", () => {
  it("points the pre-opened tab at a vt URL on success", async () => {
    vi.stubGlobal("fetch", tokenFetch(true));
    const fakeWin = { location: { href: "" }, close: vi.fn(), opener: {} };
    const openSpy = stubWindowOpen(fakeWin);
    await openStorageFile(R2);
    expect(openSpy).toHaveBeenCalledWith("about:blank", "_blank");
    expect(fakeWin.location.href).toMatch(/[?&]vt=TVT/);
    expect(hasNoRawInternal(fakeWin.location.href)).toBe(true);
  });

  it("closes the blank tab and throws on token failure (no raw navigation)", async () => {
    vi.stubGlobal("fetch", tokenFetch(false));
    const fakeWin = { location: { href: "" }, close: vi.fn(), opener: {} };
    stubWindowOpen(fakeWin);
    await expect(openStorageFile(R2)).rejects.toThrow();
    expect(fakeWin.close).toHaveBeenCalled();
    expect(fakeWin.location.href).toBe(""); // never set to the raw URL
  });
});

describe("downloadStorageFile — never navigates to a raw internal URL", () => {
  it("throws on token failure without opening anything raw", async () => {
    vi.stubGlobal("fetch", tokenFetch(false));
    const openSpy = stubWindowOpen({});
    await expect(downloadStorageFile(R2, "f.pdf")).rejects.toThrow();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("blob fallback navigates to the vt URL, never the raw URL", async () => {
    // token ok, but the blob fetch throws (simulates R2 cross-origin CORS block)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: "TVT" }) })
      .mockRejectedValueOnce(new Error("CORS"));
    vi.stubGlobal("fetch", fetchMock);
    const openSpy = stubWindowOpen({});
    await downloadStorageFile(R2, "f.pdf");
    const navigated = openSpy.mock.calls[0]?.[0] as string;
    expect(navigated).toMatch(/[?&]vt=TVT/);
    expect(hasNoRawInternal(navigated)).toBe(true);
  });
});

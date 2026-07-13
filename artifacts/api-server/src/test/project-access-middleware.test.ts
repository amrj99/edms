/**
 * project-access-middleware.test.ts — B2 Refactor
 *
 * Unit proof that the extracted primitive is FAIL-CLOSED:
 *   - requireProjectAccessContext throws when the request never passed
 *     requireProjectAccess() (no silent undefined);
 *   - denyPartyDestructive fails closed (throws → 500 via the error handler)
 *     when the context is missing, and never silently calls next();
 *   - with a context present it denies party callers (403) and lets others pass.
 */

import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireProjectAccessContext, denyPartyDestructive } from "../middlewares/project-access.js";

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; }) as any;
  res.json = vi.fn((b: unknown) => { res.body = b; return res; }) as any;
  return res;
}

describe("B2 Refactor — project-access primitive is fail-closed", () => {
  it("requireProjectAccessContext THROWS when no context was set", () => {
    expect(() => requireProjectAccessContext({} as Request)).toThrow(/no project-access context/i);
  });

  it("denyPartyDestructive FAILS CLOSED (throws, no next) when context is missing", () => {
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    expect(() => denyPartyDestructive({} as Request, res, next)).toThrow(/no project-access context/i);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("denyPartyDestructive DENIES a party caller (403, no next)", () => {
    const req = { projectAccess: { mode: "party", partyRole: "contributor", projectOrgId: 1 } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    denyPartyDestructive(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect((res as any).body).toMatchObject({ error: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("denyPartyDestructive ALLOWS a non-party caller (calls next)", () => {
    for (const mode of ["intra_org", "member", "system"]) {
      const req = { projectAccess: { mode, projectOrgId: 1 } } as unknown as Request;
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;
      denyPartyDestructive(req, res, next);
      expect(next, `mode=${mode} should pass`).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});

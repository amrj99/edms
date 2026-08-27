/**
 * background-tenant-context.test.ts — DEBT-010 Decision B (background-jobs gate).
 *
 * Proves the named background/system contexts behave correctly and in isolation:
 *   • withSystemTenantTx(orgId) sets org context, is_system_owner=false, and NO human
 *     user (current_user_id empty) — a per-org system actor.
 *   • withSystemContext() sets is_system_owner=true (the single platform-wide escape).
 *   • Concurrent per-org background units do NOT leak context into each other.
 *   • A failure in one org's unit does not leak context/tx into another org's unit.
 *   • The pool is clean after (transaction-local SET LOCAL rolled off).
 *
 * These are plumbing proofs (read current_setting on the tx connection), independent
 * of RLS enforcement — they hold on any role.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { pool, currentDb, withSystemTenantTx, withSystemContext } from "@workspace/db";

const readCtx = async () => {
  const r = await (currentDb() as { execute: (q: unknown) => Promise<{ rows: Array<{ org: string; owner: string; usr: string }> }> })
    .execute(sql`SELECT current_setting('app.current_org_id', true) AS org,
                        current_setting('app.is_system_owner', true) AS owner,
                        current_setting('app.current_user_id', true) AS usr`);
  return r.rows[0];
};

describe("DEBT-010 — background/system contexts", () => {
  it("withSystemTenantTx sets org, is_system_owner=false, empty user", async () => {
    const ctx = await withSystemTenantTx(111, readCtx);
    expect(ctx.org).toBe("111");
    expect(ctx.owner).toBe("false");
    expect(ctx.usr).toBe(""); // NO human impersonation
  });

  it("withSystemContext sets the explicit system-owner flag, no org, empty user", async () => {
    const ctx = await withSystemContext(readCtx);
    expect(ctx.owner).toBe("true");
    expect(ctx.org).toBe("");
    expect(ctx.usr).toBe("");
  });

  it("concurrent per-org background units do NOT leak context", async () => {
    const [a, b] = await Promise.all([
      withSystemTenantTx(111, async () => { await new Promise((r) => setTimeout(r, 60)); return readCtx(); }),
      withSystemTenantTx(222, async () => { await new Promise((r) => setTimeout(r, 20)); return readCtx(); }),
    ]);
    expect(a.org).toBe("111");
    expect(b.org).toBe("222");
  });

  it("a failure in org A's unit does not leak into org B's unit", async () => {
    const results = await Promise.allSettled([
      withSystemTenantTx(111, async () => { throw new Error("org A fails"); }),
      withSystemTenantTx(222, async () => { await new Promise((r) => setTimeout(r, 30)); return readCtx(); }),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    if (results[1].status === "fulfilled") expect(results[1].value.org).toBe("222");
  });

  it("pool is clean after background units (SET LOCAL rolled off)", async () => {
    await withSystemTenantTx(111, readCtx);
    for (let i = 0; i < 5; i++) {
      const v = (await pool.query("SELECT current_setting('app.current_org_id', true) AS v")).rows[0].v;
      expect(v).toBe("");
    }
  });
});

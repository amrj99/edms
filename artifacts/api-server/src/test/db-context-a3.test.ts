/**
 * db-context-a3.test.ts — DEBT-010 ③ (path A) proof on the isolated test DB.
 *
 * Proves the transaction-local tenant context (AsyncLocalStorage + currentDb() +
 * runInTenantTx + `db` Proxy) behaves correctly, and that under a NON-superuser
 * role the fail-closed RLS policy denies by default with no silent wider fallback.
 *
 * Split of concerns:
 *   • Plumbing (context set / same-tx / concurrency isolation / pool-reuse clean /
 *     Proxy routing) — proven with runInTenantTx on the pooled base connection by
 *     reading current_setting (independent of RLS enforcement).
 *   • Fail-closed enforcement (missing-context=0, own-only, no wider fallback) —
 *     proven with a non-superuser rls_tester connection (mirrors production edms_app).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { db, pool, currentDb, dbContext, runInTenantTx, documentsTable } from "@workspace/db";
import { createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";

const { Client } = pg;
const setting = async (h: { execute: (q: unknown) => Promise<{ rows: Array<{ v: string }> }> }) =>
  (await h.execute(sql`SELECT current_setting('app.current_org_id', true) AS v`)).rows[0].v;

function rlsTesterUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
  return base.replace(/^(postgresql:\/\/)[^@]+(@)/, "$1rls_tester:rls_tester_pw$2");
}

interface Fx { orgA: { id: number }; orgB: { id: number }; docAId: number }
let fx: Fx;

beforeAll(async () => {
  await truncateAllTables();
  const orgA = await createOrg({ name: "A3 Org A", code: "A3A" });
  const orgB = await createOrg({ name: "A3 Org B", code: "A3B" });
  const uA = await createUser({ organizationId: orgA.id, role: "admin", email: "a3@a.test" });
  const pA = await createProject({ organizationId: orgA.id, createdById: uA.id, name: "A3 P", code: "A3-1" });
  const [doc] = await getTestDb().insert(documentsTable).values({
    organizationId: orgA.id, projectId: pA.id, createdById: uA.id,
    documentNumber: "A3-DOC", title: "A3 doc", revision: "A", status: "draft",
  }).returning({ id: documentsTable.id });
  fx = { orgA, orgB, docAId: doc.id };
});
afterAll(async () => { await truncateAllTables(); });

describe("A3 plumbing — transaction-local context via ALS", () => {
  it("PROOF 1: inside runInTenantTx, db (Proxy) and currentDb() use the SAME tx/context", async () => {
    await runInTenantTx({ orgId: fx.orgA.id, isSystemOwner: false }, async () => {
      const viaProxy = await setting(db as never);
      const viaCurrent = await setting(currentDb() as never);
      expect(viaProxy).toBe(String(fx.orgA.id));
      expect(viaCurrent).toBe(String(fx.orgA.id));
      // same connection: a LOCAL marker set via db is readable via currentDb()
      await db.execute(sql`SELECT set_config('app.a3_marker', 'X', true)`);
      const m = (await (currentDb() as never as { execute: (q: unknown) => Promise<{ rows: Array<{ v: string }> }> })
        .execute(sql`SELECT current_setting('app.a3_marker', true) AS v`)).rows[0].v;
      expect(m).toBe("X");
    });
  });

  it("PROOF 4: outside any scope, currentDb() is the pool-backed base (non-request handle)", async () => {
    expect(dbContext.getStore()).toBeUndefined();
    // a plain query works via the Proxy → pool
    const r = (await db.execute(sql`SELECT 1 AS v`)).rows[0];
    expect(Number((r as { v: number }).v)).toBe(1);
  });

  it("PROOF 5: concurrent Tenant A/B runInTenantTx do NOT leak context into each other", async () => {
    const [a, b] = await Promise.all([
      runInTenantTx({ orgId: fx.orgA.id, isSystemOwner: false }, async () => {
        await new Promise((r) => setTimeout(r, 60)); // yield so the two interleave
        return setting(currentDb() as never);
      }),
      runInTenantTx({ orgId: fx.orgB.id, isSystemOwner: false }, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return setting(currentDb() as never);
      }),
    ]);
    expect(a).toBe(String(fx.orgA.id));
    expect(b).toBe(String(fx.orgB.id));
  });

  it("PROOF 6: pool reuse after the tx is clean — SET LOCAL did not persist", async () => {
    await runInTenantTx({ orgId: fx.orgA.id, isSystemOwner: false }, async () => {
      expect(await setting(currentDb() as never)).toBe(String(fx.orgA.id));
    });
    // subsequent pooled connections must NOT carry the context
    for (let i = 0; i < 5; i++) {
      const v = (await pool.query("SELECT current_setting('app.current_org_id', true) AS v")).rows[0].v;
      expect(v).toBe(""); // unset — transaction-local, rolled off at commit
    }
  });
});

describe("A3 fail-closed enforcement — non-superuser role (mirrors edms_app)", () => {
  async function asTester<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: rlsTesterUrl() });
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
  }

  it("PROOF 2/3: missing context ⇒ 0 rows (fail-closed) — no request outside scope gets tenant rows", async () => {
    const rows = await asTester(async (c) => {
      // fresh connection, no set_config at all → no tenant context
      return (await c.query("SELECT id FROM documents WHERE id=$1", [fx.docAId])).rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant-scoped tx sees ONLY its own org", async () => {
    const own = await asTester(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.is_system_owner','false',true)");
      await c.query("SELECT set_config('app.current_org_id',$1,true)", [String(fx.orgA.id)]);
      const r = (await c.query("SELECT id FROM documents WHERE id=$1", [fx.docAId])).rows;
      await c.query("COMMIT");
      return r;
    });
    expect(own).toHaveLength(1);

    const cross = await asTester(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_org_id',$1,true)", [String(fx.orgB.id)]);
      const r = (await c.query("SELECT id FROM documents WHERE id=$1", [fx.docAId])).rows;
      await c.query("COMMIT");
      return r;
    });
    expect(cross).toHaveLength(0);
  });

  it("PROOF 8: an unintended pool/no-context access inside tenant scope FAILS CLOSED (0 rows), never wider", async () => {
    // Simulate: while a tenant-scoped tx (Org B) is conceptually active, a SEPARATE
    // connection that bypassed the ALS/tx (no context) queries the same table.
    // It must get 0 rows — a silent fallback can only ever LOSE access, never gain it.
    const bypass = await asTester(async (bypassConn) => {
      return await asTester(async (scoped) => {
        await scoped.query("BEGIN");
        await scoped.query("SELECT set_config('app.current_org_id',$1,true)", [String(fx.orgB.id)]);
        // the bypass connection has NO context set
        const rows = (await bypassConn.query("SELECT id FROM documents")).rows;
        await scoped.query("COMMIT");
        return rows;
      });
    });
    expect(bypass).toHaveLength(0); // fail-closed: bypass sees nothing, not everything
  });
});

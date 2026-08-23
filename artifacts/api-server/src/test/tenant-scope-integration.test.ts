/**
 * tenant-scope-integration.test.ts — DEBT-010 ③ middleware wiring (fail-closed).
 *
 * A minimal Express app wired with withTenantRequest + withTenant proves the
 * per-request behavior end-to-end (through real HTTP via supertest):
 *   1. concurrent Tenant A/B → no context leak
 *   2. request without tenant context (bare db in a request) → explicit failure
 *   3. authenticated DB access outside tenant scope → fails loudly, no pool fallback
 *   4. pool reuse after the tx → no residual context
 *   5. system_owner explicit context only → intended global flag
 *   6. external I/O runs OUTSIDE the tenant transaction (no tx held during I/O)
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db, pool, currentDb, dbContext } from "@workspace/db";
import { withTenantRequest, withTenant } from "../middlewares/tenant-scope.js";

// ── fake auth: identity from headers (test only) ──────────────────────────────
function fakeAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const id = req.header("x-user-id");
  if (id) {
    (req as { user?: unknown }).user = {
      id: Number(id),
      organizationId: req.header("x-org-id") ? Number(req.header("x-org-id")) : null,
      role: req.header("x-sysowner") === "1" ? "system_owner" : "admin",
    };
  }
  next();
}

const readCtx = () =>
  (currentDb() as { execute: (q: unknown) => Promise<{ rows: Array<{ org: string; owner: string }> }> })
    .execute(sql`SELECT current_setting('app.current_org_id', true) AS org, current_setting('app.is_system_owner', true) AS owner`)
    .then((r) => r.rows[0]);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use(withTenantRequest);

  // proper tenant-scoped DB work
  app.get("/ctx", async (req, res, next) => {
    try {
      const delay = Number(req.header("x-delay") ?? 0);
      const out = await withTenant(async () => {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        return readCtx();
      });
      res.json(out);
    } catch (e) { next(e); }
  });

  // BAD: touches db in a request WITHOUT withTenant → must fail-closed
  app.get("/bare-db", async (req, res, next) => {
    try {
      const r = await (db as { execute: (q: unknown) => Promise<{ rows: unknown[] }> }).execute(sql`SELECT 1 AS v`);
      res.json({ leaked: true, rows: r.rows });
    } catch (e) { next(e); }
  });

  // external I/O AFTER the DB unit-of-work — proves no tx is held during I/O
  app.get("/io-after", async (req, res, next) => {
    try {
      await withTenant(async () => { await readCtx(); });
      const txDuringIO = dbContext.getStore(); // must be undefined here (tx already committed/closed)
      await new Promise((r) => setTimeout(r, 15)); // simulate R2/Resend/fs I/O
      res.json({ txHeldDuringIO: txDuringIO !== undefined });
    } catch (e) { next(e); }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

const app = buildApp();

describe("DEBT-010 ③ — per-request fail-closed wiring", () => {
  it("PROOF 1: concurrent Tenant A/B do NOT leak context", async () => {
    const [a, b] = await Promise.all([
      request(app).get("/ctx").set("x-user-id", "1").set("x-org-id", "111").set("x-delay", "60"),
      request(app).get("/ctx").set("x-user-id", "2").set("x-org-id", "222").set("x-delay", "20"),
    ]);
    expect(a.body.org).toBe("111");
    expect(b.body.org).toBe("222");
  });

  it("PROOF 2/3: authenticated request touching db OUTSIDE withTenant fails loudly (no pool fallback)", async () => {
    const r = await request(app).get("/bare-db").set("x-user-id", "1").set("x-org-id", "111");
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/Fail-closed DB access/i);
  });

  it("PROOF 4: pool reuse after the request is clean — no residual context", async () => {
    await request(app).get("/ctx").set("x-user-id", "1").set("x-org-id", "111");
    for (let i = 0; i < 5; i++) {
      const v = (await pool.query("SELECT current_setting('app.current_org_id', true) AS v")).rows[0].v;
      expect(v).toBe("");
    }
  });

  it("PROOF 5: system_owner request sets the explicit global flag only", async () => {
    const r = await request(app).get("/ctx").set("x-user-id", "9").set("x-sysowner", "1");
    expect(r.body.owner).toBe("true");
    const t = await request(app).get("/ctx").set("x-user-id", "1").set("x-org-id", "111");
    expect(t.body.owner).toBe("false"); // tenant admin is NOT system_owner
  });

  it("PROOF 6: external I/O runs OUTSIDE the tenant transaction", async () => {
    const r = await request(app).get("/io-after").set("x-user-id", "1").set("x-org-id", "111");
    expect(r.body.txHeldDuringIO).toBe(false);
  });

  it("public/unauthenticated route is not tenant-scoped (no fail-closed, pool allowed)", async () => {
    // no x-user-id → no requestContext marker → db falls back to pool, no throw
    const app2 = buildApp();
    app2.get("/public", async (_req, res, next) => {
      try { const r = await (db as { execute: (q: unknown) => Promise<{ rows: Array<{ v: number }> }> }).execute(sql`SELECT 1 AS v`); res.json({ v: r.rows[0].v }); }
      catch (e) { next(e); }
    });
    const r = await request(app2).get("/public");
    expect(r.status).toBe(200);
    expect(Number(r.body.v)).toBe(1);
  });
});

/** DIAGNOSTIC (temporary): insert a notification as edms_app for ANOTHER same-org user,
 *  trying organization_id = NULL vs session-org vs other-org, to pinpoint the WITH CHECK. */
import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { createOrg, createUser, getTestDb } from "./helpers/index.js";

const { Client } = pg;
function appUrl(): string {
  const base = process.env.TEST_DATABASE_URL!;
  return base.replace(/^(postgresql:\/\/)[^@]+(@)/, "$1edms_app:edms_app_pw$2");
}
async function asApp<T>(ctx: { org: number | null; user: number | null; sysowner?: boolean }, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: appUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.is_system_owner', $1, true)", [ctx.sysowner ? "true" : "false"]);
    await c.query("SELECT set_config('app.current_org_id', $1, true)", [ctx.org == null ? "" : String(ctx.org)]);
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.user == null ? "" : String(ctx.user)]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { await c.end(); }
}

let orgId: number, actorId: number, recipientId: number, otherOrgId: number;
beforeAll(async () => {
  const org = await createOrg({ name: "NInsert Org" });
  orgId = org.id;
  const other = await createOrg({ name: "NInsert Other" });
  otherOrgId = other.id;
  const a = await createUser({ organizationId: orgId, role: "document_controller", email: "a@ninsert.edms" });
  const b = await createUser({ organizationId: orgId, role: "admin", email: "b@ninsert.edms" });
  actorId = a.id; recipientId = b.id;
});

async function tryInsert(c: pg.Client, orgVal: number | null) {
  const sql = `INSERT INTO notifications (user_id, organization_id, type, title, message) VALUES ($1, $2, 'task_status_updated', 't', 'm') RETURNING id`;
  try { const r = await c.query(sql, [recipientId, orgVal]); return `OK id=${r.rows[0].id}`; }
  catch (e: any) { return `ERR code=${e.code} msg=${e.message}`; }
}

describe("DIAG notif insert as edms_app", () => {
  it("org NULL vs session vs other", async () => {
    const results = await asApp({ org: orgId, user: actorId }, async (c) => ({
      nullOrg: await tryInsert(c, null),
      sessionOrg: await tryInsert(c, orgId),
      otherOrg: await tryInsert(c, otherOrgId),
    }));
    console.log("[DIAG-INSERT] recipient(other same-org user) results:", JSON.stringify(results));
    expect(true).toBe(true);
  });
});

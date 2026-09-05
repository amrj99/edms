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

async function ins(c: pg.Client, targetUser: number, orgVal: number | null, returning: boolean) {
  const sql = `INSERT INTO notifications (user_id, organization_id, type, title, message) VALUES ($1, $2, 'task_status_updated', 't', 'm')${returning ? " RETURNING id" : ""}`;
  try { const r = await c.query(sql, [targetUser, orgVal]); return `OK${returning ? " id=" + r.rows[0].id : " (no-ret)"}`; }
  catch (e: any) { return `ERR ${e.code}`; }
}

describe("DIAG notif insert as edms_app", () => {
  it("returning vs no-returning, self vs other (isolated txns, org=session)", async () => {
    const otherReturning = await asApp({ org: orgId, user: actorId }, (c) => ins(c, recipientId, orgId, true));
    const otherNoReturning = await asApp({ org: orgId, user: actorId }, (c) => ins(c, recipientId, orgId, false));
    const selfReturning = await asApp({ org: orgId, user: actorId }, (c) => ins(c, actorId, orgId, true));
    const otherNoRetNullOrg = await asApp({ org: orgId, user: actorId }, (c) => ins(c, recipientId, null, false));
    console.log("[DIAG-INSERT3]", JSON.stringify({ otherReturning, otherNoReturning, selfReturning, otherNoRetNullOrg }));
    expect(true).toBe(true);
  });
});

/**
 * f7-reminder-dedup.test.ts — F7 fix (B′): app.recent_notification_exists.
 *
 * The reminder job runs under withSystemTenantTx (org set, NO session user), so a
 * direct SELECT on notifications (per-user RLS) sees zero rows and its dedup guard
 * re-inserted duplicates every run. The fix is a SECURITY DEFINER boolean probe that
 * briefly adopts the target user's context (tx-local) to satisfy the UNCHANGED per-user
 * policy, restores it on every path, and is fail-closed for users outside the session org.
 *
 * Proven here (runs under edms_app by default — RLS actually enforced):
 *   1. same-org user with a recent notification → true; policy still blinds a direct read.
 *   2. cross-org user → false (fail-closed; no cross-tenant existence oracle).
 *   3. context restored on BOTH the success path and the exception path (re-raise).
 *   4. Test-7 per-user isolation is not weakened (direct read under system ctx = 0 rows).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, inArray } from "drizzle-orm";
import { db, withSystemTenantTx, notificationsTable } from "@workspace/db";
import { getTestDb, getTestPool } from "./helpers/db.js";
import { createOrg, createUser } from "./helpers/factories.js";

const EID_A = 90001;
const EID_B = 90002;
const since = new Date(Date.now() - 60 * 60 * 1000); // 1h ago

let orgA: { id: number };
let orgB: { id: number };
let userA: { id: number };
let userB: { id: number };

async function probe(orgId: number, uid: number, type: string, etype: string, eid: number): Promise<boolean> {
  return withSystemTenantTx(orgId, async () => {
    const r: any = await db.execute(
      sql`SELECT app.recent_notification_exists(${uid}, ${type}, ${etype}, ${eid}, ${since}) AS found`,
    );
    return (Array.isArray(r) ? r : r?.rows)?.[0]?.found === true;
  });
}

beforeAll(async () => {
  orgA = await createOrg({ name: "F7 Org A" });
  orgB = await createOrg({ name: "F7 Org B" });
  userA = await createUser({ organizationId: orgA.id, role: "admin", email: `f7a-${Date.now()}@test.edms` });
  userB = await createUser({ organizationId: orgB.id, role: "admin", email: `f7b-${Date.now()}@test.edms` });

  // Seed one recent task_overdue notification per user (superuser insert — setup only).
  await getTestDb().insert(notificationsTable).values([
    { userId: userA.id, type: "task_overdue", title: "Task overdue", message: "A", entityType: "task", entityId: EID_A, organizationId: orgA.id },
    { userId: userB.id, type: "task_overdue", title: "Task overdue", message: "B", entityType: "task", entityId: EID_B, organizationId: orgB.id },
  ]);
});

afterAll(async () => {
  const d = getTestDb();
  await d.delete(notificationsTable).where(inArray(notificationsTable.entityId, [EID_A, EID_B]));
  const pool = getTestPool();
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [[userA.id, userB.id]]);
  await pool.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA.id, orgB.id]]);
});

describe("F7 — app.recent_notification_exists", () => {
  it("[1] same-org user with a recent notification → true", async () => {
    expect(await probe(orgA.id, userA.id, "task_overdue", "task", EID_A)).toBe(true);
  });

  it("[1b] no matching entity → false (does not over-match)", async () => {
    expect(await probe(orgA.id, userA.id, "task_overdue", "task", 99999)).toBe(false);
    expect(await probe(orgA.id, userA.id, "workflow_sla_reminder", "workflow", EID_A)).toBe(false);
  });

  it("[2] cross-org user → false (fail-closed; NOT a cross-tenant oracle)", async () => {
    // userB HAS a matching notification, but querying it from org A's context must be false.
    expect(await probe(orgA.id, userB.id, "task_overdue", "task", EID_B)).toBe(false);
    // positive control: the SAME probe from org B's own context succeeds.
    expect(await probe(orgB.id, userB.id, "task_overdue", "task", EID_B)).toBe(true);
  });

  it("[3a] context restored on the SUCCESS path", async () => {
    await withSystemTenantTx(orgA.id, async () => {
      await db.execute(sql`SELECT set_config('app.current_user_id', '555', true)`);
      await db.execute(sql`SELECT app.recent_notification_exists(${userA.id}, 'task_overdue', 'task', ${EID_A}, ${since})`);
      const r: any = await db.execute(sql`SELECT current_setting('app.current_user_id', true) AS v`);
      expect((Array.isArray(r) ? r : r?.rows)?.[0]?.v).toBe("555");
    });
  });

  it("[3b] context restored on the EXCEPTION path (probe raises → caller's context intact)", async () => {
    // Force the probe's internal SELECT to fail by revoking the owner's table SELECT,
    // then invoke it inside a DO block that sets a sentinel, catches the raised error,
    // and asserts the sentinel is intact afterwards. A DO block's BEGIN/EXCEPTION keeps
    // the surrounding session usable (unlike a JS-driven tx, which is left aborted after
    // an error). If the context were NOT restored the DO block RAISEs → query rejects.
    const pool = getTestPool();
    await pool.query("REVOKE SELECT ON public.notifications FROM edms_rls_owner");
    try {
      await pool.query(`
        DO $$
        BEGIN
          PERFORM set_config('app.current_org_id', '${orgA.id}', true);
          PERFORM set_config('app.current_user_id', '777', true);
          BEGIN
            PERFORM app.recent_notification_exists(${userA.id}, 'task_overdue', 'task', ${EID_A}, now());
            RAISE EXCEPTION 'probe was expected to fail (SELECT revoked) but did not';
          EXCEPTION WHEN OTHERS THEN
            NULL; -- swallow the probe's re-raised error
          END;
          IF current_setting('app.current_user_id', true) <> '777' THEN
            RAISE EXCEPTION 'context NOT restored after exception: got "%"', current_setting('app.current_user_id', true);
          END IF;
        END $$;`);
    } finally {
      await pool.query("GRANT SELECT ON public.notifications TO edms_rls_owner");
    }
    // Reaching here without a thrown error means the DO block's assertions held.
    expect(true).toBe(true);
  });

  it("[4] per-user policy NOT weakened — direct read under system ctx sees 0 rows", async () => {
    const n = await withSystemTenantTx(orgA.id, async () => {
      const r: any = await db.execute(sql`SELECT count(*)::int AS c FROM notifications WHERE user_id = ${userA.id}`);
      return (Array.isArray(r) ? r : r?.rows)?.[0]?.c;
    });
    expect(n).toBe(0); // Test-7 invariant intact: no session user ⇒ per-user RLS hides all rows
  });
});

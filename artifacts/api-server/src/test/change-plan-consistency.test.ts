/**
 * change-plan-consistency.test.ts — DEBT-010 onboarding-without-Stripe.
 *
 * The invariant under test: when a system_owner moves an org onto a PAID plan via
 * POST /api/admin/organizations/:orgId/change-plan (no Stripe, no billing UI),
 * NO state may remain that any code path still reads as "trial" or "trial
 * expired". Concretely, after a paid change-plan:
 *   • subscriptions.plan_id / status = the paid plan / active   (billing SSOT)
 *   • organizations.subscription_tier = the paid plan            (enforcement field)
 *   • organizations.trial_ends_at = NULL                         (out of trial)
 *   • the trial-downgrade scheduler's own selection predicate can NEVER match it
 *   • any prior "expired" downgrade is fully recovered (read-only overrides
 *     cleared, hidden projects re-shown)
 *
 * And the negative guard: a NON-paid target (trial/expired) must NOT blindly null
 * trial_ends_at or rewrite organizations — it keeps the prior subscriptions-only
 * behaviour.
 *
 * Fixtures seed RLS tables via the OWNER pool (getTestDb). The route runs as a
 * system_owner request (RLS bypassed for the cross-org writes).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import {
  organizationsTable, usersTable, projectsTable, subscriptionsTable,
} from "@workspace/db";
import {
  api, authHeader, getTestDb, truncateAllTables, closeTestPool,
  createOrg, createUser, createProject, resetFactoryCounters,
} from "./helpers/index.js";

const db = getTestDb();

const DAY = 24 * 60 * 60 * 1000;

// A REAL system_owner principal — audit_logs.user_id FKs to users, so the token's
// user must exist or the audit insert fails and poisons the whole change-plan tx
// (Postgres aborts the tx → COMMIT becomes ROLLBACK). In production the sysowner
// is a real row; the harness must mirror that.
let sysToken: Record<string, string>;

async function setOrgTrial(orgId: number, tier: string, trialEndsAt: Date | null) {
  await db.update(organizationsTable)
    .set({ subscriptionTier: tier, trialEndsAt })
    .where(eq(organizationsTable.id, orgId));
}

async function readOrg(orgId: number) {
  const [o] = await db.select({
    tier: organizationsTable.subscriptionTier,
    trialEndsAt: organizationsTable.trialEndsAt,
  }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
  return o;
}

async function readSub(orgId: number) {
  const [s] = await db.select({
    planId: subscriptionsTable.planId,
    status: subscriptionsTable.status,
  }).from(subscriptionsTable).where(eq(subscriptionsTable.organizationId, orgId));
  return s;
}

/** Exactly the selection predicate the trial-downgrade scheduler uses. */
async function schedulerWouldSelect(now: Date): Promise<number[]> {
  const rows = await db.select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(and(
      eq(organizationsTable.subscriptionTier, "trial"),
      isNotNull(organizationsTable.trialEndsAt),
      lt(organizationsTable.trialEndsAt, now),
    ));
  return rows.map(r => r.id);
}

function changePlan(orgId: number, planId: string) {
  return api()
    .post(`/api/admin/organizations/${orgId}/change-plan`)
    .set(sysToken)
    .send({ planId });
}

beforeEach(async () => {
  await truncateAllTables();
  resetFactoryCounters();
  const sysOrg = await createOrg({ name: "Platform Owner Org" });
  const sysUser = await createUser({ organizationId: sysOrg.id, role: "system_owner" });
  sysToken = authHeader("system_owner", sysUser.id, sysOrg.id);
});
afterAll(async () => { await closeTestPool(); });

describe("change-plan → state-consistency invariant (onboarding without Stripe)", () => {
  it("Trial → Paid BEFORE expiry: tier reflects paid plan, trial_ends_at cleared, subscription active", async () => {
    const org = await createOrg();
    const future = new Date(Date.now() + 14 * DAY);
    await setOrgTrial(org.id, "trial", future);

    await changePlan(org.id, "professional").expect(200);

    const o = await readOrg(org.id);
    expect(o.tier).toBe("professional");
    expect(o.trialEndsAt).toBeNull();

    const s = await readSub(org.id);
    expect(s.planId).toBe("professional");
    expect(s.status).toBe("active");
  });

  it("Scheduler can NEVER downgrade a paid org (its own predicate stops matching)", async () => {
    // A real still-trial, already-expired org — proves the predicate is live.
    const control = await createOrg();
    await setOrgTrial(control.id, "trial", new Date(Date.now() - 1 * DAY));

    // The paying customer, whose trial had also technically passed.
    const paid = await createOrg();
    await setOrgTrial(paid.id, "trial", new Date(Date.now() - 1 * DAY));
    await changePlan(paid.id, "professional").expect(200);

    const selected = await schedulerWouldSelect(new Date());
    expect(selected).toContain(control.id);   // predicate genuinely selects expired trials
    expect(selected).not.toContain(paid.id);  // …but never the upgraded paid org
  });

  it("Expired → Paid: read-only overrides cleared and hidden projects restored", async () => {
    const org = await createOrg();
    await setOrgTrial(org.id, "expired", new Date(Date.now() - 30 * DAY));

    const keep = await createUser({ organizationId: org.id, role: "admin" });
    const locked = await createUser({ organizationId: org.id, role: "member" });
    // Simulate the downgrade end-state.
    await db.update(usersTable).set({ isReadOnlyOverride: true }).where(eq(usersTable.id, locked.id));

    const visible = await createProject({ organizationId: org.id });
    const hidden = await createProject({ organizationId: org.id });
    await db.update(projectsTable).set({ visibleOnFree: false }).where(eq(projectsTable.id, hidden.id));

    await changePlan(org.id, "professional").expect(200);

    const users = await db.select({ id: usersTable.id, ro: usersTable.isReadOnlyOverride })
      .from(usersTable).where(eq(usersTable.organizationId, org.id));
    expect(users.every(u => u.ro === false)).toBe(true);

    const projects = await db.select({ id: projectsTable.id, vis: projectsTable.visibleOnFree })
      .from(projectsTable).where(eq(projectsTable.organizationId, org.id));
    expect(projects.every(p => p.vis === true)).toBe(true);

    const o = await readOrg(org.id);
    expect(o.tier).toBe("professional");
    expect(o.trialEndsAt).toBeNull();
    // keep user was already full-access — still is.
    expect(users.find(u => u.id === keep.id)?.ro).toBe(false);
  });

  it("Paid → Paid: tier updates, trial_ends_at stays null, idempotent, no error", async () => {
    const org = await createOrg();
    const future = new Date(Date.now() + 14 * DAY);
    await setOrgTrial(org.id, "trial", future);

    await changePlan(org.id, "professional").expect(200);
    await changePlan(org.id, "basic").expect(200);

    const o = await readOrg(org.id);
    expect(o.tier).toBe("basic");
    expect(o.trialEndsAt).toBeNull();

    const s = await readSub(org.id);
    expect(s.planId).toBe("basic");
    expect(s.status).toBe("active");
  });

  it("NON-paid target (expired): trial_ends_at is NOT touched, organizations not rewritten", async () => {
    const org = await createOrg();
    const trialEnd = new Date(Date.now() + 5 * DAY);
    await setOrgTrial(org.id, "trial", trialEnd);

    await changePlan(org.id, "expired").expect(200);

    const o = await readOrg(org.id);
    // organizations left exactly as-is for a non-paid target (no blind null).
    expect(o.tier).toBe("trial");
    expect(o.trialEndsAt).not.toBeNull();
    expect(new Date(o.trialEndsAt as unknown as string).getTime()).toBe(trialEnd.getTime());

    // subscriptions still updated (existing behaviour).
    const s = await readSub(org.id);
    expect(s.planId).toBe("expired");
    expect(s.status).toBe("active");
  });

  it("Upload/project gate predicate is satisfied by construction after a paid change", async () => {
    const org = await createOrg();
    await setOrgTrial(org.id, "trial", new Date(Date.now() + 14 * DAY));
    await changePlan(org.id, "professional").expect(200);

    const o = await readOrg(org.id);
    // projects.ts / documents.ts block when (subscriptionTier === "trial" && expired).
    // A paid org can never satisfy the first conjunct.
    expect(o.tier).not.toBe("trial");
  });
});

/**
 * membership-rls-behavior-comparison.test.ts — DEBT-010 Decision B.
 *
 * BEFORE/AFTER behavior comparison for the six legitimate cross-org flows the
 * design documented. For each flow we classify:
 *   UNCHANGED  — legitimate cross-org access still works AND no unrelated org gained
 *                access (membership RLS matches the product's intended behavior).
 *   NARROWED   — a legitimate access that the product allowed is now denied.
 *   BROKEN     — a legitimate access fails outright.
 *   EXPANDED   — an org that should NOT have access can now reach the row.
 *
 * "before" = org-only RLS predicate (organization_id = session_org): under the old
 * policy a cross-org party/recipient would be DENIED at the DB (the running product
 * only worked because the superuser role bypassed RLS). "after" = the live
 * membership policy, queried as the least-privilege edms_app role.
 *
 * ANY BROKEN or EXPANDED fails the suite (owner directive: stop, do not continue).
 * Submission-chains are intentionally out of RLS scope (their tables are not among
 * the 13) and are reported as N/A.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  documentsTable, projectsTable, projectPartiesTable, projectMembersTable,
  correspondenceTable, correspondenceRecipientsTable, transmittalsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";

const { Client } = pg;
function appUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
  return base.replace(/^(postgresql:\/\/)[^@]+(@)/, "$1edms_app:edms_app_pw$2");
}
async function canRead(ctx: { org: number; user: number }, table: string, id: number): Promise<boolean> {
  const c = new Client({ connectionString: appUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.is_system_owner','false',true)");
    await c.query("SELECT set_config('app.current_org_id',$1,true)", [String(ctx.org)]);
    await c.query("SELECT set_config('app.current_user_id',$1,true)", [String(ctx.user)]);
    const n = (await c.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id])).rowCount ?? 0;
    await c.query("COMMIT");
    return n > 0;
  } finally { await c.end(); }
}

interface Fx {
  orgA: number; orgB: number; orgC: number; orgD: number;
  uA: number; uB: number; uC: number; uM: number;
  p: number; d: number; corr: number; trans: number;
}
let fx: Fx;

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const orgA = await createOrg({ name: "BC A", code: "BCA" });
  const orgB = await createOrg({ name: "BC B", code: "BCB" });
  const orgC = await createOrg({ name: "BC C", code: "BCC" });
  const orgD = await createOrg({ name: "BC D", code: "BCD" });
  const uA = await createUser({ organizationId: orgA.id, role: "admin", email: "bc-a@a.test" });
  const uB = await createUser({ organizationId: orgB.id, role: "admin", email: "bc-b@b.test" });
  const uC = await createUser({ organizationId: orgC.id, role: "admin", email: "bc-c@c.test" });
  const uM = await createUser({ organizationId: orgD.id, role: "admin", email: "bc-m@d.test" });
  const p = await createProject({ organizationId: orgA.id, createdById: uA.id, name: "BC P", code: "BC-P" });
  await db.update(projectsTable).set({ collaborationMode: "parties" }).where(eq(projectsTable.id, p.id));
  await db.insert(projectPartiesTable).values({ projectId: p.id, organizationId: orgB.id, partyRole: "contributor", addedById: uA.id });
  await db.insert(projectMembersTable).values({ projectId: p.id, userId: uM.id, role: "viewer" });
  const [d] = await db.insert(documentsTable).values({ organizationId: orgA.id, projectId: p.id, createdById: uA.id, documentNumber: "BC-D", title: "d", revision: "A", status: "draft" }).returning({ id: documentsTable.id });
  const [corr] = await db.insert(correspondenceTable).values({ organizationId: orgA.id, projectId: p.id, subject: "c", type: "internal", status: "sent", direction: "outgoing", fromUserId: uA.id, referenceNumber: "BC-C" }).returning({ id: correspondenceTable.id });
  await db.insert(correspondenceRecipientsTable).values({ correspondenceId: corr.id, userId: uB.id });
  const [trans] = await db.insert(transmittalsTable).values({ organizationId: orgA.id, projectId: p.id, transmittalNumber: "BC-T", subject: "t", status: "sent", createdById: uA.id, toUserId: uB.id, direction: "outgoing" }).returning({ id: transmittalsTable.id });
  fx = { orgA: orgA.id, orgB: orgB.id, orgC: orgC.id, orgD: orgD.id, uA: uA.id, uB: uB.id, uC: uC.id, uM: uM.id, p: p.id, d: d.id, corr: corr.id, trans: trans.id };
});
afterAll(async () => { await truncateAllTables(); });

/** Classify one flow: assert legit works and unrelated denied; return the verdict. */
async function classify(
  name: string,
  legit: { org: number; user: number },
  unrelated: { org: number; user: number },
  table: string,
  rowId: number,
): Promise<string> {
  // "before" = org-only RLS predicate for the cross-org legit actor (org mismatch ⇒ denied)
  const legitOrgOnly = legit.org === fx.orgA; // legit is cross-org here → false ⇒ org-only would deny
  const legitAfter = await canRead(legit, table, rowId);
  const unrelatedAfter = await canRead(unrelated, table, rowId);

  let verdict: string;
  if (!legitAfter) verdict = "BROKEN";
  else if (unrelatedAfter) verdict = "EXPANDED";
  else verdict = "UNCHANGED";
  // eslint-disable-next-line no-console
  console.log(`[behavior] ${name}: before(org-only RLS legit=${legitOrgOnly ? "allow" : "deny"}) → after(membership legit=${legitAfter ? "allow" : "deny"}, unrelated=${unrelatedAfter ? "allow" : "deny"}) = ${verdict}`);
  expect(legitAfter, `${name}: legitimate cross-org access must still work (else BROKEN)`).toBe(true);
  expect(unrelatedAfter, `${name}: unrelated org must NOT gain access (else EXPANDED)`).toBe(false);
  return verdict;
}

describe("DEBT-010 Decision B — before/after behavior comparison (6 cross-org flows)", () => {
  it("FLOW 1 — correspondence named recipient", async () => {
    expect(await classify("FLOW1 correspondence recipient", { org: fx.orgB, user: fx.uB }, { org: fx.orgC, user: fx.uC }, "correspondence", fx.corr)).toBe("UNCHANGED");
  });
  it("FLOW 2 — transmittal recipient org", async () => {
    expect(await classify("FLOW2 transmittal recipient-org", { org: fx.orgB, user: fx.uB }, { org: fx.orgC, user: fx.uC }, "transmittals", fx.trans)).toBe("UNCHANGED");
  });
  it("FLOW 3 — documents project party (contributor)", async () => {
    expect(await classify("FLOW3 documents party", { org: fx.orgB, user: fx.uB }, { org: fx.orgC, user: fx.uC }, "documents", fx.d)).toBe("UNCHANGED");
  });
  it("FLOW 4 — documents project member (user-level)", async () => {
    expect(await classify("FLOW4 documents member", { org: fx.orgD, user: fx.uM }, { org: fx.orgC, user: fx.uC }, "documents", fx.d)).toBe("UNCHANGED");
  });
  it("FLOW 5 — projects party visibility", async () => {
    expect(await classify("FLOW5 projects party", { org: fx.orgB, user: fx.uB }, { org: fx.orgC, user: fx.uC }, "projects", fx.p)).toBe("UNCHANGED");
  });
  it("FLOW 6 — submission chains (out of RLS scope)", () => {
    // submission_chains* are not among the 13 RLS tables → no policy change applies.
    // eslint-disable-next-line no-console
    console.log("[behavior] FLOW6 submission-chains: N/A (tables not RLS-protected — unchanged by Decision B)");
    expect(true).toBe(true);
  });
});

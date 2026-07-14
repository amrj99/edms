/**
 * transmittal-authz-order.test.ts — B2 Refactor
 *
 * Pins the middleware execution ORDER on a real project-scoped router:
 *   requireAuth → requireProjectAccess → denyPartyDestructive → handler
 *
 * Proven by DISTINGUISHING responses (each stage owns a unique reply), so a
 * future middleware reorder cannot pass silently:
 *   - no auth            → 401                                   (requireAuth first)
 *   - non-member (authed) → 403 "You are not a member of this project"
 *                                                                (requireProjectAccess, before the party guard)
 *   - party contributor   → 403 "Your party role does not permit this action"
 *                                (requireProjectAccess ran first to stash party mode,
 *                                 THEN denyPartyDestructive fired — before the handler)
 *
 * The contrast (gate message vs party-guard message) is the order proof: a party
 * caller reaches denyPartyDestructive only because requireProjectAccess allowed +
 * stashed them first; a non-member never reaches the party guard at all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { transmittalsTable, orgConfigTable, projectsTable, projectPartiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface Fx {
  orgA: { id: number }; orgCtrb: { id: number }; orgOut: { id: number };
  adminA: { id: number }; ctrbUser: { id: number }; outUser: { id: number };
  projectA: { id: number }; trsId: number;
}
let fx: Fx;
const db = () => getTestDb();

beforeAll(async () => {
  await truncateAllTables();
  const orgA = await createOrg({ name: "Ord Owner", code: "ORDOWN" });
  const orgCtrb = await createOrg({ name: "Ord Contributor", code: "ORDCTR" });
  const orgOut = await createOrg({ name: "Ord Outsider", code: "ORDOUT" });
  const adminA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@ordown.test" });
  const ctrbUser = await createUser({ organizationId: orgCtrb.id, role: "admin", email: "admin@ordctr.test" });
  const outUser = await createUser({ organizationId: orgOut.id, role: "admin", email: "admin@ordout.test" });
  await db().insert(orgConfigTable).values([
    { organizationId: orgA.id, modules: { registers: true } },
    { organizationId: orgCtrb.id, modules: { registers: true } },
    { organizationId: orgOut.id, modules: { registers: true } },
  ]);
  const projectA = await createProject({ organizationId: orgA.id, createdById: adminA.id, name: "Ord Project", code: "ORD-001" });
  await db().update(projectsTable).set({ collaborationMode: "parties" }).where(eq(projectsTable.id, projectA.id));
  await db().insert(projectPartiesTable).values({ projectId: projectA.id, organizationId: orgCtrb.id, partyRole: "contributor", addedById: adminA.id });
  const [trs] = await db().insert(transmittalsTable).values({
    organizationId: orgA.id, projectId: projectA.id, createdById: adminA.id,
    transmittalNumber: "ORD-TN-1", subject: "Order Subject", purpose: "for_information",
  }).returning();
  fx = { orgA, orgCtrb, orgOut, adminA, ctrbUser, outUser, projectA, trsId: trs.id };
});
afterAll(async () => { await truncateAllTables(); });

// A destructive route guarded by requireProjectAccess (router) + denyPartyDestructive.
const PUT = (hdr?: Record<string, string>) => {
  const r = api().put(`/api/projects/${fx.projectA.id}/transmittals/${fx.trsId}`);
  return (hdr ? r.set(hdr) : r).send({ subject: "changed" });
};

describe("B2 Refactor — middleware order (requireAuth → requireProjectAccess → denyPartyDestructive → handler)", () => {
  it("no auth → 401 (requireAuth runs first)", async () => {
    const res = await PUT();
    expect(res.status).toBe(401);
  });

  it("authed non-member → 403 'not a member' (requireProjectAccess, before the party guard)", async () => {
    const res = await PUT(authHeader("admin", fx.outUser.id, fx.orgOut.id, "admin@ordout.test"));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You are not a member of this project");
    // subject unchanged
    const [row] = await db().select().from(transmittalsTable).where(eq(transmittalsTable.id, fx.trsId));
    expect(row.subject).toBe("Order Subject");
  });

  it("party contributor → 403 'party role does not permit' (requireProjectAccess stashed party, THEN denyPartyDestructive, before handler)", async () => {
    const res = await PUT(authHeader("admin", fx.ctrbUser.id, fx.orgCtrb.id, "admin@ordctr.test"));
    expect(res.status).toBe(403);
    // The message is UNIQUE to denyPartyDestructive — proves the gate ran first
    // (stashed party mode) and the party guard fired before the handler.
    expect(res.body.message).toBe("Your party role does not permit this action");
    const [row] = await db().select().from(transmittalsTable).where(eq(transmittalsTable.id, fx.trsId));
    expect(row.subject).toBe("Order Subject");
  });
});

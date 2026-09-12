/**
 * organization-canonical-entity.test.ts
 *
 * Locks the supported setter for organizations.entity_id — the single CANONICAL
 * entity per organization (0022 design: one nullable FK column). This is the
 * supported link that submission-chain custody resolution needs, replacing the
 * previous DB-only path. PATCH /api/organizations/:id/canonical-entity.
 *
 * Contract asserted here:
 *   • one canonical entity per org (single column; relink replaces it)
 *   • the entity MUST belong to the same org (no cross-org / cross-tenant link)
 *   • admin+ of that org, or system_owner; org admins cannot touch another org
 *   • unlink via { entityId: null }
 *   • an audit event is written for link and unlink
 */
import { describe, it, expect, beforeAll } from "vitest";
import { api, authHeader, createOrg, createUser, getTestDb, truncateAllTables } from "./helpers/index.js";
import { entitiesTable, organizationsTable, auditLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const db = getTestDb();

let orgA: { id: number }, orgB: { id: number };
let adminA: Awaited<ReturnType<typeof createUser>>;
let memberA: Awaited<ReturnType<typeof createUser>>;
let adminB: Awaited<ReturnType<typeof createUser>>;
let entA1: number, entA2: number, entB: number;

async function mkEntity(orgId: number, name: string): Promise<number> {
  const [e] = await db.insert(entitiesTable).values({ organizationId: orgId, name, type: "company" }).returning();
  return e.id;
}
async function orgEntityId(orgId: number): Promise<number | null> {
  const [o] = await db.select({ entityId: organizationsTable.entityId }).from(organizationsTable).where(eq(organizationsTable.id, orgId));
  return o.entityId;
}
async function auditRows(orgId: number, action: string) {
  return db.select().from(auditLogsTable).where(and(eq(auditLogsTable.organizationId, orgId), eq(auditLogsTable.action, action)));
}

beforeAll(async () => {
  await truncateAllTables();
  orgA = await createOrg({ name: "Canon Org A", code: "CANA" });
  orgB = await createOrg({ name: "Canon Org B", code: "CANB" });
  adminA  = await createUser({ organizationId: orgA.id, role: "admin",  email: "cana-admin@t.edms" });
  memberA = await createUser({ organizationId: orgA.id, role: "member", email: "cana-member@t.edms" });
  adminB  = await createUser({ organizationId: orgB.id, role: "admin",  email: "canb-admin@t.edms" });
  entA1 = await mkEntity(orgA.id, "A Entity One");
  entA2 = await mkEntity(orgA.id, "A Entity Two");
  entB  = await mkEntity(orgB.id, "B Entity");
});

const hdrAdminA = () => authHeader("admin", adminA.id, orgA.id, "cana-admin@t.edms");

describe("PATCH /api/organizations/:id/canonical-entity", () => {
  it("admin links a same-org entity → 200, persisted, audit written", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`).set(hdrAdminA()).send({ entityId: entA1 });
    expect(r.status).toBe(200);
    expect(r.body.entityId).toBe(entA1);
    expect(await orgEntityId(orgA.id)).toBe(entA1);
    expect((await auditRows(orgA.id, "organization_entity_linked")).length).toBeGreaterThanOrEqual(1);
  });

  it("cross-org entity → 400 (rejected, unchanged)", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`).set(hdrAdminA()).send({ entityId: entB });
    expect(r.status).toBe(400);
    expect(await orgEntityId(orgA.id)).toBe(entA1); // still the previous valid link
  });

  it("non-admin (member) → 403", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`)
      .set(authHeader("member", memberA.id, orgA.id, "cana-member@t.edms")).send({ entityId: entA1 });
    expect(r.status).toBe(403);
  });

  it("admin of another org cannot link this org → 403 (tenant guard)", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`)
      .set(authHeader("admin", adminB.id, orgB.id, "canb-admin@t.edms")).send({ entityId: entA1 });
    expect(r.status).toBe(403);
  });

  it("entity that does not exist → 400", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`).set(hdrAdminA()).send({ entityId: 99999999 });
    expect(r.status).toBe(400);
  });

  it("relink to another same-org entity → 200, replaces the single canonical entity", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`).set(hdrAdminA()).send({ entityId: entA2 });
    expect(r.status).toBe(200);
    expect(r.body.entityId).toBe(entA2);
    expect(await orgEntityId(orgA.id)).toBe(entA2); // one canonical entity; relink replaced it
  });

  it("unlink via { entityId: null } → 200, cleared, audit written", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`).set(hdrAdminA()).send({ entityId: null });
    expect(r.status).toBe(200);
    expect(r.body.entityId ?? null).toBeNull();
    expect(await orgEntityId(orgA.id)).toBeNull();
    expect((await auditRows(orgA.id, "organization_entity_unlinked")).length).toBeGreaterThanOrEqual(1);
  });

  it("missing entityId field → 400", async () => {
    const r = await api().patch(`/api/organizations/${orgA.id}/canonical-entity`).set(hdrAdminA()).send({});
    expect(r.status).toBe(400);
  });

  it("system_owner may link any org → 200", async () => {
    const r = await api().patch(`/api/organizations/${orgB.id}/canonical-entity`)
      .set(authHeader("system_owner", adminA.id, 0)).send({ entityId: entB });
    expect(r.status).toBe(200);
    expect(await orgEntityId(orgB.id)).toBe(entB);
  });
});

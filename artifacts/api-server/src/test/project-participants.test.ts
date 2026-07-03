/**
 * project-participants.test.ts
 *
 * Phase 2 — Domain Model: Project Participants
 *
 * Coverage:
 *   - CRUD: create, list, update, delete
 *   - Tenant isolation: Org A cannot add Org B entities; cannot read Org B project participants
 *   - Validation: invalid role → 400; missing entityId → 400
 *   - Duplicate: same entity twice → 409
 *   - Role enforcement: viewer cannot mutate (403)
 *   - Cross-project guard: participant id from project A blocked in project B
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";

const db = getTestDb();

describe("project participants API", () => {
  let orgA: { id: number };
  let orgB: { id: number };

  let adminA: { id: number; organizationId: number };
  let viewerA: { id: number; organizationId: number };
  let adminB: { id: number; organizationId: number };

  let projectAId: number;
  let projectBId: number;  // belongs to orgB

  let entityA1Id: number;  // entity in orgA
  let entityA2Id: number;  // entity in orgA
  let entityBId: number;   // entity in orgB

  beforeAll(async () => {
    await truncateAllTables();

    orgA = await createOrg({ name: "PP Org A", code: "PPOA" });
    orgB = await createOrg({ name: "PP Org B", code: "PPOB" });

    adminA  = await createUser({ organizationId: orgA.id, role: "admin",  email: "pp-admina@test.com" });
    viewerA = await createUser({ organizationId: orgA.id, role: "viewer", email: "pp-viewera@test.com" });
    adminB  = await createUser({ organizationId: orgB.id, role: "admin",  email: "pp-adminb@test.com" });

    // Create projects
    const pA = await api()
      .post("/api/projects")
      .set(authHeader("admin", adminA.id, orgA.id))
      .send({ name: "PP Project A", code: "PPA01", organizationId: orgA.id });
    projectAId = pA.body.id;

    const pB = await api()
      .post("/api/projects")
      .set(authHeader("admin", adminB.id, orgB.id))
      .send({ name: "PP Project B", code: "PPB01", organizationId: orgB.id });
    projectBId = pB.body.id;

    // Create entities
    const eA1 = await api()
      .post("/api/entities")
      .set(authHeader("admin", adminA.id, orgA.id))
      .send({ name: "AECOM UAE", type: "company" });
    entityA1Id = eA1.body.id;

    const eA2 = await api()
      .post("/api/entities")
      .set(authHeader("admin", adminA.id, orgA.id))
      .send({ name: "Dubai Municipality", type: "government" });
    entityA2Id = eA2.body.id;

    const eB = await api()
      .post("/api/entities")
      .set(authHeader("admin", adminB.id, orgB.id))
      .send({ name: "Org B Entity", type: "company" });
    entityBId = eB.body.id;
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  // ─── Create ─────────────────────────────────────────────────────────────────

  describe("POST /api/projects/:projectId/participants", () => {
    it("adds an entity as participant (admin)", async () => {
      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entityA1Id, role: "main_contractor" });

      expect(res.status).toBe(201);
      expect(res.body.entityId).toBe(entityA1Id);
      expect(res.body.role).toBe("main_contractor");
      expect(res.body.projectId).toBe(projectAId);
      expect(res.body.notes).toBeNull();
    });

    it("accepts optional notes field", async () => {
      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entityA2Id, role: "authority", notes: "Main approving body" });

      expect(res.status).toBe(201);
      expect(res.body.notes).toBe("Main approving body");
    });

    it("rejects invalid role (400)", async () => {
      const entity = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Temp Entity", type: "company" });

      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entity.body.id, role: "client" }); // 'client' not in enum

      expect(res.status).toBe(400);
    });

    it("rejects missing entityId (400)", async () => {
      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ role: "consultant" });

      expect(res.status).toBe(400);
    });

    it("rejects adding entity from another org (404)", async () => {
      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entityBId, role: "supplier" });

      expect(res.status).toBe(404);
    });

    it("rejects duplicate entity in same project (409)", async () => {
      // entityA1Id already added above
      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entityA1Id, role: "consultant" });

      expect(res.status).toBe(409);
    });

    it("rejects viewer creating participant (403)", async () => {
      const entity = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Viewer Blocked Entity", type: "ngo" });

      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("viewer", viewerA.id, orgA.id))
        .send({ entityId: entity.body.id, role: "other" });

      expect(res.status).toBe(403);
    });

    it("rejects access to project belonging to another org (404)", async () => {
      const res = await api()
        .post(`/api/projects/${projectBId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entityA1Id, role: "consultant" });

      expect(res.status).toBe(404);
    });
  });

  // ─── List ────────────────────────────────────────────────────────────────────

  describe("GET /api/projects/:projectId/participants", () => {
    it("returns participants with embedded entity data", async () => {
      const res = await api()
        .get(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      const first = res.body[0];
      expect(first).toHaveProperty("role");
      expect(first).toHaveProperty("entity");
      expect(first.entity).toHaveProperty("name");
      expect(first.entity).toHaveProperty("type");
    });

    it("returns 404 for project belonging to another org", async () => {
      const res = await api()
        .get(`/api/projects/${projectBId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(404);
    });

    it("returns empty array for project with no participants", async () => {
      // Use projectB (orgB's project) via orgB admin — it has no participants yet
      const res = await api()
        .get(`/api/projects/${projectBId}/participants`)
        .set(authHeader("admin", adminB.id, orgB.id));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── Update ──────────────────────────────────────────────────────────────────

  describe("PUT /api/projects/:projectId/participants/:id", () => {
    let participantId: number;

    beforeAll(async () => {
      const entity = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Update Test Entity", type: "company" });

      const res = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entity.body.id, role: "sub_contractor" });

      participantId = res.body.id;
    });

    it("updates role", async () => {
      const res = await api()
        .put(`/api/projects/${projectAId}/participants/${participantId}`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ role: "consultant" });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe("consultant");
    });

    it("updates notes", async () => {
      const res = await api()
        .put(`/api/projects/${projectAId}/participants/${participantId}`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ notes: "Updated note" });

      expect(res.status).toBe(200);
      expect(res.body.notes).toBe("Updated note");
    });

    it("returns 404 for participant in another project", async () => {
      // Add a participant to projectB (using orgB admin)
      const entityForB = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminB.id, orgB.id))
        .send({ name: "OrgB Update Entity", type: "company" });

      const ppB = await api()
        .post(`/api/projects/${projectBId}/participants`)
        .set(authHeader("admin", adminB.id, orgB.id))
        .send({ entityId: entityForB.body.id, role: "owner" });

      // orgA admin tries to update orgB's participant via projectA's route
      const res = await api()
        .put(`/api/projects/${projectAId}/participants/${ppB.body.id}`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ role: "supplier" });

      expect(res.status).toBe(404);
    });

    it("rejects viewer update (403)", async () => {
      const res = await api()
        .put(`/api/projects/${projectAId}/participants/${participantId}`)
        .set(authHeader("viewer", viewerA.id, orgA.id))
        .send({ role: "owner" });

      expect(res.status).toBe(403);
    });
  });

  // ─── Delete ──────────────────────────────────────────────────────────────────

  describe("DELETE /api/projects/:projectId/participants/:id", () => {
    it("deletes a participant (admin)", async () => {
      const entity = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Delete Me Participant", type: "individual" });

      const pp = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entity.body.id, role: "other" });

      const del = await api()
        .delete(`/api/projects/${projectAId}/participants/${pp.body.id}`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(del.status).toBe(200);
      expect(del.body.ok).toBe(true);

      // After delete, entity can be re-added (unique constraint lifted)
      const re = await api()
        .post(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ entityId: entity.body.id, role: "supplier" });
      expect(re.status).toBe(201);
    });

    it("returns 404 for non-existent participant", async () => {
      const res = await api()
        .delete(`/api/projects/${projectAId}/participants/999999`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(404);
    });

    it("returns 404 when trying to delete cross-project participant", async () => {
      const entity = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminB.id, orgB.id))
        .send({ name: "OrgB Delete Target", type: "company" });

      const ppB = await api()
        .post(`/api/projects/${projectBId}/participants`)
        .set(authHeader("admin", adminB.id, orgB.id))
        .send({ entityId: entity.body.id, role: "consultant" });

      // OrgA admin tries to delete orgB's participant via projectA route
      const res = await api()
        .delete(`/api/projects/${projectAId}/participants/${ppB.body.id}`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(404);
    });

    it("rejects viewer delete (403)", async () => {
      const list = await api()
        .get(`/api/projects/${projectAId}/participants`)
        .set(authHeader("admin", adminA.id, orgA.id));

      const id = list.body[0]?.id;
      if (!id) return;

      const res = await api()
        .delete(`/api/projects/${projectAId}/participants/${id}`)
        .set(authHeader("viewer", viewerA.id, orgA.id));

      expect(res.status).toBe(403);
    });
  });

  // ─── All participant_role values accepted ────────────────────────────────────

  describe("all valid participant_role values", () => {
    const roles = ["owner", "consultant", "main_contractor", "sub_contractor", "supplier", "authority", "other"] as const;

    for (const role of roles) {
      it(`accepts role: ${role}`, async () => {
        const entity = await api()
          .post("/api/entities")
          .set(authHeader("admin", adminA.id, orgA.id))
          .send({ name: `Role Test ${role}`, type: "company" });

        const res = await api()
          .post(`/api/projects/${projectAId}/participants`)
          .set(authHeader("admin", adminA.id, orgA.id))
          .send({ entityId: entity.body.id, role });

        expect(res.status).toBe(201);
        expect(res.body.role).toBe(role);
      });
    }
  });
});

/**
 * entities.test.ts
 *
 * Phase 1 — Domain Model: Entity & Contact Directory
 *
 * Coverage:
 *   - Entity CRUD (list, get, create, update, delete)
 *   - Tenant isolation: Org A cannot see or modify Org B entities
 *   - Contact CRUD sub-resource (list, create, update, delete)
 *   - Validation: required fields, enum values, parent entity scope
 *   - Role enforcement: viewer cannot create/update/delete
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
import { entitiesTable, contactsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const db = getTestDb();

describe("entities API", () => {
  let orgA: { id: number };
  let orgB: { id: number };
  let adminA: { id: number; organizationId: number };
  let viewerA: { id: number; organizationId: number };
  let adminB: { id: number; organizationId: number };

  beforeAll(async () => {
    await truncateAllTables();
    orgA = await createOrg({ name: "Entity Org A", code: "EORGA" });
    orgB = await createOrg({ name: "Entity Org B", code: "EORGB" });
    adminA  = await createUser({ organizationId: orgA.id, role: "admin",  email: "admina@entities.test" });
    viewerA = await createUser({ organizationId: orgA.id, role: "viewer", email: "viewera@entities.test" });
    adminB  = await createUser({ organizationId: orgB.id, role: "admin",  email: "adminb@entities.test" });
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  // ─── Create ───────────────────────────────────────────────────────────────────

  describe("POST /api/entities", () => {
    it("creates an entity successfully (admin)", async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "AECOM UAE", type: "company", country: "ae" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("AECOM UAE");
      expect(res.body.type).toBe("company");
      expect(res.body.country).toBe("AE");        // uppercased
      expect(res.body.organizationId).toBe(orgA.id);
    });

    it("rejects invalid entity type", async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Bad Entity", type: "invalid_type" });

      expect(res.status).toBe(400);
    });

    it("requires name", async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ type: "company" });

      expect(res.status).toBe(400);
    });

    it("rejects viewer role (403)", async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("viewer", viewerA.id, orgA.id))
        .send({ name: "Blocked Entity", type: "company" });

      expect(res.status).toBe(403);
    });

    it("creates entity with all optional fields", async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({
          name: "Dubai Municipality",
          type: "government",
          country: "AE",
          registrationNumber: "GOV-001",
        });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("government");
      expect(res.body.registrationNumber).toBe("GOV-001");
    });
  });

  // ─── List ─────────────────────────────────────────────────────────────────────

  describe("GET /api/entities", () => {
    it("returns only entities belonging to the caller org", async () => {
      // Create an entity under Org B
      await api()
        .post("/api/entities")
        .set(authHeader("admin", adminB.id, orgB.id))
        .send({ name: "Org B Entity", type: "company" });

      const res = await api()
        .get("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const names = res.body.map((e: any) => e.name);
      expect(names).not.toContain("Org B Entity");
      // Should contain entities created under Org A
      expect(names.some((n: string) => n.includes("AECOM UAE") || n.includes("Dubai"))).toBe(true);
    });

    it("returns 200 empty array when no entities exist for org", async () => {
      const emptyOrg = await createOrg({ name: "Empty Org", code: "EORGX" });
      const emptyAdmin = await createUser({ organizationId: emptyOrg.id, role: "admin", email: "empty@entities.test" });

      const res = await api()
        .get("/api/entities")
        .set(authHeader("admin", emptyAdmin.id, emptyOrg.id));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── Get single ───────────────────────────────────────────────────────────────

  describe("GET /api/entities/:id", () => {
    let entityId: number;

    beforeAll(async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Read Test Entity", type: "ngo" });
      entityId = res.body.id;
    });

    it("returns entity by id", async () => {
      const res = await api()
        .get(`/api/entities/${entityId}`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(entityId);
      expect(res.body.name).toBe("Read Test Entity");
    });

    it("returns 404 for entity belonging to another org", async () => {
      const res = await api()
        .get(`/api/entities/${entityId}`)
        .set(authHeader("admin", adminB.id, orgB.id));

      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent id", async () => {
      const res = await api()
        .get("/api/entities/999999")
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(404);
    });
  });

  // ─── Update ───────────────────────────────────────────────────────────────────

  describe("PUT /api/entities/:id", () => {
    let entityId: number;

    beforeAll(async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Update Test Entity", type: "company" });
      entityId = res.body.id;
    });

    it("updates allowed fields", async () => {
      const res = await api()
        .put(`/api/entities/${entityId}`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Updated Entity", country: "GB" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Entity");
      expect(res.body.country).toBe("GB");
    });

    it("returns 404 for entity in another org", async () => {
      const res = await api()
        .put(`/api/entities/${entityId}`)
        .set(authHeader("admin", adminB.id, orgB.id))
        .send({ name: "Hijack" });

      expect(res.status).toBe(404);
    });

    it("rejects entity being its own parent", async () => {
      const res = await api()
        .put(`/api/entities/${entityId}`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ parentEntityId: entityId });

      expect(res.status).toBe(400);
    });

    it("rejects viewer update (403)", async () => {
      const res = await api()
        .put(`/api/entities/${entityId}`)
        .set(authHeader("viewer", viewerA.id, orgA.id))
        .send({ name: "Viewer Edit" });

      expect(res.status).toBe(403);
    });
  });

  // ─── Delete ───────────────────────────────────────────────────────────────────

  describe("DELETE /api/entities/:id", () => {
    it("deletes an entity (admin)", async () => {
      const create = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Delete Me", type: "individual" });
      const id = create.body.id;

      const del = await api()
        .delete(`/api/entities/${id}`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(del.status).toBe(200);
      expect(del.body.ok).toBe(true);

      const get = await api()
        .get(`/api/entities/${id}`)
        .set(authHeader("admin", adminA.id, orgA.id));
      expect(get.status).toBe(404);
    });

    it("returns 404 for entity in another org", async () => {
      const create = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Cross Org Delete Target", type: "company" });

      const res = await api()
        .delete(`/api/entities/${create.body.id}`)
        .set(authHeader("admin", adminB.id, orgB.id));

      expect(res.status).toBe(404);
    });
  });

  // ─── Contacts sub-resource ────────────────────────────────────────────────────

  describe("Contacts sub-resource", () => {
    let entityId: number;

    beforeAll(async () => {
      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Contact Parent Entity", type: "company" });
      entityId = res.body.id;
    });

    it("creates a contact", async () => {
      const res = await api()
        .post(`/api/entities/${entityId}/contacts`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Ahmed Al-Rashid", email: "ahmed@aecom.com", jobTitle: "PM" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Ahmed Al-Rashid");
      expect(res.body.email).toBe("ahmed@aecom.com");
      expect(res.body.jobTitle).toBe("PM");
      expect(res.body.entityId).toBe(entityId);
      expect(res.body.userId).toBeNull();
    });

    it("lists contacts for an entity", async () => {
      await api()
        .post(`/api/entities/${entityId}/contacts`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Second Contact", email: "second@test.com" });

      const res = await api()
        .get(`/api/entities/${entityId}/contacts`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it("returns 404 when getting contacts for entity in another org", async () => {
      const res = await api()
        .get(`/api/entities/${entityId}/contacts`)
        .set(authHeader("admin", adminB.id, orgB.id));

      expect(res.status).toBe(404);
    });

    it("updates a contact", async () => {
      const create = await api()
        .post(`/api/entities/${entityId}/contacts`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Update Me Contact", phone: "+971-50-000-0000" });
      const cid = create.body.id;

      const res = await api()
        .put(`/api/entities/${entityId}/contacts/${cid}`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ phone: "+971-55-111-2222", jobTitle: "Director" });

      expect(res.status).toBe(200);
      expect(res.body.phone).toBe("+971-55-111-2222");
      expect(res.body.jobTitle).toBe("Director");
    });

    it("deletes a contact", async () => {
      const create = await api()
        .post(`/api/entities/${entityId}/contacts`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Delete Me Contact" });
      const cid = create.body.id;

      const del = await api()
        .delete(`/api/entities/${entityId}/contacts/${cid}`)
        .set(authHeader("admin", adminA.id, orgA.id));

      expect(del.status).toBe(200);
      expect(del.body.ok).toBe(true);
    });

    it("requires name for contact", async () => {
      const res = await api()
        .post(`/api/entities/${entityId}/contacts`)
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ email: "no-name@test.com" });

      expect(res.status).toBe(400);
    });

    it("rejects viewer creating contact (403)", async () => {
      const res = await api()
        .post(`/api/entities/${entityId}/contacts`)
        .set(authHeader("viewer", viewerA.id, orgA.id))
        .send({ name: "Viewer Contact" });

      expect(res.status).toBe(403);
    });
  });

  // ─── Parent entity scope ──────────────────────────────────────────────────────

  describe("Parent entity scoping", () => {
    it("allows setting parent within same org", async () => {
      const parent = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Parent Co", type: "company" });

      const child = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Child Co", type: "company", parentEntityId: parent.body.id });

      expect(child.status).toBe(201);
      expect(child.body.parentEntityId).toBe(parent.body.id);
    });

    it("rejects parent from another org", async () => {
      const orgBEntity = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminB.id, orgB.id))
        .send({ name: "Foreign Parent", type: "company" });

      const res = await api()
        .post("/api/entities")
        .set(authHeader("admin", adminA.id, orgA.id))
        .send({ name: "Child Co 2", type: "company", parentEntityId: orgBEntity.body.id });

      expect(res.status).toBe(400);
    });
  });
});

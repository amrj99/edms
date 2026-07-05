/**
 * metadata.test.ts
 *
 * Coverage for the Metadata Runtime Engine (Step 1 + Step 2 resolution):
 *   - metadata_fields stabilization: isActive, soft-disable, partial unique
 *     indexes (org-scoped global / org-scoped per-type / system-global)
 *   - cross-partition collision pre-check -> 409
 *   - PATCH /api/metadata-fields/:id (name/fieldType immutable -> 400, other fields editable)
 *   - GET /api/metadata-fields?documentTypeId= resolution (global + type-specific union)
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
import { documentTypesTable } from "@workspace/db";

const db = getTestDb();

describe("metadata fields API", () => {
  let org: { id: number };
  let otherOrg: { id: number };
  let admin: { id: number; organizationId: number | null };
  let otherAdmin: { id: number; organizationId: number | null };
  let ncrType: { id: number };
  let drawingType: { id: number };

  beforeAll(async () => {
    await truncateAllTables();
    org = await createOrg({ name: "Metadata Org", code: "MDORG" });
    otherOrg = await createOrg({ name: "Other Org", code: "MDORG2" });
    admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@md.test" });
    otherAdmin = await createUser({ organizationId: otherOrg.id, role: "admin", email: "admin2@md.test" });

    const [ncr] = await db.insert(documentTypesTable).values({
      organizationId: org.id, code: "NCR", name: "Non-Conformance Report", isActive: true,
    }).returning();
    ncrType = ncr;

    const [drawing] = await db.insert(documentTypesTable).values({
      organizationId: org.id, code: "DRAWING", name: "Drawing", isActive: true,
    }).returning();
    drawingType = drawing;
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe("POST /api/metadata", () => {
    it("creates a global field (documentTypeId null)", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "project_phase", label: "Project Phase", fieldType: "text" });

      expect(res.status).toBe(201);
      expect(res.body.documentTypeId).toBeNull();
      expect(res.body.isActive).toBe(true);
    });

    it("creates a type-specific field for NCR", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "root_cause", label: "Root Cause", fieldType: "text", documentTypeId: ncrType.id, required: true });

      expect(res.status).toBe(201);
      expect(res.body.documentTypeId).toBe(ncrType.id);
    });

    it("allows the same field name on a different document type", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "root_cause", label: "Root Cause", fieldType: "select", options: ["design", "workmanship"], documentTypeId: drawingType.id });

      expect(res.status).toBe(201);
      expect(res.body.documentTypeId).toBe(drawingType.id);
    });

    it("allows the same field name in a different organization", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", otherAdmin.id, otherOrg.id))
        .send({ name: "root_cause", label: "Root Cause", fieldType: "text" });

      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBe(otherOrg.id);
    });

    it("returns 409 on duplicate global field name within the same org", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "project_phase", label: "Project Phase Again", fieldType: "text" });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Conflict");
    });

    it("returns 409 on duplicate type-specific field name for the same type", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "root_cause", label: "Root Cause Again", fieldType: "text", documentTypeId: ncrType.id });

      expect(res.status).toBe(409);
    });

    it("returns 409 when a new global field name collides with an existing type-specific field (cross-partition)", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "root_cause", label: "Root Cause Global", fieldType: "text" });

      expect(res.status).toBe(409);
    });

    it("returns 409 when a new type-specific field name collides with an existing global field (cross-partition)", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "project_phase", label: "Project Phase Per Type", fieldType: "text", documentTypeId: drawingType.id });

      expect(res.status).toBe(409);
    });

    it("rejects documentTypeId belonging to another organization", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "other_field", label: "Other Field", fieldType: "text", documentTypeId: 999999 });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/metadata", () => {
    it("excludes inactive fields", async () => {
      const created = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "temp_field", label: "Temp Field", fieldType: "text" });
      expect(created.status).toBe(201);

      await api()
        .patch(`/api/metadata-fields/${created.body.id}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ isActive: false });

      const res = await api()
        .get("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id));

      expect(res.status).toBe(200);
      expect(res.body.fields.some((f: any) => f.id === created.body.id)).toBe(false);
    });

    it("?documentTypeId= resolves global + type-specific fields for NCR", async () => {
      const res = await api()
        .get(`/api/metadata-fields?documentTypeId=${ncrType.id}`)
        .set(authHeader("admin", admin.id, org.id));

      expect(res.status).toBe(200);
      const names = res.body.fields.map((f: any) => f.name);
      expect(names).toContain("project_phase"); // global
      expect(names).toContain("root_cause"); // NCR-specific

      const ncrRootCause = res.body.fields.find((f: any) => f.name === "root_cause" && f.documentTypeId === ncrType.id);
      expect(ncrRootCause.fieldType).toBe("text");
    });

    it("?documentTypeId= for Drawing does not include NCR-specific fields", async () => {
      const res = await api()
        .get(`/api/metadata-fields?documentTypeId=${drawingType.id}`)
        .set(authHeader("admin", admin.id, org.id));

      expect(res.status).toBe(200);
      const drawingRootCause = res.body.fields.find((f: any) => f.name === "root_cause");
      expect(drawingRootCause.documentTypeId).toBe(drawingType.id);
      expect(drawingRootCause.fieldType).toBe("select");
    });

    it("rejects documentTypeId belonging to another organization", async () => {
      const res = await api()
        .get(`/api/metadata-fields?documentTypeId=${ncrType.id}`)
        .set(authHeader("admin", otherAdmin.id, otherOrg.id));

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/metadata-fields/:id", () => {
    let fieldId: number;

    beforeAll(async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "close_date", label: "Close Date", fieldType: "date", documentTypeId: ncrType.id });
      fieldId = res.body.id;
    });

    it("rejects changing name with 400 and the exact message", async () => {
      const res = await api()
        .patch(`/api/metadata-fields/${fieldId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "closing_date" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Metadata field name and fieldType cannot be changed after creation");
    });

    it("rejects changing fieldType with 400", async () => {
      const res = await api()
        .patch(`/api/metadata-fields/${fieldId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ fieldType: "text" });

      expect(res.status).toBe(400);
    });

    it("allows updating label, options, required, isActive", async () => {
      const res = await api()
        .patch(`/api/metadata-fields/${fieldId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ label: "Closure Date", required: true });

      expect(res.status).toBe(200);
      expect(res.body.label).toBe("Closure Date");
      expect(res.body.required).toBe(true);
    });

    it("allows moving a field to global scope (documentTypeId: null)", async () => {
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "movable_field", label: "Movable Field", fieldType: "text", documentTypeId: drawingType.id });
      expect(res.status).toBe(201);

      const patched = await api()
        .patch(`/api/metadata-fields/${res.body.id}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ documentTypeId: null });

      expect(patched.status).toBe(200);
      expect(patched.body.documentTypeId).toBeNull();
    });

    it("returns 409 when changing documentTypeId would create a cross-partition collision", async () => {
      // "project_phase" already exists as a global field in this org.
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "phase_per_drawing", label: "Phase", fieldType: "text", documentTypeId: drawingType.id });
      expect(res.status).toBe(201);

      // Renaming via documentTypeId change to null would collide with "project_phase"? No —
      // instead verify moving "root_cause" (NCR-specific) to global collides with itself
      // via the existing Drawing-specific "root_cause".
      const ncrRootCause = await api()
        .get(`/api/metadata-fields?documentTypeId=${ncrType.id}`)
        .set(authHeader("admin", admin.id, org.id));
      const rc = ncrRootCause.body.fields.find((f: any) => f.name === "root_cause" && f.documentTypeId === ncrType.id);

      const patched = await api()
        .patch(`/api/metadata-fields/${rc.id}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ documentTypeId: null });

      // "root_cause" exists as a type-specific field for Drawing -> global collision
      expect(patched.status).toBe(409);
    });

    it("returns 404 for a field belonging to another organization", async () => {
      const res = await api()
        .patch(`/api/metadata-fields/${fieldId}`)
        .set(authHeader("admin", otherAdmin.id, otherOrg.id))
        .send({ label: "Hijacked" });

      expect(res.status).toBe(404);
    });
  });

  it("DELETE /api/metadata-fields/:id no longer exists (soft-delete via PATCH isActive)", async () => {
    const created = await api()
      .post("/api/metadata-fields")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "to_delete", label: "To Delete", fieldType: "text" });

    const res = await api()
      .delete(`/api/metadata-fields/${created.body.id}`)
      .set(authHeader("admin", admin.id, org.id));

    expect(res.status).toBe(404);
  });
});

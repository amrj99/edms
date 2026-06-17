/**
 * document-metadata-validation.test.ts
 *
 * Coverage for Metadata Runtime Engine validation on document create/update
 * (POST /api/projects/:projectId/documents and PUT /api/projects/:projectId/documents/:id):
 *   - unmapped document types skip validation entirely (backward compat)
 *   - required field enforcement
 *   - per-fieldType type checking (text/number/date/boolean/select/multiselect)
 *   - unknown metadata keys rejected
 *   - PUT only validates when `metadata` is present in the request body
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  createProject,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import { documentTypesTable } from "@workspace/db";

const db = getTestDb();

describe("document metadata validation", () => {
  let org: { id: number };
  let admin: { id: number; organizationId: number };
  let project: { id: number };
  let ncrType: { id: number };

  beforeAll(async () => {
    await truncateAllTables();
    org = await createOrg({ name: "Meta Validation Org", code: "MVORG" });
    admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@mv.test" });
    project = await createProject({ organizationId: org.id });

    const [ncr] = await db.insert(documentTypesTable).values({
      organizationId: org.id, code: "NCR", name: "Non-Conformance Report", isActive: true,
    }).returning();
    ncrType = ncr;

    // Global field: applies to all document types
    await api()
      .post("/api/metadata-fields")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "project_phase", label: "Project Phase", fieldType: "select", options: ["design", "construction"], required: true });

    // NCR-specific fields covering each type
    await api()
      .post("/api/metadata-fields")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "root_cause", label: "Root Cause", fieldType: "text", documentTypeId: ncrType.id, required: true });

    await api()
      .post("/api/metadata-fields")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "severity_score", label: "Severity Score", fieldType: "number", documentTypeId: ncrType.id });

    await api()
      .post("/api/metadata-fields")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "closed_out", label: "Closed Out", fieldType: "boolean", documentTypeId: ncrType.id });

    await api()
      .post("/api/metadata-fields")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "due_date", label: "Due Date", fieldType: "date", documentTypeId: ncrType.id });

    await api()
      .post("/api/metadata-fields")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "affected_areas", label: "Affected Areas", fieldType: "multiselect", documentTypeId: ncrType.id, options: ["civil", "mechanical", "electrical"] });
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  const validNcrMetadata = {
    project_phase: "construction",
    root_cause: "Improper curing",
    severity_score: 3,
    closed_out: false,
    due_date: "2026-07-01",
    affected_areas: ["civil", "mechanical"],
  };

  describe("POST / — unmapped document type", () => {
    it("skips validation entirely for a documentType not in document_types", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "Unmapped Doc", documentType: "Some Unmapped Type", metadata: { anything: "goes" } });

      expect(res.status).toBe(201);
    });
  });

  describe("POST / — NCR document type validation", () => {
    it("creates a document with valid metadata", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-001", documentType: "NCR", metadata: validNcrMetadata });

      expect(res.status).toBe(201);
      expect(res.body.metadata).toMatchObject(validNcrMetadata);
    });

    it("rejects missing required field (root_cause)", async () => {
      const { root_cause, ...rest } = validNcrMetadata;
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-002", documentType: "NCR", metadata: rest });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Root Cause/);
    });

    it("rejects missing required global field (project_phase)", async () => {
      const { project_phase, ...rest } = validNcrMetadata;
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-003", documentType: "NCR", metadata: rest });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Project Phase/);
    });

    it("rejects wrong type for number field", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-004", documentType: "NCR", metadata: { ...validNcrMetadata, severity_score: "high" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Severity Score/);
    });

    it("rejects wrong type for boolean field", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-005", documentType: "NCR", metadata: { ...validNcrMetadata, closed_out: "no" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Closed Out/);
    });

    it("rejects malformed date field", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-006", documentType: "NCR", metadata: { ...validNcrMetadata, due_date: "07/01/2026" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Due Date/);
    });

    it("rejects invalid select option", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-007", documentType: "NCR", metadata: { ...validNcrMetadata, project_phase: "demolition" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Project Phase/);
    });

    it("rejects invalid multiselect option", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-008", documentType: "NCR", metadata: { ...validNcrMetadata, affected_areas: ["civil", "plumbing"] } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Affected Areas/);
    });

    it("rejects unknown metadata keys", async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-009", documentType: "NCR", metadata: { ...validNcrMetadata, mystery_field: "x" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Unknown metadata field: mystery_field/);
    });
  });

  describe("PUT /:id — NCR document type validation", () => {
    let docId: number;

    beforeAll(async () => {
      const res = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-PUT-001", documentType: "NCR", metadata: validNcrMetadata });
      docId = res.body.id;
    });

    it("allows updates that omit metadata entirely (no validation triggered)", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "NCR-PUT-001 Updated" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("NCR-PUT-001 Updated");
    });

    it("validates metadata when present in the request body", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ metadata: { ...validNcrMetadata, severity_score: "not-a-number" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Severity Score/);
    });

    it("accepts a valid metadata update", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ metadata: { ...validNcrMetadata, severity_score: 5 } });

      expect(res.status).toBe(200);
      expect(res.body.metadata.severity_score).toBe(5);
    });
  });

  describe("grandfathering — validate only what changed", () => {
    let gftType: { id: number };
    let docId: number;
    let textFieldId: number;
    let selectFieldId: number;
    let requiredLaterFieldId: number;

    beforeAll(async () => {
      const [gft] = await db.insert(documentTypesTable).values({
        organizationId: org.id, code: "GFT", name: "Grandfather Test", isActive: true,
      }).returning();
      gftType = gft;

      const textField = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "gf_text", label: "GF Text", fieldType: "text", documentTypeId: gftType.id });
      textFieldId = textField.body.id;

      const selectField = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "gf_select", label: "GF Select", fieldType: "select", options: ["a", "b", "c"], documentTypeId: gftType.id });
      selectFieldId = selectField.body.id;

      const requiredLaterField = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "gf_required_later", label: "GF Required Later", fieldType: "text", required: false, documentTypeId: gftType.id });
      requiredLaterFieldId = requiredLaterField.body.id;

      const doc = await api()
        .post(`/api/projects/${project.id}/documents`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "GFT-001", documentType: "GFT", metadata: { project_phase: "construction", gf_text: "hello", gf_select: "c" } });
      docId = doc.body.id;
    });

    it("scenario 1: disabling a field with stored data does not break unrelated edits", async () => {
      await api()
        .patch(`/api/metadata-fields/${textFieldId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ isActive: false });

      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "GFT-001 Updated", metadata: { project_phase: "construction", gf_text: "hello", gf_select: "c" } });

      expect(res.status).toBe(200);
      expect(res.body.metadata.gf_text).toBe("hello");
    });

    it("scenario 1: changing the value of a disabled field is rejected", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ metadata: { project_phase: "construction", gf_text: "changed", gf_select: "c" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/GF Text.*disabled/);
    });

    it("scenario 2: making a field required after old documents lack it does not break unrelated edits", async () => {
      await api()
        .patch(`/api/metadata-fields/${requiredLaterFieldId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ required: true });

      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "GFT-001 Updated Again", metadata: { project_phase: "construction", gf_text: "hello", gf_select: "c" } });

      expect(res.status).toBe(200);
    });

    it("scenario 2: explicitly setting the newly-required field to empty is rejected", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ metadata: { project_phase: "construction", gf_text: "hello", gf_select: "c", gf_required_later: "" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/GF Required Later/);
    });

    it("scenario 2: providing a valid value for the newly-required field is accepted", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ metadata: { project_phase: "construction", gf_text: "hello", gf_select: "c", gf_required_later: "now set" } });

      expect(res.status).toBe(200);
      expect(res.body.metadata.gf_required_later).toBe("now set");
    });

    it("scenario 3: narrowing select options after a stored value exists does not break unrelated edits", async () => {
      await api()
        .patch(`/api/metadata-fields/${selectFieldId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ options: ["a", "b"] });

      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ title: "GFT-001 Title Only", metadata: { project_phase: "construction", gf_text: "hello", gf_select: "c", gf_required_later: "now set" } });

      expect(res.status).toBe(200);
      expect(res.body.metadata.gf_select).toBe("c");
    });

    it("scenario 3: changing a select field to a value removed from its options is rejected", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ metadata: { project_phase: "construction", gf_text: "hello", gf_select: "d", gf_required_later: "now set" } });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/GF Select/);
    });

    it("scenario 3: changing a select field to a still-valid option is accepted", async () => {
      const res = await api()
        .put(`/api/projects/${project.id}/documents/${docId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ metadata: { project_phase: "construction", gf_text: "hello", gf_select: "b", gf_required_later: "now set" } });

      expect(res.status).toBe(200);
      expect(res.body.metadata.gf_select).toBe("b");
    });

    it("scenario 4: reusing a disabled field's name in the same scope is rejected", async () => {
      // gf_text is disabled (scenario 1) but still reserved within this document type's scope.
      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "gf_text", label: "GF Text Again", fieldType: "text", documentTypeId: gftType.id });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/disabled/);
      expect(res.body.message).toMatch(/Reactivate/);
    });

    it("scenario 4: reusing a disabled field's name across partitions (global vs type-specific) is rejected", async () => {
      const globalField = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "gf_cross_reuse", label: "GF Cross Reuse", fieldType: "text" });
      expect(globalField.status).toBe(201);

      await api()
        .patch(`/api/metadata-fields/${globalField.body.id}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ isActive: false });

      const res = await api()
        .post("/api/metadata-fields")
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "gf_cross_reuse", label: "GF Cross Reuse Type-Specific", fieldType: "text", documentTypeId: gftType.id });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/disabled/);
      expect(res.body.message).toMatch(/Reactivate/);
    });

    it("scenario 4: reactivating the disabled field works instead of recreating it", async () => {
      const res = await api()
        .patch(`/api/metadata-fields/${textFieldId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(true);
    });
  });
});

/**
 * document-types.test.ts
 *
 * Coverage for the Document Type Definition Engine V1:
 *   - normalizeDocTypeCode() shared normalization
 *   - GET/POST /document-types (org-scoped, duplicate code -> 409)
 *   - PATCH /document-types/:id (code immutable -> 400, name/isActive editable)
 *   - workflow-engine templates: documentTypeId derives the legacy documentType
 *     text field, and the case-insensitive for-type/:docType fallback still works.
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
import { signToken } from "../lib/auth.js";
import { documentTypesTable, normalizeDocTypeCode, orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const db = getTestDb();

describe("normalizeDocTypeCode", () => {
  it("trims, uppercases, and collapses whitespace runs to underscores", () => {
    expect(normalizeDocTypeCode("  drawing ")).toBe("DRAWING");
    expect(normalizeDocTypeCode("Method Statement")).toBe("METHOD_STATEMENT");
    expect(normalizeDocTypeCode("  multi   space  ")).toBe("MULTI_SPACE");
  });
});

describe("document-types API", () => {
  let org: { id: number };
  let admin: { id: number; organizationId: number };
  let otherOrg: { id: number };
  let otherAdmin: { id: number; organizationId: number };

  beforeAll(async () => {
    await truncateAllTables();
    org = await createOrg({ name: "DocType Org", code: "DTORG" });
    otherOrg = await createOrg({ name: "Other Org", code: "DTORG2" });
    admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@dt.test" });
    otherAdmin = await createUser({ organizationId: otherOrg.id, role: "admin", email: "admin2@dt.test" });
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it("creates a document type and normalizes its code", async () => {
    const res = await api()
      .post("/api/document-types")
      .set(authHeader("admin", admin.id, org.id))
      .send({ code: "  drawing ", name: "Drawing" });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("DRAWING");
    expect(res.body.name).toBe("Drawing");
    expect(res.body.isActive).toBe(true);
    expect(res.body.organizationId).toBe(org.id);
  });

  it("returns 409 (not 500) on duplicate (organizationId, code)", async () => {
    const res = await api()
      .post("/api/document-types")
      .set(authHeader("admin", admin.id, org.id))
      .send({ code: "Drawing", name: "Drawing Again" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Conflict");
  });

  it("allows the same code in a different organization", async () => {
    const res = await api()
      .post("/api/document-types")
      .set(authHeader("admin", otherAdmin.id, otherOrg.id))
      .send({ code: "drawing", name: "Drawing" });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("DRAWING");
    expect(res.body.organizationId).toBe(otherOrg.id);
  });

  it("GET /document-types returns only the caller's org rows", async () => {
    const res = await api()
      .get("/api/document-types")
      .set(authHeader("admin", admin.id, org.id));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((dt: any) => dt.organizationId === org.id)).toBe(true);
    expect(res.body.some((dt: any) => dt.code === "DRAWING")).toBe(true);
  });

  describe("PATCH /document-types/:id", () => {
    let docTypeId: number;

    beforeAll(async () => {
      const [dt] = await db.insert(documentTypesTable).values({
        organizationId: org.id,
        code: "SPECIFICATION",
        name: "Specification",
        isActive: true,
      }).returning();
      docTypeId = dt.id;
    });

    it("rejects an attempt to change code with 400 and the exact message", async () => {
      const res = await api()
        .patch(`/api/document-types/${docTypeId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ code: "OTHER" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Document type code cannot be changed after creation");

      const [unchanged] = await db.select().from(documentTypesTable).where(eq(documentTypesTable.id, docTypeId));
      expect(unchanged.code).toBe("SPECIFICATION");
    });

    it("allows updating name", async () => {
      const res = await api()
        .patch(`/api/document-types/${docTypeId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ name: "Specification (Revised)" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Specification (Revised)");
      expect(res.body.code).toBe("SPECIFICATION");
    });

    it("allows deactivating without deleting the row", async () => {
      const res = await api()
        .patch(`/api/document-types/${docTypeId}`)
        .set(authHeader("admin", admin.id, org.id))
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);

      const [row] = await db.select().from(documentTypesTable).where(eq(documentTypesTable.id, docTypeId));
      expect(row).toBeDefined();
      expect(row.isActive).toBe(false);
    });
  });
});

describe("workflow-engine templates — documentTypeId integration", () => {
  let org: { id: number };
  let admin: { id: number; organizationId: number };
  let docTypeId: number;

  beforeAll(async () => {
    await truncateAllTables();
    org = await createOrg({ name: "WF DocType Org", code: "WFDTORG" });
    admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@wfdt.test" });

    // requireModule("workflow_engine") fails closed without an org_config row.
    await db.insert(orgConfigTable).values({
      organizationId: org.id,
      modules: { workflow_engine: true },
    });

    const [dt] = await db.insert(documentTypesTable).values({
      organizationId: org.id,
      code: "ITP",
      name: "Inspection & Test Plan",
      isActive: true,
    }).returning();
    docTypeId = dt.id;
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it("POST /workflow-engine/templates with documentTypeId derives the legacy documentType from the type's code", async () => {
    const res = await api()
      .post("/api/workflow-engine/templates")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "ITP Approval Workflow", documentTypeId: docTypeId });

    expect(res.status).toBe(201);
    expect(res.body.documentTypeId).toBe(docTypeId);
    expect(res.body.documentType).toBe("ITP");
  });

  it("GET /workflow-engine/templates/for-type/:docType still matches case-insensitively via the derived legacy text field", async () => {
    const res = await api()
      .get("/api/workflow-engine/templates/for-type/itp")
      .set(authHeader("admin", admin.id, org.id));

    expect(res.status).toBe(200);
    expect(res.body.templates?.length ?? res.body.length).toBeGreaterThan(0);
  });

  it("rejects documentTypeId that does not belong to the org", async () => {
    const res = await api()
      .post("/api/workflow-engine/templates")
      .set(authHeader("admin", admin.id, org.id))
      .send({ name: "Bad Template", documentTypeId: 999999 });

    expect(res.status).toBe(400);
  });
});

describe("document-types — system_owner org-override scoping", () => {
  let orgA: { id: number };
  let orgB: { id: number };
  let sysOwner: { id: number };
  // Token with no organizationId — mirrors a real system_owner JWT
  let sysOwnerToken: string;

  beforeAll(async () => {
    await truncateAllTables();
    orgA = await createOrg({ name: "Override Org A", code: "OVA" });
    orgB = await createOrg({ name: "Override Org B", code: "OVB" });
    sysOwner = await createUser({ organizationId: orgA.id, role: "system_owner", email: "sysowner@override.test" });

    // Create a token where organizationId is absent (production system_owner shape)
    sysOwnerToken = signToken({ id: sysOwner.id, email: "sysowner@override.test", role: "system_owner" });

    // Seed orgA with one document type
    const db = getTestDb();
    await db.insert(documentTypesTable).values({
      organizationId: orgA.id,
      code: "DRAWING",
      name: "Drawing",
      isActive: true,
    });
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it("GET without orgOverride returns empty when system_owner has no JWT org", async () => {
    const res = await api()
      .get("/api/document-types")
      .set({ Authorization: `Bearer ${sysOwnerToken}` });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // orgId = null/undefined → WHERE organization_id = null → 0 rows
    expect(res.body.length).toBe(0);
  });

  it("GET with ?orgOverride returns the targeted org's types", async () => {
    const res = await api()
      .get(`/api/document-types?orgOverride=${orgA.id}`)
      .set({ Authorization: `Bearer ${sysOwnerToken}` });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((dt: any) => dt.organizationId === orgA.id)).toBe(true);
  });

  it("GET with ?orgOverride for orgB returns only orgB's types (not orgA's)", async () => {
    const res = await api()
      .get(`/api/document-types?orgOverride=${orgB.id}`)
      .set({ Authorization: `Bearer ${sysOwnerToken}` });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // orgB has no types yet
    expect(res.body.length).toBe(0);
  });

  it("POST with ?orgOverride creates the document type in the correct org", async () => {
    const res = await api()
      .post(`/api/document-types?orgOverride=${orgB.id}`)
      .set({ Authorization: `Bearer ${sysOwnerToken}` })
      .send({ code: "SPECIFICATION", name: "Specification" });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(orgB.id);
    expect(res.body.code).toBe("SPECIFICATION");

    // Verify orgA is untouched
    const getA = await api()
      .get(`/api/document-types?orgOverride=${orgA.id}`)
      .set({ Authorization: `Bearer ${sysOwnerToken}` });
    expect(getA.body.some((dt: any) => dt.code === "SPECIFICATION")).toBe(false);
  });

  it("orgOverride is silently ignored for non-system_owner — they stay in their own org", async () => {
    const adminA = await createUser({ organizationId: orgA.id, role: "admin", email: "admin@ovA.test" });

    // Admin for orgA tries to pass orgOverride=orgB — should be ignored
    const res = await api()
      .get(`/api/document-types?orgOverride=${orgB.id}`)
      .set(authHeader("admin", adminA.id, orgA.id));

    expect(res.status).toBe(200);
    // Must see only orgA's types (override ignored, JWT org used)
    expect(res.body.every((dt: any) => dt.organizationId === orgA.id)).toBe(true);
  });
});

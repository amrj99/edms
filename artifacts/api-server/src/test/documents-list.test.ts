/**
 * documents-list.test.ts
 *
 * Integration tests for GET /api/projects/:projectId/documents
 *
 * Validates that B-1 (SQL-based pagination & filtering) behaves identically
 * to the previous JS-memory implementation, and confirms:
 *
 *  1. SQL pagination — LIMIT/OFFSET returns the correct page slice
 *  2. total count — comes from SQL COUNT, not JS .length
 *  3. totalPages & hasMore — derived from SQL count
 *  4. Filters — discipline, documentType, status, folderId, source,
 *               direction, issuedBy (ILIKE), combined filters
 *  5. Search — multi-field ILIKE across 7 columns
 *  6. Tenant isolation — Org B cannot list Org A's documents
 *  7. Response shape — every expected field is present
 *  8. Empty results — zero-document projects return correct envelope
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
import { documentsTable, projectMembersTable, foldersTable, orgConfigTable } from "@workspace/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Fixtures {
  orgId:     number;
  userId:    number;
  projectId: number;
  orgBId:    number;
  userBId:   number;
  folderId:  number;
  docIds: {
    draft_structural:   number;
    approved_civil:     number;
    issued_electrical:  number;
    draft_civil:        number;
    incoming_external:  number;
    folder_doc:         number;
  };
}

let fx: Fixtures;

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();

  const org  = await createOrg({ name: "ListOrg", code: "LIST" });
  const user = await createUser({ organizationId: org.id, role: "admin", email: "list-admin@test.edms" });
  const proj = await createProject({ organizationId: org.id, name: "List Project", code: "LST-001" });

  // Cross-org attacker
  const orgB  = await createOrg({ name: "AttackerOrg", code: "ATK" });
  const userB = await createUser({ organizationId: orgB.id, role: "admin", email: "attacker@test.edms" });

  // Enable modules for orgB so module gate doesn't shadow tenant isolation
  await db.insert(orgConfigTable).values([
    { organizationId: org.id,  modules: { dashboard: true, deliverables: true, registers: true, notifications: true } },
    { organizationId: orgB.id, modules: { dashboard: true, deliverables: true, registers: true, notifications: true } },
  ]);

  // Add user to project (needed by canAccessProject)
  await db.insert(projectMembersTable).values({ projectId: proj.id, userId: user.id, role: "admin" });

  // Create a folder
  const [folder] = await db.insert(foldersTable).values({ name: "Structural", projectId: proj.id }).returning();

  // Seed 6 documents with varied attributes for filter testing
  const seed = async (values: Parameters<typeof db.insert<typeof documentsTable>>[0] extends { values: (v: infer V) => unknown } ? V : never) => {
    const [doc] = await db.insert(documentsTable).values(values).returning();
    return doc.id;
  };

  const draft_structural  = await seed({ organizationId: org.id, projectId: proj.id, createdById: user.id, documentNumber: "STR-001", title: "Foundation Plan",      discipline: "structural", documentType: "drawing",    status: "draft",    revision: "A" });
  const approved_civil    = await seed({ organizationId: org.id, projectId: proj.id, createdById: user.id, documentNumber: "CIV-001", title: "Road Alignment",       discipline: "civil",      documentType: "report",     status: "approved", revision: "B", issuedBy: "ArcConsult" });
  const issued_electrical = await seed({ organizationId: org.id, projectId: proj.id, createdById: user.id, documentNumber: "ELE-001", title: "Single Line Diagram",  discipline: "electrical", documentType: "drawing",    status: "issued",   revision: "C", source: "external" });
  const draft_civil       = await seed({ organizationId: org.id, projectId: proj.id, createdById: user.id, documentNumber: "CIV-002", title: "Drainage Layout",      discipline: "civil",      documentType: "calculation",status: "draft",    revision: "A" });
  const incoming_external = await seed({ organizationId: org.id, projectId: proj.id, createdById: user.id, documentNumber: "EXT-001", title: "Client Transmittal",   discipline: "civil",      documentType: "transmittal",status: "draft",    revision: "A", direction: "incoming", source: "external" });
  const folder_doc        = await seed({ organizationId: org.id, projectId: proj.id, createdById: user.id, documentNumber: "FLD-001", title: "Folder Drawing",       discipline: "structural", documentType: "drawing",    status: "draft",    revision: "A", folderId: folder.id });

  fx = {
    orgId:     org.id,
    userId:    user.id,
    projectId: proj.id,
    orgBId:    orgB.id,
    userBId:   userB.id,
    folderId:  folder.id,
    docIds: { draft_structural, approved_civil, issued_electrical, draft_civil, incoming_external, folder_doc },
  };
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asUser() {
  return authHeader("admin", fx.userId, fx.orgId, "list-admin@test.edms");
}

async function list(query: Record<string, string | number> = {}) {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
  const url = `/api/projects/${fx.projectId}/documents${qs ? `?${qs}` : ""}`;
  return api().get(url).set(asUser());
}

// ─── 1. Response Shape ────────────────────────────────────────────────────────

describe("Response shape", () => {
  it("returns all required envelope fields", async () => {
    const res = await list({ limit: 10, page: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("documents");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("totalPages");
    expect(res.body).toHaveProperty("limit");
    expect(res.body).toHaveProperty("hasMore");
    expect(Array.isArray(res.body.documents)).toBe(true);
  });

  it("each document has createdByName; folderName present only for docs with a folder", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const docs: any[] = res.body.documents;
    expect(docs.length).toBeGreaterThan(0);
    // createdByName is always present (user exists for all seeded docs)
    for (const d of docs) {
      expect(d).toHaveProperty("createdByName");
    }
    // folderName is omitted (undefined → stripped by JSON.stringify) when no folder;
    // the dedicated test "folder_doc has folderName populated" covers the populated case.
    const folderDoc = docs.find((d: any) => d.id === fx.docIds.folder_doc);
    if (folderDoc) {
      expect(folderDoc.folderName).toBe("Structural");
    }
  });

  it("folder_doc has folderName populated", async () => {
    const res = await list({ folderId: fx.folderId });
    expect(res.status).toBe(200);
    const doc = res.body.documents.find((d: any) => d.id === fx.docIds.folder_doc);
    expect(doc).toBeDefined();
    expect(doc.folderName).toBe("Structural");
  });
});

// ─── 2. SQL Pagination ────────────────────────────────────────────────────────

describe("SQL pagination", () => {
  it("total reflects count of ALL matching docs, not just the page", async () => {
    // 6 docs total, page=1 limit=2 → total must be 6, not 2
    const res = await list({ limit: 2, page: 1 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
    expect(res.body.documents.length).toBe(2);
    expect(res.body.totalPages).toBe(3);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
  });

  it("page 2 returns the next slice", async () => {
    const res1 = await list({ limit: 2, page: 1 });
    const res2 = await list({ limit: 2, page: 2 });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const ids1: number[] = res1.body.documents.map((d: any) => d.id);
    const ids2: number[] = res2.body.documents.map((d: any) => d.id);

    // No overlap between pages
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap).toHaveLength(0);

    expect(res2.body.page).toBe(2);
    expect(res2.body.total).toBe(6);
  });

  it("last page has hasMore=false", async () => {
    const res = await list({ limit: 2, page: 3 });
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.documents.length).toBeLessThanOrEqual(2);
  });

  it("page beyond last returns empty documents array", async () => {
    const res = await list({ limit: 10, page: 99 });
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(0);
    expect(res.body.total).toBe(6);
    expect(res.body.hasMore).toBe(false);
  });

  it("limit is capped at 200", async () => {
    const res = await list({ limit: 9999, page: 1 });
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  it("all docs returned when limit >= total", async () => {
    const res = await list({ limit: 100, page: 1 });
    expect(res.status).toBe(200);
    expect(res.body.documents.length).toBe(6);
    expect(res.body.total).toBe(6);
    expect(res.body.hasMore).toBe(false);
  });
});

// ─── 3. Filters ──────────────────────────────────────────────────────────────

describe("Filters (SQL WHERE)", () => {
  it("discipline filter returns only matching docs", async () => {
    const res = await list({ discipline: "civil" });
    expect(res.status).toBe(200);
    const docs: any[] = res.body.documents;
    expect(docs.length).toBe(3); // approved_civil, draft_civil, incoming_external
    expect(docs.every((d: any) => d.discipline === "civil")).toBe(true);
    expect(res.body.total).toBe(3);
  });

  it("documentType filter returns only matching docs", async () => {
    const res = await list({ documentType: "drawing" });
    expect(res.status).toBe(200);
    const docs: any[] = res.body.documents;
    // draft_structural (drawing), issued_electrical (drawing), folder_doc (drawing)
    expect(docs.length).toBe(3);
    expect(docs.every((d: any) => d.documentType === "drawing")).toBe(true);
    expect(res.body.total).toBe(3);
  });

  it("status filter — draft returns only draft docs", async () => {
    const res = await list({ status: "draft" });
    expect(res.status).toBe(200);
    const docs: any[] = res.body.documents;
    expect(docs.length).toBe(4); // draft_structural, draft_civil, incoming_external, folder_doc
    expect(docs.every((d: any) => d.status === "draft")).toBe(true);
    expect(res.body.total).toBe(4);
  });

  it("status filter — approved returns only approved docs", async () => {
    const res = await list({ status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.approved_civil);
  });

  it("folderId filter returns only docs in that folder", async () => {
    const res = await list({ folderId: fx.folderId });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.folder_doc);
  });

  it("source filter returns only matching docs", async () => {
    const res = await list({ source: "external" });
    expect(res.status).toBe(200);
    // issued_electrical and incoming_external
    expect(res.body.total).toBe(2);
    expect(res.body.documents.every((d: any) => d.source === "external")).toBe(true);
  });

  it("direction=incoming returns only incoming docs", async () => {
    const res = await list({ direction: "incoming" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.incoming_external);
  });

  it("issuedBy filter is case-insensitive ILIKE", async () => {
    const res = await list({ issuedBy: "arcconsult" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.approved_civil);
  });

  it("issuedBy filter — partial match works", async () => {
    const res = await list({ issuedBy: "consult" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("combined filters narrow the result set", async () => {
    // civil + draft → draft_civil + incoming_external
    const res = await list({ discipline: "civil", status: "draft" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids: number[] = res.body.documents.map((d: any) => d.id);
    expect(ids).toContain(fx.docIds.draft_civil);
    expect(ids).toContain(fx.docIds.incoming_external);
  });

  it("filter with no matches returns empty documents and total=0", async () => {
    const res = await list({ discipline: "nonexistent_discipline_xyz" });
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(0);
    expect(res.body.total).toBe(0);
    expect(res.body.totalPages).toBe(0);
    expect(res.body.hasMore).toBe(false);
  });
});

// ─── 4. Search ────────────────────────────────────────────────────────────────

describe("Search (multi-field ILIKE)", () => {
  it("search matches on title", async () => {
    const res = await list({ search: "Foundation" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.draft_structural);
  });

  it("search matches on documentNumber", async () => {
    const res = await list({ search: "CIV-001" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.approved_civil);
  });

  it("search matches on discipline", async () => {
    const res = await list({ search: "electrical" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.issued_electrical);
  });

  it("search matches on issuedBy", async () => {
    const res = await list({ search: "ArcConsult" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.documents[0].id).toBe(fx.docIds.approved_civil);
  });

  it("search is case-insensitive", async () => {
    const res = await list({ search: "FOUNDATION" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("search with no match returns empty", async () => {
    const res = await list({ search: "XYZZY_NO_MATCH_9999" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.documents).toHaveLength(0);
  });

  it("search combined with filter narrows further", async () => {
    // search=civil (matches discipline) AND status=draft
    const res = await list({ search: "civil", status: "draft" });
    expect(res.status).toBe(200);
    // Matches: draft_civil (civil+draft), incoming_external (civil+draft)
    // NOT: approved_civil (civil but approved)
    const ids: number[] = res.body.documents.map((d: any) => d.id);
    expect(ids).not.toContain(fx.docIds.approved_civil);
    expect(ids).toContain(fx.docIds.draft_civil);
  });

  it("search on partial documentNumber returns match", async () => {
    const res = await list({ search: "ELE" });
    expect(res.status).toBe(200);
    const ids: number[] = res.body.documents.map((d: any) => d.id);
    expect(ids).toContain(fx.docIds.issued_electrical);
  });
});

// ─── 5. Tenant Isolation ──────────────────────────────────────────────────────

describe("Tenant isolation", () => {
  it("Org B admin cannot list Org A's documents (403 or 404)", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/documents`)
      .set(authHeader("admin", fx.userBId, fx.orgBId, "attacker@test.edms"));
    expect([403, 404]).toContain(res.status);
  });

  it("Org B admin cannot access documents even with filters", async () => {
    const res = await api()
      .get(`/api/projects/${fx.projectId}/documents?status=draft`)
      .set(authHeader("admin", fx.userBId, fx.orgBId, "attacker@test.edms"));
    expect([403, 404]).toContain(res.status);
  });

  it("Org B admin listing own empty project gets empty list, not Org A docs", async () => {
    const projB = await createProject({ organizationId: fx.orgBId, name: "Attacker Project", code: "ATK-001" });
    const db    = getTestDb();
    await db.insert(projectMembersTable).values({ projectId: projB.id, userId: fx.userBId, role: "admin" });

    const res = await api()
      .get(`/api/projects/${projB.id}/documents`)
      .set(authHeader("admin", fx.userBId, fx.orgBId, "attacker@test.edms"))
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.documents).toHaveLength(0);
  });
});

// ─── 6. Empty project ────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("project with no documents returns correct zero envelope", async () => {
    const emptyProj = await createProject({ organizationId: fx.orgId, name: "Empty Project", code: "EMP-001" });
    const db        = getTestDb();
    await db.insert(projectMembersTable).values({ projectId: emptyProj.id, userId: fx.userId, role: "admin" });

    const res = await api()
      .get(`/api/projects/${emptyProj.id}/documents`)
      .set(asUser())
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.documents).toHaveLength(0);
    expect(res.body.totalPages).toBe(0);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.page).toBe(1);
  });
});

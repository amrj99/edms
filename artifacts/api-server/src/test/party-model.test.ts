/**
 * party-model.test.ts
 *
 * Phase E — Party Model Minimum Integration Tests
 *
 * Coverage:
 *   - Party management endpoints: GET / POST / DELETE /projects/:id/parties
 *   - Collaboration mode toggle: PATCH /projects/:id/collaboration-mode
 *   - observer vs contributor ceiling enforcement
 *   - org_only vs parties mode gate
 *   - cross-project isolation (party on project A cannot access project B)
 *   - upload URL access (POST /api/storage/uploads/request-url)
 *   - storage download access (GET /api/storage/objects/*)
 *   - transmittal access: GET + POST ceiling enforcement
 *   - correspondence blocked for all party roles
 *   - submit-review blocked for party contributor
 *   - regression: intra-org users unaffected by party changes
 *
 * Fixture structure:
 *   orgOwner        — owns the project
 *   orgObserver     — added as "observer" party
 *   orgContributor  — added as "contributor" party
 *   orgOther        — no party relationship, completely isolated
 *
 * Users:
 *   adminOwner      — admin in orgOwner (manages parties, creates documents)
 *   memberOwner     — member in orgOwner (intra-org regression)
 *   userObserver    — member in orgObserver (observer ceiling tests)
 *   userContributor — member in orgContributor (contributor ceiling tests)
 *   userOther       — member in orgOther (no-access tests)
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
import {
  documentsTable,
  orgConfigTable,
} from "@workspace/db";

const db = getTestDb();

// ─── Fixture state ────────────────────────────────────────────────────────────

let orgOwner:       { id: number };
let orgObserver:    { id: number };
let orgContributor: { id: number };
let orgOther:       { id: number };

let adminOwner:      { id: number; organizationId: number | null };
let memberOwner:     { id: number; organizationId: number | null };
let userObserver:    { id: number; organizationId: number | null };
let userContributor: { id: number; organizationId: number | null };
let userOther:       { id: number; organizationId: number | null };

let projectId: number;

// Key used for storage download tests — the fileUrl is the full serve path.
const STORAGE_OBJECT_KEY = "orgs/pm-test/doc-party.pdf";
const STORAGE_SERVE_URL  = `/api/storage/objects/${STORAGE_OBJECT_KEY}`;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await truncateAllTables();

  // Organizations
  orgOwner       = await createOrg({ name: "Party Owner Org",       code: "PMOWN" });
  orgObserver    = await createOrg({ name: "Party Observer Org",    code: "PMOBS" });
  orgContributor = await createOrg({ name: "Party Contributor Org", code: "PMCON" });
  orgOther       = await createOrg({ name: "Party Other Org",       code: "PMOTH" });

  // Users
  adminOwner      = await createUser({ organizationId: orgOwner.id,       role: "admin",  email: "admin@pmown.test"  });
  memberOwner     = await createUser({ organizationId: orgOwner.id,       role: "member", email: "member@pmown.test" });
  userObserver    = await createUser({ organizationId: orgObserver.id,    role: "member", email: "obs@pmobs.test"    });
  userContributor = await createUser({ organizationId: orgContributor.id, role: "member", email: "con@pmcon.test"    });
  userOther       = await createUser({ organizationId: orgOther.id,       role: "member", email: "oth@pmoth.test"    });

  // Module config — enable registers + correspondence for all orgs so module gate
  // does not mask the authorization logic under test.
  const moduleConfig = { registers: true, correspondence: true };
  await db.insert(orgConfigTable).values([
    { organizationId: orgOwner.id,       modules: moduleConfig },
    { organizationId: orgObserver.id,    modules: moduleConfig },
    { organizationId: orgContributor.id, modules: moduleConfig },
    { organizationId: orgOther.id,       modules: moduleConfig },
  ]);

  // Project owned by orgOwner
  const pRes = await api()
    .post("/api/projects")
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ name: "Party Test Project", code: "PMPROJ", organizationId: orgOwner.id });
  projectId = pRes.body.id;

  // Seed a document referenced by storage download tests.
  // fileUrl matches STORAGE_SERVE_URL so findOrgIdForObjectServeUrl and
  // findPartyProjectIdForServeUrl can resolve it.
  await db.insert(documentsTable).values({
    organizationId: orgOwner.id,
    projectId,
    createdById: adminOwner.id,
    documentNumber: "DOC-PM-001",
    title:          "Party Model Test Document",
    revision:       "A",
    status:         "draft",
    fileUrl:        STORAGE_SERVE_URL,
  });

  // Add orgObserver as "observer" party
  await api()
    .post(`/api/projects/${projectId}/parties`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ organizationId: orgObserver.id, partyRole: "observer" });

  // Add orgContributor as "contributor" party
  await api()
    .post(`/api/projects/${projectId}/parties`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ organizationId: orgContributor.id, partyRole: "contributor" });

  // Enable collaboration mode so parties can access the project
  await api()
    .patch(`/api/projects/${projectId}/collaboration-mode`)
    .set(authHeader("admin", adminOwner.id, orgOwner.id))
    .send({ collaborationMode: "parties" });
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── 1. Party Management — GET /parties ───────────────────────────────────────

describe("GET /api/projects/:id/parties", () => {
  it("owner admin sees both active parties", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const orgIds = res.body.map((p: any) => p.organization.id);
    expect(orgIds).toContain(orgObserver.id);
    expect(orgIds).toContain(orgContributor.id);
  });

  it("owner member (non-admin) can still list parties (no role restriction on GET)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/parties`)
      .set(authHeader("member", memberOwner.id, orgOwner.id));

    // resolveOwnerProject allows any owner-org user to list (GET has no requireMinRole guard)
    expect(res.status).toBe(200);
  });

  it("party-org user (observer) gets 404 — information hiding", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/parties`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(404);
  });

  it("unrelated org user gets 404", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/parties`)
      .set(authHeader("member", userOther.id, orgOther.id));

    expect(res.status).toBe(404);
  });
});

// ─── 2. Party Management — POST /parties ──────────────────────────────────────

describe("POST /api/projects/:id/parties", () => {
  it("422 when adding the project owner org as a party", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ organizationId: orgOwner.id, partyRole: "observer" });

    expect(res.status).toBe(422);
  });

  it("409 when adding an already-active party", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ organizationId: orgObserver.id, partyRole: "observer" });

    expect(res.status).toBe(409);
  });

  it("404 when target organization does not exist", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ organizationId: 999999, partyRole: "observer" });

    expect(res.status).toBe(404);
  });

  it("party-org user (member role) cannot add parties (403 from requireMinRole)", async () => {
    // requireMinRole("admin") fires before resolveOwnerProject.
    // A party user with role="member" hits the role check first → 403.
    // An admin-level party user would reach resolveOwnerProject and get 404 (info-hiding).
    // Both paths block the request — the distinction is which middleware fires first.
    const res = await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("member", userObserver.id, orgObserver.id))
      .send({ organizationId: orgOther.id, partyRole: "observer" });

    expect(res.status).toBe(403);
  });

  it("non-admin owner-org user is rejected (403)", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("member", memberOwner.id, orgOwner.id))
      .send({ organizationId: orgOther.id, partyRole: "observer" });

    expect(res.status).toBe(403);
  });
});

// ─── 3. Party Management — DELETE /parties/:orgId + re-activation ─────────────

describe("DELETE /api/projects/:id/parties/:orgId + soft-delete re-activation", () => {
  let tempOrg: { id: number };

  beforeAll(async () => {
    tempOrg = await createOrg({ name: "Temp Party Org", code: "PMTMP" });
    // Add tempOrg as a party
    await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ organizationId: tempOrg.id, partyRole: "observer" });
  });

  it("owner admin can soft-delete a party (200)", async () => {
    const res = await api()
      .delete(`/api/projects/${projectId}/parties/${tempOrg.id}`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("deleted party no longer appears in the list", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));

    const orgIds = res.body.map((p: any) => p.organization.id);
    expect(orgIds).not.toContain(tempOrg.id);
  });

  it("re-adding a soft-deleted party succeeds (201, not 409)", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ organizationId: tempOrg.id, partyRole: "contributor" });

    expect(res.status).toBe(201);
    expect(res.body.partyRole).toBe("contributor");
  });

  it("party-org user (member role) cannot delete parties (403 from requireMinRole)", async () => {
    const res = await api()
      .delete(`/api/projects/${projectId}/parties/${orgObserver.id}`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(403);
  });
});

// ─── 4. Collaboration Mode Toggle ─────────────────────────────────────────────

describe("PATCH /api/projects/:id/collaboration-mode", () => {
  it("owner admin can switch to org_only (200)", async () => {
    const res = await api()
      .patch(`/api/projects/${projectId}/collaboration-mode`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ collaborationMode: "org_only" });

    expect(res.status).toBe(200);
    expect(res.body.collaborationMode).toBe("org_only");
  });

  it("party member cannot access project while mode=org_only (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(403);
  });

  it("intra-org member still accesses project while mode=org_only (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", memberOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
  });

  it("switching back to parties restores party access (200)", async () => {
    await api()
      .patch(`/api/projects/${projectId}/collaboration-mode`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ collaborationMode: "parties" });

    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(200);
  });

  it("party-org user (member role) cannot toggle collaboration mode (403 from requireMinRole)", async () => {
    const res = await api()
      .patch(`/api/projects/${projectId}/collaboration-mode`)
      .set(authHeader("member", userObserver.id, orgObserver.id))
      .send({ collaborationMode: "org_only" });

    expect(res.status).toBe(403);
  });
});

// ─── 5. Project Access — observer vs contributor ───────────────────────────────

describe("GET /api/projects/:id — party access gate", () => {
  it("observer can access project details (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(projectId);
  });

  it("contributor can access project details (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", userContributor.id, orgContributor.id));

    expect(res.status).toBe(200);
  });

  it("unrelated org member is forbidden (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", userOther.id, orgOther.id));

    expect(res.status).toBe(403);
  });
});

// ─── 6. Documents — observer ceiling (upload_document = false) ─────────────────

describe("Document upload ceiling — observer", () => {
  it("observer can read the project document list (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/documents`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(200);
  });

  it("observer cannot upload a document (403 — ceiling block)", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/documents`)
      .set(authHeader("member", userObserver.id, orgObserver.id))
      .send({ title: "Attempt", documentNumber: "DOC-OBS-001", revision: "A" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/party role does not permit/i);
  });
});

// ─── 7. Documents — contributor ceiling (upload_document = true) ───────────────

describe("Document upload ceiling — contributor", () => {
  it("contributor can read the project document list (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/documents`)
      .set(authHeader("member", userContributor.id, orgContributor.id));

    expect(res.status).toBe(200);
  });

  it("contributor passes the upload auth check (not 403)", async () => {
    // Ceiling check passes; any failure here is validation/business logic, not auth.
    const res = await api()
      .post(`/api/projects/${projectId}/documents`)
      .set(authHeader("member", userContributor.id, orgContributor.id))
      .send({ title: "Contributor Upload", documentNumber: "DOC-CON-001", revision: "A" });

    expect(res.status).not.toBe(403);
  });
});

// ─── 8. org_only gate — both party orgs lose access ───────────────────────────

describe("org_only gate — access revoked for all party members", () => {
  beforeAll(async () => {
    await api()
      .patch(`/api/projects/${projectId}/collaboration-mode`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ collaborationMode: "org_only" });
  });

  afterAll(async () => {
    await api()
      .patch(`/api/projects/${projectId}/collaboration-mode`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ collaborationMode: "parties" });
  });

  it("observer is blocked when mode=org_only (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(403);
  });

  it("contributor is blocked when mode=org_only (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", userContributor.id, orgContributor.id));

    expect(res.status).toBe(403);
  });
});

// ─── 9. Cross-project isolation ───────────────────────────────────────────────

describe("cross-project isolation", () => {
  let projectBId: number;
  let orgB:       { id: number };
  let adminB:     { id: number; organizationId: number | null };

  beforeAll(async () => {
    orgB   = await createOrg({ name: "Isolation Org B", code: "PMISOB" });
    adminB = await createUser({ organizationId: orgB.id, role: "admin", email: "adminb@pmiso.test" });

    const pRes = await api()
      .post("/api/projects")
      .set(authHeader("admin", adminB.id, orgB.id))
      .send({ name: "Isolation Project B", code: "PMISOPRJ", organizationId: orgB.id });
    projectBId = pRes.body.id;
  });

  it("observer (party on project A) cannot access project B (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectBId}`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(403);
  });

  it("contributor (party on project A) cannot access documents in project B (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectBId}/documents`)
      .set(authHeader("member", userContributor.id, orgContributor.id));

    expect(res.status).toBe(403);
  });
});

// ─── 10. Upload URL access (POST /api/storage/uploads/request-url) ────────────

describe("POST /api/storage/uploads/request-url — party ceiling enforcement", () => {
  it("observer + projectId → 403 (upload_document ceiling block)", async () => {
    const res = await api()
      .post("/api/storage/uploads/request-url")
      .set(authHeader("member", userObserver.id, orgObserver.id))
      .send({
        name:        "observer-upload.pdf",
        size:        1024,
        contentType: "application/pdf",
        projectId:   projectId,
        fileType:    "document",
      });

    expect(res.status).toBe(403);
  });

  it("contributor + projectId → auth check passes (not 403)", async () => {
    // Ceiling allows upload_document for contributor. Any failure here is
    // configuration (missing storage backend), not authorization.
    const res = await api()
      .post("/api/storage/uploads/request-url")
      .set(authHeader("member", userContributor.id, orgContributor.id))
      .send({
        name:        "contributor-upload.pdf",
        size:        1024,
        contentType: "application/pdf",
        projectId:   projectId,
        fileType:    "document",
      });

    expect(res.status).not.toBe(403);
  });

  it("unrelated org user + projectId → 403 (no party relationship)", async () => {
    const res = await api()
      .post("/api/storage/uploads/request-url")
      .set(authHeader("member", userOther.id, orgOther.id))
      .send({
        name:        "other-upload.pdf",
        size:        1024,
        contentType: "application/pdf",
        projectId:   projectId,
        fileType:    "document",
      });

    expect(res.status).toBe(403);
  });

  it("contributor without projectId uses own org bucket (no cross-org escalation)", async () => {
    // Without projectId there is no party context — the URL is for the caller's own org.
    const res = await api()
      .post("/api/storage/uploads/request-url")
      .set(authHeader("member", userContributor.id, orgContributor.id))
      .send({
        name:        "contributor-noproj.pdf",
        size:        1024,
        contentType: "application/pdf",
        fileType:    "document",
      });

    // Auth check passes (own org, no cross-org risk); actual success depends on
    // storage backend config.
    expect(res.status).not.toBe(403);
  });
});

// ─── 11. Storage download access (GET /api/storage/objects/*) ─────────────────

describe("GET /api/storage/objects/* — party download access", () => {
  it("observer can download a document from the project (auth passes — not 403)", async () => {
    const res = await api()
      .get(STORAGE_SERVE_URL)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    // The org-ownership check falls through to party access check and allows.
    // Any remaining failure (e.g. 404/500) is storage backend, not authorization.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("contributor can download a document from the project (auth passes — not 403)", async () => {
    const res = await api()
      .get(STORAGE_SERVE_URL)
      .set(authHeader("member", userContributor.id, orgContributor.id));

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("unrelated org user is denied (403)", async () => {
    const res = await api()
      .get(STORAGE_SERVE_URL)
      .set(authHeader("member", userOther.id, orgOther.id));

    expect(res.status).toBe(403);
  });

  it("unauthenticated request is denied (401)", async () => {
    const res = await api().get(STORAGE_SERVE_URL);
    expect(res.status).toBe(401);
  });
});

// ─── 12. Transmittal access ────────────────────────────────────────────────────

describe("Transmittal access — ceiling enforcement", () => {
  it("observer can list transmittals (GET 200 — read is always allowed)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/transmittals`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(200);
  });

  it("contributor can list transmittals (GET 200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/transmittals`)
      .set(authHeader("member", userContributor.id, orgContributor.id));

    expect(res.status).toBe(200);
  });

  it("observer cannot create a transmittal (403 — create_transmittal ceiling block)", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/transmittals`)
      .set(authHeader("member", userObserver.id, orgObserver.id))
      .send({
        subject:     "Observer Transmittal Attempt",
        purpose:     "information",
        direction:   "outgoing",
        toExternal:  true,
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/party role does not permit/i);
  });

  it("contributor passes transmittal create auth check (not 403)", async () => {
    // Ceiling allows create_transmittal for contributor.
    // Any failure is validation/business logic (e.g. 400/422), not ceiling.
    const res = await api()
      .post(`/api/projects/${projectId}/transmittals`)
      .set(authHeader("member", userContributor.id, orgContributor.id))
      .send({
        subject:     "Contributor Transmittal",
        purpose:     "information",
        direction:   "outgoing",
        toExternal:  true,
      });

    expect(res.status).not.toBe(403);
  });

  it("unrelated org member is forbidden on GET (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/transmittals`)
      .set(authHeader("member", userOther.id, orgOther.id));

    expect(res.status).toBe(403);
  });
});

// ─── 13. Correspondence blocked ───────────────────────────────────────────────

describe("Correspondence access — blocked for all party roles", () => {
  it("observer cannot read project correspondence (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/correspondence`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(403);
  });

  it("contributor cannot read project correspondence (403)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/correspondence`)
      .set(authHeader("member", userContributor.id, orgContributor.id));

    expect(res.status).toBe(403);
  });
});

// ─── 14. Submit-review blocked ────────────────────────────────────────────────

describe("Submit-review — blocked for party contributor", () => {
  it("contributor cannot submit-review a document owned by project owner org (404 via orgScopedWhere)", async () => {
    // orgScopedWhere scopes the UPDATE to the caller's org (orgContributor).
    // The document belongs to orgOwner — scope mismatch → 0 rows updated → 404.
    // This confirms the intra-org isolation layer prevents cross-org document mutation.
    const res = await api()
      .post(`/api/projects/${projectId}/documents/1/submit-review`)
      .set(authHeader("member", userContributor.id, orgContributor.id))
      .send({ reviewerIds: [] });

    // Either 404 (orgScopedWhere found nothing) or 403 if a project-level gate fires.
    // In any case, the action is blocked — not 200.
    expect(res.status).not.toBe(200);
  });

  it("observer also cannot submit-review (blocked by orgScopedWhere scope)", async () => {
    const res = await api()
      .post(`/api/projects/${projectId}/documents/1/submit-review`)
      .set(authHeader("member", userObserver.id, orgObserver.id))
      .send({ reviewerIds: [] });

    expect(res.status).not.toBe(200);
  });
});

// ─── 15. Intra-org regression ─────────────────────────────────────────────────

describe("Intra-org regression — owner-org users unaffected by party model", () => {
  it("owner-org member can still access project details (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}`)
      .set(authHeader("member", memberOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
  });

  it("owner-org member can still list project documents (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/documents`)
      .set(authHeader("member", memberOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
  });

  it("owner-org member can still list transmittals (200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/transmittals`)
      .set(authHeader("member", memberOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
  });

  it("owner admin can still manage parties after all mode toggles (GET 200)", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
    // observer + contributor (+ tempOrg re-added in suite 3) should still be present
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── GET /api/projects/:id/available-organizations ────────────────────────────

describe("GET /api/projects/:id/available-organizations", () => {
  it("owner admin sees all orgs except project owner + active parties", async () => {
    // Reset: remove all current parties so we start clean
    const listRes = await api()
      .get(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));
    for (const party of listRes.body) {
      await api()
        .delete(`/api/projects/${projectId}/parties/${party.organization.id}`)
        .set(authHeader("admin", adminOwner.id, orgOwner.id));
    }

    // Now add orgObserver as active party
    await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ organizationId: orgObserver.id, partyRole: "observer" });

    const res = await api()
      .get(`/api/projects/${projectId}/available-organizations`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));

    expect(res.status).toBe(200);
    const ids = res.body.map((o: { id: number }) => o.id);
    // Owner org must be excluded
    expect(ids).not.toContain(orgOwner.id);
    // Active party (observer) must be excluded
    expect(ids).not.toContain(orgObserver.id);
    // Non-party orgs must be included
    expect(ids).toContain(orgContributor.id);
    expect(ids).toContain(orgOther.id);
  });

  it("active party org is excluded; reappears after soft-delete", async () => {
    // orgObserver is currently active party from previous test
    const beforeDelete = await api()
      .get(`/api/projects/${projectId}/available-organizations`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));
    expect(beforeDelete.body.map((o: { id: number }) => o.id)).not.toContain(orgObserver.id);

    // Soft-delete the party
    await api()
      .delete(`/api/projects/${projectId}/parties/${orgObserver.id}`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));

    // Now orgObserver should reappear in available list
    const afterDelete = await api()
      .get(`/api/projects/${projectId}/available-organizations`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id));
    expect(afterDelete.body.map((o: { id: number }) => o.id)).toContain(orgObserver.id);
  });

  it("party-org user (observer) gets 404 — same gate as /parties", async () => {
    // Re-add observer so the party exists
    await api()
      .post(`/api/projects/${projectId}/parties`)
      .set(authHeader("admin", adminOwner.id, orgOwner.id))
      .send({ organizationId: orgObserver.id, partyRole: "observer" });

    const res = await api()
      .get(`/api/projects/${projectId}/available-organizations`)
      .set(authHeader("member", userObserver.id, orgObserver.id));

    expect(res.status).toBe(404);
  });

  it("unrelated org user gets 404", async () => {
    const res = await api()
      .get(`/api/projects/${projectId}/available-organizations`)
      .set(authHeader("member", userOther.id, orgOther.id));

    expect(res.status).toBe(404);
  });
});

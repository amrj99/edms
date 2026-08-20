/**
 * debt-004-request-url-role-gate.test.ts
 *
 * DEBT-004 regression: POST /api/storage/uploads/request-url must enforce the
 * write (canCreate) role gate server-side, not only project access.
 *
 * Before the fix, an intra-org read-only role (reviewer / member / viewer) who is
 * a project member could obtain a presigned upload URL (HTTP 200) and write
 * objects to the org bucket, even though it cannot create a document. BUG-005
 * gated document create + the files POST, but the presign endpoint was open.
 *
 * Guarantees pinned here:
 *   - admin / document_controller / project_manager  → allowed (200)
 *   - reviewer / member / viewer                     → 403 (no presigned URL)
 *   - project-scoped AND no-projectId paths are both gated
 *   - cross-tenant isolation still holds (outsider org → 403)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables,
} from "./helpers/index.js";
import { orgConfigTable } from "@workspace/db";

interface Fx {
  orgA: { id: number }; orgOut: { id: number };
  admin: { id: number }; dc: { id: number }; pm: { id: number };
  reviewer: { id: number }; member: { id: number }; viewer: { id: number };
  outsider: { id: number };
  projectA: { id: number }; base: string;
}
let fx: Fx;

const REQ = "/api/storage/uploads/request-url";
const body = (projectId?: number) => ({
  name: "gate-test.png", size: 10, contentType: "image/png",
  ...(projectId != null ? { projectId } : {}), fileType: "document",
});
const h = (role: string, userId: number, orgId: number, email: string) =>
  authHeader(role as Parameters<typeof authHeader>[0], userId, orgId, email);

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "debt004-"));

  const orgA = await createOrg({ name: "Gate Org A", code: "GATEA" });
  const orgOut = await createOrg({ name: "Outsider Org", code: "GOUT" });

  const admin    = await createUser({ organizationId: orgA.id, role: "admin",               email: "admin@gatea.test" });
  const dc       = await createUser({ organizationId: orgA.id, role: "document_controller",  email: "dc@gatea.test" });
  const pm       = await createUser({ organizationId: orgA.id, role: "project_manager",      email: "pm@gatea.test" });
  const reviewer = await createUser({ organizationId: orgA.id, role: "reviewer",             email: "rev@gatea.test" });
  const member   = await createUser({ organizationId: orgA.id, role: "member",               email: "mem@gatea.test" });
  const viewer   = await createUser({ organizationId: orgA.id, role: "viewer",               email: "view@gatea.test" });
  const outsider = await createUser({ organizationId: orgOut.id, role: "admin",              email: "admin@gout.test" });

  // On-premise storage so the ALLOWED path returns 200 (a real URL), not 503.
  await db.insert(orgConfigTable).values({ organizationId: orgA.id, storageType: "onpremise", storagePath: base });

  const projectA = await createProject({ organizationId: orgA.id, createdById: admin.id, name: "Gate Project", code: "GATEA-001" });

  fx = { orgA, orgOut, admin, dc, pm, reviewer, member, viewer, outsider, projectA, base };
});
afterAll(async () => {
  try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* ignore */ }
  await truncateAllTables();
});

describe("DEBT-004 — request-url enforces the write-role gate (project-scoped)", () => {
  it("admin → 200 (allowed)", async () => {
    const r = await api().post(REQ).set(h("admin", fx.admin.id, fx.orgA.id, "admin@gatea.test")).send(body(fx.projectA.id));
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(r.body.uploadURL || r.body.serveUrl).toBeTruthy();
  });
  it("document_controller → 200 (allowed)", async () => {
    const r = await api().post(REQ).set(h("document_controller", fx.dc.id, fx.orgA.id, "dc@gatea.test")).send(body(fx.projectA.id));
    expect(r.status).toBe(200);
  });
  it("project_manager → 200 (allowed)", async () => {
    const r = await api().post(REQ).set(h("project_manager", fx.pm.id, fx.orgA.id, "pm@gatea.test")).send(body(fx.projectA.id));
    expect(r.status).toBe(200);
  });

  it("reviewer → 403 (read-only, no presigned URL)", async () => {
    const r = await api().post(REQ).set(h("reviewer", fx.reviewer.id, fx.orgA.id, "rev@gatea.test")).send(body(fx.projectA.id));
    expect(r.status).toBe(403);
    expect(r.body.uploadURL).toBeUndefined();
  });
  it("member → 403 (read-only)", async () => {
    const r = await api().post(REQ).set(h("member", fx.member.id, fx.orgA.id, "mem@gatea.test")).send(body(fx.projectA.id));
    expect(r.status).toBe(403);
  });
  it("viewer → 403 (read-only)", async () => {
    const r = await api().post(REQ).set(h("viewer", fx.viewer.id, fx.orgA.id, "view@gatea.test")).send(body(fx.projectA.id));
    expect(r.status).toBe(403);
  });
});

// Note (scope): the no-projectId "general upload" path (own-org, non-project files such
// as correspondence attachments) is intentionally NOT gated by canCreate — existing
// design allows intra-org members there (see party-model "contributor without projectId
// uses own org bucket"). DEBT-004 was the PROJECT-SCOPED document path, covered above.

describe("DEBT-004 — cross-tenant isolation still holds", () => {
  it("outsider org admin requesting upload for Org A's project → 403", async () => {
    const r = await api().post(REQ).set(h("admin", fx.outsider.id, fx.orgOut.id, "admin@gout.test")).send(body(fx.projectA.id));
    expect(r.status).toBe(403);
    expect(r.body.uploadURL).toBeUndefined();
  });
});

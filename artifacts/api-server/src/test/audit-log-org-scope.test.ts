/**
 * audit-log-org-scope.test.ts
 *
 * Regression tests for R7: audit logs are org-scoped.
 *
 * Verifies the CURRENT (already correct) behavior:
 *   - system_owner sees all audit logs (no org filter)
 *   - admin sees only own org's audit logs
 *   - admin CANNOT read audit logs from another org
 *   - viewer/reviewer are blocked (403)
 *   - project_manager/document_controller are org-scoped
 *
 * These tests document correct behavior and guard against future regression.
 * No code changes were required — the audit-logs.ts already uses isSystemOwner()
 * and buildOrgCondition() correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api } from "./helpers/index.js";
import {
  createOrg,
  createUser,
  createProject,
  resetFactoryCounters,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import { makeToken } from "./helpers/auth.js";
import { auditLogsTable } from "@workspace/db";

// ── DB isolation ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateAllTables();
  resetFactoryCounters();
});

afterEach(async () => {
  await truncateAllTables();
});

// ── Helper: seed an audit log entry directly ──────────────────────────────────

async function seedAuditLog(opts: {
  userId: number;
  organizationId: number | null;
  action?: string;
  entityType?: string;
}) {
  const db = getTestDb();
  const [log] = await db
    .insert(auditLogsTable)
    .values({
      userId:         opts.userId,
      organizationId: opts.organizationId,
      action:         opts.action ?? "update",
      entityType:     opts.entityType ?? "document",
      entityId:       1,
      entityTitle:    "Test Document",
    })
    .returning();
  return log;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("R7 Regression: audit log org-scoping", () => {

  describe("admin — org-scoped access", () => {

    it("admin can see audit logs from own org → 200 with results", async () => {
      const org   = await createOrg();
      const admin = await createUser({ organizationId: org.id, role: "admin" });

      // Seed a log for this org
      await seedAuditLog({ userId: admin.id, organizationId: org.id });

      const token = makeToken({ id: admin.id, email: admin.email, role: "admin", organizationId: org.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      // Logs belong to own org (or have null org — legacy rows scoped by user)
      const orgIds = res.body.logs
        .filter((l: any) => l.organizationId !== null)
        .map((l: any) => l.organizationId);
      orgIds.forEach((id: number) => expect(id).toBe(org.id));
    });

    it("admin CANNOT see audit logs from another org — cross-org entries excluded", async () => {
      const orgA  = await createOrg();
      const orgB  = await createOrg();
      const adminA = await createUser({ organizationId: orgA.id, role: "admin" });
      const userB  = await createUser({ organizationId: orgB.id, role: "viewer" });

      // Seed logs for BOTH orgs
      await seedAuditLog({ userId: adminA.id, organizationId: orgA.id, action: "login_success" });
      await seedAuditLog({ userId: userB.id,  organizationId: orgB.id, action: "login_success" });

      const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      // None of the returned logs should belong to orgB
      const orgBLogs = res.body.logs.filter((l: any) => l.organizationId === orgB.id);
      expect(orgBLogs.length).toBe(0);
    });

    it("admin sees exactly own org's log count, not total across all orgs", async () => {
      const orgA   = await createOrg();
      const orgB   = await createOrg();
      const adminA = await createUser({ organizationId: orgA.id, role: "admin" });
      const userB  = await createUser({ organizationId: orgB.id, role: "viewer" });

      // 2 logs for orgA, 3 for orgB
      await seedAuditLog({ userId: adminA.id, organizationId: orgA.id });
      await seedAuditLog({ userId: adminA.id, organizationId: orgA.id });
      await seedAuditLog({ userId: userB.id,  organizationId: orgB.id });
      await seedAuditLog({ userId: userB.id,  organizationId: orgB.id });
      await seedAuditLog({ userId: userB.id,  organizationId: orgB.id });

      const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      // total should be 2 (orgA only), not 5 (all orgs)
      expect(res.body.total).toBe(2);
    });
  });

  describe("system_owner — cross-org access", () => {

    it("system_owner sees audit logs from all orgs", async () => {
      const orgA  = await createOrg();
      const orgB  = await createOrg();
      const owner = await createUser({ organizationId: orgA.id, role: "system_owner" });
      const userA = await createUser({ organizationId: orgA.id, role: "viewer" });
      const userB = await createUser({ organizationId: orgB.id, role: "viewer" });

      await seedAuditLog({ userId: userA.id, organizationId: orgA.id });
      await seedAuditLog({ userId: userB.id, organizationId: orgB.id });

      const token = makeToken({ id: owner.id, email: owner.email, role: "system_owner", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      // system_owner sees both orgs' logs
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      const orgIds = new Set(
        res.body.logs
          .filter((l: any) => l.organizationId !== null)
          .map((l: any) => l.organizationId)
      );
      expect(orgIds.has(orgA.id)).toBe(true);
      expect(orgIds.has(orgB.id)).toBe(true);
    });

    it("system_owner total includes logs from multiple orgs", async () => {
      const orgA  = await createOrg();
      const orgB  = await createOrg();
      const owner = await createUser({ organizationId: orgA.id, role: "system_owner" });
      const userA = await createUser({ organizationId: orgA.id, role: "admin" });
      const userB = await createUser({ organizationId: orgB.id, role: "admin" });

      await seedAuditLog({ userId: userA.id, organizationId: orgA.id });
      await seedAuditLog({ userId: userB.id, organizationId: orgB.id });

      const token = makeToken({ id: owner.id, email: owner.email, role: "system_owner", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      // system_owner total ≥ admin's total (includes other orgs)
      const ownerTotal = res.body.total;

      // Now check as admin (should see less)
      const adminToken = makeToken({ id: userA.id, email: userA.email, role: "admin", organizationId: orgA.id });
      const adminRes = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${adminToken}` });
      const adminTotal = adminRes.body.total;

      expect(ownerTotal).toBeGreaterThan(adminTotal);
    });
  });

  describe("blocked roles — 403", () => {

    it("viewer cannot access audit logs → 403", async () => {
      const org    = await createOrg();
      const viewer = await createUser({ organizationId: org.id, role: "viewer" });

      const token = makeToken({ id: viewer.id, email: viewer.email, role: "viewer", organizationId: org.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(403);
    });

    it("reviewer cannot access audit logs → 403", async () => {
      const org      = await createOrg();
      const reviewer = await createUser({ organizationId: org.id, role: "reviewer" });

      const token = makeToken({ id: reviewer.id, email: reviewer.email, role: "reviewer", organizationId: org.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(403);
    });

    it("unauthenticated request → 401", async () => {
      const res = await api().get("/api/audit-logs");
      expect(res.status).toBe(401);
    });
  });

  describe("allowed roles — org-scoped", () => {

    it("project_manager sees only own org logs", async () => {
      const orgA = await createOrg();
      const orgB = await createOrg();
      const pm   = await createUser({ organizationId: orgA.id, role: "project_manager" });
      const userB = await createUser({ organizationId: orgB.id, role: "viewer" });

      await seedAuditLog({ userId: pm.id,    organizationId: orgA.id });
      await seedAuditLog({ userId: userB.id, organizationId: orgB.id });

      const token = makeToken({ id: pm.id, email: pm.email, role: "project_manager", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      const orgBLogs = res.body.logs.filter((l: any) => l.organizationId === orgB.id);
      expect(orgBLogs.length).toBe(0);
    });

    it("document_controller sees only own org logs", async () => {
      const orgA = await createOrg();
      const orgB = await createOrg();
      const dc   = await createUser({ organizationId: orgA.id, role: "document_controller" });
      const userB = await createUser({ organizationId: orgB.id, role: "viewer" });

      await seedAuditLog({ userId: dc.id,    organizationId: orgA.id });
      await seedAuditLog({ userId: userB.id, organizationId: orgB.id });

      const token = makeToken({ id: dc.id, email: dc.email, role: "document_controller", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      const orgBLogs = res.body.logs.filter((l: any) => l.organizationId === orgB.id);
      expect(orgBLogs.length).toBe(0);
    });
  });

  describe("export endpoints — same org-scoping", () => {

    it("export-xlsx is also org-scoped for admin", async () => {
      const orgA   = await createOrg();
      const orgB   = await createOrg();
      const adminA = await createUser({ organizationId: orgA.id, role: "admin" });
      const userB  = await createUser({ organizationId: orgB.id, role: "viewer" });

      await seedAuditLog({ userId: adminA.id, organizationId: orgA.id });
      await seedAuditLog({ userId: userB.id,  organizationId: orgB.id });

      const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs/export-xlsx").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      // Data array should not include orgB logs
      const orgBEntries = res.body.data?.filter((d: any) => d.organizationId === orgB.id) ?? [];
      expect(orgBEntries.length).toBe(0);
    });
  });

  // ── CSV export — B-7 column projection + filter parity ──────────────────────

  describe("CSV export (/export) — B-7 fixes", () => {

    // Parses the CSV text into an array of objects keyed by the header row.
    function parseCsv(text: string): Record<string, string>[] {
      const lines = text.trim().split("\n");
      const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, ""));
      return lines.slice(1).map(line => {
        const values = line.match(/"(?:[^"]|"")*"/g) ?? [];
        return Object.fromEntries(
          headers.map((h, i) => [h, (values[i] ?? "").replace(/^"|"$/g, "").replace(/""/g, '"')]),
        );
      });
    }

    it("CSV response contains exactly the 7 expected columns — no sensitive fields", async () => {
      const org   = await createOrg();
      const admin = await createUser({ organizationId: org.id, role: "admin" });

      await seedAuditLog({ userId: admin.id, organizationId: org.id });

      const token = makeToken({ id: admin.id, email: admin.email, role: "admin", organizationId: org.id });
      const res = await api().get("/api/audit-logs/export").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
      expect(res.headers["cache-control"]).toBe("no-store");

      const rows = parseCsv(res.text);
      expect(rows.length).toBeGreaterThan(0);

      const columns = Object.keys(rows[0]);
      expect(columns).toEqual(["ID", "Date/Time", "User", "Action", "Entity Type", "Entity Title", "Project ID"]);

      // Explicitly confirm no sensitive user fields leak into the CSV
      for (const col of columns) {
        expect(col.toLowerCase()).not.toContain("password");
        expect(col.toLowerCase()).not.toContain("token");
        expect(col.toLowerCase()).not.toContain("hash");
      }
    });

    it("CSV userId filter — returns only logs for the specified user", async () => {
      const org    = await createOrg();
      const admin  = await createUser({ organizationId: org.id, role: "admin" });
      const other  = await createUser({ organizationId: org.id, role: "member" });

      await seedAuditLog({ userId: admin.id, organizationId: org.id, action: "update" });
      await seedAuditLog({ userId: other.id, organizationId: org.id, action: "create" });

      const token = makeToken({ id: admin.id, email: admin.email, role: "admin", organizationId: org.id });
      const res = await api()
        .get(`/api/audit-logs/export?userId=${other.id}`)
        .set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      const rows = parseCsv(res.text);
      // All rows must be for `other` — the admin's own log must not appear
      for (const row of rows) {
        expect(row["Action"]).toBe("create");
      }
    });

    it("CSV search filter — returns only matching rows", async () => {
      const org   = await createOrg();
      const admin = await createUser({ organizationId: org.id, role: "admin" });
      const db    = getTestDb();

      // Two logs with different entityType values
      await db.insert(auditLogsTable).values([
        { userId: admin.id, organizationId: org.id, action: "update", entityType: "document",      entityId: 1, entityTitle: "Alpha Doc" },
        { userId: admin.id, organizationId: org.id, action: "update", entityType: "correspondence", entityId: 2, entityTitle: "Beta Corr" },
      ]);

      const token = makeToken({ id: admin.id, email: admin.email, role: "admin", organizationId: org.id });
      const res = await api()
        .get("/api/audit-logs/export?search=document")
        .set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      const rows = parseCsv(res.text);
      expect(rows.length).toBeGreaterThan(0);
      // All returned rows must match the search term in one of the searched columns
      for (const row of rows) {
        const matched =
          row["Entity Type"].toLowerCase().includes("document") ||
          row["Action"].toLowerCase().includes("document") ||
          row["Entity Title"].toLowerCase().includes("document");
        expect(matched).toBe(true);
      }
    });

    it("CSV export is org-scoped — does not include other orgs' logs", async () => {
      const orgA   = await createOrg();
      const orgB   = await createOrg();
      const adminA = await createUser({ organizationId: orgA.id, role: "admin" });
      const userB  = await createUser({ organizationId: orgB.id, role: "viewer" });

      await seedAuditLog({ userId: adminA.id, organizationId: orgA.id, action: "login_success" });
      await seedAuditLog({ userId: userB.id,  organizationId: orgB.id, action: "login_success" });

      const token = makeToken({ id: adminA.id, email: adminA.email, role: "admin", organizationId: orgA.id });
      const res = await api().get("/api/audit-logs/export").set({ Authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      // userB's name must not appear in the CSV — it belongs to orgB
      expect(res.text).not.toContain(userB.email);
    });
  });
});

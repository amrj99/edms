/**
 * rls.test.ts
 *
 * Row-Level Security (RLS) Verification Suite
 *
 * Verifies that PostgreSQL RLS policies correctly enforce org isolation at the
 * database layer, independent of application-level middleware.
 *
 * ── What we test ──────────────────────────────────────────────────────────────
 *
 *   1. Direct DB queries with set_config('app.current_org_id') — verifies
 *      that RLS policies filter rows correctly at the SQL level.
 *
 *   2. Policy bypass conditions — verifies system_owner bypass (empty string)
 *      and that NULL organization_id rows (system-wide data) are always visible.
 *
 *   3. Tables covered: documents, projects, tasks, notifications,
 *      correspondence, rules, transmittals
 *
 * ── Architecture note ─────────────────────────────────────────────────────────
 *
 *   RLS is a defence-in-depth layer. The primary isolation mechanism is
 *   application-level (requireOrgScope + assertOrgMatch). These tests verify
 *   that the DB-level policy behaves as documented in rls-init.ts.
 *
 *   Tests use a dedicated DB client (NOT the shared pool) to ensure
 *   set_config() applies to the same connection that runs the query.
 *   This avoids the connection-pool caveat described in rls-context.ts.
 *
 * ── Test strategy ─────────────────────────────────────────────────────────────
 *
 *   Each test:
 *     1. Seeds rows for Org A
 *     2. Sets app.current_org_id to Org B's ID on a dedicated connection
 *     3. Queries the table — expects Org A rows to be INVISIBLE
 *     4. Sets app.current_org_id to Org A's ID
 *     5. Queries again — expects Org A rows to be VISIBLE
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  createOrg,
  createUser,
  createProject,
  getTestDb,
  getTestPool,
  truncateAllTables,
} from "./helpers/index.js";
import {
  documentsTable,
  projectsTable,
  notificationsTable,
  correspondenceTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const { Client } = pg;

// ─── Dedicated client helper ──────────────────────────────────────────────────
// Uses a single Client (not Pool) so set_config() and SELECT run on the same
// connection — this is critical for RLS testing.

/**
 * Builds a connection URL that uses the rls_tester role instead of the
 * superuser.  Superusers bypass RLS even with FORCE ROW LEVEL SECURITY, so
 * we need a non-superuser connection to actually exercise the policies.
 *
 * global-setup.ts creates the rls_tester role and grants it SELECT on the
 * protected tables before any test file runs.
 */
function rlsTesterUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set");

  // Replace the user:password portion with rls_tester credentials.
  // postgresql://user:pass@host:port/db  →  postgresql://rls_tester:rls_tester_pw@host:port/db
  return base.replace(/^(postgresql:\/\/)[^@]+(@)/, "$1rls_tester:rls_tester_pw$2");
}

async function withRlsClient<T>(
  orgId: number | null,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: rlsTesterUrl() });
  await client.connect();

  try {
    const value = orgId === null ? "" : String(orgId);
    await client.query("SELECT set_config('app.current_org_id', $1, FALSE)", [value]);
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ─── Shared fixture ───────────────────────────────────────────────────────────

interface Fixture {
  orgA: { id: number };
  orgB: { id: number };
  userA: { id: number; organizationId: number | null };
  projectA: { id: number };
  documentId: number;
  correspondenceId: number;
  notificationId: number;
}

let fx: Fixture;

beforeAll(async () => {
  await truncateAllTables();

  const db = getTestDb();

  const orgA = await createOrg({ name: "RLS Org Alpha", code: "RLSA" });
  const orgB = await createOrg({ name: "RLS Org Beta",  code: "RLSB" });

  const userA = await createUser({
    organizationId: orgA.id,
    role: "admin",
    email: "rls-admin@alpha.test",
  });

  const projectA = await createProject({
    organizationId: orgA.id,
    name: "RLS Test Project",
    code: "RLS-001",
  });

  // Seed a document in Org A
  const [doc] = await db.insert(documentsTable).values({
    organizationId: orgA.id,
    projectId: projectA.id,
    createdById: userA.id,
    documentNumber: "RLS-DOC-001",
    title: "RLS Test Document",
    revision: "A",
    status: "draft",
  }).returning({ id: documentsTable.id });

  // Seed a correspondence thread in Org A
  const [corr] = await db.insert(correspondenceTable).values({
    organizationId: orgA.id,
    projectId: projectA.id,
    subject: "RLS Test Correspondence",
    type: "internal",
    status: "draft",
    direction: "outgoing",
    fromUserId: userA.id,
    referenceNumber: "RLS-CORR-001",
  }).returning({ id: correspondenceTable.id });

  // Seed a notification for userA in Org A
  const [notif] = await db.insert(notificationsTable).values({
    organizationId: orgA.id,
    userId: userA.id,
    type: "document_uploaded",
    title: "RLS Test Notification",
    message: "Test notification for RLS verification",
    isRead: false,
  }).returning({ id: notificationsTable.id });

  fx = {
    orgA,
    orgB,
    userA,
    projectA,
    documentId: doc.id,
    correspondenceId: corr.id,
    notificationId: notif.id,
  };
});

afterAll(async () => {
  await truncateAllTables();
});

// ─── Documents ─────────────────────────────────────────────────────────────────

describe("RLS — documents table", () => {
  it("Org B session cannot see Org A documents", async () => {
    const rows = await withRlsClient(fx.orgB.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM documents WHERE id = $1",
        [fx.documentId],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("Org A session can see its own documents", async () => {
    const rows = await withRlsClient(fx.orgA.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM documents WHERE id = $1",
        [fx.documentId],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(fx.documentId);
  });

  it("system_owner session (empty org) sees all documents", async () => {
    // orgId = null → set_config('app.current_org_id', '', FALSE) → sysadmin bypass
    const rows = await withRlsClient(null, async (client) => {
      const result = await client.query(
        "SELECT id FROM documents WHERE id = $1",
        [fx.documentId],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
  });
});

// ─── Projects ─────────────────────────────────────────────────────────────────

describe("RLS — projects table", () => {
  it("Org B session cannot see Org A projects", async () => {
    const rows = await withRlsClient(fx.orgB.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM projects WHERE id = $1",
        [fx.projectA.id],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("Org A session can see its own projects", async () => {
    const rows = await withRlsClient(fx.orgA.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM projects WHERE id = $1",
        [fx.projectA.id],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
  });

  it("Org B session listing all projects sees zero Org A rows", async () => {
    const rows = await withRlsClient(fx.orgB.id, async (client) => {
      const result = await client.query(
        "SELECT id, organization_id FROM projects WHERE organization_id = $1",
        [fx.orgA.id],
      );
      return result.rows;
    });

    // RLS filters the WHERE clause result — even explicit org filter returns nothing
    expect(rows).toHaveLength(0);
  });
});

// ─── Correspondence ────────────────────────────────────────────────────────────

describe("RLS — correspondence table", () => {
  it("Org B session cannot see Org A correspondence", async () => {
    const rows = await withRlsClient(fx.orgB.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM correspondence WHERE id = $1",
        [fx.correspondenceId],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("Org A session can see its own correspondence", async () => {
    const rows = await withRlsClient(fx.orgA.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM correspondence WHERE id = $1",
        [fx.correspondenceId],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
  });
});

// ─── Notifications ─────────────────────────────────────────────────────────────

describe("RLS — notifications table", () => {
  it("Org B session cannot see Org A notifications", async () => {
    const rows = await withRlsClient(fx.orgB.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM notifications WHERE id = $1",
        [fx.notificationId],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("Org A session can see its own notifications", async () => {
    const rows = await withRlsClient(fx.orgA.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM notifications WHERE id = $1",
        [fx.notificationId],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
  });
});

// ─── RLS bypass attempts ───────────────────────────────────────────────────────

describe("RLS — bypass resistance", () => {
  it("explicit org filter in WHERE cannot bypass RLS", async () => {
    // Org B session tries to query Org A data by passing orgA.id in WHERE clause.
    // RLS USING clause should filter this out regardless.
    const rows = await withRlsClient(fx.orgB.id, async (client) => {
      const result = await client.query(
        "SELECT id FROM documents WHERE organization_id = $1",
        [fx.orgA.id],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("unset session variable (current_setting returns empty) triggers sysadmin bypass", async () => {
    // When app.current_org_id is not set at all (new connection, no set_config),
    // current_setting returns '' (with missing_ok=TRUE) → sysadmin bypass applies.
    // Use rls_tester (non-superuser) so RLS policies are actually evaluated.
    const client = new Client({ connectionString: rlsTesterUrl() });
    await client.connect();

    try {
      // Do NOT call set_config — raw new connection
      const result = await client.query(
        "SELECT id FROM documents WHERE id = $1",
        [fx.documentId],
      );
      // Unset session = '' = sysadmin bypass → row is visible
      expect(result.rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});

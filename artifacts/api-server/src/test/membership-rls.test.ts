/**
 * membership-rls.test.ts — DEBT-010 Decision B: membership-aware RLS, enforced.
 *
 * ALL assertions run over a REAL connection as the least-privilege runtime role
 * `edms_app` (LOGIN, NOSUPERUSER, NOBYPASSRLS) — NOT a role switch inside a
 * superuser session — so the policies are genuinely enforced. Fixtures are seeded
 * as the owning superuser (getTestDb), then read/written as edms_app with the
 * transaction-local context the app sets (app.current_org_id / current_user_id /
 * is_system_owner) via set_config(..., true) inside a BEGIN/COMMIT.
 *
 * Covers: own-org, unrelated-denied, party (org) access, user-member access,
 * project-X-membership-does-not-open-project-Y, correspondence per-record,
 * transmittal recipient-org, notifications per-user, metadata global, missing
 * context, forged context, org/project anti-move, X-a allowlist, system_owner
 * flag, authority-removal revocation, concurrent A/B no-leak, and the
 * Security-Definer Gate §8 (shadowing) / §9 (revocation) checks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  documentsTable, documentRevisionsTable, documentFilesTable,
  projectsTable, projectPartiesTable, projectMembersTable,
  correspondenceTable, correspondenceRecipientsTable,
  transmittalsTable, ncrRecordsTable, notificationsTable, metadataFieldsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";

const { Client } = pg;

function appUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
  return base.replace(/^(postgresql:\/\/)[^@]+(@)/, "$1edms_app:edms_app_pw$2");
}

type Ctx = { org?: number | null; user?: number | null; sysowner?: boolean };

/** Run `fn` on a fresh edms_app connection inside a tx with the given tenant context. */
async function asApp<T>(ctx: Ctx, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: appUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.is_system_owner', $1, true)", [ctx.sysowner ? "true" : "false"]);
    await c.query("SELECT set_config('app.current_org_id', $1, true)", [ctx.org == null ? "" : String(ctx.org)]);
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.user == null ? "" : String(ctx.user)]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    await c.end();
  }
}

const ids = async (c: pg.Client, sqlText: string, params: unknown[] = []) =>
  (await c.query(sqlText, params)).rows.map((r) => r.id as number);

/** Assert a single statement is DENIED, each on its own connection/tx (a failed
 *  statement aborts only its own tx, so multiple denials don't interfere). */
async function expectDenied(ctx: Ctx, q: string, params: unknown[], re: RegExp): Promise<void> {
  const c = new Client({ connectionString: appUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.is_system_owner', $1, true)", [ctx.sysowner ? "true" : "false"]);
    await c.query("SELECT set_config('app.current_org_id', $1, true)", [ctx.org == null ? "" : String(ctx.org)]);
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.user == null ? "" : String(ctx.user)]);
    await expect(c.query(q, params)).rejects.toThrow(re);
  } finally {
    try { await c.query("ROLLBACK"); } catch { /* ignore */ }
    await c.end();
  }
}

interface Fx {
  orgA: number; orgB: number; orgC: number; orgD: number;
  uA: number; uB: number; uC: number; uD: number;
  p1: number; p2: number;               // p1 = orgA, mode=parties; p2 = orgA, org_only
  d1: number; d2: number;               // d1 in p1, d2 in p2 (both orgA)
  rev1: number; file1: number;          // children of d1
  corr1: number; corr2: number;         // corr1 recipient=uB, corr2 no recipient
  trans1: number;                       // toUserId=uB (recipient org = orgB)
  notif1: number;                       // for uA
  mGlobal: number; mA: number;          // metadata: global (org NULL), orgA
  ncr1: number;                         // register in p1/orgA (org-only)
}
let fx: Fx;

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();

  const orgA = await createOrg({ name: "M Org A", code: "MA" });
  const orgB = await createOrg({ name: "M Org B", code: "MB" });
  const orgC = await createOrg({ name: "M Org C", code: "MC" });
  const orgD = await createOrg({ name: "M Org D", code: "MD" });
  const uA = await createUser({ organizationId: orgA.id, role: "admin", email: "m-a@a.test" });
  const uB = await createUser({ organizationId: orgB.id, role: "admin", email: "m-b@b.test" });
  const uC = await createUser({ organizationId: orgC.id, role: "admin", email: "m-c@c.test" });
  const uD = await createUser({ organizationId: orgD.id, role: "admin", email: "m-d@d.test" });

  const p1 = await createProject({ organizationId: orgA.id, createdById: uA.id, name: "M P1", code: "M-P1" });
  const p2 = await createProject({ organizationId: orgA.id, createdById: uA.id, name: "M P2", code: "M-P2" });
  await db.update(projectsTable).set({ collaborationMode: "parties" }).where(eq(projectsTable.id, p1.id));
  await db.update(projectsTable).set({ collaborationMode: "org_only" }).where(eq(projectsTable.id, p2.id));

  // orgB = active party on p1 (contributor). uD = user-level member of p1 (cross-org member).
  await db.insert(projectPartiesTable).values({ projectId: p1.id, organizationId: orgB.id, partyRole: "contributor", addedById: uA.id });
  await db.insert(projectMembersTable).values({ projectId: p1.id, userId: uD.id, role: "viewer" });

  const mk = async (projectId: number, num: string) => (await db.insert(documentsTable).values({
    organizationId: orgA.id, projectId, createdById: uA.id, documentNumber: num, title: num, revision: "A", status: "draft",
  }).returning({ id: documentsTable.id }))[0].id;
  const d1 = await mk(p1.id, "M-D1");
  const d2 = await mk(p2.id, "M-D2");
  const [rev1] = await db.insert(documentRevisionsTable).values({ organizationId: orgA.id, documentId: d1, revision: "A", status: "draft", createdById: uA.id }).returning({ id: documentRevisionsTable.id });
  const [file1] = await db.insert(documentFilesTable).values({ organizationId: orgA.id, documentId: d1, fileName: "f1.pdf", fileUrl: "s3://x/f1", uploadedById: uA.id }).returning({ id: documentFilesTable.id });

  const [corr1] = await db.insert(correspondenceTable).values({ organizationId: orgA.id, projectId: p1.id, subject: "C1", type: "internal", status: "sent", direction: "outgoing", fromUserId: uA.id, referenceNumber: "M-C1" }).returning({ id: correspondenceTable.id });
  const [corr2] = await db.insert(correspondenceTable).values({ organizationId: orgA.id, projectId: p1.id, subject: "C2", type: "internal", status: "sent", direction: "outgoing", fromUserId: uA.id, referenceNumber: "M-C2" }).returning({ id: correspondenceTable.id });
  await db.insert(correspondenceRecipientsTable).values({ correspondenceId: corr1.id, userId: uB.id }); // uB named on corr1 only

  const [trans1] = await db.insert(transmittalsTable).values({ organizationId: orgA.id, projectId: p1.id, transmittalNumber: "M-T1", subject: "T1", status: "sent", createdById: uA.id, toUserId: uB.id, direction: "outgoing" }).returning({ id: transmittalsTable.id });
  const [notif1] = await db.insert(notificationsTable).values({ organizationId: orgA.id, userId: uA.id, type: "document_uploaded", title: "N1", message: "n1", isRead: false }).returning({ id: notificationsTable.id });
  const [mGlobal] = await db.insert(metadataFieldsTable).values({ organizationId: null, name: "m_global", label: "Global", fieldType: "text" }).returning({ id: metadataFieldsTable.id });
  const [mA] = await db.insert(metadataFieldsTable).values({ organizationId: orgA.id, name: "m_a", label: "A field", fieldType: "text" }).returning({ id: metadataFieldsTable.id });
  const [ncr1] = await db.insert(ncrRecordsTable).values({ organizationId: orgA.id, projectId: p1.id, reportNumber: "M-NCR1", createdById: uA.id, status: "open" }).returning({ id: ncrRecordsTable.id });

  fx = {
    orgA: orgA.id, orgB: orgB.id, orgC: orgC.id, orgD: orgD.id,
    uA: uA.id, uB: uB.id, uC: uC.id, uD: uD.id,
    p1: p1.id, p2: p2.id, d1, d2, rev1: rev1.id, file1: file1.id,
    corr1: corr1.id, corr2: corr2.id, trans1: trans1.id, notif1: notif1.id,
    mGlobal: mGlobal.id, mA: mA.id, ncr1: ncr1.id,
  };
});
afterAll(async () => { await truncateAllTables(); });

describe("Membership-aware RLS — enforced as edms_app (non-super/non-bypassrls)", () => {
  it("own-org sees its own rows", async () => {
    await asApp({ org: fx.orgA, user: fx.uA }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=ANY($1)", [[fx.d1, fx.d2]])).toEqual(expect.arrayContaining([fx.d1, fx.d2]));
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=ANY($1)", [[fx.corr1, fx.corr2]])).toEqual(expect.arrayContaining([fx.corr1, fx.corr2]));
      expect(await ids(c, "SELECT id FROM ncr_records WHERE id=$1", [fx.ncr1])).toEqual([fx.ncr1]);
      expect(await ids(c, "SELECT id FROM metadata_fields WHERE id=ANY($1)", [[fx.mGlobal, fx.mA]])).toEqual(expect.arrayContaining([fx.mGlobal, fx.mA]));
    });
  });

  it("unrelated org sees nothing of another org (except global metadata)", async () => {
    await asApp({ org: fx.orgC, user: fx.uC }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=ANY($1)", [[fx.d1, fx.d2]])).toEqual([]);
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=ANY($1)", [[fx.corr1, fx.corr2]])).toEqual([]);
      expect(await ids(c, "SELECT id FROM transmittals WHERE id=$1", [fx.trans1])).toEqual([]);
      expect(await ids(c, "SELECT id FROM ncr_records WHERE id=$1", [fx.ncr1])).toEqual([]);
      expect(await ids(c, "SELECT id FROM metadata_fields WHERE id=$1", [fx.mA])).toEqual([]);       // other org's field hidden
      expect(await ids(c, "SELECT id FROM metadata_fields WHERE id=$1", [fx.mGlobal])).toEqual([fx.mGlobal]); // global visible
    });
  });

  it("party org (B) sees the shared project's docs + its own recipient/recipient-org rows, but not org-only registers, other correspondence, or non-party projects", async () => {
    await asApp({ org: fx.orgB, user: fx.uB }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d1])).toEqual([fx.d1]);  // party on p1
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d2])).toEqual([]);        // p2 is org_only, not a party
      expect(await ids(c, "SELECT id FROM document_revisions WHERE id=$1", [fx.rev1])).toEqual([fx.rev1]); // inherits d1
      expect(await ids(c, "SELECT id FROM document_files WHERE id=$1", [fx.file1])).toEqual([fx.file1]);
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=$1", [fx.corr1])).toEqual([fx.corr1]); // named recipient
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=$1", [fx.corr2])).toEqual([]);          // NOT a recipient
      expect(await ids(c, "SELECT id FROM transmittals WHERE id=$1", [fx.trans1])).toEqual([fx.trans1]);  // recipient org
      expect(await ids(c, "SELECT id FROM ncr_records WHERE id=$1", [fx.ncr1])).toEqual([]);              // registers org-only
      expect(await ids(c, "SELECT id FROM projects WHERE id=$1", [fx.p1])).toEqual([fx.p1]);              // party sees the project
      expect(await ids(c, "SELECT id FROM projects WHERE id=$1", [fx.p2])).toEqual([]);
    });
  });

  it("user-level member (uD, org D) sees the member project's docs but not org-only registers/correspondence", async () => {
    await asApp({ org: fx.orgD, user: fx.uD }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d1])).toEqual([fx.d1]);  // member of p1
      expect(await ids(c, "SELECT id FROM ncr_records WHERE id=$1", [fx.ncr1])).toEqual([]);    // membership ≠ register access
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=$1", [fx.corr1])).toEqual([]); // not a recipient
    });
  });

  it("project-X membership does not open project-Y (d2 hidden from party/member of p1)", async () => {
    await asApp({ org: fx.orgB, user: fx.uB }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d2])).toEqual([]);
    });
    await asApp({ org: fx.orgD, user: fx.uD }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d2])).toEqual([]);
    });
  });

  it("notifications are per-user", async () => {
    await asApp({ org: fx.orgA, user: fx.uA }, async (c) =>
      expect(await ids(c, "SELECT id FROM notifications WHERE id=$1", [fx.notif1])).toEqual([fx.notif1]));
    await asApp({ org: fx.orgA, user: fx.uB }, async (c) =>   // same context org but different user
      expect(await ids(c, "SELECT id FROM notifications WHERE id=$1", [fx.notif1])).toEqual([]));
  });

  it("missing context ⇒ zero rows + write denied (fail-closed)", async () => {
    await asApp({}, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d1])).toEqual([]);
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=$1", [fx.corr1])).toEqual([]);
      await expect(c.query("INSERT INTO documents (organization_id, project_id, created_by_id, document_number, title, revision, status) VALUES ($1,$2,$3,'X','X','A','draft')", [fx.orgA, fx.p1, fx.uA]))
        .rejects.toThrow(/row-level security|policy/i);
    });
  });

  it("forged user context grants no membership access (party/recipient derive from DB, not GUCs)", async () => {
    // Attacker in org C forges current_user_id to a member (uD) — but org C is not a
    // party and the doc predicate for member checks project_members for uD in the
    // SESSION, which is honored; the real defense is that org C cannot forge a
    // project_members row. Here we prove a forged NON-member user id yields nothing,
    // and that forging user id cannot conjure a correspondence recipient grant.
    await asApp({ org: fx.orgC, user: 777777 }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d1])).toEqual([]);
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=$1", [fx.corr1])).toEqual([]);
      expect(await ids(c, "SELECT id FROM notifications WHERE id=$1", [fx.notif1])).toEqual([]);
    });
  });

  it("anti-move: cross-org party cannot forge organization_id or move a document to an inaccessible project", async () => {
    // forge org_id to own org (B) — WITH CHECK anchors org to the project owner (A)
    await expectDenied({ org: fx.orgB, user: fx.uB }, "UPDATE documents SET organization_id=$1 WHERE id=$2", [fx.orgB, fx.d1], /row-level security|policy/i);
    // move to p2 (org_only, party has no access) — WITH CHECK owner subquery ⇒ NULL ⇒ denied
    await expectDenied({ org: fx.orgB, user: fx.uB }, "UPDATE documents SET project_id=$1 WHERE id=$2", [fx.p2, fx.d1], /row-level security|policy/i);
  });

  it("X-a allowlist: cross-org recipient may mark-read but not change other columns", async () => {
    // uB is a recipient of corr1 (org A row). Allowed: is_read/first_read_at/updated_at.
    await asApp({ org: fx.orgB, user: fx.uB }, (c) =>
      c.query("UPDATE correspondence SET is_read=true, first_read_at=now(), updated_at=now() WHERE id=$1", [fx.corr1]));
    // Denied: changing subject (outside allowlist) OR organization_id (X-a trigger).
    await expectDenied({ org: fx.orgB, user: fx.uB }, "UPDATE correspondence SET subject='hijack' WHERE id=$1", [fx.corr1], /X-a|only|row-level|policy/i);
    await expectDenied({ org: fx.orgB, user: fx.uB }, "UPDATE correspondence SET organization_id=$1 WHERE id=$2", [fx.orgB, fx.corr1], /X-a|only|row-level|policy/i);
    // Transmittal recipient org may acknowledge (status) but not change subject.
    await asApp({ org: fx.orgB, user: fx.uB }, (c) =>
      c.query("UPDATE transmittals SET status='acknowledged', acknowledged_at=now(), updated_at=now() WHERE id=$1", [fx.trans1]));
    await expectDenied({ org: fx.orgB, user: fx.uB }, "UPDATE transmittals SET subject='hijack' WHERE id=$1", [fx.trans1], /X-a|only|row-level|policy/i);
  });

  it("system_owner flag opens global scope; a tenant session does not", async () => {
    await asApp({ sysowner: true }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=ANY($1)", [[fx.d1, fx.d2]])).toEqual(expect.arrayContaining([fx.d1, fx.d2]));
      expect(await ids(c, "SELECT id FROM ncr_records WHERE id=$1", [fx.ncr1])).toEqual([fx.ncr1]);
    });
    await asApp({ org: fx.orgB, user: fx.uB }, async (c) =>
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d2])).toEqual([]));
  });

  it("§9 removal of authority relation revokes access in the very next statement", async () => {
    // Party removal
    await asApp({ org: fx.orgB, user: fx.uB }, async (c) =>
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d1])).toEqual([fx.d1]));
    await getTestDb().update(projectPartiesTable).set({ removedAt: new Date() }).where(eq(projectPartiesTable.projectId, fx.p1));
    await asApp({ org: fx.orgB, user: fx.uB }, async (c) => {
      expect(await ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d1])).toEqual([]);       // party gone
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=$1", [fx.corr1])).toEqual([fx.corr1]); // still a recipient
    });
    // Recipient removal
    await getTestDb().delete(correspondenceRecipientsTable).where(eq(correspondenceRecipientsTable.correspondenceId, fx.corr1));
    await asApp({ org: fx.orgB, user: fx.uB }, async (c) =>
      expect(await ids(c, "SELECT id FROM correspondence WHERE id=$1", [fx.corr1])).toEqual([]));
    // restore party for other tests' independence (afterAll truncates anyway)
    await getTestDb().update(projectPartiesTable).set({ removedAt: null }).where(eq(projectPartiesTable.projectId, fx.p1));
  });

  it("concurrent tenant A/B do not leak (each sees only its own scope)", async () => {
    const [a, b] = await Promise.all([
      asApp({ org: fx.orgA, user: fx.uA }, async (c) => { await new Promise(r => setTimeout(r, 50)); return ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d2]); }),
      asApp({ org: fx.orgC, user: fx.uC }, async (c) => { await new Promise(r => setTimeout(r, 20)); return ids(c, "SELECT id FROM documents WHERE id=$1", [fx.d2]); }),
    ]);
    expect(a).toEqual([fx.d2]); // org A owns d2
    expect(b).toEqual([]);      // org C sees nothing
  });

  it("§8 object shadowing is impossible: edms_app has no CREATE on public/app", async () => {
    // Each DDL in its OWN connection — a failing statement aborts only its own tx.
    const denied = async (q: string) => {
      const c = new Client({ connectionString: appUrl() });
      await c.connect();
      try { await expect(c.query(q)).rejects.toThrow(/permission denied|must be owner/i); }
      finally { await c.end(); }
    };
    await denied("CREATE TABLE public.project_parties_shadow (x int)");
    await denied("CREATE VIEW public.zzz_shadow AS SELECT 1");
    await denied("CREATE FUNCTION app.evil() RETURNS int LANGUAGE sql AS 'SELECT 1'");
  });

  it("§8 definer functions are search_path-pinned (drift guard)", async () => {
    await asApp({ org: fx.orgA, user: fx.uA }, async (c) => {
      const r = await c.query(`SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app'`);
      expect(r.rows.length).toBeGreaterThan(0);
      for (const row of r.rows) {
        const cfgs: string[] = row.proconfig ?? [];
        expect(cfgs.some((cfg) => cfg.startsWith("search_path="))).toBe(true);
      }
    });
  });
});

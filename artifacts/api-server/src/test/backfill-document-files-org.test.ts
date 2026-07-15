/**
 * backfill-document-files-org.test.ts — Migration 0032 (data-only) + rollback contract
 *
 * Proves migration 0032_backfill_document_files_org_id.sql:
 *   • touches CLASS B1 ONLY (file_org NULL AND doc_org = project_owner) → project owner;
 *   • leaves B2 / B3 / C / D / E untouched; idempotent; no other column changed;
 *   • the unresolved-report query classifies B2/B3/D/E with the required columns.
 *
 * And proves the AUDITABLE, FAIL-CLOSED rollback contract
 * (rollback_0032_*.sql):
 *   • the pre-image artifact contains B1 ONLY, with the auditable columns
 *     (previous/target org, doc/project lineage, capture time, DB identity);
 *   • rollback reverts B1 only and is idempotent;
 *   • rollback REFUSES to overwrite a row that changed after the migration
 *     (current org != the target 0032 set) — it never clobbers a newer value.
 *
 * Executes the ACTUAL forward .sql from disk. The rollback's core fail-closed
 * UPDATE is exercised against the same artifact schema the script uses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sql, eq } from "drizzle-orm";
import { createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";
import { documentsTable, documentFilesTable, projectsTable } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.resolve(__dirname, "../../../../lib/db/drizzle/0032_backfill_document_files_org_id.sql"),
  "utf8",
);

// B1 capture — identical to the set 0032 changes.
const B1_CAPTURE = `
  SELECT df.id FROM document_files df
  JOIN documents d ON d.id = df.document_id
  JOIN projects  p ON p.id = d.project_id
  WHERE df.organization_id IS NULL AND d.organization_id = p.organization_id`;

// The AUDITABLE pre-image artifact — captured BEFORE apply, drives the rollback.
const ARTIFACT_CAPTURE = `
  INSERT INTO bf_artifact
  SELECT df.id, df.organization_id, p.organization_id, d.id, d.project_id,
         now(), current_database(), (SELECT system_identifier FROM pg_control_system())::text
  FROM document_files df
  JOIN documents d ON d.id = df.document_id
  JOIN projects  p ON p.id = d.project_id
  WHERE df.organization_id IS NULL AND d.organization_id = p.organization_id`;

// The rollback's core FAIL-CLOSED revert (identical predicate to rollback_0032_*.sql).
const ROLLBACK_CORE = `
  UPDATE document_files df
  SET organization_id = a.previous_organization_id
  FROM bf_artifact a
  WHERE df.id = a.file_id
    AND df.organization_id = a.target_organization_id`;

interface Ids {
  ownerOrg: number; foreignOrg: number;
  b1: number; b2: number; b3: number; c: number; d: number; e: number;
  docDrift: number; projectId: number;
}
let ix: Ids;

async function fileOrg(id: number): Promise<number | null> {
  const [r] = await getTestDb().select({ o: documentFilesTable.organizationId }).from(documentFilesTable).where(eq(documentFilesTable.id, id));
  return r.o ?? null;
}
async function run(text: string): Promise<number> {
  const res: any = await getTestDb().execute(sql.raw(text));
  return res.rowCount ?? 0;
}
const runMigration = () => run(MIGRATION_SQL);
const runRollback  = () => run(ROLLBACK_CORE);
async function divergedIds(): Promise<number[]> {
  const r: any = await getTestDb().execute(sql.raw(`
    SELECT a.file_id FROM bf_artifact a JOIN document_files df ON df.id = a.file_id
    WHERE df.organization_id IS DISTINCT FROM a.target_organization_id ORDER BY a.file_id`));
  return r.rows.map((x: any) => Number(x.file_id));
}

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  await db.execute(sql.raw(`DROP TABLE IF EXISTS bf_artifact`));
  await db.execute(sql.raw(`CREATE TABLE bf_artifact (
    file_id integer PRIMARY KEY, previous_organization_id integer, target_organization_id integer NOT NULL,
    document_id integer, project_id integer, captured_at timestamptz, database_name text, db_system_identifier text)`));

  const ownerOrg = await createOrg({ name: "Owner Org", code: "BF-OWN" });
  const foreignOrg = await createOrg({ name: "Foreign Org", code: "BF-FRN" });
  const admin = await createUser({ organizationId: ownerOrg.id, role: "admin", email: "admin@bf.test" });
  const project = await createProject({ organizationId: ownerOrg.id, createdById: admin.id, name: "BF Proj", code: "BF-001" });

  const mkDoc = async (num: string, org: number | null) => {
    const [doc] = await db.insert(documentsTable).values({
      organizationId: org, projectId: project.id, createdById: admin.id,
      documentNumber: num, title: `Doc ${num}`, revision: "A", status: "draft",
    }).returning();
    return doc.id;
  };
  const docMatch = await mkDoc("BF-MATCH", ownerOrg.id);
  const docNull  = await mkDoc("BF-NULL", null);
  const docDrift = await mkDoc("BF-DRIFT", foreignOrg.id);

  const mkFile = async (docId: number, org: number | null, name: string) => {
    const [f] = await db.insert(documentFilesTable).values({
      documentId: docId, organizationId: org, fileName: name,
      fileUrl: `/api/storage/onpremise/${org ?? 0}/${project.id}/document/${name}`,
      fileSize: 100, fileType: "application/pdf", uploadedById: admin.id, sha256: `sha-${name}`,
    }).returning();
    return f.id;
  };
  ix = {
    ownerOrg: ownerOrg.id, foreignOrg: foreignOrg.id, projectId: project.id, docDrift,
    b1: await mkFile(docMatch, null, "b1.pdf"),
    b2: await mkFile(docNull,  null, "b2.pdf"),
    b3: await mkFile(docDrift, null, "b3.pdf"),
    c:  await mkFile(docMatch, ownerOrg.id, "c.pdf"),
    d:  await mkFile(docMatch, foreignOrg.id, "d.pdf"),
    e:  await mkFile(docDrift, ownerOrg.id, "e.pdf"),
  };

  // Capture the auditable pre-image BEFORE any apply (B1 still NULL).
  await db.execute(sql.raw(ARTIFACT_CAPTURE));
});
afterAll(async () => {
  await getTestDb().execute(sql.raw(`DROP TABLE IF EXISTS bf_artifact`));
  await truncateAllTables();
});

describe("Migration 0032 — forward (B1 only)", () => {
  it("pre-image capture returns EXACTLY the B1 row before apply", async () => {
    const r: any = await getTestDb().execute(sql.raw(B1_CAPTURE));
    expect(r.rows.map((x: any) => Number(x.id))).toEqual([ix.b1]);
  });

  it("applies to B1 only: B1 → owner; B2/B3/C/D/E unchanged; exactly 1 row changed", async () => {
    expect(await runMigration()).toBe(1);
    expect(await fileOrg(ix.b1)).toBe(ix.ownerOrg);
    expect(await fileOrg(ix.b2)).toBeNull();
    expect(await fileOrg(ix.b3)).toBeNull();
    expect(await fileOrg(ix.c)).toBe(ix.ownerOrg);
    expect(await fileOrg(ix.d)).toBe(ix.foreignOrg);
    expect(await fileOrg(ix.e)).toBe(ix.ownerOrg);
  });

  it("B1 sourced from PROJECT OWNER; all other columns intact", async () => {
    const [row] = await getTestDb().select().from(documentFilesTable).where(eq(documentFilesTable.id, ix.b1));
    const [proj] = await getTestDb().select({ o: projectsTable.organizationId }).from(projectsTable).where(eq(projectsTable.id, ix.projectId));
    expect(row.organizationId).toBe(proj.o);
    expect(row.fileName).toBe("b1.pdf");
    expect(row.fileUrl).toBe(`/api/storage/onpremise/0/${ix.projectId}/document/b1.pdf`);
    expect(row.fileSize).toBe(100);
    expect(row.sha256).toBe("sha-b1.pdf");
    expect(row.deletedAt).toBeNull();
  });

  it("is idempotent: a second apply changes 0 rows", async () => {
    expect(await runMigration()).toBe(0);
    expect(await fileOrg(ix.b1)).toBe(ix.ownerOrg);
  });

  it("unresolved-report (B2/B3/D/E) exposes required columns and rows", async () => {
    const REPORT = `
      SELECT df.id AS file_id, df.document_id, d.project_id,
             df.organization_id AS file_org, d.organization_id AS doc_org,
             p.organization_id  AS project_owner_org, df.uploaded_by_id AS uploader,
             CASE WHEN df.file_url LIKE '/api/storage/s3-object/%' THEN 's3'
                  WHEN df.file_url LIKE '/api/storage/r2-object/%' THEN 'r2'
                  WHEN df.file_url LIKE '/api/storage/onpremise/%' THEN 'onpremise'
                  WHEN df.file_url LIKE '/api/storage/objects/%'   THEN 'cloud' ELSE 'unknown' END AS storage_mode,
             CASE WHEN df.organization_id IS NULL AND d.organization_id IS NULL THEN 'B2'
                  WHEN df.organization_id IS NULL AND d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id THEN 'B3'
                  WHEN df.organization_id IS NOT NULL AND df.organization_id <> p.organization_id THEN 'D'
                  WHEN d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id THEN 'E' ELSE 'ok' END AS klass
      FROM document_files df JOIN documents d ON d.id = df.document_id JOIN projects p ON p.id = d.project_id
      WHERE (df.organization_id IS NULL AND d.organization_id IS NULL)
         OR (df.organization_id IS NULL AND d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id)
         OR (df.organization_id IS NOT NULL AND df.organization_id <> p.organization_id)
         OR (d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id)
      ORDER BY file_id`;
    const r: any = await getTestDb().execute(sql.raw(REPORT));
    const byId: Record<number, any> = Object.fromEntries(r.rows.map((x: any) => [Number(x.file_id), x]));
    expect(Object.keys(byId).map(Number).sort((a, b) => a - b)).toEqual([ix.b2, ix.b3, ix.d, ix.e].sort((a, b) => a - b));
    expect(byId[ix.b2].klass).toBe("B2");
    expect(byId[ix.b3].klass).toBe("B3");
    expect(byId[ix.d].klass).toBe("D");
    expect(byId[ix.e].klass).toBe("E");
    expect(Number(byId[ix.d].project_owner_org)).toBe(ix.ownerOrg);
    expect(Number(byId[ix.d].file_org)).toBe(ix.foreignOrg);
    expect(byId[ix.b2].storage_mode).toBe("onpremise");
    expect(Number(byId[ix.e].uploader)).toBeGreaterThan(0);
  });
});

describe("Migration 0032 — rollback contract (auditable, fail-closed)", () => {
  it("artifact contains B1 ONLY, with auditable columns + matching DB identity", async () => {
    const r: any = await getTestDb().execute(sql.raw(`SELECT * FROM bf_artifact ORDER BY file_id`));
    expect(r.rows.map((x: any) => Number(x.file_id))).toEqual([ix.b1]); // excludes B2/B3/D/E/C
    const a = r.rows[0];
    expect(a.previous_organization_id).toBeNull();                 // B1 was NULL
    expect(Number(a.target_organization_id)).toBe(ix.ownerOrg);    // → project owner
    expect(Number(a.document_id)).toBeGreaterThan(0);
    expect(Number(a.project_id)).toBe(ix.projectId);
    expect(a.captured_at).toBeTruthy();
    // DB identity binds the artifact to THIS cluster (rollback aborts on mismatch).
    const live: any = await getTestDb().execute(sql.raw(`SELECT current_database() AS db, (SELECT system_identifier FROM pg_control_system())::text AS sid`));
    expect(a.database_name).toBe(live.rows[0].db);
    expect(a.db_system_identifier).toBe(live.rows[0].sid);
  });

  it("rollback reverts B1 ONLY (B2/B3/C/D/E untouched)", async () => {
    // State entering here: B1 = owner (from forward apply above).
    expect(await fileOrg(ix.b1)).toBe(ix.ownerOrg);
    expect(await runRollback()).toBe(1);
    expect(await fileOrg(ix.b1)).toBeNull();          // reverted to previous (NULL)
    expect(await fileOrg(ix.b2)).toBeNull();
    expect(await fileOrg(ix.b3)).toBeNull();
    expect(await fileOrg(ix.c)).toBe(ix.ownerOrg);
    expect(await fileOrg(ix.d)).toBe(ix.foreignOrg);
    expect(await fileOrg(ix.e)).toBe(ix.ownerOrg);
  });

  it("rollback is idempotent (second run changes 0 rows)", async () => {
    expect(await runRollback()).toBe(0);
    expect(await fileOrg(ix.b1)).toBeNull();
  });

  it("rollback REFUSES to overwrite a value changed after the migration (fail-closed)", async () => {
    // Re-apply 0032 (B1 NULL → owner), then simulate a LEGITIMATE later edit.
    expect(await runMigration()).toBe(1);
    expect(await fileOrg(ix.b1)).toBe(ix.ownerOrg);
    await getTestDb().update(documentFilesTable).set({ organizationId: ix.foreignOrg }).where(eq(documentFilesTable.id, ix.b1));

    // current (foreign) != target (owner) → guard skips it; the newer value survives.
    expect(await runRollback()).toBe(0);
    expect(await fileOrg(ix.b1)).toBe(ix.foreignOrg);      // NOT clobbered
    expect(await divergedIds()).toEqual([ix.b1]);          // reported as diverged
  });
});

/**
 * backfill-document-files-org.test.ts — Migration 0032 (data-only)
 *
 * Proves migration 0032_backfill_document_files_org_id.sql:
 *   • touches CLASS B1 ONLY (file_org NULL AND doc_org = project_owner) and sets
 *     it to the project owner org;
 *   • leaves B2 / B3 / C / D / E untouched;
 *   • is idempotent (a second run changes 0 rows);
 *   • never touches any other column (file_url/file_name/file_size/sha256);
 *   • and that the classification / unresolved-report queries return the right
 *     rows with the required columns.
 *
 * The test executes the ACTUAL .sql file from lib/db/drizzle (not a re-typed
 * copy), so the migration shipped to production is exactly what is verified.
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

// The pre-image / B1 capture query (identical to the set 0032 changes).
const B1_CAPTURE = `
  SELECT df.id FROM document_files df
  JOIN documents d ON d.id = df.document_id
  JOIN projects  p ON p.id = d.project_id
  WHERE df.organization_id IS NULL AND d.organization_id = p.organization_id`;

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
async function runMigration(): Promise<number> {
  const res: any = await getTestDb().execute(sql.raw(MIGRATION_SQL));
  return res.rowCount ?? 0;
}
async function b1Remaining(): Promise<number> {
  const r: any = await getTestDb().execute(sql.raw(`SELECT count(*)::int AS c FROM (${B1_CAPTURE}) q`));
  return Number(r.rows[0].c);
}

beforeAll(async () => {
  await truncateAllTables();
  const db = getTestDb();
  const ownerOrg = await createOrg({ name: "Owner Org", code: "BF-OWN" });
  const foreignOrg = await createOrg({ name: "Foreign Org", code: "BF-FRN" });
  const admin = await createUser({ organizationId: ownerOrg.id, role: "admin", email: "admin@bf.test" });
  // Project owner = ownerOrg (projects.organization_id is NOT NULL — the source of truth).
  const project = await createProject({ organizationId: ownerOrg.id, createdById: admin.id, name: "BF Proj", code: "BF-001" });

  const mkDoc = async (num: string, org: number | null) => {
    const [doc] = await db.insert(documentsTable).values({
      organizationId: org, projectId: project.id, createdById: admin.id,
      documentNumber: num, title: `Doc ${num}`, revision: "A", status: "draft",
    }).returning();
    return doc.id;
  };
  const docMatch = await mkDoc("BF-MATCH", ownerOrg.id);  // doc_org == owner
  const docNull  = await mkDoc("BF-NULL", null);          // doc_org NULL
  const docDrift = await mkDoc("BF-DRIFT", foreignOrg.id); // doc_org <> owner (drift)

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
    b1: await mkFile(docMatch, null, "b1.pdf"),          // NULL + doc==owner  → BACKFILL
    b2: await mkFile(docNull,  null, "b2.pdf"),           // NULL + doc NULL    → leave
    b3: await mkFile(docDrift, null, "b3.pdf"),           // NULL + doc drift   → leave
    c:  await mkFile(docMatch, ownerOrg.id, "c.pdf"),     // already owner      → leave
    d:  await mkFile(docMatch, foreignOrg.id, "d.pdf"),   // mismatch vs owner  → leave
    e:  await mkFile(docDrift, ownerOrg.id, "e.pdf"),     // file ok, doc drifts→ leave (E report)
  };
});
afterAll(async () => { await truncateAllTables(); });

describe("Migration 0032 — Backfill document_files.organization_id (B1 only)", () => {
  it("pre-image capture returns EXACTLY the B1 row before apply", async () => {
    const r: any = await getTestDb().execute(sql.raw(B1_CAPTURE));
    expect(r.rows.map((x: any) => Number(x.id))).toEqual([ix.b1]);
  });

  it("applies to B1 only: B1 → owner org; B2/B3/C/D/E unchanged; exactly 1 row changed", async () => {
    const rowCount = await runMigration();
    expect(rowCount).toBe(1);                       // only B1

    expect(await fileOrg(ix.b1)).toBe(ix.ownerOrg); // backfilled to project owner
    expect(await fileOrg(ix.b2)).toBeNull();        // untouched (doc lacks org)
    expect(await fileOrg(ix.b3)).toBeNull();        // untouched (doc drift)
    expect(await fileOrg(ix.c)).toBe(ix.ownerOrg);  // was already owner
    expect(await fileOrg(ix.d)).toBe(ix.foreignOrg);// mismatch preserved (repair later)
    expect(await fileOrg(ix.e)).toBe(ix.ownerOrg);  // file ok; doc-drift is E-report only
  });

  it("B1 backfill sourced from PROJECT OWNER and left all other columns intact", async () => {
    const [row] = await getTestDb().select().from(documentFilesTable).where(eq(documentFilesTable.id, ix.b1));
    const [proj] = await getTestDb().select({ o: projectsTable.organizationId }).from(projectsTable).where(eq(projectsTable.id, ix.projectId));
    expect(row.organizationId).toBe(proj.o);        // == project owner org
    expect(row.fileName).toBe("b1.pdf");            // unchanged
    expect(row.fileUrl).toBe(`/api/storage/onpremise/0/${ix.projectId}/document/b1.pdf`);
    expect(row.fileSize).toBe(100);
    expect(row.sha256).toBe("sha-b1.pdf");          // unchanged
    expect(row.deletedAt).toBeNull();
  });

  it("is idempotent: a second apply changes 0 rows", async () => {
    expect(await b1Remaining()).toBe(0);            // nothing left to backfill
    const rowCount = await runMigration();
    expect(rowCount).toBe(0);
    expect(await fileOrg(ix.b1)).toBe(ix.ownerOrg); // still correct
    expect(await fileOrg(ix.b2)).toBeNull();
  });

  it("unresolved-report (B2/B3/D/E) query exposes the required columns and rows", async () => {
    // The report the reviewer gets for the deferred / incident classes.
    const REPORT = `
      SELECT df.id AS file_id, df.document_id, d.project_id,
             df.organization_id AS file_org, d.organization_id AS doc_org,
             p.organization_id  AS project_owner_org, df.uploaded_by_id AS uploader,
             CASE
               WHEN df.file_url LIKE '/api/storage/s3-object/%'  THEN 's3'
               WHEN df.file_url LIKE '/api/storage/r2-object/%'  THEN 'r2'
               WHEN df.file_url LIKE '/api/storage/onpremise/%'  THEN 'onpremise'
               WHEN df.file_url LIKE '/api/storage/objects/%'    THEN 'cloud'
               ELSE 'unknown' END AS storage_mode,
             CASE
               WHEN df.organization_id IS NULL AND d.organization_id IS NULL                                  THEN 'B2'
               WHEN df.organization_id IS NULL AND d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id THEN 'B3'
               WHEN df.organization_id IS NOT NULL AND df.organization_id <> p.organization_id                THEN 'D'
               WHEN d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id                  THEN 'E'
               ELSE 'ok' END AS klass
      FROM document_files df
      JOIN documents d ON d.id = df.document_id
      JOIN projects  p ON p.id = d.project_id
      WHERE (df.organization_id IS NULL AND d.organization_id IS NULL)
         OR (df.organization_id IS NULL AND d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id)
         OR (df.organization_id IS NOT NULL AND df.organization_id <> p.organization_id)
         OR (d.organization_id IS NOT NULL AND d.organization_id <> p.organization_id)
      ORDER BY file_id`;
    const r: any = await getTestDb().execute(sql.raw(REPORT));
    const byId: Record<number, any> = Object.fromEntries(r.rows.map((x: any) => [Number(x.file_id), x]));

    // B2, B3, D, and E(file under drifting doc) are all reported; B1/C are not.
    expect(Object.keys(byId).map(Number).sort((a, b) => a - b)).toEqual([ix.b2, ix.b3, ix.d, ix.e].sort((a, b) => a - b));
    expect(byId[ix.b2].klass).toBe("B2");
    expect(byId[ix.b3].klass).toBe("B3");
    expect(byId[ix.d].klass).toBe("D");
    expect(byId[ix.e].klass).toBe("E");
    // Required columns present + correct source-of-truth values.
    expect(Number(byId[ix.d].project_owner_org)).toBe(ix.ownerOrg);
    expect(Number(byId[ix.d].file_org)).toBe(ix.foreignOrg);
    expect(byId[ix.b2].storage_mode).toBe("onpremise");
    expect(Number(byId[ix.e].uploader)).toBeGreaterThan(0);
  });
});

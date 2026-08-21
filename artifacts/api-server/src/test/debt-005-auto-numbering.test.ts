/**
 * debt-005-auto-numbering.test.ts
 *
 * DEBT-005 regression: automatic document numbering must work.
 *
 * Root cause (production): the `document_sequences` unique constraint
 * `doc_seq_scope_unique` (project_id, organization_id, discipline, doc_type) was
 * missing on a DB whose 0000_init had been *baselined* (marked applied without
 * running). Document create resolves its number via an
 *   INSERT ... ON CONFLICT (project_id, organization_id, discipline, doc_type) DO UPDATE
 * upsert (documents.ts ~399). Without a unique/exclusion constraint matching that
 * ON CONFLICT target, PostgreSQL raises 42P10 → the create returns HTTP 500.
 * Migration 0034 repairs this idempotently.
 *
 * This test pins, on a clean schema:
 *   1. the constraint exists and is UNIQUE on exactly the scope columns;
 *   2. the ON CONFLICT auto-numbering path (numbering format containing {SEQ},
 *      no explicit documentNumber) returns 201 and increments per scope;
 *   3. a different scope (different discipline) uses its own counter.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { api, authHeader, createOrg, createUser, createProject, getTestDb, truncateAllTables } from "./helpers/index.js";
import { orgConfigTable } from "@workspace/db";

/** Rows in document_sequences for a given discipline scope (disciplines are stored lower-cased). */
async function seqRowsForDiscipline(projectId: number, orgId: number, discipline: string): Promise<number> {
  const r: any = await getTestDb().execute(sql`
    SELECT COUNT(*)::int AS c FROM document_sequences
    WHERE project_id = ${projectId} AND organization_id = ${orgId} AND discipline = ${discipline.toLowerCase()}`);
  return Number(r.rows[0].c);
}

interface Fx { org: { id: number }; admin: { id: number }; project: { id: number }; }
let fx: Fx;
const P = () => `/api/projects/${fx.project.id}/documents`;
const asAdmin = () => authHeader("admin", fx.admin.id, fx.org.id, "admin@debt005.test");

/** Trailing sequence integer from a resolved document number like "PRJ-ARC-002". */
function seqOf(documentNumber: string): number {
  const m = documentNumber.match(/(\d+)\s*$/);
  if (!m) throw new Error(`no trailing sequence in "${documentNumber}"`);
  return parseInt(m[1], 10);
}

beforeAll(async () => {
  await truncateAllTables();
  const org = await createOrg({ name: "Debt005 Org", code: "D005" });
  const admin = await createUser({ organizationId: org.id, role: "admin", email: "admin@debt005.test" });
  const project = await createProject({ organizationId: org.id, createdById: admin.id, name: "Debt005 Proj", code: "D005-001" });
  // Numbering format with {SEQ} → forces the ON CONFLICT sequence upsert path (the DEBT-005 path).
  await getTestDb().insert(orgConfigTable).values({
    organizationId: org.id, documentNumberingFormat: "{PROJECT}-{DISCIPLINE}-{SEQ}",
  });
  fx = { org, admin, project };
});
afterAll(async () => { await truncateAllTables(); });

describe("DEBT-005 — document_sequences unique constraint present on a clean schema", () => {
  it("doc_seq_scope_unique exists and is UNIQUE on (project_id, organization_id, discipline, doc_type)", async () => {
    const r: any = await getTestDb().execute(sql`
      SELECT contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conname = 'doc_seq_scope_unique'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].contype).toBe("u"); // unique
    const def = String(r.rows[0].def).toLowerCase();
    for (const col of ["project_id", "organization_id", "discipline", "doc_type"]) {
      expect(def).toContain(col);
    }
  });
});

describe("DEBT-005 — auto-numbering (ON CONFLICT upsert) works", () => {
  it("two creates in the same scope → 201 each, sequence increments", async () => {
    const mk = () => api().post(P()).set(asAdmin()).send({ title: "Auto A", discipline: "ARC", documentType: "DWG", direction: "outgoing" });

    const r1 = await mk();
    expect(r1.status, JSON.stringify(r1.body).slice(0, 200)).toBe(201);
    const r2 = await mk();
    expect(r2.status, JSON.stringify(r2.body).slice(0, 200)).toBe(201);

    const n1 = r1.body.documentNumber as string;
    const n2 = r2.body.documentNumber as string;
    expect(n1).toBeTruthy();
    expect(n2).toBeTruthy();
    expect(n1).not.toBe(n2);
    expect(seqOf(n2)).toBe(seqOf(n1) + 1); // monotonic within the scope
  });

  it("a different discipline scope uses its own counter (resets)", async () => {
    const r = await api().post(P()).set(asAdmin())
      .send({ title: "Auto B", discipline: "STR", documentType: "DWG", direction: "outgoing" });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(seqOf(r.body.documentNumber as string)).toBe(1); // first in the STR/DWG scope
  });
});

/**
 * Product Contract — automatic AND manual numbering must BOTH work. The DEBT-005
 * repair must not make automatic numbering mandatory nor remove the manual path.
 *   1. documentNumber omitted/empty  → system auto-generates → 201
 *   2. documentNumber supplied        → stored verbatim (never replaced) → 201,
 *      and NO auto sequence is consumed for that scope.
 */
describe("Document Numbering Product Contract — manual vs automatic", () => {
  it("omitted documentNumber → auto-generated → 201", async () => {
    const r = await api().post(P()).set(asAdmin())
      .send({ title: "Contract auto", discipline: "ELE", documentType: "DWG", direction: "outgoing" });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(r.body.documentNumber).toBeTruthy();
    expect(seqOf(r.body.documentNumber as string)).toBe(1); // first in ELE/DWG
  });

  it("empty-string documentNumber is treated as omitted → auto-generated → 201", async () => {
    const r = await api().post(P()).set(asAdmin())
      .send({ documentNumber: "", title: "Contract empty", discipline: "MEC", documentType: "DWG", direction: "outgoing" });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(r.body.documentNumber).toBeTruthy();
    expect(r.body.documentNumber).not.toBe("");
    expect(seqOf(r.body.documentNumber as string)).toBe(1); // auto path ran for MEC/DWG
  });

  it("explicit documentNumber is stored verbatim (never replaced) → 201", async () => {
    const explicit = "CLIENT-REF-2026-XYZ-042";
    const r = await api().post(P()).set(asAdmin())
      .send({ documentNumber: explicit, title: "Contract manual", discipline: "MANONLY", documentType: "DWG", direction: "outgoing" });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(r.body.documentNumber).toBe(explicit); // exactly what the user typed
  });

  it("manual create does NOT consume the auto sequence counter for its scope", async () => {
    const disc = "NOCONSUME";
    // Precondition: no sequence row for this fresh scope.
    expect(await seqRowsForDiscipline(fx.project.id, fx.org.id, disc)).toBe(0);

    // Two manual creates in that scope.
    for (const n of ["MAN-A-001", "MAN-A-002"]) {
      const r = await api().post(P()).set(asAdmin())
        .send({ documentNumber: n, title: `manual ${n}`, discipline: disc, documentType: "DWG", direction: "outgoing" });
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
      expect(r.body.documentNumber).toBe(n);
    }

    // The ON CONFLICT sequence upsert must NOT have run → still no row for this scope.
    expect(await seqRowsForDiscipline(fx.project.id, fx.org.id, disc)).toBe(0);
  });
});

/**
 * seed-document-types.ts
 *
 * Idempotent seeder for `document_types`, run once per organisation.
 * Populates document_types from two legacy sources:
 *   - distinct, non-empty `documents.document_type` values already in use
 *   - `org_config.document_types` (jsonb array of suggested type names)
 *
 * Candidates are grouped by `normalizeDocTypeCode()` so that values differing
 * only in case/whitespace (e.g. "Drawing" / "drawing ") collapse into a single
 * document_types row. Safe to run on every deploy — existing rows
 * (organizationId, code) are never overwritten.
 *
 * Usage:
 *   node --enable-source-maps /app/artifacts/api-server/dist/seed-document-types.mjs
 */

import { db } from "@workspace/db";
import { organizationsTable, documentsTable, orgConfigTable, documentTypesTable, normalizeDocTypeCode } from "@workspace/db";
import { eq, and, isNotNull, ne } from "drizzle-orm";

async function seedDocumentTypes() {
  const orgs = await db.select({ id: organizationsTable.id, name: organizationsTable.name })
    .from(organizationsTable);

  if (orgs.length === 0) {
    console.log("[seed-document-types] No organisations found — skipping.");
    return;
  }

  console.log(`[seed-document-types] Seeding document types for ${orgs.length} organisation(s)...`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const org of orgs) {
    // Group candidates by normalized code, keeping the first raw value seen as the display name.
    const candidates = new Map<string, string>();

    const docRows = await db
      .select({ documentType: documentsTable.documentType })
      .from(documentsTable)
      .where(and(eq(documentsTable.organizationId, org.id), isNotNull(documentsTable.documentType), ne(documentsTable.documentType, "")));

    for (const row of docRows) {
      const raw = row.documentType?.trim();
      if (!raw) continue;
      const code = normalizeDocTypeCode(raw);
      if (!candidates.has(code)) candidates.set(code, raw);
    }

    const [config] = await db.select({ documentTypes: orgConfigTable.documentTypes })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, org.id));

    if (Array.isArray(config?.documentTypes)) {
      for (const value of config.documentTypes) {
        const raw = typeof value === "string" ? value.trim() : "";
        if (!raw) continue;
        const code = normalizeDocTypeCode(raw);
        if (!candidates.has(code)) candidates.set(code, raw);
      }
    }

    if (candidates.size === 0) {
      console.log(`[seed-document-types]   org ${org.id} (${org.name}): no candidate document types found — skip`);
      continue;
    }

    const existing = await db.select({ code: documentTypesTable.code })
      .from(documentTypesTable)
      .where(eq(documentTypesTable.organizationId, org.id));
    const existingCodes = new Set(existing.map(e => e.code));

    for (const [code, name] of candidates) {
      if (existingCodes.has(code)) {
        totalSkipped++;
        continue;
      }

      await db.insert(documentTypesTable).values({
        organizationId: org.id,
        code,
        name,
        isActive: true,
      });

      console.log(`[seed-document-types]   org ${org.id} (${org.name}): created "${code}" (${name})`);
      totalCreated++;
    }
  }

  console.log(`[seed-document-types] Done — ${totalCreated} document type(s) created, ${totalSkipped} already existed.`);
}

try {
  await seedDocumentTypes();
  process.exit(0);
} catch (err) {
  console.error("[seed-document-types] ERROR:", err);
  process.exit(1);
}

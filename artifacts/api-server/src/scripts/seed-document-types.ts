/**
 * seed-document-types.ts
 *
 * Idempotent seeder for `document_types`, run once per organisation at startup.
 * Populates document_types from two legacy sources (distinct documents.document_type
 * already in use + org_config.documentTypes jsonb). The per-org candidate/insert
 * logic lives in lib/org-defaults.ts (single source of truth, also used by
 * /register-org so a new tenant gets its default document types at creation time).
 *
 * Usage:
 *   node --enable-source-maps /app/artifacts/api-server/dist/seed-document-types.mjs
 */

import { db } from "@workspace/db";
import { organizationsTable } from "@workspace/db";
import { seedDocumentTypesForOrg } from "../lib/org-defaults.js";

async function seedDocumentTypes() {
  const orgs = await db.select({ id: organizationsTable.id, name: organizationsTable.name })
    .from(organizationsTable);

  if (orgs.length === 0) {
    console.log("[seed-document-types] No organisations found — skipping.");
    return;
  }

  console.log(`[seed-document-types] Seeding document types for ${orgs.length} organisation(s)...`);

  let totalCreated = 0;
  for (const org of orgs) {
    const created = await seedDocumentTypesForOrg(org.id);
    if (created > 0) console.log(`[seed-document-types]   org ${org.id} (${org.name}): created ${created} type(s)`);
    totalCreated += created;
  }

  console.log(`[seed-document-types] Done — ${totalCreated} document type(s) created.`);
}

try {
  await seedDocumentTypes();
  process.exit(0);
} catch (err) {
  console.error("[seed-document-types] ERROR:", err);
  process.exit(1);
}

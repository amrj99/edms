/**
 * seed-wf-defaults.ts
 *
 * Idempotent seeder for default workflow templates.
 * Runs once per organisation during container startup (via docker-entrypoint.sh).
 * Safe to run on every deploy — existing templates are never overwritten.
 *
 * The per-org template data + insert logic live in lib/org-defaults.ts (the
 * single source of truth, also used by /register-org so new tenants are seeded
 * at creation time, not only at boot).
 *
 * Usage:
 *   node --enable-source-maps /app/artifacts/api-server/dist/seed-wf-defaults.mjs
 */

import { db } from "@workspace/db";
import { organizationsTable, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { seedWorkflowTemplatesForOrg } from "../lib/org-defaults.js";

async function seedWorkflowDefaults() {
  const orgs = await db.select({ id: organizationsTable.id, name: organizationsTable.name })
    .from(organizationsTable);

  if (orgs.length === 0) {
    console.log("[seed-wf] No organisations found — skipping workflow template seed.");
    return;
  }

  // Pre-fetch one admin/owner user per org to satisfy the NOT NULL created_by_id constraint.
  const orgIds = orgs.map(o => o.id);
  const adminUsers = await db
    .select({ id: usersTable.id, orgId: usersTable.organizationId, role: usersTable.role })
    .from(usersTable)
    .where(inArray(usersTable.organizationId, orgIds));

  const creatorByOrg = new Map<number, number>();
  for (const u of adminUsers) {
    if (u.orgId === null) continue;
    const existing = creatorByOrg.get(u.orgId);
    if (!existing || ["system_owner", "admin"].includes(u.role)) {
      creatorByOrg.set(u.orgId, u.id);
    }
  }

  console.log(`[seed-wf] Seeding default workflow templates for ${orgs.length} organisation(s)...`);

  let totalCreated = 0;
  for (const org of orgs) {
    const creatorId = creatorByOrg.get(org.id);
    if (!creatorId) {
      console.log(`[seed-wf]   org ${org.id} (${org.name}): no users found — skipping`);
      continue;
    }
    const created = await seedWorkflowTemplatesForOrg(org.id, creatorId);
    if (created > 0) console.log(`[seed-wf]   org ${org.id} (${org.name}): created ${created} template(s)`);
    totalCreated += created;
  }

  console.log(`[seed-wf] Done — ${totalCreated} template(s) created.`);
}

try {
  await seedWorkflowDefaults();
  process.exit(0);
} catch (err) {
  console.error("[seed-wf] ERROR:", err);
  process.exit(1);
}

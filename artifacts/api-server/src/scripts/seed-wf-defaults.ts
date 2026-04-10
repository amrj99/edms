/**
 * seed-wf-defaults.ts
 *
 * Idempotent seeder for default workflow templates.
 * Runs once per organisation during container startup (via docker-entrypoint.sh).
 * Safe to run on every deploy — existing templates are never overwritten.
 *
 * Usage:
 *   node --enable-source-maps /app/artifacts/api-server/dist/seed-wf-defaults.mjs
 */

import { db } from "@workspace/db";
import { organizationsTable, usersTable, wfTemplatesTable, wfTemplateStagesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

// ─── Default templates ────────────────────────────────────────────────────────

interface DefaultTemplate {
  name: string;
  documentType: string;
  description: string;
  stages: Array<{
    stageOrder: number;
    name: string;
    responsibleRole: string | null;
    isTerminal: boolean;
  }>;
}

const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: "Invoice Approval Workflow",
    documentType: "Invoice",
    description: "Standard invoice approval: Finance → Contracts → Operations → GM → Issued",
    stages: [
      { stageOrder: 1, name: "Finance Review",     responsibleRole: "Finance",    isTerminal: false },
      { stageOrder: 2, name: "Contracts Review",   responsibleRole: "Contracts",  isTerminal: false },
      { stageOrder: 3, name: "Operations Review",  responsibleRole: "Operations", isTerminal: false },
      { stageOrder: 4, name: "GM Approval",        responsibleRole: "GM",         isTerminal: false },
      { stageOrder: 5, name: "Issued",             responsibleRole: null,         isTerminal: true  },
    ],
  },
  {
    name: "General Document Approval",
    documentType: "general",
    description: "Standard approval for general documents",
    stages: [
      { stageOrder: 1, name: "Internal Review",   responsibleRole: "Reviewer",        isTerminal: false },
      { stageOrder: 2, name: "Senior Review",     responsibleRole: "Senior Engineer", isTerminal: false },
      { stageOrder: 3, name: "Approved for Issue", responsibleRole: null,             isTerminal: true  },
    ],
  },
  {
    name: "Correspondence Workflow",
    documentType: "correspondence",
    description: "Action tracking for incoming and outgoing correspondence",
    stages: [
      { stageOrder: 1, name: "Acknowledged",  responsibleRole: "Document Controller", isTerminal: false },
      { stageOrder: 2, name: "Manager Review", responsibleRole: "Manager",            isTerminal: false },
      { stageOrder: 3, name: "Actioned",       responsibleRole: null,                 isTerminal: true  },
    ],
  },
  {
    name: "Contract Approval Workflow",
    documentType: "contract",
    description: "Multi-stage approval for contracts and agreements",
    stages: [
      { stageOrder: 1, name: "Legal Review",        responsibleRole: "Legal",      isTerminal: false },
      { stageOrder: 2, name: "Commercial Review",   responsibleRole: "Commercial", isTerminal: false },
      { stageOrder: 3, name: "Management Approval", responsibleRole: "Management", isTerminal: false },
      { stageOrder: 4, name: "Executed",            responsibleRole: null,         isTerminal: true  },
    ],
  },
  {
    name: "Drawing Approval Workflow",
    documentType: "drawing",
    description: "Engineering review and approval for drawings",
    stages: [
      { stageOrder: 1, name: "Checker Review",             responsibleRole: "Checker",         isTerminal: false },
      { stageOrder: 2, name: "Senior Engineer Review",     responsibleRole: "Senior Engineer",  isTerminal: false },
      { stageOrder: 3, name: "Approved for Construction",  responsibleRole: null,               isTerminal: true  },
    ],
  },
];

// ─── Seeder ───────────────────────────────────────────────────────────────────

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

  // Build a map: orgId → first admin/owner user id (fallback to any user)
  const creatorByOrg = new Map<number, number>();
  for (const u of adminUsers) {
    const existing = creatorByOrg.get(u.orgId);
    if (!existing || ["system_owner", "admin"].includes(u.role)) {
      creatorByOrg.set(u.orgId, u.id);
    }
  }

  console.log(`[seed-wf] Seeding default workflow templates for ${orgs.length} organisation(s)...`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const org of orgs) {
    const creatorId = creatorByOrg.get(org.id);
    if (!creatorId) {
      console.log(`[seed-wf]   org ${org.id} (${org.name}): no users found — skipping`);
      continue;
    }

    for (const def of DEFAULT_TEMPLATES) {
      const [existing] = await db.select({ id: wfTemplatesTable.id })
        .from(wfTemplatesTable)
        .where(and(
          eq(wfTemplatesTable.organizationId, org.id),
          eq(wfTemplatesTable.documentType, def.documentType),
        ))
        .limit(1);

      if (existing) {
        console.log(`[seed-wf]   org ${org.id} (${org.name}): "${def.name}" already exists — skip`);
        totalSkipped++;
        continue;
      }

      const [tpl] = await db.insert(wfTemplatesTable).values({
        organizationId: org.id,
        name: def.name,
        documentType: def.documentType,
        description: def.description,
        isActive: true,
        createdById: creatorId,
      }).returning({ id: wfTemplatesTable.id });

      await db.insert(wfTemplateStagesTable).values(
        def.stages.map(s => ({
          templateId: tpl.id,
          stageOrder: s.stageOrder,
          name: s.name,
          responsibleRole: s.responsibleRole,
          responsibleUserId: null,
          isTerminal: s.isTerminal,
        })),
      );

      console.log(`[seed-wf]   org ${org.id} (${org.name}): created "${def.name}" with ${def.stages.length} stages`);
      totalCreated++;
    }
  }

  console.log(`[seed-wf] Done — ${totalCreated} template(s) created, ${totalSkipped} already existed.`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

try {
  await seedWorkflowDefaults();
  process.exit(0);
} catch (err) {
  console.error("[seed-wf] ERROR:", err);
  process.exit(1);
}

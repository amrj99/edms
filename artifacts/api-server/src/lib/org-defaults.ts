/**
 * org-defaults.ts — single source of truth for a NEW organisation's default
 * workspace content (workflow templates + document types).
 *
 * Historically these were seeded only by the container-startup scripts
 * (seed-wf-defaults / seed-document-types), which iterate over ALL orgs. That
 * left a gap: an organisation created AFTER boot (self-service /register-org)
 * had NO workflow templates and NO document types until the next container
 * restart. These per-org helpers close that gap — they are called both by the
 * boot seeders (for every existing org) and by /register-org (for the new org),
 * so a fresh tenant's workspace is usable immediately. All helpers are
 * idempotent: existing rows are never overwritten.
 */

import { db } from "@workspace/db";
import {
  documentsTable, orgConfigTable, documentTypesTable, normalizeDocTypeCode,
  wfTemplatesTable, wfTemplateStagesTable,
} from "@workspace/db";
import { eq, and, isNotNull, ne } from "drizzle-orm";

export interface DefaultTemplate {
  name: string;
  documentType: string;
  description: string;
  stages: Array<{ stageOrder: number; name: string; responsibleRole: string | null; isTerminal: boolean }>;
}

// responsibleRole values MUST be valid AppRole system roles or null (terminal).
export const DEFAULT_WF_TEMPLATES: DefaultTemplate[] = [
  {
    name: "General Document Approval",
    documentType: "general",
    description: "Standard approval for general documents: internal review → senior review → issued",
    stages: [
      { stageOrder: 1, name: "Internal Review",    responsibleRole: "reviewer",            isTerminal: false },
      { stageOrder: 2, name: "Senior Review",      responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 3, name: "Approved for Issue", responsibleRole: null,                  isTerminal: true  },
    ],
  },
  {
    name: "Correspondence Workflow",
    documentType: "correspondence",
    description: "Action tracking for incoming and outgoing correspondence",
    stages: [
      { stageOrder: 1, name: "Acknowledged",   responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 2, name: "Manager Review", responsibleRole: "project_manager",     isTerminal: false },
      { stageOrder: 3, name: "Actioned",       responsibleRole: null,                  isTerminal: true  },
    ],
  },
  {
    name: "Contract Approval Workflow",
    documentType: "contract",
    description: "Approval workflow for contracts and formal agreements",
    stages: [
      { stageOrder: 1, name: "Review",              responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 2, name: "Management Approval", responsibleRole: "project_manager",     isTerminal: false },
      { stageOrder: 3, name: "Executed",            responsibleRole: null,                  isTerminal: true  },
    ],
  },
  {
    name: "Drawing Approval Workflow",
    documentType: "drawing",
    description: "Engineering review and approval for technical drawings",
    stages: [
      { stageOrder: 1, name: "Technical Review",          responsibleRole: "reviewer",            isTerminal: false },
      { stageOrder: 2, name: "Senior Engineer Review",    responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 3, name: "Approved for Construction", responsibleRole: null,                  isTerminal: true  },
    ],
  },
];

/**
 * Seed the default workflow templates for ONE organisation. Idempotent: skips a
 * template whose (organizationId, documentType) already exists. Returns #created.
 */
export async function seedWorkflowTemplatesForOrg(orgId: number, creatorId: number): Promise<number> {
  let created = 0;
  for (const def of DEFAULT_WF_TEMPLATES) {
    const [existing] = await db.select({ id: wfTemplatesTable.id })
      .from(wfTemplatesTable)
      .where(and(eq(wfTemplatesTable.organizationId, orgId), eq(wfTemplatesTable.documentType, def.documentType)))
      .limit(1);
    if (existing) continue;

    const [tpl] = await db.insert(wfTemplatesTable).values({
      organizationId: orgId,
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
    created++;
  }
  return created;
}

/**
 * Seed document_types for ONE organisation from its candidate sources
 * (distinct documents.document_type in use + org_config.documentTypes jsonb —
 * the latter carries the default type list for a fresh org). Idempotent on
 * (organizationId, code). Returns #created.
 */
export async function seedDocumentTypesForOrg(orgId: number): Promise<number> {
  const candidates = new Map<string, string>();

  const docRows = await db
    .select({ documentType: documentsTable.documentType })
    .from(documentsTable)
    .where(and(eq(documentsTable.organizationId, orgId), isNotNull(documentsTable.documentType), ne(documentsTable.documentType, "")));
  for (const row of docRows) {
    const raw = row.documentType?.trim();
    if (!raw) continue;
    const code = normalizeDocTypeCode(raw);
    if (!candidates.has(code)) candidates.set(code, raw);
  }

  const [config] = await db.select({ documentTypes: orgConfigTable.documentTypes })
    .from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, orgId));
  if (Array.isArray(config?.documentTypes)) {
    for (const value of config.documentTypes) {
      const raw = typeof value === "string" ? value.trim() : "";
      if (!raw) continue;
      const code = normalizeDocTypeCode(raw);
      if (!candidates.has(code)) candidates.set(code, raw);
    }
  }

  if (candidates.size === 0) return 0;

  const existing = await db.select({ code: documentTypesTable.code })
    .from(documentTypesTable)
    .where(eq(documentTypesTable.organizationId, orgId));
  const existingCodes = new Set(existing.map(e => e.code));

  let created = 0;
  for (const [code, name] of candidates) {
    if (existingCodes.has(code)) continue;
    await db.insert(documentTypesTable).values({ organizationId: orgId, code, name, isActive: true });
    created++;
  }
  return created;
}

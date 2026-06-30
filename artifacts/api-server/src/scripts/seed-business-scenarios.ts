/**
 * seed-business-scenarios.ts
 *
 * Idempotent seed for the Business Scenario Test Environment (J-01 → J-08).
 * Safe to run multiple times — skips any records that already exist.
 *
 * Execution (after rebuild):
 *   docker exec edms_api node /app/artifacts/api-server/dist/seed-business-scenarios.mjs
 *
 * Production guard: aborts immediately if DATABASE_URL contains any known
 * production host signals. Never run this against a live database.
 */

import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectMembersTable,
  documentTypesTable,
  wfTemplatesTable,
  wfTemplateStagesTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Production Guard ──────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const PROD_SIGNALS = [
  "arcscale.org", "prod", "production",
  "railway.app", "render.com", "supabase.co",
  "neon.tech", "planetscale",
];
if (PROD_SIGNALS.some(s => dbUrl.toLowerCase().includes(s))) {
  console.error("ERROR: DATABASE_URL appears to point to a production host.");
  console.error("       Aborting to protect production data.");
  console.error("       URL:", dbUrl.replace(/:[^:@]+@/, ":***@"));
  process.exit(1);
}

// ── Scenario Data Definition ──────────────────────────────────────────────────

const SCENARIO_PASSWORD = "Scenario2026!";

// Three organizations covering the full multi-party scenario chain (J-01 → J-08)
const ORGS = [
  { code: "ABC", name: "Al-Benna Construction Co.", type: "contractor" as const },
  { code: "HMT", name: "HMT Consultants",           type: "consultant" as const },
  { code: "POA", name: "Project Owner Authority",   type: "client"     as const },
];

// Seven scenario actors — minimum needed for J-01 through J-08
const USERS: Array<{
  email: string;
  firstName: string;
  lastName: string;
  role: "document_controller" | "reviewer" | "project_manager";
  orgCode: "ABC" | "HMT" | "POA";
}> = [
  // Contractor (Al-Benna)
  { email: "dc@contractor.local",       firstName: "Mariam", lastName: "Al-Benna",   role: "document_controller", orgCode: "ABC" },
  { email: "engineer@contractor.local", firstName: "Khalid", lastName: "Al-Benna",   role: "reviewer",            orgCode: "ABC" },
  { email: "pm@contractor.local",       firstName: "Sara",   lastName: "Al-Benna",   role: "project_manager",     orgCode: "ABC" },
  // Consultant (HMT)
  { email: "reviewer@consultant.local", firstName: "Omar",   lastName: "Consultant", role: "reviewer",            orgCode: "HMT" },
  { email: "pm@consultant.local",       firstName: "Leila",  lastName: "Consultant", role: "project_manager",     orgCode: "HMT" },
  { email: "dc@consultant.local",       firstName: "Rami",   lastName: "Consultant", role: "document_controller", orgCode: "HMT" },
  // Owner (POA) — needed for J-06 three-party chain
  { email: "approver@owner.local",      firstName: "Tariq",  lastName: "Owner",      role: "reviewer",            orgCode: "POA" },
];

// The scenario project — all actors are members
const PROJECT = {
  code:        "HMT-ABC",
  name:        "Al-Benna HMT Project",
  description: "Business Scenario Test Environment — J-01 through J-08. Do not use for other purposes.",
  orgCode:     "ABC" as const,
};

// Each actor's role within the project
const PROJECT_MEMBER_ROLES: Record<string, "document_controller" | "reviewer" | "project_manager"> = {
  "dc@contractor.local":       "document_controller",
  "engineer@contractor.local": "reviewer",
  "pm@contractor.local":       "project_manager",
  "reviewer@consultant.local": "reviewer",
  "pm@consultant.local":       "project_manager",
  "dc@consultant.local":       "document_controller",
  "approver@owner.local":      "reviewer",
};

// Document types for Contractor org — covers all scenario document types
const DOC_TYPES = [
  { code: "DRAWING",        name: "Drawing"        },
  { code: "SPECIFICATION",  name: "Specification"  },
  { code: "CALCULATION",    name: "Calculation"    },
  { code: "REPORT",         name: "Report"         },
  { code: "CORRESPONDENCE", name: "Correspondence" },
  { code: "CONTRACT",       name: "Contract"       },
];

// Workflow template for the Contractor org — Drawing Approval (3 stages)
//
// Stage 3 (Approved for Construction) is terminal with no responsibleUserId.
// This is intentional: J-01 will observe whether terminal stages auto-complete
// or require a user to manually advance them.
// ARCH Finding: recorded as open question for post-scenario analysis.
const WF_TEMPLATE_NAME = "Drawing Approval Workflow (Scenarios)";

// Module config for all 3 scenario orgs — enables every module needed for J-01 → J-08.
// chat stays false (not tested in any scenario).
const SCENARIO_MODULES = {
  dashboard:       true,
  deliverables:    true,
  registers:       true,
  notifications:   true,
  correspondence:  true,
  meetings:        true,
  workflow_engine: true,
  chat:            false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const stats = {
  orgsCreated: 0,      orgsExisted: 0,
  usersCreated: 0,     usersExisted: 0,
  projectCreated: false,
  membersAdded: 0,     membersExisted: 0,
  docTypesCreated: 0,  docTypesExisted: 0,
  wfCreated: false,
  orgConfigsSet: 0,
};

function log(tag: "CREATE" | "SKIP" | "NOTE" | "WARN", msg: string) {
  const prefix = tag === "CREATE" ? "  ✓" : tag === "SKIP" ? "  ·" : tag === "WARN" ? "  ⚠" : "  →";
  console.log(`${prefix} [${tag}] ${msg}`);
}

function section(title: string) {
  console.log(`\n── ${title}`);
}

// ── Step 1: Organizations ─────────────────────────────────────────────────────

section("1. Organizations");

const orgIds: Record<string, number> = {};

for (const org of ORGS) {
  const existing = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.code, org.code))
    .limit(1);

  if (existing.length > 0) {
    orgIds[org.code] = existing[0].id;
    log("SKIP", `"${org.name}" (${org.code}) — id=${existing[0].id}`);
    stats.orgsExisted++;
  } else {
    const [row] = await db
      .insert(organizationsTable)
      .values({ code: org.code, name: org.name, type: org.type })
      .returning({ id: organizationsTable.id });
    orgIds[org.code] = row.id;
    log("CREATE", `"${org.name}" (${org.code}) → id=${row.id}`);
    stats.orgsCreated++;
  }
}

// ── Step 2: Users ─────────────────────────────────────────────────────────────

section("2. Users  [all use password: Scenario2026!]");

// Hash once — bcrypt is slow by design; no need to repeat per user
const passwordHash = await bcrypt.hash(SCENARIO_PASSWORD, 12);
const userIds: Record<string, number> = {};

for (const user of USERS) {
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, user.email))
    .limit(1);

  if (existing.length > 0) {
    userIds[user.email] = existing[0].id;
    log("SKIP", `${user.email} — id=${existing[0].id}`);
    stats.usersExisted++;
  } else {
    const [row] = await db
      .insert(usersTable)
      .values({
        email:          user.email,
        passwordHash,
        firstName:      user.firstName,
        lastName:       user.lastName,
        role:           user.role,
        organizationId: orgIds[user.orgCode],
        isActive:       true,
      })
      .returning({ id: usersTable.id });
    userIds[user.email] = row.id;
    log("CREATE", `${user.email}  (${user.role}, org=${user.orgCode}) → id=${row.id}`);
    stats.usersCreated++;
  }
}

// ── Step 3: Project ───────────────────────────────────────────────────────────

section("3. Project");

let projectId: number;

const existingProject = await db
  .select({ id: projectsTable.id })
  .from(projectsTable)
  .where(eq(projectsTable.code, PROJECT.code))
  .limit(1);

if (existingProject.length > 0) {
  projectId = existingProject[0].id;
  log("SKIP", `"${PROJECT.name}" (${PROJECT.code}) — id=${projectId}`);
} else {
  const [row] = await db
    .insert(projectsTable)
    .values({
      code:           PROJECT.code,
      name:           PROJECT.name,
      description:    PROJECT.description,
      organizationId: orgIds[PROJECT.orgCode],
      status:         "active",
    })
    .returning({ id: projectsTable.id });
  projectId = row.id;
  log("CREATE", `"${PROJECT.name}" (${PROJECT.code}) → id=${projectId}`);
  stats.projectCreated = true;
}

// ── Step 4: Project Members ───────────────────────────────────────────────────

section("4. Project Members");

for (const email of Object.keys(PROJECT_MEMBER_ROLES)) {
  const userId = userIds[email];
  if (!userId) {
    log("WARN", `${email} not found in userIds — skipping`);
    continue;
  }

  const existing = await db
    .select({ id: projectMembersTable.id })
    .from(projectMembersTable)
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(projectMembersTable.userId, userId),
    ))
    .limit(1);

  if (existing.length > 0) {
    log("SKIP", `${email} already member of ${PROJECT.code}`);
    stats.membersExisted++;
  } else {
    await db.insert(projectMembersTable).values({
      projectId,
      userId,
      role: PROJECT_MEMBER_ROLES[email]!,
    });
    log("CREATE", `${email} → ${PROJECT.code} as ${PROJECT_MEMBER_ROLES[email]}`);
    stats.membersAdded++;
  }
}

// ── Step 5: Document Types (Contractor org) ───────────────────────────────────

section("5. Document Types  (org: ABC)");

const abcOrgId = orgIds["ABC"]!;
let drawingDocTypeId: number | undefined;

for (const dt of DOC_TYPES) {
  const existing = await db
    .select({ id: documentTypesTable.id })
    .from(documentTypesTable)
    .where(and(
      eq(documentTypesTable.organizationId, abcOrgId),
      eq(documentTypesTable.code, dt.code),
    ))
    .limit(1);

  if (existing.length > 0) {
    if (dt.code === "DRAWING") drawingDocTypeId = existing[0].id;
    log("SKIP", `${dt.code} ("${dt.name}") — id=${existing[0].id}`);
    stats.docTypesExisted++;
  } else {
    const [row] = await db
      .insert(documentTypesTable)
      .values({ organizationId: abcOrgId, code: dt.code, name: dt.name })
      .returning({ id: documentTypesTable.id });
    if (dt.code === "DRAWING") drawingDocTypeId = row.id;
    log("CREATE", `${dt.code} ("${dt.name}") → id=${row.id}`);
    stats.docTypesCreated++;
  }
}

// ── Step 6: Workflow Template ─────────────────────────────────────────────────

section("6. Workflow Template  (org: ABC — Drawing Approval, 3 stages)");

const dcUserId       = userIds["dc@contractor.local"]!;
const engineerUserId = userIds["engineer@contractor.local"]!;
const pmUserId       = userIds["pm@contractor.local"]!;

const existingTemplate = await db
  .select({ id: wfTemplatesTable.id })
  .from(wfTemplatesTable)
  .where(and(
    eq(wfTemplatesTable.organizationId, abcOrgId),
    eq(wfTemplatesTable.name, WF_TEMPLATE_NAME),
  ))
  .limit(1);

if (existingTemplate.length > 0) {
  log("SKIP", `"${WF_TEMPLATE_NAME}" — id=${existingTemplate[0].id}`);
  log("NOTE", "Existing stages left untouched to preserve any in-flight scenarios");
} else {
  const [template] = await db
    .insert(wfTemplatesTable)
    .values({
      organizationId: abcOrgId,
      name:           WF_TEMPLATE_NAME,
      documentType:   "DRAWING",
      documentTypeId: drawingDocTypeId,
      isActive:       true,
      createdById:    dcUserId,
    })
    .returning({ id: wfTemplatesTable.id });

  log("CREATE", `"${WF_TEMPLATE_NAME}" → id=${template.id}`);

  const stages = [
    {
      stageOrder:        1,
      name:              "Checker Review",
      description:       "First-pass technical review",
      responsibleUserId: engineerUserId,
      isTerminal:        false,
    },
    {
      stageOrder:        2,
      name:              "Senior Engineer Review",
      description:       "Senior sign-off before approval",
      responsibleUserId: pmUserId,
      isTerminal:        false,
    },
    {
      // No responsibleUserId — intentional.
      // J-01 will observe: does a terminal stage auto-complete, or does someone
      // need to advance it? Record result as ARCH/Observed in Findings Log.
      stageOrder:        3,
      name:              "Approved for Construction",
      description:       "Terminal stage — workflow completes here",
      responsibleUserId: undefined,
      isTerminal:        true,
    },
  ];

  for (const stage of stages) {
    await db.insert(wfTemplateStagesTable).values({
      templateId:        template.id,
      stageOrder:        stage.stageOrder,
      name:              stage.name,
      description:       stage.description,
      responsibleUserId: stage.responsibleUserId,
      isTerminal:        stage.isTerminal,
    });
    const who = stage.responsibleUserId
      ? `assigned to user id=${stage.responsibleUserId}`
      : "no responsible user (observe terminal behavior in J-01)";
    log("CREATE", `  Stage ${stage.stageOrder}: "${stage.name}" — ${who}`);
  }

  stats.wfCreated = true;
}

// ── Step 7: Org Config — set trial plan + enable required modules ─────────────
//
// Scenario orgs default to subscriptionTier=null → "expired" plan.
// The ModuleSyncScheduler runs every 30 min and resets org_config.modules to
// match the subscription plan. Setting subscriptionTier="trial" means the
// scheduler will REINFORCE the correct module state instead of reverting it.
// Trial plan has all scenario modules enabled.
//
// We also set org_config.modules directly so J-01 doesn't need to wait for the
// next scheduler cycle.

section("7. Org Config  (subscriptionTier=trial + modules: workflow_engine + registers + correspondence)");

for (const orgCode of ["ABC", "HMT", "POA"] as const) {
  const orgId = orgIds[orgCode]!;

  // Set subscription tier to "trial" — scheduler will reinforce all-modules-enabled
  await db
    .update(organizationsTable)
    .set({ subscriptionTier: "trial" })
    .where(eq(organizationsTable.id, orgId));

  // Explicitly set org_config.modules so J-01 doesn't need to wait for the scheduler
  await db
    .insert(orgConfigTable)
    .values({
      organizationId: orgId,
      modules: SCENARIO_MODULES,
    })
    .onConflictDoUpdate({
      target: [orgConfigTable.organizationId],
      set: {
        modules: SCENARIO_MODULES,
        updatedAt: new Date(),
      },
    });

  log("CREATE", `org ${orgCode} (id=${orgId}) → subscriptionTier=trial, modules set`);
  stats.orgConfigsSet++;
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`
═══════════════════════════════════════════════════════════
  Seed Complete
═══════════════════════════════════════════════════════════
  Organizations : ${stats.orgsCreated} created  /  ${stats.orgsExisted} already existed
  Users         : ${stats.usersCreated} created  /  ${stats.usersExisted} already existed
  Project       : ${stats.projectCreated ? "created  (HMT-ABC)" : "already existed  (HMT-ABC)"}
  Memberships   : ${stats.membersAdded} added    /  ${stats.membersExisted} already existed
  Document Types: ${stats.docTypesCreated} created  /  ${stats.docTypesExisted} already existed
  WF Template   : ${stats.wfCreated ? "created  (3 stages)" : "already existed  (stages untouched)"}
  Org Configs   : ${stats.orgConfigsSet} orgs updated  (workflow_engine + registers + correspondence enabled)

  ── Credentials ─────────────────────────────────────────
  Password (all users): Scenario2026!

  dc@contractor.local        document_controller  ABC
  engineer@contractor.local  reviewer             ABC
  pm@contractor.local        project_manager      ABC
  reviewer@consultant.local  reviewer             HMT
  pm@consultant.local        project_manager      HMT
  dc@consultant.local        document_controller  HMT
  approver@owner.local       reviewer             POA

  ── Open Question for J-01 (ARCH/Observed) ──────────────
  Stage 3 "Approved for Construction" has no responsibleUserId.
  J-01 will reveal whether terminal stages auto-complete on
  the previous stage's Advance, or require a manual action.
  Record the observed behavior in the Findings Log — do not
  fix it before running J-01.
═══════════════════════════════════════════════════════════
`);

process.exit(0);

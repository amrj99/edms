/**
 * seed-ui-test.ts
 *
 * Idempotent seed for local Phase F UI verification.
 * Targets the TEST database only — never production.
 *
 * Run:
 *   cd artifacts/api-server
 *   $env:DATABASE_URL="postgresql://edms_test:edms_test_password@localhost:5433/edms_test"
 *   pnpm seed:ui-test
 *
 * Safe to re-run: uses onConflictDoNothing() on all inserts.
 * Re-running prints existing IDs without duplicating data.
 */

import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectMembersTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Production guard ──────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL ?? "";

if (!dbUrl) {
  console.error("ERROR: DATABASE_URL is not set.");
  console.error("       Set it to the test database URL and retry.");
  process.exit(1);
}

const PROD_SIGNALS = [
  "arcscale.org", "prod", "production",
  "railway.app", "render.com", "supabase.co",
  "neon.tech", "planetscale", ":5432/edms",   // production postgres (no _test suffix)
];

if (PROD_SIGNALS.some(s => dbUrl.toLowerCase().includes(s))) {
  console.error("ERROR: DATABASE_URL looks like a production host.");
  console.error("       Aborting to protect production data.");
  console.error("       URL:", dbUrl.replace(/:[^:@]+@/, ":***@"));
  process.exit(1);
}

if (!dbUrl.includes("5433") && !dbUrl.includes("edms_test")) {
  console.error("ERROR: DATABASE_URL does not point to the test database.");
  console.error("       Expected port 5433 or database name 'edms_test'.");
  console.error("       URL:", dbUrl.replace(/:[^:@]+@/, ":***@"));
  process.exit(1);
}

console.log("✓ Production guard passed — test database confirmed.");
console.log("  URL:", dbUrl.replace(/:[^:@]+@/, ":***@"));
console.log();

// ── Constants ─────────────────────────────────────────────────────────────────

const PASSWORD     = "UITest2026!";
const MODULES      = { registers: true, correspondence: true, workflow_engine: true };

const ORGS = [
  { code: "ALPHA", name: "Alpha Engineering (Owner)",   type: "contractor"  as const },
  { code: "BETA",  name: "Beta Construction (External)", type: "consultant"  as const },
  { code: "GAMMA", name: "Gamma Consultants (External)", type: "client"      as const },
] as const;

const USERS = [
  {
    email: "admin@phasef.local",
    firstName: "Amani",
    lastName: "Admin",
    role: "admin" as const,
    orgCode: "ALPHA",
  },
  {
    email: "member@phasef.local",
    firstName: "Mansour",
    lastName: "Member",
    role: "member" as const,
    orgCode: "ALPHA",
  },
] as const;

const PROJECTS = [
  { code: "ALPHA-PRJ-001", name: "Infrastructure Phase 1 (Main Test Project)" },
  { code: "ALPHA-PRJ-002", name: "Isolation Check Project (Cross-Project Test)" },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(tag: string, msg: string) {
  console.log(`  [${tag.padEnd(6)}] ${msg}`);
}

// ── Step 1: Organizations ─────────────────────────────────────────────────────

console.log("── Step 1: Organizations ────────────────────────────────────────");

const orgIds: Record<string, number> = {};

for (const org of ORGS) {
  await db
    .insert(organizationsTable)
    .values({ name: org.name, code: org.code, type: org.type })
    .onConflictDoNothing();

  const [row] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.code, org.code));

  if (!row) { console.error(`FATAL: org ${org.code} not found after insert`); process.exit(1); }
  orgIds[org.code] = row.id;
  log("ORG", `${org.code} → id=${row.id}  (${org.name})`);
}

// ── Step 2: Org Config (modules) ──────────────────────────────────────────────

console.log();
console.log("── Step 2: Org Config ───────────────────────────────────────────");

for (const org of ORGS) {
  await db
    .insert(orgConfigTable)
    .values({ organizationId: orgIds[org.code]!, modules: MODULES })
    .onConflictDoUpdate({
      target: orgConfigTable.organizationId,
      set: { modules: MODULES, updatedAt: new Date() },
    });
  log("CFG", `${org.code} → modules set (registers + correspondence + workflow_engine)`);
}

// ── Step 3: Users ─────────────────────────────────────────────────────────────

console.log();
console.log("── Step 3: Users ────────────────────────────────────────────────");

const passwordHash = await bcrypt.hash(PASSWORD, 12);
const userIds: Record<string, number> = {};

for (const user of USERS) {
  const orgId = orgIds[user.orgCode];
  if (!orgId) { console.error(`FATAL: org ${user.orgCode} not found`); process.exit(1); }

  await db
    .insert(usersTable)
    .values({
      email:        user.email,
      passwordHash,
      firstName:    user.firstName,
      lastName:     user.lastName,
      role:         user.role,
      organizationId: orgId,
      isActive:     true,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, user.email));

  if (!row) { console.error(`FATAL: user ${user.email} not found after insert`); process.exit(1); }
  userIds[user.email] = row.id;
  log("USER", `${user.email}  (${user.role}, org=${user.orgCode}) → id=${row.id}`);
}

// ── Step 4: Projects ──────────────────────────────────────────────────────────

console.log();
console.log("── Step 4: Projects ─────────────────────────────────────────────");

const projectIds: Record<string, number> = {};
const alphaOrgId = orgIds["ALPHA"]!;

for (const proj of PROJECTS) {
  await db
    .insert(projectsTable)
    .values({
      organizationId: alphaOrgId,
      name:           proj.name,
      code:           proj.code,
      status:         "active",
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.code, proj.code));

  if (!row) { console.error(`FATAL: project ${proj.code} not found after insert`); process.exit(1); }
  projectIds[proj.code] = row.id;
  log("PROJ", `${proj.code} → id=${row.id}  (${proj.name})`);
}

// ── Step 5: Project Memberships ───────────────────────────────────────────────

console.log();
console.log("── Step 5: Project Memberships ──────────────────────────────────");

const adminId  = userIds["admin@phaseF.local"]!;
const memberId = userIds["member@phaseF.local"]!;
const proj1Id  = projectIds["ALPHA-PRJ-001"]!;
const proj2Id  = projectIds["ALPHA-PRJ-002"]!;

type MemberRow = { projectId: number; userId: number; role: "admin" | "member" | "viewer" | "project_manager" | "document_controller" | "reviewer" | "system_owner" };

const memberships: MemberRow[] = [
  { projectId: proj1Id, userId: adminId,  role: "admin"  },
  { projectId: proj1Id, userId: memberId, role: "member" },
  { projectId: proj2Id, userId: adminId,  role: "admin"  },
  // member intentionally NOT added to project 2 (tests isolation)
];

for (const m of memberships) {
  const existing = await db
    .select({ id: projectMembersTable.id })
    .from(projectMembersTable)
    .where(
      and(
        eq(projectMembersTable.projectId, m.projectId),
        eq(projectMembersTable.userId, m.userId),
      ),
    );

  if (existing.length === 0) {
    await db.insert(projectMembersTable).values(m);
    log("MBR", `project=${m.projectId} user=${m.userId} role=${m.role} → added`);
  } else {
    log("MBR", `project=${m.projectId} user=${m.userId} → already member (skip)`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║            Phase F — UI Test Seed Complete                       ║
╠══════════════════════════════════════════════════════════════════╣
║  ORGANIZATIONS                                                   ║
║   ALPHA (id=${String(orgIds["ALPHA"]).padEnd(3)}) — Alpha Engineering (Owner)              ║
║   BETA  (id=${String(orgIds["BETA"]).padEnd(3)}) — Beta Construction (External)           ║
║   GAMMA (id=${String(orgIds["GAMMA"]).padEnd(3)}) — Gamma Consultants (External)          ║
╠══════════════════════════════════════════════════════════════════╣
║  USERS                          password: ${PASSWORD.padEnd(22)} ║
║   admin@phaseF.local   (admin)  org=ALPHA  id=${String(userIds["admin@phaseF.local"]).padEnd(16)} ║
║   member@phaseF.local  (member) org=ALPHA  id=${String(userIds["member@phaseF.local"]).padEnd(16)} ║
╠══════════════════════════════════════════════════════════════════╣
║  PROJECTS                                                        ║
║   ALPHA-PRJ-001 (id=${String(proj1Id).padEnd(3)}) — Main test project                  ║
║     members: admin (admin) + member (member)                     ║
║   ALPHA-PRJ-002 (id=${String(proj2Id).padEnd(3)}) — Isolation project                  ║
║     members: admin only (tests cross-project isolation)          ║
╠══════════════════════════════════════════════════════════════════╣
║  HOW TO USE                                                      ║
║                                                                  ║
║  Terminal 1 — API Server:                                        ║
║    cd artifacts/api-server                                       ║
║    $env:DATABASE_URL="postgresql://edms_test:edms_test_password  ║
║                       @localhost:5433/edms_test"                 ║
║    $env:JWT_SECRET="local-test-secret-replace-with-anything"     ║
║    pnpm dev          ← starts on port 8080                       ║
║                                                                  ║
║  Terminal 2 — Frontend:                                          ║
║    pnpm --filter "@workspace/edms" dev --port 3001               ║
║    → opens http://localhost:3001                                  ║
║    → /api proxy → localhost:8080 ✓                               ║
║                                                                  ║
║  Login at: http://localhost:3001                                  ║
╚══════════════════════════════════════════════════════════════════╝
`);

process.exit(0);

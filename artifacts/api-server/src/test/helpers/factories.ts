/**
 * helpers/factories.ts
 *
 * Composable data factories for integration tests.
 * Each factory inserts a row into the test DB and returns the full record.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const orgA = await createOrg({ name: "Org A" });
 *   const orgB = await createOrg({ name: "Org B" });
 *   const admin = await createUser({ organizationId: orgA.id, role: "admin" });
 *   const project = await createProject({ organizationId: orgA.id, createdById: admin.id });
 *
 * ── Isolation guarantee ───────────────────────────────────────────────────────
 *
 * All inserts use the test DB (getTestDb()).
 * Wrap your beforeEach in beginTestTransaction() to auto-rollback all factories.
 *
 * ── Counters ─────────────────────────────────────────────────────────────────
 *
 * Each factory auto-increments a counter to avoid unique-constraint collisions
 * when creating multiple instances of the same type in one test.
 */

import { getTestDb } from "./db.js";
import { hashPassword } from "../../lib/auth.js";
import {
  organizationsTable,
  usersTable,
  projectsTable,
} from "@workspace/db";
import type { AppRole } from "../../lib/permissions.js";

// ── Counters ──────────────────────────────────────────────────────────────────

let _orgCounter = 0;
let _userCounter = 0;
let _projectCounter = 0;

export function resetFactoryCounters(): void {
  _orgCounter = 0;
  _userCounter = 0;
  _projectCounter = 0;
}

// ── Organization factory ──────────────────────────────────────────────────────

export interface CreateOrgOptions {
  name?: string;
  code?: string;
  type?: "client" | "consultant" | "contractor" | "subcontractor";
}

export async function createOrg(opts: CreateOrgOptions = {}) {
  const n = ++_orgCounter;
  const db = getTestDb();

  const [org] = await db
    .insert(organizationsTable)
    .values({
      name: opts.name ?? `Test Org ${n}`,
      code: opts.code ?? `ORG${n.toString().padStart(3, "0")}`,
      type: opts.type ?? "client",
    })
    .returning();

  return org;
}

// ── User factory ──────────────────────────────────────────────────────────────

export interface CreateUserOptions {
  organizationId: number;
  role?: AppRole;
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  isActive?: boolean;
}

export async function createUser(opts: CreateUserOptions) {
  const n = ++_userCounter;
  const db = getTestDb();
  const passwordHash = await hashPassword(opts.password ?? "TestPass123!");

  const [user] = await db
    .insert(usersTable)
    .values({
      email: opts.email ?? `user${n}@test.edms`,
      passwordHash,
      firstName: opts.firstName ?? `User`,
      lastName: opts.lastName ?? `${n}`,
      role: opts.role ?? "member",
      organizationId: opts.organizationId,
      isActive: opts.isActive ?? true,
    })
    .returning();

  return user;
}

// ── Project factory ───────────────────────────────────────────────────────────

export interface CreateProjectOptions {
  organizationId: number;
  createdById: number;
  name?: string;
  code?: string;
  status?: "active" | "on_hold" | "completed" | "cancelled";
}

export async function createProject(opts: CreateProjectOptions) {
  const n = ++_projectCounter;
  const db = getTestDb();

  const [project] = await db
    .insert(projectsTable)
    .values({
      organizationId: opts.organizationId,
      createdById: opts.createdById,
      name: opts.name ?? `Test Project ${n}`,
      code: opts.code ?? `PROJ${n.toString().padStart(3, "0")}`,
      status: opts.status ?? "active",
    })
    .returning();

  return project;
}

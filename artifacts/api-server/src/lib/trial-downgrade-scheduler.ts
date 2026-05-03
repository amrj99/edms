/**
 * Trial Auto-Downgrade Scheduler
 *
 * Polls every 5 minutes for organisations whose trial has expired and
 * automatically downgrades them from trial → free with full data preservation.
 *
 * Rules (approved 2026-05-03):
 *   - No data is deleted: users, projects and documents are preserved.
 *   - 1 active user is retained with full access:
 *       admin role preferred; earliest created_at as fallback.
 *       All other active users → is_read_only_override = true.
 *   - 1 project is kept visible (oldest by created_at).
 *       All other projects → visible_on_free = false.
 *   - org.subscription_tier is set to "free".
 *
 * Idempotent: already-downgraded orgs (tier ≠ "trial") are never touched.
 *
 * On upgrade: billing webhook calls restoreOrgAfterUpgrade() which clears
 * all is_read_only_override flags and sets visible_on_free = true for all
 * projects in the org.
 */

import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
} from "@workspace/db/schema";
import { and, eq, lt, isNotNull, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function processExpiredTrials(): Promise<void> {
  const now = new Date();

  const expiredOrgs = await db
    .select({ id: organizationsTable.id, name: organizationsTable.name })
    .from(organizationsTable)
    .where(
      and(
        eq(organizationsTable.subscriptionTier, "trial"),
        isNotNull(organizationsTable.trialEndsAt),
        lt(organizationsTable.trialEndsAt, now),
      )
    );

  if (expiredOrgs.length === 0) return;

  logger.info({ count: expiredOrgs.length }, "[trial-downgrade] Processing expired trial org(s)");

  for (const org of expiredOrgs) {
    try {
      await downgradeOrg(org.id, org.name ?? "");
    } catch (err: any) {
      logger.error(
        { orgId: org.id, err: err?.message ?? err },
        "[trial-downgrade] Failed to downgrade org — will retry on next poll",
      );
    }
  }
}

async function downgradeOrg(orgId: number, orgName: string): Promise<void> {
  // ── 1. Find all active users and pick the one to keep ─────────────────────
  const allUsers = await db
    .select({ id: usersTable.id, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(and(eq(usersTable.organizationId, orgId), eq(usersTable.isActive, true)))
    .orderBy(usersTable.createdAt);

  if (allUsers.length === 0) {
    await db
      .update(organizationsTable)
      .set({ subscriptionTier: "free", updatedAt: new Date() })
      .where(eq(organizationsTable.id, orgId));
    logger.info({ orgId }, "[trial-downgrade] No active users — tier set to free");
    return;
  }

  // Admin preferred; oldest user as fallback
  const keepUser = allUsers.find(u => u.role === "admin") ?? allUsers[0];
  const readOnlyIds = allUsers.filter(u => u.id !== keepUser.id).map(u => u.id);

  // ── 2. Find all projects and pick the oldest one to keep visible ──────────
  const allProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.organizationId, orgId))
    .orderBy(projectsTable.createdAt);

  const keepProjectId = allProjects[0]?.id ?? null;
  const hideProjectIds = allProjects.slice(1).map(p => p.id);

  // ── 3. Apply all changes (idempotent — safe to run repeatedly) ────────────

  // Ensure the kept user is NOT read-only (clears any previous override)
  await db
    .update(usersTable)
    .set({ isReadOnlyOverride: false, updatedAt: new Date() })
    .where(eq(usersTable.id, keepUser.id));

  // Mark all other users as read-only
  if (readOnlyIds.length > 0) {
    await db
      .update(usersTable)
      .set({ isReadOnlyOverride: true, updatedAt: new Date() })
      .where(inArray(usersTable.id, readOnlyIds));
  }

  // Ensure the kept project is visible
  if (keepProjectId !== null) {
    await db
      .update(projectsTable)
      .set({ visibleOnFree: true, updatedAt: new Date() })
      .where(eq(projectsTable.id, keepProjectId));
  }

  // Hide all extra projects
  if (hideProjectIds.length > 0) {
    await db
      .update(projectsTable)
      .set({ visibleOnFree: false, updatedAt: new Date() })
      .where(inArray(projectsTable.id, hideProjectIds));
  }

  // ── 4. Downgrade the org tier ─────────────────────────────────────────────
  await db
    .update(organizationsTable)
    .set({ subscriptionTier: "free", updatedAt: new Date() })
    .where(eq(organizationsTable.id, orgId));

  logger.info(
    {
      orgId,
      orgName,
      keptUserId: keepUser.id,
      readOnlyUserCount: readOnlyIds.length,
      keptProjectId: keepProjectId,
      hiddenProjectCount: hideProjectIds.length,
    },
    "[trial-downgrade] Org downgraded trial → free",
  );
}

export function startTrialDowngradeScheduler(): NodeJS.Timeout {
  processExpiredTrials().catch(err =>
    logger.error(err, "[trial-downgrade] Initial run failed"),
  );

  const timer = setInterval(() => {
    processExpiredTrials().catch(err =>
      logger.error(err, "[trial-downgrade] Periodic run failed"),
    );
  }, POLL_INTERVAL_MS);

  logger.info(
    { intervalMs: POLL_INTERVAL_MS },
    "[trial-downgrade] Trial downgrade scheduler started",
  );

  return timer;
}

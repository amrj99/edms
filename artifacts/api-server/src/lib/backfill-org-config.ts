/**
 * Backfill org_config rows for organizations that don't have one.
 *
 * Must run BEFORE the fail-closed require-module middleware is active,
 * so existing organizations are not locked out after the security fix.
 *
 * Safe to call multiple times — uses ON CONFLICT DO NOTHING.
 *
 * Backfill policy: all modules = TRUE for existing orgs, preserving their
 * current access. Plan-based enforcement is a separate Phase 1 concern.
 */
import { db } from "@workspace/db";
import { organizationsTable, orgConfigTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const BACKFILL_MODULES_DEFAULT = {
  dashboard: true,
  deliverables: true,
  registers: true,
  notifications: true,
  chat: true,
};

export async function backfillOrgConfig(): Promise<void> {
  try {
    // Find all orgs that have no org_config row using a LEFT JOIN
    const missing = await db.execute<{ id: number; name: string }>(sql`
      SELECT o.id, o.name
      FROM organizations o
      LEFT JOIN org_config oc ON oc.organization_id = o.id
      WHERE oc.id IS NULL
      ORDER BY o.id
    `);

    const rows = missing.rows ?? (missing as any);
    const count = Array.isArray(rows) ? rows.length : 0;

    if (count === 0) {
      logger.info("[backfill] org_config: all organizations already have a config row — nothing to do");
      return;
    }

    logger.warn(
      { count, orgIds: Array.isArray(rows) ? rows.map((r: any) => r.id) : [] },
      "[backfill] org_config: creating default config rows (all modules enabled) for organizations without config",
    );

    for (const row of (Array.isArray(rows) ? rows : [])) {
      try {
        await db.execute(sql`
          INSERT INTO org_config (organization_id, modules)
          VALUES (${(row as any).id}, ${JSON.stringify(BACKFILL_MODULES_DEFAULT)}::jsonb)
          ON CONFLICT (organization_id) DO NOTHING
        `);
        logger.info({ orgId: (row as any).id, orgName: (row as any).name }, "[backfill] org_config: created default config row");
      } catch (rowErr) {
        logger.error({ err: rowErr, orgId: (row as any).id }, "[backfill] org_config: failed to create config for org — skipping");
      }
    }

    logger.info({ count }, "[backfill] org_config: backfill complete");
  } catch (err) {
    logger.error({ err }, "[backfill] org_config: backfill failed — system continues, but fail-closed module check may deny access to unconfigured orgs");
  }
}

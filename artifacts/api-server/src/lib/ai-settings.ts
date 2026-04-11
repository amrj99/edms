/**
 * AI Settings — per-org module toggles (enable/disable AI per domain).
 * Independent of AI Core; only reads/writes the ai_settings table.
 */
import { db } from "@workspace/db";
import { aiSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export async function isModuleEnabled(module: string, organizationId?: number): Promise<boolean> {
  if (!organizationId) return true;
  const rows = await db.select().from(aiSettingsTable).where(
    and(
      eq(aiSettingsTable.organizationId, organizationId),
      eq(aiSettingsTable.module, module as any),
    )
  ).limit(1);
  return rows.length === 0 ? true : rows[0].enabled;
}

export async function getAiSettings(organizationId?: number): Promise<Record<string, boolean>> {
  if (!organizationId) return {};
  const rows = await db.select().from(aiSettingsTable).where(
    eq(aiSettingsTable.organizationId, organizationId)
  );
  const result: Record<string, boolean> = {};
  for (const row of rows) {
    result[row.module] = row.enabled;
  }
  return result;
}

export async function updateAiSettings(organizationId: number, settings: Record<string, boolean>) {
  for (const [module, enabled] of Object.entries(settings)) {
    await db.insert(aiSettingsTable).values({
      organizationId,
      module: module as any,
      enabled,
    }).onConflictDoUpdate({
      target: [aiSettingsTable.organizationId, aiSettingsTable.module],
      set: { enabled, updatedAt: new Date() },
    });
  }
}

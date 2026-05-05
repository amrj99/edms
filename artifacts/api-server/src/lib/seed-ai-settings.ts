/**
 * seedAISettings — ensure default AI routing configuration rows exist in system_settings.
 *
 * DESIGN RULES:
 *   - ON CONFLICT DO NOTHING — never overwrites a value an operator has set manually.
 *   - Idempotent — safe to run on every startup.
 *   - Non-fatal — logs the error and continues; does not crash the server.
 *   - Self-contained — no dependency on drizzle-kit push or migrations.
 *
 * WHY: system_settings is empty by default. The application has hardcoded fallback
 * defaults for every AI routing key, so the system works correctly with an empty
 * table. Seeding makes those defaults:
 *   (a) visible and inspectable via SQL
 *   (b) overridable by operators without a code deploy
 *   (c) logged clearly at startup so operators can see "from DB" vs "using default"
 *
 * Keys seeded (all can be changed live via SQL UPDATE with no restart needed,
 * EXCEPT ai_routing_mode which requires restart because it is read per-request):
 *
 *   ai_routing_mode      "credits"                     — routing algorithm
 *   ai_credits_threshold "50"                          — min balance for premium
 *   ai_free_provider     "cloudflare"                  — provider when credits < threshold
 *   ai_premium_provider  "openrouter"                  — provider when credits ≥ threshold
 *                                                         (requires OPENROUTER_API_KEY)
 *   ai_premium_model     "anthropic/claude-3.5-sonnet" — model for premium calls
 *
 * MIGRATION (runs after seed):
 *   If ai_premium_provider is still the old default "openai", it is upgraded to
 *   "openrouter" automatically. Custom operator values are left untouched.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Default values ───────────────────────────────────────────────────────────
// These must exactly match the hardcoded fallbacks in ai-core.ts so that seeding
// produces no behaviour change — it only makes the configuration explicit in the DB.

const AI_SETTING_DEFAULTS: Array<{ key: string; value: string; description: string }> = [
  {
    key:         "ai_routing_mode",
    value:       "credits",
    description: "Routing algorithm: 'credits' (balance-based), 'tier' (subscription tier), 'fixed'",
  },
  {
    key:         "ai_credits_threshold",
    value:       "50",
    description: "Minimum credit balance required to use the premium provider",
  },
  {
    key:         "ai_free_provider",
    value:       "cloudflare",
    description: "Provider used when org credits < threshold (always free, no deduction)",
  },
  {
    key:         "ai_premium_provider",
    value:       "openrouter",
    description: "Provider used when org credits >= threshold. Requires OPENROUTER_API_KEY.",
  },
  {
    key:         "ai_premium_model",
    value:       "anthropic/claude-3.5-sonnet",
    description: "Model for premium calls. Override per-deployment without code changes.",
  },
];

// ─── seedAISettings ───────────────────────────────────────────────────────────

export async function seedAISettings(): Promise<void> {
  try {
    let inserted = 0;
    let skipped  = 0;

    for (const setting of AI_SETTING_DEFAULTS) {
      const result = await db.execute(sql`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (${setting.key}, ${setting.value}, now())
        ON CONFLICT (key) DO NOTHING
        RETURNING key
      `);

      const rows = (result as any).rows ?? result;
      if (Array.isArray(rows) && rows.length > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }

    logger.info(
      { inserted, skipped, total: AI_SETTING_DEFAULTS.length },
      "[seed-ai-settings] AI routing defaults seeded",
    );

    if (inserted > 0) {
      logger.info(
        { keys: AI_SETTING_DEFAULTS.slice(0, inserted).map(s => s.key) },
        "[seed-ai-settings] new rows — verify with: SELECT key, value FROM system_settings WHERE key LIKE 'ai_%';",
      );
    }

    // ── Migration: upgrade old default "openai" → "openrouter" ───────────────
    // Runs after the seed loop so it catches both:
    //   (a) existing installations that had the old default seeded as "openai"
    //   (b) manual DB sets of "openai" that predate this migration
    // Custom operator values (anything that is not "openai") are left untouched.
    const migResult = await db.execute(sql`
      UPDATE system_settings
      SET    value      = 'openrouter',
             updated_at = now()
      WHERE  key   = 'ai_premium_provider'
        AND  value = 'openai'
      RETURNING key, value
    `);
    const migRows = (migResult as any).rows ?? migResult;
    if (Array.isArray(migRows) && migRows.length > 0) {
      logger.info(
        { from: "openai", to: "openrouter" },
        "[seed-ai-settings] migrated ai_premium_provider: openai → openrouter",
      );
    }
  } catch (err) {
    // Non-fatal — the app has hardcoded fallbacks for every key.
    // The routing will still work; only the DB visibility is missing.
    logger.error(
      { err },
      "[seed-ai-settings] failed — AI routing will use hardcoded defaults (no functional impact)",
    );
  }
}

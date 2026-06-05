/**
 * seedSecuritySettings — ensure default security policy rows exist in system_settings.
 *
 * DESIGN RULES (same as seedAISettings):
 *   - ON CONFLICT DO NOTHING — never overwrites values set by an operator.
 *   - Idempotent — safe to run on every startup.
 *   - Non-fatal — logs error and continues; does not crash the server.
 *
 * Keys seeded:
 *   password_min_length          "12"  — minimum password length (8–128)
 *   access_token_expiry_minutes  "30"  — JWT access token lifetime (5–120 min)
 *   session_timeout_minutes      "480" — refresh token / session lifetime (30–43200 min)
 *
 * Hard limits are enforced by security-settings.ts at read time, not here.
 * Changing these values via SQL UPDATE takes effect within 60 seconds (cache TTL).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const SECURITY_SETTING_DEFAULTS = [
  {
    key:         "password_min_length",
    value:       "12",
    description: "Minimum password length. Hard limits: min=8, max=128.",
  },
  {
    key:         "access_token_expiry_minutes",
    value:       "30",
    description: "JWT access token lifetime in minutes. Hard limits: min=5, max=120.",
  },
  {
    key:         "session_timeout_minutes",
    value:       "480",
    description: "Session (refresh token) lifetime in minutes. Hard limits: min=30, max=43200.",
  },
];

export async function seedSecuritySettings(): Promise<void> {
  try {
    let inserted = 0;
    let skipped  = 0;

    for (const setting of SECURITY_SETTING_DEFAULTS) {
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
      { inserted, skipped, total: SECURITY_SETTING_DEFAULTS.length },
      "[seed-security-settings] Security policy defaults seeded",
    );
  } catch (err) {
    logger.error(
      { err },
      "[seed-security-settings] failed — security settings will use hardcoded defaults (no functional impact)",
    );
  }
}

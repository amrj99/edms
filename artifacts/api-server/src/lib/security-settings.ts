/**
 * security-settings.ts — Centralized security policy reader.
 *
 * Reads configurable security values from system_settings.
 * All values are validated against hard limits so a misconfigured or
 * malicious system_settings row can never produce an insecure outcome.
 *
 * Hard limits (enforced regardless of DB value):
 *   password_min_length          min=8   max=128   default=12
 *   access_token_expiry_minutes  min=5   max=120   default=30
 *   session_timeout_minutes      min=30  max=43200 default=480
 *
 * Usage:
 *   import { getPasswordMinLength, getAccessTokenExpirySeconds, getRefreshTokenExpirySeconds } from "./security-settings.js";
 *
 * All functions are async (DB read) but results are cached for 60 seconds
 * so the overhead per request is negligible.
 */

import { getSystemSettingValue } from "./ai-core.js";
import { db, orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Cache ────────────────────────────────────────────────────────────────────
// Simple in-memory cache — TTL 60 seconds.
// Keeps DB reads to ~1/minute instead of per-request.

interface CacheEntry {
  value: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

async function getCachedSetting(
  key: string,
  defaultVal: number,
  min: number,
  max: number,
): Promise<number> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const raw = await getSystemSettingValue(key);
  const parsed = raw !== null ? parseInt(raw, 10) : NaN;

  let value: number;
  if (!Number.isFinite(parsed)) {
    value = defaultVal;
  } else {
    value = Math.min(max, Math.max(min, parsed));
  }

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Minimum password length.
 * system_settings key: password_min_length
 * Default: 12 | Min: 8 | Max: 128
 */
export async function getPasswordMinLength(): Promise<number> {
  return getCachedSetting("password_min_length", 12, 8, 128);
}

/**
 * Access token lifetime in SECONDS (for use with signToken).
 * system_settings key: access_token_expiry_minutes
 * Default: 30 min | Min: 5 min | Max: 120 min
 */
export async function getAccessTokenExpirySeconds(): Promise<number> {
  // Session Hardening: access token is deliberately SHORT (default 15 min, max 30).
  // Long-lived sessions are carried by the refresh token, never the access token.
  const minutes = await getCachedSetting("access_token_expiry_minutes", 15, 5, 30);
  return minutes * 60;
}

// ─── Per-tenant session policy (Session Management Hardening) ──────────────────
// Resolved from org_config (per-org), each value CLAMPED to system bounds so a
// tampered org row can never widen beyond safe limits. Tenant A's row is physically
// separate from B's → complete isolation. Cached per-org for 60s.
export interface OrgSessionPolicy {
  sessionTimeoutMinutes: number; // absolute session lifetime
  idleTimeoutMinutes: number;    // inactivity cutoff (always <= session lifetime)
  rememberMeEnabled: boolean;
  rememberMeDays: number;
}
const SESSION_BOUNDS = {
  session: { def: 480, min: 30, max: 43200 }, // 8h default, 30min .. 30d
  idle:    { def: 30,  min: 5,  max: 43200 }, // 30min default (further clamped <= session)
  rememberDays: { def: 7, min: 1, max: 30 },
};
const orgPolicyCache = new Map<number, { value: OrgSessionPolicy; expiresAt: number }>();
const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

export async function getOrgSessionPolicy(orgId: number | null | undefined): Promise<OrgSessionPolicy> {
  const fallback: OrgSessionPolicy = {
    sessionTimeoutMinutes: SESSION_BOUNDS.session.def,
    idleTimeoutMinutes: SESSION_BOUNDS.idle.def,
    rememberMeEnabled: true,
    rememberMeDays: SESSION_BOUNDS.rememberDays.def,
  };
  if (!orgId) return fallback;
  const now = Date.now();
  const cached = orgPolicyCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.value;

  let row: any = null;
  try {
    const [r] = await db
      .select({
        s: orgConfigTable.sessionTimeoutMinutes,
        i: orgConfigTable.idleTimeoutMinutes,
        e: orgConfigTable.rememberMeEnabled,
        d: orgConfigTable.rememberMeDays,
      })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, orgId))
      .limit(1);
    row = r ?? null;
  } catch {
    return fallback; // never fail closed into an insecure state — use safe defaults
  }

  const session = clampInt(row?.s, SESSION_BOUNDS.session.def, SESSION_BOUNDS.session.min, SESSION_BOUNDS.session.max);
  // idle must never exceed the absolute session lifetime, and never below its own floor
  const idle = Math.min(session, clampInt(row?.i, SESSION_BOUNDS.idle.def, SESSION_BOUNDS.idle.min, SESSION_BOUNDS.idle.max));
  const policy: OrgSessionPolicy = {
    sessionTimeoutMinutes: session,
    idleTimeoutMinutes: idle,
    rememberMeEnabled: typeof row?.e === "boolean" ? row.e : true,
    rememberMeDays: clampInt(row?.d, SESSION_BOUNDS.rememberDays.def, SESSION_BOUNDS.rememberDays.min, SESSION_BOUNDS.rememberDays.max),
  };
  orgPolicyCache.set(orgId, { value: policy, expiresAt: now + CACHE_TTL_MS });
  return policy;
}

/** Invalidate the per-org session-policy cache (call after a settings change). */
export function invalidateOrgSessionPolicy(orgId: number): void {
  orgPolicyCache.delete(orgId);
}

export { SESSION_BOUNDS };

/**
 * Session (refresh token) lifetime in SECONDS.
 * system_settings key: session_timeout_minutes
 * Default: 480 min (8 h) | Min: 30 min | Max: 43200 min (30 days)
 */
export async function getSessionTimeoutSeconds(): Promise<number> {
  const minutes = await getCachedSetting("session_timeout_minutes", 480, 30, 43200);
  return minutes * 60;
}

/**
 * Returns the absolute expiry Date for a new refresh token.
 * Replaces the hardcoded getRefreshTokenExpiryDate() in auth.ts.
 */
export async function getRefreshTokenExpiryDate(): Promise<Date> {
  const seconds = await getSessionTimeoutSeconds();
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Remember Me multiplier: extends session to 7× the normal timeout
 * (capped at 30 days / 43200 minutes).
 * Remember Me affects ONLY the refresh token — never the access token.
 */
export async function getRememberMeExpiryDate(): Promise<Date> {
  const seconds = await getSessionTimeoutSeconds();
  const rememberMeSeconds = Math.min(seconds * 7, 43200 * 60);
  return new Date(Date.now() + rememberMeSeconds * 1000);
}

/**
 * Validate a password against current policy.
 * Returns an error message string if invalid, or null if valid.
 */
export async function validatePasswordPolicy(password: string): Promise<string | null> {
  const minLength = await getPasswordMinLength();
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters long.`;
  }
  return null;
}

import { Request, Response, NextFunction } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { db, orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const isProd = process.env.NODE_ENV === "production";

// ─── Requests-per-minute caps per subscription tier ────────────────────────────
const TIER_RPM: Record<string, number | null> = {
  free:         300,
  basic:        600,
  professional: 1500,
  enterprise:   null, // unlimited — skip the limiter entirely
};

// ─── Org-tier cache (5-minute TTL) ────────────────────────────────────────────
const tierCache = new Map<number, { tier: string; expiresAt: number }>();

async function getOrgTier(orgId: number): Promise<string> {
  const cached = tierCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  try {
    const [cfg] = await db
      .select({ subscriptionTier: orgConfigTable.subscriptionTier })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, orgId))
      .limit(1);

    const tier = cfg?.subscriptionTier ?? "free";
    tierCache.set(orgId, { tier, expiresAt: Date.now() + 5 * 60_000 });
    return tier;
  } catch (err) {
    logger.warn({ err, orgId }, "tenant-rate-limit: tier lookup failed — defaulting to 'free'");
    return "free";
  }
}

/** Invalidate a cached tier (call after PUT /api/admin/ai-tier changes the tier). */
export function invalidateOrgTierCache(orgId: number): void {
  tierCache.delete(orgId);
}

// ─── Build a per-tier limiter (keyed by orgId) ────────────────────────────────
function buildLimiter(tier: string, rpm: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60_000,
    max: rpm,
    standardHeaders: true,
    legacyHeaders: false,
    // Disable the IPv6 IP-fallback check: our primary key is `org:<orgId>` (not a raw
    // IP). For the anon fallback we use CF-Connecting-IP, a canonical string from
    // Cloudflare — not req.ip — so the library's IPv6 normalisation warning is a
    // false positive here.
    validate: { keyGeneratorIpFallback: false },
    skip: () => !isProd,
    keyGenerator: (req: Request) =>
      `org:${req.user?.organizationId ?? req.realIp ?? req.ip ?? "unknown"}`,
    handler: (_req, res, _next, options) => {
      res.status(429).json({
        error:      "rate_limit_exceeded",
        retryAfter: Math.ceil(options.windowMs / 1000),
        tier,
        limit:      rpm,
      });
    },
  });
}

const limiters: Record<string, RateLimitRequestHandler> = {
  free:         buildLimiter("free",         300),
  basic:        buildLimiter("basic",        600),
  professional: buildLimiter("professional", 1500),
};

// ─── Fallback limiter for unauthenticated requests (IP-based) ─────────────────
const anonLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  skip: () => !isProd,
  keyGenerator: (req: Request) => req.realIp ?? req.ip ?? "unknown",
  handler: (_req, res, _next, options) => {
    res.status(429).json({
      error:      "rate_limit_exceeded",
      retryAfter: Math.ceil(options.windowMs / 1000),
      tier:       "anonymous",
      limit:      100,
    });
  },
});

// ─── Middleware ────────────────────────────────────────────────────────────────
/**
 * Per-tenant rate limiting, Cloudflare-aware.
 *
 * - Authenticated + org user  → tier-based limiter keyed on organizationId
 * - system_owner (no org)     → unlimited (internal/admin tool)
 * - Unauthenticated           → 100 req/min keyed on real IP
 *
 * Must run after requireAuth (so req.user is populated) and after extractRealIp.
 */
export async function tenantRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    return anonLimiter(req, res, next);
  }

  const orgId = req.user.organizationId;
  if (!orgId) {
    // system_owner spanning all orgs — no rate limit
    return next();
  }

  const tier = await getOrgTier(orgId);
  const rpm  = TIER_RPM[tier];

  if (rpm === null) {
    // enterprise — unlimited
    return next();
  }

  const limiter = limiters[tier] ?? limiters.free;
  return limiter(req, res, next);
}

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const _jwtSecret = process.env.JWT_SECRET;
if (!_jwtSecret) {
  throw new Error(
    "JWT_SECRET environment variable is not set. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\" " +
    "and set it as an environment secret before starting the server.",
  );
}
const JWT_SECRET: string = _jwtSecret;
const ACCESS_TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds
const REMEMBER_ME_EXPIRY = 60 * 60 * 24 * 7; // 7 days in seconds
const REFRESH_TOKEN_EXPIRY = 60 * 60 * 24 * 30; // 30 days

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function signToken(payload: object, expiresInSeconds: number = ACCESS_TOKEN_EXPIRY): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  }));
  const sig = base64url(
    crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = base64url(
      crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
    );
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, "base64").toString());
    // Check expiry
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Support legacy SHA256 hashes for backward compat during migration
  if (hash.length === 64 && !hash.startsWith("$2")) {
    const legacyHash = crypto.createHash("sha256").update(password + JWT_SECRET).digest("hex");
    return legacyHash === hash;
  }
  return bcrypt.compare(password, hash);
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Deterministic SHA-256 hash for storing share tokens.
 * Use this before writing a token to the DB and before looking one up.
 * bcrypt is not appropriate here because lookups require a deterministic hash.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getRefreshTokenExpiryDate(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);
}

export function getRememberMeExpiry(): number {
  return REMEMBER_ME_EXPIRY;
}

export interface AuthUser {
  id: number;
  email: string;
  role: string;
  organizationId?: number;
  isReadOnlyOverride?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "No token provided" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
    return;
  }
  req.user = payload as unknown as AuthUser;
  if (req.user.role === "system_owner") {
    const override = req.query.orgOverride;
    if (override && !isNaN(Number(override))) {
      req.user = { ...req.user, organizationId: Number(override) };
    }
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Returns true ONLY for the platform-level system owner.
 * Use this for cross-tenant operations — listing all organizations,
 * global server config, applying subscription tiers across orgs, etc.
 *
 * Do NOT use this where org-level admins should also have access.
 * For that, use isSysAdmin() which covers admin + system_owner.
 */
export function isSystemOwner(user: AuthUser): boolean {
  return user.role === "system_owner";
}

/**
 * Returns true for organization admins AND the platform system owner.
 * Use this for elevated within-org operations where both roles need access.
 * Do NOT use for cross-org operations — use isSystemOwner() there.
 *
 * @deprecated Prefer isOrgAdmin() + isSystemOwner() separately for clarity.
 * isSysAdmin() remains for backward compatibility in existing callers.
 */
export function isSysAdmin(user: AuthUser): boolean {
  return user.role === "system_owner" || user.role === "admin";
}

/**
 * Returns true for organization-level admins ONLY (role === "admin").
 * Does NOT include system_owner.
 *
 * Use this when the operation is scoped to a single org and you want to
 * be explicit that system_owner is handled separately (e.g. via isSystemOwner()).
 *
 * ─── When to use which ───────────────────────────────────────────────────────
 *   isOrgAdmin(user)    → org-scoped admin action (user management, config, etc.)
 *   isSystemOwner(user) → cross-tenant platform action (billing, global config)
 *   isSysAdmin(user)    → legacy: org admin OR system_owner (prefer the above pair)
 */
export function isOrgAdmin(user: AuthUser): boolean {
  return user.role === "admin";
}

export function requireSysAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!isSystemOwner(req.user)) { res.status(403).json({ error: "Forbidden", message: "System owner required" }); return; }
  next();
}


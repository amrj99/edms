import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "edms-secret-key-change-in-production";
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
    const legacySecret = process.env.JWT_SECRET || "edms-secret-key-change-in-production";
    const legacyHash = crypto.createHash("sha256").update(password + legacySecret).digest("hex");
    return legacyHash === hash;
  }
  return bcrypt.compare(password, hash);
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
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

export function isSysAdmin(user: AuthUser): boolean {
  return user.role === "system_owner" || user.role === "admin";
}

export function requireSysAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!isSysAdmin(req.user)) { res.status(403).json({ error: "Forbidden", message: "System admin required" }); return; }
  next();
}


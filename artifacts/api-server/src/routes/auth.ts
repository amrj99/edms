import { Router } from "express";
import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "@workspace/db";
import { usersTable, organizationsTable, passwordResetTokensTable, refreshTokensTable, systemSettingsTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import {
  signToken,
  hashPassword,
  verifyPassword,
  generateSecureToken,
  hashToken,
  getRefreshTokenExpiryDate,
  getRememberMeExpiry,
  verifyToken,
  requireAuth,
} from "../lib/auth.js";
import { sendWelcomeEmail, sendPasswordResetEmail, sendEmailVerificationEmail, APP_URL } from "../lib/email.js";
import { createAuditLog } from "../lib/audit.js";
import { grantCredits } from "../lib/ai-credits.js";
import { getDefaultModulesForPlan } from "../lib/plans.js";
import { getTrialEndDate, TRIAL_PLAN_ID, TRIAL_AI_CREDITS } from "../lib/trial.js";
import { isDisposableEmail } from "../lib/disposable-emails.js";
import { orgConfigTable } from "@workspace/db/schema";

const router = Router();

// ─── Progressive login lockout tracker ───────────────────────────────────────
// 7 attempts per 15-minute window. Progressive lockout: 5 → 15 → 30 minutes.
// Resets fully after the observation window expires (and no active lockout).
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 7;
const LOGIN_LOCKOUT_DURATIONS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

interface LoginAttemptRecord {
  attempts: number;
  lockedUntil: number;
  lockoutCount: number;
  windowStart: number;
}

const loginAttempts = new Map<string, LoginAttemptRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of loginAttempts.entries()) {
    if (now > rec.lockedUntil && now - rec.windowStart > LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }
}, 30 * 60 * 1000).unref();

function getAttemptRecord(ip: string, now: number): LoginAttemptRecord {
  const rec = loginAttempts.get(ip);
  if (!rec) {
    const fresh = { attempts: 0, lockedUntil: 0, lockoutCount: 0, windowStart: now };
    loginAttempts.set(ip, fresh);
    return fresh;
  }
  if (rec.lockedUntil && now < rec.lockedUntil) return rec;
  if (now - rec.windowStart > LOGIN_WINDOW_MS) {
    const fresh = { attempts: 0, lockedUntil: 0, lockoutCount: 0, windowStart: now };
    loginAttempts.set(ip, fresh);
    return fresh;
  }
  return rec;
}

function recordLoginFailure(ip: string): { attemptsRemaining: number; locked: boolean; lockoutMinutes?: number } {
  const now = Date.now();
  const rec = getAttemptRecord(ip, now);
  rec.attempts++;
  if (rec.attempts >= LOGIN_MAX_ATTEMPTS) {
    const ms = LOGIN_LOCKOUT_DURATIONS_MS[Math.min(rec.lockoutCount, LOGIN_LOCKOUT_DURATIONS_MS.length - 1)];
    rec.lockedUntil = now + ms;
    rec.lockoutCount++;
    rec.attempts = 0;
    return { attemptsRemaining: 0, locked: true, lockoutMinutes: Math.round(ms / 60000) };
  }
  return { attemptsRemaining: LOGIN_MAX_ATTEMPTS - rec.attempts, locked: false };
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator((req as any).realIp ?? req.ip ?? "unknown"),
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too Many Requests",
      message: "Too many password reset requests. Please wait 15 minutes before trying again.",
    });
  },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator((req as any).realIp ?? req.ip ?? "unknown"),
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too Many Requests",
      message: "Too many password reset attempts. Please wait 15 minutes before trying again.",
    });
  },
});

function buildUserResponse(user: typeof usersTable.$inferSelect, orgName?: string) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: orgName,
    isActive: user.isActive,
    createdAt: user.createdAt,
    acceptedTermsAt: user.acceptedTermsAt,
    acceptedTermsVersion: user.acceptedTermsVersion,
  };
}

router.post("/login", async (req, res) => {
  const body = req.body ?? {};
  const { email, password, rememberMe } = body;
  if (!email || !password) {
    res.status(400).json({ error: "Bad Request", message: "Email and password are required" });
    return;
  }

  const ip = (req as any).realIp ?? req.ip ?? "unknown";

  // Check active lockout before doing any DB work
  const now = Date.now();
  const rec = getAttemptRecord(ip, now);
  if (rec.lockedUntil && now < rec.lockedUntil) {
    const minutes = Math.ceil((rec.lockedUntil - now) / 60000);
    res.status(429).json({
      error: "Too Many Requests",
      message: `Too many login attempts. Please wait ${minutes} minute${minutes !== 1 ? "s" : ""} before trying again.`,
      retryAfterSeconds: Math.ceil((rec.lockedUntil - now) / 1000),
    });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  const user = users[0];

  if (!user) {
    createAuditLog({ action: "login_failure", entityType: "auth", entityId: 0, entityTitle: email, details: { reason: "user_not_found" }, ipAddress: ip });
    const { attemptsRemaining, locked, lockoutMinutes } = recordLoginFailure(ip);
    if (locked) {
      res.status(429).json({ error: "Too Many Requests", message: `Too many login attempts. Please wait ${lockoutMinutes} minute${lockoutMinutes !== 1 ? "s" : ""} before trying again.`, retryAfterSeconds: lockoutMinutes! * 60 });
    } else {
      res.status(401).json({ error: "Unauthorized", message: "Invalid email or password", attemptsRemaining });
    }
    return;
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    createAuditLog({ userId: user.id, organizationId: user.organizationId ?? undefined, action: "login_failure", entityType: "auth", entityId: user.id, entityTitle: email, details: { reason: "invalid_password" }, ipAddress: ip });
    const { attemptsRemaining, locked, lockoutMinutes } = recordLoginFailure(ip);
    if (locked) {
      res.status(429).json({ error: "Too Many Requests", message: `Too many login attempts. Please wait ${lockoutMinutes} minute${lockoutMinutes !== 1 ? "s" : ""} before trying again.`, retryAfterSeconds: lockoutMinutes! * 60 });
    } else {
      res.status(401).json({ error: "Unauthorized", message: "Invalid email or password", attemptsRemaining });
    }
    return;
  }

  if (!user.isActive) {
    createAuditLog({ userId: user.id, organizationId: user.organizationId ?? undefined, action: "login_failure", entityType: "auth", entityId: user.id, entityTitle: email, details: { reason: "account_disabled" }, ipAddress: ip });
    res.status(403).json({ error: "Forbidden", message: "Your account has been disabled. Please contact your administrator." });
    return;
  }

  let orgName: string | undefined;
  if (user.organizationId) {
    const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
    orgName = orgs[0]?.name;
  }

  const tokenExpiry = rememberMe ? getRememberMeExpiry() : undefined;
  const accessToken = signToken({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId }, tokenExpiry);

  // Generate refresh token — store SHA-256 hash in DB, return plaintext to client
  const refreshToken = generateSecureToken();
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    token: hashToken(refreshToken),
    expiresAt: getRefreshTokenExpiryDate(),
  });

  clearLoginAttempts(ip);
  createAuditLog({ userId: user.id, organizationId: user.organizationId ?? undefined, action: "login_success", entityType: "auth", entityId: user.id, entityTitle: email, ipAddress: ip });

  res.json({
    token: accessToken,
    refreshToken,
    user: buildUserResponse(user, orgName),
  });
});

router.post("/register", async (req, res) => {
  const { email, password, firstName, lastName } = req.body ?? {};

  const [regSetting] = await db.select().from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "registrationEnabled"));
  const registrationEnabled = regSetting?.value !== "false";

  const allExisting = await db.select().from(usersTable).limit(1);
  const isFirstEver = allExisting.length === 0;

  if (!registrationEnabled && !isFirstEver) {
    res.status(403).json({ error: "Forbidden", message: "Public registration is currently disabled. Please contact your administrator." });
    return;
  }

  if (!email || !password || !firstName || !lastName) {
    res.status(400).json({ error: "Bad Request", message: "All fields are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Bad Request", message: "Password must be at least 8 characters" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
  if (existing.length > 0) {
    res.status(400).json({ error: "Bad Request", message: "An account with this email already exists" });
    return;
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase().trim(),
    passwordHash,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    role: isFirstEver ? "admin" : "viewer",
    organizationId: null,
    isActive: true,
  }).returning();

  const accessToken = signToken({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId });

  const refreshToken = generateSecureToken();
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    token: hashToken(refreshToken),
    expiresAt: getRefreshTokenExpiryDate(),
  });

  // Welcome email — fire and forget
  let orgName: string | undefined;
  if (user.organizationId) {
    const [org] = await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
    orgName = org?.name;
  }
  sendWelcomeEmail({ to: user.email, firstName: user.firstName, organizationName: orgName }).catch(() => {});

  res.status(201).json({
    token: accessToken,
    refreshToken,
    user: buildUserResponse(user, orgName),
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const users = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  const user = users[0];
  if (!user) {
    res.status(404).json({ error: "Not Found" });
    return;
  }

  let orgName: string | undefined;
  if (user.organizationId) {
    const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
    orgName = orgs[0]?.name;
  }

  res.json(buildUserResponse(user, orgName));
});

// ── Terms acceptance ──────────────────────────────────────────────────────────

router.post("/accept-terms", requireAuth, async (req, res) => {
  const { version = "1.0" } = req.body ?? {};
  const ip = (req as any).realIp ?? req.ip ?? "unknown";
  const [updated] = await db.update(usersTable)
    .set({ acceptedTermsAt: new Date(), acceptedTermsVersion: String(version), updatedAt: new Date() })
    .where(eq(usersTable.id, req.user!.id))
    .returning();
  createAuditLog({ userId: req.user!.id, organizationId: req.user!.organizationId ?? undefined, action: "terms_accepted", entityType: "user", entityId: req.user!.id, details: { version }, ipAddress: ip });
  res.json({ acceptedTermsAt: updated.acceptedTermsAt, acceptedTermsVersion: updated.acceptedTermsVersion });
});

// Admin endpoint — force all org users to re-accept terms
router.post("/require-terms-reacceptance", requireAuth, async (req, res) => {
  const user = req.user!;
  if (!["system_owner", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const orgId = user.organizationId;
  if (!orgId && user.role !== "system_owner") {
    res.status(400).json({ error: "No organization context" });
    return;
  }
  let updateQuery = db.update(usersTable).set({ acceptedTermsAt: null, acceptedTermsVersion: null, updatedAt: new Date() });
  const affected = orgId
    ? await (updateQuery as any).where(eq(usersTable.organizationId, orgId)).returning()
    : await (updateQuery as any).returning();
  createAuditLog({ userId: user.id, organizationId: orgId ?? undefined, action: "terms_reacceptance_required", entityType: "organization", entityId: orgId ?? 0, details: { affectedUsers: affected.length } });
  res.json({ message: `${affected.length} users will be prompted to re-accept terms.` });
});

router.post("/refresh-token", async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ error: "Bad Request", message: "Refresh token is required" });
    return;
  }

  const tokens = await db.select().from(refreshTokensTable)
    .where(and(
      eq(refreshTokensTable.token, hashToken(refreshToken)),
      gt(refreshTokensTable.expiresAt, new Date())
    ))
    .limit(1);

  const tokenRecord = tokens[0];
  if (!tokenRecord || tokenRecord.revokedAt) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired refresh token" });
    return;
  }

  const users = await db.select().from(usersTable).where(eq(usersTable.id, tokenRecord.userId)).limit(1);
  const user = users[0];
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Unauthorized", message: "User account not found or disabled" });
    return;
  }

  // Verify refresh token is bound to the same organization as the user
  if (tokenRecord.organizationId !== null && tokenRecord.organizationId !== user.organizationId) {
    res.status(401).json({ error: "Unauthorized", message: "Token organization mismatch" });
    return;
  }

  // Revoke old token and issue new ones
  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokensTable.id, tokenRecord.id));

  const newAccessToken = signToken({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId });
  const newRefreshToken = generateSecureToken();

  await db.insert(refreshTokensTable).values({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    token: hashToken(newRefreshToken),
    expiresAt: getRefreshTokenExpiryDate(),
  });

  res.json({ token: newAccessToken, refreshToken: newRefreshToken });
});

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) {
    res.status(400).json({ error: "Bad Request", message: "Email is required" });
    return;
  }

  // Always respond with success to prevent email enumeration
  const users = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);

  if (users[0]) {
    const user = users[0];
    const resetToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store SHA-256 hash in DB; send plaintext token in the email URL
    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      organizationId: user.organizationId ?? null,
      token: hashToken(resetToken),
      expiresAt,
    });

    // Send password reset email via Resend
    const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;
    sendPasswordResetEmail({ to: user.email, firstName: user.firstName, resetUrl }).catch(() => {});

    res.json({
      message: "If an account with that email exists, a password reset link has been sent.",
    });
    return;
  }

  res.json({
    message: "If an account with that email exists, a password reset link has been sent.",
  });
});

router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body ?? {};
  if (!token || !password) {
    res.status(400).json({ error: "Bad Request", message: "Token and new password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Bad Request", message: "Password must be at least 8 characters" });
    return;
  }

  // Atomic claim: mark the token used in a single UPDATE so concurrent requests
  // cannot both pass the "not yet used" check. Only the first request wins;
  // subsequent ones find used_at already set and receive 0 rows back.
  // Hash the provided token before lookup — DB stores SHA-256 hashes only
  const [claimedToken] = await db.update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(and(
      eq(passwordResetTokensTable.token, hashToken(token)),
      gt(passwordResetTokensTable.expiresAt, new Date()),
      isNull(passwordResetTokensTable.usedAt),
    ))
    .returning();

  if (!claimedToken) {
    res.status(400).json({ error: "Bad Request", message: "Invalid or expired reset token. Please request a new one." });
    return;
  }

  // Secondary integrity check: token must belong to the user's org.
  const [tokenOwner] = await db.select().from(usersTable).where(eq(usersTable.id, claimedToken.userId)).limit(1);
  if (!tokenOwner) {
    res.status(400).json({ error: "Bad Request", message: "Invalid reset token." });
    return;
  }
  if (claimedToken.organizationId !== null && claimedToken.organizationId !== tokenOwner.organizationId) {
    res.status(400).json({ error: "Bad Request", message: "Invalid reset token." });
    return;
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();

  await db.update(usersTable)
    .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
    .where(eq(usersTable.id, claimedToken.userId));

  // Token already marked used atomically above — no second UPDATE needed.

  // Revoke all refresh tokens for this user.
  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokensTable.userId, claimedToken.userId));

  res.json({ message: "Password has been reset successfully. You can now log in with your new password." });
});

// ─── Register-org rate limiter ────────────────────────────────────────────────
// 3 new organisations per IP per hour — blocks rapid abuse / bots.
const registerOrgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too Many Requests", message: "Too many sign-up attempts from this IP. Please try again in an hour." });
  },
});

// ─── Self-service org registration ────────────────────────────────────────────
// Public endpoint — no auth required.
// Creates a trial org (14 days) + initial admin user. Grants 1 000 AI credits.
router.post("/register-org", registerOrgLimiter, async (req, res) => {
  const { orgName, adminFirstName, adminLastName, adminEmail, adminPassword } = req.body ?? {};

  if (!orgName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
    res.status(400).json({ error: "Bad Request", message: "orgName, adminFirstName, adminLastName, adminEmail, adminPassword are all required" });
    return;
  }

  if (adminPassword.length < 8) {
    res.status(400).json({ error: "Bad Request", message: "Password must be at least 8 characters" });
    return;
  }

  // Block disposable / throwaway email domains
  if (isDisposableEmail(adminEmail)) {
    res.status(400).json({ error: "Bad Request", message: "Please use a valid work or personal email address. Disposable email addresses are not accepted." });
    return;
  }

  // Check email not already taken
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, adminEmail.toLowerCase().trim())).limit(1);
  if (existing.length > 0) {
    res.status(400).json({ error: "Conflict", message: "An account with this email already exists" });
    return;
  }

  // Check org name not already taken
  const existingOrg = await db.select().from(organizationsTable).where(eq(organizationsTable.name, orgName.trim())).limit(1);
  if (existingOrg.length > 0) {
    res.status(400).json({ error: "Conflict", message: "An organisation with this name already exists" });
    return;
  }

  // Create trial organisation
  const trialEndsAt = getTrialEndDate();
  const [org] = await db.insert(organizationsTable).values({
    name: orgName.trim(),
    type: "client",
    subscriptionTier: TRIAL_PLAN_ID,
    trialEndsAt,
  }).returning();

  // Set up default module flags for the trial plan
  const modules = getDefaultModulesForPlan(TRIAL_PLAN_ID);
  await db.insert(orgConfigTable).values({ organizationId: org.id, modules }).catch(() => {});

  // Create admin user (email unverified until token is clicked)
  const passwordHash = await hashPassword(adminPassword);
  const emailVerificationToken = crypto.randomBytes(32).toString("hex");

  const [user] = await db.insert(usersTable).values({
    email: adminEmail.toLowerCase().trim(),
    passwordHash,
    firstName: adminFirstName.trim(),
    lastName: adminLastName.trim(),
    role: "admin",
    organizationId: org.id,
    isActive: true,
    emailVerificationToken,
  }).returning();

  // Auto-grant trial AI credits (fire-and-forget — non-fatal if it fails)
  grantCredits(org.id, TRIAL_AI_CREDITS, "grant", { reason: "trial_signup" }).catch(() => {});

  // Send verification email — non-fatal, log only
  sendEmailVerificationEmail({
    to: user.email,
    firstName: user.firstName,
    token: emailVerificationToken,
  }).catch(() => {});

  createAuditLog({
    userId: user.id,
    organizationId: org.id,
    action: "trial_org_created",
    entityType: "organization",
    entityId: org.id,
    entityTitle: org.name,
  });

  res.status(201).json({
    success: true,
    message: `Organisation "${org.name}" created on a 14-day free trial. Please check your email to verify your address.`,
    orgId: org.id,
    orgName: org.name,
    userId: user.id,
    trialEndsAt: trialEndsAt.toISOString(),
    // Dev convenience — token also emailed when RESEND_API_KEY is set
    emailVerificationToken,
    note: "Check your email to verify your address. In dev mode the token is also included in this response.",
  });
});

// ─── Email verification ────────────────────────────────────────────────────────
// GET /api/auth/verify-email?token=<hex>
router.get("/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Bad Request", message: "token is required" });
    return;
  }

  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.emailVerificationToken, token))
    .limit(1);

  if (!user) {
    res.status(400).json({ error: "Invalid Token", message: "Verification link is invalid or has already been used." });
    return;
  }

  await db.update(usersTable).set({
    emailVerifiedAt: new Date(),
    emailVerificationToken: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  createAuditLog({
    userId: user.id,
    organizationId: user.organizationId ?? undefined,
    action: "email_verified",
    entityType: "user",
    entityId: user.id,
    entityTitle: user.email,
  });

  res.json({ success: true, message: "Email verified successfully. You can now upload files." });
});

export default router;

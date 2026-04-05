import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, organizationsTable, passwordResetTokensTable, refreshTokensTable, systemSettingsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import {
  signToken,
  hashPassword,
  verifyPassword,
  generateSecureToken,
  getRefreshTokenExpiryDate,
  getRememberMeExpiry,
  verifyToken,
  requireAuth,
} from "../lib/auth.js";
import { sendWelcomeEmail, sendPasswordResetEmail, APP_URL } from "../lib/email.js";

const router = Router();

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
  };
}

router.post("/login", async (req, res) => {
  const body = req.body ?? {};
  const { email, password, rememberMe } = body;
  if (!email || !password) {
    res.status(400).json({ error: "Bad Request", message: "Email and password are required" });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  const user = users[0];
  if (!user) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" });
    return;
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" });
    return;
  }

  if (!user.isActive) {
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

  // Generate refresh token
  const refreshToken = generateSecureToken();
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    token: refreshToken,
    expiresAt: getRefreshTokenExpiryDate(),
  });

  res.json({
    token: accessToken,
    refreshToken,
    user: buildUserResponse(user, orgName),
  });
});

router.post("/register", async (req, res) => {
  const { email, password, firstName, lastName, organizationId } = req.body ?? {};

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
    organizationId: organizationId || null,
    isActive: true,
  }).returning();

  const accessToken = signToken({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId });

  const refreshToken = generateSecureToken();
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    token: refreshToken,
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

router.post("/refresh-token", async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ error: "Bad Request", message: "Refresh token is required" });
    return;
  }

  const tokens = await db.select().from(refreshTokensTable)
    .where(and(
      eq(refreshTokensTable.token, refreshToken),
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
    token: newRefreshToken,
    expiresAt: getRefreshTokenExpiryDate(),
  });

  res.json({ token: newAccessToken, refreshToken: newRefreshToken });
});

router.post("/forgot-password", async (req, res) => {
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

    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      organizationId: user.organizationId ?? null,
      token: resetToken,
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

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body ?? {};
  if (!token || !password) {
    res.status(400).json({ error: "Bad Request", message: "Token and new password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Bad Request", message: "Password must be at least 8 characters" });
    return;
  }

  const tokens = await db.select().from(passwordResetTokensTable)
    .where(and(
      eq(passwordResetTokensTable.token, token),
      gt(passwordResetTokensTable.expiresAt, new Date())
    ))
    .limit(1);

  const tokenRecord = tokens[0];
  if (!tokenRecord || tokenRecord.usedAt) {
    res.status(400).json({ error: "Bad Request", message: "Invalid or expired reset token. Please request a new one." });
    return;
  }

  // Verify token belongs to the same org as the user it targets
  const [tokenOwner] = await db.select().from(usersTable).where(eq(usersTable.id, tokenRecord.userId)).limit(1);
  if (!tokenOwner) {
    res.status(400).json({ error: "Bad Request", message: "Invalid reset token." });
    return;
  }
  if (tokenRecord.organizationId !== null && tokenRecord.organizationId !== tokenOwner.organizationId) {
    res.status(400).json({ error: "Bad Request", message: "Invalid reset token." });
    return;
  }

  const passwordHash = await hashPassword(password);

  await db.update(usersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(usersTable.id, tokenRecord.userId));

  await db.update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.id, tokenRecord.id));

  // Revoke all refresh tokens for this user
  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokensTable.userId, tokenRecord.userId));

  res.json({ message: "Password has been reset successfully. You can now log in with your new password." });
});

// ─── Self-service org registration ────────────────────────────────────────────
// Public endpoint — no auth required. Creates a new org + initial admin user.
router.post("/register-org", async (req, res) => {
  const { orgName, adminFirstName, adminLastName, adminEmail, adminPassword } = req.body ?? {};

  if (!orgName || !adminEmail || !adminPassword || !adminFirstName || !adminLastName) {
    res.status(400).json({ error: "Bad Request", message: "orgName, adminFirstName, adminLastName, adminEmail, adminPassword are all required" });
    return;
  }

  if (adminPassword.length < 8) {
    res.status(400).json({ error: "Bad Request", message: "Password must be at least 8 characters" });
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

  // Create organisation
  const [org] = await db.insert(organizationsTable).values({
    name: orgName.trim(),
    type: "client",
  }).returning();

  // Create admin user
  const passwordHash = await hashPassword(adminPassword);
  const verificationToken = crypto.randomBytes(32).toString("hex");

  const [user] = await db.insert(usersTable).values({
    email: adminEmail.toLowerCase().trim(),
    passwordHash,
    firstName: adminFirstName.trim(),
    lastName: adminLastName.trim(),
    role: "admin",
    organizationId: org.id,
    isActive: true,
  }).returning();

  // Return verification token in response (dev mode — no SMTP required)
  res.status(201).json({
    success: true,
    message: "Organisation and admin account created successfully.",
    orgId: org.id,
    orgName: org.name,
    userId: user.id,
    verificationToken,
    note: "In production, the verification token would be emailed. For now it is returned in this response.",
  });
});

export default router;

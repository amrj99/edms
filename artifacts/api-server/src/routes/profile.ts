import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable, userPreferencesTable, auditLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, hashPassword, verifyPassword } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

// ─── GET /api/profile ──────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      organizationId: usersTable.organizationId,
      organizationName: organizationsTable.name,
      department: usersTable.department,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(organizationsTable, eq(usersTable.organizationId, organizationsTable.id))
    .where(eq(usersTable.id, userId));

  if (!user) return res.status(404).json({ error: "User not found" });

  const [prefs] = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId));

  const recentActivity = await db
    .select({
      id: auditLogsTable.id,
      action: auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      details: auditLogsTable.details,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.userId, userId))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(5);

  res.json({
    user,
    notificationPrefs: prefs?.notificationPrefs ?? {},
    recentActivity,
  });
});

// ─── PUT /api/profile ──────────────────────────────────────────────────────────
router.put("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { firstName, lastName, email, department } = req.body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return res.status(400).json({ error: "Bad Request", message: "First name, last name, and email are required" });
  }

  // Check email uniqueness (excluding current user)
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.trim().toLowerCase()));

  if (existing.length > 0 && existing[0].id !== userId) {
    return res.status(409).json({ error: "Conflict", message: "Email already in use by another account" });
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      department: department?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      department: usersTable.department,
    });

  res.json({ user: updated });
});

// ─── PUT /api/profile/password ────────────────────────────────────────────────
router.put("/password", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Bad Request", message: "Current and new passwords are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Bad Request", message: "New password must be at least 8 characters" });
  }

  const [user] = await db
    .select({ passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) return res.status(404).json({ error: "User not found" });

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Unauthorized", message: "Current password is incorrect" });
  }

  const newHash = await hashPassword(newPassword);
  const now = new Date();
  await db
    .update(usersTable)
    .set({ passwordHash: newHash, passwordChangedAt: now, updatedAt: now })
    .where(eq(usersTable.id, userId));

  res.json({ message: "Password updated successfully" });
});

// ─── PUT /api/profile/notification-prefs ─────────────────────────────────────
router.put("/notification-prefs", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { notificationPrefs } = req.body;

  if (!notificationPrefs || typeof notificationPrefs !== "object") {
    return res.status(400).json({ error: "Bad Request", message: "notificationPrefs must be an object" });
  }

  const existing = await db
    .select({ id: userPreferencesTable.id })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId));

  if (existing.length > 0) {
    await db
      .update(userPreferencesTable)
      .set({ notificationPrefs, updatedAt: new Date() })
      .where(eq(userPreferencesTable.userId, userId));
  } else {
    await db.insert(userPreferencesTable).values({
      userId,
      notificationPrefs,
    });
  }

  res.json({ notificationPrefs });
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, hashPassword, verifyPassword, requireAuth } from "../lib/auth.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Bad Request", message: "Email and password required" });
    return;
  }
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  const user = users[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "Forbidden", message: "Account is disabled" });
    return;
  }

  let orgName: string | undefined;
  if (user.organizationId) {
    const orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId)).limit(1);
    orgName = orgs[0]?.name;
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: orgName,
      isActive: user.isActive,
      createdAt: user.createdAt,
    },
  });
});

router.post("/register", async (req, res) => {
  const { email, password, firstName, lastName, organizationId } = req.body;
  if (!email || !password || !firstName || !lastName) {
    res.status(400).json({ error: "Bad Request", message: "All fields required" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    res.status(400).json({ error: "Bad Request", message: "Email already registered" });
    return;
  }

  const isFirstUser = (await db.select().from(usersTable).limit(1)).length === 0;

  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    firstName,
    lastName,
    role: isFirstUser ? "admin" : "viewer",
    organizationId: organizationId || null,
    isActive: true,
  }).returning();

  const token = signToken({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId });
  res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      isActive: user.isActive,
      createdAt: user.createdAt,
    },
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

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: orgName,
    isActive: user.isActive,
    createdAt: user.createdAt,
  });
});

export default router;

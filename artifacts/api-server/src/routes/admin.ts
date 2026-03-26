import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  usersTable, projectsTable, organizationsTable, documentsTable,
  correspondenceTable, transmittalsTable, tasksTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth.js";
import { testSmtpConnection } from "../lib/email.js";

const router = Router();

router.use(requireAuth);

// ─── System Info ──────────────────────────────────────────────────────────────
router.get("/system-info", async (req, res) => {
  const countRow = async (table: any) => {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    return r?.n ?? 0;
  };

  const [users, projects, documents, orgs] = await Promise.all([
    countRow(usersTable),
    countRow(projectsTable),
    countRow(documentsTable),
    countRow(organizationsTable),
  ]);

  res.json({
    counts: { users, projects, documents, organizations: orgs },
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV ?? "development",
    emailConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    storageConfigured: !!(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID),
    appUrl: process.env.APP_URL ?? null,
    smtpHost: process.env.SMTP_HOST ?? null,
    smtpFrom: process.env.SMTP_FROM ?? null,
  });
});

// ─── SMTP Test ────────────────────────────────────────────────────────────────
router.post("/smtp/test", async (req, res) => {
  const result = await testSmtpConnection();
  res.json(result);
});

// ─── Backup ───────────────────────────────────────────────────────────────────
router.get("/backup", async (req, res) => {
  const [users, projects, orgs, documents, correspondence, transmittals, tasks] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(projectsTable),
    db.select().from(organizationsTable),
    db.select().from(documentsTable),
    db.select().from(correspondenceTable),
    db.select().from(transmittalsTable),
    db.select().from(tasksTable),
  ]);

  const safeUsers = users.map((u: any) => {
    const { passwordHash, ...rest } = u;
    return rest;
  });

  const backup = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    tables: {
      users: safeUsers,
      projects,
      organizations: orgs,
      documents,
      correspondence,
      transmittals,
      tasks,
    },
    meta: {
      counts: {
        users: users.length,
        projects: projects.length,
        organizations: orgs.length,
        documents: documents.length,
        correspondence: correspondence.length,
        transmittals: transmittals.length,
        tasks: tasks.length,
      },
    },
  };

  const filename = `edms-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(backup);
});

// ─── Restore validation (dry-run) ─────────────────────────────────────────────
router.post("/restore/validate", async (req, res) => {
  const { backup } = req.body ?? {};
  if (!backup || !backup.version || !backup.tables) {
    res.status(400).json({ error: "Invalid backup format. Expected {version, exportedAt, tables}." });
    return;
  }
  const tables = Object.keys(backup.tables);
  const counts = Object.fromEntries(
    tables.map(t => [t, Array.isArray(backup.tables[t]) ? backup.tables[t].length : 0])
  );
  res.json({
    valid: true,
    exportedAt: backup.exportedAt,
    version: backup.version,
    tables,
    counts,
    message: "Backup file is valid. Contact your system administrator to restore this backup to the database.",
  });
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import {
  usersTable, projectsTable, organizationsTable, documentsTable,
  correspondenceTable, transmittalsTable, tasksTable, orgConfigTable,
} from "@workspace/db";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import { testSmtpConnection } from "../lib/email.js";

const router = Router();

router.use(requireAuth);

// ─── System Info ──────────────────────────────────────────────────────────────
router.get("/system-info", async (req, res) => {
  const user = req.user!;
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

// ─── Storage Usage ─────────────────────────────────────────────────────────────
router.get("/storage-usage", async (req, res) => {
  const user = req.user!;

  const usageRows = await db
    .select({
      orgId: projectsTable.organizationId,
      totalBytes: sql<number>`coalesce(sum(${documentsTable.fileSize}), 0)::bigint`,
      docCount: sql<number>`count(${documentsTable.id})::int`,
    })
    .from(documentsTable)
    .leftJoin(projectsTable, eq(documentsTable.projectId, projectsTable.id))
    .groupBy(projectsTable.organizationId);

  const configs = await db.select().from(orgConfigTable);
  const configMap = new Map(configs.map(c => [c.organizationId, c]));

  let orgs: any[] = [];
  if (isSysAdmin(user)) {
    orgs = await db.select().from(organizationsTable);
  } else if (user.organizationId) {
    orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId));
  }

  const result = orgs.map(org => {
    const usage = usageRows.find(r => r.orgId === org.id);
    const config = configMap.get(org.id);
    const usedBytes = Number(usage?.totalBytes ?? 0);
    const quotaMb = config?.storageQuotaMb ?? 10240;
    const usedMb = Math.round(usedBytes / 1024 / 1024 * 100) / 100;
    return {
      orgId: org.id,
      orgName: org.name,
      usedMb,
      usedBytes,
      quotaMb,
      docCount: usage?.docCount ?? 0,
      percentUsed: quotaMb > 0 ? Math.min(100, Math.round((usedMb / quotaMb) * 100)) : 0,
      storagePath: config?.storagePath ?? null,
    };
  });

  res.json({ usage: result });
});

// ─── Update Storage Config per org ────────────────────────────────────────────
router.put("/storage-config/:orgId", async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = parseInt(req.params.orgId);
  const { storageQuotaMb, storagePath } = req.body;

  const existing = await db.select().from(orgConfigTable).where(eq(orgConfigTable.organizationId, orgId)).limit(1);
  if (existing.length === 0) {
    await db.insert(orgConfigTable).values({ organizationId: orgId, storageQuotaMb, storagePath });
  } else {
    await db.update(orgConfigTable).set({ storageQuotaMb, storagePath, updatedAt: new Date() }).where(eq(orgConfigTable.organizationId, orgId));
  }
  res.json({ success: true });
});

// ─── Backup ───────────────────────────────────────────────────────────────────
router.get("/backup", async (req, res) => {
  const user = req.user!;
  const orgId = user.organizationId;

  let projectsFilter = await db.select().from(projectsTable);
  if (!isSysAdmin(user) && orgId) {
    projectsFilter = projectsFilter.filter(p => p.organizationId === orgId);
  }
  const projectIds = new Set(projectsFilter.map(p => p.id));

  const [allUsers, allOrgs, allDocuments, allCorrespondence, allTransmittals, allTasks] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(organizationsTable),
    db.select().from(documentsTable),
    db.select().from(correspondenceTable),
    db.select().from(transmittalsTable),
    db.select().from(tasksTable),
  ]);

  const scopeByProject = (rows: any[]) => rows.filter(r => !r.projectId || projectIds.has(r.projectId));

  const safeUsers = (isSysAdmin(user) ? allUsers : allUsers.filter(u => u.organizationId === orgId))
    .map(({ passwordHash, ...u }: any) => u);

  const backup = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    organizationId: orgId ?? null,
    tables: {
      users: safeUsers,
      organizations: isSysAdmin(user) ? allOrgs : allOrgs.filter(o => o.id === orgId),
      projects: projectsFilter,
      documents: scopeByProject(allDocuments),
      correspondence: scopeByProject(allCorrespondence),
      transmittals: scopeByProject(allTransmittals),
      tasks: scopeByProject(allTasks),
    },
  };

  backup.tables.meta = {
    counts: Object.fromEntries(Object.entries(backup.tables).filter(([k]) => Array.isArray(backup.tables[k])).map(([k, v]) => [k, (v as any[]).length])),
  } as any;

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
  const tables = Object.keys(backup.tables).filter(k => Array.isArray(backup.tables[k]));
  const counts = Object.fromEntries(tables.map(t => [t, backup.tables[t].length]));
  res.json({
    valid: true,
    exportedAt: backup.exportedAt,
    version: backup.version,
    organizationId: backup.organizationId ?? null,
    tables,
    counts,
  });
});

// ─── Restore (actual) ─────────────────────────────────────────────────────────
router.post("/restore", async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden — system admin required" }); return; }

  const { backup, confirmed } = req.body ?? {};
  if (!backup || !backup.version || !backup.tables) {
    res.status(400).json({ error: "Invalid backup format" }); return;
  }
  if (!confirmed) {
    res.status(400).json({ error: "Restore not confirmed. Pass confirmed: true to proceed." }); return;
  }

  const restored: Record<string, number> = {};

  try {
    if (Array.isArray(backup.tables.organizations) && backup.tables.organizations.length > 0) {
      for (const org of backup.tables.organizations) {
        await db.insert(organizationsTable).values(org).onConflictDoUpdate({ target: organizationsTable.id, set: { name: org.name, type: org.type, updatedAt: new Date() } });
      }
      restored.organizations = backup.tables.organizations.length;
    }

    if (Array.isArray(backup.tables.projects) && backup.tables.projects.length > 0) {
      for (const project of backup.tables.projects) {
        await db.insert(projectsTable).values(project).onConflictDoUpdate({ target: projectsTable.id, set: { name: project.name, status: project.status, updatedAt: new Date() } });
      }
      restored.projects = backup.tables.projects.length;
    }

    if (Array.isArray(backup.tables.documents) && backup.tables.documents.length > 0) {
      for (const doc of backup.tables.documents) {
        await db.insert(documentsTable).values(doc).onConflictDoUpdate({ target: documentsTable.id, set: { title: doc.title, status: doc.status, updatedAt: new Date() } });
      }
      restored.documents = backup.tables.documents.length;
    }

    if (Array.isArray(backup.tables.tasks) && backup.tables.tasks.length > 0) {
      for (const task of backup.tables.tasks) {
        await db.insert(tasksTable).values(task).onConflictDoUpdate({ target: tasksTable.id, set: { title: task.title, status: task.status, updatedAt: new Date() } });
      }
      restored.tasks = backup.tables.tasks.length;
    }

    res.json({ success: true, restored, message: "Restore completed successfully." });
  } catch (err: any) {
    res.status(500).json({ error: "Restore failed", message: err.message });
  }
});

export default router;

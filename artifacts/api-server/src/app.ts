import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { seedDefaultAdmin } from "./lib/seed.js";
import { backfillOrgConfig } from "./lib/backfill-org-config.js";
import { seedPlans } from "./lib/seed-plans.js";
import { runIntegrityMigrations } from "./lib/integrity-migrations.js";
import { resetModulesToPlan } from "./lib/reset-modules-to-plan.js";
import { startModuleSyncScheduler } from "./lib/module-sync-scheduler.js";
import { initRlsPolicies } from "./lib/rls-init.js";
import { runScheduledSkills } from "./lib/skill-engine.js";
import { extractRealIp } from "./middlewares/real-ip.js";
import { db } from "@workspace/db";
import {
  tasksTable, meetingActionItemsTable, meetingsTable, notificationsTable, usersTable, projectsTable,
  wfInstancesTable, wfTemplateStagesTable,
} from "@workspace/db";
import { and, eq, lt, isNotNull, sql, ne } from "drizzle-orm";
import { sendOverdueTaskEmail, sendWorkflowStageEmail } from "./lib/email.js";

const app: Express = express();
const isProd = process.env.NODE_ENV === "production";

// ─── Trust proxy (Cloudflare → Nginx → Node) ──────────────────────────────────
// Tells Express to trust the leftmost X-Forwarded-For entry added by a trusted
// reverse proxy. Required for req.ip to be the real client IP and for
// express-rate-limit to work correctly behind Cloudflare/Nginx.
app.set("trust proxy", 1);

// ─── Real-IP extraction (must come first) ─────────────────────────────────────
// Reads CF-Connecting-IP > X-Forwarded-For > req.ip and sets req.realIp.
app.use(extractRealIp);

// ─── Security headers (Cloudflare-compatible) ─────────────────────────────────
// Helmet is applied conditionally: file-serving routes (/api/storage/objects/*
// and /api/storage/onpremise/*) are embedded in <iframe> elements for PDF/image
// preview — Helmet is skipped entirely for these paths so X-Frame-Options is
// never emitted. All other routes receive full Helmet protection including
// frameguard: deny for clickjacking protection.
//
// Security note: the view token (5-min signed JWT, user-scoped) IS the
// clickjacking protection for file routes — X-Frame-Options is redundant there.
const FILE_ROUTE_RE = /^\/api\/storage\/(objects|onpremise)\//;

app.use((req: Request, res: Response, next: NextFunction) => {
  if (FILE_ROUTE_RE.test(req.path)) return next(); // skip Helmet for file routes

  return helmet({
    frameguard: { action: "deny" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: isProd
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })(req, res, next);
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
// In production, restrict origins to the ALLOWED_ORIGINS env var (comma-separated).
// In development, allow all origins for convenience.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

const corsOptions: cors.CorsOptions = {
  origin: isProd
    ? (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    : true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Content-Disposition"],
  optionsSuccessStatus: 204,
};

// Explicit pre-flight handler — must come BEFORE any route so nginx/proxies
// forwarding OPTIONS requests get a 204 response immediately without hitting
// auth middleware (which would 401 a pre-flight and cause a 405 on the browser side).
// Note: Express 5 requires named wildcards — "/*path" instead of "*".
app.options("/*path", cors(corsOptions));
app.use(cors(corsOptions));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Global IP-based limiter acts as a baseline safety net for unrecognised routes.
// Authenticated API routes use the per-org tenant limiter (in routes/index.ts).
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  skip: () => !isProd,
  keyGenerator: (req: Request) => req.realIp ?? req.ip ?? "unknown",
  message: { error: "Too many requests", message: "Rate limit exceeded. Please wait before retrying." },
});

// Auth endpoints stay on a strict IP-based limiter to prevent brute-force.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  skip: () => !isProd,
  keyGenerator: (req: Request) => req.realIp ?? req.ip ?? "unknown",
  message: { error: "Too many requests", message: "Too many authentication attempts. Try again in 15 minutes." },
});

app.use("/api", globalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Raw body for Stripe webhook signature verification
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, method: req.method, url: req.url }, "Unhandled error");
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  res.status(status).json({
    error: isProd ? "Internal Server Error" : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

// Phase 0 security fix — ensure every org has an org_config row so the
// fail-closed requireModule middleware never denies access to a legitimately
// configured organization. Safe to call multiple times (idempotent).
backfillOrgConfig().catch((err) => {
  logger.error({ err }, "[backfill] org_config startup backfill failed — continuing, but unconfigured orgs may be denied access");
});

// Phase 2 foundation — populate the plans catalog table and apply schema
// column additions (ensureTablesExist). Must complete before anything that
// queries the users table with the full Drizzle schema (e.g. seedDefaultAdmin).
//
// Chained sequence after seedPlans() resolves:
//   1. seedDefaultAdmin  — dev only; needs email_verification_token_expires_at
//      to exist, which ensureTablesExist() guarantees before this runs.
//   2. runIntegrityMigrations — applies FK constraints + orphan detection.
//      Also adds the token-expiry column as belt-and-suspenders, but the
//      column is already present from ensureTablesExist() so the ALTER is a no-op.
seedPlans()
  .then(() => {
    // ── Development-only seed ──────────────────────────────────────────────
    // seedDefaultAdmin() creates admin@admin.com / owner@system.com with
    // hardcoded passwords. Must never run in production.
    if (!isProd) {
      seedDefaultAdmin().catch((err) => {
        logger.error({ err }, "[seed] seedDefaultAdmin failed — continuing anyway");
      });
    } else {
      logger.info("[seed] seedDefaultAdmin skipped (NODE_ENV=production) — demo credentials will not be created");
    }

    // H1 — Database integrity migrations (FK constraints + orphan detection).
    // Runs after seedPlans() so all tables and columns are guaranteed to exist.
    runIntegrityMigrations().catch((err) => {
      logger.error({ err }, "[integrity] runIntegrityMigrations failed — startup continues, but DB constraints may be missing");
    });
  })
  .catch((err) => {
    logger.error({ err }, "[seed-plans] startup plan seed failed — getResolvedPlan() will log warnings until plans are seeded");
  });

// Phase 2.95 — Reset org_config.modules to exactly match plan defaults.
// Eliminates all plan_gap and orphan mismatches on test/demo data.
// Safe to call multiple times — skips orgs where modules already match.
resetModulesToPlan().catch((err) => {
  logger.error({ err }, "[reset-modules] startup module reset failed — org modules may not match plan defaults");
});

// Phase 3 — Start periodic module sync scheduler.
// Syncs org_config.modules for all orgs every 30 min (first run after 2 min).
// Applies plan defaults + active org_feature_overrides.
// Continues on per-org error — never crashes the process.
startModuleSyncScheduler();

// Idempotent — enables RLS + org-isolation policies on all critical tables.
initRlsPolicies().catch((err) => {
  logger.warn({ err }, "RLS init failed — app continues without DB-level row security");
});

// ─── Skill engine cron ────────────────────────────────────────────────────────
// Runs every hour. Each scheduled skill self-determines whether it is due
// based on its last successful execution time.
setTimeout(() => {
  runScheduledSkills().catch((err) => logger.warn({ err }, "skill cron: initial run failed"));
  setInterval(() => {
    runScheduledSkills().catch((err) => logger.warn({ err }, "skill cron: periodic run failed"));
  }, 60 * 60 * 1000);
}, 60_000); // wait 60 s after start to let DB settle

// ─── Due-date reminder job ────────────────────────────────────────────────────
// Runs every hour; sends a task_overdue notification once per day per overdue item.
let _lastReminderDate = "";
async function sendDueDateReminders() {
  const today = new Date().toISOString().slice(0, 10);
  if (_lastReminderDate === today) return; // already ran today
  _lastReminderDate = today;
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Overdue tasks with an assignee
    const overdueTasks = await db
      .select({ id: tasksTable.id, title: tasksTable.title, assigneeId: tasksTable.assignedToId, projectId: tasksTable.projectId })
      .from(tasksTable)
      .where(and(
        isNotNull(tasksTable.dueDate),
        lt(tasksTable.dueDate, now),
        isNotNull(tasksTable.assignedToId),
        ne(tasksTable.status, "completed"),
      ));

    for (const task of overdueTasks) {
      if (!task.assigneeId) continue;
      // Check if we already sent a reminder in the last 24h
      const [existing] = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(and(
          eq(notificationsTable.userId, task.assigneeId),
          eq(notificationsTable.type, "task_overdue"),
          eq(notificationsTable.entityType, "task"),
          eq(notificationsTable.entityId, task.id),
          sql`${notificationsTable.createdAt} > ${yesterday}`,
        ))
        .limit(1);
      if (existing) continue;
      await db.insert(notificationsTable).values({
        userId: task.assigneeId,
        type: "task_overdue",
        title: "Task overdue",
        message: `Your task "${task.title}" is past its due date.`,
        projectId: task.projectId,
        entityType: "task",
        entityId: task.id,
        actionUrl: `/tasks`,
      });

      // Send overdue email to assignee (fire-and-forget)
      const [assignee] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, task.assigneeId)).limit(1);
      const [project] = task.projectId
        ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, task.projectId)).limit(1)
        : [null];
      if (assignee?.email) {
        sendOverdueTaskEmail({
          to: assignee.email,
          userName: `${assignee.firstName} ${assignee.lastName}`.trim(),
          taskTitle: task.title,
          taskType: "task",
          dueDate: "Overdue",
          projectName: project?.name ?? null,
          taskLink: `${process.env.APP_URL ?? ""}/tasks`,
        }).catch(() => {});
      }
    }

    // Overdue meeting action items with an assignee
    const overdueItems = await db
      .select({
        id: meetingActionItemsTable.id,
        title: meetingActionItemsTable.title,
        assignedToId: meetingActionItemsTable.assignedToId,
        meetingId: meetingActionItemsTable.meetingId,
        projectId: meetingsTable.projectId,
      })
      .from(meetingActionItemsTable)
      .leftJoin(meetingsTable, eq(meetingActionItemsTable.meetingId, meetingsTable.id))
      .where(and(
        isNotNull(meetingActionItemsTable.dueDate),
        lt(meetingActionItemsTable.dueDate, now),
        isNotNull(meetingActionItemsTable.assignedToId),
        ne(meetingActionItemsTable.status, "done"),
      ));

    for (const item of overdueItems) {
      if (!item.assignedToId) continue;
      const [existing] = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(and(
          eq(notificationsTable.userId, item.assignedToId),
          eq(notificationsTable.type, "task_overdue"),
          eq(notificationsTable.entityType, "action_item"),
          eq(notificationsTable.entityId, item.id),
          sql`${notificationsTable.createdAt} > ${yesterday}`,
        ))
        .limit(1);
      if (existing) continue;
      await db.insert(notificationsTable).values({
        userId: item.assignedToId,
        type: "task_overdue",
        title: "Action item overdue",
        message: `Meeting action item "${item.title}" is past its due date.`,
        projectId: item.projectId ?? undefined,
        entityType: "action_item",
        entityId: item.id,
        actionUrl: `/meetings`,
      });
    }

    // ─── Workflow SLA: overdue stages ─────────────────────────────────────
    // Find active wf_instances whose stage_due_at has passed
    const overdueInstances = await db
      .select({
        id: wfInstancesTable.id,
        organizationId: wfInstancesTable.organizationId,
        documentId: wfInstancesTable.documentId,
        currentStageId: wfInstancesTable.currentStageId,
        stageDueAt: wfInstancesTable.stageDueAt,
      })
      .from(wfInstancesTable)
      .where(and(
        eq(wfInstancesTable.status, "active"),
        isNotNull(wfInstancesTable.stageDueAt),
        lt(wfInstancesTable.stageDueAt, now),
      ));

    for (const inst of overdueInstances) {
      if (!inst.currentStageId) continue;
      const [stage] = await db.select().from(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.id, inst.currentStageId)).limit(1);
      if (!stage) continue;

      // Resolve recipients: specific user or org admins/PMs
      let recipientIds: number[] = [];
      if (stage.responsibleUserId) {
        recipientIds = [stage.responsibleUserId];
      } else {
        const admins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.organizationId, inst.organizationId),
            eq(usersTable.isActive, true),
            sql`${usersTable.role} IN ('admin', 'project_manager', 'system_owner')`,
          ));
        recipientIds = admins.map(a => a.id);
      }

      for (const userId of recipientIds) {
        // Dedup: skip if we sent an overdue notification for this instance in last 24h
        const [existing] = await db
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(and(
            eq(notificationsTable.userId, userId),
            eq(notificationsTable.type, "workflow_action_required"),
            eq(notificationsTable.entityType, "workflow"),
            eq(notificationsTable.entityId, inst.id),
            sql`${notificationsTable.createdAt} > ${yesterday}`,
          ))
          .limit(1);
        if (existing) continue;

        await db.insert(notificationsTable).values({
          userId,
          type: "workflow_action_required",
          title: `Workflow stage overdue: ${stage.name}`,
          message: `A document workflow has exceeded its SLA deadline at stage "${stage.name}".`,
          entityType: "workflow",
          entityId: inst.id,
          actionUrl: `/workflow-engine`,
        }).catch(() => {});

        // Email
        const [recipient] = await db.select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (recipient?.email) {
          sendWorkflowStageEmail({
            to: recipient.email,
            stageName: `${stage.name} (OVERDUE)`,
            stageRole: stage.responsibleRole ?? undefined,
            documentTitle: `Document #${inst.documentId}`,
            documentNumber: "",
            workflowName: `Workflow Instance #${inst.id}`,
            submittedByName: "System",
            instanceId: inst.id,
          }).catch(() => {});
        }
      }
    }

    // ─── Workflow SLA: upcoming reminders ─────────────────────────────────
    // Find active wf_instances where due date is within reminderDays
    // (stageDueAt - reminderDays * 86400s <= now < stageDueAt)
    const upcomingInstances = await db
      .select({
        id: wfInstancesTable.id,
        organizationId: wfInstancesTable.organizationId,
        documentId: wfInstancesTable.documentId,
        currentStageId: wfInstancesTable.currentStageId,
        stageDueAt: wfInstancesTable.stageDueAt,
      })
      .from(wfInstancesTable)
      .where(and(
        eq(wfInstancesTable.status, "active"),
        isNotNull(wfInstancesTable.stageDueAt),
        sql`${wfInstancesTable.stageDueAt} > ${now}`, // not yet overdue
      ));

    for (const inst of upcomingInstances) {
      if (!inst.currentStageId || !inst.stageDueAt) continue;
      const [stage] = await db.select().from(wfTemplateStagesTable).where(eq(wfTemplateStagesTable.id, inst.currentStageId)).limit(1);
      if (!stage?.reminderDays) continue; // no reminder configured

      // Check if due date is within reminderDays
      const dueMs = new Date(inst.stageDueAt).getTime();
      const reminderWindowMs = stage.reminderDays * 24 * 60 * 60 * 1000;
      if (dueMs - now.getTime() > reminderWindowMs) continue; // too far in future

      let recipientIds: number[] = [];
      if (stage.responsibleUserId) {
        recipientIds = [stage.responsibleUserId];
      } else {
        const admins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.organizationId, inst.organizationId),
            eq(usersTable.isActive, true),
            sql`${usersTable.role} IN ('admin', 'project_manager', 'system_owner')`,
          ));
        recipientIds = admins.map(a => a.id);
      }

      for (const userId of recipientIds) {
        // Dedup: skip if we already sent an SLA reminder today for this instance
        const [existing] = await db
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(and(
            eq(notificationsTable.userId, userId),
            eq(notificationsTable.type, "workflow_sla_reminder"),
            eq(notificationsTable.entityType, "workflow"),
            eq(notificationsTable.entityId, inst.id),
            sql`${notificationsTable.createdAt} > ${yesterday}`,
          ))
          .limit(1);
        if (existing) continue;

        const daysLeft = Math.ceil((dueMs - now.getTime()) / (24 * 60 * 60 * 1000));
        await db.insert(notificationsTable).values({
          userId,
          type: "workflow_sla_reminder",
          title: `Workflow SLA reminder: ${stage.name}`,
          message: `Document workflow stage "${stage.name}" is due in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}.`,
          entityType: "workflow",
          entityId: inst.id,
          actionUrl: `/workflow-engine`,
        }).catch(() => {});
      }
    }

    logger.info("Due-date reminder job completed");
  } catch (err) {
    logger.error({ err }, "Due-date reminder job failed");
  }
}

// Run once at startup (after 30s to let DB settle) then every hour
setTimeout(() => {
  sendDueDateReminders();
  setInterval(sendDueDateReminders, 60 * 60 * 1000);
}, 30_000);

export default app;

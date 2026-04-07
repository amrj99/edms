import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { seedDefaultAdmin } from "./lib/seed.js";
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
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,

    // Strict-Transport-Security: HTTPS is terminated at Cloudflare but it's
    // still good practice to send HSTS so browsers remember to use HTTPS.
    strictTransportSecurity: isProd
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,

    // Prevent browsers from sniffing content types
    noSniff: true,

    // Deny X-Frame-Options for clickjacking protection
    frameguard: { action: "deny" },

    // Referrer-Policy
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// In production, restrict origins to the ALLOWED_ORIGINS env var (comma-separated).
// In development, allow all origins for convenience.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
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
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

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
seedDefaultAdmin().catch((err) => {
  logger.error({ err }, "Seed failed — continuing anyway");
});

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

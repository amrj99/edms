import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { seedDefaultAdmin } from "./lib/seed.js";
import { db } from "@workspace/db";
import {
  tasksTable, meetingActionItemsTable, meetingsTable, notificationsTable, usersTable,
} from "@workspace/db";
import { and, eq, lt, isNotNull, sql, ne } from "drizzle-orm";

const app: Express = express();
const isProd = process.env.NODE_ENV === "production";

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
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
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", message: "Rate limit exceeded. Please wait before retrying." },
  skip: () => !isProd,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", message: "Too many authentication attempts. Try again in 15 minutes." },
  skip: () => !isProd,
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
      .select({ id: tasksTable.id, title: tasksTable.title, assigneeId: tasksTable.assigneeId, projectId: tasksTable.projectId })
      .from(tasksTable)
      .where(and(
        isNotNull(tasksTable.dueDate),
        lt(tasksTable.dueDate, now),
        isNotNull(tasksTable.assigneeId),
        ne(tasksTable.status, "done"),
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

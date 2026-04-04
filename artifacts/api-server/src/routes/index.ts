import { Router, type IRouter } from "express";
import { requireOrgScope } from "../lib/org-scope.js";
import { setRlsContext } from "../middlewares/rls-context.js";
import { tenantRateLimit } from "../middlewares/tenant-rate-limit.js";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import aiRouter from "./ai.js";
import generalRouter from "./general.js";
import organizationsRouter from "./organizations.js";
import usersRouter from "./users.js";
import projectsRouter from "./projects.js";
import documentsRouter from "./documents.js";
import correspondenceRouter from "./correspondence.js";
import workflowsRouter from "./workflows.js";
import tasksRouter from "./tasks.js";
import metadataRouter from "./metadata.js";
import dashboardRouter from "./dashboard.js";
import searchRouter from "./search.js";
import auditLogsRouter from "./audit-logs.js";
import packagesRouter from "./packages.js";
import transmittalsRouter from "./transmittals.js";
import notificationsRouter from "./notifications.js";
import configRouter from "./config.js";
import storageRouter from "./storage.js";
import adminRouter from "./admin.js";
import publicShareRouter from "./public-share.js";
import globalDocumentsRouter from "./global-documents.js";
import registersRouter from "./registers.js";
import deliverablesRouter from "./deliverables.js";
import preferencesRouter from "./preferences.js";
import notificationSummaryRouter from "./notification-summary.js";
import modulesRouter from "./modules.js";
import profileRouter from "./profile.js";
import meetingsRouter from "./meetings.js";
import chatRouter from "./chat.js";
import devRouter from "./dev.js";
import calendarRouter from "./calendar.js";
import rulesRouter from "./rules.js";
import skillsRouter from "./skills.js";
import migrationsRouter from "./migrations.js";
import billingRouter from "./billing.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/public/share", publicShareRouter);

// ── Tenant isolation: inject req.orgId for all authenticated protected routes ──
// Routes below this middleware are guaranteed to have req.user set (via requireAuth
// in each route) and req.orgId populated. system_owner users without an assigned
// org may still proceed — they span all tenants by design.
router.use((req, res, next) => {
  if (req.user) requireOrgScope(req, res, next);
  else next();
});

// ── RLS session context: set app.current_org_id for DB-level row security ──────
router.use((req, res, next) => {
  if (req.user) setRlsContext(req, res, next);
  else next();
});

// ── Per-tenant rate limiting (org subscription tier, Cloudflare-aware) ──────────
router.use(tenantRateLimit);

router.use("/organizations", organizationsRouter);
router.use("/users", usersRouter);
router.use("/projects", projectsRouter);
router.use("/projects/:projectId/documents", documentsRouter);
router.use("/projects/:projectId/correspondence", correspondenceRouter);
router.use("/projects/:projectId/workflows", workflowsRouter);
router.use("/projects/:projectId/packages", packagesRouter);
router.use("/projects/:projectId/transmittals", transmittalsRouter);
router.use("/tasks", tasksRouter);
router.use("/metadata-fields", metadataRouter);
router.use("/dashboard", dashboardRouter);
router.use("/search", searchRouter);
router.use("/audit-logs", auditLogsRouter);
router.use("/ai", aiRouter);
router.use("/general", generalRouter);
router.use("/notifications", notificationsRouter);
router.use("/config", configRouter);
router.use("/storage", storageRouter);
router.use("/admin", adminRouter);
router.use("/documents", globalDocumentsRouter);
router.use("/projects/:projectId", registersRouter);
router.use("/projects/:projectId", deliverablesRouter);
router.use("/user", preferencesRouter);
router.use("/profile", profileRouter);
router.use("/meetings", meetingsRouter);
router.use("/chat", chatRouter);
router.use("/modules", modulesRouter);
router.use("/dev", devRouter);
router.use("/calendar", calendarRouter);
router.use("/", notificationSummaryRouter);
router.use("/rules", rulesRouter);
router.use("/skills", skillsRouter);
router.use("/migrations", migrationsRouter);
router.use("/billing", billingRouter);

export default router;

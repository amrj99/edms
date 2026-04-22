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
import workflowEngineRouter from "./workflow-engine.js";
import delegationsRouter from "./delegations.js";
import projectRoleOverridesRouter from "./project-role-overrides.js";
import projectGovernanceRouter from "./project-governance.js";
import submissionChainsRouter from "./submission-chains.js";
import departmentsRouter from "./departments.js";
import projectDepartmentsRouter from "./project-departments.js";
import externalContactsRouter from "./external-contacts.js";
import { requireModule } from "../middlewares/require-module.js";
import { requireOrg } from "../middlewares/require-org.js";
import { shadowPlanMiddleware } from "../middlewares/shadow-plan-middleware.js";

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

// ── Organization membership enforcement (Phase 0 security fix) ────────────────
// Authenticated users (except system_owner) must belong to an organization.
// system_owner intentionally has no org — they span all tenants by design.
// Unauthenticated requests pass through and are caught by requireAuth in each route.
router.use(requireOrg);

// ── Phase 2.5 shadow plan integration ─────────────────────────────────────────
// Fire-and-forget: calls getResolvedPlan() once per org per 5 minutes to emit
// plan.config.features, plan.config.quotas, and any module/quota mismatches.
// Always non-blocking (next() called before any async work). No enforcement.
router.use(shadowPlanMiddleware);

router.use("/organizations", organizationsRouter);
router.use("/users", usersRouter);
router.use("/projects", projectsRouter);
router.use("/projects/:projectId/documents", documentsRouter);
router.use("/projects/:projectId/correspondence", correspondenceRouter);
router.use("/correspondence", correspondenceRouter);
router.use("/projects/:projectId/packages", packagesRouter);
router.use("/projects/:projectId/transmittals", requireModule("registers"), transmittalsRouter);
router.use("/projects/:projectId", projectDepartmentsRouter);
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
router.use("/projects/:projectId", requireModule("registers"), registersRouter);
router.use("/projects/:projectId", requireModule("deliverables"), deliverablesRouter);
router.use("/user", preferencesRouter);
router.use("/profile", profileRouter);
router.use("/meetings", meetingsRouter);
router.use("/chat", requireModule("chat"), chatRouter);
router.use("/modules", modulesRouter);
if (process.env.NODE_ENV !== "production") {
  router.use("/dev", devRouter);
}
router.use("/calendar", calendarRouter);
router.use("/", notificationSummaryRouter);
router.use("/rules", rulesRouter);
router.use("/skills", skillsRouter);
router.use("/migrations", migrationsRouter);
router.use("/billing", billingRouter);
router.use("/workflow-engine", workflowEngineRouter);
router.use("/delegations", delegationsRouter);
router.use("/projects/:projectId", projectRoleOverridesRouter);
router.use("/projects/:projectId", projectGovernanceRouter);
router.use("/projects/:projectId/submission-chains", submissionChainsRouter);
router.use("/departments", departmentsRouter);
router.use("/external-contacts", externalContactsRouter);

export default router;

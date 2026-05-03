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
import aiCreditsRouter from "./ai-credits.js";
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
import { verifyToken, type AuthUser } from "../lib/auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/public/share", publicShareRouter);

// ── JWT pre-parse: lightweight, non-authoritative context population ───────────
// Purpose: populate req.user early so every subsequent global middleware
// (org scope, RLS, rate-limit, read-only check) can inspect the caller's
// identity without duplicating token logic.
//
// Auth responsibility split:
//   • THIS middleware — convenience only. Silently skips invalid/missing tokens.
//     It must never grant access or bypass any check on its own.
//   • requireAuth()   — the single authoritative gate. Called inside each route
//     handler. Returns 401 if the token is absent, expired, or tampered.
//
// Security properties:
//   • If req.user is already set (e.g. by a future auth sub-middleware), this
//     step is skipped — it never overwrites a more-authoritative identity.
//   • verifyToken() returns null for invalid/expired tokens (never throws),
//     so a bad token simply leaves req.user undefined; requireAuth then rejects.
//   • No route can rely solely on req.user being set here — requireAuth is
//     still mandatory for any authenticated endpoint.
router.use((req, res, next) => {
  if (!req.user) {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      const payload = verifyToken(auth.slice(7));
      if (payload) req.user = payload as unknown as AuthUser;
    }
  }
  next();
});

// ── Tenant isolation: inject req.orgId for all authenticated protected routes ──
// req.user is now populated by the pre-parse above, so requireOrgScope runs
// for every authenticated request. system_owner users without an assigned
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

// ── Read-only override enforcement ────────────────────────────────────────────
// Users with is_read_only_override = true (set by trial downgrade scheduler)
// are blocked from all state-mutating requests. Read + download remain permitted.
// The flag is embedded in the JWT at login time; takes effect within 1 hour for
// already-logged-in sessions.
//
// Bypass rules:
//   • GET / HEAD / OPTIONS are always allowed (read-only access).
//   • system_owner bypasses all per-org restrictions — they are a platform-level
//     actor and must never be locked out by tenant downgrade logic.
//   • Any user without isReadOnlyOverride = true passes through normally.
router.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return next();
  if (req.user?.role === "system_owner") return next();
  if (!req.user?.isReadOnlyOverride) return next();
  res.status(403).json({
    error: "READ_ONLY_ACCOUNT",
    message: "Your account is in read-only mode. Upgrade your plan to restore full access.",
  });
});

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
router.use("/ai-credits", aiCreditsRouter);
router.use("/workflow-engine", workflowEngineRouter);
router.use("/delegations", delegationsRouter);
router.use("/projects/:projectId", projectRoleOverridesRouter);
router.use("/projects/:projectId", projectGovernanceRouter);
router.use("/projects/:projectId/submission-chains", submissionChainsRouter);
router.use("/departments", departmentsRouter);
router.use("/external-contacts", externalContactsRouter);

export default router;

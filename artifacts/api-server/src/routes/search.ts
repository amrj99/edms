import { Router } from "express";
import { requireAuth, isSystemOwner } from "../lib/auth.js";
import { search } from "../lib/search-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * GET /api/search?q=...&projectId=...&type=...&discipline=...&status=...
 * Uses Elasticsearch when ELASTICSEARCH_URL is configured; falls back to SQL.
 * Tenant-isolated: results are scoped to the caller's organization.
 * system_owner with no org sees all organizations (cross-tenant).
 */
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { q, projectId, type, discipline, status } = req.query;
  const caller = req.user!;

  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "q parameter is required" });
    return;
  }

  // system_owner with no org = cross-tenant view; everyone else is org-scoped
  const organizationId = isSystemOwner(caller) && !caller.organizationId
    ? undefined
    : caller.organizationId ?? undefined;

  try {
    const results = await search({
      q,
      projectId: projectId ? parseInt(projectId as string) : undefined,
      organizationId,
      type: type as any,
      discipline: discipline as string | undefined,
      status: status as string | undefined,
    });

    res.json({ ...results, query: q });
  } catch (err: any) {
    logger.error({ err }, "[search] query failed");
    throw err; // Express 5 → globalErrorHandler
  }
});

export default router;

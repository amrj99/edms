import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { search } from "../lib/search-service.js";

const router = Router();

/**
 * GET /api/search?q=...&projectId=...&type=...&discipline=...&status=...
 * Uses Elasticsearch when ELASTICSEARCH_URL is configured; falls back to SQL.
 */
router.get("/", requireAuth, async (req, res) => {
  const { q, projectId, type, discipline, status } = req.query;

  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "Bad Request", message: "q parameter is required" });
    return;
  }

  try {
    const results = await search({
      q,
      projectId: projectId ? parseInt(projectId as string) : undefined,
      type: type as any,
      discipline: discipline as string | undefined,
      status: status as string | undefined,
    });

    res.json({ ...results, query: q });
  } catch (err: any) {
    console.error("[search] Error:", err.message);
    res.status(500).json({ error: "Search failed", message: err.message });
  }
});

export default router;

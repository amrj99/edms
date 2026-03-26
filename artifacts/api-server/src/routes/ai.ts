import { Router } from "express";
import { db } from "@workspace/db";
import {
  documentsTable, correspondenceTable, tasksTable, aiLogsTable,
} from "@workspace/db";
import { eq, and, inArray, gt } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import {
  analyzeDocument,
  analyzeCorrespondence,
  prioritizeTasks,
  parseNaturalLanguageSearch,
  suggestDocumentProcedure,
  getAiSettings,
  updateAiSettings,
  isModuleEnabled,
} from "../lib/ai-service.js";

const router = Router();

// All AI routes require auth
router.use(requireAuth);

// ─── Document Analysis ───────────────────────────────────────────────────────

router.post("/documents/:id/analyze", async (req, res) => {
  const docId = parseInt(req.params.id);
  const force = req.query.force === "true";

  const docs = await db.select().from(documentsTable)
    .where(eq(documentsTable.id, docId)).limit(1);

  if (!docs[0]) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const doc = docs[0];

  if (!await isModuleEnabled("documents", req.user!.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Documents module" });
    return;
  }

  const analysis = await analyzeDocument(doc, req.user!.id, force);
  res.json(analysis);
});

// ─── Correspondence Analysis ─────────────────────────────────────────────────

router.post("/correspondence/:id/analyze", async (req, res) => {
  const corrId = parseInt(req.params.id);
  const force = req.query.force === "true";

  const items = await db.select().from(correspondenceTable)
    .where(eq(correspondenceTable.id, corrId)).limit(1);

  if (!items[0]) {
    res.status(404).json({ error: "Correspondence not found" });
    return;
  }

  const corr = items[0];

  if (!await isModuleEnabled("correspondence", req.user!.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Correspondence module" });
    return;
  }

  const analysis = await analyzeCorrespondence(corr, req.user!.id, force);
  res.json(analysis);
});

// ─── Task Prioritization ─────────────────────────────────────────────────────

router.post("/tasks/prioritize", async (req, res) => {
  const { taskIds, projectId } = req.body ?? {};

  if (!await isModuleEnabled("tasks", req.user!.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Tasks module" });
    return;
  }

  let query = db.select().from(tasksTable);
  const conditions = [];

  if (taskIds?.length > 0) {
    conditions.push(inArray(tasksTable.id, taskIds));
  }
  if (projectId) {
    conditions.push(eq(tasksTable.projectId, projectId));
  }

  const tasks = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query.limit(50);

  const insights = await prioritizeTasks(tasks, req.user!.id);
  res.json(insights);
});

// ─── AI Document Procedure Suggestion ────────────────────────────────────────

router.post("/documents/suggest-procedure", async (req, res) => {
  const {
    projectCode, projectName, discipline, documentType, partialTitle,
    existingNumbers, organizationName,
  } = req.body ?? {};

  if (!await isModuleEnabled("documents", req.user!.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Documents module" });
    return;
  }

  const suggestion = await suggestDocumentProcedure(
    { projectCode, projectName, discipline, documentType, partialTitle, existingNumbers, organizationName },
    req.user!.id,
  );
  res.json(suggestion);
});

// ─── Natural Language Search ─────────────────────────────────────────────────

router.post("/search/natural", async (req, res) => {
  const { query } = req.body ?? {};

  if (!query?.trim()) {
    res.status(400).json({ error: "Query is required" });
    return;
  }

  if (!await isModuleEnabled("search", req.user!.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Search module" });
    return;
  }

  const parsed = await parseNaturalLanguageSearch(query);
  res.json(parsed);
});

// ─── AI Settings ─────────────────────────────────────────────────────────────

router.get("/settings", async (req, res) => {
  const { organizationId } = req.user!;
  const settings = await getAiSettings(organizationId);

  // Return defaults for any unset modules
  const modules = ["documents", "correspondence", "tasks", "search", "notifications", "meetings", "inspections"];
  const result: Record<string, boolean> = {};
  for (const mod of modules) {
    result[mod] = settings[mod] ?? true;
  }
  res.json(result);
});

router.put("/settings", async (req, res) => {
  const { organizationId } = req.user!;
  const settings = req.body ?? {};

  if (organizationId) {
    await updateAiSettings(organizationId, settings);
  }
  // Return success regardless — users without an org see defaults (all enabled)
  res.json({ message: "AI settings updated", settings });
});

// ─── AI Activity Logs ─────────────────────────────────────────────────────────

router.get("/logs", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string || "50"), 100);
  const logs = await db.select().from(aiLogsTable)
    .orderBy(aiLogsTable.createdAt)
    .limit(limit);
  res.json(logs);
});

export default router;

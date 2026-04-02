import { Router } from "express";
import { db } from "@workspace/db";
import {
  documentsTable, correspondenceTable, tasksTable, aiLogsTable,
} from "@workspace/db";
import { eq, and, inArray, gt } from "drizzle-orm";
import { requireAuth, isSysAdmin } from "../lib/auth.js";
import {
  analyzeDocument,
  analyzeCorrespondence,
  prioritizeTasks,
  parseNaturalLanguageSearch,
  suggestDocumentProcedure,
  getAiSettings,
  updateAiSettings,
  isModuleEnabled,
  getAIProviderConfig,
  updateAIProviderConfig,
  getProviderStatus,
  getAIClient,
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

  try {
    if (!await isModuleEnabled("documents", req.user!.organizationId)) {
      res.status(403).json({ error: "AI is disabled for the Documents module" });
      return;
    }

    const suggestion = await suggestDocumentProcedure(
      { projectCode, projectName, discipline, documentType, partialTitle, existingNumbers, organizationName },
      req.user!.id,
    );
    res.json(suggestion);
  } catch (err: any) {
    const msg = err?.message || "AI service unavailable";
    const isCredentialError = msg.includes("API key") || msg.includes("auth") || msg.includes("401") || msg.includes("Unauthorized");
    res.status(503).json({
      error: isCredentialError
        ? "AI service is not configured. Please check your API key settings."
        : `AI suggestion failed: ${msg}`,
    });
  }
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

// ─── Document Control Validation ─────────────────────────────────────────────

router.post("/validate-documents", async (req, res) => {
  const { projectId, documents = [] } = req.body ?? {};
  const issues: any[] = [];

  // Check: missing document numbers
  const withoutNumber = documents.filter((d: any) => !d.documentNumber || d.documentNumber.trim() === "");
  withoutNumber.forEach((d: any) => {
    issues.push({ severity: "error", title: "Missing Document Number", detail: `Document "${d.title}" has no document number.`, document: d.title });
  });

  // Check: missing title
  const withoutTitle = documents.filter((d: any) => !d.title || d.title.trim() === "");
  withoutTitle.forEach((d: any) => {
    issues.push({ severity: "error", title: "Missing Title", detail: "A document is missing a title.", document: d.documentNumber || "Unknown" });
  });

  // Check: missing discipline
  const withoutDiscipline = documents.filter((d: any) => !d.discipline);
  withoutDiscipline.forEach((d: any) => {
    issues.push({ severity: "warning", title: "Missing Discipline", detail: `Document "${d.title}" has no discipline assigned.`, document: d.documentNumber });
  });

  // Check: missing revision
  const withoutRevision = documents.filter((d: any) => !d.revision);
  withoutRevision.forEach((d: any) => {
    issues.push({ severity: "warning", title: "Missing Revision", detail: `Document "${d.title}" has no revision assigned.`, document: d.documentNumber });
  });

  // Check: duplicate document numbers
  const numMap = new Map<string, any[]>();
  documents.forEach((d: any) => {
    if (d.documentNumber) {
      const arr = numMap.get(d.documentNumber) || [];
      arr.push(d);
      numMap.set(d.documentNumber, arr);
    }
  });
  numMap.forEach((docs, num) => {
    if (docs.length > 1) {
      issues.push({
        severity: "error",
        title: "Duplicate Document Number",
        detail: `Document number "${num}" is used by ${docs.length} documents: ${docs.map((d: any) => d.title).join(", ")}.`,
        document: num,
      });
    }
  });

  // Check: documents stuck in draft without revision
  const stuckDraft = documents.filter((d: any) => d.status === "draft" && d.revision && d.revision !== "01" && d.revision !== "A");
  stuckDraft.forEach((d: any) => {
    issues.push({ severity: "info", title: "Document Awaiting Submission", detail: `"${d.title}" is on revision ${d.revision} but still in draft status.`, document: d.documentNumber });
  });

  const errors = issues.filter((i: any) => i.severity === "error").length;
  const warnings = issues.filter((i: any) => i.severity === "warning").length;

  const summary = issues.length === 0
    ? `All ${documents.length} document(s) passed document control validation checks.`
    : `Found ${errors} error(s) and ${warnings} warning(s) across ${documents.length} document(s). Review and correct the flagged items.`;

  res.json({ issues, summary, total: documents.length });
});

// ─── Compare Revisions (AI Summary) ──────────────────────────────────────────

router.post("/compare-revisions", async (req, res) => {
  const { document: docTitle, revisionA, revisionB } = req.body ?? {};
  if (!revisionA || !revisionB) {
    res.status(400).json({ error: "revisionA and revisionB are required" });
    return;
  }

  const changes: string[] = [];
  const fields = ["revision", "status", "fileName", "comment"];
  fields.forEach(f => {
    if (revisionA[f] !== revisionB[f]) {
      changes.push(`${f} changed from "${revisionA[f] || "none"}" to "${revisionB[f] || "none"}"`);
    }
  });

  const summary = changes.length === 0
    ? `No tracked metadata differences detected between the two revisions of "${docTitle}".`
    : `Between the two revisions of "${docTitle}": ${changes.join("; ")}.`;

  res.json({ summary });
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

// ─── AI Command Assistant ──────────────────────────────────────────────────────
router.post("/command", async (req, res) => {
  const { command, projectId } = req.body;
  if (!command?.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }

  try {
    const systemPrompt = `You are an EDMS (Engineering Document Management System) AI assistant.
The user will give you a natural-language command to create a record in the system.

Supported record types and their required/optional fields:
- correspondence: subject (req), type (req: transmittal|letter|memo|rfi|notice|email|internal|submittal|ncr|technical_query), body, priority (low|medium|high|urgent), projectId
- meeting: title (req), meetingDate (req: ISO date), location, agenda, duration (minutes), status (scheduled|in_progress|completed|cancelled), projectId
- document: title (req), documentType (Drawing|Specification|Report|Procedure|Datasheet|Certificate|Memo|Letter|Method Statement|ITP), discipline (Civil|Structural|Mechanical|Electrical|Piping|Instrumentation|HVAC|Fire Protection|Architectural|General), description, projectId
- task: title (req), description, priority (low|medium|high|urgent), dueDate (ISO date)

Current projectId context: ${projectId || "none (user should specify)"}

Respond with a JSON object with this exact structure:
{
  "action": "create",
  "type": "correspondence|meeting|document|task",
  "data": { ...the fields to populate },
  "summary": "A brief human-readable sentence describing what will be created"
}

If the command is ambiguous or you cannot determine the type, return:
{
  "action": "unknown",
  "summary": "A brief explanation of what you couldn't understand"
}

Return ONLY the JSON object, no markdown, no explanation.`;

    const { fastModel } = await getAIProviderConfig();
    const client = await getAIClient();
    const completion = await client.chat.completions.create({
      model: fastModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command.trim() },
      ],
      max_tokens: 600,
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { action: "unknown", summary: "Could not parse the AI response. Please rephrase your command." };
    }

    res.json(parsed);
  } catch (err: any) {
    console.error("AI command error:", err);
    res.status(500).json({ error: "AI service unavailable", message: err.message });
  }
});

// ─── AI Provider Configuration ────────────────────────────────────────────────

router.get("/provider", async (req, res) => {
  const [config, status] = await Promise.all([getAIProviderConfig(), Promise.resolve(getProviderStatus())]);
  res.json({ ...config, providerStatus: status });
});

router.put("/provider", async (req, res) => {
  const user = req.user!;
  if (!isSysAdmin(user)) {
    res.status(403).json({ error: "System admin only" });
    return;
  }
  const { provider, fastModel, smartModel } = req.body ?? {};
  const validProviders = ["openai_replit", "groq", "ollama", "none"];
  if (provider !== undefined && !validProviders.includes(provider)) {
    res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
    return;
  }
  await updateAIProviderConfig({ provider, fastModel, smartModel });
  const config = await getAIProviderConfig();
  res.json({ ...config, providerStatus: getProviderStatus() });
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

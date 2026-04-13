import { Router } from "express";
import { db } from "@workspace/db";
import {
  documentsTable, correspondenceTable, tasksTable, aiLogsTable, aiAnalysisTable,
  projectsTable, projectMembersTable, organizationsTable, orgConfigTable,
} from "@workspace/db";
import { eq, and, inArray, gt, desc, sql, count } from "drizzle-orm";
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
  callAI,
} from "../lib/ai-service.js";

const router = Router();

// All AI routes require auth
router.use(requireAuth);

// ─── Document Analysis ───────────────────────────────────────────────────────

router.post("/documents/:id/analyze", async (req, res) => {
  const docId = parseInt(req.params.id);
  const force = req.query.force === "true";
  const caller = req.user!;

  const docs = await db.select().from(documentsTable)
    .where(eq(documentsTable.id, docId)).limit(1);

  if (!docs[0]) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const doc = docs[0];

  // Verify the caller has access to the document's project
  if (!isSysAdmin(caller)) {
    const [project] = await db.select({ organizationId: projectsTable.organizationId })
      .from(projectsTable).where(eq(projectsTable.id, doc.projectId)).limit(1);
    const isSameOrg = project?.organizationId === caller.organizationId;
    if (!isSameOrg) {
      const [member] = await db.select({ userId: projectMembersTable.userId })
        .from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, doc.projectId), eq(projectMembersTable.userId, caller.id)))
        .limit(1);
      if (!member) { res.status(403).json({ error: "Access denied" }); return; }
    }
  }

  if (!await isModuleEnabled("documents", caller.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Documents module" });
    return;
  }

  const analysis = await analyzeDocument(doc, caller.id, force);
  res.json(analysis);
});

// ─── Correspondence Analysis ─────────────────────────────────────────────────

router.post("/correspondence/:id/analyze", async (req, res) => {
  const corrId = parseInt(req.params.id);
  const force = req.query.force === "true";
  const caller = req.user!;

  const items = await db.select().from(correspondenceTable)
    .where(eq(correspondenceTable.id, corrId)).limit(1);

  if (!items[0]) {
    res.status(404).json({ error: "Correspondence not found" });
    return;
  }

  const corr = items[0];

  // Org isolation: correspondence is org-scoped
  if (!isSysAdmin(caller) && corr.organizationId !== caller.organizationId) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  if (!await isModuleEnabled("correspondence", caller.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Correspondence module" });
    return;
  }

  const analysis = await analyzeCorrespondence(corr, caller.id, force);
  res.json(analysis);
});

// ─── Task Prioritization ─────────────────────────────────────────────────────

router.post("/tasks/prioritize", async (req, res) => {
  const { taskIds, projectId } = req.body ?? {};
  const caller = req.user!;

  if (!await isModuleEnabled("tasks", caller.organizationId)) {
    res.status(403).json({ error: "AI is disabled for the Tasks module" });
    return;
  }

  const conditions: any[] = [];

  // Always scope to the caller's org to prevent cross-org task access
  if (!isSysAdmin(caller) && caller.organizationId) {
    conditions.push(eq(tasksTable.organizationId, caller.organizationId));
  }

  if (taskIds?.length > 0) {
    conditions.push(inArray(tasksTable.id, taskIds));
  }
  if (projectId) {
    conditions.push(eq(tasksTable.projectId, projectId));
  }

  const tasks = conditions.length > 0
    ? await db.select().from(tasksTable).where(and(...conditions)).limit(50)
    : await db.select().from(tasksTable).limit(50);

  const insights = await prioritizeTasks(tasks, caller.id);
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

    // Look up the caller's org code and numbering format from the DB
    const callerOrgId = req.user!.organizationId;
    let orgCode: string | undefined;
    let numberingFormat: string | undefined;
    if (callerOrgId) {
      const [org] = await db.select({ code: organizationsTable.code, name: organizationsTable.name })
        .from(organizationsTable).where(eq(organizationsTable.id, callerOrgId)).limit(1);
      orgCode = org?.code ?? undefined;
      const [cfg] = await db.select({ fmt: orgConfigTable.documentNumberingFormat })
        .from(orgConfigTable).where(eq(orgConfigTable.organizationId, callerOrgId)).limit(1);
      numberingFormat = cfg?.fmt ?? undefined;
    }

    const suggestion = await suggestDocumentProcedure(
      { projectCode, projectName, discipline, documentType, partialTitle, existingNumbers, organizationName, orgCode, numberingFormat },
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

// ─── Compare Revisions (metadata diff + optional AI narrative) ───────────────

router.post("/compare-revisions", async (req, res) => {
  const { document: docTitle, revisionA, revisionB, withAI } = req.body ?? {};
  if (!revisionA || !revisionB) {
    res.status(400).json({ error: "revisionA and revisionB are required" });
    return;
  }

  const TRACKED_FIELDS = [
    { key: "revision",  label: "Revision" },
    { key: "status",    label: "Status" },
    { key: "fileName",  label: "File" },
    { key: "comment",   label: "Comment" },
    { key: "fileSize",  label: "File Size" },
  ];

  const diff: { field: string; label: string; from: string; to: string }[] = [];
  for (const { key, label } of TRACKED_FIELDS) {
    const from = String(revisionA[key] ?? "—");
    const to   = String(revisionB[key]   ?? "—");
    if (from !== to) diff.push({ field: key, label, from, to });
  }

  const plainSummary = diff.length === 0
    ? `No tracked metadata differences between the two revisions of "${docTitle}".`
    : `${diff.length} metadata field(s) changed between revisions of "${docTitle}": ${diff.map(d => `${d.label} (${d.from} → ${d.to})`).join("; ")}.`;

  if (!withAI) {
    res.json({ diff, summary: plainSummary, aiSummary: null });
    return;
  }

  // Optional AI narrative — only called when withAI=true
  try {
    const changesText = diff.length === 0
      ? "No metadata changes detected."
      : diff.map(d => `- ${d.label}: "${d.from}" → "${d.to}"`).join("\n");

    const { data, provider, model } = await callAI(
      `You are an engineering document management AI.
Two revisions of the document "${docTitle}" were compared.

Metadata changes:
${changesText}

Write a concise 2-3 sentence professional summary of what changed between these two revisions and any implications for document control. Be specific about the changes.`,
      "Respond in plain professional English. Do not use markdown or bullet points.",
      "fast",
    );

    res.json({ diff, summary: plainSummary, aiSummary: String(data), provider, model });
  } catch (err: any) {
    // If AI fails, still return the metadata diff
    res.json({ diff, summary: plainSummary, aiSummary: null, aiError: err?.message ?? "AI unavailable" });
  }
});

// ─── AI Insights Dashboard ────────────────────────────────────────────────────

/**
 * GET /api/ai/insights
 * Aggregated AI insights for the organisation's documents.
 * All heavy computation is done in SQL; no AI calls are made here.
 */
router.get("/insights", async (req, res) => {
  const orgId = req.user!.organizationId;

  // 1. Total documents in the org
  const [{ totalDocs }] = await db
    .select({ totalDocs: count() })
    .from(documentsTable)
    .where(orgId ? eq(documentsTable.organizationId, orgId) : sql`true`);

  // 2. Latest analyses for this org (entityType='document', analysisType='analyze', isLatest=true)
  const latestAnalyses = await db
    .select({
      entityId:      aiAnalysisTable.entityId,
      result:        aiAnalysisTable.result,
      model:         aiAnalysisTable.model,
      provider:      aiAnalysisTable.provider,
      createdAt:     aiAnalysisTable.createdAt,
    })
    .from(aiAnalysisTable)
    .where(
      and(
        eq(aiAnalysisTable.entityType, "document"),
        eq(aiAnalysisTable.analysisType, "analyze"),
        eq(aiAnalysisTable.isLatest, true),
        ...(orgId ? [eq(aiAnalysisTable.organizationId, orgId)] : []),
      ),
    )
    .orderBy(desc(aiAnalysisTable.createdAt))
    .limit(500);

  const analyzedCount = latestAnalyses.length;
  const coveragePct = totalDocs > 0 ? Math.round((analyzedCount / Number(totalDocs)) * 100) : 0;

  // 3. Urgency distribution
  const urgencyDist: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const row of latestAnalyses) {
    const r = row.result as any;
    const lvl = r?.urgencyLevel as string;
    if (lvl && lvl in urgencyDist) urgencyDist[lvl]++;
  }

  // 4. Documents needing attention (high / critical urgency) — fetch their metadata
  const needsAttentionIds = latestAnalyses
    .filter(r => {
      const lvl = (r.result as any)?.urgencyLevel;
      return lvl === "high" || lvl === "critical";
    })
    .slice(0, 20)
    .map(r => r.entityId);

  let needsAttention: any[] = [];
  if (needsAttentionIds.length > 0) {
    const docs = await db
      .select({
        id:             documentsTable.id,
        title:          documentsTable.title,
        documentNumber: documentsTable.documentNumber,
        documentType:   documentsTable.documentType,
        discipline:     documentsTable.discipline,
        status:         documentsTable.status,
        projectId:      documentsTable.projectId,
      })
      .from(documentsTable)
      .where(inArray(documentsTable.id, needsAttentionIds));

    const analysisMap = new Map(latestAnalyses.map(a => [a.entityId, a]));
    needsAttention = docs.map(d => ({
      ...d,
      urgencyLevel:  (analysisMap.get(d.id)?.result as any)?.urgencyLevel,
      urgencyReason: (analysisMap.get(d.id)?.result as any)?.urgencyReason,
      analyzedAt:    analysisMap.get(d.id)?.createdAt,
    }));
  }

  // 5. Duplicate detection signals — documents sharing discipline+documentType within same project (count > 1)
  const duplicateSignals = await db
    .select({
      projectId:    documentsTable.projectId,
      documentType: documentsTable.documentType,
      discipline:   documentsTable.discipline,
      cnt:          count(),
    })
    .from(documentsTable)
    .where(
      and(
        orgId ? eq(documentsTable.organizationId, orgId) : sql`true`,
        sql`${documentsTable.discipline} IS NOT NULL`,
        sql`${documentsTable.documentType} IS NOT NULL`,
      ),
    )
    .groupBy(documentsTable.projectId, documentsTable.documentType, documentsTable.discipline)
    .having(sql`count(*) > 5`)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  res.json({
    totalDocs: Number(totalDocs),
    analyzedCount,
    coveragePct,
    urgencyDistribution: urgencyDist,
    needsAttention,
    duplicateSignals: duplicateSignals.map(s => ({ ...s, cnt: Number(s.cnt) })),
    generatedAt: new Date().toISOString(),
  });
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
  const validProviders = [
    "openrouter", "huggingface", "together", "ollama",
    "openai", "anthropic",
    "openai_replit", "groq",
    "none",
  ];
  if (provider !== undefined && !validProviders.includes(provider)) {
    res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
    return;
  }
  await updateAIProviderConfig({ provider, fastModel, smartModel });
  const config = await getAIProviderConfig();
  res.json({ ...config, providerStatus: getProviderStatus() });
});

// ─── AI Analysis History ──────────────────────────────────────────────────────

/**
 * GET /api/ai/analysis/:entityType/:entityId
 * Returns the full history of AI analyses for a given entity.
 * Query params:
 *   analysisType — filter to a specific analysis type (e.g. "analyze")
 *   latestOnly   — if "true", return only the most recent isLatest=true row per type
 */
router.get("/analysis/:entityType/:entityId", async (req, res) => {
  const { entityType, entityId: entityIdStr } = req.params;
  const entityId = parseInt(entityIdStr);
  const { analysisType, latestOnly } = req.query;
  const orgId = req.user!.organizationId;

  const conditions: any[] = [
    eq(aiAnalysisTable.entityType, entityType),
    eq(aiAnalysisTable.entityId, entityId),
  ];
  if (analysisType) conditions.push(eq(aiAnalysisTable.analysisType, analysisType as string));
  if (latestOnly === "true") conditions.push(eq(aiAnalysisTable.isLatest, true));
  if (orgId) conditions.push(eq(aiAnalysisTable.organizationId, orgId));

  const rows = await db.select().from(aiAnalysisTable)
    .where(and(...conditions))
    .orderBy(desc(aiAnalysisTable.createdAt))
    .limit(50);

  res.json({ analyses: rows, total: rows.length });
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

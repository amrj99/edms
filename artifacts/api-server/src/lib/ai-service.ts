/**
 * EDMS AI Service
 * Modular AI analysis using OpenAI gpt-5-mini (cost-effective) for standard analysis
 * and gpt-5.2 for complex reasoning tasks.
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { aiCacheTable, aiLogsTable, aiSettingsTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { logger } from "./logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FAST_MODEL = "gpt-5-mini";
const SMART_MODEL = "gpt-5.2";

// ─── Cache helpers ───────────────────────────────────────────────────────────

async function getCache(entityType: string, entityId: number, analysisType: string) {
  const rows = await db.select().from(aiCacheTable).where(
    and(
      eq(aiCacheTable.entityType, entityType),
      eq(aiCacheTable.entityId, entityId),
      eq(aiCacheTable.analysisType, analysisType),
      gt(aiCacheTable.expiresAt, new Date()),
    )
  ).limit(1);
  return rows[0]?.result ?? null;
}

async function setCache(
  entityType: string,
  entityId: number,
  analysisType: string,
  result: unknown,
  model: string,
) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  await db.insert(aiCacheTable).values({
    entityType, entityId, analysisType, result: result as any, model, expiresAt,
  }).onConflictDoUpdate({
    target: [aiCacheTable.entityType, aiCacheTable.entityId, aiCacheTable.analysisType],
    set: { result: result as any, model, expiresAt, createdAt: new Date() },
  });
}

async function logAiAction(opts: {
  userId?: number;
  module: string;
  action: string;
  entityType?: string;
  entityId?: number;
  tokensUsed?: number;
  latencyMs?: number;
  success: boolean;
  errorMessage?: string;
}) {
  await db.insert(aiLogsTable).values({
    userId: opts.userId,
    module: opts.module as any,
    action: opts.action,
    entityType: opts.entityType,
    entityId: opts.entityId,
    tokensUsed: opts.tokensUsed,
    latencyMs: opts.latencyMs,
    success: opts.success,
    errorMessage: opts.errorMessage,
  }).catch(() => {}); // Non-blocking
}

async function callAI(prompt: string, systemPrompt: string, model = FAST_MODEL, jsonMode = true): Promise<unknown> {
  const start = Date.now();
  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    ...(jsonMode && model !== SMART_MODEL ? { response_format: { type: "json_object" } } : {}),
  });

  const rawContent = response.choices[0]?.message?.content;
  const content = (rawContent === null || rawContent === undefined || rawContent === "")
    ? "{}"
    : rawContent;
  const latency = Date.now() - start;
  const tokens = response.usage?.total_tokens;

  logger.debug({ model, latency, tokens, contentLength: content.length }, "AI call completed");

  if (jsonMode) {
    try {
      // Extract JSON from possible markdown code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/```\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
      return JSON.parse(jsonStr);
    } catch {
      logger.warn({ content: content.substring(0, 200) }, "Failed to parse AI JSON response");
      return { raw: content };
    }
  }
  return content;
}

// ─── Module: AI Settings ─────────────────────────────────────────────────────

export async function isModuleEnabled(module: string, organizationId?: number): Promise<boolean> {
  if (!organizationId) return true; // Default: enabled if no org
  const rows = await db.select().from(aiSettingsTable).where(
    and(
      eq(aiSettingsTable.organizationId, organizationId),
      eq(aiSettingsTable.module, module as any),
    )
  ).limit(1);
  return rows.length === 0 ? true : rows[0].enabled; // Default: enabled
}

export async function getAiSettings(organizationId?: number) {
  if (!organizationId) return {};
  const rows = await db.select().from(aiSettingsTable).where(
    eq(aiSettingsTable.organizationId, organizationId)
  );
  const result: Record<string, boolean> = {};
  for (const row of rows) {
    result[row.module] = row.enabled;
  }
  return result;
}

export async function updateAiSettings(organizationId: number, settings: Record<string, boolean>) {
  for (const [module, enabled] of Object.entries(settings)) {
    await db.insert(aiSettingsTable).values({
      organizationId,
      module: module as any,
      enabled,
    }).onConflictDoUpdate({
      target: [aiSettingsTable.organizationId, aiSettingsTable.module],
      set: { enabled, updatedAt: new Date() },
    });
  }
}

// ─── Module: Documents ───────────────────────────────────────────────────────

export interface DocumentAnalysis {
  summary: string;
  classification: string;
  suggestedTags: string[];
  suggestedDiscipline?: string;
  urgencyLevel: "low" | "medium" | "high" | "critical";
  urgencyReason: string;
  recommendations: string[];
  confidence: number;
}

export async function analyzeDocument(doc: {
  id: number;
  title: string;
  documentNumber: string;
  documentType: string;
  discipline?: string | null;
  revision?: string | null;
  status: string;
  description?: string | null;
  fileName?: string | null;
  metadata?: unknown;
}, userId?: number, forceRefresh = false): Promise<DocumentAnalysis> {
  if (!forceRefresh) {
    const cached = await getCache("document", doc.id, "analyze");
    if (cached) return cached as DocumentAnalysis;
  }

  const start = Date.now();
  try {
    const result = await callAI(
      `Analyze this engineering document:
Title: ${doc.title}
Document Number: ${doc.documentNumber}
Type: ${doc.documentType}
Discipline: ${doc.discipline ?? "Unknown"}
Revision: ${doc.revision ?? "A"}
Status: ${doc.status}
Description: ${doc.description ?? "No description provided"}
File: ${doc.fileName ?? "No file"}

Respond with JSON only.`,
      `You are an expert engineering document management AI assistant. Analyze engineering documents and provide insights.
Respond ONLY with valid JSON in this exact schema:
{
  "summary": "2-3 sentence professional summary of the document",
  "classification": "one of: drawing, specification, report, memo, procedure, datasheet, certificate, correspondence, other",
  "suggestedTags": ["tag1", "tag2", "tag3"],
  "suggestedDiscipline": "one of: civil, structural, mechanical, electrical, piping, instrumentation, HVAC, fire-protection, other",
  "urgencyLevel": "one of: low, medium, high, critical",
  "urgencyReason": "brief reason for urgency level",
  "recommendations": ["action1", "action2"],
  "confidence": 0.0-1.0
}`,
    ) as DocumentAnalysis;

    await setCache("document", doc.id, "analyze", result, FAST_MODEL);
    await logAiAction({
      userId, module: "documents", action: "analyze",
      entityType: "document", entityId: doc.id,
      latencyMs: Date.now() - start, success: true,
    });

    return result;
  } catch (err) {
    await logAiAction({
      userId, module: "documents", action: "analyze",
      entityType: "document", entityId: doc.id,
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Correspondence ──────────────────────────────────────────────────

export interface CorrespondenceAnalysis {
  category: string;
  urgencyLevel: "low" | "medium" | "high" | "critical";
  urgencyReason: string;
  keyPoints: string[];
  suggestedReply: string;
  actionRequired: boolean;
  actionDescription?: string;
  estimatedResponseDays: number;
  sentiment: "positive" | "neutral" | "negative" | "urgent";
  relatedTopics: string[];
}

export async function analyzeCorrespondence(corr: {
  id: number;
  subject: string;
  type: string;
  body?: string | null;
  status: string;
  fromUserId?: number | null;
}, userId?: number, forceRefresh = false): Promise<CorrespondenceAnalysis> {
  if (!forceRefresh) {
    const cached = await getCache("correspondence", corr.id, "analyze");
    if (cached) return cached as CorrespondenceAnalysis;
  }

  const start = Date.now();
  try {
    const result = await callAI(
      `Analyze this engineering project correspondence:
Subject: ${corr.subject}
Type: ${corr.type}
Status: ${corr.status}
Body: ${corr.body ? corr.body.substring(0, 2000) : "No body content"}

Respond with JSON only.`,
      `You are an expert engineering project communication AI assistant. Analyze correspondence and provide actionable insights.
Respond ONLY with valid JSON in this exact schema:
{
  "category": "one of: RFI, transmittal, letter, memo, notice, approval, rejection, query, instruction, other",
  "urgencyLevel": "one of: low, medium, high, critical",
  "urgencyReason": "brief reason",
  "keyPoints": ["point1", "point2", "point3"],
  "suggestedReply": "professional reply draft (2-4 sentences)",
  "actionRequired": true/false,
  "actionDescription": "what action is needed if actionRequired is true",
  "estimatedResponseDays": 1-30,
  "sentiment": "one of: positive, neutral, negative, urgent",
  "relatedTopics": ["topic1", "topic2"]
}`,
    ) as CorrespondenceAnalysis;

    await setCache("correspondence", corr.id, "analyze", result, FAST_MODEL);
    await logAiAction({
      userId, module: "correspondence", action: "analyze",
      entityType: "correspondence", entityId: corr.id,
      latencyMs: Date.now() - start, success: true,
    });

    return result;
  } catch (err) {
    await logAiAction({
      userId, module: "correspondence", action: "analyze",
      entityType: "correspondence", entityId: corr.id,
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Tasks ───────────────────────────────────────────────────────────

export interface TaskPriorityInsight {
  taskId: number;
  aiPriority: "low" | "medium" | "high" | "urgent";
  aiScore: number; // 0-100
  reasoning: string;
  isBottleneck: boolean;
  suggestedAssignee?: string;
  suggestedDueDate?: string;
}

export interface TaskListInsights {
  tasks: TaskPriorityInsight[];
  overallRisk: "low" | "medium" | "high" | "critical";
  bottlenecks: string[];
  topRecommendations: string[];
}

export async function prioritizeTasks(tasks: Array<{
  id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: Date | null;
  sourceType?: string | null;
}>, userId?: number): Promise<TaskListInsights> {
  if (tasks.length === 0) {
    return { tasks: [], overallRisk: "low", bottlenecks: [], topRecommendations: [] };
  }

  const start = Date.now();
  const tasksJson = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.toISOString().split("T")[0] : null,
    source: t.sourceType ?? "manual",
  }));

  try {
    const result = await callAI(
      `Analyze and prioritize these engineering project tasks. Today's date: ${new Date().toISOString().split("T")[0]}

Tasks: ${JSON.stringify(tasksJson, null, 2)}

Respond with JSON only.`,
      `You are an expert project manager AI. Analyze task lists and identify priorities, bottlenecks, and risks.
Respond ONLY with valid JSON in this exact schema:
{
  "tasks": [
    {
      "taskId": <number>,
      "aiPriority": "low|medium|high|urgent",
      "aiScore": <0-100>,
      "reasoning": "brief reason",
      "isBottleneck": true/false
    }
  ],
  "overallRisk": "low|medium|high|critical",
  "bottlenecks": ["bottleneck1", "bottleneck2"],
  "topRecommendations": ["action1", "action2", "action3"]
}`,
      SMART_MODEL,
    ) as TaskListInsights;

    await logAiAction({
      userId, module: "tasks", action: "prioritize",
      latencyMs: Date.now() - start, success: true,
    });

    return result;
  } catch (err) {
    await logAiAction({
      userId, module: "tasks", action: "prioritize",
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Search ──────────────────────────────────────────────────────────

export interface NaturalLanguageSearchResult {
  query: string;
  interpretation: string;
  type: "document" | "correspondence" | "task" | "all";
  discipline?: string;
  status?: string;
  documentType?: string;
  keywords: string[];
  suggestions: string[];
}

export async function parseNaturalLanguageSearch(query: string): Promise<NaturalLanguageSearchResult> {
  const result = await callAI(
    `Parse this natural language search query from an engineering document management system:
"${query}"

Respond with JSON only.`,
    `You are an AI search assistant for an engineering document management system (EDMS).
Extract structured search parameters from natural language queries.
Respond ONLY with valid JSON in this exact schema:
{
  "query": "<cleaned search keywords>",
  "interpretation": "<what the user is looking for in plain English>",
  "type": "document|correspondence|task|all",
  "discipline": "<engineering discipline if mentioned, else null>",
  "status": "<status filter if mentioned, else null>",
  "documentType": "<document type if mentioned, else null>",
  "keywords": ["keyword1", "keyword2"],
  "suggestions": ["related search 1", "related search 2"]
}`,
  ) as NaturalLanguageSearchResult;

  return { ...result, query };
}

// ─── Module: AI Document Management & Coding ─────────────────────────────────

export interface DocumentProcedureSuggestion {
  suggestedDocumentNumber: string;
  numberingReason: string;
  suggestedClassification: string;
  suggestedDiscipline: string;
  suggestedTitle?: string;
  suggestedRevision: string;
  requiredMetadata?: Array<{ field: string; description: string; required: boolean }>;
  namingConvention: string;
  procedureNotes: string;
  confidence: number;
}

export async function suggestDocumentProcedure(input: {
  projectCode?: string;
  projectName?: string;
  discipline?: string;
  documentType?: string;
  partialTitle?: string;
  existingNumbers?: string[];
  organizationName?: string;
}, userId?: number): Promise<DocumentProcedureSuggestion> {
  const start = Date.now();
  try {
    const result = await callAI(
      `Generate a document numbering suggestion. Return JSON with these fields:
- suggestedDocumentNumber: the document number (e.g. "${input.projectCode ?? "PRJ"}-ELE-DWG-001")
- numberingReason: brief explanation
- suggestedClassification: document classification
- suggestedDiscipline: engineering discipline  
- suggestedTitle: full document title
- suggestedRevision: revision code (e.g. "00" or "A")
- namingConvention: naming pattern used
- procedureNotes: key procedure notes
- confidence: number between 0 and 1

Context:
Project Code: ${input.projectCode ?? "PRJ"}
Project Name: ${input.projectName ?? "Unknown Project"}
Discipline: ${input.discipline ?? "General"}
Document Type: ${input.documentType ?? "Drawing"}
Partial Title: ${input.partialTitle ?? ""}
Existing Numbers: ${input.existingNumbers?.join(", ") || "None"}`,
      `You are an engineering document management expert. Respond with valid JSON only.`,
      FAST_MODEL,
      false,
    ) as string;

    // Parse JSON from the text response
    let parsed: DocumentProcedureSuggestion;
    try {
      const jsonMatch = (result as string).match(/```json\s*([\s\S]*?)```/) ||
                        (result as string).match(/```\s*([\s\S]*?)```/) ||
                        (result as string).match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : (result as string).trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      logger.warn({ result: String(result).substring(0, 200) }, "Failed to parse procedure suggestion");
      parsed = {
        suggestedDocumentNumber: `${input.projectCode ?? "PRJ"}-${(input.discipline ?? "GEN").substring(0, 3).toUpperCase()}-001`,
        numberingReason: "Standard engineering document numbering",
        suggestedClassification: input.documentType ?? "Drawing",
        suggestedDiscipline: input.discipline ?? "General",
        suggestedTitle: input.partialTitle ?? "Engineering Document",
        suggestedRevision: "00",
        namingConvention: "[ProjectCode]-[Discipline]-[Sequence]",
        procedureNotes: "Follow project document control procedures",
        confidence: 0.5,
      };
    }

    await logAiAction({
      userId, module: "documents", action: "suggest_procedure",
      latencyMs: Date.now() - start, success: true,
    });

    return parsed;
  } catch (err) {
    await logAiAction({
      userId, module: "documents", action: "suggest_procedure",
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Notifications / Urgency ─────────────────────────────────────────

export async function scoreNotificationUrgency(notifications: Array<{
  id: number | string;
  type: string;
  message: string;
  createdAt?: Date;
}>): Promise<Array<{ id: number | string; urgency: number; reason: string }>> {
  if (notifications.length === 0) return [];

  const result = await callAI(
    `Score the urgency of these engineering project notifications (0=not urgent, 100=critical):
${JSON.stringify(notifications.map(n => ({ id: n.id, type: n.type, message: n.message })))},

Respond with JSON only.`,
    `You are an engineering project AI assistant. Score notification urgency.
Respond ONLY with JSON: {"scores": [{"id": <id>, "urgency": <0-100>, "reason": "<brief>"}]}`,
  ) as { scores: Array<{ id: number | string; urgency: number; reason: string }> };

  return result.scores ?? [];
}

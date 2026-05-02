/**
 * Correspondence AI — analysis and insights for correspondence items.
 */
import { callAI, logAiAction, getCache, setCache, lookupAnalysis, saveAnalysis, getOrgPrivacyMode } from "./ai-core.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── analyzeCorrespondence ────────────────────────────────────────────────────

export async function analyzeCorrespondence(corr: {
  id: number;
  subject: string;
  type: string;
  body?: string | null;
  status: string;
  fromUserId?: number | null;
}, userId?: number, forceRefresh = false, organizationId?: number | null): Promise<CorrespondenceAnalysis> {
  // 1. Permanent store lookup
  if (!forceRefresh) {
    const stored = await lookupAnalysis("correspondence", corr.id, "analyze", null, organizationId);
    if (stored) return stored as CorrespondenceAnalysis;
  }

  // 2. Short-term cache lookup
  if (!forceRefresh) {
    const cached = await getCache("correspondence", corr.id, "analyze", organizationId);
    if (cached) {
      await saveAnalysis({
        entityType: "correspondence", entityId: corr.id, analysisType: "analyze",
        entityRevision: null, organizationId,
        result: cached, provider: "cache", model: "cache",
      }).catch(() => {});
      return cached as CorrespondenceAnalysis;
    }
  }

  const privacyMode = await getOrgPrivacyMode(organizationId);
  const start = Date.now();
  try {
    const { data: result, provider, model, tokensUsed } = await callAI(
      privacyMode
        ? `Analyze this engineering project correspondence (privacy mode — metadata only):
Subject: ${corr.subject}
Type: ${corr.type}
Status: ${corr.status}

Note: Full correspondence content unavailable in privacy mode. Provide analysis from metadata only.

Respond with JSON only.`
        : `Analyze this engineering project correspondence:
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
      "fast",
      true,
      organizationId,
    );

    const latencyMs = Date.now() - start;

    const analysis = result as CorrespondenceAnalysis;
    if (privacyMode) {
      analysis.urgencyReason = `[Privacy mode — analysis based on metadata only] ${analysis.urgencyReason ?? ""}`.trim();
    }

    await saveAnalysis({
      entityType: "correspondence", entityId: corr.id, analysisType: "analyze",
      entityRevision: null, organizationId,
      result: analysis, provider, model, tokensUsed, latencyMs,
      triggeredBy: userId,
    }).catch(err => logger.warn({ err }, "saveAnalysis failed (non-fatal)"));

    await setCache("correspondence", corr.id, "analyze", analysis, model, organizationId);

    await logAiAction({
      organizationId, userId, module: "correspondence", action: "analyze",
      entityType: "correspondence", entityId: corr.id,
      provider, model, tokensUsed, latencyMs, success: true,
    });

    return analysis;
  } catch (err) {
    await logAiAction({
      organizationId, userId, module: "correspondence", action: "analyze",
      entityType: "correspondence", entityId: corr.id,
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

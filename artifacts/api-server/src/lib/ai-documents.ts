/**
 * Document AI — analysis, procedure suggestion, classification, metadata extraction.
 * Imports infrastructure from ai-core and settings from ai-settings.
 */
import {
  callAI, logAiAction, getCache, setCache,
  getAIProviderConfig, getOrgAiQuota, buildProviderClient,
  getSystemSettingValue, lookupAnalysis, saveAnalysis,
} from "./ai-core.js";
import { isModuleEnabled } from "./ai-settings.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface ClassificationResult {
  category: string;
  tags: string[];
  priority: "low" | "medium" | "high" | "critical";
}

export interface ExtractedDocMeta {
  metadata: {
    title?: string;
    code?: string;
    discipline?: string;
    docType?: string;
    revision?: string;
    date?: string;
    issuer?: string;
    isReply?: boolean;
    replyTo?: string;
  };
  confidence: number;
}

// ─── analyzeDocument ─────────────────────────────────────────────────────────

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
}, userId?: number, forceRefresh = false, organizationId?: number | null): Promise<DocumentAnalysis> {
  const revision = doc.revision ?? null;

  // 1. Permanent store lookup (fastest — zero API cost)
  if (!forceRefresh) {
    const stored = await lookupAnalysis("document", doc.id, "analyze", revision, organizationId);
    if (stored) return stored as DocumentAnalysis;
  }

  // 2. Short-term cache lookup (still avoids API call)
  if (!forceRefresh) {
    const cached = await getCache("document", doc.id, "analyze", organizationId);
    if (cached) {
      // Backfill into permanent store for future requests
      await saveAnalysis({
        entityType: "document", entityId: doc.id, analysisType: "analyze",
        entityRevision: revision, organizationId,
        result: cached, provider: "cache", model: "cache",
      }).catch(() => {});
      return cached as DocumentAnalysis;
    }
  }

  const start = Date.now();
  try {
    const { data: result, provider, model, tokensUsed } = await callAI(
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
    );

    const latencyMs = Date.now() - start;

    // Write to permanent store (append-only history)
    await saveAnalysis({
      entityType: "document", entityId: doc.id, analysisType: "analyze",
      entityRevision: revision, organizationId,
      result, provider, model, tokensUsed, latencyMs,
      triggeredBy: userId,
    }).catch(err => logger.warn({ err }, "saveAnalysis failed (non-fatal)"));

    // Write to short-term cache (dedup layer)
    await setCache("document", doc.id, "analyze", result, model, organizationId);

    await logAiAction({
      organizationId, userId, module: "documents", action: "analyze",
      entityType: "document", entityId: doc.id,
      provider, model, tokensUsed, latencyMs, success: true,
    });

    return result as DocumentAnalysis;
  } catch (err) {
    await logAiAction({
      organizationId, userId, module: "documents", action: "analyze",
      entityType: "document", entityId: doc.id,
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── suggestDocumentProcedure ─────────────────────────────────────────────────

export async function suggestDocumentProcedure(input: {
  projectCode?: string;
  projectName?: string;
  discipline?: string;
  documentType?: string;
  partialTitle?: string;
  existingNumbers?: string[];
  organizationName?: string;
  orgCode?: string;
  numberingFormat?: string;
  /** Next sequence number for this (project × org × discipline × type) scope */
  nextSeq?: number;
}, userId?: number): Promise<DocumentProcedureSuggestion> {
  const start = Date.now();

  // Resolve the numbering format and substitute known tokens with concrete values
  // so the AI knows exactly what pattern to follow.
  const fmt = input.numberingFormat ?? "{PROJECT}-{DISCIPLINE}-{TYPE}-{SEQ}";
  const seqStr = String(input.nextSeq ?? 1).padStart(3, "0");
  const resolvedExample = fmt
    .replace("{PROJECT}", input.projectCode ?? "PRJ")
    .replace("{ORG}", input.orgCode ?? "ORG")
    .replace("{DISCIPLINE}", (input.discipline ?? "ELE").substring(0, 3).toUpperCase())
    .replace("{TYPE}", "DWG")
    .replace("{SEQ}", seqStr);

  try {
    const { data: rawData, provider, model, tokensUsed } = await callAI(
      `Generate a document numbering suggestion. Return JSON with these fields:
- suggestedDocumentNumber: the document number following the exact format template below
- numberingReason: brief explanation
- suggestedClassification: document classification
- suggestedDiscipline: engineering discipline  
- suggestedTitle: full document title
- suggestedRevision: revision code (e.g. "00" or "A")
- namingConvention: naming pattern used
- procedureNotes: key procedure notes
- confidence: number between 0 and 1

Numbering Format Template: ${fmt}
Token meanings:
  {PROJECT}    = project code
  {ORG}        = organization short code (e.g. "ARC", "MCO")
  {DISCIPLINE} = discipline abbreviation (e.g. "STR", "ELE", "MEC")
  {TYPE}       = document type abbreviation (e.g. "DWG", "RPT", "SPC")
  {SEQ}        = zero-padded sequence number (e.g. "001", "0042")

Example for this context: ${resolvedExample}

Context:
Project Code: ${input.projectCode ?? "PRJ"}
Project Name: ${input.projectName ?? "Unknown Project"}
Organization Code: ${input.orgCode ?? "ORG"}
Organization Name: ${input.organizationName ?? ""}
Discipline: ${input.discipline ?? "General"}
Document Type: ${input.documentType ?? "Drawing"}
Partial Title: ${input.partialTitle ?? ""}
Existing Numbers: ${input.existingNumbers?.join(", ") || "None"}

Important: 
- The suggestedDocumentNumber MUST follow the format template exactly.
- Use ${seqStr} as the {SEQ} value — this is the pre-computed next sequence number scoped to this project + org + discipline + type combination.
- Do NOT increment or re-derive {SEQ} from existing numbers; use ${seqStr} exactly (zero-padded to the same width).`,
      `You are an engineering document management expert. Respond with valid JSON only.`,
      "fast",
      false,
    );

    const result = rawData as string;
    let parsed: DocumentProcedureSuggestion;
    try {
      const jsonMatch = result.match(/```json\s*([\s\S]*?)```/) ||
                        result.match(/```\s*([\s\S]*?)```/) ||
                        result.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      logger.warn({ result: String(result).substring(0, 200) }, "Failed to parse procedure suggestion");
      // Deterministic fallback: resolve the format template directly
      const fallbackNum = fmt
        .replace("{PROJECT}", input.projectCode ?? "PRJ")
        .replace("{ORG}", input.orgCode ?? "ORG")
        .replace("{DISCIPLINE}", (input.discipline ?? "GEN").substring(0, 3).toUpperCase())
        .replace("{TYPE}", (input.documentType ?? "DWG").substring(0, 3).toUpperCase())
        .replace("{SEQ}", seqStr);
      parsed = {
        suggestedDocumentNumber: fallbackNum,
        numberingReason: "Standard engineering document numbering",
        suggestedClassification: input.documentType ?? "Drawing",
        suggestedDiscipline: input.discipline ?? "General",
        suggestedTitle: input.partialTitle ?? "Engineering Document",
        suggestedRevision: "00",
        namingConvention: fmt,
        procedureNotes: "Follow project document control procedures",
        confidence: 0.5,
      };
    }

    await logAiAction({
      userId, module: "documents", action: "suggest_procedure",
      provider, model, tokensUsed,
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

// ─── classifyItem ─────────────────────────────────────────────────────────────

export async function classifyItem(input: {
  type: "document" | "correspondence";
  organizationId?: number | null;
  title?: string | null;
  documentType?: string | null;
  discipline?: string | null;
  subject?: string | null;
  body?: string | null;
}): Promise<ClassificationResult | null> {
  const classificationEnabled = await getSystemSettingValue("ai_classification_enabled");
  if (classificationEnabled === "false") return null;

  if (input.organizationId) {
    const module = input.type === "document" ? "documents" : "correspondence";
    const orgEnabled = await isModuleEnabled(module, input.organizationId);
    if (!orgEnabled) return null;
  }

  if (input.organizationId) {
    const quota = await getOrgAiQuota(input.organizationId);
    if (quota.dailyLimit > 0 && quota.usedToday >= quota.dailyLimit) {
      logger.warn({ organizationId: input.organizationId }, "classifyItem skipped — org AI daily quota reached");
      return null;
    }
    if (quota.monthlyTokenLimit > 0 && quota.usedTokensThisMonth >= quota.monthlyTokenLimit) {
      logger.warn({ organizationId: input.organizationId }, "classifyItem skipped — org AI monthly token quota reached");
      return null;
    }

    if (quota.provider !== null) {
      if (quota.provider === "none") return null;

      const orgClient = await buildProviderClient(quota.provider);
      if (!orgClient) return null;

      const providerDefaults: Record<string, string> = {
        openai: "gpt-4o-mini",
        groq:   "llama-3.1-8b-instant",
        ollama: "llama3.2",
      };
      const model = quota.model ?? providerDefaults[quota.provider] ?? "gpt-4o-mini";

      const context = input.type === "document"
        ? `Document: "${input.title ?? ""}" | Type: ${input.documentType ?? "unknown"} | Discipline: ${input.discipline ?? "unknown"}`
        : `Correspondence subject: "${input.subject ?? ""}" | Body preview: ${(input.body ?? "").slice(0, 200)}`;

      try {
        const response = await orgClient.chat.completions.create({
          model,
          max_completion_tokens: 512,
          messages: [
            { role: "system", content: "You are an engineering document classification AI. Classify documents concisely." },
            {
              role: "user",
              content: `Classify this engineering document/correspondence for an EDMS system.\n${context}\n\nRespond with JSON only: {"category": "<one of: Drawing|Report|Procedure|Specification|Letter|Memo|RFI|NCR|Other>", "tags": ["<tag1>","<tag2>"], "priority": "<low|medium|high|critical>"}`,
            },
          ],
          ...(quota.provider !== "groq" ? { response_format: { type: "json_object" } } : {}),
        });
        const content = response.choices[0]?.message?.content ?? "{}";
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/```\s*([\s\S]*?)```/);
        const jsonStr  = jsonMatch ? jsonMatch[1].trim() : content.trim();
        return JSON.parse(jsonStr) as ClassificationResult;
      } catch (err) {
        logger.warn({ err, provider: quota.provider }, "Org-level classifyItem call failed");
        return null;
      }
    }
  }

  const { provider } = await getAIProviderConfig();
  if (provider === "none") return null;

  const context = input.type === "document"
    ? `Document: "${input.title ?? ""}" | Type: ${input.documentType ?? "unknown"} | Discipline: ${input.discipline ?? "unknown"}`
    : `Correspondence subject: "${input.subject ?? ""}" | Body preview: ${(input.body ?? "").slice(0, 200)}`;

  const { data: result } = await callAI(
    `Classify this engineering document/correspondence for an EDMS system.
${context}

Respond with JSON only: {"category": "<one of: Drawing|Report|Procedure|Specification|Letter|Memo|RFI|NCR|Other>", "tags": ["<tag1>","<tag2>"], "priority": "<low|medium|high|critical>"}`,
    "You are an engineering document classification AI. Classify documents concisely.",
    "fast",
    true,
  );

  return (result as ClassificationResult | null) ?? null;
}

// ─── getOrgProvider ───────────────────────────────────────────────────────────

export async function getOrgProvider(organizationId: number): Promise<string | null> {
  try {
    const quota = await getOrgAiQuota(organizationId);
    return quota.provider && quota.provider !== "none" ? quota.provider : null;
  } catch {
    const { provider } = await getAIProviderConfig();
    return provider !== "none" ? provider : null;
  }
}

// ─── extractDocumentMetadataFromPath ─────────────────────────────────────────

export async function extractDocumentMetadataFromPath(
  filePath: string,
  fileName: string,
): Promise<ExtractedDocMeta> {
  const prompt = `You are an engineering document management AI. Given a file path from an engineering project, extract document metadata.

File path: "${filePath}"
File name: "${fileName}"

Extract the following metadata (leave empty string if not determinable):
- title: Human-readable document title
- code: Document number/code (e.g., ABC-CIV-DWG-001)
- discipline: Engineering discipline (Civil, Structural, Mechanical, Electrical, Instrumentation, Piping, Process, Architecture, HVAC, General)
- docType: Document type (Drawing, Specification, Report, Calculation, Procedure, Manual, Letter, Transmittal, ITR, NCR, WIR, RFI, Other)
- revision: Revision identifier (e.g., A, B, 1, 2, P1)
- date: Date in YYYY-MM-DD format if discernible
- issuer: Issuing company or person if in path
- isReply: true if the document appears to be a reply (look for Re:, response, reply in name)
- replyTo: Referenced document number if this is a reply
- confidence: Integer 0-100 representing extraction confidence

Return JSON only.`;

  try {
    const { data: rawResult } = await callAI(
      prompt,
      "You extract structured metadata from engineering document paths. Return valid JSON only.",
      "fast",
      true,
    );

    const result = rawResult as ExtractedDocMeta["metadata"] & { confidence?: number };
    const confidence = typeof result?.confidence === "number" ? result.confidence : 50;
    const { confidence: _, ...metadata } = result as any;
    return { metadata, confidence };
  } catch {
    return { metadata: {}, confidence: 0 };
  }
}

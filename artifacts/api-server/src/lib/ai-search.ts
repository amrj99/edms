/**
 * Search AI — natural language query parsing for EDMS search.
 */
import { callAI } from "./ai-core.js";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── parseNaturalLanguageSearch ───────────────────────────────────────────────

export async function parseNaturalLanguageSearch(query: string): Promise<NaturalLanguageSearchResult> {
  const { data: result } = await callAI(
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
  );

  return { ...(result as NaturalLanguageSearchResult), query };
}

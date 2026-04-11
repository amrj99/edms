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
  dateFrom?: string | null;
  dateTo?: string | null;
  projectName?: string | null;
}

// ─── parseNaturalLanguageSearch ───────────────────────────────────────────────

export async function parseNaturalLanguageSearch(query: string): Promise<NaturalLanguageSearchResult> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: result } = await callAI(
    `Parse this natural language search query from an engineering document management system:
"${query}"

Today's date is ${today}. Use it to resolve relative date expressions (e.g. "last month", "this week", "past 30 days").

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
  "suggestions": ["related search 1", "related search 2"],
  "dateFrom": "<ISO 8601 date YYYY-MM-DD if a start date or 'from' date is implied, else null>",
  "dateTo": "<ISO 8601 date YYYY-MM-DD if an end date or 'to' date is implied, else null>",
  "projectName": "<project name or code if a specific project is mentioned, else null>"
}

Date extraction examples:
- "last month" → dateFrom = first day of last month, dateTo = last day of last month
- "this week" → dateFrom = Monday of current week, dateTo = today
- "past 30 days" → dateFrom = 30 days ago, dateTo = today
- "before June" → dateTo = 2026-05-31
- "since Q1" → dateFrom = 2026-01-01`,
  );

  return { ...(result as NaturalLanguageSearchResult), query };
}

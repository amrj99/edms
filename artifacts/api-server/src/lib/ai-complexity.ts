/**
 * AI Complexity Detection — rule-based only, zero AI classification.
 *
 * Classifies a request as "simple" or "complex" based on text patterns,
 * file metadata, and request type. The result drives the hybrid routing
 * decision in /command:
 *
 *   simple   → free provider (Cloudflare) — save credits
 *   complex  + credits available → prompt user before charging premium
 *   complex  + no credits        → free provider anyway, no deduction
 *
 * ── Future-ready (item 7) ──────────────────────────────────────────────────────
 * FreeTierProvider is exported so callers can express preference for a specific
 * free-tier provider (Groq, Cloudflare, etc.) without changing routing logic.
 * Multi-free-provider selection is NOT yet integrated — this is the interface
 * placeholder only.
 */

// ─── Shared result type ───────────────────────────────────────────────────────

export interface ComplexityResult {
  complexity: "simple" | "complex";
  /** Human-readable explanation of why this classification was chosen. */
  reason: string;
}

// ─── Future-ready: free-tier provider preference ──────────────────────────────
// Extend this union as additional free providers are integrated (e.g. "groq").
// NOT yet wired into routing logic.

export type FreeTierProvider = "cloudflare" | "groq";

// ─── Command complexity (for /command route) ──────────────────────────────────

/**
 * Patterns that indicate a complex AI command.
 * Each regex is tested against the full command string (case-insensitive).
 * First match wins. Keep patterns specific — broad patterns produce false positives.
 */
const COMPLEX_PATTERNS: Array<{ test: RegExp; label: string }> = [
  { test: /\banalyz(e|is|ing|ed)\b/i,                    label: "analysis request" },
  { test: /\bcompar(e|ison|ing|ed)\b/i,                  label: "comparison request" },
  { test: /\b(review|audit)ing?\b/i,                     label: "review/audit" },
  { test: /\bcomplian(ce|t)\b/i,                         label: "compliance check" },
  { test: /\blegal\b|\bregulat(ory|ion)\b/i,             label: "legal/regulatory" },
  { test: /\bdetailed?\b|\bcomprehensive\b/i,            label: "detailed report" },
  { test: /\bsummar(y|iz(e|ing|ation))\b/i,              label: "summarization" },
  { test: /\bevaluat(e|ion|ing|ed)\b/i,                  label: "evaluation" },
  { test: /\bassess(ment|ing|ed)?\b/i,                   label: "assessment" },
  { test: /\bmultiple\b.{0,30}\b(document|file|record)/i, label: "multi-document operation" },
  { test: /\ball\b.{0,20}\bdocument/i,                   label: "bulk document operation" },
  { test: /\bextract\b.{0,20}\b(data|info|field)/i,      label: "data extraction" },
];

/** Commands longer than this word count are unconditionally complex. */
const COMPLEX_WORD_THRESHOLD = 40;

/**
 * Classify a /command text as simple or complex.
 *
 * Rule-based only — deterministic, instant, zero external calls.
 * Add entries to COMPLEX_PATTERNS to tune without code-structure changes.
 */
export function detectCommandComplexity(command: string): ComplexityResult {
  const trimmed   = command.trim();
  const wordCount = trimmed.split(/\s+/).length;

  if (wordCount > COMPLEX_WORD_THRESHOLD) {
    return {
      complexity: "complex",
      reason:     `long command (${wordCount} words — threshold: ${COMPLEX_WORD_THRESHOLD})`,
    };
  }

  for (const { test, label } of COMPLEX_PATTERNS) {
    if (test.test(trimmed)) {
      return { complexity: "complex", reason: label };
    }
  }

  return { complexity: "simple", reason: "standard operation" };
}

// ─── File / document complexity (for document analysis routes) ────────────────

export interface FileComplexityParams {
  /** Raw file size in bytes. */
  fileSizeBytes?: number;
  /** Detected or user-supplied page count. */
  pageCount?: number;
  /** Type of analysis the caller is performing. */
  analysisType?: "analysis" | "comparison" | "legal" | "compliance" | "summary" | "other";
}

const COMPLEX_ANALYSIS_TYPES = new Set<string>(["analysis", "comparison", "legal", "compliance", "summary"]);
const COMPLEX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const COMPLEX_PAGE_THRESHOLD  = 20;

/**
 * Classify a document analysis request as simple or complex.
 *
 * Call from document / correspondence analysis routes, NOT from /command.
 * Thresholds are tunable here independently of command complexity.
 */
export function detectFileComplexity(params: FileComplexityParams): ComplexityResult {
  const { fileSizeBytes = 0, pageCount = 0, analysisType = "other" } = params;

  if (COMPLEX_ANALYSIS_TYPES.has(analysisType)) {
    return { complexity: "complex", reason: `analysis type: ${analysisType}` };
  }
  if (fileSizeBytes > COMPLEX_FILE_SIZE_BYTES) {
    const mb = (fileSizeBytes / 1024 / 1024).toFixed(1);
    return { complexity: "complex", reason: `large file (${mb} MB > 5 MB threshold)` };
  }
  if (pageCount > COMPLEX_PAGE_THRESHOLD) {
    return { complexity: "complex", reason: `many pages (${pageCount} > ${COMPLEX_PAGE_THRESHOLD} threshold)` };
  }

  return { complexity: "simple", reason: "small/standard document" };
}

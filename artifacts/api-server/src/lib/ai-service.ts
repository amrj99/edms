/**
 * AI Service — re-export barrel.
 *
 * All public AI symbols are sourced from their domain modules.
 * External code (routes, other libs) should import from here, not from
 * the individual domain files, to keep the public API stable.
 *
 * Internal structure:
 *   ai-core.ts          — provider mgmt, callAI, cache, logs, quota, analysis store
 *   ai-settings.ts      — per-org module toggles
 *   ai-documents.ts     — document analysis, classification, procedure suggestion
 *   ai-correspondence.ts — correspondence analysis
 *   ai-tasks.ts         — task prioritization, notification urgency
 *   ai-search.ts        — natural language search parsing
 */

export * from "./ai-core.js";
export * from "./ai-settings.js";
export * from "./ai-documents.js";
export * from "./ai-correspondence.js";
export * from "./ai-tasks.js";
export * from "./ai-search.js";

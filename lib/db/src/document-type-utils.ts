/**
 * document-type-utils.ts
 *
 * Single shared definition of how a `document_types.code` is derived from a
 * raw, user-typed document type string. Used by:
 *   - the document-types CRUD route (validating/normalizing `code` on create)
 *   - the seed-document-types script (grouping legacy documents.documentType values)
 *   - the workflow-engine `for-type/:docType` fallback matcher
 *
 * Keeping this in one place avoids the silent-mismatch failure mode where
 * each call site normalizes case/whitespace differently and "Drawing" /
 * "drawing" / " DRAWING " end up treated as different types.
 */

/**
 * Normalize a raw document type string into a stable `code`.
 * Trims whitespace, uppercases, and collapses internal whitespace runs to "_".
 *
 * @example
 *   normalizeDocTypeCode("  drawing ")  // "DRAWING"
 *   normalizeDocTypeCode("Method Statement") // "METHOD_STATEMENT"
 */
export function normalizeDocTypeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

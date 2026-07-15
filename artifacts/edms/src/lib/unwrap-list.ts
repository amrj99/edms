/**
 * unwrap-list.ts — C-7 unified list-response contract (Phase 1, consumer-first).
 *
 * WHY: list endpoints historically returned domain-named envelopes
 * (`{ documents }`, `{ users }`, `{ folders }`, …). C-7 introduces one canonical
 * envelope `{ items }`. During the migration window an endpoint returns EITHER
 * the new `{ items }` OR its legacy `{ <legacyKey> }`; this primitive reads
 * whichever is present, ALWAYS preferring `items`, so consumers become
 * backend-version agnostic WITHOUT the server duplicating the array on the wire.
 *
 * SCOPE — use ONLY with single-list endpoints in the C-7 matrix:
 *   documents · folders · users · projects · organizations · tasks ·
 *   workflow instances · meetings · action-items · document/calendar events ·
 *   notifications.
 *
 * DO NOT use with (the call site parses these directly — they are NOT single lists):
 *   • Composite / multi-list: GET /api/search ({documents, correspondence, meetings, projects}),
 *     transmittals suggestions ({documents, correspondence, queryTokens}).
 *   • Cursor: chat messages ({messages, hasMore}) → see CursorListResponse (future).
 *   • Admin diagnostic: /api/admin/usage ({orgs,…}), /api/admin/shadow-log ({rows,…}).
 */

/** Canonical C-7 list envelope. `total`/`page`/`limit`/`hasMore` are present only
 *  where the endpoint already computes them (never synthesised — no new COUNT). */
export interface ListResponse<T> {
  items: T[];
  total?: number;
  page?: number;
  limit?: number;
  hasMore?: boolean;
}

/** Registered for a FUTURE, separate contract (chat messages). NOT used in C-7. */
export interface CursorListResponse<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string | number;
}

/**
 * Read the list array from a SINGLE-list API response, preferring the new
 * `items` envelope and falling back to the legacy key during migration.
 *
 * Contract (fail-loud — never hides a contract regression as `[]`):
 *  1. `undefined`            → `[]`  (React Query's documented initial/loading
 *                                     state, where the caller passes `data`
 *                                     before the first fetch). This is the ONLY
 *                                     absent-value that yields an empty list.
 *  2. `null` / non-object    → THROWS (a `null` body is a contract error, not an
 *                                     empty list).
 *  3. `items` present        → must be an array → returned. If present but NOT an
 *                                     array → THROWS (no silent fallback to legacy).
 *  4. `items` absent         → `response[legacyKey]`, if an array, is returned.
 *  5. neither valid          → THROWS with a diagnostic naming `legacyKey` and the
 *                                     present keys — NEVER the response body/values.
 *  6. an empty array         → a valid result (returned as-is).
 *
 * No `any`: input is `unknown` and narrowed at runtime.
 *
 * @throws Error on any invalid contract shape (cases 2, 3-not-array, 5).
 */
export function unwrapList<T>(response: unknown, legacyKey: string): T[] {
  if (response === undefined) return []; // (1) loading/initial only

  if (response === null || typeof response !== "object") {
    // (2) null or non-object is a contract error, not an empty list
    throw new Error(
      `Invalid list response: expected an object with "items" or legacy key "${legacyKey}", ` +
        `received ${response === null ? "null" : typeof response}.`,
    );
  }

  const obj = response as Record<string, unknown>;

  if ("items" in obj) {
    // (3) items present → must be an array; no silent fallback if malformed
    if (Array.isArray(obj.items)) return obj.items as T[];
    throw new Error(
      `Invalid list response: "items" is present but is not an array (got ${typeof obj.items}).`,
    );
  }

  const legacy = obj[legacyKey];
  if (Array.isArray(legacy)) return legacy as T[]; // (4)

  // (5) neither a valid `items` nor a valid legacy array — keys only, no body values
  throw new Error(
    `Invalid list response: expected "items" or legacy key "${legacyKey}" to be an array. ` +
      `Present keys: [${Object.keys(obj).join(", ")}].`,
  );
}

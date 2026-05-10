/**
 * In-process deduplication cache for file_preview audit events.
 *
 * Problem: browser-rendered files (PDFs, images) trigger multiple GET requests
 * per session — every iframe refresh, viewport resize, or page navigation
 * re-fetches the same object.  Writing an audit row for every HTTP request
 * produces high-volume, low-signal noise.
 *
 * Solution: a lightweight in-process Map keyed on userId:storageKey.
 * If the same user has a file_preview audit row within the dedup window,
 * the call is suppressed.  file_download and file_signed_access events
 * are never deduplicated — every one is a distinct forensic event.
 *
 * Configuration:
 *   FILE_AUDIT_DEDUP_WINDOW_MS — dedup window in milliseconds (default 60000 = 60 s)
 *
 * Limitations:
 *   - Per-process only.  If the API scales to multiple instances each will have
 *     its own cache.  At single-instance VPS deployment this is not a concern.
 *   - Not persisted across restarts — acceptable for forensic dedup (restarts are
 *     infrequent; a brief burst of duplicate preview events on restart is harmless).
 *
 * Memory:  bounded by lazy eviction.  Eviction runs when the Map exceeds
 *   MAX_CACHE_ENTRIES.  At 1 active user × 20 open documents = 20 entries;
 *   the limit of 2000 gives a very large safety margin.
 */

const DEDUP_WINDOW_MS: number =
  parseInt(process.env.FILE_AUDIT_DEDUP_WINDOW_MS ?? "60000", 10);

const MAX_CACHE_ENTRIES = 2000;

/** key → timestamp (ms) of the last audit write */
const cache = new Map<string, number>();

/**
 * Returns true if a file_preview audit event should be written for this
 * (userId, storageKey) pair.  Also updates the cache entry so the next call
 * within the window returns false.
 *
 * Always returns true for the first access within any given window.
 */
export function shouldAuditFileAccess(userId: number, storageKey: string): boolean {
  const cacheKey = `${userId}:${storageKey}`;
  const now = Date.now();
  const lastSeen = cache.get(cacheKey);

  if (lastSeen !== undefined && now - lastSeen < DEDUP_WINDOW_MS) {
    return false;
  }

  cache.set(cacheKey, now);

  // Lazy eviction: when the Map grows large, sweep and remove stale entries.
  // This keeps memory bounded without requiring a background timer.
  if (cache.size > MAX_CACHE_ENTRIES) {
    for (const [k, ts] of cache.entries()) {
      if (now - ts > DEDUP_WINDOW_MS) {
        cache.delete(k);
      }
    }
  }

  return true;
}

/** Exposed for testing — returns the current dedup window in ms. */
export function getDedupWindowMs(): number {
  return DEDUP_WINDOW_MS;
}

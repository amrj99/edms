/**
 * storage-access.ts — DEBT-010 F8 fix. Single source of truth for turning a stored
 * file URL into something the browser can safely open/download.
 *
 * INVARIANT (the whole point of this module):
 *   An INTERNAL storage URL (/api/storage/… or /objects/…) is NEVER handed to the
 *   browser for navigation without a valid short-lived view-token (`vt`). The private
 *   download routes are `requireAuthOrViewToken`; a bare navigation carries no
 *   Authorization header, so it would 401 ("No token provided"). If a view-token
 *   cannot be obtained, resolveAuthenticatedStorageUrl THROWS — it must never fall
 *   back to the raw internal URL. (This module weakens no server-side auth.)
 *
 * This module is UI-agnostic: it throws on failure and lets the UI layer decide how
 * to surface it (toast, etc.). It does not import any UI code.
 */
import { withViewToken } from "./view-url";

// All private storage serve-URL prefixes. MUST match the backend view-token
// allowlist (routes/storage.ts) — including r2-object, which the older preview
// hook omitted (a contributing cause of F8 for R2 files).
const INTERNAL_PREFIXES = [
  "/api/storage/onpremise/",
  "/api/storage/objects/",
  "/api/storage/s3-object/",
  "/api/storage/r2-object/",
  "/objects/", // legacy shape — normalized in DB, kept as a safety net
];

export function isInternalStorageUrl(url: string | null | undefined): url is string {
  return !!url && INTERNAL_PREFIXES.some((p) => url.startsWith(p));
}

function authToken(): string | null {
  try {
    return localStorage.getItem("edms_token");
  } catch {
    return null;
  }
}

/**
 * Resolve a browser-openable URL for a stored file.
 *   • external (http/https and not an internal serve path) → returned unchanged.
 *   • internal storage → a short-lived view-token is fetched and merged in as `vt`.
 *   • on ANY failure to obtain a token for an internal URL → THROWS.
 * It is impossible for this function to return an internal URL without a `vt`.
 */
export async function resolveAuthenticatedStorageUrl(fileUrl: string): Promise<string> {
  if (!fileUrl) throw new Error("No file URL provided");
  if (!isInternalStorageUrl(fileUrl)) return fileUrl; // external passthrough

  const tok = authToken();
  const res = await fetch(
    `/api/storage/view-token?url=${encodeURIComponent(fileUrl)}`,
    tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined,
  );
  if (!res.ok) throw new Error(`Could not authorize file access (${res.status})`);
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!data?.token) throw new Error("Could not authorize file access (no token)");
  return withViewToken(fileUrl, data.token);
}

/**
 * Open a stored file in a new tab, authenticated. Popup-safe: the blank tab is
 * opened synchronously inside the user gesture, then pointed at the resolved (vt)
 * URL once the token arrives. On failure the blank tab is closed (never left
 * dangling) and the error is re-thrown for the UI to surface. Never navigates to a
 * raw internal URL.
 */
export async function openStorageFile(fileUrl: string): Promise<void> {
  const w = window.open("about:blank", "_blank");
  if (w) {
    try {
      (w as unknown as { opener: unknown }).opener = null; // sever opener (noopener-equivalent)
    } catch {
      /* ignore */
    }
  }
  try {
    const url = await resolveAuthenticatedStorageUrl(fileUrl);
    if (w) {
      w.location.href = url;
    } else {
      // Pre-open was blocked; try a direct open (may also be blocked → throw).
      const w2 = window.open(url, "_blank", "noopener");
      if (!w2) throw new Error("Popup blocked — allow popups to open files.");
    }
  } catch (e) {
    if (w) w.close(); // don't leave a blank tab on failure
    throw e;
  }
}

/**
 * Download a stored file with its filename. Prefers an authenticated blob fetch of
 * the resolved (vt) URL. For cross-origin R2 presigned redirects the blob fetch can
 * be CORS-blocked; the ONLY fallback is a top-level navigation to the SAME resolved
 * (vt) URL — never the raw URL. Throws if the file cannot be authorized at all.
 */
export async function downloadStorageFile(fileUrl: string, filename: string): Promise<void> {
  const url = await resolveAuthenticatedStorageUrl(fileUrl); // throws → no raw fallback
  try {
    const tok = authToken();
    const res = await fetch(url, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename || "download";
    a.rel = "noopener";
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } catch {
    // Fallback: navigate to the authenticated (vt) URL — NEVER the raw URL.
    const w = window.open(url, "_blank", "noopener");
    if (!w) throw new Error("Could not download file — allow popups or try again.");
  }
}

/**
 * usePreviewUrl — resolves an authenticated URL for inline file preview.
 *
 * URL classification:
 *  1. Internal storage (/api/storage/*)  → fetch a short-lived view token, return URL?vt=<token>&ct=<mime>
 *  2. Browser-loadable external (http/https)  → return as-is
 *  3. Everything else (seed paths, s3://, /mnt/…, relative paths) → return "not-previewable" error
 *     so the UI can show a graceful fallback instead of loading a broken path.
 *
 * @param fileUrl   The raw storage URL to resolve.
 * @param mimeType  Optional MIME type hint (e.g. "application/pdf"). When provided, the server
 *                  uses it to set the correct Content-Type header instead of guessing from the
 *                  UUID-based filename. This is critical for inline PDF rendering in iframes.
 */
import { useState, useEffect, useRef } from "react";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string }
  | { status: "not-previewable"; message: string };

const INTERNAL_PREFIXES = [
  "/api/storage/onpremise/",
  "/api/storage/objects/",
  "/api/storage/s3-object/",
  "/objects/",   // legacy format — normalized in DB but kept here as safety net
];

function isInternalStorageUrl(url: string): boolean {
  return INTERNAL_PREFIXES.some(p => url.startsWith(p));
}

function isBrowserLoadableUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export function usePreviewUrl(
  fileUrl: string | null | undefined,
  mimeType?: string | null,
): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const abortRef = useRef<AbortController | null>(null);
  const callCount = useRef(0);

  useEffect(() => {
    const callId = ++callCount.current;
    console.log(`[usePreviewUrl #${callId}] fileUrl="${fileUrl}" mimeType="${mimeType}"`);

    if (!fileUrl) {
      console.warn(`[usePreviewUrl #${callId}] No fileUrl — setting error`);
      setState({ status: "error", message: "No file attached to this document." });
      return;
    }

    // Internal storage URL — needs a view token
    if (isInternalStorageUrl(fileUrl)) {
      setState({ status: "loading" });

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const authToken = localStorage.getItem("edms_token");
      console.log(`[usePreviewUrl #${callId}] auth token present=${!!authToken}`);

      if (!authToken) {
        console.error(`[usePreviewUrl #${callId}] No auth token in localStorage`);
        setState({ status: "error", message: "Not authenticated. Please refresh the page." });
        return;
      }

      const viewTokenUrl = `/api/storage/view-token?url=${encodeURIComponent(fileUrl)}`;
      console.log(`[usePreviewUrl #${callId}] Fetching view-token: ${viewTokenUrl}`);

      fetch(viewTokenUrl, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: ctrl.signal,
      })
        .then(r => {
          console.log(`[usePreviewUrl #${callId}] view-token response status=${r.status} ok=${r.ok}`);
          if (!r.ok) throw new Error(`Token request failed (${r.status})`);
          return r.json();
        })
        .then((data: { token: string }) => {
          if (ctrl.signal.aborted) {
            console.log(`[usePreviewUrl #${callId}] Aborted — ignoring token`);
            return;
          }
          console.log(`[usePreviewUrl #${callId}] VIEW TOKEN present=${!!data?.token} type=${typeof data?.token} length=${data?.token?.length ?? 0}`);

          if (!data?.token) {
            console.error(`[usePreviewUrl #${callId}] Token missing in response:`, data);
            setState({ status: "error", message: "Could not load preview. Try downloading the file." });
            return;
          }

          const ctPart = mimeType ? `&ct=${encodeURIComponent(mimeType)}` : "";
          const finalUrl = `${fileUrl}?vt=${data.token}${ctPart}`;
          console.log(`[usePreviewUrl #${callId}] FINAL PDF URL: ${finalUrl}`);
          setState({ status: "ready", url: finalUrl });
        })
        .catch(err => {
          if (err.name === "AbortError") {
            console.log(`[usePreviewUrl #${callId}] Fetch aborted`);
            return;
          }
          console.error(`[usePreviewUrl #${callId}] Fetch error:`, err);
          setState({ status: "error", message: "Could not load preview. Try downloading the file." });
        });

      return () => {
        console.log(`[usePreviewUrl #${callId}] Cleanup — aborting fetch`);
        ctrl.abort();
      };
    }

    // Browser-loadable external URL (http/https) — use directly
    if (isBrowserLoadableUrl(fileUrl)) {
      console.log(`[usePreviewUrl #${callId}] External URL — using directly`);
      setState({ status: "ready", url: fileUrl });
      return;
    }

    // Not previewable: seed paths, s3:// URIs, /mnt/ paths, or other non-HTTP references
    console.warn(`[usePreviewUrl #${callId}] Not previewable: "${fileUrl}"`);
    setState({
      status: "not-previewable",
      message: "This file is stored at a path that cannot be previewed in the browser.",
    });
  }, [fileUrl, mimeType]);

  return state;
}

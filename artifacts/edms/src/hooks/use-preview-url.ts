/**
 * usePreviewUrl — resolves an authenticated URL for inline file preview.
 *
 * For files served through our own /api/storage/* endpoints, the browser cannot
 * add an Authorization header when loading an <iframe> or <img> tag directly.
 * This hook exchanges the file URL for a short-lived view token (5 min) and
 * returns a URL with ?vt=<token> appended, which the storage endpoint accepts
 * without a Bearer header.
 *
 * For external URLs (S3 presigned URLs, etc.) the URL is returned as-is.
 */
import { useState, useEffect, useRef } from "react";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

const INTERNAL_PREFIXES = [
  "/api/storage/onpremise/",
  "/api/storage/objects/",
  "/api/storage/s3-object/",
];

function isInternalStorageUrl(url: string): boolean {
  return INTERNAL_PREFIXES.some(p => url.startsWith(p));
}

export function usePreviewUrl(fileUrl: string | null | undefined): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fileUrl) {
      setState({ status: "error", message: "No file attached to this document." });
      return;
    }

    // External URLs (S3 presigned, CDN, etc.) — use directly
    if (!isInternalStorageUrl(fileUrl)) {
      setState({ status: "ready", url: fileUrl });
      return;
    }

    // Internal storage URL — needs a view token
    setState({ status: "loading" });

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const token = localStorage.getItem("edms_token");
    if (!token) {
      setState({ status: "error", message: "Not authenticated. Please refresh the page." });
      return;
    }

    fetch(`/api/storage/view-token?url=${encodeURIComponent(fileUrl)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error(`Token request failed (${r.status})`);
        return r.json();
      })
      .then((data: { token: string }) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "ready", url: `${fileUrl}?vt=${data.token}` });
      })
      .catch(err => {
        if (err.name === "AbortError") return;
        setState({ status: "error", message: "Could not load preview. Try downloading the file." });
      });

    return () => ctrl.abort();
  }, [fileUrl]);

  return state;
}

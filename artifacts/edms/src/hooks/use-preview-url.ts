/**
 * usePreviewUrl — resolves an authenticated URL for inline file preview.
 *
 * URL classification:
 *  1. Internal storage (/api/storage/*)  → fetch a short-lived view token, return URL?vt=<token>
 *  2. Browser-loadable external (http/https)  → return as-is
 *  3. Everything else (seed paths, s3://, /mnt/…, relative paths) → return "not-previewable" error
 *     so the UI can show a graceful fallback instead of loading a broken path.
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

export function usePreviewUrl(fileUrl: string | null | undefined): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fileUrl) {
      setState({ status: "error", message: "No file attached to this document." });
      return;
    }

    // Internal storage URL — needs a view token
    if (isInternalStorageUrl(fileUrl)) {
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
    }

    // Browser-loadable external URL (http/https) — use directly
    if (isBrowserLoadableUrl(fileUrl)) {
      setState({ status: "ready", url: fileUrl });
      return;
    }

    // Not previewable: seed paths, s3:// URIs, /mnt/ paths, or other non-HTTP references
    // These are stored references that cannot be loaded by the browser directly.
    setState({
      status: "not-previewable",
      message: "This file is stored at a path that cannot be previewed in the browser.",
    });
  }, [fileUrl]);

  return state;
}

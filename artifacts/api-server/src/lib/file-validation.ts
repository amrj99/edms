/**
 * file-validation.ts
 *
 * Content-based upload safety checks.
 * Uses magic-byte sniffing on the in-memory buffer (multer memoryStorage) to
 * detect dangerous file types regardless of the extension or declared MIME type.
 *
 * Security model: BLOCKLIST only.
 * We block a small set of types that can execute code in a browser (HTML, SVG,
 * JavaScript). Everything else — PDF, DWG, IFC, STEP, DOCX, XLSX, ZIP, images,
 * video, CAD formats, etc. — is allowed. This avoids breaking legitimate
 * engineering file formats whose MIME types are non-standard or vary by OS.
 *
 * File size limit: controlled by MAX_UPLOAD_SIZE_MB environment variable.
 * Default: 1024 MB (1 GB) — suitable for large CAD/IFC/BIM files.
 * Set a lower value (e.g. MAX_UPLOAD_SIZE_MB=200) for memory-constrained hosts.
 *
 * NOTE — reverse proxy / Nginx:
 *   If this server runs behind Nginx, the Nginx directive
 *     client_max_body_size <VALUE>g;
 *   must be set to at least MAX_UPLOAD_SIZE_MB / 1024 GB, otherwise Nginx will
 *   reject large requests with 413 before they reach Node. Update your Nginx
 *   config or Docker environment to match any change to MAX_UPLOAD_SIZE_MB.
 */

import type { Request } from "express";
import type { FileFilterCallback } from "multer";

// ─── Size limit (env-configurable) ────────────────────────────────────────────
// Read at module load time so it reflects the environment at server start.
// Accepts fractional values (e.g. "0.5" → 512 KB — useful for tests).
const _maxMb = parseFloat(process.env.MAX_UPLOAD_SIZE_MB ?? "1024");
const _resolvedMb = Number.isFinite(_maxMb) && _maxMb > 0 ? _maxMb : 1024;
export const MAX_UPLOAD_BYTES = Math.floor(_resolvedMb * 1024 * 1024);
export const MAX_UPLOAD_MB = _resolvedMb;

// ─── Blocked MIME types (declared Content-Type from client) ───────────────────
// These types can execute script in a browser and are rejected immediately.
// Everything NOT on this list is permitted; the content-based checks below
// provide the second safety layer for any spoofed or unlabelled submissions.
const BLOCKED_MIME_TYPES = new Set([
  // HTML / XHTML
  "text/html",
  "application/xhtml+xml",
  // SVG — can embed <script>
  "image/svg+xml",
  // JavaScript
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

// ─── Multer fileFilter ─────────────────────────────────────────────────────────
// Rejects only explicitly dangerous declared MIME types.
// All other MIME types (including application/octet-stream, model/ifc, and the
// many non-standard types used by CAD applications) are passed through for
// content-level inspection.
export function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void {
  const mime = (file.mimetype ?? "").toLowerCase().split(";")[0].trim();

  if (BLOCKED_MIME_TYPES.has(mime)) {
    cb(new Error(`File type not allowed: ${mime}`));
    return;
  }

  cb(null, true);
}

// ─── Content-based checks (applied after buffer is available) ─────────────────

/**
 * Returns a rejection reason string if the buffer looks like HTML, SVG, or
 * JavaScript, or null if the file appears safe.
 *
 * Checks the first 512 bytes only — enough to catch all real-world cases
 * without significant overhead, even for 1 GB files.
 */
export function detectDangerousContent(buf: Buffer, filename: string): string | null {
  if (!buf || buf.length === 0) return null;

  // toString with explicit bounds — safe even when buf.length < 512
  const sample = buf.slice(0, 512).toString("utf8", 0, Math.min(buf.length, 512)).toLowerCase();

  // ── HTML detection ────────────────────────────────────────────────────────
  // Covers DOCTYPE declarations, raw <html> tags, and injected <script> blocks
  // even when an attacker renames an HTML file or spoofs the MIME type.
  if (
    sample.includes("<!doctype html") ||
    sample.includes("<html") ||
    sample.includes("<head>") ||
    sample.includes("<head ") ||
    sample.includes("<script")
  ) {
    return `File "${filename}" appears to be HTML and cannot be uploaded.`;
  }

  // ── SVG detection ─────────────────────────────────────────────────────────
  // SVG can embed <script> tags and executes in browser context.
  if (sample.includes("<svg") || (sample.includes("<?xml") && sample.includes("svg"))) {
    return `File "${filename}" appears to be an SVG and cannot be uploaded. Convert to PNG or PDF first.`;
  }

  // ── JavaScript detection ─────────────────────────────────────────────────
  // Catches .js files disguised as other types. Checks for common JS signatures
  // that would not appear at the start of binary engineering files.
  if (
    sample.startsWith("#!/usr/bin/env node") ||
    sample.startsWith("'use strict'") ||
    sample.startsWith('"use strict"') ||
    sample.startsWith("(function(") ||
    sample.startsWith("define(") ||
    sample.startsWith("module.exports")
  ) {
    return `File "${filename}" appears to be a JavaScript file and cannot be uploaded.`;
  }

  return null;
}

/**
 * Validate an array of in-memory multer files.
 * Returns the first rejection reason found, or null if all files pass.
 */
export function validateUploadedFiles(files: Express.Multer.File[]): string | null {
  for (const file of files) {
    const reason = detectDangerousContent(file.buffer, file.originalname);
    if (reason) return reason;
  }
  return null;
}

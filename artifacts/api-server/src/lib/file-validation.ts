/**
 * file-validation.ts
 *
 * Content-based upload safety checks.
 * Uses magic-byte sniffing on the in-memory buffer (multer memoryStorage) to
 * detect dangerous file types regardless of the extension or declared MIME type.
 *
 * Blocked types: HTML, SVG (both execute script in browser context).
 * Allowed types: whitelist of engineering-relevant formats.
 *
 * File size limit (50 MB) is applied here as the single source of truth and
 * imported by every multer instance to stay in sync.
 */

import type { Request } from "express";
import type { FileFilterCallback } from "multer";

// ─── Size limit ────────────────────────────────────────────────────────────────
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// ─── MIME whitelist (declared Content-Type from client) ────────────────────────
// First-pass filter applied by multer's fileFilter before the buffer is available.
// Content-level checks below catch spoofed types.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream", // generic binary — validated further by content check
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/vnd.dwg",
  "image/vnd.dxf",
  "image/x-dwg",
  "text/plain",
  "text/csv",
  "video/mp4",
  "audio/mpeg",
]);

// Declared MIME types that are always blocked regardless of content.
const BLOCKED_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "application/javascript",
  "text/javascript",
]);

// ─── Multer fileFilter ─────────────────────────────────────────────────────────
// Rejects files whose declared MIME type is on the blocklist or not on the
// whitelist. This is a convenience layer — content checks below catch spoofing.
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

  if (!ALLOWED_MIME_TYPES.has(mime)) {
    cb(new Error(`Unsupported file type: ${mime}. Please upload PDF, Office documents, images, DWG, DXF, CSV, or ZIP files.`));
    return;
  }

  cb(null, true);
}

// ─── Content-based checks (applied after buffer is available) ─────────────────

/**
 * Returns a rejection reason string if the buffer looks like HTML or SVG,
 * or null if the file is safe.
 *
 * Checks the first 512 bytes only — enough to catch all real-world cases
 * without significant overhead.
 */
export function detectDangerousContent(buf: Buffer, filename: string): string | null {
  if (!buf || buf.length === 0) return null;

  const sample = buf.slice(0, 512).toString("utf8", 0, Math.min(buf.length, 512)).toLowerCase();

  // Detect HTML — covers DOCTYPE declarations, raw <html>, and <script> injection
  // even if someone renames an HTML file to .pdf or supplies a spoofed MIME type.
  if (
    sample.includes("<!doctype html") ||
    sample.includes("<html") ||
    sample.includes("<head>") ||
    sample.includes("<script")
  ) {
    return `File "${filename}" appears to be HTML and cannot be uploaded.`;
  }

  // Detect SVG — SVG files can embed <script> and execute JS in the browser.
  if (sample.includes("<svg") || (sample.includes("<?xml") && sample.includes("svg"))) {
    return `File "${filename}" appears to be an SVG and cannot be uploaded. Convert to PNG or PDF first.`;
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

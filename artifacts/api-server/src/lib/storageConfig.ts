/**
 * Centralized storage configuration with startup validation and safe fallbacks.
 *
 * Priority (highest to lowest):
 *  1. Org-level config from DB  (set in Settings → Storage)
 *  2. DEFAULT_STORAGE_TYPE + DEFAULT_STORAGE_PATH env vars
 *  3. Auto-detect: if PRIVATE_OBJECT_DIR is set → Replit/cloud is available
 *  4. Final fallback: on-premise storage at FALLBACK_ONPREM_PATH (/app/storage)
 *
 * The system will NEVER crash due to a missing storage environment variable.
 * When a fallback is used a clear log message is emitted.
 */
import fs from "fs";
import path from "path";

/** Default on-premise path when nothing else is configured. */
export const FALLBACK_ONPREM_PATH = "/app/storage";

/**
 * Returns the effective on-premise base path.
 * Resolution order:
 *   org DB config → DEFAULT_STORAGE_PATH env → /app/storage
 *
 * The directory is created automatically if it does not exist.
 */
export function getEffectiveOnPremPath(orgConfigPath?: string | null): string {
  const envPath = process.env.DEFAULT_STORAGE_PATH || null;

  if (orgConfigPath) return ensureDir(orgConfigPath);
  if (envPath)       return ensureDir(envPath);

  console.warn(
    `[storage] Neither org storagePath nor DEFAULT_STORAGE_PATH is set. ` +
    `Using fallback: ${FALLBACK_ONPREM_PATH}`,
  );
  return ensureDir(FALLBACK_ONPREM_PATH);
}

/**
 * Returns true when Replit/GCS cloud object storage is available.
 * Cloud storage requires PRIVATE_OBJECT_DIR (injected by Replit sidecar).
 * On a self-hosted VPS this variable is never present.
 */
export function isCloudStorageAvailable(): boolean {
  return !!process.env.PRIVATE_OBJECT_DIR;
}

/**
 * Ensures a directory exists with safe permissions (0o750).
 * Logs a one-time message when the directory is created.
 * Returns the path unchanged so callers can chain: `return ensureDir(p)`.
 */
export function ensureDir(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  try {
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true, mode: 0o750 });
      console.info(`[storage] Created storage directory: ${resolved}`);
    }
  } catch (err: any) {
    console.error(
      `[storage] WARNING: Could not create storage directory ${resolved}: ${err.message}. ` +
      `File operations may fail if the directory does not exist.`,
    );
  }
  return dirPath;
}

/**
 * Called once at server startup.
 * Logs the resolved storage configuration so operators can confirm the setup at a glance.
 * Never throws — if something is wrong it warns instead.
 */
export function validateStorageAtStartup(): void {
  const envType     = (process.env.DEFAULT_STORAGE_TYPE ?? "").toLowerCase();
  const envPath     = process.env.DEFAULT_STORAGE_PATH   || null;
  const cloudOk     = isCloudStorageAvailable();

  console.info("[storage] ─────────────────────────────────────────────────");
  console.info("[storage]  Storage Configuration (server defaults)");
  console.info("[storage] ─────────────────────────────────────────────────");

  if (envType === "onpremise" || envType === "s3") {
    console.info(`[storage]  DEFAULT_STORAGE_TYPE  = ${envType}`);
    if (envPath) {
      console.info(`[storage]  DEFAULT_STORAGE_PATH  = ${envPath}`);
      ensureDir(envPath);
    } else if (envType === "onpremise") {
      console.warn(
        `[storage]  DEFAULT_STORAGE_PATH is not set. ` +
        `Files will be written to fallback: ${FALLBACK_ONPREM_PATH}`,
      );
      ensureDir(FALLBACK_ONPREM_PATH);
    }
  } else if (envType === "cloud") {
    if (!cloudOk) {
      console.warn(
        `[storage]  DEFAULT_STORAGE_TYPE=cloud but PRIVATE_OBJECT_DIR is not set ` +
        `(not a Replit environment?). Uploads will fall back to on-premise storage ` +
        `at ${envPath ?? FALLBACK_ONPREM_PATH}.`,
      );
      ensureDir(envPath ?? FALLBACK_ONPREM_PATH);
    } else {
      console.info(`[storage]  DEFAULT_STORAGE_TYPE  = cloud (Replit/GCS)`);
      console.info(`[storage]  PRIVATE_OBJECT_DIR    = ${process.env.PRIVATE_OBJECT_DIR}`);
    }
  } else {
    // Not set — auto-detect
    if (cloudOk) {
      console.info("[storage]  Mode auto-detected    = cloud (PRIVATE_OBJECT_DIR present)");
    } else {
      console.warn(
        `[storage]  DEFAULT_STORAGE_TYPE is not set and PRIVATE_OBJECT_DIR is absent. ` +
        `Defaulting to on-premise storage at ${envPath ?? FALLBACK_ONPREM_PATH}.`,
      );
      ensureDir(envPath ?? FALLBACK_ONPREM_PATH);
    }
  }

  console.info(`[storage]  Cloud available        = ${cloudOk}`);
  console.info("[storage] ─────────────────────────────────────────────────");

  // R2 status
  const r2Configured = !!(process.env.R2_ENDPOINT && process.env.R2_BUCKET && process.env.R2_ACCESS_KEY && process.env.R2_SECRET_KEY);
  if (r2Configured) {
    console.info("[storage]  Cloudflare R2            = ✓ configured (global default)");
    console.info(`[storage]  R2_ENDPOINT              = ${(process.env.R2_ENDPOINT ?? "").substring(0, 60)}`);
    console.info(`[storage]  R2_BUCKET                = ${process.env.R2_BUCKET}`);
  } else {
    console.info("[storage]  Cloudflare R2            = (not configured — set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY)");
  }
  console.info("[storage] ─────────────────────────────────────────────────");

  // Required env reference (for operators)
  const required = [
    { key: "DEFAULT_STORAGE_TYPE", val: process.env.DEFAULT_STORAGE_TYPE, note: "onpremise | cloud | s3 | (r2 auto if R2_* vars set)" },
    { key: "DEFAULT_STORAGE_PATH", val: process.env.DEFAULT_STORAGE_PATH, note: "abs path for on-premise mode" },
    { key: "R2_ENDPOINT",          val: process.env.R2_ENDPOINT           ? "✓ set" : "(not set)", note: "Cloudflare R2" },
    { key: "R2_BUCKET",            val: process.env.R2_BUCKET             ? "✓ set" : "(not set)", note: "Cloudflare R2" },
    { key: "R2_ACCESS_KEY",        val: process.env.R2_ACCESS_KEY         ? "✓ set" : "(not set)", note: "Cloudflare R2" },
    { key: "R2_SECRET_KEY",        val: process.env.R2_SECRET_KEY         ? "✓ set" : "(not set)", note: "Cloudflare R2" },
    { key: "JWT_SECRET",           val: process.env.JWT_SECRET            ? "✓ set" : "✗ MISSING", note: "required" },
    { key: "REFRESH_TOKEN_SECRET", val: process.env.REFRESH_TOKEN_SECRET  ? "✓ set" : "✗ MISSING", note: "required" },
    { key: "DATABASE_URL",         val: process.env.DATABASE_URL          ? "✓ set" : "✗ MISSING", note: "required" },
    { key: "PRIVATE_OBJECT_DIR",   val: process.env.PRIVATE_OBJECT_DIR   ?? "(not set — cloud storage disabled)", note: "Replit only" },
    { key: "RESEND_API_KEY",       val: process.env.RESEND_API_KEY        ? "✓ set" : "(not set — emails disabled)", note: "optional" },
  ];

  console.info("[storage]  Environment variable reference:");
  required.forEach(({ key, val, note }) =>
    console.info(`[storage]    ${key.padEnd(26)} = ${(val ?? "(not set)").substring(0, 60)}  [${note}]`),
  );
  console.info("[storage] ─────────────────────────────────────────────────");
}

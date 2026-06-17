/**
 * OrgStorageService
 * Routes file storage to R2 (global env-based), cloud (Replit/GCS), S3-compatible, or on-premise
 * (local filesystem) based on the organisation's configured storageType.
 *
 * Priority (highest → lowest):
 *  1. Per-org DB config (storageType = "s3" with explicit bucket/keys)
 *  2. R2 global env vars (R2_ENDPOINT + R2_BUCKET + R2_ACCESS_KEY + R2_SECRET_KEY)
 *  3. DEFAULT_STORAGE_TYPE env var
 *  4. Auto-detect: Replit/GCS if PRIVATE_OBJECT_DIR present, else on-premise
 */
import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { decrypt } from "./encryption.js";
import { getEffectiveOnPremPath, isCloudStorageAvailable, ensureDir } from "./storageConfig.js";
import { StorageNotConfiguredError } from "./errors.js";

const cloudStorage = new ObjectStorageService();

/** Returns the org config for a given org, or null if not found. */
async function getOrgConfig(organizationId: number) {
  const [cfg] = await db
    .select()
    .from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, organizationId));
  return cfg ?? null;
}

/** Build on-prem path: {storagePath}/{orgId}/{projectId}/{type}/{filename} */
function buildOnPremPath(
  basePath: string,
  orgId: number,
  projectId: number | null,
  fileType: string,
  filename: string,
): string {
  const segments = [basePath, String(orgId)];
  if (projectId) segments.push(String(projectId));
  segments.push(fileType, filename);
  return path.join(...segments);
}

export type StorageMode = "cloud" | "onpremise" | "s3" | "r2";

/**
 * Resolve the effective on-premise/cloud storage mode for an org.
 *
 * A DB-stored storageType of "s3" without an s3Bucket is not a usable
 * configuration (handled separately by the per-org S3 branch above, which
 * requires both fields) — treat it as unset so DEFAULT_STORAGE_TYPE / the
 * auto-detected default can take over, instead of silently falling through
 * to the cloud (Replit) branch.
 */
function resolveStorageType(
  cfg: { storageType?: string | null; s3Bucket?: string | null } | null,
  envStorageType: StorageMode | undefined,
): StorageMode {
  const dbStorageType = cfg?.storageType as StorageMode | undefined;
  const usableDbStorageType = dbStorageType === "s3" && !cfg?.s3Bucket ? undefined : dbStorageType;
  const autoDefault: StorageMode = isCloudStorageAvailable() ? "cloud" : "onpremise";
  return usableDbStorageType ?? envStorageType ?? autoDefault;
}

export interface UploadResult {
  mode: StorageMode;
  /** Presigned PUT URL for cloud/S3/R2 modes */
  uploadURL?: string;
  /** Logical storage path / object key */
  objectPath?: string;
  /** For on-prem: absolute filesystem path where binary should be POST-ed */
  filePath?: string;
  /** Relative URL to retrieve the file via the API */
  serveUrl?: string;
}

// ─── R2 helpers ───────────────────────────────────────────────────────────────

/** Returns true when all four R2 environment variables are present. */
export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY
  );
}

/** Build an S3Client pointed at Cloudflare R2 using environment variables. */
async function buildR2Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY!,
      secretAccessKey: process.env.R2_SECRET_KEY!,
    },
    forcePathStyle: false,
  });
}

/**
 * Generate a presigned GET URL for an R2 object.
 * @param objectKey  The key stored in R2 (e.g. org_1/projects/2/file.pdf)
 * @param expiresIn  Seconds until the URL expires (default 3600)
 */
export async function getR2PresignedGetUrl(
  objectKey: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const s3 = await buildR2Client();
    const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: objectKey });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err: any) {
    console.error("[storage] R2 presigned GET URL failed:", err.message);
    return null;
  }
}

/**
 * Build the canonical R2 object key for a document upload.
 * Format: org_{orgId}/projects/{projectId}/{safeFilename}
 */
function buildR2Key(orgId: number, projectId: number | null, filename: string): string {
  const safeFile = `${Date.now()}_${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  if (projectId) {
    return `org_${orgId}/projects/${projectId}/${safeFile}`;
  }
  return `org_${orgId}/projects/0/${safeFile}`;
}

/** Build the API serve URL for an R2 object. */
function r2ServeUrl(orgId: number, objectKey: string): string {
  return `/api/storage/r2-object/${encodeURIComponent(objectKey)}?orgId=${orgId}`;
}

// ─── Per-org S3 helpers (existing behaviour) ──────────────────────────────────

/** Build an S3Client lazily from per-org DB config credentials. */
async function buildS3Client(cfg: {
  s3Region?: string | null;
  s3Endpoint?: string | null;
  s3AccessKey?: string | null;
  s3SecretKey?: string | null;
}) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const accessKeyId = cfg.s3AccessKey ? decrypt(cfg.s3AccessKey) : undefined;
  const secretAccessKey = cfg.s3SecretKey ? decrypt(cfg.s3SecretKey) : undefined;
  return new S3Client({
    region: cfg.s3Region || "us-east-1",
    ...(cfg.s3Endpoint ? { endpoint: cfg.s3Endpoint } : {}),
    ...(accessKeyId && secretAccessKey
      ? {
          credentials: { accessKeyId, secretAccessKey },
          forcePathStyle: !!cfg.s3Endpoint,
        }
      : {}),
  });
}

// ─── requestUpload ─────────────────────────────────────────────────────────────

/**
 * Request an upload slot for a file.
 * Priority: per-org DB config → R2 env vars → DEFAULT_STORAGE_TYPE → auto-detect
 */
export async function requestUpload(params: {
  organizationId: number;
  projectId?: number | null;
  fileType?: string;
  name: string;
  size?: number;
  contentType?: string;
}): Promise<UploadResult> {
  const { organizationId, projectId, fileType = "general", name, contentType } = params;
  const cfg = await getOrgConfig(organizationId);

  const envStorageType = process.env.DEFAULT_STORAGE_TYPE as StorageMode | undefined;
  const envStoragePath = process.env.DEFAULT_STORAGE_PATH || null;

  // ── 1. Per-org explicit S3 config (highest priority) ──────────────────────
  if (cfg?.storageType === "s3" && cfg?.s3Bucket) {
    try {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

      const s3 = await buildS3Client(cfg);
      const safeFile = `${Date.now()}_${path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const objectKey = `${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`;

      const putCommand = new PutObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: objectKey,
        ContentType: contentType,
      });

      const uploadURL = await getSignedUrl(s3, putCommand, { expiresIn: 3600 });
      return {
        mode: "s3",
        uploadURL,
        objectPath: objectKey,
        serveUrl: `/api/storage/s3-object/${encodeURIComponent(objectKey)}?orgId=${organizationId}`,
      };
    } catch (err: any) {
      console.error("[storage] Per-org S3 presigned URL generation failed:", err.message);
    }
  }

  // ── 2. Global R2 via env vars ──────────────────────────────────────────────
  if (isR2Configured() && cfg?.storageType !== "onpremise") {
    try {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

      const r2 = await buildR2Client();
      const objectKey = buildR2Key(organizationId, projectId ?? null, name);

      const putCommand = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: objectKey,
        ContentType: contentType,
      });

      const uploadURL = await getSignedUrl(r2, putCommand, { expiresIn: 3600 });
      return {
        mode: "r2",
        uploadURL,
        objectPath: objectKey,
        serveUrl: r2ServeUrl(organizationId, objectKey),
      };
    } catch (err: any) {
      console.error("[storage] R2 presigned PUT URL generation failed:", err.message);
    }
  }

  // ── 3. On-Premise (explicit or env default) ────────────────────────────────
  const storageType = resolveStorageType(cfg, envStorageType);

  if (storageType === "onpremise") {
    const basePath = getEffectiveOnPremPath(cfg?.storagePath || envStoragePath);
    const safeFile = `${Date.now()}_${path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const absPath = buildOnPremPath(basePath, organizationId, projectId ?? null, fileType, safeFile);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    return {
      mode: "onpremise",
      uploadURL: `/api/storage/uploads/onpremise/${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`,
      filePath: absPath,
      objectPath: absPath,
      serveUrl: `/api/storage/onpremise/${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`,
    };
  }

  // ── 4. Cloud (Replit / GCS) — only if actually configured ──────────────────
  if (isCloudStorageAvailable()) {
    const uploadURL = await cloudStorage.getObjectEntityUploadURL();
    const objectPath = cloudStorage.normalizeObjectEntityPath(uploadURL);
    return {
      mode: "cloud",
      uploadURL,
      objectPath,
      serveUrl: `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`,
    };
  }

  throw new StorageNotConfiguredError(
    `No valid storage provider configured for organization ${organizationId}: ` +
    `storageType="${storageType}", s3Bucket="${cfg?.s3Bucket ?? "(none)"}", ` +
    `DEFAULT_STORAGE_TYPE="${envStorageType ?? "(unset)"}", PRIVATE_OBJECT_DIR not set.`,
    { organizationId, storageType, hasS3Bucket: !!cfg?.s3Bucket, envStorageType: envStorageType ?? null },
  );
}

// ─── getS3PresignedGetUrl ─────────────────────────────────────────────────────

/**
 * Generate a presigned GET URL for a per-org S3 object.
 */
export async function getS3PresignedGetUrl(
  organizationId: number,
  objectKey: string,
  expiresIn = 3600,
): Promise<string | null> {
  const cfg = await getOrgConfig(organizationId);
  if (!cfg?.s3Bucket) return null;

  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const s3 = await buildS3Client(cfg);

    const command = new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: objectKey });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err: any) {
    console.error("[storage] Per-org S3 presigned GET URL failed:", err.message);
    return null;
  }
}

/** Stream a file from on-prem storage to the HTTP response. */
export function streamOnPremFile(filePath: string): fs.ReadStream | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.createReadStream(filePath);
}

export interface UploadBufferResult {
  mode: StorageMode;
  serveUrl: string;
  objectPath: string;
}

/**
 * Upload a file buffer directly from the server (no signed URL round-trip).
 * Priority: per-org DB config → R2 env vars → DEFAULT_STORAGE_TYPE → auto-detect
 */
export async function uploadBuffer(params: {
  organizationId: number | null;
  projectId?: number | null;
  fileType?: string;
  name: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<UploadBufferResult> {
  const { organizationId, projectId, fileType = "general", name, buffer, contentType } = params;

  const safeFile = `${Date.now()}_${path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  if (!organizationId) {
    // System-level — cloud storage only (no org context for R2 key)
    return uploadToCloud(buffer, safeFile, contentType);
  }

  const cfg = await getOrgConfig(organizationId);
  const envStorageType = process.env.DEFAULT_STORAGE_TYPE as StorageMode | undefined;
  const envStoragePath = process.env.DEFAULT_STORAGE_PATH || null;

  // ── 1. Per-org explicit S3 config ─────────────────────────────────────────
  if (cfg?.storageType === "s3" && cfg?.s3Bucket) {
    try {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = await buildS3Client(cfg);
      const objectKey = `${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`;
      await s3.send(new PutObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
      }));
      return {
        mode: "s3",
        objectPath: objectKey,
        serveUrl: `/api/storage/s3-object/${encodeURIComponent(objectKey)}?orgId=${organizationId}`,
      };
    } catch (err: any) {
      console.error("[storage] Per-org S3 upload failed:", err.message);
    }
  }

  // ── 2. Global R2 via env vars ──────────────────────────────────────────────
  if (isR2Configured() && cfg?.storageType !== "onpremise") {
    try {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await buildR2Client();
      const objectKey = buildR2Key(organizationId, projectId ?? null, name);
      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
      }));
      return {
        mode: "r2",
        objectPath: objectKey,
        serveUrl: r2ServeUrl(organizationId, objectKey),
      };
    } catch (err: any) {
      console.error("[storage] R2 upload failed:", err.message);
    }
  }

  // ── 3. On-Premise ──────────────────────────────────────────────────────────
  const storageType = resolveStorageType(cfg, envStorageType);

  if (storageType === "onpremise") {
    const basePath = getEffectiveOnPremPath(cfg?.storagePath || envStoragePath);
    const absPath = buildOnPremPath(basePath, organizationId, projectId ?? null, fileType, safeFile);
    fs.mkdirSync(path.dirname(absPath), { recursive: true, mode: 0o750 });
    fs.writeFileSync(absPath, buffer);
    return {
      mode: "onpremise",
      objectPath: absPath,
      serveUrl: `/api/storage/onpremise/${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`,
    };
  }

  // ── 4. Cloud (Replit / GCS) ────────────────────────────────────────────────
  return uploadToCloud(buffer, safeFile, contentType);
}

async function uploadToCloud(buffer: Buffer, safeFile: string, contentType?: string): Promise<UploadBufferResult> {
  if (!isCloudStorageAvailable()) {
    const basePath = getEffectiveOnPremPath(null);
    const uploadsDir = path.join(basePath, "uploads");
    ensureDir(uploadsDir);
    const absPath = path.join(uploadsDir, safeFile);
    fs.writeFileSync(absPath, buffer);
    console.info(
      `[storage] uploadToCloud: PRIVATE_OBJECT_DIR not set — ` +
      `wrote file to on-premise fallback: ${absPath}`,
    );
    return {
      mode: "onpremise",
      objectPath: absPath,
      serveUrl: `/api/storage/onpremise/0/0/uploads/${safeFile}`,
    };
  }

  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR!;
  const fullPath = `${privateObjectDir}/uploads/${safeFile}`;
  const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");

  const { objectStorageClient } = await import("./objectStorage.js");
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, { contentType: contentType ?? "application/octet-stream", resumable: false });

  const objectPath = `/objects/${safeFile}`;
  return {
    mode: "cloud",
    objectPath,
    serveUrl: `/api/storage/objects/uploads/${safeFile}`,
  };
}

/**
 * OrgStorageService
 * Routes file storage to cloud (Replit/GCS), S3-compatible, or on-premise
 * (local filesystem) based on the organisation's configured storageType.
 */
import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { decrypt } from "./encryption.js";
import { getEffectiveOnPremPath, isCloudStorageAvailable, ensureDir } from "./storageConfig.js";

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

export type StorageMode = "cloud" | "onpremise" | "s3";

export interface UploadResult {
  mode: StorageMode;
  /** Presigned PUT URL for cloud/S3 modes */
  uploadURL?: string;
  /** Logical storage path / object key */
  objectPath?: string;
  /** For on-prem: absolute filesystem path where binary should be POST-ed */
  filePath?: string;
  /** Relative URL to retrieve the file via the API */
  serveUrl?: string;
}

/** Build an S3Client lazily (avoids startup crash if AWS SDK not installed). */
async function buildS3Client(cfg: {
  s3Region?: string | null;
  s3Endpoint?: string | null;
  s3AccessKey?: string | null;
  s3SecretKey?: string | null;
}) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  // Decrypt credentials — values stored as plaintext before ENCRYPTION_KEY was set
  // are returned as-is by decrypt(), so this is fully backward compatible.
  const accessKeyId = cfg.s3AccessKey ? decrypt(cfg.s3AccessKey) : undefined;
  const secretAccessKey = cfg.s3SecretKey ? decrypt(cfg.s3SecretKey) : undefined;
  return new S3Client({
    region: cfg.s3Region || "us-east-1",
    ...(cfg.s3Endpoint ? { endpoint: cfg.s3Endpoint } : {}),
    ...(accessKeyId && secretAccessKey
      ? {
          credentials: { accessKeyId, secretAccessKey },
          forcePathStyle: !!cfg.s3Endpoint, // MinIO / custom endpoint requires path-style
        }
      : {}),
  });
}

/**
 * Request an upload slot for a file.
 * – cloud:     Replit/GCS presigned PUT URL
 * – s3:        AWS S3 / MinIO presigned PUT URL
 * – onpremise: local filesystem path + serve URL
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

  // env-var defaults (set in docker-compose for self-hosted VPS deployments)
  const envStorageType = process.env.DEFAULT_STORAGE_TYPE as StorageMode | undefined;
  const envStoragePath = process.env.DEFAULT_STORAGE_PATH || null;

  // Smart default: if Replit cloud storage is not available (VPS without PRIVATE_OBJECT_DIR),
  // automatically use on-premise mode instead of crashing.
  const autoDefault: StorageMode = isCloudStorageAvailable() ? "cloud" : "onpremise";
  const storageType: StorageMode = (cfg?.storageType as StorageMode) ?? envStorageType ?? autoDefault;

  // ── On-Premise ─────────────────────────────────────────────────────────────
  if (storageType === "onpremise") {
    const basePath = getEffectiveOnPremPath(cfg?.storagePath || envStoragePath);
    const safeFile = `${Date.now()}_${path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const absPath = buildOnPremPath(
      basePath,
      organizationId,
      projectId ?? null,
      fileType,
      safeFile,
    );
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    // The client cannot PUT directly to a filesystem path.
    // We expose an API endpoint that receives the binary body and writes it to disk.
    return {
      mode: "onpremise",
      uploadURL: `/api/storage/uploads/onpremise/${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`,
      filePath: absPath,
      objectPath: absPath,
      serveUrl: `/api/storage/onpremise/${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`,
    };
  }

  // ── Amazon S3 / S3-Compatible (MinIO, DigitalOcean Spaces, Backblaze …) ────
  if (storageType === "s3" && cfg?.s3Bucket) {
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
        // The serve URL proxies through our API which generates a presigned GET URL
        serveUrl: `/api/storage/s3-object/${encodeURIComponent(objectKey)}?orgId=${organizationId}`,
      };
    } catch (err: any) {
      console.error("[storage] S3 presigned URL generation failed:", err.message);
      // fall through to cloud storage
    }
  }

  // ── Cloud (Replit / GCS) ───────────────────────────────────────────────────
  const uploadURL = await cloudStorage.getObjectEntityUploadURL();
  const objectPath = cloudStorage.normalizeObjectEntityPath(uploadURL);
  return {
    mode: "cloud",
    uploadURL,
    objectPath,
    serveUrl: `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`,
  };
}

/**
 * Generate a presigned GET URL for an S3 object (used by the s3-object serve route).
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
    console.error("[storage] S3 presigned GET URL failed:", err.message);
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
 * Supports cloud (GCS), S3-compatible, and on-premise storage.
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
    // System-level — cloud storage only
    return uploadToCloud(buffer, safeFile, contentType);
  }

  const cfg = await getOrgConfig(organizationId);

  // env-var defaults (set in docker-compose for self-hosted VPS deployments)
  const envStorageType = process.env.DEFAULT_STORAGE_TYPE as StorageMode | undefined;
  const envStoragePath = process.env.DEFAULT_STORAGE_PATH || null;

  // Smart default: if Replit cloud storage is not available (VPS without PRIVATE_OBJECT_DIR),
  // automatically use on-premise mode instead of crashing.
  const autoDefault: StorageMode = isCloudStorageAvailable() ? "cloud" : "onpremise";
  const storageType: StorageMode = (cfg?.storageType as StorageMode) ?? envStorageType ?? autoDefault;

  // ── On-Premise ─────────────────────────────────────────────────────────────
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

  // ── Amazon S3 / S3-Compatible ───────────────────────────────────────────────
  if (storageType === "s3" && cfg?.s3Bucket) {
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
      console.error("[storage] S3 upload failed:", err.message);
      // fall through to cloud
    }
  }

  // ── Cloud (Replit / GCS) ───────────────────────────────────────────────────
  return uploadToCloud(buffer, safeFile, contentType);
}

async function uploadToCloud(buffer: Buffer, safeFile: string, contentType?: string): Promise<UploadBufferResult> {
  // If Replit/GCS cloud storage is not available (no PRIVATE_OBJECT_DIR),
  // fall back to on-premise filesystem storage instead of crashing.
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
      // The /onpremise route uses orgId/projectId/fileType/filename segments.
      // For system-level uploads (no org), we use org=0/project=0/type=uploads.
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

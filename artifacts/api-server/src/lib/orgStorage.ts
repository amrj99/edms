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
  return new S3Client({
    region: cfg.s3Region || "us-east-1",
    ...(cfg.s3Endpoint ? { endpoint: cfg.s3Endpoint } : {}),
    ...(cfg.s3AccessKey && cfg.s3SecretKey
      ? {
          credentials: {
            accessKeyId: cfg.s3AccessKey,
            secretAccessKey: cfg.s3SecretKey,
          },
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
  const storageType: StorageMode = (cfg?.storageType as StorageMode) ?? "cloud";

  // ── On-Premise ─────────────────────────────────────────────────────────────
  if (storageType === "onpremise" && cfg?.storagePath) {
    const safeFile = `${Date.now()}_${path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const absPath = buildOnPremPath(
      cfg.storagePath,
      organizationId,
      projectId ?? null,
      fileType,
      safeFile,
    );
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    return {
      mode: "onpremise",
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
  const storageType: StorageMode = (cfg?.storageType as StorageMode) ?? "cloud";

  // ── On-Premise ─────────────────────────────────────────────────────────────
  if (storageType === "onpremise" && cfg?.storagePath) {
    const absPath = buildOnPremPath(cfg.storagePath, organizationId, projectId ?? null, fileType, safeFile);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
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
  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateObjectDir) throw new Error("PRIVATE_OBJECT_DIR not set");

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

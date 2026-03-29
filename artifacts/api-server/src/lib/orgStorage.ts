/**
 * OrgStorageService
 * Routes file storage to cloud (Replit Object Storage) or on-premise
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
  const [cfg] = await db.select().from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, organizationId));
  return cfg ?? null;
}

/**
 * Build on-prem path: {storagePath}/{orgId}/{projectId}/{type}/{filename}
 */
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

export interface UploadResult {
  mode: "cloud" | "onpremise";
  /** For cloud: the object path to pass back to the client for the presigned-URL flow */
  uploadURL?: string;
  objectPath?: string;
  /** For on-prem: the absolute file path where the client should POST the binary */
  filePath?: string;
  /** Relative URL to retrieve the file via the API */
  serveUrl?: string;
}

/**
 * Request an upload slot for a file.
 * For cloud mode, returns a presigned URL.
 * For on-prem mode, returns a local filesystem path + a serve URL.
 */
export async function requestUpload(params: {
  organizationId: number;
  projectId?: number | null;
  fileType?: string; // e.g. "documents", "correspondence", "ncr"
  name: string;
  size?: number;
  contentType?: string;
}): Promise<UploadResult> {
  const { organizationId, projectId, fileType = "general", name } = params;

  const cfg = await getOrgConfig(organizationId);
  const storageType = cfg?.storageType ?? "cloud";

  if (storageType === "onpremise" && cfg?.storagePath) {
    const safeFile = `${Date.now()}_${path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const absPath = buildOnPremPath(cfg.storagePath, organizationId, projectId ?? null, fileType, safeFile);

    // Ensure the directory exists
    fs.mkdirSync(path.dirname(absPath), { recursive: true });

    return {
      mode: "onpremise",
      filePath: absPath,
      objectPath: absPath,
      serveUrl: `/api/storage/onpremise/${organizationId}/${projectId ?? 0}/${fileType}/${safeFile}`,
    };
  }

  // Default: cloud storage
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
 * Stream a file from on-prem storage to the HTTP response.
 */
export function streamOnPremFile(filePath: string): fs.ReadStream | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.createReadStream(filePath);
}

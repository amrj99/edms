import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import path from "path";
import { eq } from "drizzle-orm";
import { db, orgConfigTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { requestUpload, streamOnPremFile, getS3PresignedGetUrl } from "../lib/orgStorage.js";
import { requireAuth } from "../lib/auth.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /uploads/request-url  (→ /api/storage/uploads/request-url)
 * Org-aware: routes to cloud (GCS), S3, or on-prem based on org config.
 */
router.post("/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const { name, size, contentType, projectId, fileType } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Missing required field: name" });
    return;
  }

  const orgId = req.user!.organizationId;
  if (!orgId) {
    // System-level admin — fall back to cloud storage
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath, metadata: { name, size, contentType }, mode: "cloud" });
    } catch {
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
    return;
  }

  try {
    const result = await requestUpload({
      organizationId: orgId,
      projectId: projectId ? parseInt(projectId) : undefined,
      fileType: fileType ?? "general",
      name,
      size,
      contentType,
    });

    res.json({
      uploadURL: result.uploadURL,
      objectPath: result.objectPath,
      serveUrl: result.serveUrl,
      mode: result.mode,
      metadata: { name, size, contentType },
    });
  } catch (error: any) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /public-objects/*  (→ /api/storage/public-objects/*)
 * Serve public assets — no auth checks.
 */
router.get("/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error: any) {
    console.error("Error serving public object:", error);
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /objects/*  (→ /api/storage/objects/*)
 * Serve private object entities from cloud storage.
 */
router.get("/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error: any) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object:", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * GET /onpremise/:orgId/:projectId/:fileType/:filename
 * Serve on-premise files stored on the local filesystem.
 */
router.get(
  "/onpremise/:orgId/:projectId/:fileType/:filename",
  requireAuth,
  async (req: Request, res: Response) => {
    const { orgId, projectId, fileType, filename } = req.params;

    const [cfg] = await db
      .select()
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, parseInt(orgId)));

    if (!cfg?.storagePath) {
      res.status(404).json({ error: "On-premise storage not configured" });
      return;
    }

    const absPath = path.join(cfg.storagePath, orgId, projectId, fileType, filename);
    const stream = streamOnPremFile(absPath);
    if (!stream) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    stream.pipe(res);
  },
);

/**
 * GET /s3-object/:objectKey  (→ /api/storage/s3-object/:objectKey?orgId=N)
 * Serve S3-stored files by generating a presigned GET URL and redirecting.
 * The object key is URL-encoded. orgId is required as a query param.
 */
router.get("/s3-object/:objectKey", requireAuth, async (req: Request, res: Response) => {
  const rawKey = req.params.objectKey;
  const orgIdStr = req.query.orgId as string;

  const orgId = orgIdStr ? parseInt(orgIdStr) : req.user!.organizationId;
  if (!orgId || !rawKey) {
    res.status(400).json({ error: "Missing orgId or objectKey" });
    return;
  }

  try {
    const objectKey = decodeURIComponent(rawKey);
    const presignedUrl = await getS3PresignedGetUrl(orgId, objectKey, 600);
    if (!presignedUrl) {
      res.status(404).json({ error: "S3 not configured or object not found" });
      return;
    }
    // Redirect the browser to the presigned URL (valid for 10 min)
    res.redirect(302, presignedUrl);
  } catch (err: any) {
    console.error("S3 serve error:", err.message);
    res.status(500).json({ error: "Failed to serve S3 object" });
  }
});

export default router;

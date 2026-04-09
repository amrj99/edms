import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import path from "path";
import { eq } from "drizzle-orm";
import { db, orgConfigTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { requestUpload, streamOnPremFile, getS3PresignedGetUrl } from "../lib/orgStorage.js";
import { requireAuth } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ─── Security helpers ─────────────────────────────────────────────────────────

/**
 * Log an unauthorized storage access attempt and return false.
 * Returns true when access is permitted.
 */
async function assertOrgAccess(
  req: Request,
  res: Response,
  targetOrgId: number,
  context: { route: string; key?: string },
): Promise<boolean> {
  const userOrgId = req.user?.organizationId;
  const isSysOwner = req.user?.role === "system_owner";

  if (isSysOwner || userOrgId === targetOrgId) return true;

  // Log unauthorized attempt
  await createAuditLog({
    userId: req.user?.id,
    organizationId: userOrgId ?? undefined,
    action: "UNAUTHORIZED_STORAGE_ACCESS",
    entityType: "file",
    entityId: 0,
    entityTitle: context.key ?? context.route,
    details: {
      route: context.route,
      targetOrgId,
      requestingOrgId: userOrgId ?? null,
      objectKey: context.key ?? null,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    },
    ipAddress: req.ip,
  });

  res.status(403).json({ error: "Access denied: file belongs to a different organization" });
  return false;
}

/**
 * Validate that an S3 object key belongs to the requesting org.
 * Key format: {orgId}/{projectId}/{fileType}/{filename}
 */
function s3KeyBelongsToOrg(objectKey: string, orgId: number): boolean {
  const prefix = `${orgId}/`;
  return objectKey.startsWith(prefix);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /uploads/request-url
 * Org-aware: routes to S3 (default), on-prem, or cloud based on org config.
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
 * GET /public-objects/*
 * Serve public assets — no auth required (logos, etc.)
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
 * GET /objects/*
 * Serve private objects from cloud storage. Requires authentication.
 */
router.get("/objects/*path", requireAuth, async (req: Request, res: Response) => {
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
 * Serve on-premise files. Enforces strict org ownership.
 */
router.get(
  "/onpremise/:orgId/:projectId/:fileType/:filename",
  requireAuth,
  async (req: Request, res: Response) => {
    const { orgId, projectId, fileType, filename } = req.params;
    const targetOrgId = parseInt(orgId);

    // ── Ownership check ───────────────────────────────────────────────────────
    const allowed = await assertOrgAccess(req, res, targetOrgId, {
      route: "onpremise",
      key: `${orgId}/${projectId}/${fileType}/${filename}`,
    });
    if (!allowed) return;

    const [cfg] = await db
      .select()
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, targetOrgId));

    if (!cfg?.storagePath) {
      res.status(404).json({ error: "On-premise storage not configured" });
      return;
    }

    // Path traversal guard — prevent ../../ attacks
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const absPath = path.join(cfg.storagePath, orgId, projectId, fileType, safeFilename);
    // Ensure final path stays within configured base directory
    if (!absPath.startsWith(path.resolve(cfg.storagePath))) {
      await createAuditLog({
        userId: req.user?.id,
        organizationId: req.user?.organizationId ?? undefined,
        action: "PATH_TRAVERSAL_ATTEMPT",
        entityType: "file",
        entityId: 0,
        entityTitle: filename,
        details: { attemptedPath: absPath, basePath: cfg.storagePath },
        ipAddress: req.ip,
      });
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    const stream = streamOnPremFile(absPath);
    if (!stream) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.setHeader("Content-Disposition", `inline; filename="${safeFilename}"`);
    stream.pipe(res);
  },
);

/**
 * GET /s3-object/:objectKey?orgId=N
 * Serve S3-stored files via presigned URL. Enforces strict org ownership.
 * Object key format: {orgId}/{projectId}/{fileType}/{filename}
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

    // ── Ownership check: key must start with orgId/ ───────────────────────────
    if (!s3KeyBelongsToOrg(objectKey, orgId)) {
      // Key prefix doesn't match — could be spoofing attempt
      await createAuditLog({
        userId: req.user?.id,
        organizationId: req.user?.organizationId ?? undefined,
        action: "UNAUTHORIZED_STORAGE_ACCESS",
        entityType: "file",
        entityId: 0,
        entityTitle: objectKey,
        details: {
          route: "s3-object",
          claimedOrgId: orgId,
          objectKey,
          ip: req.ip,
        },
        ipAddress: req.ip,
      });
      res.status(403).json({ error: "Access denied: object key does not belong to the specified organization" });
      return;
    }

    // If user belongs to a different org (and is not system_owner), deny
    const allowed = await assertOrgAccess(req, res, orgId, {
      route: "s3-object",
      key: objectKey,
    });
    if (!allowed) return;

    const presignedUrl = await getS3PresignedGetUrl(orgId, objectKey, 600);
    if (!presignedUrl) {
      res.status(404).json({ error: "S3 not configured or object not found" });
      return;
    }
    res.redirect(302, presignedUrl);
  } catch (err: any) {
    console.error("S3 serve error:", err.message);
    res.status(500).json({ error: "Failed to serve S3 object" });
  }
});

/**
 * GET /storage-types
 * Returns available storage provider options for the UI.
 * Hides cloud/Replit storage unless ENABLE_REPLIT_STORAGE=true.
 */
router.get("/storage-types", requireAuth, (_req: Request, res: Response) => {
  const showReplit = process.env.ENABLE_REPLIT_STORAGE === "true";

  const types = [
    {
      value: "s3",
      label: "S3-Compatible (AWS, Cloudflare R2, MinIO, DigitalOcean Spaces…)",
      description: "Recommended for production. Store files in any S3-compatible bucket.",
      recommended: true,
    },
    {
      value: "onpremise",
      label: "On-Premise / NAS / NFS",
      description: "Store files on a mounted network share or local filesystem path.",
      recommended: false,
    },
    ...(showReplit
      ? [{
          value: "cloud",
          label: "Replit Object Storage (Development Only)",
          description: "Built-in cloud storage. Only works inside the Replit environment.",
          recommended: false,
        }]
      : []),
  ];

  res.json({ types });
});

export default router;

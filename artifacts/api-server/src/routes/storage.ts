import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { Readable } from "stream";
import path from "path";
import fs from "fs";
import { eq } from "drizzle-orm";
import { db, orgConfigTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { requestUpload, streamOnPremFile, getS3PresignedGetUrl } from "../lib/orgStorage.js";
import { requireAuth, signToken, verifyToken } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

// ─── MIME type detection ──────────────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  pdf:  "application/pdf",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  svg:  "image/svg+xml",
  webp: "image/webp",
  bmp:  "image/bmp",
  txt:  "text/plain",
  html: "text/html",
  htm:  "text/html",
  json: "application/json",
  xml:  "application/xml",
  csv:  "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls:  "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc:  "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt:  "application/vnd.ms-powerpoint",
  zip:  "application/zip",
  dwg:  "image/vnd.dwg",
  dxf:  "image/vnd.dxf",
  mp4:  "video/mp4",
  mp3:  "audio/mpeg",
};

function getMimeType(filename: string): string {
  const ext = path.extname(filename).replace(".", "").toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

// ─── View-token middleware ────────────────────────────────────────────────────
// Accepts either: Authorization: Bearer <jwt>  OR  ?vt=<view-token>
// If a view token is used, the token payload must contain the expected file path.
function requireAuthOrViewToken(expectedPathFn: (req: Request) => string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const viewToken = req.query.vt as string | undefined;

    if (viewToken) {
      const payload = verifyToken(viewToken) as Record<string, unknown> | null;
      if (!payload || payload.type !== "view_file") {
        res.status(401).json({ error: "Invalid or expired view token" });
        return;
      }
      const expectedPath = expectedPathFn(req);
      if (payload.url !== expectedPath) {
        res.status(403).json({ error: "View token does not match this file" });
        return;
      }
      // Inject minimal user context for downstream org-access checks
      (req as any).user = {
        id: payload.userId as number,
        organizationId: payload.orgId as number | null,
        role: payload.role as string ?? "member",
      };
      next();
      return;
    }

    // Fall back to standard Bearer auth
    requireAuth(req, res, next);
  };
}

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
 * GET /view-token?url=<encodedStorageUrl>
 * Issues a short-lived (5 min) signed token that allows a browser (iframe, img, etc.)
 * to load a private storage file without sending an Authorization header.
 * Only API-internal storage URLs are accepted — external URLs are rejected.
 */
router.get("/view-token", requireAuth, (req: Request, res: Response) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) {
    res.status(400).json({ error: "url query parameter is required" });
    return;
  }

  const decodedUrl = decodeURIComponent(rawUrl);

  // Security: only allow URLs pointing to our own storage endpoints
  const allowedPrefixes = ["/api/storage/onpremise/", "/api/storage/objects/", "/api/storage/s3-object/", "/objects/"];
  if (!allowedPrefixes.some(p => decodedUrl.startsWith(p))) {
    res.status(400).json({ error: "URL is not a valid internal storage path" });
    return;
  }

  const token = signToken(
    {
      type: "view_file",
      url: decodedUrl,
      userId: req.user!.id,
      orgId: req.user!.organizationId ?? null,
      role: req.user!.role,
    },
    300, // 5 minutes
  );

  res.json({ token, expiresIn: 300 });
});

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
 * PUT /uploads/onpremise/:orgId/:projectId/:fileType/:filename
 *
 * On-premise binary upload endpoint.
 * The client PUTs the raw file body here (same interface as S3 presigned URLs).
 * The server writes the binary to the configured on-premise storage path.
 *
 * URL is generated by requestUpload() in orgStorage.ts when mode=onpremise.
 */
router.put(
  "/uploads/onpremise/:orgId/:projectId/:fileType/:filename",
  requireAuth,
  // Parse raw body — must come before express.json() that the main app applies.
  // We use express.raw() scoped to this route only.
  (req, res, next) => {
    // If body already populated (shouldn't happen for binary PUT, but guard anyway)
    if (Buffer.isBuffer(req.body) || (req.body && Object.keys(req.body).length > 0)) {
      return next();
    }
    const raw: Buffer[] = [];
    req.on("data", (chunk: Buffer) => raw.push(chunk));
    req.on("end", () => {
      req.body = Buffer.concat(raw);
      next();
    });
    req.on("error", (err) => next(err));
  },
  async (req: Request, res: Response) => {
    const { orgId, projectId, fileType, filename } = req.params;
    const targetOrgId = parseInt(orgId);

    // ── Ownership check ─────────────────────────────────────────────────────
    const allowed = await assertOrgAccess(req, res, targetOrgId, {
      route: "onpremise-upload",
      key: `${orgId}/${projectId}/${fileType}/${filename}`,
    });
    if (!allowed) return;

    // ── Resolve storage path ─────────────────────────────────────────────────
    const [cfg] = await db
      .select()
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, targetOrgId));

    const envStoragePath = process.env.DEFAULT_STORAGE_PATH || null;
    const basePath = cfg?.storagePath || envStoragePath;

    if (!basePath) {
      res.status(500).json({ error: "On-premise storage path not configured" });
      return;
    }

    // ── Path traversal guard ─────────────────────────────────────────────────
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const targetPath = path.join(basePath, orgId, projectId, fileType, safeFilename);
    const resolvedBase = path.resolve(basePath);
    if (!path.resolve(targetPath).startsWith(resolvedBase)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    // ── Write file ───────────────────────────────────────────────────────────
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const body = req.body as Buffer;
      if (!body || body.length === 0) {
        res.status(400).json({ error: "Empty file body" });
        return;
      }
      fs.writeFileSync(targetPath, body);

      await createAuditLog({
        userId: req.user?.id,
        organizationId: targetOrgId,
        action: "upload",
        entityType: "file",
        entityId: 0,
        entityTitle: safeFilename,
        details: { path: targetPath, size: body.length },
      });

      // Return the same shape as S3/cloud modes
      res.status(200).json({
        objectPath: targetPath,
        serveUrl: `/api/storage/onpremise/${orgId}/${projectId}/${fileType}/${safeFilename}`,
      });
    } catch (err: any) {
      console.error("[storage] On-premise write failed:", err.message);
      res.status(500).json({ error: "Failed to write file to on-premise storage" });
    }
  },
);

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
router.get(
  "/objects/*path",
  requireAuthOrViewToken(req => {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    return `/api/storage/objects/${wildcardPath}`;
  }),
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);
      // Set Content-Type based on filename before piping the stream
      const filename = wildcardPath.split("/").pop() ?? "";
      const mimeType = getMimeType(filename);
      res.setHeader("Content-Type", mimeType);
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      // Forward remaining headers from object storage (but not Content-Type — we set it)
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "content-type") res.setHeader(key, value);
      });
      res.status(response.status);
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
  },
);

/**
 * GET /onpremise/:orgId/:projectId/:fileType/:filename
 * Serve on-premise files. Enforces strict org ownership.
 */
router.get(
  "/onpremise/:orgId/:projectId/:fileType/:filename",
  requireAuthOrViewToken(req => `/api/storage/onpremise/${req.params.orgId}/${req.params.projectId}/${req.params.fileType}/${req.params.filename}`),
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

    // Mirror the upload endpoint: fall back to DEFAULT_STORAGE_PATH env var
    const envStoragePath = process.env.DEFAULT_STORAGE_PATH || null;
    const basePath = cfg?.storagePath || envStoragePath;

    if (!basePath) {
      res.status(404).json({ error: "On-premise storage not configured" });
      return;
    }

    // Path traversal guard — prevent ../../ attacks
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const absPath = path.join(basePath, orgId, projectId, fileType, safeFilename);
    // Ensure final path stays within configured base directory
    if (!absPath.startsWith(path.resolve(basePath))) {
      await createAuditLog({
        userId: req.user?.id,
        organizationId: req.user?.organizationId ?? undefined,
        action: "PATH_TRAVERSAL_ATTEMPT",
        entityType: "file",
        entityId: 0,
        entityTitle: filename,
        details: { attemptedPath: absPath, basePath },
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

    const mimeType = getMimeType(safeFilename);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${safeFilename}"`);
    // Allow iframe embedding from the same origin
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    stream.pipe(res);
  },
);

/**
 * GET /s3-object/:objectKey?orgId=N
 * Serve S3-stored files via presigned URL. Enforces strict org ownership.
 * Object key format: {orgId}/{projectId}/{fileType}/{filename}
 */
router.get(
  "/s3-object/:objectKey",
  requireAuthOrViewToken(req => `/api/storage/s3-object/${req.params.objectKey}`),
  async (req: Request, res: Response) => {
  const rawKey = req.params.objectKey;
  const orgIdStr = req.query.orgId as string;

  const objectKeyDecoded = decodeURIComponent(rawKey);
  // Derive orgId: query param > key prefix (format: {orgId}/...) > session user
  const keyOrgId = parseInt(objectKeyDecoded.split("/")[0]) || null;
  const orgId = orgIdStr
    ? parseInt(orgIdStr)
    : (req.user?.organizationId ?? keyOrgId ?? 0);

  if (!orgId || !rawKey) {
    res.status(400).json({ error: "Missing orgId or objectKey" });
    return;
  }

  try {
    const objectKey = objectKeyDecoded;

    // ── Ownership check: key must start with orgId/ ───────────────────────────
    if (!s3KeyBelongsToOrg(objectKey, orgId)) {
      // Key prefix doesn't match — could be spoofing attempt; only audit-log for real users
      if (req.user) {
        await createAuditLog({
          userId: req.user.id,
          organizationId: req.user.organizationId ?? undefined,
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
      }
      res.status(403).json({ error: "Access denied: object key does not belong to the specified organization" });
      return;
    }

    // Skip assertOrgAccess for view-token requests (token already validated the path)
    if (req.user) {
      const allowed = await assertOrgAccess(req, res, orgId, {
        route: "s3-object",
        key: objectKey,
      });
      if (!allowed) return;
    }

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

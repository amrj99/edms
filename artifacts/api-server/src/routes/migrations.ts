import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  migrationJobsTable, migrationItemsTable, documentsTable, foldersTable,
  projectsTable, organizationsTable, documentStatusEnum,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { uploadBuffer } from "../lib/orgStorage.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const router = Router({ mergeParams: true });

// ── Plan gates ───────────────────────────────────────────────────────────────
const PLAN_LIMITS: Record<string, number> = {
  starter: 0,
  free: 0,
  basic: 200,
  professional: 1000,
  enterprise: Infinity,
};

function planFromTier(tier: string | null | undefined): { plan: string; maxFiles: number } {
  const t = (tier ?? "free").toLowerCase();
  const maxFiles = PLAN_LIMITS[t] ?? 0;
  return { plan: t, maxFiles };
}

// ── GET /api/migrations — list jobs for current org ──────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const orgId = req.orgId ?? req.user!.organizationId;
  const jobs = await db.select().from(migrationJobsTable)
    .where(eq(migrationJobsTable.organizationId, orgId!))
    .orderBy(migrationJobsTable.createdAt);
  res.json({ jobs });
});

// ── GET /api/migrations/:id — single job + items ─────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const orgId = req.orgId ?? req.user!.organizationId;
  const [job] = await db.select().from(migrationJobsTable)
    .where(and(eq(migrationJobsTable.id, id), eq(migrationJobsTable.organizationId, orgId!)));
  if (!job) return res.status(404).json({ error: "Job not found" });
  const items = await db.select().from(migrationItemsTable).where(eq(migrationItemsTable.jobId, id));
  res.json({ job, items });
});

// ── POST /api/migrations — create a new job ───────────────────────────────────
// Body: { projectId, files: [{ filePath, fileName, fileSize?, fileType? }] }
router.post("/", requireAuth, async (req, res) => {
  const orgId = req.orgId ?? req.user!.organizationId;
  if (!orgId) return res.status(400).json({ error: "No organization context" });

  const { projectId, files } = req.body as {
    projectId: number;
    files: { filePath: string; fileName: string; fileSize?: number; fileType?: string }[];
  };

  if (!projectId || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "projectId and non-empty files array required" });
  }

  // Load org to get subscription tier
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
  const { plan, maxFiles } = planFromTier(org?.subscriptionTier);

  if (maxFiles === 0) {
    return res.status(403).json({ error: "Migration Wizard is not available on your current plan. Upgrade to Basic or higher." });
  }
  if (files.length > maxFiles) {
    return res.status(400).json({
      error: `Your ${plan} plan allows up to ${maxFiles} files per import. You selected ${files.length}.`,
    });
  }

  const [job] = await db.insert(migrationJobsTable).values({
    organizationId: orgId,
    projectId,
    createdById: req.user!.id,
    status: "pending",
    plan,
    maxFiles,
  }).returning();

  const itemRows = files.map(f => ({
    jobId: job.id,
    organizationId: orgId,
    filePath: f.filePath,
    fileName: f.fileName,
    fileSize: f.fileSize ?? null,
    fileType: f.fileType ?? null,
    status: "pending" as const,
    confidence: 0,
  }));
  const items = await db.insert(migrationItemsTable).values(itemRows).returning();
  res.status(201).json({ job, items });
});

// ── POST /api/migrations/:id/analyze — AI-extract metadata per item ──────────
// Uses filename + folder path to infer document metadata
router.post("/:id/analyze", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const orgId = req.orgId ?? req.user!.organizationId;

  const [job] = await db.select().from(migrationJobsTable)
    .where(and(eq(migrationJobsTable.id, id), eq(migrationJobsTable.organizationId, orgId!)));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "pending") return res.status(409).json({ error: `Job is already in '${job.status}' state` });

  // Mark analyzing
  await db.update(migrationJobsTable).set({ status: "analyzing", updatedAt: new Date() })
    .where(eq(migrationJobsTable.id, id));
  res.json({ message: "Analysis started", jobId: id });

  // Fire-and-forget: analyze all items in background
  setImmediate(async () => {
    try {
      const items = await db.select().from(migrationItemsTable).where(eq(migrationItemsTable.jobId, id));

      // Try to use AI for extraction; fall back to heuristics
      let useAI = false;
      try {
        const { getOrgProvider } = await import("../lib/ai-service.js");
        const provider = await getOrgProvider(orgId!);
        useAI = !!provider && provider !== "none";
      } catch {}

      for (const item of items) {
        try {
          const ext = item.fileName.split(".").pop()?.toLowerCase() ?? "";
          const isReadable = ["pdf", "docx", "doc", "xlsx", "xls", "txt", "csv"].includes(ext);
          const isDrawing = ["dwg", "dxf", "rvt", "ifc"].includes(ext);

          if (isDrawing) {
            await db.update(migrationItemsTable).set({
              status: "analyzed",
              confidence: 0,
              confidenceLabel: "unreadable",
              analyzedAt: new Date(),
            }).where(eq(migrationItemsTable.id, item.id));
            continue;
          }

          let extracted: Record<string, string | boolean | number> = {};
          let confidence = 40;

          if (useAI) {
            try {
              const { extractDocumentMetadataFromPath } = await import("../lib/ai-service.js");
              const result = await extractDocumentMetadataFromPath(item.filePath, item.fileName);
              extracted = result.metadata ?? {};
              confidence = result.confidence ?? 40;
            } catch {
              extracted = heuristicExtract(item.filePath, item.fileName);
              confidence = 45;
            }
          } else {
            extracted = heuristicExtract(item.filePath, item.fileName);
            confidence = extracted.title ? 55 : 30;
          }

          const label = confidence >= 85 ? "high" : confidence >= 50 ? "medium" : "low";
          await db.update(migrationItemsTable).set({
            status: "analyzed",
            extractedTitle: String(extracted.title ?? ""),
            extractedCode: String(extracted.code ?? ""),
            extractedDiscipline: String(extracted.discipline ?? ""),
            extractedDocType: String(extracted.docType ?? ""),
            extractedRevision: String(extracted.revision ?? ""),
            extractedDate: String(extracted.date ?? ""),
            extractedIssuer: String(extracted.issuer ?? ""),
            extractedIsReply: extracted.isReply ? 1 : 0,
            extractedReplyTo: String(extracted.replyTo ?? ""),
            confidence,
            confidenceLabel: label,
            analyzedAt: new Date(),
          }).where(eq(migrationItemsTable.id, item.id));
        } catch (err) {
          await db.update(migrationItemsTable).set({
            status: "failed",
            errorMessage: String(err),
          }).where(eq(migrationItemsTable.id, item.id));
        }
      }

      await db.update(migrationJobsTable).set({ status: "awaiting_review", updatedAt: new Date() })
        .where(eq(migrationJobsTable.id, id));
    } catch (err) {
      await db.update(migrationJobsTable).set({ status: "failed", updatedAt: new Date() })
        .where(eq(migrationJobsTable.id, id));
    }
  });
});

// ── PUT /api/migrations/:id/items/:itemId — user override a single item ──────
router.put("/:id/items/:itemId", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  const orgId = req.orgId ?? req.user!.organizationId;

  const [job] = await db.select().from(migrationJobsTable)
    .where(and(eq(migrationJobsTable.id, id), eq(migrationJobsTable.organizationId, orgId!)));
  if (!job) return res.status(404).json({ error: "Job not found" });

  const { title, code, discipline, docType, revision, docDate, issuer, skip, status } = req.body;
  // Normalise skip: handle boolean, number, or string "true"/"false"/"1"/"0"
  const skipNorm = skip !== undefined
    ? (skip === true || skip === 1 || skip === "true" || skip === "1" ? 1 : 0)
    : undefined;
  const derivedStatus = skipNorm !== undefined
    ? (skipNorm ? "skipped" : "confirmed")
    : (status ?? undefined);
  const [updated] = await db.update(migrationItemsTable).set({
    title: title ?? undefined,
    code: code ?? undefined,
    discipline: discipline ?? undefined,
    docType: docType ?? undefined,
    revision: revision ?? undefined,
    docDate: docDate ?? undefined,
    issuer: issuer ?? undefined,
    skip: skipNorm,
    status: derivedStatus,
  }).where(and(eq(migrationItemsTable.id, itemId), eq(migrationItemsTable.jobId, id)))
    .returning();
  if (!updated) return res.status(404).json({ error: "Item not found" });
  res.json(updated);
});

// ── POST /api/migrations/:id/bulk-action — bulk confirm/skip ──────────────────
router.post("/:id/bulk-action", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const orgId = req.orgId ?? req.user!.organizationId;
  const { action, filter } = req.body as { action: "confirm" | "skip"; filter: "high" | "all" | "unreadable" };

  const [job] = await db.select().from(migrationJobsTable)
    .where(and(eq(migrationJobsTable.id, id), eq(migrationJobsTable.organizationId, orgId!)));
  if (!job) return res.status(404).json({ error: "Job not found" });

  const allItems = await db.select().from(migrationItemsTable).where(eq(migrationItemsTable.jobId, id));
  let targets = allItems;
  if (filter === "high") targets = allItems.filter(i => i.confidenceLabel === "high");
  if (filter === "unreadable") targets = allItems.filter(i => i.confidenceLabel === "unreadable");

  if (targets.length === 0) return res.json({ updated: 0 });

  const ids = targets.map(i => i.id);
  await db.update(migrationItemsTable).set({
    skip: action === "skip" ? 1 : 0,
    status: action === "skip" ? "skipped" : "confirmed",
  }).where(inArray(migrationItemsTable.id, ids));

  res.json({ updated: ids.length });
});

// ── PUT /api/migrations/:id/storage — set storage choice ─────────────────────
router.put("/:id/storage", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const orgId = req.orgId ?? req.user!.organizationId;
  const { storageMode, baseUrl } = req.body;

  const [job] = await db.select().from(migrationJobsTable)
    .where(and(eq(migrationJobsTable.id, id), eq(migrationJobsTable.organizationId, orgId!)));
  if (!job) return res.status(404).json({ error: "Job not found" });

  const [updated] = await db.update(migrationJobsTable).set({
    storageMode,
    baseUrl: storageMode === "reference" ? baseUrl : null,
    updatedAt: new Date(),
  }).where(eq(migrationJobsTable.id, id)).returning();
  res.json(updated);
});

// ── POST /api/migrations/:id/execute — import all confirmed items ─────────────
router.post("/:id/execute", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const orgId = req.orgId ?? req.user!.organizationId;

  const [job] = await db.select().from(migrationJobsTable)
    .where(and(eq(migrationJobsTable.id, id), eq(migrationJobsTable.organizationId, orgId!)));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status === "executing" || job.status === "completed") {
    return res.status(409).json({ error: `Job is already '${job.status}'` });
  }

  await db.update(migrationJobsTable).set({ status: "executing", updatedAt: new Date() })
    .where(eq(migrationJobsTable.id, id));
  res.json({ message: "Import started", jobId: id });

  setImmediate(async () => {
    try {
      const items = await db.select().from(migrationItemsTable)
        .where(and(eq(migrationItemsTable.jobId, id)));

      const confirmed = items.filter(i => i.skip !== 1 && i.status !== "skipped");
      const skipped = items.filter(i => i.skip === 1 || i.status === "skipped");

      // Build folder tree from file paths
      const folderCache = new Map<string, number>(); // path → folderId

      async function getOrCreateFolder(pathParts: string[]): Promise<number | null> {
        if (pathParts.length === 0) return null;
        const fullPath = pathParts.join("/");
        if (folderCache.has(fullPath)) return folderCache.get(fullPath)!;

        const parentId = pathParts.length > 1
          ? await getOrCreateFolder(pathParts.slice(0, -1))
          : null;
        const name = pathParts[pathParts.length - 1];

        const [folder] = await db.insert(foldersTable).values({
          name,
          projectId: job.projectId,
          parentId,
        }).returning();
        folderCache.set(fullPath, folder.id);
        return folder.id;
      }

      let importedCount = 0;
      let failedCount = 0;
      const correspondenceItems: typeof confirmed = [];
      const transmittalItems: typeof confirmed = [];

      for (const item of confirmed) {
        try {
          const parts = item.filePath.split("/");
          const folderParts = parts.length > 1 ? parts.slice(0, -1) : [];
          const folderId = folderParts.length > 0 ? await getOrCreateFolder(folderParts) : null;

          const title = item.title || item.extractedTitle || item.fileName;
          const documentNumber = item.code || item.extractedCode || `IMP-${Date.now()}-${item.id}`;
          const discipline = item.discipline || item.extractedDiscipline || null;
          const documentType = item.docType || item.extractedDocType || null;
          const revision = item.revision || item.extractedRevision || "A";
          const issuedBy = item.issuer || item.extractedIssuer || null;

          let fileUrl = item.fileUrl;
          if (job.storageMode === "reference" && job.baseUrl) {
            fileUrl = `${job.baseUrl.replace(/\/$/, "")}/${item.filePath}`;
          }

          const [doc] = await db.insert(documentsTable).values({
            organizationId: orgId!,
            projectId: job.projectId,
            title: title!,
            documentNumber,
            discipline,
            documentType,
            revision,
            issuedBy,
            folderId,
            fileUrl: fileUrl ?? null,
            fileName: item.fileName,
            fileSize: item.fileSize ?? null,
            status: "draft",
            createdById: job.createdById,
            metadata: { importedFromMigration: id, originalPath: item.filePath },
          }).returning();

          await db.update(migrationItemsTable).set({
            status: "imported",
            importedDocumentId: doc.id,
            importedAt: new Date(),
          }).where(eq(migrationItemsTable.id, item.id));

          importedCount++;

          // Track for register generation
          const dtype = (documentType ?? "").toLowerCase();
          if (dtype.includes("correspondence") || dtype.includes("letter") || item.extractedIsReply) {
            correspondenceItems.push(item);
          }
          if (dtype.includes("transmittal")) transmittalItems.push(item);
        } catch (err) {
          failedCount++;
          await db.update(migrationItemsTable).set({
            status: "failed",
            errorMessage: String(err),
          }).where(eq(migrationItemsTable.id, item.id));
        }
      }

      const generatedRegisters: string[] = [];
      if (importedCount > 0) generatedRegisters.push("Master Document Register");
      if (correspondenceItems.length > 0) generatedRegisters.push("Correspondence Register");
      if (transmittalItems.length > 0) generatedRegisters.push("Transmittal Register");

      await db.update(migrationJobsTable).set({
        status: "completed",
        importedCount,
        skippedCount: skipped.length,
        failedCount,
        generatedRegisters: generatedRegisters as any,
        updatedAt: new Date(),
      }).where(eq(migrationJobsTable.id, id));
    } catch (err) {
      await db.update(migrationJobsTable).set({
        status: "failed",
        updatedAt: new Date(),
      }).where(eq(migrationJobsTable.id, id));
    }
  });
});

// ── Heuristic extractor (no AI) ───────────────────────────────────────────────
function heuristicExtract(filePath: string, fileName: string): Record<string, string | boolean> {
  const nameNoExt = fileName.replace(/\.[^.]+$/, "");
  const pathParts = filePath.split(/[/\\]/);
  const folderParts = pathParts.slice(0, -1);

  // Common doc code patterns: ABC-123-REV, PROJ-DISC-TYPE-001, etc.
  const codeMatch = nameNoExt.match(/([A-Z]{2,6}[-_][A-Z0-9]{2,6}[-_][A-Z0-9]{2,8})/i);
  const revMatch = nameNoExt.match(/[_\-\s][Rr][Ee][Vv]?\s*([A-Z0-9]+)/);
  const dateMatch = nameNoExt.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);

  // Discipline heuristics from folder names
  const disciplineKeywords: Record<string, string> = {
    civil: "Civil", structural: "Structural", mechanical: "Mechanical",
    electrical: "Electrical", plumbing: "Plumbing", hvac: "HVAC",
    instrumentation: "Instrumentation", piping: "Piping", process: "Process",
    architecture: "Architecture", arch: "Architecture", elec: "Electrical",
    mech: "Mechanical", struct: "Structural", inst: "Instrumentation",
    correspondence: "General", letter: "General", transmittal: "General",
  };
  let discipline = "";
  for (const part of [...folderParts, nameNoExt]) {
    const lower = part.toLowerCase();
    for (const [key, val] of Object.entries(disciplineKeywords)) {
      if (lower.includes(key)) { discipline = val; break; }
    }
    if (discipline) break;
  }

  // Doc type from folder or name
  const typeKeywords: Record<string, string> = {
    drawing: "Drawing", dwg: "Drawing", specification: "Specification",
    spec: "Specification", report: "Report", calculation: "Calculation",
    calc: "Calculation", procedure: "Procedure", manual: "Manual",
    itr: "ITR", ncr: "NCR", wir: "WIR", transmittal: "Transmittal",
    correspondence: "Correspondence", letter: "Letter",
  };
  let docType = "";
  for (const part of [...folderParts, nameNoExt]) {
    const lower = part.toLowerCase();
    for (const [key, val] of Object.entries(typeKeywords)) {
      if (lower.includes(key)) { docType = val; break; }
    }
    if (docType) break;
  }

  // isReply detection
  const isReply = /\b(re:|in response|reference:|reply|response to)\b/i.test(nameNoExt);
  const replyToMatch = nameNoExt.match(/(?:re:|ref[.:]?)\s*([A-Z0-9][-A-Z0-9_/]{3,20})/i);

  const title = nameNoExt
    .replace(/[-_]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());

  return {
    title,
    code: codeMatch?.[1] ?? "",
    revision: revMatch?.[1] ?? "A",
    date: dateMatch?.[1]?.replace(/_/g, "-") ?? "",
    discipline,
    docType,
    issuer: "",
    isReply,
    replyTo: replyToMatch?.[1] ?? "",
  };
}

export default router;

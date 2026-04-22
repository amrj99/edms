import { Router } from "express";
import { db } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import {
  usersTable, projectsTable, organizationsTable, documentsTable,
  correspondenceTable, transmittalsTable, tasksTable, orgConfigTable,
  inspectionRequestsTable, ncrRecordsTable, nocRecordsTable,
  deliverablesTable, meetingsTable, systemSettingsTable,
  aiLogsTable, ruleExecutionLogsTable, rulesTable,
  projectMembersTable, subscriptionsTable, accessShadowLogTable,
} from "@workspace/db";
import { desc, asc, isNull, or as drizzleOr, gt, lt } from "drizzle-orm";
import { PLANS } from "../lib/plans.js";
import { requireAuth, isSysAdmin, isSystemOwner, requireRole } from "../lib/auth.js";
import { encrypt } from "../lib/encryption.js";
import { getOrgAiQuota, SUBSCRIPTION_TIERS, type SubscriptionTier } from "../lib/ai-service.js";
import { testSmtpConnection } from "../lib/email.js";
import { syncOrgModules } from "../lib/module-sync-service.js";

const router = Router();

router.use(requireAuth);

// ─── System Info ──────────────────────────────────────────────────────────────
router.get("/system-info", async (req, res) => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const user = req.user!;
  const countRow = async (table: any) => {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    return r?.n ?? 0;
  };

  const [users, projects, documents, orgs] = await Promise.all([
    countRow(usersTable),
    countRow(projectsTable),
    countRow(documentsTable),
    countRow(organizationsTable),
  ]);

  res.json({
    counts: { users, projects, documents, organizations: orgs },
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV ?? "development",
    emailConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    storageConfigured: !!(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID),
    appUrl: process.env.APP_URL ?? null,
    smtpHost: process.env.SMTP_HOST ?? null,
    smtpFrom: process.env.SMTP_FROM ?? null,
  });
});

// ─── SMTP Test ────────────────────────────────────────────────────────────────
router.post("/smtp/test", async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const result = await testSmtpConnection();
  res.json(result);
});

// ─── Storage Usage ─────────────────────────────────────────────────────────────
router.get("/storage-usage", async (req, res) => {
  const user = req.user!;

  const usageRows = await db
    .select({
      orgId: projectsTable.organizationId,
      totalBytes: sql<number>`coalesce(sum(${documentsTable.fileSize}), 0)::bigint`,
      docCount: sql<number>`count(${documentsTable.id})::int`,
    })
    .from(documentsTable)
    .leftJoin(projectsTable, eq(documentsTable.projectId, projectsTable.id))
    .groupBy(projectsTable.organizationId);

  const configs = await db.select().from(orgConfigTable);
  const configMap = new Map(configs.map(c => [c.organizationId, c]));

  let orgs: any[] = [];
  if (isSystemOwner(user)) {
    orgs = await db.select().from(organizationsTable);
  } else if (user.organizationId) {
    orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId));
  }

  const result = orgs.map(org => {
    const usage = usageRows.find(r => r.orgId === org.id);
    const config = configMap.get(org.id);
    const usedBytes = Number(usage?.totalBytes ?? 0);
    const quotaMb = config?.storageQuotaMb ?? 10240;
    const usedMb = Math.round(usedBytes / 1024 / 1024 * 100) / 100;
    return {
      orgId: org.id,
      orgName: org.name,
      usedMb,
      usedBytes,
      quotaMb,
      docCount: usage?.docCount ?? 0,
      percentUsed: quotaMb > 0 ? Math.min(100, Math.round((usedMb / quotaMb) * 100)) : 0,
      storagePath: config?.storagePath ?? null,
      storageType: config?.storageType ?? (process.env.DEFAULT_STORAGE_TYPE ?? "s3"),
      s3Endpoint: config?.s3Endpoint ?? null,
      s3Bucket: config?.s3Bucket ?? null,
      s3Region: config?.s3Region ?? null,
      s3AccessKey: config?.s3AccessKey ? "***configured***" : null, // never expose actual key
    };
  });

  res.json({ usage: result });
});

// ─── Usage Monitoring Dashboard ────────────────────────────────────────────────
router.get("/usage", async (req, res) => {
  const user = req.user!;

  let orgs: any[] = [];
  if (isSystemOwner(user)) {
    orgs = await db.select().from(organizationsTable);
  } else if (user.organizationId) {
    orgs = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.organizationId));
  }

  const orgIds = orgs.map(o => o.id);
  if (orgIds.length === 0) { res.json({ orgs: [], totals: {} }); return; }

  // --- aggregate per-org counts via raw SQL for efficiency ---
  const [
    docRows, corrRows, trsRows, aiRows, ruleRows, memberRows,
    itrRows, ncrRows, nocRows, subRows,
  ] = await Promise.all([
    // documents per org (via project)
    db.select({
      orgId: projectsTable.organizationId,
      count: sql<number>`count(${documentsTable.id})::int`,
    }).from(documentsTable)
      .leftJoin(projectsTable, eq(documentsTable.projectId, projectsTable.id))
      .groupBy(projectsTable.organizationId),

    // correspondence per org
    db.select({
      orgId: correspondenceTable.organizationId,
      count: sql<number>`count(*)::int`,
    }).from(correspondenceTable).groupBy(correspondenceTable.organizationId),

    // transmittals per org
    db.select({
      orgId: transmittalsTable.organizationId,
      count: sql<number>`count(*)::int`,
    }).from(transmittalsTable).groupBy(transmittalsTable.organizationId),

    // AI calls + tokens per org
    db.select({
      orgId: aiLogsTable.organizationId,
      calls: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${aiLogsTable.tokensUsed}), 0)::int`,
    }).from(aiLogsTable).groupBy(aiLogsTable.organizationId),

    // rule executions per org (via rules table's organizationId)
    db.select({
      orgId: rulesTable.organizationId,
      executions: sql<number>`count(${ruleExecutionLogsTable.id})::int`,
    }).from(ruleExecutionLogsTable)
      .leftJoin(rulesTable, eq(ruleExecutionLogsTable.ruleId, rulesTable.id))
      .groupBy(rulesTable.organizationId),

    // project members per org (seat count)
    db.select({
      orgId: usersTable.organizationId,
      seats: sql<number>`count(*)::int`,
    }).from(usersTable).where(sql`${usersTable.organizationId} is not null`).groupBy(usersTable.organizationId),

    // ITR count
    db.select({
      orgId: inspectionRequestsTable.organizationId,
      count: sql<number>`count(*)::int`,
    }).from(inspectionRequestsTable).groupBy(inspectionRequestsTable.organizationId),

    // NCR count
    db.select({
      orgId: ncrRecordsTable.organizationId,
      count: sql<number>`count(*)::int`,
    }).from(ncrRecordsTable).groupBy(ncrRecordsTable.organizationId),

    // NOC count
    db.select({
      orgId: nocRecordsTable.organizationId,
      count: sql<number>`count(*)::int`,
    }).from(nocRecordsTable).groupBy(nocRecordsTable.organizationId),

    // Billing subscriptions
    db.select({
      organizationId: subscriptionsTable.organizationId,
      planId: subscriptionsTable.planId,
      status: subscriptionsTable.status,
      currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
      paymentFailedAt: subscriptionsTable.paymentFailedAt,
    }).from(subscriptionsTable),
  ]);

  const byOrg = (rows: any[], key = "orgId") => new Map(rows.map(r => [r[key], r]));
  const docMap   = byOrg(docRows);
  const corrMap  = byOrg(corrRows);
  const trsMap   = byOrg(trsRows);
  const aiMap    = byOrg(aiRows);
  const ruleMap  = byOrg(ruleRows);
  const memberMap = byOrg(memberRows);
  const itrMap   = byOrg(itrRows);
  const ncrMap   = byOrg(ncrRows);
  const nocMap   = byOrg(nocRows);
  const subMap   = new Map(subRows.map(r => [r.organizationId, r]));

  const result = orgs.map(org => {
    const sub = subMap.get(org.id);
    // Phase 1 SSOT: subscriptions.plan_id is primary; org.subscriptionTier is legacy fallback.
    // Both are pre-fetched in the batch queries above — no extra DB call needed.
    const billingPlan    = sub?.planId ?? org.subscriptionTier ?? "free";
    const billingStatus  = sub?.status ?? "free";
    const plan           = PLANS.find(p => p.id === billingPlan) ?? null;
    const seatsUsed      = memberMap.get(org.id)?.seats ?? 0;

    return {
      orgId: org.id,
      orgName: org.name,
      orgType: org.type,
      seats:        seatsUsed,
      documents:    docMap.get(org.id)?.count ?? 0,
      correspondence: corrMap.get(org.id)?.count ?? 0,
      transmittals: trsMap.get(org.id)?.count ?? 0,
      aiCalls:      aiMap.get(org.id)?.calls ?? 0,
      aiTokens:     aiMap.get(org.id)?.tokens ?? 0,
      ruleExecutions: ruleMap.get(org.id)?.executions ?? 0,
      itr:          itrMap.get(org.id)?.count ?? 0,
      ncr:          ncrMap.get(org.id)?.count ?? 0,
      noc:          nocMap.get(org.id)?.count ?? 0,
      // Billing fields
      billingPlan,
      billingStatus,
      renewalDate:        sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
      seatsUsed,
      seatsAllowed:       plan?.maxUsers ?? null,
      storageUsedMb:      org.storageUsedMb ?? 0,
      storageAllowedMb:   plan?.storageMb ?? null,
      paymentFailed:      billingStatus === "past_due",
    };
  });

  const sum = (key: string) => result.reduce((a, r) => a + (r as any)[key], 0);
  const totals = {
    seats: sum("seats"), documents: sum("documents"), correspondence: sum("correspondence"),
    transmittals: sum("transmittals"), aiCalls: sum("aiCalls"), aiTokens: sum("aiTokens"),
    ruleExecutions: sum("ruleExecutions"), itr: sum("itr"), ncr: sum("ncr"), noc: sum("noc"),
  };

  res.json({ orgs: result, totals, isSysAdmin: isSystemOwner(user) });
});

// ─── Update Storage Config per org ────────────────────────────────────────────
router.put("/storage-config/:orgId", async (req, res) => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = parseInt(req.params.orgId);
  const { storageQuotaMb, storagePath, storageType, s3Endpoint, s3Bucket, s3Region, s3AccessKey, s3SecretKey } = req.body;

  const updateData: any = { storageQuotaMb, storagePath, updatedAt: new Date() };
  if (storageType !== undefined) updateData.storageType = storageType;
  if (s3Endpoint !== undefined) updateData.s3Endpoint = s3Endpoint;
  if (s3Bucket !== undefined) updateData.s3Bucket = s3Bucket;
  if (s3Region !== undefined) updateData.s3Region = s3Region;
  // Encrypt credentials at rest — decrypt() in orgStorage.ts handles backward-compat plaintext
  if (s3AccessKey !== undefined) updateData.s3AccessKey = encrypt(s3AccessKey);
  // Only update secret key if explicitly provided (not empty string placeholder)
  if (s3SecretKey) updateData.s3SecretKey = encrypt(s3SecretKey);

  const existing = await db.select().from(orgConfigTable).where(eq(orgConfigTable.organizationId, orgId)).limit(1);
  if (existing.length === 0) {
    await db.insert(orgConfigTable).values({ organizationId: orgId, ...updateData });
  } else {
    await db.update(orgConfigTable).set(updateData).where(eq(orgConfigTable.organizationId, orgId));
  }
  res.json({ success: true });
});

// ─── Backup ───────────────────────────────────────────────────────────────────
router.get("/backup", async (req, res) => {
  const user = req.user!;
  const orgId = user.organizationId;

  let projectsFilter = await db.select().from(projectsTable);
  if (!isSystemOwner(user) && orgId) {
    projectsFilter = projectsFilter.filter(p => p.organizationId === orgId);
  }
  const projectIds = new Set(projectsFilter.map(p => p.id));

  const [allUsers, allOrgs, allDocuments, allCorrespondence, allTransmittals, allTasks] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(organizationsTable),
    db.select().from(documentsTable),
    db.select().from(correspondenceTable),
    db.select().from(transmittalsTable),
    db.select().from(tasksTable),
  ]);

  const scopeByProject = (rows: any[]) => rows.filter(r => !r.projectId || projectIds.has(r.projectId));

  const safeUsers = (isSystemOwner(user) ? allUsers : allUsers.filter(u => u.organizationId === orgId))
    .map(({ passwordHash, ...u }: any) => u);

  const backup = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    organizationId: orgId ?? null,
    tables: {
      users: safeUsers,
      organizations: isSystemOwner(user) ? allOrgs : allOrgs.filter(o => o.id === orgId),
      projects: projectsFilter,
      documents: scopeByProject(allDocuments),
      correspondence: scopeByProject(allCorrespondence),
      transmittals: scopeByProject(allTransmittals),
      tasks: scopeByProject(allTasks),
    },
  };

  backup.tables.meta = {
    counts: Object.fromEntries(Object.entries(backup.tables).filter(([k]) => Array.isArray(backup.tables[k])).map(([k, v]) => [k, (v as any[]).length])),
  } as any;

  const filename = `edms-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(backup);
});

// ─── Restore validation (dry-run) ─────────────────────────────────────────────
router.post("/restore/validate", async (req, res) => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { backup } = req.body ?? {};
  if (!backup || !backup.version || !backup.tables) {
    res.status(400).json({ error: "Invalid backup format. Expected {version, exportedAt, tables}." });
    return;
  }
  const tables = Object.keys(backup.tables).filter(k => Array.isArray(backup.tables[k]));
  const counts = Object.fromEntries(tables.map(t => [t, backup.tables[t].length]));
  res.json({
    valid: true,
    exportedAt: backup.exportedAt,
    version: backup.version,
    organizationId: backup.organizationId ?? null,
    tables,
    counts,
  });
});

// ─── Restore (actual) ─────────────────────────────────────────────────────────
router.post("/restore", async (req, res) => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden — system owner required" }); return; }

  const { backup, confirmed } = req.body ?? {};
  if (!backup || !backup.version || !backup.tables) {
    res.status(400).json({ error: "Invalid backup format" }); return;
  }
  if (!confirmed) {
    res.status(400).json({ error: "Restore not confirmed. Pass confirmed: true to proceed." }); return;
  }

  const restored: Record<string, number> = {};

  try {
    if (Array.isArray(backup.tables.organizations) && backup.tables.organizations.length > 0) {
      for (const org of backup.tables.organizations) {
        await db.insert(organizationsTable).values(org).onConflictDoUpdate({ target: organizationsTable.id, set: { name: org.name, type: org.type, updatedAt: new Date() } });
      }
      restored.organizations = backup.tables.organizations.length;
    }

    if (Array.isArray(backup.tables.projects) && backup.tables.projects.length > 0) {
      for (const project of backup.tables.projects) {
        await db.insert(projectsTable).values(project).onConflictDoUpdate({ target: projectsTable.id, set: { name: project.name, status: project.status, updatedAt: new Date() } });
      }
      restored.projects = backup.tables.projects.length;
    }

    if (Array.isArray(backup.tables.documents) && backup.tables.documents.length > 0) {
      for (const doc of backup.tables.documents) {
        await db.insert(documentsTable).values(doc).onConflictDoUpdate({ target: documentsTable.id, set: { title: doc.title, status: doc.status, updatedAt: new Date() } });
      }
      restored.documents = backup.tables.documents.length;
    }

    if (Array.isArray(backup.tables.tasks) && backup.tables.tasks.length > 0) {
      for (const task of backup.tables.tasks) {
        await db.insert(tasksTable).values(task).onConflictDoUpdate({ target: tasksTable.id, set: { title: task.title, status: task.status, updatedAt: new Date() } });
      }
      restored.tasks = backup.tables.tasks.length;
    }

    res.json({ success: true, restored, message: "Restore completed successfully." });
  } catch (err: any) {
    res.status(500).json({ error: "Restore failed", message: err.message });
  }
});

// ─── Test Data Seed ────────────────────────────────────────────────────────────
router.post("/seed-test-data", requireRole("admin", "system_owner"), async (req, res) => {
  const userId = req.user!.id;
  const orgId  = req.user!.organizationId;

  // Get first available project in org
  const projs = await db
    .select({ id: projectsTable.id, name: projectsTable.name, code: projectsTable.code })
    .from(projectsTable)
    .where(orgId ? eq(projectsTable.organizationId, orgId) : sql`1=1`)
    .limit(1);

  if (projs.length === 0) {
    return res.status(400).json({ error: "No projects found. Create a project first." });
  }
  const project = projs[0];
  const pid = project.id;
  const now = new Date();

  const pad = (n: number, w = 4) => String(n).padStart(w, "0");
  const ts  = Date.now();

  const created: Record<string, number> = {};

  // ── Documents (3 regular + 3 drawings) ──────────────────────────────────────
  const docData = [
    { documentNumber: `DOC-${pad(ts % 10000)}-01`, title: "Foundation Design Basis Report", documentType: "report", discipline: "Civil", revision: "A", status: "under_review", description: "Structural foundation design basis for Phase 1" },
    { documentNumber: `DOC-${pad(ts % 10000)}-02`, title: "Mechanical Equipment List Rev B", documentType: "schedule", discipline: "Mechanical", revision: "B", status: "approved", description: "Complete equipment list with specifications" },
    { documentNumber: `DOC-${pad(ts % 10000)}-03`, title: "HSE Management Plan", documentType: "procedure", discipline: "HSE", revision: "C", status: "issued", description: "Health, Safety and Environment management plan" },
    { documentNumber: `DWG-${pad(ts % 10000)}-01`, title: "Site Layout & Grading Plan", documentType: "drawing", discipline: "Civil", revision: "A", status: "under_review", description: "Overall site layout with grading details" },
    { documentNumber: `DWG-${pad(ts % 10000)}-02`, title: "Piping & Instrumentation Diagram", documentType: "drawing", discipline: "Process", revision: "B", status: "approved", description: "P&ID for main processing unit" },
    { documentNumber: `DWG-${pad(ts % 10000)}-03`, title: "Structural Steel Detail Drawing", documentType: "drawing", discipline: "Structural", revision: "A", status: "issued", description: "Connection details for main steel structure" },
  ];

  const docs: any[] = [];
  for (const d of docData) {
    const [doc] = await db.insert(documentsTable).values({
      ...d,
      projectId: pid,
      createdById: userId,
      fileUrl: "https://placehold.co/600x800/png",
      fileName: `${d.documentNumber}.pdf`,
      fileSize: 1024 * (100 + Math.floor(Math.random() * 900)),
    } as any).returning();
    docs.push(doc);
  }
  created.documents = docs.length;

  // ── Correspondence (3 with 1 reply each) ────────────────────────────────────
  const corrData = [
    { subject: "Request for Information – Foundation Anchor Bolts", type: "rfi", priority: "high", body: "We require clarification on the anchor bolt specifications for the main equipment foundations as detailed in DWG-001. Please provide the grade, diameter and embedment depth at the earliest.", status: "sent", folder: "sent", referenceNumber: `RFI-${pad(ts % 10000)}-01` },
    { subject: "Transmittal Cover – P&ID Revision B Issue", type: "memo", priority: "medium", body: "Please find attached the updated P&ID documents for your review and comment. All major revisions are highlighted in the revision block. Comments required within 14 days.", status: "read", folder: "inbox", referenceNumber: `MEM-${pad(ts % 10000)}-01` },
    { subject: "Notice of Non-Conformance – Concrete Batch Report Deviation", type: "notice", priority: "urgent", body: "It has been identified that concrete batch reports for pour event CE-042 show compressive strength below the specified 30 MPa at 28-day test. Immediate corrective action plan required.", status: "responded", folder: "inbox", referenceNumber: `NTC-${pad(ts % 10000)}-01` },
  ];

  const corrs: any[] = [];
  for (const c of corrData) {
    const [corr] = await db.insert(correspondenceTable).values({
      ...c,
      projectId: pid,
      fromUserId: userId,
      sentAt: new Date(),
    } as any).returning();
    corrs.push(corr);

    // Add one reply
    await db.insert(correspondenceTable).values({
      subject: `Re: ${c.subject}`,
      type: c.type as any,
      body: `Thank you for your correspondence. We have reviewed the matter and will provide a detailed response within 5 working days. Our team is currently assessing the technical aspects of your query.`,
      priority: "medium" as any,
      status: "sent" as any,
      folder: "sent" as any,
      parentId: corr.id,
      projectId: pid,
      fromUserId: userId,
      referenceNumber: `${c.referenceNumber}-RPL`,
      sentAt: new Date(),
    } as any);
  }
  created.correspondence = corrs.length;
  created.correspondenceReplies = corrs.length;

  // ── Transmittals (3) ─────────────────────────────────────────────────────────
  const txData = [
    { transmittalNumber: `TRM-${pad(ts % 10000)}-01`, subject: "Structural Drawings – Rev A Issue", purpose: "for_approval", status: "draft" },
    { transmittalNumber: `TRM-${pad(ts % 10000)}-02`, subject: "Vendor Documents – Pump Manufacturer", purpose: "for_information", status: "sent" },
    { transmittalNumber: `TRM-${pad(ts % 10000)}-03`, subject: "As-Built Drawings – Civil Works", purpose: "for_record", status: "acknowledged" },
  ];

  for (const t of txData) {
    await db.insert(transmittalsTable).values({
      ...t,
      projectId: pid,
      createdById: userId,
      sentAt: new Date(),
    } as any);
  }
  created.transmittals = txData.length;

  // ── NCR Records (3) ──────────────────────────────────────────────────────────
  const ncrData = [
    { reportNumber: `NCR-${pad(ts % 10000)}-01`, type: "ncr", status: "open", description: "Concrete pour for footing F-12 conducted without approved mix design in place", raisedBy: "QC Inspector", correctiveAction: "Stop work on adjacent footings pending investigation" },
    { reportNumber: `NCR-${pad(ts % 10000)}-02`, type: "ncr", status: "in_progress", description: "Structural steel fabrication dimensions deviate from drawing tolerances by +8mm", raisedBy: "Site Engineer", correctiveAction: "Vendor to review and re-fabricate affected members" },
    { reportNumber: `NCR-${pad(ts % 10000)}-03`, type: "sor", status: "closed", description: "Weld inspection records not filed within required 24-hour window", raisedBy: "Document Controller", correctiveAction: "Retrospective filing completed; procedure updated to prevent recurrence" },
  ];

  for (const n of ncrData) {
    await db.insert(ncrRecordsTable).values({
      ...n,
      projectId: pid,
      createdById: userId,
    } as any);
  }
  created.ncr = ncrData.length;

  // ── ITR Records (3) ──────────────────────────────────────────────────────────
  const itrData = [
    { requestNumber: `ITR-${pad(ts % 10000)}-01`, type: "itr", status: "pending", description: "Inspection of rebar placement and cover before concrete pour – Grid B1-C3", contractor: "Al Farabi Construction", location: "Block B, Level 1" },
    { requestNumber: `ITR-${pad(ts % 10000)}-02`, type: "itr", status: "passed", description: "Pressure test inspection – Fire suppression loop Zone A", contractor: "Gulf MEP Solutions", location: "Zone A, Plant Room" },
    { requestNumber: `ITR-${pad(ts % 10000)}-03`, type: "itr", status: "failed", description: "Painting DFT inspection – Tank T-02 external surface", contractor: "Surface Pro Coatings", location: "Tank Farm Area" },
  ];

  for (const i of itrData) {
    await db.insert(inspectionRequestsTable).values({
      ...i,
      projectId: pid,
      createdById: userId,
      date: new Date(),
    } as any);
  }
  created.itr = itrData.length;

  // ── NOC Records (3) ──────────────────────────────────────────────────────────
  const nocData = [
    { nocNumber: `NOC-${pad(ts % 10000)}-01`, authority: "Municipality – Building Permits", status: "approved", remarks: "NOC for foundation works approved by municipality. Valid for 180 days." },
    { nocNumber: `NOC-${pad(ts % 10000)}-02`, authority: "Civil Defence – Fire Safety", status: "pending", remarks: "Awaiting final inspection from Civil Defence for fire safety clearance." },
    { nocNumber: `NOC-${pad(ts % 10000)}-03`, authority: "Utility Provider – MEW", status: "rejected", remarks: "NOC rejected due to insufficient clearance from HV cable route. Resubmission required." },
  ];

  for (const n of nocData) {
    await db.insert(nocRecordsTable).values({
      ...n,
      projectId: pid,
      createdById: userId,
      date: new Date(),
    } as any);
  }
  created.noc = nocData.length;

  // ── Deliverables (3) ─────────────────────────────────────────────────────────
  const dlvData = [
    { deliverableId: `DLV-${pad(ts % 10000)}-01`, title: "Preliminary Engineering Report", type: "document", status: "approved", responsible: "Lead Engineer", plannedDate: new Date(now.getTime() - 30*864e5) },
    { deliverableId: `DLV-${pad(ts % 10000)}-02`, title: "Detailed Design Drawings Package", type: "drawing", status: "in_progress", responsible: "Design Team", plannedDate: new Date(now.getTime() + 30*864e5) },
    { deliverableId: `DLV-${pad(ts % 10000)}-03`, title: "As-Built Documentation Dossier", type: "document", status: "not_started", responsible: "Document Controller", plannedDate: new Date(now.getTime() + 90*864e5) },
  ];

  for (const d of dlvData) {
    await db.insert(deliverablesTable).values({
      ...d,
      projectId: pid,
      createdById: userId,
    } as any);
  }
  created.deliverables = dlvData.length;

  // ── Meetings (3) ─────────────────────────────────────────────────────────────
  const mtgData = [
    { title: "Weekly Progress Review Meeting", status: "completed", meetingDate: new Date(now.getTime() - 7*864e5), duration: 60, location: "Conference Room A", agenda: "1. Review weekly progress against baseline\n2. Identify blockers and remediation actions\n3. HSE updates\n4. AOB", referenceNumber: `MOM-${pad(ts % 10000)}-01` },
    { title: "Technical Coordination Meeting – Civil/Structural Interface", status: "scheduled", meetingDate: new Date(now.getTime() + 2*864e5), duration: 90, location: "Teams Video Call", agenda: "1. Review structural interface points\n2. Confirm hold points for upcoming inspections\n3. Clash resolution matrix review", referenceNumber: `MOM-${pad(ts % 10000)}-02` },
    { title: "Vendor Kick-Off Meeting – Mechanical Package", status: "scheduled", meetingDate: new Date(now.getTime() + 14*864e5), duration: 120, location: "Client Office – Boardroom", agenda: "1. Vendor document submission schedule\n2. Quality plan approval\n3. Factory acceptance test dates\n4. Expediting schedule", referenceNumber: `MOM-${pad(ts % 10000)}-03` },
  ];

  for (const m of mtgData) {
    await db.insert(meetingsTable).values({
      ...m,
      projectId: pid,
      organizedById: userId,
    } as any);
  }
  created.meetings = mtgData.length;

  res.json({
    success: true,
    message: `Test data created for project ${project.code} — ${project.name}`,
    created,
  });
});

// ─── Search / Elasticsearch ────────────────────────────────────────────────────
router.get("/search/status", async (req, res) => {
  const esUrl = process.env.ELASTICSEARCH_URL;
  if (!esUrl) {
    res.json({
      engine: "sql",
      configured: false,
      message: "ELASTICSEARCH_URL is not set. Using SQL full-text search fallback.",
      instructions: "Set ELASTICSEARCH_URL (e.g. http://localhost:9200) to enable Elasticsearch.",
    });
    return;
  }
  try {
    const { Client } = await import("@elastic/elasticsearch");
    const es = new Client({ node: esUrl });
    const info = await es.info();
    res.json({
      engine: "elasticsearch",
      configured: true,
      version: info.version?.number,
      url: esUrl,
      message: "Elasticsearch is active and responding.",
    });
  } catch (err: any) {
    res.status(503).json({
      engine: "sql",
      configured: false,
      url: esUrl,
      message: `Elasticsearch unreachable: ${err.message}. Falling back to SQL.`,
    });
  }
});

router.post("/search/reindex", requireRole("admin", "system_owner"), async (req, res) => {
  try {
    const { reindexAll } = await import("../lib/search-service.js");
    const result = await reindexAll();
    if (result.indexed === 0 && result.errors === 0) {
      res.json({ success: false, message: "Elasticsearch is not configured. Set ELASTICSEARCH_URL to enable indexing." });
      return;
    }
    res.json({ success: true, ...result, message: `Indexed ${result.indexed} documents (${result.errors} errors).` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── AI Classification toggle ──────────────────────────────────────────────────

router.get("/ai-classification", requireAuth, async (req, res) => {
  try {
    const [row] = await db.select().from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "ai_classification_enabled"));
    const enabled = row ? row.value !== "false" : true;
    res.json({ enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/ai-classification", requireRole("admin", "system_owner"), async (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    const value = enabled ? "true" : "false";
    const existing = await db.select().from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "ai_classification_enabled"));
    if (existing.length > 0) {
      await db.update(systemSettingsTable)
        .set({ value, updatedAt: new Date() })
        .where(eq(systemSettingsTable.key, "ai_classification_enabled"));
    } else {
      await db.insert(systemSettingsTable)
        .values({ key: "ai_classification_enabled", value });
    }
    res.json({ enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Quota: per-org daily usage ─────────────────────────────────────────────

// GET /api/admin/ai-quota — sysadmin: quota for all orgs; org admin: own org only
router.get("/ai-quota", requireAuth, async (req, res) => {
  try {
    const user = req.user!;

    if (isSysAdmin(user)) {
      // Return quota summary for every org that has an org_config row
      const configs = await db
        .select({
          organizationId: orgConfigTable.organizationId,
          subscriptionTier: orgConfigTable.subscriptionTier,
          aiProvider: orgConfigTable.aiProvider,
          aiModel: orgConfigTable.aiModel,
          aiDailyLimit: orgConfigTable.aiDailyLimit,
        })
        .from(orgConfigTable);

      const quotas = await Promise.all(
        configs.map(async (cfg) => ({
          organizationId: cfg.organizationId,
          subscriptionTier: cfg.subscriptionTier,
          quota: await getOrgAiQuota(cfg.organizationId),
        }))
      );
      return res.json({ quotas });
    }

    // Non-sysadmin: own org only
    if (!user.organizationId) return res.status(403).json({ error: "No organization" });
    const quota = await getOrgAiQuota(user.organizationId);
    return res.json({ organizationId: user.organizationId, quota });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Subscription tier — preset AI config bundles ─────────────────────────────

// PUT /api/admin/ai-tier/:orgId — apply a subscription tier to an org (sysadmin only)
router.put("/ai-tier/:orgId", requireRole("admin", "system_owner"), async (req, res) => {
  if (!isSystemOwner(req.user!)) return res.status(403).json({ error: "System owner access required" });

  const orgId = parseInt(req.params.orgId);
  const { tier } = req.body as { tier: SubscriptionTier };

  if (!tier || !(tier in SUBSCRIPTION_TIERS)) {
    return res.status(400).json({
      error: "Invalid tier",
      validTiers: Object.keys(SUBSCRIPTION_TIERS),
      tiers: SUBSCRIPTION_TIERS,
    });
  }

  const preset = SUBSCRIPTION_TIERS[tier];

  const existing = await db.select().from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, orgId)).limit(1);

  const update = {
    subscriptionTier:    tier,
    aiProvider:          preset.aiProvider,
    aiModel:             preset.aiModel,
    aiDailyLimit:        preset.aiDailyLimit,
    updatedAt:           new Date(),
  };

  if (existing.length === 0) {
    await db.insert(orgConfigTable).values({ organizationId: orgId, ...update });
  } else {
    await db.update(orgConfigTable).set(update).where(eq(orgConfigTable.organizationId, orgId));
  }

  res.json({ organizationId: orgId, tier, applied: preset });
});

// ─── Per-org AI usage limits ──────────────────────────────────────────────────

/**
 * PUT /api/admin/ai-limits/:orgId
 * Set custom per-org AI usage limits without changing the subscription tier.
 * Body: { aiDailyLimit?: number, aiMonthlyTokenLimit?: number }
 * Both values are optional; 0 means unlimited.
 */
router.put("/ai-limits/:orgId", requireRole("admin", "system_owner"), async (req, res) => {
  if (!isSystemOwner(req.user!)) return res.status(403).json({ error: "System owner access required" });

  const orgId = parseInt(req.params.orgId);
  if (isNaN(orgId)) return res.status(400).json({ error: "Invalid orgId" });

  const { aiDailyLimit, aiMonthlyTokenLimit } = req.body as {
    aiDailyLimit?: number;
    aiMonthlyTokenLimit?: number;
  };

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (aiDailyLimit       !== undefined) update.aiDailyLimit       = Math.max(0, Number(aiDailyLimit));
  if (aiMonthlyTokenLimit !== undefined) update.aiMonthlyTokenLimit = Math.max(0, Number(aiMonthlyTokenLimit));

  if (Object.keys(update).length === 1) {
    return res.status(400).json({ error: "Provide at least one of: aiDailyLimit, aiMonthlyTokenLimit" });
  }

  const existing = await db.select().from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, orgId)).limit(1);

  if (existing.length === 0) {
    await db.insert(orgConfigTable).values({ organizationId: orgId, ...update });
  } else {
    await db.update(orgConfigTable).set(update).where(eq(orgConfigTable.organizationId, orgId));
  }

  const quota = await getOrgAiQuota(orgId);
  res.json({ organizationId: orgId, limits: { aiDailyLimit: quota.dailyLimit, aiMonthlyTokenLimit: quota.monthlyTokenLimit } });
});

// ─── Plan Management ──────────────────────────────────────────────────────────

router.get("/org-plans", async (req, res) => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db
    .select({
      orgId: organizationsTable.id,
      orgName: organizationsTable.name,
      planId: sql<string>`COALESCE(${subscriptionsTable.planId}, ${organizationsTable.subscriptionTier}, 'free')`,
    })
    .from(organizationsTable)
    .leftJoin(subscriptionsTable, eq(subscriptionsTable.organizationId, organizationsTable.id));
  res.json({ plans: rows });
});

router.post("/organizations/:orgId/change-plan", async (req, res) => {
  if (!isSystemOwner(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  const orgId = parseInt(req.params.orgId);
  const { planId } = req.body as { planId: string };
  if (!planId) { res.status(400).json({ error: "planId is required" }); return; }
  const validPlanIds = ["free", ...PLANS.map(p => p.id)];
  if (!validPlanIds.includes(planId)) { res.status(400).json({ error: "Invalid planId" }); return; }
  const [org] = await db.select({ id: organizationsTable.id }).from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
  await db.insert(subscriptionsTable)
    .values({ organizationId: orgId, planId, status: "active" })
    .onConflictDoUpdate({
      target: subscriptionsTable.organizationId,
      set: { planId, status: "active", updatedAt: new Date() },
    });
  await syncOrgModules(orgId);
  res.json({ ok: true, orgId, planId });
});

// ─── Access Shadow Log ─────────────────────────────────────────────────────────
// Returns recent divergence records from the access_shadow_log table.
// Only accessible to system_owner or admin.
router.get("/shadow-log", async (req, res) => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const divergeOnly = req.query.divergeOnly !== "false";
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);

    const rows = await db
      .select({
        id: accessShadowLogTable.id,
        documentId: accessShadowLogTable.documentId,
        userId: accessShadowLogTable.userId,
        userRole: accessShadowLogTable.userRole,
        projectId: accessShadowLogTable.projectId,
        systemAllowed: accessShadowLogTable.systemAllowed,
        resolverAllowed: accessShadowLogTable.resolverAllowed,
        resolverReasons: accessShadowLogTable.resolverReasons,
        rulePath: accessShadowLogTable.rulePath,
        diverges: accessShadowLogTable.diverges,
        userDeptIds: accessShadowLogTable.userDeptIds,
        docDeptIds: accessShadowLogTable.docDeptIds,
        hasConfidential: accessShadowLogTable.hasConfidential,
        hasDenyRule: accessShadowLogTable.hasDenyRule,
        hasWorkflowGrant: accessShadowLogTable.hasWorkflowGrant,
        evaluatedAt: accessShadowLogTable.evaluatedAt,
        userName: usersTable.name,
        userEmail: usersTable.email,
        documentTitle: documentsTable.title,
        documentNumber: documentsTable.documentNumber,
      })
      .from(accessShadowLogTable)
      .leftJoin(usersTable, eq(accessShadowLogTable.userId, usersTable.id))
      .leftJoin(documentsTable, eq(accessShadowLogTable.documentId, documentsTable.id))
      .where(divergeOnly ? eq(accessShadowLogTable.diverges, true) : undefined)
      .orderBy(desc(accessShadowLogTable.evaluatedAt))
      .limit(limit);

    const total = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accessShadowLogTable)
      .where(divergeOnly ? eq(accessShadowLogTable.diverges, true) : undefined);

    res.json({ rows, total: total[0]?.count ?? 0, divergeOnly, limit });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch shadow log" });
  }
});

export default router;

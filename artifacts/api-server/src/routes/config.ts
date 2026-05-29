import { Router } from "express";
import { db } from "@workspace/db";
import { orgConfigTable, systemSettingsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, isSystemOwner } from "../lib/auth.js";
import { requireMinRole, requireSysOwner } from "../middlewares/require-role.js";

const router = Router();

const SYSTEM_DEFAULTS: Record<string, string> = {
  registrationEnabled: "true",
};

async function getSystemSetting(key: string): Promise<string> {
  const [row] = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key));
  return row?.value ?? SYSTEM_DEFAULTS[key] ?? "true";
}

router.get("/system-settings", async (_req, res): Promise<void> => {
  const registrationEnabled = await getSystemSetting("registrationEnabled");
  res.json({ registrationEnabled: registrationEnabled === "true" });
});

// Public: list organizations for the registration form (only when registration is enabled)
router.get("/organizations-public", async (_req, res): Promise<void> => {
  const registrationEnabled = await getSystemSetting("registrationEnabled");
  if (registrationEnabled !== "true") {
    res.json({ organizations: [] });
    return;
  }
  const orgs = await db.select({
    id: organizationsTable.id,
    name: organizationsTable.name,
  }).from(organizationsTable).orderBy(organizationsTable.name);
  res.json({ organizations: orgs });
});

router.put("/system-settings", requireAuth, requireSysOwner, async (req, res): Promise<void> => {
  const { registrationEnabled } = req.body ?? {};
  if (typeof registrationEnabled === "boolean") {
    const value = registrationEnabled ? "true" : "false";
    const existing = await db.select().from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "registrationEnabled"));
    if (existing.length > 0) {
      await db.update(systemSettingsTable).set({ value, updatedAt: new Date() })
        .where(eq(systemSettingsTable.key, "registrationEnabled"));
    } else {
      await db.insert(systemSettingsTable).values({ key: "registrationEnabled", value });
    }
  }
  res.json({ registrationEnabled: (await getSystemSetting("registrationEnabled")) === "true" });
});

router.use(requireAuth);

router.get("/", async (req, res): Promise<void> => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.json(getDefaultConfig());
    return;
  }
  const [config] = await db.select().from(orgConfigTable).where(eq(orgConfigTable.organizationId, orgId));
  if (!config) {
    res.json(getDefaultConfig());
    return;
  }
  res.json(config);
});

// ─── AI Governance (admin / system_owner only) ────────────────────────────────
// Enables or disables AI for an organization and sets the AI plan tier.
// system_owner may additionally pass ?orgOverride=<id> to target any org.
router.get("/ai-governance", requireMinRole("admin"), async (req, res): Promise<void> => {
  const user = req.user!;
  const orgId = user.organizationId;
  if (!orgId) { res.status(400).json({ error: "No organization" }); return; }

  const [config] = await db
    .select({
      aiEnabled: orgConfigTable.aiEnabled,
      aiPlan: orgConfigTable.aiPlan,
      aiMonthlyLimit: orgConfigTable.aiMonthlyLimit,
      aiDailyLimit: orgConfigTable.aiDailyLimit,
      aiMonthlyTokenLimit: orgConfigTable.aiMonthlyTokenLimit,
      aiPrivacyMode: orgConfigTable.aiPrivacyMode,
    })
    .from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, orgId));

  if (!config) { res.status(404).json({ error: "No org config found" }); return; }
  res.json(config);
});

router.put("/ai-governance", requireMinRole("admin"), async (req, res): Promise<void> => {
  const user = req.user!;
  const orgId = user.organizationId;
  if (!orgId) { res.status(400).json({ error: "No organization" }); return; }

  const {
    aiEnabled,
    aiPlan,
    aiMonthlyLimit,
    aiPrivacyMode,
  } = req.body ?? {};

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof aiEnabled === "boolean") updates.aiEnabled = aiEnabled;
  if (typeof aiPlan === "string" && ["disabled", "basic", "premium"].includes(aiPlan)) {
    updates.aiPlan = aiPlan;
    // Keep aiEnabled in sync with aiPlan
    if (aiPlan === "disabled") updates.aiEnabled = false;
    if ((aiPlan === "basic" || aiPlan === "premium") && typeof aiEnabled !== "boolean") {
      updates.aiEnabled = true;
    }
  }
  if (typeof aiMonthlyLimit === "number" && aiMonthlyLimit >= 0) updates.aiMonthlyLimit = aiMonthlyLimit;
  if (typeof aiPrivacyMode === "boolean") updates.aiPrivacyMode = aiPrivacyMode;

  const [updated] = await db
    .update(orgConfigTable)
    .set(updates)
    .where(eq(orgConfigTable.organizationId, orgId))
    .returning({
      aiEnabled: orgConfigTable.aiEnabled,
      aiPlan: orgConfigTable.aiPlan,
      aiMonthlyLimit: orgConfigTable.aiMonthlyLimit,
      aiPrivacyMode: orgConfigTable.aiPrivacyMode,
    });

  if (!updated) { res.status(404).json({ error: "No org config found" }); return; }
  res.json(updated);
});

router.put("/", requireMinRole("admin"), async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  if (!orgId) { res.status(400).json({ error: "No organization" }); return; }

  const {
    documentNumberingFormat, disciplines, documentTypes,
    revisionFormat, workflowTemplates, transmittalPrefix,
    rfiPrefix, submittalPrefix, ncrPrefix, slaDefaults,
    systemName, logoUrl, primaryColor,
  } = req.body;

  const existing = await db.select().from(orgConfigTable).where(eq(orgConfigTable.organizationId, orgId));
  if (existing.length > 0) {
    const [config] = await db.update(orgConfigTable)
      .set({
        documentNumberingFormat, disciplines, documentTypes, revisionFormat,
        workflowTemplates, transmittalPrefix, rfiPrefix, submittalPrefix,
        ncrPrefix, slaDefaults,
        ...(systemName !== undefined && { systemName }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(primaryColor !== undefined && { primaryColor }),
        updatedAt: new Date(),
      })
      .where(eq(orgConfigTable.organizationId, orgId))
      .returning();
    res.json(config);
  } else {
    const [config] = await db.insert(orgConfigTable).values({
      organizationId: orgId,
      documentNumberingFormat, disciplines, documentTypes, revisionFormat,
      workflowTemplates, transmittalPrefix, rfiPrefix, submittalPrefix,
      ncrPrefix, slaDefaults,
      systemName: systemName ?? "ArcScale EDMS",
      logoUrl: logoUrl ?? null,
      primaryColor: primaryColor ?? "#2563eb",
    }).returning();
    res.status(201).json(config);
  }
});

router.get("/public", async (_req, res): Promise<void> => {
  const configs = await db.select({
    systemName: orgConfigTable.systemName,
    logoUrl: orgConfigTable.logoUrl,
    primaryColor: orgConfigTable.primaryColor,
  }).from(orgConfigTable).limit(1);
  if (configs.length > 0) {
    res.json(configs[0]);
  } else {
    res.json({ systemName: "ArcScale EDMS", logoUrl: null, primaryColor: "#2563eb" });
  }
});

function getDefaultConfig() {
  return {
    documentNumberingFormat: "{PROJECT}-{DISCIPLINE}-{TYPE}-{SEQ}",
    disciplines: ["Civil", "Structural", "Mechanical", "Electrical", "Piping", "Instrumentation", "HVAC", "Fire Protection", "Architectural", "General"],
    documentTypes: ["Drawing", "Specification", "Report", "Procedure", "Datasheet", "Certificate", "Memo", "Letter", "Method Statement", "ITP"],
    revisionFormat: "numeric",
    workflowTemplates: [
      { id: "standard", name: "Standard Approval", steps: ["Review", "Check", "Approve"], type: "sequential" },
      { id: "expedited", name: "Expedited Review", steps: ["Review", "Approve"], type: "sequential" },
      { id: "parallel", name: "Parallel Review", steps: ["Review", "Approve"], type: "parallel" },
    ],
    transmittalPrefix: "TRS",
    rfiPrefix: "RFI",
    submittalPrefix: "SUB",
    ncrPrefix: "NCR",
    slaDefaults: { rfi: 7, submittal: 14, transmittal: 5, ncr: 14 },
  };
}

export default router;

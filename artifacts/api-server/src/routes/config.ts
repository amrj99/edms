import { Router } from "express";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
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

router.put("/", async (req, res) => {
  const orgId = req.user?.organizationId;
  if (!orgId) { res.status(400).json({ error: "No organization" }); return; }
  if (req.user?.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const {
    documentNumberingFormat, disciplines, documentTypes,
    revisionFormat, workflowTemplates, transmittalPrefix,
    rfiPrefix, submittalPrefix, ncrPrefix, slaDefaults
  } = req.body;

  const existing = await db.select().from(orgConfigTable).where(eq(orgConfigTable.organizationId, orgId));
  if (existing.length > 0) {
    const [config] = await db.update(orgConfigTable)
      .set({
        documentNumberingFormat, disciplines, documentTypes, revisionFormat,
        workflowTemplates, transmittalPrefix, rfiPrefix, submittalPrefix,
        ncrPrefix, slaDefaults, updatedAt: new Date(),
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
    }).returning();
    res.status(201).json(config);
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

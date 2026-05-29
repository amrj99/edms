import { Router } from "express";
import { db } from "@workspace/db";
import { orgConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";

const router = Router();
router.use(requireAuth);

export interface OrgModules {
  dashboard: boolean;
  deliverables: boolean;
  registers: boolean;
  notifications: boolean;
  chat: boolean;
}

const DEFAULT_MODULES: OrgModules = {
  dashboard: true,
  deliverables: true,
  registers: true,
  notifications: true,
  chat: true,
};

function mergeModules(raw: unknown): OrgModules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MODULES };
  const obj = raw as Record<string, unknown>;
  return {
    dashboard: obj.dashboard !== false,
    deliverables: obj.deliverables !== false,
    registers: obj.registers !== false,
    notifications: obj.notifications !== false,
    chat: obj.chat !== false,
  };
}

async function getModulesForOrg(orgId: number): Promise<OrgModules> {
  const [config] = await db.select({ modules: orgConfigTable.modules })
    .from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, orgId));
  if (!config) return { ...DEFAULT_MODULES };
  return mergeModules(config.modules);
}

async function setModulesForOrg(orgId: number, modules: OrgModules): Promise<OrgModules> {
  const [existing] = await db.select({ id: orgConfigTable.id })
    .from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, orgId));

  if (existing) {
    const [updated] = await db.update(orgConfigTable)
      .set({ modules, updatedAt: new Date() })
      .where(eq(orgConfigTable.organizationId, orgId))
      .returning({ modules: orgConfigTable.modules });
    return mergeModules(updated?.modules);
  } else {
    const [inserted] = await db.insert(orgConfigTable)
      .values({ organizationId: orgId, modules })
      .returning({ modules: orgConfigTable.modules });
    return mergeModules(inserted?.modules);
  }
}

function parseOrgIdParam(raw: unknown): number | null {
  if (!raw) return null;
  const n = parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get("/", async (req, res): Promise<void> => {
  const role = req.user?.role;
  const isSysOwner = role === "system_owner";

  const orgIdParam = parseOrgIdParam(req.query.orgId);

  if (req.query.orgId && orgIdParam === null) {
    res.status(400).json({ error: "Invalid orgId parameter" });
    return;
  }

  if (orgIdParam && !isSysOwner) {
    res.status(403).json({ error: "Only system owners can query modules for other organizations" });
    return;
  }

  const orgId = orgIdParam ?? req.user?.organizationId;
  if (!orgId) {
    res.json({ modules: { ...DEFAULT_MODULES } });
    return;
  }

  const modules = await getModulesForOrg(orgId);
  res.json({ modules });
});

router.put("/", requireRole("admin", "system_owner"), async (req, res): Promise<void> => {
  const role = req.user?.role;
  const isSysOwner = role === "system_owner";

  const orgIdParam = parseOrgIdParam(req.query.orgId);

  if (req.query.orgId && orgIdParam === null) {
    res.status(400).json({ error: "Invalid orgId parameter" });
    return;
  }

  if (orgIdParam && !isSysOwner) {
    res.status(403).json({ error: "Only system owners can update modules for other organizations" });
    return;
  }

  const orgId = orgIdParam ?? req.user?.organizationId;
  if (!orgId) {
    res.status(400).json({ error: "No organization" });
    return;
  }

  const { modules: raw } = req.body;
  if (!raw || typeof raw !== "object") {
    res.status(400).json({ error: "modules object required" });
    return;
  }

  const modules = mergeModules(raw);
  const updated = await setModulesForOrg(orgId, modules);
  res.json({ modules: updated });
});

export default router;

import { Router, type IRouter } from "express";
import { statfsSync } from "node:fs";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

type CheckStatus = "ok" | "warn" | "critical" | "error";

interface DiskCheck {
  status: CheckStatus;
  path: string;
  usedPercent?: number;
  availableGb?: number;
  totalGb?: number;
  error?: string;
}

interface DatabaseCheck {
  status: "ok" | "error";
  latencyMs: number;
}

function getThresholds(): { warn: number; crit: number } {
  const warn = Number(process.env.WARN_THRESHOLD ?? 75);
  const crit = Number(process.env.CRIT_THRESHOLD ?? 90);
  return { warn: isNaN(warn) ? 75 : warn, crit: isNaN(crit) ? 90 : crit };
}

function checkDisk(path: string): DiskCheck {
  const { warn, crit } = getThresholds();
  try {
    const stats = statfsSync(path);
    const total = stats.blocks * stats.bsize;
    const available = stats.bavail * stats.bsize;
    const usedPercent = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
    const status: CheckStatus =
      usedPercent >= crit ? "critical" : usedPercent >= warn ? "warn" : "ok";
    return {
      status,
      path,
      usedPercent,
      availableGb: +(available / 1e9).toFixed(1),
      totalGb: +(total / 1e9).toFixed(1),
    };
  } catch {
    return { status: "error", path, error: "path unavailable" };
  }
}

async function checkDatabase(): Promise<DatabaseCheck> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch {
    return { status: "error", latencyMs: Date.now() - start };
  }
}

function computeOverallStatus(
  statuses: CheckStatus[],
): "ok" | "warn" | "critical" | "error" {
  if (statuses.some((s) => s === "error")) return "error";
  if (statuses.some((s) => s === "critical")) return "critical";
  if (statuses.some((s) => s === "warn")) return "warn";
  return "ok";
}

router.get("/health", async (_req, res): Promise<void> => {
  const uploadsPath = process.env.DEFAULT_STORAGE_PATH ?? "/app/uploads";

  const [dbCheck, diskCheck, uploadsCheck] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkDisk("/")),
    Promise.resolve(checkDisk(uploadsPath)),
  ]);

  const overallStatus = computeOverallStatus([
    dbCheck.status,
    diskCheck.status,
    uploadsCheck.status,
  ]);

  const httpStatus = overallStatus === "ok" || overallStatus === "warn" ? 200 : 503;

  res.status(httpStatus).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version || "1.0.0",
    environment: process.env.NODE_ENV || "development",
    database: dbCheck,
    disk: diskCheck,
    uploads: uploadsCheck,
  });
});

// Lightweight readiness probe — no dependency checks, used by Docker/load balancers.
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;

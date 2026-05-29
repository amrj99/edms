import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/health", async (_req, res): Promise<void> => {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      database: "connected",
      latencyMs: Date.now() - start,
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV || "development",
    });
  } catch {
    res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      latencyMs: Date.now() - start,
    });
  }
});

// Lightweight readiness probe (legacy)
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;

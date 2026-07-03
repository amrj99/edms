/**
 * health.test.ts — Sprint C-3: Health Disk Check
 *
 * Tests the /api/health endpoint with mocked disk (statfsSync) and DB.
 * The endpoint is public (registered before auth middleware in routes/index.ts).
 *
 * Mocking strategy:
 *   node:fs  → vi.mock intercepts statfsSync so we control disk usage %
 *   @workspace/db → vi.hoisted + Proxy intercepts db.execute so we can
 *                   simulate DB failure without touching the real connection
 *
 * Scenarios:
 *   1. All checks ok       → HTTP 200, status "ok"
 *   2. Disk warn (80%)     → HTTP 200, status "warn"
 *   3. Disk critical (95%) → HTTP 503, status "critical"
 *   4. Uploads unavailable → HTTP 503, status "error", uploads.error set
 *   5. Database down       → HTTP 503, status "error", database.status "error"
 *   6. Response shape      → all required fields present with correct types
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { statfsSync } from "node:fs";
import { api } from "./helpers/index.js";

// ── vi.hoisted: variables that must be available inside vi.mock factories ──────
// vi.mock calls are hoisted above imports; vi.hoisted runs at the same time,
// so variables initialised here ARE accessible inside vi.mock factories.
const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn().mockResolvedValue({ rows: [] }),
}));

// ── Mock node:fs ───────────────────────────────────────────────────────────────
// Replace statfsSync with a controllable vi.fn(); keep all other node:fs exports.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statfsSync: vi.fn() };
});

// ── Mock @workspace/db ─────────────────────────────────────────────────────────
// Wrap the real db in a Proxy that intercepts only "execute".
// All other methods (select, insert, etc.) pass through to the real db so
// that the app's startup routines continue to work during test setup.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const dbProxy = new Proxy(actual.db, {
    get(target, prop) {
      if (prop === "execute") return mockExecute;
      const val = Reflect.get(target, prop);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
  return { ...actual, db: dbProxy };
});

const mockStatfsSync = vi.mocked(statfsSync);

function fakeDisk(usedPercent: number) {
  const blocks = 100;
  const bsize = 1_000_000_000; // 1 GB per block → 100 GB total
  const bavail = Math.round(blocks * (1 - usedPercent / 100));
  return {
    blocks,
    bsize,
    bavail,
    bfree: bavail,
    files: 10_000,
    ffree: 8_000,
    type: 0,
    namemax: 255,
  } as unknown as ReturnType<typeof statfsSync>;
}

describe("GET /api/health", () => {
  beforeEach(() => {
    // Default: healthy disk (40% used) on all paths
    mockStatfsSync.mockReturnValue(fakeDisk(40));
    // Default: db.execute succeeds
    mockExecute.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and status ok when all checks pass", async () => {
    const res = await api().get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database.status).toBe("ok");
    expect(res.body.disk.status).toBe("ok");
    expect(res.body.uploads.status).toBe("ok");
  });

  it("returns 200 when disk is in warn range (75–90%)", async () => {
    mockStatfsSync.mockReturnValue(fakeDisk(80));

    const res = await api().get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("warn");
    expect(res.body.disk.status).toBe("warn");
  });

  it("returns 503 when disk is in critical range (≥90%)", async () => {
    mockStatfsSync.mockReturnValue(fakeDisk(95));

    const res = await api().get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("critical");
    expect(res.body.disk.status).toBe("critical");
  });

  it("returns 503 when uploads path is unavailable", async () => {
    // Root disk ok, uploads path throws (volume missing / wrong storage mode)
    mockStatfsSync.mockImplementation((path) => {
      if (path === "/") return fakeDisk(40);
      throw new Error("ENOENT: no such file or directory");
    });

    const res = await api().get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("error");
    expect(res.body.uploads.status).toBe("error");
    expect(res.body.uploads.error).toBe("path unavailable");
    expect(res.body.disk.status).toBe("ok");
  });

  it("returns 503 when database is unreachable", async () => {
    mockExecute.mockRejectedValueOnce(new Error("connection refused"));

    const res = await api().get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("error");
    expect(res.body.database.status).toBe("error");
    expect(typeof res.body.database.latencyMs).toBe("number");
  });

  it("response has all required fields with correct types", async () => {
    const res = await api().get("/api/health");

    expect(res.body).toMatchObject({
      status: expect.stringMatching(/^(ok|warn|critical|error)$/),
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      version: expect.any(String),
      environment: expect.any(String),
      database: {
        status: expect.stringMatching(/^(ok|error)$/),
        latencyMs: expect.any(Number),
      },
      disk: {
        status: expect.stringMatching(/^(ok|warn|critical|error)$/),
        path: "/",
        usedPercent: expect.any(Number),
        availableGb: expect.any(Number),
        totalGb: expect.any(Number),
      },
      uploads: {
        status: expect.stringMatching(/^(ok|warn|critical|error)$/),
        usedPercent: expect.any(Number),
        availableGb: expect.any(Number),
        totalGb: expect.any(Number),
      },
    });
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});

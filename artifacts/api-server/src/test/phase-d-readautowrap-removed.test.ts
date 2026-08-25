/**
 * phase-d-readautowrap-removed.test.ts — DEBT-010 Phase D final gate (static + runtime).
 *
 * Phase D replaced the transitional request-spanning read auto-wrapper with
 * explicit short tenant read units-of-work (tenantRead()/withTenant()) in every
 * GET/HEAD handler, then DELETED the wrapper. This gate makes that state permanent:
 *
 *   1. No PRODUCTION source (routes/middlewares/lib) references the auto-wrapper
 *      (readAutoWrap / makeReadAutoWrap / getAutoWrappedReadInventory).
 *   2. tenant-scope.ts no longer defines the wrapper, and tenantScoped() no longer
 *      accepts a `skipRead` option (nothing mounts it with one).
 *   3. Bare tenant DB access inside a request marker STILL fails closed (the core
 *      DEBT-010 invariant is unchanged by the wrapper removal).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { requestContext, db } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "test" || name === "node_modules" || name === "dist") continue;
      out.push(...walk(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("DEBT-010 Phase D — transitional read auto-wrapper is gone (static gate)", () => {
  const files = walk(SRC);

  it("no production source references readAutoWrap / makeReadAutoWrap / getAutoWrappedReadInventory", () => {
    const pattern = /\b(readAutoWrap|makeReadAutoWrap|getAutoWrappedReadInventory)\b/;
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (pattern.test(src)) {
        offenders.push(path.relative(SRC, file).replace(/\\/g, "/"));
      }
    }
    expect(
      offenders,
      `the transitional read auto-wrapper was removed in Phase D — these files still reference it:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no route mounts tenantScoped(..., { skipRead }) — the option no longer exists", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (/\bskipRead\b/.test(src)) {
        offenders.push(path.relative(SRC, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders, `skipRead was removed with the auto-wrapper:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("tenant-scope.ts no longer defines the auto-wrapper", () => {
    const src = readFileSync(path.join(SRC, "middlewares/tenant-scope.ts"), "utf8");
    expect(src).not.toMatch(/function makeReadAutoWrap/);
    expect(src).not.toMatch(/function readAutoWrap/);
    expect(src).not.toMatch(/getAutoWrappedReadInventory/);
    // The fail-closed mount primitive and explicit read helper remain.
    expect(src).toMatch(/export function tenantScoped/);
    expect(src).toMatch(/export function tenantRead/);
  });
});

describe("DEBT-010 Phase D — fail-closed invariant preserved (runtime)", () => {
  it("bare tenant DB access inside a request marker still throws fail-closed", async () => {
    await expect(
      requestContext.run(
        { userId: 1, orgId: 111, isSystemOwner: false },
        async () => {
          // No withTenant()/tenantRead() unit-of-work → the db Proxy must throw,
          // never silently fall back to the pool (which would run with no RLS ctx).
          await (db as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(sql`SELECT 1 AS v`);
        },
      ),
    ).rejects.toThrow(/Fail-closed DB access/i);
  });
});

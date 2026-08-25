/**
 * tenant-rununscoped-guard.test.ts — DEBT-010 constraint (owner, 2026-08-24).
 *
 * runUnscoped() runs work OUTSIDE the tenant marker on the pool. It is an
 * EXCEPTIONAL platform escape (real cross-tenant bulk ops), NOT a general escape
 * hatch to dodge the effort of converting an ordinary tenant route to withTenant().
 *
 * This static guard fails if runUnscoped() is called anywhere outside the
 * explicit allowlist of audited platform operations. Adding a new call site
 * REQUIRES adding it here (a deliberate, reviewed act) — it cannot spread silently.
 *
 * ⚠️ Note for the edms_app gate: runUnscoped() is NOT equivalent to an RLS bypass.
 * Under the non-superuser role the pool has no RLS context, so global reads return
 * 0 rows. Genuine global access must go through an explicit, audited system_owner
 * context (withSystemContext) — never runUnscoped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..");

// Allowlisted call sites: "<relative path>" → why it is a legitimate platform op.
// The definition/JSDoc in middlewares/tenant-scope.ts is excluded (it declares the
// function; it does not "call" it as an escape).
const ALLOWLIST: Record<string, string> = {
  "routes/admin.ts": "search/reindex — cross-tenant bulk reindex to Elasticsearch (external I/O platform op)",
};

const DEFINITION_FILE = "middlewares/tenant-scope.ts";

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

describe("DEBT-010 — runUnscoped() containment (static guard)", () => {
  const files = walk(SRC);

  it("is CALLED only from allowlisted platform operations", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (rel === DEFINITION_FILE) continue; // declaration site, not a call
      const src = readFileSync(file, "utf8");
      // Match actual invocations: runUnscoped(  — ignore the identifier in imports/comments
      const calls = src.match(/\brunUnscoped\s*\(/g);
      if (calls && calls.length > 0 && !(rel in ALLOWLIST)) {
        offenders.push(`${rel} (${calls.length} call site[s])`);
      }
    }
    expect(offenders, `runUnscoped() used outside the allowlist — add a deliberate entry to ALLOWLIST if this is a real platform op:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every allowlisted file still actually uses runUnscoped (no stale entries)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWLIST)) {
      const full = path.join(SRC, rel);
      let src = "";
      try { src = readFileSync(full, "utf8"); } catch { stale.push(`${rel} (file missing)`); continue; }
      if (!/\brunUnscoped\s*\(/.test(src)) stale.push(`${rel} (no longer calls runUnscoped)`);
    }
    expect(stale, `stale ALLOWLIST entries — remove them:\n${stale.join("\n")}`).toEqual([]);
  });
});

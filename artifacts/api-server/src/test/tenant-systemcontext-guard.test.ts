/**
 * tenant-systemcontext-guard.test.ts — DEBT-010 Decision B (background-jobs gate).
 *
 * `withSystemContext()` runs work with is_system_owner=true, so RLS admits ALL
 * tenants. It is the ONE legitimate platform-wide escape (Category B) — currently
 * used only by the search reindex. This static guard fails if it is called from
 * anywhere outside the allowlist, so a global RLS bypass can never spread silently.
 *
 * (`withSystemTenantTx(orgId)` — the per-org Category-A background context — is NOT
 * a bypass: it is org-scoped with is_system_owner=false, so it is not guarded here.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..");

// Allowlisted call sites: "<relative path>" → why it is a legitimate platform op.
const ALLOWLIST: Record<string, string> = {
  "lib/search-service.ts": "reindexAll — cross-tenant document read for Elasticsearch reindex (platform op; ES push outside the tx)",
};

// The definition lives in @workspace/db (lib/db), not under this SRC tree, so there
// is no definition file to exclude here.

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

describe("DEBT-010 — withSystemContext() containment (static guard)", () => {
  const files = walk(SRC);

  it("is CALLED only from allowlisted platform operations", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      const calls = src.match(/\bwithSystemContext\s*\(/g);
      if (calls && calls.length > 0 && !(rel in ALLOWLIST)) {
        offenders.push(`${rel} (${calls.length} call site[s])`);
      }
    }
    expect(offenders, `withSystemContext() used outside the allowlist — add a deliberate entry if this is a real platform op:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every allowlisted file still actually uses withSystemContext (no stale entries)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWLIST)) {
      let src = "";
      try { src = readFileSync(path.join(SRC, rel), "utf8"); } catch { stale.push(`${rel} (file missing)`); continue; }
      if (!/\bwithSystemContext\s*\(/.test(src)) stale.push(`${rel} (no longer calls withSystemContext)`);
    }
    expect(stale, `stale ALLOWLIST entries — remove them:\n${stale.join("\n")}`).toEqual([]);
  });
});

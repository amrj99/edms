/**
 * ops-0032-readonly-guard.test.ts
 *
 * Proves that the Owner-run 0032 READ-ONLY gate script contains NO change/DDL/DML
 * commands — it may only SELECT, EXPLAIN (plan-only), and COPY (...) TO STDOUT.
 * This is the automated guarantee behind "NO PRODUCTION DATA WAS MODIFIED".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const script = readFileSync(resolve(REPO, "scripts/ops/0032-gate-readonly.sh"), "utf8");

describe("0032 read-only gate script — no mutations", () => {
  it("contains no executed mutation/DDL statements (INSERT/DELETE/ALTER/DROP/TRUNCATE/CREATE/GRANT/REVOKE/MERGE)", () => {
    for (const kw of ["INSERT", "DELETE", "ALTER", "DROP", "TRUNCATE", "CREATE", "GRANT", "REVOKE", "MERGE"]) {
      expect(script, `forbidden SQL keyword present: ${kw}`).not.toMatch(new RegExp(`\\b${kw}\\b`, "i"));
    }
  });

  it("only ever uses UPDATE inside a plan-only EXPLAIN (never executed)", () => {
    const updates = (script.match(/\bUPDATE\b/gi) ?? []).length;
    const explainUpdates = (script.match(/\bEXPLAIN\s+UPDATE\b/gi) ?? []).length;
    expect(updates, "every UPDATE must be an `EXPLAIN UPDATE` (plan only)").toBe(explainUpdates);
  });

  it("never runs EXPLAIN ANALYZE (which would EXECUTE the update on production)", () => {
    expect(script).not.toMatch(/\bEXPLAIN\s*\(?\s*ANALYZE/i);
  });

  it("never ingests data via COPY ... FROM (read-only COPY ... TO STDOUT only)", () => {
    expect(script).not.toMatch(/\bCOPY\b[\s\S]{0,200}?\bFROM\b/i);
  });

  it("asserts the no-modification attestation to the operator", () => {
    expect(script).toMatch(/NO PRODUCTION DATA WAS MODIFIED/);
  });
});

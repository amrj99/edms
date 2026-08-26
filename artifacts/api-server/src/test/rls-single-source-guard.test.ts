/**
 * rls-single-source-guard.test.ts — DEBT-010 RC remediation (req 7).
 *
 * Enforces that `applyMembershipRls` (lib/rls-membership.ts) is the SINGLE
 * authoritative source of RLS policy logic, and that nothing in the runtime can
 * (re)install or duplicate it:
 *   • `initRlsPolicies` / `rls-init.ts` no longer exist anywhere.
 *   • `applyMembershipRls(...)` is CALLED only from the migrator (migrate.ts); it is
 *     DEFINED in lib/rls-membership.ts. (Tests are excluded from the scan.)
 *   • The policy name `org_isolation_policy`, `CREATE POLICY`, and
 *     `FORCE ROW LEVEL SECURITY` appear only in lib/rls-membership.ts.
 *   • bootstrap.ts never references an installer — only the read-only verifier.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..");
const SOURCE_OF_TRUTH = "lib/rls-membership.ts";
const MIGRATOR = "migrate.ts";

/** All non-test .ts files under src/. */
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

/** Strip block + line comments so the guard scans CODE, not prose (comments may
 *  legitimately mention org_isolation_policy / applyMembershipRls when documenting). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")        // /* block */
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");   // // line (but not URL "://")
}

const files = walk(SRC).map((f) => {
  const src = readFileSync(f, "utf8");
  return { rel: path.relative(SRC, f).replace(/\\/g, "/"), code: stripComments(src) };
});

describe("DEBT-010 — RLS single-source guard (static)", () => {
  it("rls-init.ts is deleted (no legacy installer file)", () => {
    expect(existsSync(path.join(SRC, "lib/rls-init.ts"))).toBe(false);
  });

  it("nothing references initRlsPolicies anywhere in runtime src", () => {
    const offenders = files.filter((f) => /\binitRlsPolicies\b/.test(f.code)).map((f) => f.rel);
    expect(offenders, `initRlsPolicies must not exist — legacy installer removed:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("applyMembershipRls is called ONLY by the migrator (defined only in the source of truth)", () => {
    const offenders = files
      .filter((f) => /\bapplyMembershipRls\s*\(/.test(f.code))
      .map((f) => f.rel)
      .filter((rel) => rel !== SOURCE_OF_TRUTH && rel !== MIGRATOR);
    expect(offenders, `applyMembershipRls may only be called from ${MIGRATOR} (and defined in ${SOURCE_OF_TRUTH}); test global-setup is excluded:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("policy DDL (org_isolation_policy / CREATE POLICY / FORCE ROW LEVEL SECURITY) lives only in the source of truth", () => {
    const rules: Array<[RegExp, string]> = [
      [/org_isolation_policy/, "org_isolation_policy"],
      [/CREATE\s+POLICY/i, "CREATE POLICY"],
      [/FORCE\s+ROW\s+LEVEL\s+SECURITY/i, "FORCE ROW LEVEL SECURITY"],
    ];
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === SOURCE_OF_TRUTH) continue;
      for (const [re, label] of rules) {
        if (re.test(f.code)) offenders.push(`${f.rel} contains ${label}`);
      }
    }
    expect(offenders, `RLS policy DDL must live only in ${SOURCE_OF_TRUTH}:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("bootstrap.ts uses the read-only verifier, never an installer", () => {
    const bootstrap = files.find((f) => f.rel === "bootstrap.ts");
    expect(bootstrap, "bootstrap.ts not found").toBeTruthy();
    expect(/\bapplyMembershipRls\b/.test(bootstrap!.code), "bootstrap must NOT install RLS").toBe(false);
    expect(/\bassertMembershipRlsInstalled\b/.test(bootstrap!.code), "bootstrap must VERIFY RLS").toBe(true);
  });
});

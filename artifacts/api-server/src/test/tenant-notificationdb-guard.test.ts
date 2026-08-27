/**
 * tenant-notificationdb-guard.test.ts — DEBT-010 constraint (owner, 2026-08-24).
 *
 * `notificationDb` is a narrow pool-backed handle for the notification subsystem
 * only (see lib/notifications/notification-db.ts). It bypasses the request
 * fail-closed marker deliberately, so it MUST NOT spread into general code as an
 * escape hatch. This static guard fails if it is imported/used anywhere outside
 * lib/notifications/**, and asserts the notification module never touches a
 * tenant RLS table through it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..");
const NOTIF_DIR = "lib/notifications"; // the only place notificationDb may be used

// Tenant RLS tables (mirror lib/rls-membership.ts (MEMBERSHIP_RLS_TABLES)) that must NEVER be queried via notificationDb.
const RLS_TABLE_IDENTS = [
  "documentsTable", "documentRevisionsTable", "documentFilesTable", "projectsTable",
  "tasksTable", "notificationsTable", "rulesTable", "correspondenceTable",
  "transmittalsTable", "inspectionRequestsTable", "ncrRecordsTable", "nocRecordsTable",
  "metadataFieldsTable",
];

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

describe("DEBT-010 — notificationDb containment (static guard)", () => {
  const files = walk(SRC);

  it("is referenced ONLY inside lib/notifications/**", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (rel.startsWith(NOTIF_DIR + "/")) continue; // allowed home
      // Strip block + line comments so a doc mention of the name is not a false hit;
      // we only care about real imports/usage.
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/\bnotificationDb\b/.test(src)) offenders.push(rel);
    }
    expect(offenders, `notificationDb used outside ${NOTIF_DIR}/ — keep it inside the notification subsystem:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the notification subsystem never queries a tenant RLS table via notificationDb", () => {
    // notification-db.ts is where the handle is defined; index.ts is the consumer.
    const consumer = path.join(SRC, NOTIF_DIR, "index.ts");
    const src = readFileSync(consumer, "utf8");
    const leaked = RLS_TABLE_IDENTS.filter((t) => new RegExp(`\\b${t}\\b`).test(src));
    expect(leaked, `notification subsystem references RLS table(s) — these must use the fail-closed db proxy inside withTenant(), not notificationDb:\n${leaked.join(", ")}`).toEqual([]);
  });
});

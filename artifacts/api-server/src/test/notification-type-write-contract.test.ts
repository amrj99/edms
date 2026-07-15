/**
 * notification-type-write-contract.test.ts — C-2 write-path guard (ADR-0009).
 *
 * The system uses TWO notification vocabularies (ADR-0009):
 *   1. `notificationTypeEnum` (PostgreSQL enum) → backs `notifications.type` (in-app center).
 *   2. `NotificationEvent` (namespaced union) → backs `notification_logs.event_key` and
 *      `org_notification_settings.event_key`, both `text`.
 *
 * This guard does NOT compare the full `NotificationEvent` union to the enum — that is a
 * semantically wrong comparison (they serve different columns/responsibilities).
 *
 * It validates ONLY the actual application write paths: it statically inventories every
 * `db.insert(notificationsTable)` site in the backend SOURCE (excluding tests), extracts the
 * `type:` literal each writer passes, and asserts every written value is a member of the DB
 * enum. This is the real safety property — an unvetted value written to `notifications.type`
 * would fail at PostgreSQL, and this catches it in CI first.
 *
 * FAIL-CLOSED by design (any new/changed writer forces a review):
 *   • Discovery is EXHAUSTIVE — the whole `src/` tree (minus `test/`) is walked, NOT a
 *     hardcoded file list. A writer added in a brand-new file is discovered automatically
 *     and bumps the site count → the count assertion fails until re-audited.
 *   • Every discovered site MUST yield a static string literal. A dynamic type
 *     (`type: cond ? "a" : "b"`, `type: makeType(x)`, `type: someVar`) yields no literal →
 *     the "every site is statically classified" assertion fails, forcing either an inline
 *     literal or an explicit guard extension. The guard never silently skips a site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { notificationTypeEnum } from "@workspace/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, ".."); // artifacts/api-server/src

// Audited count of application `db.insert(notificationsTable)` sites (src minus test/), 2026-07-15.
// A new writer ANYWHERE under src (any file) changes this → forces a conscious re-audit.
const EXPECTED_INSERT_SITES = 25;

// Audited distinct values written to `notifications.type` (2026-07-15). Documented so a drift
// in either the writers or their values forces this list — and a re-audit — to change.
const AUDITED_WRITE_VALUES = new Set<string>([
  "task_overdue",              // reminder-job.ts, notifications.ts
  "workflow_action_required",  // reminder-job.ts, workflow-engine.ts
  "workflow_sla_reminder",     // reminder-job.ts
  "task_assigned",             // rule-engine.ts, tasks.ts, transmittals.ts
  "system",                    // rule-engine.ts, skill-engine.ts
  "chat_message",              // chat.ts
  "correspondence_received",   // correspondence.ts
  "document_uploaded",         // documents.ts
  "document_approved",         // documents.ts
  "document_rejected",         // documents.ts
  "document_approval_request", // documents.ts
  "meeting_assigned",          // meetings.ts
  "action_item_assigned",      // meetings.ts
  "meeting_reminder",          // notifications.ts
  "task_status_updated",       // tasks.ts
  "transmittal_received",      // transmittals.ts
  "transmittal_acknowledged",  // transmittals.ts
]);

/** Recursively collect every .ts file under `dir`, excluding the `test/` subtree. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

type Site = { file: string; line: number; value: string | null };

const INSERT_RE = /\.insert\(notificationsTable\)\.values\(/;
// Identifier argument ONLY when it's `values(ident)` — ident immediately followed by `)`.
// `values(recipients.map(...))` is NOT an identifier arg (followed by `.`), so it stays inline.
const IDENT_ARG_RE = /\.insert\(notificationsTable\)\.values\(\s*([A-Za-z_$][\w$]*)\s*\)/;
const TYPE_ANY_RE = /\btype:/;
const TYPE_LITERAL_RE = /\btype:\s*["'`]([a-z_]+)["'`]/;
const WINDOW = 40;

/**
 * For each `db.insert(notificationsTable).values(...)` site, classify the `type:` value.
 *  • Inline object/array (`values({...})`, `values(arr.map(...=>({...})))`): forward-scan to
 *    the FIRST `type:` token; it must be a string literal, else the site is unclassified.
 *  • Identifier argument (`values(toInsert)` — object built earlier): backward-scan to the
 *    nearest `type:` token; must be a string literal, else unclassified.
 * Stopping at the FIRST `type:` (not the first literal) prevents attributing an unrelated
 * neighbour's literal to a site whose own type is dynamic.
 */
function scanFile(file: string): Site[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const sites: Site[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!INSERT_RE.test(lines[i])) continue;
    const isIdentifierArg = IDENT_ARG_RE.test(lines[i]); // values(toInsert) vs values({ ... }) / values(arr.map(
    let value: string | null = null;
    const range = isIdentifierArg
      ? { from: i, to: Math.max(0, i - WINDOW), step: -1 }
      : { from: i, to: Math.min(lines.length - 1, i + WINDOW), step: 1 };
    for (let j = range.from; range.step > 0 ? j <= range.to : j >= range.to; j += range.step) {
      if (!TYPE_ANY_RE.test(lines[j])) continue;
      const lit = lines[j].match(TYPE_LITERAL_RE);
      value = lit ? lit[1] : null; // first `type:` wins; non-literal → null (unclassified)
      break;
    }
    sites.push({ file, line: i + 1, value });
  }
  return sites;
}

describe("C-2 guard — every value written to notifications.type is in the DB enum (ADR-0009)", () => {
  const enumValues = new Set<string>(notificationTypeEnum.enumValues);

  const sites = collectSourceFiles(SRC).flatMap(scanFile);
  const classified = sites.filter((s) => s.value !== null);
  const unclassified = sites.filter((s) => s.value === null);
  const writtenValues = new Set<string>(classified.map((s) => s.value as string));

  it("EXHAUSTIVE discovery: inventories the expected number of insert sites across all of src (minus test/)", () => {
    expect(sites.length, `insert sites found:\n${sites.map((s) => ` ${s.file}:${s.line}`).join("\n")}`).toBe(EXPECTED_INSERT_SITES);
  });

  it("FAIL-CLOSED: every insert site yields a static string literal (no dynamic/helper type silently skipped)", () => {
    expect(
      unclassified,
      `these notificationsTable inserts have a non-literal/dynamic \`type:\` and must be inlined or explicitly reviewed:\n${unclassified.map((s) => ` ${s.file}:${s.line}`).join("\n")}`,
    ).toEqual([]);
  });

  it("EVERY value written to notifications.type is a member of notification_type enum", () => {
    const offenders = [...writtenValues].filter((v) => !enumValues.has(v));
    expect(offenders, `values written to notifications.type but absent from the DB enum: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the set of actually-written values matches the audited set (drift guard)", () => {
    expect([...writtenValues].sort()).toEqual([...AUDITED_WRITE_VALUES].sort());
  });

  it("does NOT assert the full NotificationEvent union — only actual writers (ADR-0009 scope)", () => {
    // Sanity: the enum is the 21-value Notification-Center vocabulary, NOT the 38-value
    // delivery taxonomy. The 4 reserved-but-unwritten values are allowed to exist.
    expect(enumValues.size).toBe(21);
    const reservedUnwritten = [...enumValues].filter((v) => !writtenValues.has(v));
    expect(reservedUnwritten.sort()).toEqual(["mention", "rfi_opened", "rfi_responded", "submittal_returned"]);
  });
});

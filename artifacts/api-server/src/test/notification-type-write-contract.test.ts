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
 * It validates ONLY the actual write paths: it statically inventories every
 * `db.insert(notificationsTable)` site in the backend, extracts the `type:` string literal
 * each writer passes, and asserts every written value is a member of the DB enum. This is
 * the real safety property — an unvetted value written to `notifications.type` would fail
 * at PostgreSQL, and this catches it in CI first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { notificationTypeEnum } from "@workspace/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");

// Every backend module that writes to `notifications.type` (inventoried 2026-07-15).
// If a new writer is added, add its file here — the site-count assertion below fails
// otherwise, forcing a conscious re-audit (ADR-0009).
const WRITER_FILES = [
  "lib/reminder-job.ts",
  "lib/rule-engine.ts",
  "lib/skill-engine.ts",
  "routes/chat.ts",
  "routes/correspondence.ts",
  "routes/documents.ts",
  "routes/meetings.ts",
  "routes/notifications.ts",
  "routes/tasks.ts",
  "routes/transmittals.ts",
  "routes/workflow-engine.ts",
];

// Audited count of `db.insert(notificationsTable)` sites across WRITER_FILES (excludes tests).
const EXPECTED_INSERT_SITES = 25;

// Audited distinct values written to `notifications.type` (2026-07-15). Documented so a
// drift in either the writers or their values forces this list — and a re-audit — to change.
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

/**
 * Extract the `type:` string literal for each `db.insert(notificationsTable)` site.
 * Forward-scan to the first `type: "literal"` after the insert (inline object form);
 * if none within window, backward-scan (the `notifications.ts` `toInsert`-built-before form).
 */
function scanWriter(src: string): { sites: number; types: string[] } {
  const lines = src.split("\n");
  const types: string[] = [];
  let sites = 0;
  const TYPE_RE = /\btype:\s*["'`]([a-z_]+)["'`]/;
  const WINDOW = 25;
  for (let i = 0; i < lines.length; i++) {
    if (!/db\.insert\(notificationsTable\)/.test(lines[i])) continue;
    sites++;
    let val: string | null = null;
    for (let j = i; j < Math.min(lines.length, i + WINDOW); j++) {
      const m = lines[j].match(TYPE_RE);
      if (m) { val = m[1]; break; }
    }
    if (!val) {
      for (let j = i; j >= Math.max(0, i - WINDOW); j--) {
        const m = lines[j].match(TYPE_RE);
        if (m) { val = m[1]; break; }
      }
    }
    if (val) types.push(val);
  }
  return { sites, types };
}

describe("C-2 guard — every value written to notifications.type is in the DB enum (ADR-0009)", () => {
  const enumValues = new Set<string>(notificationTypeEnum.enumValues);

  const scans = WRITER_FILES.map((rel) => ({ rel, ...scanWriter(readFileSync(resolve(SRC, rel), "utf8")) }));
  const totalSites = scans.reduce((n, s) => n + s.sites, 0);
  const writtenValues = new Set<string>(scans.flatMap((s) => s.types));

  it("inventories the expected number of notificationsTable insert sites (no writer added/removed silently)", () => {
    expect(totalSites).toBe(EXPECTED_INSERT_SITES);
  });

  it("extracts a type value for every insert site (no writer left unclassified)", () => {
    const extracted = scans.reduce((n, s) => n + s.types.length, 0);
    expect(extracted).toBe(totalSites);
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

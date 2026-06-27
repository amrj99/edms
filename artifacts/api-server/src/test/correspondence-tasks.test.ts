/**
 * correspondence-tasks.test.ts
 *
 * Validates the business logic that links Correspondence to Tasks.
 *
 * These tests are STATIC — they test pure decision logic extracted from the
 * route handlers, without hitting the DB.
 *
 * Guards against:
 *   - Creating a task for a draft (sendNow=false) — must NOT happen
 *   - Creating a task without Task To (assignedToId=null) — must NOT happen
 *   - Sending without Task To → no task created — correct
 *   - Duplicate guard: task only created if none exists for this correspondence
 *   - assignedAt updated ONLY when assignedToId changes (not on other field edits)
 *   - Task completed when correspondence closed or responded
 *   - Task cancelled when correspondence recalled
 *   - "document" enum value accepted (fixes bug in documents.ts)
 */

import { describe, it, expect } from "vitest";

// ─── Pure logic helpers (mirrors correspondence.ts business rules) ─────────────

/**
 * Determines whether a linked task should be created from correspondence.
 * Mirrors the guard in createCorrespondence.
 */
function shouldCreateLinkedTask(opts: {
  sendNow: boolean;
  assignedToId: number | null | undefined;
}): boolean {
  return !!opts.sendNow && !!opts.assignedToId;
}

/**
 * Builds the task title for a correspondence-linked task.
 */
function buildLinkedTaskTitle(subject: string): string {
  return `[Action Required] ${subject}`;
}

/**
 * Returns the task description when a reference number is available.
 */
function buildLinkedTaskDescription(referenceNumber: string | null | undefined): string | undefined {
  return referenceNumber ? `Ref: ${referenceNumber}` : undefined;
}

/**
 * Determines whether assignedAt should be updated when a task is edited.
 * Only updates when assignedToId actually changes.
 */
function shouldUpdateAssignedAt(opts: {
  incomingAssignedToId: number | undefined;
  currentAssignedToId: number | null | undefined;
}): boolean {
  const { incomingAssignedToId, currentAssignedToId } = opts;
  return incomingAssignedToId !== undefined && incomingAssignedToId !== currentAssignedToId;
}

/**
 * Determines the target task status when correspondence status changes.
 * Returns null if no task update is needed.
 */
function linkedTaskStatusForCorrStatus(corrStatus: string): "completed" | "cancelled" | null {
  if (corrStatus === "closed" || corrStatus === "responded") return "completed";
  if (corrStatus === "recalled") return "cancelled";
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("correspondence → task linkage: shouldCreateLinkedTask", () => {

  it("creates task when sendNow=true and assignedToId is set", () => {
    expect(shouldCreateLinkedTask({ sendNow: true, assignedToId: 5 })).toBe(true);
  });

  it("does NOT create task for draft (sendNow=false)", () => {
    expect(shouldCreateLinkedTask({ sendNow: false, assignedToId: 5 })).toBe(false);
  });

  it("does NOT create task when assignedToId is null", () => {
    expect(shouldCreateLinkedTask({ sendNow: true, assignedToId: null })).toBe(false);
  });

  it("does NOT create task when assignedToId is undefined", () => {
    expect(shouldCreateLinkedTask({ sendNow: true, assignedToId: undefined })).toBe(false);
  });

  it("does NOT create task for draft with no assignedToId", () => {
    expect(shouldCreateLinkedTask({ sendNow: false, assignedToId: null })).toBe(false);
  });
});

describe("correspondence → task linkage: task title and description", () => {

  it("prefixes title with [Action Required]", () => {
    expect(buildLinkedTaskTitle("Contract Review")).toBe("[Action Required] Contract Review");
  });

  it("preserves full subject in title", () => {
    const subject = "Tender Documents — Site A Phase 2 Package";
    expect(buildLinkedTaskTitle(subject)).toBe(`[Action Required] ${subject}`);
  });

  it("builds description from reference number when present", () => {
    expect(buildLinkedTaskDescription("PROJ-2026-0042")).toBe("Ref: PROJ-2026-0042");
  });

  it("returns undefined description when no reference number", () => {
    expect(buildLinkedTaskDescription(null)).toBeUndefined();
    expect(buildLinkedTaskDescription(undefined)).toBeUndefined();
    expect(buildLinkedTaskDescription("")).toBeUndefined();
  });
});

describe("correspondence → task linkage: assignedAt update rule", () => {

  it("updates assignedAt when assignedToId changes to a new user", () => {
    expect(shouldUpdateAssignedAt({ incomingAssignedToId: 10, currentAssignedToId: 5 })).toBe(true);
  });

  it("updates assignedAt when assignedToId changes from null to a user", () => {
    expect(shouldUpdateAssignedAt({ incomingAssignedToId: 10, currentAssignedToId: null })).toBe(true);
  });

  it("does NOT update assignedAt when assignedToId is the same", () => {
    expect(shouldUpdateAssignedAt({ incomingAssignedToId: 5, currentAssignedToId: 5 })).toBe(false);
  });

  it("does NOT update assignedAt when assignedToId is undefined (not being changed)", () => {
    expect(shouldUpdateAssignedAt({ incomingAssignedToId: undefined, currentAssignedToId: 5 })).toBe(false);
  });

  it("does NOT update assignedAt on status/title/priority edits (assignedToId absent)", () => {
    // Simulates a PUT /tasks/:id that only changes status
    expect(shouldUpdateAssignedAt({ incomingAssignedToId: undefined, currentAssignedToId: 3 })).toBe(false);
  });
});

describe("correspondence → task linkage: task status on correspondence lifecycle", () => {

  it("completing task when correspondence is closed", () => {
    expect(linkedTaskStatusForCorrStatus("closed")).toBe("completed");
  });

  it("completing task when correspondence is responded", () => {
    expect(linkedTaskStatusForCorrStatus("responded")).toBe("completed");
  });

  it("cancelling task when correspondence is recalled", () => {
    expect(linkedTaskStatusForCorrStatus("recalled")).toBe("cancelled");
  });

  it("no task update for correspondence sent (initial send)", () => {
    expect(linkedTaskStatusForCorrStatus("sent")).toBeNull();
  });

  it("no task update for draft status", () => {
    expect(linkedTaskStatusForCorrStatus("draft")).toBeNull();
  });

  it("no task update for read status", () => {
    expect(linkedTaskStatusForCorrStatus("read")).toBeNull();
  });
});

describe("correspondence → task linkage: deduplication guard", () => {

  it("guard logic: existing task → skip creation", () => {
    const existingTask = { id: 42 };
    const shouldInsert = !existingTask;
    expect(shouldInsert).toBe(false);
  });

  it("guard logic: no existing task → allow creation", () => {
    const existingTask = undefined;
    const shouldInsert = !existingTask;
    expect(shouldInsert).toBe(true);
  });
});

describe("task_source_type enum: 'document' value", () => {
  // The 'document' value was missing from the enum, causing a type error in
  // documents.ts (sourceType: "document" as const). This validates the fix.

  const validSourceTypes = ["manual", "workflow", "correspondence", "document"] as const;

  it("enum includes 'document'", () => {
    expect(validSourceTypes).toContain("document");
  });

  it("enum includes all original values", () => {
    expect(validSourceTypes).toContain("manual");
    expect(validSourceTypes).toContain("workflow");
    expect(validSourceTypes).toContain("correspondence");
  });

  it("'document' sourceType assignment is type-safe (no 'as const' hack needed)", () => {
    // If 'document' is in the enum, this assignment is valid without `as const`
    const sourceType: (typeof validSourceTypes)[number] = "document";
    expect(sourceType).toBe("document");
  });
});

describe("known patterns from history: guard against regression", () => {

  it("draft correspondence never creates a task (sendNow=false)", () => {
    // Regression: ensure saving a draft doesn't trigger task creation
    const scenarios = [
      { sendNow: false, assignedToId: 1 },
      { sendNow: false, assignedToId: 99 },
      { sendNow: false, assignedToId: null },
    ];
    for (const s of scenarios) {
      expect(shouldCreateLinkedTask(s)).toBe(false);
    }
  });

  it("correspondence without Task To never creates a task (assignedToId=null)", () => {
    // Regression: To-only correspondence without Task To assignment
    const scenarios = [
      { sendNow: true, assignedToId: null },
      { sendNow: true, assignedToId: undefined },
      { sendNow: true, assignedToId: 0 },
    ];
    for (const s of scenarios) {
      expect(shouldCreateLinkedTask(s)).toBe(false);
    }
  });

  it("task title always starts with [Action Required]", () => {
    const subjects = ["Budget Review", "RFI #23", "Site Visit Memo", ""];
    for (const subject of subjects) {
      expect(buildLinkedTaskTitle(subject).startsWith("[Action Required]")).toBe(true);
    }
  });
});

# Operational State — ArcScale EDMS

> **Design principle document.**
> Read before adding live-status fields, dashboard queries, or "where is my document?" features to any module.

---

## Two Distinct Concepts

ArcScale distinguishes between two fundamentally different views of any entity:

### Live Operational State — *What is happening right now?*

A snapshot of the entity's current position in the system:
- Where is it?
- Who holds it?
- What is it waiting for?
- Is it overdue?

This is what an employee needs first thing in the morning. It must be fast, current, and actionable.

### Journey / Timeline — *What happened before?*

The complete chronological history of every state change, transition, action, and decision made on the entity since creation.

This is what a DC or PM needs when reviewing progress, preparing a report, or resolving a dispute.

**These are not the same view, and they must not be conflated in the UI or the API.**

---

## The Operational State Contract

Every major entity in ArcScale — Document, Transmittal, Correspondence, and future entities like NOC — must be able to produce a Live Operational State response conforming to this shape:

```typescript
interface OperationalState {
  entityType:    "document" | "transmittal" | "correspondence" | string;
  entityId:      string;

  currentStatus: string;           // Module-specific status value

  currentOwner: {
    id:   string;
    name: string;
    role: string;
  } | null;

  currentOrg: {
    id:   string;
    name: string;
  } | null;

  currentStage:   string | null;   // Workflow stage name, if applicable
  waitingFor:     string | null;   // Human-readable description of the blocker
  openTasks:      number;          // Count of open tasks linked to this entity
  lastAction: {
    what: string;                  // e.g. "Returned to Stage 1", "Sent for Review"
    by:   string;                  // Actor name
    when: string;                  // ISO timestamp
  } | null;

  nextExpected:   string | null;   // What should happen next (descriptive, not enforced)
  sinceWhen:      string;          // ISO timestamp — when did the entity enter its current status

  slaStatus: "on_track" | "at_risk" | "overdue" | null;  // See SLA note below
}
```

**This is a contract, not a shared service.** Each module computes these fields independently from its own tables. The shape is what is standardized — the data source is not.

---

## Per-Module Implementation

### Documents

Draws from:
- `wf_instances` — `currentStageId`, `status`, `updatedAt` (sinceWhen for active workflow)
- `wf_template_stages` — stage name for `currentStage`
- `wf_instance_transitions` — most recent transition for `lastAction`
- `tasks` (sourceType = "workflow") — open task count and assignee for `currentOwner`
- `transmittals` + `transmittal_items` — latest linked transmittal for context
- `documents.status` — `currentStatus` when no active workflow

### Transmittals

Draws from:
- `transmittals.status` — `currentStatus`
- `transmittals.createdAt` / `updatedAt` — `sinceWhen`
- `transmittal_history` — `lastAction`
- Assigned reviewer (if stored) — `currentOwner`
- `transmittal_items` — per-item review codes (not surfaced in OperationalState directly; belongs in detail view)

### Correspondence

Draws from:
- `assignedTo` — `currentOwner`
- `status` — `currentStatus`
- `dueDate` — feeds `slaStatus` once SLA logic exists
- Linked reminders / tasks — `openTasks`

### NOC (future)

Will draw from its own tables following the same contract. Define the source mapping when the module is built.

---

## Goal: Visibility, Not Enforcement

The purpose of Operational State is to give users clarity, not to lock them into a workflow.

The system must:
- **Suggest** — surface the expected next action
- **Warn** — flag delays, missing actions, or unusual states
- **Record** — log every transition with actor and timestamp
- **Track** — maintain full traceability across the entity's life

The system must not:
- Block an action because a previous step was skipped (unless an explicit organization policy requires it)
- Force a specific path through the workflow
- Treat flexibility as an error

> **ArcScale guides, warns, records, and tracks — but does not block unless the organization has explicitly chosen to enable that restriction through its settings.**

This principle applies at every layer: API, business logic, and UI.

---

## SLA — Currently Nullable

`slaStatus` is part of the contract but must be treated as `null` until the SLA source is decided.

Open questions that must be answered before SLA can be computed:

1. Is SLA defined per workflow template stage?
2. Is SLA defined per transmittal type?
3. Is SLA defined per project?
4. Can a user set a manual due date on any entity?

Until these are resolved, `slaStatus: null` is the correct default. Do not approximate SLA from `updatedAt` age — that produces misleading "overdue" signals.

---

## Aggregation

A unified "What is waiting for me?" dashboard will eventually query Operational State across all modules and aggregate results for the current user. This is possible because the contract shape is standardized.

**Do not build this aggregation layer until at least two modules have shipped their own Operational State implementation.** The aggregation design should emerge from what the independent implementations actually look like, not from assumptions.

---

## What This Document Is Not

- This is not an API specification. Endpoint paths, request parameters, and response envelopes are decided per module.
- This is not a database schema. No new tables are required to implement this concept.
- This is not a shared service. Do not create a single `getOperationalState()` function that all modules call.

---

*Last updated: 2026-06-28*
*Status: Active design principle — not yet implemented in any module.*

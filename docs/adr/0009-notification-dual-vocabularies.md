# ADR-0009 — Notification Dual Vocabularies (C-2 roadmap diagnosis corrected)

- **Status:** Accepted (2026-07-15)
- **Context item:** Comprehensive-review roadmap `C-2` (`docs/architecture/comprehensive-review-roadmap.md:225`)
- **Supersedes the roadmap framing of C-2**, which read: *"Notification type mismatch — DB enum has 21 while code defines 40+ … fix: sync the enum by adding the missing types via migration."*

## Decision

**C-2 — Original diagnosis corrected. The system intentionally uses two notification
vocabularies serving different responsibilities. No unsafe enum mismatch exists on
current write paths.**

We do **not** add the `NotificationEvent` values to the `notification_type` enum. No
`ALTER TYPE`, no reserved values, no rename, no data conversion, no behavior change.

## Evidence — two separate contracts

The codebase has **two distinct notification vocabularies**, each backing a different
table/column with a different responsibility. They are **not** two views of one list, and
name similarity does **not** imply one converts to the other.

### 1. `NotificationType` — in-app Notification Center

- **Definition:** `notificationTypeEnum` (PostgreSQL `enum`, 21 values, `snake_case`) —
  `lib/db/src/schema/notifications.ts:8`.
- **Column it backs:** `notifications.type` (`notNull`, enum-constrained).
- **Responsibility:** the type of an **in-app notification record** shown in the
  Notification Center. Constrained by the DB — an invalid value would fail the insert.
- **Values:** `document_uploaded`, `document_approved`, `document_rejected`,
  `document_approval_request`, `task_assigned`, `task_overdue`, `task_status_updated`,
  `action_item_assigned`, `correspondence_received`, `transmittal_received`,
  `transmittal_acknowledged`, `workflow_action_required`, `workflow_sla_reminder`,
  `rfi_opened`, `rfi_responded`, `submittal_returned`, `mention`, `chat_message`,
  `meeting_assigned`, `meeting_reminder`, `system`.

### 2. `NotificationEvent` — operational / delivery event taxonomy

- **Definition:** `NotificationEvent` union (38 values, mostly `namespaced` e.g.
  `workflow.approved`, `sla.due_soon`) — `artifacts/api-server/src/lib/notifications/index.ts:23`.
- **Columns it backs:** `notification_logs.event_key` **and**
  `org_notification_settings.event_key` — both are **`text`** (unconstrained), NOT the enum
  (`lib/db/src/schema/notifications.ts:64,80`).
- **Responsibility:** the operational event that drives **delivery / email / per-org
  preference settings**. It is a delivery-pipeline taxonomy, deliberately richer and
  namespaced, and it is stored in free `text`.

### Why there is no unsafe mismatch

- The `namespaced` `NotificationEvent` values are written **only** to `text` columns. They
  **never** reach the `notification_type` enum column, so they can never cause a failing
  enum insert.
- Every actual writer to `notifications.type` passes a value that is already a member of
  `notification_type`. Verified by inventory + an automated guard (see below): **17 distinct
  values are written, all 17 ∈ the 21-value enum.** The remaining 4 enum values
  (`rfi_opened`, `rfi_responded`, `submittal_returned`, `mention`) are reserved and simply
  not yet written — which is safe.

### Consequence of the naive "sync" (rejected)

Adding all `NotificationEvent` values into `notification_type` would mix a delivery-event
taxonomy into the Notification-Center enum, producing a ~53-value enum that **no code reads
from the enum column**, for **no operational benefit**, while blurring two separate
responsibilities.

## Rules going forward

- **Adding a new Notification-Center type** (a value stored in `notifications.type`)
  **requires an explicit decision + adding the value to the `notification_type` enum via an
  additive migration.** It is not automatic and does not happen by name-matching an event.
- **Adding a delivery / email event** (a `NotificationEvent` written to
  `notification_logs.event_key` / `org_notification_settings.event_key`) does **not** require
  touching `notification_type`, unless that event is **also** meant to appear in the
  in-app Notification Center.

## Guard

`artifacts/api-server/src/test/notification-type-write-contract.test.ts` statically inventories
every `db.insert(notificationsTable)` writer, extracts the `type:` literal each passes, and
asserts every written value is a member of `notificationTypeEnum.enumValues`. It intentionally
does **not** compare the full `NotificationEvent` union to the enum (a semantically wrong
comparison) — it validates only the actual write paths.

## Future follow-up (non-blocking)

**Future Notification Taxonomy Unification** — re-evaluate only when we need unified analytics
across notifications + delivery events, or a general mechanism to promote a delivery `Event`
into a Notification-Center `Type`. Tracked in the Architecture Debt Register; relates to
D-1/D-3, and is **not** part of the current C-2 remediation.

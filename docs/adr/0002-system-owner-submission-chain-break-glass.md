# ADR 0002 — system_owner Break-glass Capability on Submission Chain Action Routes

**Status:** Accepted  
**Date:** 2026-07-04  
**Deciders:** Engineering  

---

## Context

The Submission Chain lifecycle (Phase 3) uses participant-level custodian checks to enforce that only
the current custodian organisation or participant may perform workflow actions (forward, review,
return, resubmit). These checks are in addition to role-based middleware.

During Phase 3 implementation, `requireMinRole` was chosen over the older `requireRole` helper for
all submission-chain action routes. `requireMinRole` uses a rank hierarchy where `system_owner`
(rank 100) always passes any threshold. This was not an oversight — it is a deliberate design
choice that extends an already-established platform-level pattern.

**The question this ADR answers:** Is the system_owner bypass of custodian checks intentional, or
is it an accidental side-effect of the middleware change?

**Answer: It is intentional.** The evidence is conclusive (see Decision section).

---

## Decision

`system_owner` has a permanent, intentional **Break-glass / Platform Override** capability on all
submission-chain action routes. This capability bypasses both:

1. The `requireMinRole` role gate (system_owner rank 100 passes any threshold).
2. The handler-level custodian check (`isSystemOwner(caller)` short-circuits the participant
   equality guard).

### Primary evidence — `computeActions()` explicit branch

`computeActions()` (submission-chains.ts, line 193) is a **pure function** that computes which
workflow actions the caller may perform. At line 204 it contains a deliberate branch:

```typescript
if (isSysOwner) {
  return {
    canSetupParties: !partiesReady && noStepsYet,
    canReview:       chain.currentStatus === "active"   && partiesReady,
    canForward:      chain.currentStatus === "active"   && partiesReady,
    canReturn:       chain.currentStatus === "active"   && partiesReady,
    canResubmit:     chain.currentStatus === "returned" && partiesReady,
  };
}
```

This branch was written deliberately during Phase 3 — it is not a residual artefact of a middleware
change. It grants `system_owner` the full action set whenever the chain state allows it,
independent of which participant currently holds custody.

### Secondary evidence — audit trail design

The step insert records **two separate attribution fields**:

| Field | Who it records | Why |
|---|---|---|
| `actionedById` | The actual actor (system_owner's user ID) | Transparent legal record of who performed the action |
| `fromParticipantId` | The chain position (current custodian participant) | Preserves the organisational chain of custody |

Both fields are populated honestly. This two-field pattern was chosen precisely because Break-glass
use cases exist: the system_owner performs the action on behalf of the blocked custodian position,
not in place of it in the organisational record.

---

## Rationale

### Why Break-glass is necessary

Submission chains can become stuck when:

- The custodian organisation's account is deactivated (e.g. subcontractor offboarded mid-project).
- The designated reviewer is unavailable and no deputy has been assigned.
- A data integrity issue leaves the chain in a state where normal participants cannot proceed.

Without a Break-glass path, the only recourse is direct SQL surgery on the production database —
which is far riskier, leaves no application-level audit record, and is not available to the
on-call platform engineer. The Break-glass path keeps the fix inside the application where it is
logged, auditable, and reversible.

### Semantic distinction for `review`

`forward`, `return`, and `resubmit` are **administrative workflow transitions**: they move a
document between custodians. A system_owner performing these is an unambiguous administrative
override.

`review` records a professional judgment (review code B/C etc.). A system_owner recording a review
is therefore an **exceptional administrative act** — it signals "this step must be unblocked" not
"this is a professional opinion." The audit trail's `actionedById = system_owner` makes this
visible to any downstream reader.

This distinction does not change the permission model but should inform operational policy:
system_owner review overrides should be documented in a linked incident or change ticket.

---

## Implementation

### Middleware gate

All six action routes use `requireMinRole(...)` (not `requireRole`). The minimum role required
is the operational role for that action (e.g., `reviewer` for `/review`,
`document_controller` for `/forward`). `system_owner` passes all of these by rank.

```
POST /:id/forward    → requireMinRole("document_controller")
POST /:id/review     → requireMinRole("reviewer")
POST /:id/return     → requireMinRole("document_controller")
POST /:id/resubmit   → requireMinRole("document_controller")
```

### Handler custodian bypass

Each action handler wraps its custodian equality check in `if (!isSystemOwner(caller))`:

```typescript
// Example — forward handler (abbreviated)
if (!isSystemOwner(caller)) {
  if (!callerParticipant || callerParticipant.id !== chain.currentParticipantId) {
    res.status(403).json({ error: "Forbidden", message: "Only the current custodian..." });
    return;
  }
}
```

The same pattern applies to `/review`, `/return`, and `/resubmit`.

### Test coverage

`submission-chains.test.ts` — describe block "system_owner bypass — requireMinRole + custodian check":

- `system_owner passes requireMinRole and custodian check on /review (no orgId)` ✅
- `system_owner passes requireMinRole and custodian check on /return (no orgId)` ✅
- `system_owner passes requireMinRole and originator check on /resubmit (no orgId)` ✅

Total test suite: 531/531 passing.

---

## ⚠️ Warning for future maintainers

**Do NOT revert `requireMinRole` to `requireRole` on submission-chain action routes.**

`requireRole` (from `lib/auth.ts`) performs an exact role match and has no system_owner bypass.
Reverting to it would block `system_owner` from action routes and remove the Break-glass
capability — an intentional regression.

If you are reading this because you found system_owner bypassing the custodian check and suspected
it was a bug: it is not a bug. It was designed this way. See the `computeActions()` branch at
`src/routes/submission-chains.ts` line 204 for the canonical evidence.

If the Break-glass capability needs to be **restricted** (e.g., gated behind a 2FA confirmation
or an explicit incident flag), that is a product decision and should be addressed as a new ADR —
not by silently removing the bypass.

---

## Consequences

**Positive:**
- Stuck chains can be unblocked without direct database intervention.
- The audit trail is honest: both the acting user and the chain position are recorded.
- `computeActions()` returns accurate capabilities to the frontend, so Break-glass actions
  surface as available buttons rather than silent API overrides.
- Test coverage explicitly documents and protects the behaviour.

**Negative / Risks:**
- A compromised `system_owner` account can arbitrarily advance any chain in any project. This
  is mitigated by the audit trail, account access controls, and the principle that Break-glass is
  only used in operational incidents.
- `review` records by `system_owner` may be misread as professional endorsements by downstream
  consumers of the audit log. Operational policy should require linking such steps to an incident
  ticket.

---

## Related

- `src/routes/submission-chains.ts` — implementation
- `src/middlewares/require-role.ts` — `requireMinRole` hierarchy documentation
- `src/lib/auth.ts` — `isSystemOwner()` helper
- `src/test/submission-chains.test.ts` — Break-glass test coverage
- ADR 0001 — Plan tier rename (unrelated, reference for ADR format)

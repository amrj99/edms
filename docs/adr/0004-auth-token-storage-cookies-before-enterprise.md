# ADR 0004 — Auth Token Storage: httpOnly Cookies before Enterprise, not before First Customer

**Status:** Accepted
**Date:** 2026-07-10
**Deciders:** Owner (Product/Engineering), Architecture Review (Phase 2 Remediation)

---

## Context

Access + refresh tokens are stored in `localStorage` (confirmed: `routes/auth.ts` logout comment; the access token is a bearer JWT). This is XSS-exfiltratable. Moving to `httpOnly` cookies removes that exposure but introduces CSRF and requires a reworked auth flow (SameSite policy, CSRF token, frontend + backend changes).

## Decision

- **httpOnly cookies are REQUIRED before onboarding an Enterprise customer**, not before the first (pilot) customer.
- For the limited pilot, `localStorage` storage is an **Accepted Risk**, mitigated by: strict CSP (`default-src 'none'`, already in place), and rate-limiting enabled in **all** environments (currently disabled outside prod — fixed in Phase 5).
- Bundled with cookies (Enterprise track): **session revocation** (revoke-all-sessions), and refresh-token reuse detection.

### Alternatives considered
- **Cookies before first customer** — highest security, but a breaking auth-flow change (CSRF surface, FE+BE rework) with low marginal value for a trusted pilot. Deferred.
- **Do nothing** — leaves XSS token theft open indefinitely. Rejected as end state.

## Consequences
- **Now (Phase 5):** enable rate-limit in all envs; document the localStorage accepted risk.
- **Enterprise (Phase 10):** cookies (Breaking change — FE+BE), CSRF protection, session-revocation table + endpoint.
- No migration or production change for the pilot posture.

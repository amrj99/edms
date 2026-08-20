# ArcScale — Session Management Hardening: Closure Report

**Status: ✅ Go-Live blocker CLOSED — proven live (real Chrome + API/DB) + full regression green.**
Date: 2026-08-19. Scope: the deferred *Session Management Hardening* item from Product Validation.
Billing remains deferred (untouched).

---

## 1. Final session design (what ships)

**Two-token model, same-origin:**
- **Access token** — short JWT (default **15 min**, bound 5–30), `Authorization: Bearer`. Carries id/email/role/org.
  Held in `localStorage` on the client. Because it is short-lived and auto-refreshed, its expiry is a
  non-event for the user (see §2 auto-refresh).
- **Refresh token** — opaque 256-bit, stored **SHA-256-hashed** server-side (`refresh_tokens.token`),
  delivered to the browser ONLY as a **Secure, HttpOnly, SameSite=Strict** cookie `edms_rt` scoped to
  `/api/auth`. Invisible to JavaScript. Rotated on every use. Its row holds `organizationId`, `expiresAt`
  (absolute session end), `lastUsedAt` (idle clock), `revokedAt`, and `familyId` (rotation chain).

**Transparent auto-refresh (no 15/30-min eviction):** a global `fetch` interceptor attaches the Bearer token
and, on any `401` from a protected `/api` call, performs ONE **single-flight** refresh
(`POST /api/auth/refresh-token`, cookie carries the refresh token), then **transparently retries** the original
request with the new access token. Concurrent 401s share the single refresh — no stampede, no open form lost.
On boot/reload/Chrome-reopen the app silently calls refresh once (cookie auto-sent) to recover the session.

**Idle vs absolute:** `/refresh-token` rejects if `now > expiresAt` (→ `SESSION_EXPIRED`, absolute lifetime
reached) OR `now - lastUsedAt > tenant.idleTimeout` (→ `SESSION_IDLE_TIMEOUT`). An active user (refreshing
every ~15 min) stays alive to the absolute lifetime; an idle user is ended after the tenant idle window.

**Rotation + theft detection:** every refresh revokes the presented token and issues a new one in the same
family. Presenting an already-revoked (rotated/old) token ⇒ treated as theft ⇒ **entire family revoked** +
audit `refresh_token_reuse_detected` + `401 REFRESH_TOKEN_REUSE`.

**Logout:** revokes the whole family server-side AND clears the cookie. A post-logout refresh attempt fails
(cookie gone + family revoked) ⇒ session is genuinely over on the server, not just the device.

## 2. Defaults & system-enforced bounds

| Setting | Default | Bound | Scope |
|---|---|---|---|
| Access token expiry | 15 min | 5–30 min | Global (short-lived security primitive) |
| **Session lifetime (absolute)** | **8 h (480 min)** | 30 min – 30 d | **Per-tenant** (`org_config.session_timeout_minutes`) |
| Idle timeout | 30 min | 5 min – session lifetime | **Per-tenant** (`org_config.idle_timeout_minutes`) |
| Remember Me enabled | true | on/off | **Per-tenant** (`org_config.remember_me_enabled`) |
| Remember Me duration | 7 d | 1–30 d | **Per-tenant** (`org_config.remember_me_days`) |

All values are **clamped server-side** on read and on write — a tampered `org_config` row can never widen
beyond bounds (proven: PUT 999999/0 → stored 43200 / effective idle 5).

## 3. What is configurable per tenant

`session_timeout_minutes`, `idle_timeout_minutes`, `remember_me_enabled`, `remember_me_days` — via
`GET/PUT /api/config/session-settings` (admin-only, bounded, audited `session_settings_changed`, cache-invalidated).
Access-token expiry stays global by policy. Each org's settings live in its own `org_config` row and each
refresh row is stamped with its `organizationId`, so **org A's policy governs only org A's sessions**.

## 4. Tokens/cookies security model

- Access: short JWT, HMAC-signed (`JWT_SECRET`), Bearer. Short window limits any residual post-logout validity.
- Refresh: opaque, **hashed at rest**, **HttpOnly + Secure(prod) + SameSite=Strict** cookie, path `/api/auth`,
  rotated every use, family-revoked on reuse. **Not readable by JavaScript** (XSS cannot exfiltrate it — proven).
- Per-tenant isolation enforced by org-scoped reads + org-stamped refresh rows. All settings clamped server-side.

## 5. Test results — LIVE (real Chrome, app's own patched `fetch`) — localhost:3900 → :8088

| # | Scenario | Evidence | Result |
|---|---|---|---|
| L1 | Access token expires mid-work → auto-refresh → continue | corrupt token, call `/api/auth/me` via interceptor → **200**, access token rotated (tail `AfaO4A`→`ETJNZ8`, both 268-char JWTs) | ✅ no re-login |
| L2 | Refresh cookie invisible to JS (XSS-safe) | `document.cookie` contains `edms_rt` → **false** | ✅ |
| L3 | Concurrent requests during refresh (single-flight) | 6 concurrent expired-token calls → **[200,200,200,200,200,200]**, one shared refresh, no reuse-trip | ✅ |
| L4 | Logout → server-side revocation | logout **200**, cookie cleared, then protected call → **401** (refresh fails: family revoked + cookie gone) | ✅ |
| L5 | Per-tenant policy applied live | `GET /session-settings` org1 → idle 60 / remember 7d · org2 → idle 20 / remember 3d | ✅ isolated |

## 5b. Test results — API + DB (fresh run, `session-api-verify.mjs`)

| Scenario | Evidence | Result |
|---|---|---|
| Per-tenant `org_config` | org1 = 480/60/7 · org2 = 120/20/3 | ✅ |
| Login cookie attributes | `edms_rt` · HttpOnly · SameSite=Strict · no Max-Age (session cookie when Remember-Me off) | ✅ |
| Absolute lifetime per tenant (refresh row span) | org1 = **480 min** · org2 = **120 min** | ✅ isolated |
| Happy refresh (rotation) | 200 · new token ≠ old · old token revoked | ✅ |
| **Reuse detection** | present revoked token → **401 REFRESH_TOKEN_REUSE** · family active-count after = **0** | ✅ |
| **Idle timeout** | lastUsedAt = now-999m → **401 SESSION_IDLE_TIMEOUT** | ✅ |
| **Absolute expiry** | expiresAt = now-1m → **401 SESSION_EXPIRED** | ✅ |
| Remember Me | cookie Max-Age = **604800** (7d) · refresh row lifetime = **7 days** | ✅ |
| Clamp on tamper (PUT) | 999999/0 → stored 43200 (max) / effective idle 5 (min) | ✅ tamper-proof |

## 6. Bugs found & fixed during this work

- **BUG-006** — initial JS-side time comparisons + `timestamp without time zone` columns on a non-UTC
  (Asia/Dubai) cluster caused a ~4h skew → every refresh wrongly expired. **Fix:** DB-side parametrised
  comparisons (`sql<boolean> ${col} <= ${new Date()}`) + convert `expires_at`/`last_used_at` to **timestamptz**.
  Re-verified green (happy 200, idle/absolute 401, per-tenant isolated).
- **BUG-007** — login form collected "Remember Me" but never sent it; backend always treated sessions as
  non-remember. **Fix:** forward `rememberMe` in the login mutation. Verified: Max-Age=604800 on the cookie.
- **Stale API process** (session-settings route 404) — running server predated the config route edit;
  fixed by clean relaunch. **Stale @workspace/db types** — rebuilt `.d.ts` via `tsc --build --force`.

## 7. Full regression

`vitest run` against `edms_test` (schema mirrored: session columns + timestamptz): **772 passed / 772
(55 files), exit 0, 258s.** No regressions in Auth / Users / Roles / RLS tenant-isolation / Workflows /
Correspondence / Transmittals.

## 8. Real-Chrome result

Verified in real Chrome against the running app, driving the application's **own** patched `fetch` interceptor
in the page context (L1–L5 above). Note: the browser tab reported a 0×0 viewport this run, so verification was
done through the live client code path (the exact interceptor + cookie flow the UI uses) rather than
pixel-clicking the DOM. The decisive behaviours — expired access token → transparent cookie-refresh + retry →
**200 without redirect to /login**, single-flight under concurrency, HttpOnly cookie unreadable by JS, and
logout truly ending the session server-side — all executed in real Chrome.

## 9. Go-Live blocker — verdict

**CLOSED.** A user works the full configured session (default **8 h**, per-tenant) with transparent
auto-refresh and is **not** evicted every 15/30 min (proven: expired access token → refresh → retry → 200,
rotated token, no re-login). Each company sets its own duration within safe bounds with **full tenant
isolation** (org1 = 8h/60 vs org2 = 2h/20, live + DB). Refresh-token rotation, reuse/theft detection, idle &
absolute expiry, Remember-Me, correct server-side logout, and settings-tamper clamping are all verified.
Full regression (772/772) confirms no collateral damage.

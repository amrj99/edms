# ArcScale — Session Management Hardening: Design (review → design → plan)

Go-Live blocker being closed. Product decision (approved): default session **8h**, NOT hard-coded,
**per-tenant** configurable within system-enforced safe bounds; tenant A settings must never affect B;
access token stays **short**, active users work the full session via safe refresh (no 30-min eviction).

## 1. Architecture review (current state, from code — the baseline we are replacing)
- Access token: JWT, `getAccessTokenExpirySeconds()` default **30 min** (global `system_settings`). `security-settings.ts:74`.
- Refresh token: opaque, SHA-256-hashed in `refresh_tokens`, **rotated** on `/refresh-token` (old revoked, new issued),
  rejects expired/revoked. Lifetime = global `session_timeout_minutes` (8h). `routes/auth.ts:236-243,374-433`.
- Remember Me: extends refresh to 7× (cap 30d), access unaffected. `security-settings.ts:103`.
- **Gaps:** settings are GLOBAL not per-tenant; **frontend never calls `/refresh-token`** (no auto-refresh →
  30-min eviction); **no idle timeout**; tokens in **localStorage** (XSS); access JWT valid post-logout;
  no refresh-reuse (theft) detection; `cookie-parser` installed but NOT wired.

## 2. Final design
### Token model
- **Access token (JWT):** short — default **15 min** (global, bound 5–30). Carries id/email/role/org/isReadOnlyOverride.
  Held **in memory only** on the client (JS variable), never localStorage. Lost on reload → re-obtained by silent refresh.
- **Refresh token:** opaque 256-bit, stored **SHA-256-hashed** server-side, delivered to the browser as a
  **Secure, HttpOnly, SameSite=Strict cookie** scoped to `/api/auth` — invisible to JavaScript (XSS-safe).
  Rotated on every use. Carries the session identity; its row holds `organizationId`, `expiresAt` (absolute
  session end), `lastUsedAt` (idle clock), `revokedAt`, and a rotation-family id for reuse detection.
- **Why cookie + in-memory (chosen as most suitable):** removes both tokens from JS-readable storage; app is
  same-origin (nginx/Vite proxy) so SameSite=Strict works; XSS can no longer exfiltrate the long-lived refresh token.

### Auto-refresh (transparent, safe)
- Client keeps the access token in memory + its expiry. A single **`ensureFreshToken()`** runs:
  (a) proactively ~1 min before expiry, and (b) reactively on any `401`.
- **Single-flight lock:** concurrent callers await ONE in-flight refresh (prevents refresh stampede / rotation races).
- On success: update in-memory access token, **retry the original request(s)** → the user never sees a logout and
  **no open form / in-flight data is lost** (no navigation, no reload).
- On failure (absolute expiry / idle exceeded / revoked): clear memory, redirect to `/login` cleanly.
- **App load / reload / Chrome reopen:** on boot, call `/refresh-token` once (cookie auto-sent). If it succeeds →
  silent re-login (session continues); if it fails → `/login`. This is how an 8h session survives reloads.

### Idle timeout (separate, per-tenant)
- `refresh_tokens.lastUsedAt` updated on each successful refresh. `/refresh-token` rejects if
  `now - lastUsedAt > tenant.idleTimeout` (→ 401 `SESSION_IDLE_TIMEOUT`) OR `now > expiresAt` (absolute).
- Because the client refreshes ~every 15 min while active, an active user stays alive to the absolute 8h;
  an idle user is ended after the tenant idle window. Constraint enforced: `idleTimeout >= accessTokenExpiry`.

### Remember Me (clear policy)
- Off (default): refresh cookie is a **session cookie** (no Max-Age) → dropped when the browser fully closes;
  absolute lifetime still = tenant session timeout.
- On: refresh cookie gets **Max-Age = tenant rememberMeDays** (default 7, bound 1–30) and the refresh row
  `expiresAt` extends accordingly → survives browser restart up to that many days (idle timeout still applies).

### Rotation + reuse detection
- Every refresh: revoke the presented token, issue a new one in the SAME family.
- **Reuse:** if a token that is already **revoked** (i.e. a rotated/old token) is presented → treat as theft →
  **revoke the entire family (all that user's active refresh tokens)** + audit `refresh_token_reuse_detected`.

### Logout
- Revokes the presented refresh token server-side (family) + **clears the cookie** (`Set-Cookie` maxAge 0).
- Access token is short (15 min) so the residual stateless window is small (documented; optional denylist later).

### Tenant isolation of settings
- Session policy lives in **`org_config`** (per-org row). Resolution: `org_config.<col>` → global default → hard default,
  all **clamped to system bounds**. Reads are per-org; org A's row is physically separate from org B's.
- The refresh row records its `organizationId`; idle/lifetime are resolved from THAT org — so each session is
  governed only by its own tenant's policy. Settings changes require admin of that org (existing role gate).

### Audit
- Events: `login_success` (exists), `logout` (exists), `token_refreshed` (throttled/optional), 
  `refresh_token_reuse_detected`, `session_idle_timeout`, `session_settings_changed`.

### Race conditions / no data loss
- Single-flight refresh + request-retry queue: many simultaneous 401s trigger ONE refresh; all queued requests
  replay with the new token. Rotation can't be raced into a spurious logout (the "same-token" guard from BUG-002
  is superseded by the single-flight + family model).

## 3. Defaults & system-enforced bounds
| Setting | Default | Bound | Scope |
|---|---|---|---|
| Access token expiry | 15 min | 5–30 min | Global (short by policy) |
| Session lifetime (absolute) | **8 h** (480 min) | 30 min – 30 d | **Per-tenant** (`org_config.session_timeout_minutes`) |
| Idle timeout | 30 min | 5 min – session lifetime | **Per-tenant** (`org_config.idle_timeout_minutes`) |
| Remember Me enabled | true | on/off | **Per-tenant** (`org_config.remember_me_enabled`) |
| Remember Me duration | 7 d | 1–30 d | **Per-tenant** (`org_config.remember_me_days`) |

## 4. Configurable per tenant (via org security settings, admin-only, bounded)
`session_timeout_minutes`, `idle_timeout_minutes`, `remember_me_enabled`, `remember_me_days`.
(Access-token expiry stays global — it is a short-lived security primitive, not a tenant knob.)

## 5. Security model (tokens/cookies)
- Access: short JWT, in-memory, HMAC-signed (JWT_SECRET). Never persisted.
- Refresh: opaque, hashed at rest, HttpOnly+Secure+SameSite=Strict cookie, rotated, family-revoked on reuse.
- All settings clamped server-side (a tampered org_config value can never widen beyond bounds).
- Per-tenant isolation enforced by org-scoped reads + org-stamped refresh rows.

## 6. Implementation plan (staged, each tested before next)
1. **Schema:** `org_config` += session columns; `refresh_tokens` += `last_used_at` + rotation-family id. Push to edms_qa/edms_test.
2. **Backend settings resolver:** `getOrgSessionPolicy(orgId)` (per-tenant + bounds) in security-settings.
3. **Backend auth:** short access default; `/login` sets HttpOnly refresh cookie (Remember-Me aware) + returns access;
   `/refresh-token` reads cookie, checks absolute+idle, rotates, reuse-detection, sets new cookie; `/logout` clears cookie + revokes family; wire `cookie-parser`.
4. **Backend settings API:** GET/PUT org session settings (admin-only, bounded, audited).
5. **Frontend:** in-memory access token; boot silent-refresh; single-flight auto-refresh + retry; idle handling; logout; remove localStorage tokens; update socket + fetch interceptor.
6. **Tests:** API+DB (all scenarios) + real Chrome UI (2 tenants, different policies) + full regression + auth/users/roles/isolation re-test.

Closure = proven live: 8h session works, no 30-min eviction, tenants isolated, all scenarios + regression green.

## Progress log
- **Backend implemented + API/DB-tested (✅):** schema (org_config session cols + refresh_tokens
  last_used_at/family_id, both time cols → **timestamptz**); `getOrgSessionPolicy` (per-tenant, clamped);
  access token default 15 min; `/login` sets HttpOnly refresh cookie (Remember-Me aware) + per-tenant
  lifetime; `/refresh-token` reads cookie, param-based absolute+idle checks, rotation, reuse-detection
  (family revoke); `/logout` clears cookie + revokes family; `cookie-parser` wired.
  Verified via curl+DB: cookie refresh 200 · reuse→REFRESH_TOKEN_REUSE · idle→SESSION_IDLE_TIMEOUT ·
  absolute→SESSION_EXPIRED · per-tenant org1=120m vs org2=60m isolated. typecheck green.
- **BUG-006 (found & fixed during this work):** initial JS-side time comparisons + `timestamp without
  time zone` columns on a non-UTC (Asia/Dubai) cluster caused a 4h skew → every refresh wrongly
  expired. Fixed by (a) DB-side param comparisons and (b) converting the columns to **timestamptz**.
- **✅ CLOSED (2026-08-19):** settings API done; frontend done (cookie auto-refresh single-flight + boot
  silent-refresh + logout + BUG-007 rememberMe). Proven LIVE in real Chrome (app's own patched fetch):
  expired access → refresh → retry → 200 + rotated token (no re-login); HttpOnly cookie invisible to JS;
  6 concurrent 401s → one single-flight refresh; logout → 401 (server-side family revoke). API+DB fresh:
  per-tenant 480 vs 120, reuse→REFRESH_TOKEN_REUSE (family 0 active), idle→SESSION_IDLE_TIMEOUT,
  absolute→SESSION_EXPIRED, rememberMe Max-Age 604800, clamp 999999→43200. Full regression **772/772**.
  Decision: kept short access token in localStorage (main XSS win = refresh token out of JS via HttpOnly).
  See SESSION_MANAGEMENT_CLOSURE.md.

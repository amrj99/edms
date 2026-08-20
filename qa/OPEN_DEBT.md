# ArcScale — Open Debt Log

Tracked non-blocking issues. Each item: severity, status, evidence, proposed fix. Items here do NOT block
the current classification unless promoted. See `FIRST_CUSTOMER_GO_LIVE_REPORT.md` for the go-live gates.

---

## DEBT-001 — F2: malformed body / disallowed-origin preflight return HTTP 500
- **Severity:** LOW · **Status:** OPEN (does NOT block Pilot) · **Opened:** 2026-08-19 (C1 review)
- **What:** `OPTIONS` preflight from a disallowed CORS origin, and a malformed-JSON request body, return
  **500** instead of a clean 4xx (400/403). Origin: the CORS `origin` callback throws
  `new Error("Not allowed by CORS")` → surfaces as 500; and Express's `express.json()` parse error is not
  mapped to 400.
- **Why it's only LOW:** verified **no information leak** (no stack trace, no SQL in the response bodies), and
  the disallowed origin still receives **no** `Access-Control-Allow-Origin` (the browser blocks it regardless).
  It is a wrong status code / error-handling tidiness issue, not a security or data-safety hole.
- **Evidence:** `c1-probes.mjs` — `malformedJson_status: 500` (`malformed_leaksStack: false`);
  `OPTIONS … Origin: https://evil.example.com → 500`.
- **Proposed fix (when picked up):** add an Express error handler that maps the JSON `SyntaxError` (body-parser)
  to `400`, and have the CORS `origin` callback resolve with `false` (clean rejection, no ACAO) instead of
  throwing — yielding a 403/no-CORS response rather than 500.

## DEBT-002 — ✅ ROOT CAUSE FIXED (R2 CORS) — full E2E still blocked by DEBT-005
- **Severity:** HIGH · **Status:** **CORS FIX VERIFIED 2026-08-20** (owner added `https://www.arcscale.org` to
  the `edms-files` R2 bucket Allowed Origins, keeping `https://arcscale.org`; methods/headers unchanged). Live
  re-test on production: the browser CORS **preflight OPTIONS to R2 now returns 204** (was 403) and the file
  **uploaded to R2** ("69 B · uploaded", green check) — the browser→R2 upload path works. **NOT fully closed:**
  the complete Upload-Document journey cannot finish because the subsequent document-record create returns 500
  — see **DEBT-005** (separate backend bug, unrelated to CORS). Close DEBT-002 once the full E2E
  (create → appears in UI → download → hash match) passes after DEBT-005 is resolved.
- **Original severity/context:** HIGH · Go-Live blocker (accepted by owner 2026-08-19) · found 2026-08-19 via
  real Chrome journey on `https://www.arcscale.org`.
- **Constraint:** do NOT change R2/Cloudflare config yet — first inspect the bucket's CURRENT CORS (read-only),
  then apply the *minimum* change. Re-test upload E2E from Chrome after the fix (request-url → PUT to R2 →
  create document → appears in UI → download → file matches).
- **What:** Production stores files in **Cloudflare R2** (bucket `edms-files`). The upload flow is:
  `POST /api/storage/uploads/request-url` → 200 (returns a presigned R2 PUT URL) → the browser then issues a
  cross-origin **PUT** to `https://edms-files.<acct>.r2.cloudflarestorage.com/...?...PutObject`. The browser's
  **CORS preflight `OPTIONS` to R2 returns 403**, so the PUT never runs → the UI shows *"Network error during
  upload"* for every file. Reproduced with a valid PNG (real 69-byte File injected into the input); the 403 is
  origin/method/header-based (not file-content or auth related — `request-url` already authenticated fine).
- **Evidence:** network trace — `request-url` 200 (mode cloud, `edms-files` org_15 presigned URL) ·
  `OPTIONS …r2.cloudflarestorage.com/org_15/projects/0/…_r1-real.png?…PutObject` → **403** · UI: 5/5 attempts
  "Network error during upload".
- **Likely cause:** the R2 bucket has no CORS rule permitting cross-origin `PUT` from `https://www.arcscale.org`,
  OR its `AllowedHeaders` omits the AWS SDK v3 checksum headers the presigned PUT sends
  (`x-amz-checksum-crc32`, `x-amz-sdk-checksum-algorithm`, `content-type`).
- **Fix (owner / Cloudflare — infra, not code):** add a CORS policy to the `edms-files` R2 bucket allowing
  `AllowedOrigins: ["https://www.arcscale.org"]`, `AllowedMethods: ["PUT","GET","HEAD"]`,
  `AllowedHeaders: ["*"]` (or explicitly include the `x-amz-checksum-*` + `content-type` headers),
  `ExposeHeaders: ["ETag"]`. Then re-test upload E2E via the browser.
- **Note:** This is separate from R1 email. It surfaced while confirming the post-verification upload step.

## DEBT-003 — 🔴 HIGH: Session Management Hardening NOT deployed to Production
- **Severity:** HIGH · **Status:** OPEN — **Go-Live BLOCKER (accepted by owner 2026-08-19).** Session
  Management is closed on **staging/code only**, NOT on Production.
- **What:** Production (`https://www.arcscale.org`) still runs the **pre-hardening auth** build. Observed live:
  during the R1 journey the access token expired mid-session and **nothing auto-refreshed it** — a protected
  call (`/api/storage/uploads/request-url`) returned `401 "Invalid or expired token"` and the app did not
  transparently recover; re-login was required. This matches the old behaviour the Session Management
  Hardening fixed (short access token, no auto-refresh) — confirming the new build is not live in prod.
- **Impact:** the closed Session Management guarantees (transparent auto-refresh, per-tenant 8h/idle/absolute,
  cookie-based refresh, server-side logout revocation) do **not** hold on Production yet.
- **Required before Go-Live:** deploy the current build (which includes migration `0033_session_hardening` and
  the new auth) to Production, then **re-run the Session scenarios on Production**: auto-refresh (no 15/30-min
  eviction), idle timeout, absolute expiry, refresh-token reuse, and server-side logout revocation. Until then,
  **Session Management is NOT closed for Production** (it remains closed for staging/code — see
  `SESSION_MANAGEMENT_CLOSURE.md`).

## DEBT-004 — 🟠 MEDIUM: upload presign endpoint lacks read-only role gate
- **Severity:** MEDIUM (within-org privilege gap; not cross-tenant) · **Status:** **FIXED IN CODE 2026-08-20**
  (release branch `release/rc-session-cors-optin-debt004`) — pending production verification (Reviewer presign
  → 403 on prod after deploy). Found 2026-08-19 during the R1 Reviewer permission cross-check on Production.
- **Fix applied:** `routes/storage.ts` `POST /uploads/request-url` — the **project-scoped intra-org** path now
  resolves the effective role and requires `DocumentPermissions.canCreate` (mirrors `documents.ts:351`), so a
  read-only role (reviewer/member/viewer) that is a project member gets **403** instead of a presigned URL.
  Regression: `test/debt-004-request-url-role-gate.test.ts` (admin/DC/PM → 200; reviewer/member/viewer → 403;
  cross-tenant outsider → 403).
- **Scope note (deliberate):** the **no-projectId general-upload** path (own-org, non-project files such as
  correspondence attachments) is **NOT** gated — existing design allows intra-org members there
  (pinned by `party-model` "contributor without projectId uses own org bucket"). Whether to also restrict
  read-only roles on that general path is a **separate product decision**, not the proven vulnerability (which
  was project-scoped). Left open intentionally to avoid regressing the correspondence-attachment flow.
- **What:** `POST /api/storage/uploads/request-url` enforces only project access + party ceiling
  (`canAccessProject`), **not the caller's role**. An intra-org **read-only** user (reviewer / viewer / member)
  who is a project member receives **HTTP 200 with a valid presigned R2 PUT URL** (verified live: reviewer
  `d.khanfar86@gmail.com` → 200). BUG-005 added `DocumentPermissions.canCreate` gates to document create
  (`documents.ts:351`) and the files POST (`documents.ts:1394`), but the **presign** endpoint was not gated.
- **Impact:** a read-only user cannot create a document *record* (create returns 403 in the current tree), but
  can obtain a presigned URL and write orphan objects into their own org's storage bucket (storage abuse /
  unexpected writes). No cross-tenant exposure.
- **Fix (small, in code):** in `routes/storage.ts` `POST /uploads/request-url`, after resolving project access,
  add a role gate for intra-org callers — `resolveEffectiveRole(caller, projectId)` then
  `if (!DocumentPermissions.canCreate(effRole)) return 403` (mirroring `documents.ts:351`). Re-test: reviewer → 403.
- **Related observation (not a current-tree bug):** on Production, document create by a reviewer returns **500
  INTERNAL_ERROR** (no document is created — not an escalation). The current code tree already returns a clean
  **403** via the `canCreate` gate, so this is Production running the pre-fix build — folds into DEBT-003
  (deploy the current build).

## DEBT-005 — 🔴 HIGH: document creation returns 500 on PRODUCTION for ALL roles (core function down)
- **Severity:** HIGH · **Status:** OPEN — **Go-Live BLOCKER.** Found 2026-08-20 completing the post-CORS upload
  re-test on `https://www.arcscale.org`.
- **What:** `POST /api/projects/:id/documents` returns **500 `{"error":"INTERNAL_ERROR"}`** on Production —
  verified as **admin** (role that has `canCreate`) with a minimal payload (`{title, direction:"outgoing"}`),
  and again during the real Upload-Document dialog (3× 500 after the file uploaded to R2 successfully). So a
  document **record** cannot be created on Production by anyone right now — the core "add a document" function
  is down, independent of the CORS/upload fix.
- **Evidence:** file uploaded to R2 OK (OPTIONS 204, "uploaded"), then `POST …/documents` → 500 ×3 in the
  network log; a direct minimal admin create → `500 INTERNAL_ERROR`.
- **Diagnosis:** the **current code tree returns 201** for the same create on staging (C3 test:
  `C3_document_status: 201`). So this is **Production running an old/broken build** (or a prod-only config/data
  issue in the create path — numbering/metadata/storage) — most likely resolved by **deploying the current
  build (DEBT-003)**. Server stack trace not accessible from here (no VPS/log access).
- **Next step:** deploy the current build to Production, then re-run the full Upload-Document E2E (create →
  appears in UI → download → hash match) to close both DEBT-002 and DEBT-005.
- **Note:** the CORS re-test left one **orphan object** in R2 (`org_15/projects/0/…_r1-cors-fixed.png`) with no
  document record (create 500'd). Harmless; in the test tenant. Not deleted (no prod-data deletion without
  approval).

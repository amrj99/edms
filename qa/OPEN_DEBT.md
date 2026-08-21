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
- **Severity:** HIGH · **Status:** **ROOT CAUSE FIXED + PERMANENT MIGRATION ADDED 2026-08-21.** Production was
  hot-fixed 2026-08-20 by adding the missing constraint (`ALTER TABLE ... ADD CONSTRAINT doc_seq_scope_unique`
  — safe: constraint absent + 0 duplicate rows), and doc-create then returned 201. The schema drift is now
  represented permanently in Git as migration **`0034_document_sequences_unique_repair.sql`** so every future
  deploy (and any other baselined DB) is repaired without manual steps. Full production Upload-Document E2E
  (create → UI → download → hash) still to be re-confirmed post-deploy together with DEBT-002/DEBT-006.
- **Permanent fix (migration 0034):** idempotent `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
  conname='doc_seq_scope_unique') THEN ALTER TABLE document_sequences ADD CONSTRAINT doc_seq_scope_unique
  UNIQUE (project_id, organization_id, discipline, doc_type); END IF; END $$;`. Additive-only, guarded, safe
  to re-run. Journal entry `0034_document_sequences_unique_repair` added via `drizzle-kit generate --custom`.
- **Migration proof (2026-08-21, disposable UTF-8 DB via the real runtime migrator `dist/migrate.mjs`):**
  (1) migrate-from-clean 0000..0034 → constraint present + `contype='u'`; the exact auto-numbering
  `INSERT … ON CONFLICT (…) DO UPDATE SET last_seq = document_sequences.last_seq + 1` returns 1 then 2;
  (2) idempotent re-run → success; (3) re-apply 0034 with the constraint ALREADY present (the prod-after-manual
  -ALTER state / "next deploy won't fail") → `IF NOT EXISTS` skip, constraint count stays **exactly 1**, no error.
- **Regression (permanent):** `test/debt-005-auto-numbering.test.ts` — asserts `doc_seq_scope_unique` exists and
  is UNIQUE on the four scope columns on a clean schema; two creates in one scope (numbering format with `{SEQ}`,
  no explicit documentNumber → forces the ON CONFLICT path) → **201** each with an incrementing sequence; a
  different discipline scope uses its own counter. 3/3 green; full suite 787/787.
- **Original context (kept for history):** Found 2026-08-20 completing the post-CORS upload re-test on
  `https://www.arcscale.org`.
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

## DEBT-006 — 🔴 HIGH: R2 object download returns 404 (files uploaded but not retrievable)
- **Severity:** HIGH · **Status:** **ROOT CAUSE PROVEN + FIXED IN CODE 2026-08-21** — pending production
  verification (full upload → download → hash after deploy). Go-Live blocker until the E2E confirms.
- **What:** `GET /api/storage/r2-object/<objectKey>` returned **404 "Cannot GET …"** on Production for a valid
  R2 object (objectKey = `org_15/projects/0/<file>.png`), so an uploaded file could not be downloaded.
- **Root cause (PROVEN, not guessed):** the R2 object key contains slashes. In front of the API, nginx
  `location /api/ { proxy_pass http://api:8080/api/; }` — proxy_pass **with a URI** normalises the request and
  **decodes `%2F` → `/`**, so the key reaches Express with **raw** slashes. The old route used a single-segment
  param `"/r2-object/:objectKey"` (Express 5: `:param` = `[^/]+`), which **cannot match a multi-slash path** →
  404. Verified with two throwaway Express 5.2.1 repro scripts: `:objectKey` + `%2F` (encoded) → 200, but
  `:objectKey` + **raw** slashes → 404 "Cannot GET" (exactly the prod symptom); `*objectKey` (splat) + raw
  slashes → 200 with the rejoined key. The first hypothesis (Express breaks the *encoded* param) was **falsified**
  by the repro before any code change — the true cause is nginx decoding + single-segment routing.
- **Fix (small, in code — `routes/storage.ts`):** change the download routes from a single-segment param to a
  **splat**: `"/r2-object/*objectKey"` and `"/s3-object/*objectKey"`. Express 5 delivers the splat as a string
  array; the handler and the `requireAuthOrViewToken` view-token binding rejoin it with `.join("/")`
  (`Array.isArray(k) ? k.join("/") : …`). Now both encoded (`%2F`) and raw-slash requests match.
- **Authorization / isolation reviewed AT THE SAME TIME (no IDOR opened):** the pre-existing guards are
  **preserved** and now covered by tests — `requireAuthOrViewToken` (401 if neither), `s3KeyBelongsToOrg`
  (403 if the key prefix ≠ the claimed org), and `assertOrgAccess` (403 real cross-tenant guard). Verified:
  Tenant B requesting Tenant A's key **via `?orgId=A`** → 403; Tenant B requesting Tenant A's key with **no
  orgId** (orgId derived from the `org_A/` prefix — the "attacker knows the key" case) → 403; unauthenticated →
  401; owner → 302 redirect to a presigned GET URL (both raw-slash and encoded forms).
- **Regression (permanent):** `test/debt-006-r2-download-route.test.ts` — 5/5 green (routing: raw-slash + encoded
  → 302; isolation: 401 / 403×2). Typecheck 0, build 0, full suite 787/787.
- **Production verification still required (post-deploy):** Admin upload → R2 PUT → document create (201) →
  appears in UI → download → **sha256 match**; then confirm a read-only/unauthorized role cannot download what it
  shouldn't, Tenant B cannot download Tenant A's file even with the object key/URL, and **old R2 files remain
  downloadable**. Closes DEBT-002 + DEBT-006 together.

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

## DEBT-002 — ✅ CLOSED: R2 upload→download full round-trip works LIVE (SHA-256 match)
- **Severity:** HIGH · **Status:** **CLOSED 2026-08-21** by live Production evidence (build `3375200`).
- **Journey (why closure was delayed, and how it was resolved):** the original blocker was R2 **CORS** — fixed
  by adding `https://www.arcscale.org` to the `edms-files` bucket Allowed Origins (preflight `OPTIONS` → 204).
  Final closure was then delayed by two further, independent defects surfaced by careful live testing:
  first the **upload presign** (flexible-checksum → **DEBT-007**), then the **download / view-token** delivery
  (**DEBT-008**). With both resolved, the **complete round-trip now passes on Production**.
- **Live proof (`https://www.arcscale.org`, project 16, org 15, real UI + navigation-equivalent no-Bearer
  requests):** R2 PUT → **200** · document create → **201** (doc 75) · appears in UI · download via view-token
  (no Bearer) → serve **302** → R2 → **512 bytes** · **SHA-256 source == downloaded → MATCH** · an old R2 file
  (Capture.PNG) still downloads (real PNG bytes) · token(A) cannot open file(B) → **403** · cross-tenant → **403**
  · invalid token → **401**.

### DEBT-002 (original) — ✅ ROOT CAUSE FIXED (R2 CORS) — full E2E still blocked
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

## DEBT-003 — ✅ CLOSED: Session Management Hardening deployed + verified LIVE on Production
- **Severity:** HIGH · **Status:** **CLOSED 2026-08-21** by live Production evidence (build `bd4658e`).
- **Live proof (`https://www.arcscale.org`, real authenticated session):** `POST /api/auth/refresh-token`
  (HttpOnly `edms_rt` cookie) → **200** with a fresh access token that then authenticates `GET /api/auth/me`
  → silent auto-refresh works. `POST /api/auth/logout` → **200**; the subsequent `refresh-token` → **400**
  (cookie cleared) → the session cannot be renewed after logout. Reuse-detection / rotation / idle / absolute
  remain covered by the regression suite (`SESSION_MANAGEMENT_CLOSURE.md`). The pre-hardening behaviour
  (access token expiring with no auto-refresh) is gone.
- **History:** Session Management was closed on staging/code 2026-08-19 but not deployed; the current build
  carries migration `0033_session_hardening` + the new auth and is now live.
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

## DEBT-005 — ✅ CLOSED: document auto-numbering fixed + verified LIVE on Production
- **Severity:** HIGH · **Status:** **CLOSED 2026-08-21** by live Production evidence (build `bd4658e`,
  migration `0034`). Live proof on `https://www.arcscale.org` (project 16, org 15, admin): automatic numbering
  `POST /api/projects/16/documents` with no documentNumber → **201** `R1-VER-ARC-DWG-001` then **201**
  `R1-VER-ARC-DWG-002` (sequential, format `{PROJECT}-{DISCIPLINE}-{TYPE}-{SEQ}`), i.e. the `ON CONFLICT`
  upsert works → the `doc_seq_scope_unique` constraint is present; manual numbering with an explicit number →
  **201** stored verbatim. `0034` applied on Production (entrypoint migrate succeeded; API healthy).
- **Historical detail (kept below):** Production was
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

## DEBT-006 — ✅ CLOSED (routing/auth/isolation): R2 download route no longer 404
- **Severity:** HIGH · **Status:** **CLOSED 2026-08-21 for the routing/authorization/isolation defect** by live
  Production evidence (build `bd4658e`). **Note:** the *full* upload→download→SHA-256 round-trip could NOT be
  exercised live because R2 browser **upload** is broken by a separate, pre-existing defect — see **DEBT-007**.
  The download route itself is proven working.
- **Live proof (`https://www.arcscale.org`):** unauthenticated `GET /api/storage/r2-object/<raw/slash/key>` →
  **401** (route matches, guard fires) — the old build returned **404 "Cannot GET"**; a genuinely missing route
  still → 404 (control). Authenticated owner request → **302** (opaqueredirect: route matched + presigned URL
  generated). Cross-tenant: claiming another org's id → **403**; another org's key with own orgId (prefix
  mismatch) → **403**. So the splat routing fix + `s3KeyBelongsToOrg` + `assertOrgAccess` all hold on Production.

## DEBT-007 — ✅ RESOLVED (upload): checksum-free presign deployed; real-UI upload works LIVE
- **Severity:** HIGH · **Status:** **RESOLVED 2026-08-21** for the upload path. Fix `requestChecksumCalculation:
  "WHEN_REQUIRED"` deployed in build `8ce1a9b`; the presigned PUT URL on Production is now checksum-free
  (verified live). **Real-UI upload confirmed working on Production** (owner manually uploaded a file via the
  ArcScale UI in project 16 → the document appeared) — this is *manual real-browser* evidence, the authoritative
  signal. **Evidence separation (important):** the earlier automated `fetch`-based PUT "failures" were
  **automation-tooling artifacts** (the CDP browser layer + the app's fetch interceptor injecting Bearer),
  NOT the product — do not count them against the product now that the manual real upload has succeeded.
- **Note:** DEBT-007 covered the *upload* leg only. The full Upload→Download journey is still not complete
  because the *download* leg is broken — tracked separately as **DEBT-008**. DEBT-002 therefore stays OPEN.
- **Original diagnosis (kept for history):** Found 2026-08-21 during the post-deploy live
  Upload E2E on `https://www.arcscale.org` (build `bd4658e`). **Pre-existing** (not introduced by this deploy —
  see version note below); surfaced by careful live testing.
- **What:** the browser `PUT` to the R2 presigned upload URL fails for **every** body (empty and non-empty,
  with and without checksum request headers). The CORS **preflight `OPTIONS` returns 204** (origin allowed), so
  this is NOT the DEBT-002 origin issue; the **actual `PUT`** is rejected and its response carries no
  `Access-Control-Allow-Origin`, surfacing in the browser as *"Failed to fetch"*. Net effect: a document
  **record** is created but the file **bytes never reach R2** → real customer uploads do not complete.
- **Evidence (live, org 15 / project 16, admin session):** `request-url` → 200 (mode r2). Presigned PUT query
  contains `x-amz-checksum-crc32=AAAAAA%3D%3D` (CRC32 of an **empty** body) + `x-amz-sdk-checksum-algorithm=CRC32`
  while `X-Amz-SignedHeaders=host` only. Network trace: `OPTIONS …r2.cloudflarestorage.com/… → 204`, then the
  `PUT` → "Failed to fetch". Reproduced 3× (empty body; 5-byte body; empty body + matching checksum headers).
- **Hypothesised root cause (NOT yet proven — do not treat as final):** `@aws-sdk/client-s3@3.1020.0` defaults
  `requestChecksumCalculation` to `WHEN_SUPPORTED`, so `getSignedUrl(PutObjectCommand)` bakes the flexible-checksum
  params into the presigned URL; `buildR2Client()` in `artifacts/api-server/src/lib/orgStorage.ts` does not set
  `requestChecksumCalculation`. Candidate fix: set `requestChecksumCalculation: "WHEN_REQUIRED"` on the S3Client.
  **Must be proven** by reproducing the presigned URL before/after the setting in a controlled env (params
  disappear) + a real/integration PUT of a non-empty payload succeeding, before applying.
- **Version note (why this is not a deploy regression):** `@aws-sdk/client-s3@3.1020.0` was already pinned in
  `pnpm-lock.yaml` at the previously-deployed build `2a20950`, i.e. the SDK version did not change with this
  deploy. Whatever earlier report suggested "upload worked" needs re-verification; the current live evidence is
  that browser upload does not complete.
- **Do NOT close** DEBT-002 or DEBT-007 until the full chain passes live: UI upload → request-url → OPTIONS 204
  → **PUT success** → create 201 → visible in UI → download 200/redirect → **SHA-256 match**; plus cross-tenant
  download 403, unauthorized upload/presign still blocked, and an old R2 file still downloadable.
  *(Upload leg resolved 2026-08-21 — DEBT-007. Download leg → DEBT-008.)*

## DEBT-008 — ✅ CLOSED: R2/S3 browser download via view-token
- **Severity:** HIGH · **Status:** **CLOSED 2026-08-21** by live Production evidence (build `3375200`).
- **Dual root cause (both proven by test before fixing):**
  1. **Frontend** appended the view-token as `${url}?vt=${token}` onto a serve URL that already carried a query
     (`?orgId=…`), producing a malformed `?orgId=…?vt=…` where `vt` was swallowed → a bare navigation carried no
     usable token → **401**.
  2. **Backend** compared the token's raw URL string (`payload.url`, encoded key + `?orgId`) against
     `expectedPathFn` (decoded, no query) verbatim → valid R2/S3 tokens never matched → **403**.
- **Final fix:** a single central frontend helper `withViewToken()` (correct query merge; all download/preview
  sites routed through it, no manual concatenation left) + backend **canonical** comparison via
  `canonicalizeStorageServeUrl` (drop query, percent-decode, normalise slashes). **Object binding and tenant
  isolation stay proven** — the full object key remains in the canonical form, so token(A) still fails for
  file(B) and any orgId/key change is rejected; cross-tenant, soft-delete, expiry, and `view_file` token type
  are unchanged (negative regression tests + live 403/401 confirm).
- **Regression:** `api-server/test/debt-008-download-view-token.test.ts` (10 — incl. R2/S3/on-premise + 4
  negatives) and `edms/src/lib/view-url.test.ts` (5). Live round-trip: SHA-256 match (see DEBT-002).
- **reviewer/read-only presign (context, NOT reopened):** reviewer **project-scoped `request-url` → 403** was
  already proven LIVE on Production and has a permanent regression (`debt-004-request-url-role-gate`); this
  release did not touch that write-gate. DEBT-004 stays as-is.
- **Discovery context (history):** found 2026-08-21 by real browser navigation; pre-existing R2/S3-specific
  defect, masked by the DEBT-006 404 and exposed once routing was fixed. NOT R2 (healthy — server-side
  `aws s3 ls` works), NOT CORS (preflight 204), NOT introduced by any of these deploys.
- **Two symptoms proven by the REAL manual test (not `fetch`, which injects Bearer):**
  1. **navigation without a valid view-token → 401 "No token provided".** The download opens the R2/S3 serve
     URL via a top-level navigation (no `Authorization` header); the serve route requires a bearer OR a `?vt=`
     view-token, so it returns 401. Observed URL: `…/r2-object/org_15%2F…Capture.PNG?orgId=15` → 401.
  2. **attempt with `&vt=<token>` reached view-token validation but returned 403.** The token *was* parsed, but
     the route rejected it — **suspected** representation mismatch between the URL signed into the token
     (`payload.url`, e.g. the serveUrl WITH `?orgId=15` and a percent-encoded key) and the path built by the
     serve route's `expectedPathFn` (decoded, no query). **This query/encoding explanation is a HYPOTHESIS and
     must be proven by a backend test before any code change** (per owner instruction).
- **Contributing frontend defect (to be proven by a reproducer):** the download sites append the token as
  `${url}?vt=${token}`, but `r2ServeUrl`/`s3ServeUrl` already end with `?orgId=…`, so the result is a malformed
  `?orgId=15?vt=…` where `vt` is swallowed into the `orgId` value and never parsed. On-premise serve URLs have
  no query and are unaffected. Sites: `documents.tsx`, `project-detail.tsx`, `DocumentFilesPanel.tsx`,
  `use-preview-url.ts` (+ any others a search reveals).
- **Fix plan (owner-approved, NOT yet applied; reproducer-first):**
  1. Reproducer/regression BEFORE the fix — (a) frontend: a realistic serveUrl containing `?orgId=15` +
     current concatenation → `vt` is unparseable; (b) backend: a view-token minted from the current serveUrl is
     rejected by `expectedPathFn` comparison. Do not treat the query/encoding cause as fact until (b) proves it.
  2. Frontend: ONE central helper that appends the view-token with correct URL/query handling; route all sites
     through it (no manual `${url}?vt=` concatenation anywhere).
  3. Backend: apply the **minimum** safe canonicalization to the `payload.url` vs `expectedPath` comparison ONLY
     if the reproducer proves the mismatch — WITHOUT weakening binding: a token for file A must still fail for
     file B, and changing `orgId`/object key must still fail. Preserve cross-tenant isolation, org validation,
     soft-delete restrictions, expiry, and `view_file` token type. Add negative tests for all of these.
  4. Verify R2 + per-org S3 + on-premise all still work (shared helper/auth).
  5. Release Gate; then stop for approval before commit/push/deploy. Close only after the full live journey
     passes from the **real UI/navigation** (not `fetch`).
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

## DEBT-009 — 🔴 HIGH (SECURITY): Cross-tenant IDOR on by-id / nested-resource endpoints
- **Severity:** HIGH · **Status:** OPEN — **Go-Live BLOCKER.** Found 2026-08-21 during the Final Security /
  Penetration Review on Production (build `3375200`). **Confirmed exploitable on Production**, read-only, by any
  authenticated tenant admin via ID enumeration — NO code change had been made when this was observed.
- **Confirmed live (org 15 admin `arcscaleedms@gmail.com` read org 1 / platform data):**
  - `GET /api/users/:id` → **200** for ANY user in ANY org — returned org 1's viewer (`amr_j_99@yahoo.com`),
    org 1's **admin** (`archscale-admin@archscale.com`), and the platform **system_owner**
    (`amr_j_98@hotmail.com`): email, name, role, organizationId, department, projectMemberships.
  - `GET /api/projects/:id/members` → **200** — members of another org's project (even though `GET
    /api/projects/:id` itself correctly returns 403).
  - `GET /api/tasks/:id` → **200** — another org's task.
- **Scope note:** the primary resource endpoints DO enforce isolation (`projects/:id`, `documents/:id`,
  `organizations`, `/projects/:id/documents`, list `/users` → 403/scoped). The gap is on several **by-id /
  nested / secondary** handlers that look up by ID **without also constraining by organizationId**. Do NOT
  assume an endpoint is safe because its list endpoint is safe.
- **Suspected (NOT proven — was NOT executed on Production to avoid a destructive action):**
  `POST /api/users/:id/reset-password` and other state-changing admin/account/file actions — **suspected
  high-risk path requiring code + test review**. If the same missing tenant-scope applies to a state-changing
  action, it could enable **cross-tenant account takeover (Critical)**. Must be tested ONLY in isolated
  test/staging, never on Production.
- **Required closure (post-deploy, live):** cross-tenant on `users/:id`, `projects/:id/members`, `tasks/:id`,
  and every additional path the inventory flags → **403/404**; reset-password / action routes cross-tenant →
  blocked (destructive test on isolated env only); own-tenant behaviour still works; **system_owner** global
  behaviour intact.
- **Fix direction (architectural, minimal):** a trusted central guard/helper
  (`assertResourceBelongsToOrg` / `loadResourceInOrg` / uniform tenant-scoped query) so every tenant-user
  resource lookup is constrained by resource ID **AND** organizationId together — never trusting a client
  `orgId`. Preserve `system_owner` global scope. Reproducer-first (Tenant A/B), then fix, then full re-sweep.

### DEBT-009 — FIX APPLIED (in code) 2026-08-21 — pending Production verification
- **Root cause:** `isSysAdmin` (= admin || system_owner) was used as a **cross-org bypass** in several handlers
  and in two shared `getOrgId` helpers (departments, entities) that honoured a client `?orgId`; plus a set of
  project-scoped / by-id routes did **no** org binding at all.
- **Fix (three-pronged, minimal, no rewrite):**
  1. **Central helpers** `getOrgId` (departments.ts, entities.ts): `isSysAdmin`→`isSystemOwner` — closes all
     entities + departments cross-org routes in two lines. Never trusts client `?orgId`.
  2. **Inline bypasses** `isSysAdmin`→`isSystemOwner` at the tenant-isolation checks in users (`/:id` + the
     `?projectId` list branch), tasks, projects (members GET/POST), meetings, general, documents `/:id/revisions`,
     calendar. (Within-org role gates that legitimately use `isSysAdmin` were left unchanged.)
  3. **New shared guard** `lib/tenant-guards.ts` `assertProjectAccess(req,res,projectId)` (delegates to the
     trusted `canAccessProject`, `system_owner`-only global bypass) applied to project-departments,
     project-governance, project-role-overrides, submission-chains create; and resource↔projectId binding
     (`and(id, projectId)`) added to documents (activity/reviews/approve/reject/departments), transmittals
     (history/suggest-links), global-documents (revisions); plus explicit org/originator checks on
     projects & departments member-delete and submission-chains setup-parties.
- **`system_owner` global scope preserved** everywhere (verified by tests + full suite).
- **Verification (code):** typecheck 0 · build 0 · **full backend suite 836/836** (clean candidate, no billing) ·
  **41 permanent IDOR regression tests** (`security-idor-tenant-isolation.test.ts` 11 +
  `security-idor-tenant-isolation-extended.test.ts` 30) covering own-tenant works / cross-tenant 403-404 /
  spoofed-orgId rejected / lower-role no escalation / system_owner global / **no-data-change after reject** for
  WRITE/DELETE/ACCOUNT · an independent IDOR **re-sweep** re-audited all 15 files (it caught 2 misses —
  `users.ts` `?projectId` list branch + `submission-chains` create — both then fixed and re-tested).
- **Still OPEN until Production verification (post-deploy):** on Production confirm cross-tenant `users/:id`,
  `projects/:id/members`, `tasks/:id`, and the full inventory list → 403/404; own-tenant works; system_owner
  intact; account/reset-password cross-tenant blocked (destructive tests on isolated env only). Do NOT close
  DEBT-009 (and do NOT declare GO-LIVE) until this live pass succeeds.

## DEBT-SEC-A — 🔴 HIGH (SECURITY): runtime DB role is SUPERUSER + BYPASSRLS
- **Severity:** HIGH · **Status:** OPEN — **Go-Live BLOCKER.** Found 2026-08-22 (read-only diagnostic on
  Production): `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user` → **`edms` = t / t**.
- **Impact:** the application connects as a PostgreSQL **superuser with BYPASSRLS** that also owns all 13
  tenant tables. Consequences: (1) **RLS is 100% inert** for the app — every RLS policy + `FORCE ROW LEVEL
  SECURITY` is bypassed, so there is NO database-layer isolation backstop; the only tenant isolation is the
  application layer (DEBT-009). (2) Least-privilege violation — any SQL-injection or app compromise = full DB
  control (all tenants, DROP, `COPY PROGRAM` OS exec). Fix = least-privilege role separation (DEBT-010 step 1).

## DEBT-010 — 🔴 HIGH: real DB-layer tenant isolation (RLS) + least privilege (EPIC)
- **Severity:** HIGH · **Status:** IN PROGRESS (isolated env). Defense-in-depth so a forgotten app-layer check
  cannot leak across tenants. **All work on isolated env; production cutover is a separate gated deploy.**
- **① fail-closed RLS policy — ✅ DONE (in code, proven on isolated env) 2026-08-22:** the previous policy was
  **fail-OPEN** (missing `app.current_org_id` ⇒ "sysadmin bypass" ⇒ all tenants' rows visible; `organization_id
  IS NULL` always visible) and had **no `WITH CHECK`**. Rewritten in `lib/rls-init.ts` (+ mirror in
  `test/global-setup.ts`) to **fail-closed**: `USING/WITH CHECK ( current_setting('app.is_system_owner',true)
  ='true' OR organization_id = NULLIF(current_setting('app.current_org_id',true),'')::int )`. Missing context ⇒
  both NULL ⇒ deny (0 rows). `app.is_system_owner` is server-set only (never client-settable);
  `middlewares/rls-context.ts` now sets both vars. **Proof:** `test/rls.test.ts` — 16 tests under a
  non-superuser `rls_tester` role: cross-tenant read 0 · own-org visible · **missing-context 0 (was fail-open)**
  · **WITH CHECK blocks cross-org INSERT** · cross-org UPDATE affects 0 rows + data unchanged · system_owner
  global only via the flag. typecheck 0 · full suite 847/847. **Safe to deploy (no prod behaviour change while
  the app role is still superuser — policy is inert until the role cutover).**
- **② role separation — ✅ PROVEN on isolated env 2026-08-22:** a throwaway proof built a fresh DB (real
  schema via the migrator), transferred table ownership to `edms_migrator`, created least-privilege `edms_app`
  (LOGIN/NOSUPERUSER/NOBYPASSRLS), applied grants + `ALTER DEFAULT PRIVILEGES`, then connected AS `edms_app`
  and passed the full checklist: not superuser/bypassrls · owns 0 tables · own-tenant visible · cross-tenant 0
  · missing-context 0 (fail-closed) · system_owner global via flag · WITH CHECK blocks cross-org INSERT · no
  DDL · default privileges give future migrator tables auto-DML. (Production cutover = still gated.)
- **③ transaction-local RLS context (path A) — ✅ DONE on isolated env 2026-08-22:** `@workspace/db` now has
  `AsyncLocalStorage` + `currentDb()` + `runInTenantTx()` + a `db` Proxy (all 829 `import { db }` sites route
  into the request's tenant transaction with zero changes; pool-backed outside a request). External-I/O
  inventory first (read-only): no AI/HTTP in handlers; storage is I/O-then-DB (Phase 1/2); email is best-effort
  post-commit; `correspondence send` email is awaited but OUTSIDE any transaction (auto-commit) — no change
  needed. Proof `test/db-context-a3.test.ts` (8): same-tx/context · outside-scope=pool · concurrent A/B no
  context leak · pool-reuse clean · missing-context 0 (fail-closed, non-superuser) · own-only · **no silent
  wider fallback**. typecheck 0 · full suite **854/854** (Proxy is transparent). *(Remaining for cutover: wire
  a per-request middleware that calls runInTenantTx — with the few I/O handlers kept as short units-of-work.)*
- **④ verify-security-posture — ✅ DONE 2026-08-22:** `ops/verify-security-posture.sql` fails the deploy if the
  runtime role is superuser/bypassrls, owns a tenant table, or a required table lacks ENABLE+FORCE / its single
  org_isolation_policy, or the fail-closed no-context smoke returns >0 rows. Proven both ways on isolated env
  (FAILS as `postgres` superuser, POSTURE OK as non-superuser `rls_tester`).
- **Remaining (gated — production cutover / bigger integration):**
  - **② production cutover (DEBT-SEC-A):** create `edms_migrator` (owner/DDL) + `edms_app`
    (LOGIN, NOSUPERUSER, NOBYPASSRLS, DML-only) + GRANTs + `ALTER DEFAULT PRIVILEGES` + move table ownership;
    move `initRlsPolicies()` from app-startup (`bootstrap.ts`, runs as app role) to the **migration step**
    (owner role); split `DATABASE_URL`(app) vs `MIGRATION_DATABASE_URL`(migrator) in entrypoint/compose. Keep
    `edms` as an unused rollback/bootstrap account. **Production cutover = separate approved deploy** (prepare
    roles → verify externally → switch DATABASE_URL → smoke).
  - **③ transaction-local RLS context:** replace the session-scoped fire-and-forget `set_config(...,FALSE)`
    with per-request `SET LOCAL` on one connection (AsyncLocalStorage + `currentDb()`), so the context reliably
    reaches every query. Architecture decision pending: (A) central `currentDb()` refactor vs (B) transitional
    handler-wrapped transaction.
  - **④ verify-security-posture** gate in entrypoint: fail the deploy if runtime role has rolsuper/rolbypassrls,
    if `edms_app` owns any table, or if any tenant table lacks ENABLE+FORCE / has an unexpected `pg_policy` row.
  - **⑤ organization_id backfill** for projectId-scoped hot tables (documents/transmittals/project_members) +
    composite FK `(id, organization_id)` — prerequisite before RLS enforcement (rows must have non-null org).
  - **⑥ RLS enforcement tests under the real `edms_app` role** (extend the existing `rls_tester` pattern).
- **③ Hybrid-Y per-request wiring — 🔧 IN PROGRESS (isolated env, owner-approved 2026-08-24):** progressive,
  **per-router** conversion (fail-closed marker mounted path-scoped, so unconverted routers are unaffected).
  Contract: **writes use explicit `withTenant()`** (BEGIN→SET LOCAL→work→COMMIT, no 2xx before commit, no tx
  held during R2/Resend/fs I/O); **reads** use a transitional `makeReadAutoWrap()` (GET/HEAD, DB-only,
  streaming excluded) logged in `qa/READ_AUTOWRAP_INVENTORY.md` for **Phase D** migration to explicit
  `withTenant()`. Phases: **A** security-sensitive writes (Users/Roles/Members/Projects/Permissions/Admin) →
  **B** Documents/Files/Transmittals/Correspondence/Tasks/Meetings → **C** Workflows/Registers/remaining →
  **D** reads. Invariant: a marked write with no `withTenant()` throws (fail-closed Proxy) + a mount-scan test.
  - **Leak-free mount primitive `tenantScoped()` (commit `1455288`):** the marker leaked across Express
    fall-through to unconverted routers sharing a prefix; `tenantScoped()` uses `requestContext.exit()` on
    fall-through so per-router conversion is safe even inside the nested `/projects` tree. Unauthenticated
    requests dispatch to the sub-router unscoped (requireAuth still 401). PROOF 7 added.
  - **Phase A ✅ COMPLETE (commits `64ed976`, `e91615b`, `658cbef`):** all 11 security-sensitive routers
    converted — users, projects, project-participants/parties/departments/role-overrides/governance,
    departments, organizations, delegations, admin. Writes → explicit `withTenant()` (discriminated-result
    restructuring preserves every guard/status; bcrypt + emails OUTSIDE tx; org-create best-effort side
    effects in their own short tx). Reads via transitional auto-wrapper (see `READ_AUTOWRAP_INVENTORY.md`).
    admin `search/reindex` uses `runUnscoped()` (cross-tenant bulk + ES I/O); admin `search/status` excluded
    from auto-wrap. **Verified: typecheck 0 · FULL regression 861/861** (64 files, superuser test role → RLS
    inert, proves wiring correctness). No billing committed. **Next: Phase B** (Documents/Files/Transmittals/
    Correspondence/Tasks/Meetings — includes the streaming download routes needing `skipRead` + I/O-outside-tx).
- **🔴 FINDING (edms_app-gate blocker, tied to ⑤) — active RLS vs cross-org project collaboration:** the
  `org_isolation_policy` is strictly `organization_id = current_org_id OR is_system_owner`. Once the app runs
  under non-superuser `edms_app` (item-6 gate), RLS becomes ACTIVE and will **over-restrict** legitimate
  cross-org project collaboration on the RLS tables (`projects/documents/tasks/correspondence/transmittals`):
  a member from org B reading/writing an org-A project is filtered (read) / WITH CHECK-blocked or mis-stamped
  (write). Masked today because prod `edms` is superuser (RLS inert) and tests default to a superuser role.
  **Does not block the mechanical write conversion** (superuser tests pass; SET LOCAL runs, RLS inert) — it
  blocks **“full suite green under `edms_app`.”** Decision needed BEFORE that gate (not before conversion):
  (A) narrow audited `withSystemContext` escape hatch for reviewed cross-org read paths; (B) membership-aware
  policy (`EXISTS project_members …`, needs `app.current_user_id` in context); (C) ⑤ owner-org denormalization;
  (D) confirm cross-org collaboration is NOT a first-customer feature and keep the strict policy (document the
  limit).
  - **✅ OWNER DECISION (2026-08-24): adopt (B) — membership-aware RLS** for project-collaborative tables.
    Rationale: cross-org shared-project access is an existing Product Contract behaviour; do not break it to
    fit RLS, and do not use `withSystemContext` as a daily escape. **Before the `edms_app` gate:** (1) add
    `app.current_user_id` to the transaction-local context (alongside `current_org_id` + `is_system_owner`);
    (2) inventory the 13 RLS tables → classify organization-private / project-collaborative / system-global;
    (3) for project-collaborative tables (projects/documents/tasks/correspondence/transmittals) write a policy
    allowing ONLY: explicit system_owner OR owner org OR a real project membership/access per the current
    authority source; (4) membership grants VISIBILITY only — functional write authorization stays in
    RBAC/app layer, RLS just bounds org/project; (5) `withSystemContext` reserved for real platform ops
    (e.g. reindex), never general cross-org; (6) tests: OrgA owner OK · OrgB non-member 0/blocked · OrgB
    authorized member sees ONLY the shared project (not OrgA's other projects) · member of Project X cannot
    see Project Y (same owner) · removal from membership → access gone next request · spoofed
    project/org/user context opens nothing; (7) audit `project_members` as an authorization source even if it
    is not itself made an RLS table. **Does not block Phase A–D mechanical conversion.**
- **🔴 edms_app-gate item — background jobs need explicit tenant context (owner, 2026-08-24):**
  request-triggered skill events now use `dispatchSkillEventBackground()` (lib/skill-events.ts) — an
  EXPLICIT background boundary that carries `{organizationId, userId}` and does NOT inherit the request ALS
  (proven: `skill-event-background.test.ts`). BUT the skill engine (`executeSkill`) and the scheduler
  (`startBackgroundJobs`, notification/trial-downgrade schedulers) still access the DB via the pool-backed
  proxy with NO tenant context. Today that is safe only because the app role is superuser (RLS inert). **Before
  the `edms_app` cutover:** every background/skill DB access that touches an RLS table MUST run inside its own
  `runInTenantTx(...)` with the explicit org context (never unrestricted pool), and AI/external I/O must stay
  OUTSIDE that tx. Full list of background jobs to convert is delivered at Phase B end.

- **③ Hybrid-Y Phase B ✅ COMPLETE (2026-08-25):** all Phase B routers converted + mounted via
  `tenantScoped()` — transmittals, submission-chains, global-documents, meetings, tasks, correspondence,
  documents (20 handlers), storage (streaming). Writes = explicit `withTenant()` (capture-result; no 2xx
  before commit; bcrypt/CPU + external I/O outside the tx). **Subsystem boundaries added (all narrow/named,
  no general poolDb, no runUnscoped-for-tenant-work):**
  - `notificationDb` (lib/notifications/notification-db.ts) — pool-backed, notification infra tables only;
    dispatchNotification runs post-commit. Guard: `tenant-notificationdb-guard.test.ts`.
  - `dispatchSkillEventBackground` (lib/skill-events.ts) — detaches request ALS, explicit {org,user} ctx.
  - `dispatchClassificationBackground` + `classifyDetached` (lib/ai/classification-events.ts) — AI detached,
    explicit ctx, AI I/O outside any tx; classifyDetached is the awaited variant (documents).
  - `tenantRead()` — context-aware read for authz middlewares/subsystem config (requireProjectAccess,
    assertProjectAccess, orgStorage.getOrgConfig). Opens a SHORT read tx on writes; reuses tx on GET; pool if unscoped.
  - **storage streaming**: download/serve routes do `withTenant(authz+metadata) → commit → R2/S3/onprem
    stream or 302 redirect`; excluded from read auto-wrap via `skipRead`; view-token requests establish the
    marker from the token identity. Upload keeps I/O-then-short-DB-tx + compensation/orphan verbatim.
  - **Final Gate:** typecheck 0 · build OK · **full regression 871/871** (69 files) · streaming-after-commit
    proof 2/2 · guards (runUnscoped 2/2, notificationDb 2/2, skill/classification detachment 4/4).
  - **Inventories:** `runUnscoped` — 1 call site (admin `search/reindex`). `notificationDb` — 0 refs outside
    lib/notifications/. Background dispatchers — `dispatchSkillEventBackground` (tasks), `dispatchClassification
    Background` (correspondence), `classifyDetached` (documents). All guarded by static tests.
  - **Commits (unpushed, on `release/rc-session-cors-optin-debt004`):** Phase A `64ed976`,`1455288`,`e91615b`,
    `658cbef`,`00432e0`; Phase B `0944f18`,`9c545b1`,`095d4df`,`9fe66a3`,`c2c1937`,`5463ad2`,`97a63be`,
    `41f540d` + view-token fix.
- **③ Hybrid-Y Phase C ✅ COMPLETE (2026-08-25):** every remaining tenant-facing router converted + mounted
  via `tenantScoped()`. Same rules as A/B (writes = explicit `withTenant()` capture-result, no 2xx before
  commit; reads auto-wrapped transitionally; DB middleware via `tenantRead()`; external I/O outside the tx;
  no new general poolDb; no `runUnscoped` expansion).
  - **Checkpoint 1 (DB-only + read-only)** `b93d268`: metadata, document-types, preferences, modules, profile
    (password: bcrypt outside the tx via tenantRead+withTenant), external-contacts, deliverables, entities,
    general (6 correspondence writes, createAuditLog kept inside the tx), config (6 system/org-config writes),
    rules; read-only mounts dashboard/search/audit-logs/calendar/notification-summary.
  - **Checkpoint 2A (I/O routers)** `1b69914`: notifications (GET generators run in the read-write auto-wrap
    tx), registers (15 writes; submit-approval/NOC notifications gathered in-tx → `dispatchNotification`
    awaited post-commit), chat (in-app notifications in-tx, `emitToChatGroup`/`emitToUser` post-commit).
  - **Checkpoint 2B (workflow-engine)** `23aacbc`: all 13 writes in `withTenant`; `enrichInstance`/
    `getTemplateWithStages` response builders run in-tx. Fire-and-forget helpers made tx-correct:
    `syncDocumentStatus`/`closeOpenWorkflowTask` now atomic (swallow removed); `notifyStageReached` split into
    `prepareStageNotification` (task lifecycle + in-app notifications in-tx, returns bundle) +
    `dispatchStageEmail` (email post-commit, non-fatal). **Intended behavior change:** doc-status sync + task
    lifecycle + in-app notifications are now atomic with the transition; only outbound email stays best-effort.
  - **Checkpoint 3 (skills)** `4a8ea7c`: CRUD in `withTenant`; `PUT /:id/run` uses **`executeSkillBackground`**
    (added earlier — detaches request ALS, explicit {org,user,skillId}+trigger, no runUnscoped/pool escape;
    engine's internal tenant-ctx still deferred to edms_app gate). Test: skill-event-background 3/3.
  - **Final Gate:** typecheck 0 · build OK · **full regression 872/872** (69 files) · guards passing
    (runUnscoped, notificationDb still contained, notification-type write-contract — my new chat/registers/
    workflow in-app inserts are static-literal `type`s).
  - **Routes left auto-wrapped for Phase D:** the GET/HEAD reads of every `tenantScoped()` router (transitional
    read tx via `makeReadAutoWrap`); Phase D migrates these to explicit `withTenant()` and removes the wrapper.
  - **🔴 DEFERRED — NOT converted in Phase C (needs its own design + owner sign-off):** **`/migrations`**
    (`migrations.ts`) left **bare**. `POST /:id/analyze` and `POST /:id/execute` run `setImmediate(...)`
    fire-and-forget blocks doing heavy RLS-table writes + AI I/O; under a request marker those background
    writes fail-closed. This is a genuine background subsystem (distinct from the notification/emit
    post-commit pattern) — it belongs with the edms_app background-jobs gate below, not the mechanical sweep.
    Also still bare (by constraint / nature): `/billing` + `/billing/webhook` (out of DEBT-010 scope), `/dev`
    (non-prod), `health`/`auth` (public/pre-auth).
- **③ Hybrid-Y Phase D ✅ COMPLETE (2026-08-25):** the transitional read auto-wrapper is GONE. Every
  GET/HEAD handler across all `tenantScoped()` routers (~120 handlers, 41 routers) now opens its own SHORT
  `tenantRead()` unit-of-work: reads inside the closure, response serialization OUTSIDE it (no tx held during
  serialization or I/O). `tenantRead` reuses an active tx, opens a short read tx under the marker, or falls
  back to the pool when unauthenticated — so cross-org/system_owner reads keep the exact `is_system_owner`
  context the auto-wrap used. Delivered by 4 parallel mechanical conversion agents (Phase A/B/C-dbonly/
  C-reads) + admin agent + owner-authored specials, each verified typecheck-clean.
  - **Non-mechanical specials (hand-done):** notifications `GET /` (generators → short write UoW returning
    inserted rows; `emitToUser` AFTER commit); correspondence `GET /:id` (conditional mark-as-read WRITE →
    `withTenant`); search `GET /` (only `sqlSearch` DB wrapped; ES path holds NO tx — fixes the pre-existing
    tx-across-ES from having no skipRead); audit-logs `GET /export` (CSV built + sent OUTSIDE the tx); config
    public GETs (pool fallback via `tenantRead` when unauthenticated) + `/session-settings` (direct read +
    `getOrgSessionPolicy` in ONE unit); admin `/backup` (dump read in tx, serialize outside) + `/ai-quota`
    (getOrgAiQuota is db-proxy → reuses the one tx).
  - **Wrapper removed:** `makeReadAutoWrap`/`readAutoWrap`/`getAutoWrappedReadInventory` + the `tenantScoped`
    `skipRead` option deleted from `middlewares/tenant-scope.ts`; storage/admin mounts drop `skipRead`.
    `tenantScoped()` now only sets the fail-closed marker + exits on fall-through.
  - **Static gate** (`phase-d-readautowrap-removed.test.ts`): no production source references the auto-wrapper;
    no `skipRead` remains; tenant-scope.ts no longer defines it; **bare tenant DB access inside a request
    marker STILL throws fail-closed** (runtime assertion).
  - **Final Gate:** typecheck 0 · build OK · **full regression 876/876** (70 files) · A/B concurrency no-leak +
    fail-closed (no pool fallback) + exit-on-fall-through proofs green · streaming-after-commit proofs green.
  - **Final tenant boundary state:** every tenant-facing route is fail-closed with EXPLICIT `withTenant()`
    (writes) / `tenantRead()` (reads) — no implicit request-spanning tx anywhere. Still bare by design:
    `/migrations` (deferred background subsystem), `/billing`+`/billing/webhook` (out of scope), `/dev`
    (non-prod), `health`/`auth` (public/pre-auth). `runUnscoped` = 1 allowlisted site (admin reindex);
    `notificationDb` = notifications-infra only; both statically guarded.
  - **Commit (unpushed):** `8d00c64`.
- **④ Membership-aware RLS (Decision B) ✅ IMPLEMENTED + PROVEN on the isolated env (2026-08-25):**
  org-only RLS replaced with a membership-aware model, enforced under a REAL least-privilege role
  (`edms_app`, LOGIN/NOSUPERUSER/NOBYPASSRLS) — not a role switch inside a superuser session. RLS =
  visibility + tenant/project anchoring only; RBAC unchanged and never widened. Design + Security-Definer
  Gate: `docs/architecture/DEBT-010-membership-aware-rls-design.md`.
  - **Context:** `app.current_user_id` now threads `runInTenantTx → withTenant → tenantRead`
    (tx-local `set_config`); missing user context ⇒ per-user/collaborative predicates fail-closed.
  - **Security-Definer model** (`lib/rls-membership.ts`, single source of truth): schema `app` owned by
    `edms_rls_owner` (NOLOGIN); authority predicates `SECURITY DEFINER`/`sql STABLE`/`search_path=''`/
    fully-qualified/no dynamic SQL, EXECUTE revoked from PUBLIC → granted to `edms_app`; they read only
    NON-RLS lookup tables (no recursion, no dependence on runtime grants). `edms_app` has USAGE-not-CREATE
    → object shadowing impossible.
  - **Policies:** still ONE `org_isolation_policy` FOR ALL per table (posture gate intact). Decisions
    applied — U per-user notifications, X-a column-allowlist triggers (correspondence {is_read,
    first_read_at,updated_at}; transmittals {status,acknowledged_at,review_outcome,updated_at}), M
    org-party + user-member for documents, R registers stay org-only. WITH CHECK anchors organization_id
    to the project owner (no org forge / no cross-project move); X-a triggers apply only to a genuine
    cross-org session and leave superuser/no-context/same-org to WITH CHECK.
  - **Tests (real edms_app):** `membership-rls.test.ts` (15) — the owner's full matrix incl. §8 shadowing
    + search_path drift, §9 removal-revokes, forged context, anti-move, concurrent A/B; and
    `membership-rls-behavior-comparison.test.ts` (6) — all six legitimate cross-org flows classify
    **UNCHANGED** (legit works, unrelated denied; submission-chains N/A). No EXPANDED, no BROKEN.
  - **Final Gate:** typecheck 0 · build OK · **full regression 898/898** (72 files).
  - **Isolated env ONLY:** `lib/rls-init.ts` (prod startup) still org-only — **no cutover**, no
    `DATABASE_URL` change, no Production roles, no background-job changes. Commit (unpushed): `e56666c`.
- **🔴 edms_app-gate — background jobs / subsystems still needing tenant context (owner deliverable):**
  these run on the pool with NO tenant context today (safe only because prod app role is superuser → RLS inert).
  Before the `edms_app` cutover, each DB access that touches an RLS table MUST use its own `runInTenantTx` with
  explicit org context (or an audited system_owner context); AI/external I/O stays outside the tx:
  1. **`reindexAll`** (admin `search/reindex`, via `runUnscoped`) — reads `documents` (RLS) cross-tenant →
     needs `withSystemContext` (is_system_owner) to read; ES push outside the tx.
  2. **skill-engine `executeSkill`** + skill cron (`startBackgroundJobs`) — skill actions create tasks/
     notifications/documents (RLS) → per-org `runInTenantTx`.
  3. **notification scheduler** (`startNotificationScheduler`) — fires scheduled_notifications; creating
     in-app `notifications` (RLS) needs per-recipient-org `runInTenantTx`.
  4. **trial-downgrade scheduler** (`startTrialDowngradeScheduler`) — flips `projects.visible_on_free` (RLS
     table `projects`) → per-org `runInTenantTx`.
  5. **module-sync / seeds** (`syncOrgModules`, `seedAISettings`, `seedSecuritySettings`) — org_config /
     system_settings are non-RLS; safe on pool, but confirm at cutover.
  6. **migration-wizard background** (`migrations.ts` `analyze`/`execute` `setImmediate` blocks) — write
     `migration_items`/`documents`/`document_revisions`/`folders` (RLS) + do AI extraction I/O. Must move to a
     detached background boundary with explicit per-org `runInTenantTx` for the DB side and AI I/O outside the
     tx (mirrors `dispatchClassificationBackground`). Router `/migrations` stays bare until this lands.
  `notificationDb` / `classifyDetached` infra reads use non-RLS tables and are safe on the pool under edms_app.

## DEBT-011 — 🟠 HIGH: session not invalidated on role change / user disable
- **Severity:** HIGH · **Status:** OPEN. A downgraded/disabled user keeps their access JWT (~15 min) because
  there is **no `auth_version`** and role/disable changes bump nothing (DEBT-003 covered refresh
  rotation/idle/absolute/logout, NOT immediate privilege-change invalidation).
- **Fix (planned):** `users.auth_version` column + in JWT; check `is_active` + `auth_version` against DB on every
  authenticated request (PK lookup, no Redis yet); on role-change/disable run one transaction (`SELECT … FOR
  UPDATE` → bump `auth_version` → revoke all refresh tokens); prefer the DB role for sensitive authorization
  over the JWT claim. Regression: old token rejected on the next request; old refresh rejected.

## DEBT-012 — 🔎 read-only investigation PENDING: weekly Sentry (9× document_sequences, 2× CORS)
- **Status:** OPEN — investigation only, **not touching DEBT-010**, no fix yet (owner directive 2026-08-23).
- **Signal:** weekly Sentry report — **9 `document_sequences` errors** + **2 CORS errors** on Production.
- **Context/expectation:** `document_sequences` auto-numbering was fixed (DEBT-005, migration 0034) — these 9
  may predate the fix, or be a residual edge (e.g., a race on the ON CONFLICT upsert, or a tenant/prod-data
  case). CORS ×2 may relate to DEBT-001 (disallowed-origin → 500) or the R2 preflight. **To be confirmed by a
  separate Root-Cause report AFTER the DEBT-010 middleware wiring is complete** — do not infer cause yet.
- **Action:** after middleware wiring → pull the actual Sentry stack traces / timestamps / affected orgs
  (read-only) and produce a standalone Root-Cause report. No code change attributed to this until then.

## DEBT-013 — 🟠 MEDIUM (RBAC): `POST /projects/:id/members` has no role gate
- **Severity:** MEDIUM · **Status:** OPEN (surfaced during DEBT-010 membership-aware RLS Security-Definer Gate).
- **Where:** `artifacts/api-server/src/routes/projects.ts:459-517`. The handler is `requireAuth` +
  tenant-isolation only (project must be in the caller's org, else `TenantIsolationError`). There is **no
  `requireMinRole`/project-admin gate**, so any authenticated **same-org** user — including a `viewer` — can
  add members (any `role`, including `admin`) to any project in their own org, unaudited. `DELETE
  /:id/members/:userId` should be reviewed with it.
- **Impact:** within-tenant privilege escalation (grant self/others a higher project role) + unaudited
  membership changes. **No cross-org impact and NO effect on membership-aware RLS:** cross-org self-add is
  blocked (`TenantIsolationError`), and same-org rows are already visible via `organization_id` — so this gap
  does not widen RLS visibility. It is a pure application-authorization weakness.
- **Fix (separate track — do NOT fix inside RLS):** add a `requireMinRole('project_manager')` (or
  project-admin) gate + audit log to the member add/remove routes; keep RLS as visibility-only. Deliberately
  NOT bundled with DEBT-010 (owner: do not mix RBAC changes into the security-layer change).

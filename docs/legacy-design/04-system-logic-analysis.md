# System Logic Analysis — Code Audit
> Source: `system logic 1.odt`  
> Date: ~2026-04 (post-Replit audit)

## 1. Signup / Organization Creation

- Controlled by `registrationEnabled` flag in `system_settings` table
- First-ever user → gets `admin` role, no org required
- Registration enabled → anyone with valid email can sign up, gets `viewer` role
- Registration disabled → 403 for all subsequent signups
- **No organization is created automatically on signup**
- A new user without `organizationId` lands in no organization until admin assigns them
- Current state: open registration — anyone who reaches the URL can create an account

## 2. Role Visibility Bug (Known)

Role hierarchy:
```
system_owner (100) > admin (80) > project_manager (60) > document_controller (40) > reviewer (20) > member (10) > viewer (0)
```

**Bug:** `admin` is treated identically to `system_owner` in `isSysAdmin()`:
```typescript
export function isSysAdmin(user: AuthUser): boolean {
  return user.role === "system_owner" || user.role === "admin";
}
```

Every call to `isSysAdmin()` — including org list, cross-org stats, user management — allows both roles to see all organizations and all data. **This is not the intended design.** `admin` should be org-scoped; only `system_owner` should be cross-org.

## 3. Organization Switching

- Each user has exactly one `organizationId`
- No multi-org membership system
- `system_owner` can "view as" any org via `?orgOverride=<orgId>` on any API call
- Regular users cannot switch orgs

## 4. Module Gating

- Module flags stored in `org_config` as JSONB
- `requireModule` middleware: missing config row returns 403, DB error returns 503 — **fail-closed** (correct)
- `backfillOrgConfig` job on startup ensures no org is caught without a config row

## 5. Audit Logs Gap

- Audit logs have **no org filtering** — any authenticated user can potentially read all audit entries
- This is a data isolation gap (noted in `saas-readiness-assessment.md`)

import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "./schema";
export declare const pool: import("pg").Pool;
declare const baseDb: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
};
type TenantTx = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];
interface TenantStore {
    tx: TenantTx;
    orgId: number | null;
    isSystemOwner: boolean;
    userId: number | null;
}
export declare const dbContext: AsyncLocalStorage<TenantStore>;
/**
 * Marks that execution is inside an authenticated HTTP request that MUST be
 * tenant-scoped. Set by the request middleware. Its presence flips the `db`
 * Proxy to FAIL-CLOSED: inside a request, DB access is only allowed via a tenant
 * transaction (runInTenantTx) — a bare `db` call with no active tx throws rather
 * than silently falling back to the pool (which would run with no RLS context).
 * Non-request code (bootstrap, migrations, tests, background jobs) never sets
 * this marker and keeps the pool-backed fallback.
 */
export declare const requestContext: AsyncLocalStorage<{
    userId: number;
    orgId: number | null;
    isSystemOwner: boolean;
}>;
/** The DB handle for the current execution: the tenant transaction if inside a
 *  runInTenantTx scope, otherwise the pool-backed base instance — UNLESS we are
 *  inside a tenant request with no tx, which is a fail-closed error. */
export declare function currentDb(): TenantTx | typeof baseDb;
/** `db` transparently forwards to `currentDb()` so existing `import { db }` call
 *  sites become tenant-transaction-scoped inside a request with zero changes,
 *  and remain pool-backed for explicit non-request code. Inside a request without
 *  a tx it throws (fail-closed) — no silent pool fallback. */
export declare const db: typeof baseDb;
/**
 * Run `fn` inside a single tenant transaction with the RLS context applied via
 * SET LOCAL (transaction-scoped). Keep the unit-of-work SHORT — do external I/O
 * (R2/email/etc.) OUTSIDE this scope so a connection is never held during I/O.
 */
export declare function runInTenantTx<T>(ctx: {
    orgId: number | null;
    isSystemOwner: boolean;
    userId?: number | null;
}, fn: () => Promise<T>): Promise<T>;
/**
 * DEBT-010 Decision B — named background/system contexts (NOT a general bypass).
 *
 * Background jobs run from timers / detached callbacks with NO request ALS, so bare
 * `db` would hit the pool with no RLS context. These two helpers give them an
 * EXPLICIT, minimal tenant context so RLS is enforced under `edms_app`:
 *
 *   withSystemTenantTx(orgId, fn) — a per-org system-actor unit of work. Sets the
 *     org context with is_system_owner=false and NO human user (current_user_id
 *     empty). Category-A tenant jobs (skill/reminder/trial-downgrade/migrations)
 *     open ONE of these PER ORG (never one tx across many orgs). It never
 *     impersonates a human — recipient user ids are written as data columns, not
 *     as the session user. Keep external I/O (email/AI) OUTSIDE this tx.
 *
 *   withSystemContext(fn) — the ONLY platform-wide escape (Category B). Sets
 *     is_system_owner=true so RLS admits all tenants for a genuine global op
 *     (search reindex). Named + allowlisted + static-guarded. Do external I/O
 *     (Elasticsearch push) OUTSIDE the tx.
 */
export declare function withSystemTenantTx<T>(orgId: number, fn: () => Promise<T>): Promise<T>;
export declare function withSystemContext<T>(fn: () => Promise<T>): Promise<T>;
export * from "./schema";
export * from "./document-type-utils";
//# sourceMappingURL=index.d.ts.map
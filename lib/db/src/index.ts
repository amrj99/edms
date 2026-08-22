import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Regex-based Postgres URL parser.
 *
 * Node.js v22 uses the strict WHATWG URL standard which rejects hostnames
 * that contain underscores (e.g. `edms_postgres`).  Any code path that calls
 * `new URL(connectionString)` — including internals of `pg-connection-string`
 * — will throw `TypeError: Invalid URL` for such hostnames.
 *
 * This parser never calls `new URL()`.  It handles the full
 * `postgres[ql]://[user[:password]@]host[:port][/database][?params]` grammar
 * and decodes percent-encoded credentials so special characters in passwords
 * are preserved correctly.
 */
function parsePostgresUrl(url: string): pg.PoolConfig {
  const m = url.match(
    /^postgres(?:ql)?:\/\/(?:([^:@]*)(?::([^@]*))?@)?([^/:?]+)(?::(\d+))?\/?([^?]*)(?:\?(.*))?$/,
  );
  if (!m) {
    throw new Error(
      `DATABASE_URL could not be parsed. Expected postgres[ql]://[user[:password]@]host[:port][/database]. ` +
      `Got: "${url.slice(0, 40)}${url.length > 40 ? "…" : ""}"`,
    );
  }
  const [, user, password, host, port, database, query] = m;
  const ssl = /sslmode=require/i.test(query ?? "");
  return {
    user:     user     ? decodeURIComponent(user)     : undefined,
    password: password ? decodeURIComponent(password) : undefined,
    host,
    port:     port ? parseInt(port, 10) : 5432,
    database: database || undefined,
    ssl:      ssl ? { rejectUnauthorized: false } : false,
  };
}

export const pool = new Pool(parsePostgresUrl(process.env.DATABASE_URL));

// The pool-backed Drizzle instance. Used directly ONLY for non-request work
// (migrations, server bootstrap, background jobs) where there is no tenant to
// scope to. Request code must NOT import this — it uses `db` (below), which
// routes into the per-request tenant transaction.
const baseDb = drizzle(pool, { schema });

// ─── DEBT-010 ③ — transaction-local tenant context (path A) ───────────────────
// AsyncLocalStorage carries the current request's tenant transaction. Inside a
// `runInTenantTx(...)` scope, `currentDb()` (and the `db` Proxy) resolve to that
// single transaction — the one on which `SET LOCAL app.current_org_id /
// app.is_system_owner` was applied — so RLS is evaluated with the right context
// on the SAME connection. Outside any scope (migrate/bootstrap/bg), they resolve
// to the pool-backed `baseDb`. This is transaction-LOCAL: the context never
// leaks to another request and never persists on a reused pooled connection.
type TenantTx = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];
interface TenantStore { tx: TenantTx; orgId: number | null; isSystemOwner: boolean }

export const dbContext = new AsyncLocalStorage<TenantStore>();

/** The DB handle for the current execution: the tenant transaction if inside a
 *  runInTenantTx scope, otherwise the pool-backed base instance. */
export function currentDb(): TenantTx | typeof baseDb {
  const store = dbContext.getStore();
  return store ? store.tx : baseDb;
}

/** `db` transparently forwards to `currentDb()` so existing `import { db }` call
 *  sites become tenant-transaction-scoped inside a request with zero changes,
 *  and remain pool-backed everywhere else. */
export const db = new Proxy(baseDb, {
  get(_t, prop, receiver) {
    const active = currentDb();
    const value = Reflect.get(active as object, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(active) : value;
  },
}) as typeof baseDb;

/**
 * Run `fn` inside a single tenant transaction with the RLS context applied via
 * SET LOCAL (transaction-scoped). Keep the unit-of-work SHORT — do external I/O
 * (R2/email/etc.) OUTSIDE this scope so a connection is never held during I/O.
 */
export async function runInTenantTx<T>(
  ctx: { orgId: number | null; isSystemOwner: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  return baseDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.orgId == null ? "" : String(ctx.orgId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.is_system_owner', ${ctx.isSystemOwner ? "true" : "false"}, true)`);
    return dbContext.run({ tx, orgId: ctx.orgId, isSystemOwner: ctx.isSystemOwner }, fn);
  });
}

export * from "./schema";
export * from "./document-type-utils";

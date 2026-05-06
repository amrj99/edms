import { drizzle } from "drizzle-orm/node-postgres";
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
export const db = drizzle(pool, { schema });

export * from "./schema";

/** DIAGNOSTIC (temporary): dump the actual applied RLS policy + column default for notifications. */
import { describe, it, expect } from "vitest";
import { getTestDb } from "./helpers/index.js";
import { sql } from "drizzle-orm";

describe("DIAG notifications policy", () => {
  it("dumps pg_policies + column default", async () => {
    const db = getTestDb();
    const pol: any = await db.execute(sql`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'notifications'`);
    const rows = (pol as any).rows ?? pol;
    console.log("[DIAG-POLICY] notifications policies:", JSON.stringify(rows));
    const def: any = await db.execute(sql`SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name='notifications' AND column_name='organization_id'`);
    console.log("[DIAG-POLICY] org column:", JSON.stringify((def as any).rows ?? def));
    expect(true).toBe(true);
  });
});

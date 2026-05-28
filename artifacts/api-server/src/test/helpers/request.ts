/**
 * helpers/request.ts
 *
 * Supertest wrapper that imports the Express app and creates an agent.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { api } from "../helpers/request.js";
 *   import { tokens } from "../helpers/auth.js";
 *
 *   it("returns 403 for reviewer", async () => {
 *     const res = await api()
 *       .get("/api/admin/shadow-log")
 *       .set(tokens.reviewer())
 *       .expect(403);
 *     expect(res.body.error).toBe("Forbidden");
 *   });
 *
 * ── Why a factory function? ───────────────────────────────────────────────────
 *
 * supertest(app) creates a new HTTP server for each call, which is correct for
 * isolated tests. Using a shared agent (supertest.agent) would share cookies
 * across tests — we don't want that.
 */

import supertest from "supertest";
import app from "../../app.js";

/**
 * Returns a supertest instance bound to the Express app.
 * Call once per test to get a fresh HTTP server.
 */
export function api() {
  return supertest(app);
}

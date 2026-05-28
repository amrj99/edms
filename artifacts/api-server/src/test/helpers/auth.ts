/**
 * helpers/auth.ts
 *
 * Token and request helpers for authentication in tests.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { makeToken, authHeader } from "../helpers/auth.js";
 *
 *   // Generate a token for any role
 *   const token = makeToken({ role: "admin", id: 1, organizationId: 1 });
 *
 *   // Use directly with supertest
 *   const res = await request(app)
 *     .get("/api/admin/shadow-log")
 *     .set(authHeader("reviewer", 1, 1))
 *     .expect(403);
 *
 * ── Design notes ─────────────────────────────────────────────────────────────
 *
 * makeToken() uses the SAME signToken() function as the real auth flow.
 * This means:
 *   - Tokens are valid JWTs accepted by requireAuth middleware
 *   - The JWT_SECRET in test env is a fixed stub (set in setup.ts)
 *   - Tokens expire in 1 hour (default) — sufficient for any test
 */

import { signToken } from "../../lib/auth.js";
import type { AppRole } from "../../lib/permissions.js";

export interface TestUser {
  id: number;
  email: string;
  role: AppRole;
  organizationId: number;
}

/**
 * Generates a signed JWT for the given test user shape.
 * Does NOT insert the user into the database — use factories/users.ts for that.
 */
export function makeToken(user: TestUser): string {
  return signToken({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  });
}

/**
 * Returns a { Authorization: "Bearer <token>" } header object for supertest.
 *
 * @example
 *   request(app).get("/api/...").set(authHeader("admin", 1, 1))
 */
export function authHeader(
  role: AppRole,
  userId: number,
  organizationId: number,
  email?: string,
): Record<string, string> {
  const token = makeToken({
    id: userId,
    email: email ?? `${role}${userId}@test.edms`,
    role,
    organizationId,
  });
  return { Authorization: `Bearer ${token}` };
}

/**
 * Pre-built token sets for common test scenarios.
 * All use organizationId: 1 (Org A) by default.
 *
 * For cross-org tests use authHeader() directly with a different organizationId.
 */
export const tokens = {
  systemOwner: (userId = 9000, orgId = 1) =>
    authHeader("system_owner", userId, orgId),
  admin: (userId = 1001, orgId = 1) =>
    authHeader("admin", userId, orgId),
  projectManager: (userId = 1002, orgId = 1) =>
    authHeader("project_manager", userId, orgId),
  documentController: (userId = 1003, orgId = 1) =>
    authHeader("document_controller", userId, orgId),
  reviewer: (userId = 1004, orgId = 1) =>
    authHeader("reviewer", userId, orgId),
  member: (userId = 1005, orgId = 1) =>
    authHeader("member", userId, orgId),
  viewer: (userId = 1006, orgId = 1) =>
    authHeader("viewer", userId, orgId),
} as const;

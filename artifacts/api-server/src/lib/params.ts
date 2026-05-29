/**
 * params.ts — Route parameter helpers
 *
 * Express types req.params values as `string | string[]` because theoretically
 * a route could capture an array. In practice every named param (:id, :orgId …)
 * is a single string. These helpers narrow the type safely so TypeScript is
 * satisfied without scattering casts throughout every route file.
 */

// ─── Shared param types for nested routers ────────────────────────────────────
// Routers mounted under /projects/:projectId must declare these types so
// TypeScript knows req.params.projectId is available (Express 5 types req.params
// as {} by default when no explicit route string is parsed at compile time).

/** Params for routers mounted at /projects/:projectId/... */
export interface ProjectParams {
  [key: string]: string;
  projectId: string;
}

/** Params for routers mounted at /projects/:projectId/.../:id */
export interface ProjectItemParams extends ProjectParams {
  id: string;
}

/**
 * Return the first (or only) value of a route parameter.
 * Use for string params like slugs, tokens, or any non-numeric id.
 *
 * @example
 *   const token = param(req.params.token);
 */
export function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse a route parameter as an integer.
 * Returns NaN if the value is not a valid integer — callers should validate.
 *
 * @example
 *   const id = paramInt(req.params.id);
 *   if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
 */
export function paramInt(value: string | string[]): number {
  return parseInt(Array.isArray(value) ? value[0] : value, 10);
}

/**
 * Parse a route parameter as an integer, returning null if absent or invalid.
 *
 * @example
 *   const projectId = paramIntOrNull(req.params.projectId);
 */
export function paramIntOrNull(value: string | string[] | undefined): number | null {
  if (!value) return null;
  const n = parseInt(Array.isArray(value) ? value[0] : value, 10);
  return isNaN(n) ? null : n;
}

/**
 * Parse a query parameter as an integer, returning null if absent or invalid.
 * Use for optional numeric query params like ?projectId=, ?orgId=, ?assignee=
 *
 * @example
 *   const projectId = queryIntOrNull(req.query.projectId);
 *   // → null if missing or non-numeric, otherwise the parsed integer
 */
export function queryIntOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = parseInt(Array.isArray(value) ? value[0] : String(value), 10);
  return isNaN(n) ? null : n;
}

/**
 * Parse a query parameter as an integer, returning a default if absent or invalid.
 * Use for pagination/limit params like ?limit=50
 *
 * @example
 *   const limit = Math.min(queryIntOr(req.query.limit, 50), 200);
 *   // → 50 if ?limit is missing or invalid
 */
export function queryIntOr(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const n = parseInt(Array.isArray(value) ? value[0] : String(value), 10);
  return isNaN(n) ? defaultValue : n;
}

/**
 * Parse a route parameter as an integer, throwing a 400 error if invalid.
 * Use this instead of paramInt() for any param that must be a valid integer.
 * Express 5 catches the thrown error and routes it to globalErrorHandler.
 *
 * @example
 *   const id = requireInt(req.params.id, "id");
 *   // → 400 { error: "Invalid parameter: id" } if not a valid integer
 */
export function requireInt(value: string | string[], name = "id"): number {
  const n = parseInt(Array.isArray(value) ? value[0] : value, 10);
  if (isNaN(n)) {
    const err = Object.assign(new Error(`Invalid parameter: ${name}`), { status: 400 });
    throw err;
  }
  return n;
}

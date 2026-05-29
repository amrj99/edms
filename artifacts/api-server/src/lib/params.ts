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

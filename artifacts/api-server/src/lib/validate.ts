/**
 * validate.ts — Zod body-parsing middleware factory
 *
 * Creates an Express middleware that validates req.body against a Zod schema.
 * On failure: calls next(ValidationError) — the global error handler maps this
 * to { error: "VALIDATION_ERROR", message: "Validation failed", fields: {...} }.
 * On success: replaces req.body with the parsed (stripped / coerced) output.
 *
 * Usage:
 *   router.post("/", requireAuth, parseBody(mySchema), async (req, res) => { ... });
 */

import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { ValidationError } from "./errors.js";

export function parseBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        if (key) fields[key] = issue.message;
      }
      next(new ValidationError("Validation failed", fields));
      return;
    }
    req.body = result.data as Record<string, unknown>;
    next();
  };
}

/**
 * error-handler.ts — Global Express error handler
 *
 * Must be registered LAST in the Express middleware chain (after all routes).
 * Catches every error passed via next(err) or thrown in async route handlers.
 *
 * Behaviour:
 *   • AppError subclasses → use their statusCode + code, log at warn/error
 *   • TenantIsolationError → log as security event (level: "warn" with securityEvent flag)
 *   • Unknown errors → 500, log at error, report = true
 *   • Never leaks stack traces or internal details to the client in production
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { AppError, TenantIsolationError, isAppError } from "../lib/errors.js";
import { Sentry } from "../instrument.js";

// ─── Response shape ───────────────────────────────────────────────────────────

interface ErrorResponse {
  error: string;
  message: string;
  fields?: Record<string, string>;
  requestId?: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isProduction = process.env.NODE_ENV === "production";
  const requestId = (req.headers["x-request-id"] as string) ?? undefined;

  // ── Typed AppError ─────────────────────────────────────────────────────────
  if (isAppError(err)) {
    const logPayload = {
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
      userId: (req.user as any)?.id,
      orgId: (req.user as any)?.organizationId,
      requestId,
      ...(err.context ?? {}),
    };

    // Security events get special treatment
    if (err instanceof TenantIsolationError) {
      logger.warn({ ...logPayload, securityEvent: true }, "[security] Tenant isolation violation");
      // Always report security violations to Sentry with full context
      Sentry.withScope((scope) => {
        scope.setTag("security_event", "tenant_isolation_violation");
        scope.setTag("route", req.path);
        scope.setTag("method", req.method);
        scope.setUser({ id: String((req.user as any)?.id ?? "unknown") });
        scope.setContext("violation", logPayload);
        Sentry.captureException(err);
      });
    } else if (err.statusCode >= 500) {
      logger.error(logPayload, `[error] ${err.code}: ${err.message}`);
      // Report 5xx errors to Sentry
      if (err.report) {
        Sentry.withScope((scope) => {
          scope.setTag("error_code", err.code);
          scope.setUser({ id: String((req.user as any)?.id ?? "unknown") });
          scope.setContext("request", { path: req.path, method: req.method, orgId: (req.user as any)?.organizationId });
          Sentry.captureException(err);
        });
      }
    } else {
      logger.warn(logPayload, `[warn] ${err.code}: ${err.message}`);
    }

    const body: ErrorResponse = {
      error: err.code,
      message: err.message,
      requestId,
    };

    // Include field-level validation errors if present
    if ("fields" in err && err.fields) {
      body.fields = err.fields as Record<string, string>;
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // ── Unknown / unhandled error ──────────────────────────────────────────────
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  logger.error({
    message,
    stack,
    path: req.path,
    method: req.method,
    userId: (req.user as any)?.id,
    orgId: (req.user as any)?.organizationId,
    requestId,
  }, "[error] Unhandled exception");

  // Report all unhandled exceptions to Sentry
  Sentry.withScope((scope) => {
    scope.setUser({ id: String((req.user as any)?.id ?? "unknown") });
    scope.setContext("request", {
      path: req.path,
      method: req.method,
      orgId: (req.user as any)?.organizationId,
      requestId,
    });
    Sentry.captureException(err);
  });

  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: isProduction ? "An unexpected error occurred" : message,
    requestId,
  } satisfies ErrorResponse);
}

// ─── Async route wrapper ──────────────────────────────────────────────────────

/**
 * Wraps an async Express route handler so that any thrown error is automatically
 * forwarded to next(err) instead of crashing the process.
 *
 * Usage:
 *   router.get("/", asyncHandler(async (req, res) => { ... }))
 *
 * Without this wrapper, an unhandled promise rejection in a route handler
 * silently swallows the error in Express 4 (Express 5 auto-catches them).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

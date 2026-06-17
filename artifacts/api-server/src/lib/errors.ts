/**
 * errors.ts — Typed error hierarchy for ArcScale API
 *
 * Every intentional error thrown in the application should extend AppError.
 * The global error handler (error-handler.ts) maps these to HTTP responses
 * with consistent shape, structured logging, and Sentry-ready context.
 *
 * Error types:
 *   AppError            — base class (500 by default)
 *   ValidationError     — 400 — bad input from the client
 *   AuthError           — 401 — missing or invalid credentials
 *   ForbiddenError      — 403 — authenticated but not authorized
 *   NotFoundError       — 404 — resource does not exist (or not visible)
 *   ConflictError       — 409 — state conflict (duplicate, already exists…)
 *   TenantIsolationError— 403 — cross-tenant access attempt (security event)
 *   ExternalServiceError— 502 — upstream dependency failed (OpenAI, S3…)
 *   QuotaExceededError  — 429 — plan/usage limit reached
 */

// ─── Base ─────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  /** HTTP status code sent to the client */
  readonly statusCode: number;
  /** Machine-readable code for the client (e.g. "VALIDATION_ERROR") */
  readonly code: string;
  /** Extra context attached to logs / Sentry — never sent to the client */
  readonly context?: Record<string, unknown>;
  /** Whether this error should be reported to Sentry (default: true for 5xx) */
  readonly report: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    options: { context?: Record<string, unknown>; report?: boolean } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.context = options.context;
    this.report = options.report ?? statusCode >= 500;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// ─── 4xx Client Errors ────────────────────────────────────────────────────────

export class ValidationError extends AppError {
  readonly fields?: Record<string, string>;

  constructor(
    message: string,
    fields?: Record<string, string>,
    context?: Record<string, unknown>,
  ) {
    super(message, 400, "VALIDATION_ERROR", { context, report: false });
    this.fields = fields;
  }
}

export class AuthError extends AppError {
  constructor(message = "Authentication required", context?: Record<string, unknown>) {
    super(message, 401, "AUTH_ERROR", { context, report: false });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied", context?: Record<string, unknown>) {
    super(message, 403, "FORBIDDEN", { context, report: false });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource", context?: Record<string, unknown>) {
    super(`${resource} not found`, 404, "NOT_FOUND", { context, report: false });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 409, "CONFLICT", { context, report: false });
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 429, "QUOTA_EXCEEDED", { context, report: false });
  }
}

/**
 * Thrown when no usable storage provider (per-org S3/R2/on-premise/cloud) could
 * be resolved for an organization. Distinct from a generic 500 so the client
 * (and operators) get a clear, actionable signal instead of an opaque crash.
 */
export class StorageNotConfiguredError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 503, "STORAGE_NOT_CONFIGURED", { context, report: true });
  }
}

// ─── Security Errors (always logged as security events) ──────────────────────

/**
 * Thrown when a request attempts to access data belonging to a different tenant.
 * Always logged as a security event regardless of report flag.
 */
export class TenantIsolationError extends AppError {
  constructor(
    context?: Record<string, unknown>,
  ) {
    super("Cross-tenant access denied", 403, "TENANT_ISOLATION_VIOLATION", {
      context,
      report: true, // always report — this is a security event
    });
  }
}

// ─── 5xx Server / External Errors ────────────────────────────────────────────

export class ExternalServiceError extends AppError {
  readonly service: string;

  constructor(service: string, message: string, context?: Record<string, unknown>) {
    super(`${service}: ${message}`, 502, "EXTERNAL_SERVICE_ERROR", { context, report: true });
    this.service = service;
  }
}

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

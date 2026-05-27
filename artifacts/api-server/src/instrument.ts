/**
 * instrument.ts — Sentry initialization
 *
 * MUST be imported before any other module in index.ts.
 * Sentry needs to instrument Node.js internals (http, pg, etc.) at startup
 * before they are first used — importing this file late causes missed events.
 *
 * If SENTRY_DSN is not set, Sentry is disabled silently (no crash).
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? undefined,

    // Capture 100% of errors, 10% of transactions (performance)
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Do NOT send default PII (IP addresses, user emails) automatically.
    // We attach only what we explicitly set via Sentry.setUser().
    sendDefaultPii: false,

    // Ignore noisy non-actionable errors
    ignoreErrors: [
      "ECONNRESET",
      "EPIPE",
      "ECONNREFUSED",
      "AbortError",
    ],

    beforeSend(event, hint) {
      const err = hint?.originalException;

      // Drop 4xx client errors — they are not bugs, just bad requests.
      // TenantIsolationError (403) is the exception: always report it.
      if (err && typeof err === "object" && "statusCode" in err) {
        const status = (err as any).statusCode as number;
        const code   = (err as any).code as string;
        if (status >= 400 && status < 500 && code !== "TENANT_ISOLATION_VIOLATION") {
          return null; // drop
        }
      }

      return event;
    },
  });

  console.log("[sentry] initialized — environment:", process.env.NODE_ENV ?? "development");
} else {
  console.warn("[sentry] SENTRY_DSN not set — error reporting disabled");
}

export { Sentry };

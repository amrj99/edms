// ─── Centralised API fetch utility ───────────────────────────────────────────
// Wraps window.fetch with:
//   1. Automatic Authorization header injection from localStorage.
//   2. Plan-restriction detection: 403 responses carrying READ_ONLY_ACCOUNT or
//      UPLOAD_BLOCKED are translated into a "plan-restriction" custom window
//      event so any mounted PlanRestrictionModal can react without every
//      call-site needing its own error-handling logic.
//
// Usage:
//   import { apiFetch } from "@/lib/api";
//   const res = await apiFetch("/api/projects", { method: "POST", body: ... });
//
// The function always returns the original Response so callers can still
// read the body, check res.ok, etc.  The plan-restriction event is fired
// as a side-effect before returning.

const PLAN_ERROR_CODES = new Set(["READ_ONLY_ACCOUNT", "UPLOAD_BLOCKED"]);

export interface PlanRestrictionDetail {
  code: string;
  message: string;
}

export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("edms_token");
  const headers = new Headers(options?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, { ...options, headers }).then(async (res) => {
    if (res.status === 403) {
      try {
        const clone = res.clone();
        const body = await clone.json();
        if (body?.error && PLAN_ERROR_CODES.has(body.error)) {
          window.dispatchEvent(
            new CustomEvent<PlanRestrictionDetail>("plan-restriction", {
              detail: { code: body.error, message: body.message ?? "" },
            }),
          );
        }
      } catch {
        // Body not JSON — ignore, return response as-is
      }
    }
    return res;
  });
}

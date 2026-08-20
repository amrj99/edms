import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useLocation } from "wouter";
import { User, useGetMe } from "@workspace/api-client-react";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Pages reachable without an organisation (and, for most of them, without auth).
// Used both to skip the "redirect to /login" guard and the "redirect to
// /pending-org" guard below, so an authenticated org-less user can still
// navigate to /register, /login, etc.
const publicPaths = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/set-password", "/pending-org"];

// Apply fetch interceptor to attach JWT token globally.
// IMPORTANT: headers may be a Headers instance (not a plain object), so we
// must use `new Headers(config?.headers)` to safely merge them — spreading
// a Headers instance via `{ ...headersInstance }` produces {} and silently
// drops every existing header (including Content-Type), which breaks JSON body parsing.
const originalFetch = window.fetch;

// ─── Session Management: transparent auto-refresh interceptor ─────────────────
// Short-lived access token in localStorage (attached as Bearer). The long-lived
// refresh token lives in a Secure HttpOnly cookie (sent automatically). On a 401
// from a protected /api call, we perform ONE single-flight refresh (POST
// /api/auth/refresh-token — cookie carries the refresh token), then transparently
// RETRY the original request with the new access token → the user keeps working for
// the full session (default 8h) without ever re-logging-in, and no in-flight request
// or open form is lost. If refresh fails (absolute expiry / idle / revoked / reuse),
// the session is genuinely over → clear + redirect to /login.
const AUTH_EXEMPT = ["/api/auth/login", "/api/auth/refresh-token", "/api/auth/logout"];
let refreshPromise: Promise<string | null> | null = null;

function urlOf(resource: RequestInfo | URL): string {
  return typeof resource === "string" ? resource : resource instanceof URL ? resource.toString() : (resource as Request).url ?? "";
}
function isRefreshable(url: string): boolean {
  return !!url && url.includes("/api/") && !AUTH_EXEMPT.some((p) => url.includes(p));
}
function withAuth(config: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(config?.headers);
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  // same-origin: send the HttpOnly refresh cookie with every /api call
  return { ...config, headers, credentials: config?.credentials ?? "include" };
}
// Single-flight: concurrent 401s share ONE refresh (no stampede / rotation race).
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const r = await originalFetch("/api/auth/refresh-token", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        });
        if (!r.ok) return null;
        const j = await r.json().catch(() => null);
        if (j?.token) { localStorage.setItem("edms_token", j.token); return j.token as string; }
        return null;
      } catch { return null; }
    })();
    refreshPromise.finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
function endSession(): void {
  localStorage.removeItem("edms_token");
  const p = window.location.pathname;
  if (!publicPaths.some((pp) => p === pp || p.startsWith(pp + "/"))) window.location.assign("/login");
}

window.fetch = async (...args) => {
  const [resource, config] = args;
  const url = urlOf(resource);
  const token = localStorage.getItem("edms_token");
  let res = await originalFetch(resource, withAuth(config, token));
  if (res.status === 401 && isRefreshable(url)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await originalFetch(resource, withAuth(config, newToken)); // transparent retry
    } else {
      endSession();
    }
  }
  return res;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("edms_token"));
  const [booting, setBooting] = useState<boolean>(!localStorage.getItem("edms_token"));
  const [location, setLocation] = useLocation();

  // Boot: with no access token but a valid HttpOnly refresh cookie, silently recover
  // the session (survives reload / browser reopen when Remember Me kept the cookie).
  useEffect(() => {
    if (!localStorage.getItem("edms_token")) {
      refreshAccessToken().then((t) => { if (t) setToken(t); }).finally(() => setBooting(false));
    } else {
      setBooting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // We use the generated useGetMe hook to fetch user info if we have a token
  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    }
  });

  useEffect(() => {
    if (error) {
      // Token might be invalid
      localStorage.removeItem("edms_token");
      setToken(null);
      setLocation("/login");
    }
  }, [error, setLocation]);

  // Redirect to login if no token and not already on a public page
  useEffect(() => {
    if (!booting && !token && !publicPaths.some(p => location === p || location.startsWith(p + "?"))) {
      setLocation("/login");
    }
  }, [booting, token, location, setLocation]);

  // Redirect to pending-org if user is authenticated but has no organisation.
  // system_owner is exempt — they intentionally operate without an org.
  // Also exempt any public page (e.g. /register, /login) so an org-less user
  // can navigate there (e.g. to create a new organisation) without being
  // bounced straight back to /pending-org.
  // This guard runs after user data loads to avoid false redirects during init.
  useEffect(() => {
    if (
      user &&
      !user.organizationId &&
      (user as any).role !== "system_owner" &&
      !publicPaths.some(p => location === p || location.startsWith(p + "?"))
    ) {
      setLocation("/pending-org");
    }
  }, [user, location, setLocation]);

  const login = (newToken: string) => {
    localStorage.setItem("edms_token", newToken);
    setToken(newToken);
    setLocation("/");
  };

  const logout = () => {
    // Server revokes the refresh-token family AND clears the HttpOnly cookie
    // (sent automatically via credentials:"include"). Fire-and-forget; redirect
    // immediately regardless of the server response.
    fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }).catch(() => {});

    localStorage.removeItem("edms_token");
    localStorage.removeItem("edms_refresh_token"); // legacy cleanup (refresh now cookie-only)
    setToken(null);
    setLocation("/login");
  };

  const isLoading = booting || (token ? isUserLoading : false);

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

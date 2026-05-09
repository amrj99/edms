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

// Apply fetch interceptor to attach JWT token globally.
// IMPORTANT: headers may be a Headers instance (not a plain object), so we
// must use `new Headers(config?.headers)` to safely merge them — spreading
// a Headers instance via `{ ...headersInstance }` produces {} and silently
// drops every existing header (including Content-Type), which breaks JSON body parsing.
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const [resource, config] = args;
  const token = localStorage.getItem("edms_token");

  if (token) {
    const headers = new Headers(config?.headers);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return originalFetch(resource, { ...config, headers });
  }

  return originalFetch(resource, config);
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("edms_token"));
  const [location, setLocation] = useLocation();

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
  const publicPaths = ["/login", "/register", "/forgot-password", "/reset-password", "/pending-org"];
  useEffect(() => {
    if (!token && !publicPaths.some(p => location === p || location.startsWith(p + "?"))) {
      setLocation("/login");
    }
  }, [token, location, setLocation]);

  // Redirect to pending-org if user is authenticated but has no organisation.
  // system_owner is exempt — they intentionally operate without an org.
  // This guard runs after user data loads to avoid false redirects during init.
  useEffect(() => {
    if (
      user &&
      !user.organizationId &&
      (user as any).role !== "system_owner" &&
      location !== "/pending-org"
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
    // Best-effort server-side refresh token revocation + audit log.
    // Fire-and-forget: the user is redirected immediately regardless of the
    // server response. localStorage is cleared synchronously below.
    const refreshToken = localStorage.getItem("edms_refresh_token");
    if (refreshToken) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }

    localStorage.removeItem("edms_token");
    localStorage.removeItem("edms_refresh_token");
    setToken(null);
    setLocation("/login");
  };

  const isLoading = token ? isUserLoading : false;

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

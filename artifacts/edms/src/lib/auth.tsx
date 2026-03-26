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

// Apply fetch interceptor to attach JWT token globally
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const [resource, config] = args;
  const token = localStorage.getItem("edms_token");
  
  if (token) {
    const newConfig = { ...config } as RequestInit;
    newConfig.headers = {
      ...newConfig.headers,
      Authorization: `Bearer ${token}`,
    };
    return originalFetch(resource, newConfig);
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

  // Redirect to login if no token and not already on login page
  useEffect(() => {
    if (!token && location !== "/login") {
      setLocation("/login");
    }
  }, [token, location, setLocation]);

  const login = (newToken: string) => {
    localStorage.setItem("edms_token", newToken);
    setToken(newToken);
    setLocation("/");
  };

  const logout = () => {
    localStorage.removeItem("edms_token");
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

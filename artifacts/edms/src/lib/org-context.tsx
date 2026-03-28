import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface OrgContextType {
  activeOrgId: number | null;
  setActiveOrgId: (id: number | null) => void;
}

const OrgContext = createContext<OrgContextType>({
  activeOrgId: null,
  setActiveOrgId: () => {},
});

export function OrgContextProvider({ children }: { children: ReactNode }) {
  const [activeOrgId, setActiveOrgId] = useState<number | null>(null);
  const qc = useQueryClient();
  const prevOrgId = useRef<number | null>(null);

  useEffect(() => {
    // Patch window.fetch to inject orgOverride on every /api/ call
    if (activeOrgId === null) {
      prevOrgId.current = null;
      return;
    }
    const origFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.startsWith("/api/") && !url.includes("orgOverride=")) {
        const sep = url.includes("?") ? "&" : "?";
        const patched = `${url}${sep}orgOverride=${activeOrgId}`;
        return origFetch(patched, init);
      }
      return origFetch(input, init);
    };

    // Invalidate all cached queries so they refetch with the new org context
    if (prevOrgId.current !== activeOrgId) {
      prevOrgId.current = activeOrgId;
      qc.invalidateQueries();
    }

    return () => {
      window.fetch = origFetch;
    };
  }, [activeOrgId, qc]);

  return (
    <OrgContext.Provider value={{ activeOrgId, setActiveOrgId }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrgContext() {
  return useContext(OrgContext);
}

export function useOrgOverrideUrl() {
  const { activeOrgId } = useOrgContext();
  return useCallback(
    (url: string): string => {
      if (activeOrgId === null) return url;
      if (url.includes("orgOverride=")) return url;
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}orgOverride=${activeOrgId}`;
    },
    [activeOrgId],
  );
}

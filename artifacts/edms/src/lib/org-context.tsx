import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}orgOverride=${activeOrgId}`;
    },
    [activeOrgId],
  );
}

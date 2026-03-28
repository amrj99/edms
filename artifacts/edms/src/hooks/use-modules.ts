import { useQuery } from "@tanstack/react-query";

export interface OrgModules {
  deliverables: boolean;
  reports: boolean;
  correspondence: boolean;
  documents: boolean;
  notifications: boolean;
}

const DEFAULT_MODULES: OrgModules = {
  deliverables: true,
  reports: true,
  correspondence: true,
  documents: true,
  notifications: true,
};

export function useModules(orgId?: number | string | null): {
  modules: OrgModules;
  isLoading: boolean;
} {
  const url = orgId ? `/api/modules?orgId=${orgId}` : "/api/modules";

  const { data, isLoading } = useQuery({
    queryKey: ["modules", orgId ?? "self"],
    queryFn: async () => {
      const r = await fetch(url);
      if (!r.ok) return { modules: { ...DEFAULT_MODULES } };
      return r.json();
    },
    staleTime: 60_000,
  });

  return {
    modules: (data?.modules as OrgModules) ?? { ...DEFAULT_MODULES },
    isLoading,
  };
}

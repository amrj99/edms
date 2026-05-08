/**
 * useAiAccess — reads AI governance state from the org's config.
 *
 * The backend is the authoritative source. This hook is for UI gating only
 * (hiding menu items, disabling buttons, showing upgrade CTAs).
 * The backend always re-validates on every AI request regardless of what
 * the frontend reports.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

export type AiPlan = "disabled" | "basic" | "premium";

export interface AiAccess {
  aiEnabled: boolean;
  aiPlan: AiPlan;
  aiMonthlyLimit: number;
}

const DEFAULT_ACCESS: AiAccess = {
  aiEnabled: false,
  aiPlan: "disabled",
  aiMonthlyLimit: 0,
};

export function useAiAccess(): { access: AiAccess; isLoading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<AiAccess>({
    queryKey: ["ai-access"],
    queryFn: async () => {
      const r = await fetch("/api/config");
      if (!r.ok) return { ...DEFAULT_ACCESS };
      const config = await r.json();
      return {
        aiEnabled: config.aiEnabled ?? false,
        aiPlan: (config.aiPlan ?? "disabled") as AiPlan,
        aiMonthlyLimit: config.aiMonthlyLimit ?? 0,
      };
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  return {
    access: data ?? { ...DEFAULT_ACCESS },
    isLoading,
  };
}

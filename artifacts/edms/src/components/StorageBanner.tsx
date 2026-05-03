import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { AlertTriangle, HardDrive, X } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api";

const BASE = import.meta.env.BASE_URL;

type WarningLevel = "warning" | "critical" | "full" | null;

interface BillingStatusMinimal {
  storageUsedMb: number;
  storageLimitMb: number | null;
  storageWarningLevel: WarningLevel;
}

/**
 * StorageBanner — displays a persistent storage usage warning inside the
 * app shell when the organisation's storage quota is at 80 %, 95 %, or 100 %.
 *
 * Behaviour:
 *  - Only shown when the user has an organisation context.
 *  - Not shown on the /billing page (redundant with the storage meter there).
 *  - "warning" (80 %+): yellow dismissible banner.
 *  - "critical" (95 %+): orange non-dismissible banner.
 *  - "full" (100 %):  red non-dismissible banner.
 *  - Fetches billing/status with a 5-minute stale time to avoid hammering the API.
 */
export function StorageBanner() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<BillingStatusMinimal>({
    queryKey: ["billing-status-storage"],
    queryFn: async () => {
      const r = await apiFetch(`${BASE}api/billing/status`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!user?.organizationId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const level = data?.storageWarningLevel ?? null;

  // Don't render on billing page (it has its own storage meter)
  if (location === "/billing") return null;
  // No warning needed
  if (!level) return null;
  // User dismissed a non-critical warning
  if (dismissed && level === "warning") return null;

  const config = {
    warning: {
      bg: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
      icon: "text-yellow-600 dark:text-yellow-400",
      text: "text-yellow-800 dark:text-yellow-200",
      title: "Storage nearing limit",
      message: `You've used ${data?.storageUsedMb?.toFixed(0)} MB of your ${data?.storageLimitMb} MB quota (80 %+). Consider upgrading your plan.`,
      dismissible: true,
    },
    critical: {
      bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
      icon: "text-orange-600 dark:text-orange-400",
      text: "text-orange-800 dark:text-orange-200",
      title: "Storage almost full",
      message: `You've used ${data?.storageUsedMb?.toFixed(0)} MB of your ${data?.storageLimitMb} MB quota (95 %+). Upgrade now to avoid upload interruptions.`,
      dismissible: false,
    },
    full: {
      bg: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
      icon: "text-red-600 dark:text-red-400",
      text: "text-red-800 dark:text-red-200",
      title: "Storage limit exceeded",
      message: data?.storageUsedMb != null && data?.storageLimitMb != null && data.storageUsedMb > data.storageLimitMb
        ? `Your current storage (${data.storageUsedMb.toFixed(0)} MB used) exceeds your plan limit of ${data.storageLimitMb} MB. Upgrade your plan to continue uploading.`
        : "Storage limit reached. No new files can be uploaded. Upgrade your plan to restore upload access.",
      dismissible: false,
    },
  } as const;

  const cfg = config[level];

  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-b text-sm ${cfg.bg}`}>
      <HardDrive className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.icon}`} />
      <div className={`flex-1 min-w-0 ${cfg.text}`}>
        <span className="font-semibold">{cfg.title} — </span>
        <span>{cfg.message}</span>
        <a
          href={`${BASE}billing`}
          onClick={e => { e.preventDefault(); window.location.href = `${BASE}billing`; }}
          className="ml-2 underline underline-offset-2 font-medium hover:opacity-80"
        >
          Upgrade plan
        </a>
      </div>
      {cfg.dismissible && (
        <button
          onClick={() => setDismissed(true)}
          className={`shrink-0 ${cfg.icon} hover:opacity-70 transition-opacity`}
          aria-label="Dismiss storage warning"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

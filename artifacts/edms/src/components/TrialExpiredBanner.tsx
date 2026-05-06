import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface BillingStatus {
  tier: string | null;
  trialEndsAt: string | null;
}

export function TrialExpiredBanner() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [location] = useLocation();

  useEffect(() => {
    const token = localStorage.getItem("edms_token");
    if (!token) return;

    fetch("/api/billing/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data: BillingStatus | null) => data && setStatus(data))
      .catch(() => null);
  }, []);

  if (!status) return null;
  if (status.tier !== "free" && status.tier !== "expired") return null;
  if (!status.trialEndsAt) return null;
  if (location === "/billing") return null;

  return (
    <div className="bg-amber-50 border-b border-amber-300 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-sm font-medium">
          Your trial has expired. Upgrade to continue full access.
        </span>
      </div>
      <a href="/billing">
        <Button
          size="sm"
          className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
        >
          Upgrade now
        </Button>
      </a>
    </div>
  );
}

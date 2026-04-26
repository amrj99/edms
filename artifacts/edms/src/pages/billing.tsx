import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, Loader2, AlertCircle, CreditCard,
  Zap, Building2, Rocket, Crown, ArrowRight, ExternalLink, RefreshCw,
  Sparkles, ShoppingCart, TrendingDown, TrendingUp, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Plan {
  id: string;
  name: string;
  description: string;
  priceAed: number;
  features: string[];
  minUsers?: number | null;
  maxUsers: number | null;
  storageMb: number;
  maxFileSizeMb?: number | null;
  popular?: boolean;
}

interface BillingStatus {
  tier: string;
  plan: Plan | null;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  seats: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface AiCreditTransaction {
  id: number;
  amount: number;
  transactionType: "purchase" | "consumption" | "grant";
  feature: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AiCreditPack {
  id: string;
  name: string;
  credits: number;
  description: string;
}

interface AiCreditsBalance {
  balance: number;
  totalPurchased: number;
  featureCosts: Record<string, number>;
  recentTransactions: AiCreditTransaction[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL;

async function fetchPlans(): Promise<{ plans: Plan[] }> {
  const r = await fetch(`${BASE}api/billing/plans`);
  if (!r.ok) throw new Error("Failed to load plans");
  return r.json();
}

async function fetchStatus(token: string): Promise<BillingStatus> {
  const r = await fetch(`${BASE}api/billing/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to load billing status");
  return r.json();
}

async function startCheckout(token: string, planId: string, seats: number): Promise<{ url: string }> {
  const r = await fetch(`${BASE}api/billing/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      planId,
      seats,
      successUrl: `${window.location.origin}/billing?success=true`,
      cancelUrl: `${window.location.origin}/billing?canceled=true`,
    }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? "Checkout failed");
  return json;
}

async function openPortal(token: string): Promise<{ url: string }> {
  const r = await fetch(`${BASE}api/billing/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ returnUrl: `${window.location.origin}/billing` }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? "Portal failed");
  return json;
}

async function fetchAiBalance(token: string): Promise<AiCreditsBalance> {
  const r = await fetch(`${BASE}api/ai-credits/balance`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to load AI credits balance");
  return r.json();
}

async function fetchAiPacks(token: string): Promise<{ packs: AiCreditPack[]; stripeConfigured: boolean }> {
  const r = await fetch(`${BASE}api/ai-credits/packs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to load AI credit packs");
  return r.json();
}

async function purchaseAiPack(token: string, packId: string): Promise<{ url: string }> {
  const r = await fetch(`${BASE}api/ai-credits/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      packId,
      successUrl: `${window.location.origin}/billing?ai_success=true`,
      cancelUrl: `${window.location.origin}/billing?ai_canceled=true`,
    }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? "Purchase failed");
  return json;
}

// ─── Plan icons ───────────────────────────────────────────────────────────────
const PLAN_ICONS: Record<string, React.ReactNode> = {
  starter: <Zap className="h-5 w-5" />,
  basic: <Rocket className="h-5 w-5" />,
  professional: <Building2 className="h-5 w-5" />,
  enterprise: <Crown className="h-5 w-5" />,
};

const PLAN_COLORS: Record<string, string> = {
  starter: "bg-blue-50 text-blue-600 border-blue-200",
  basic: "bg-violet-50 text-violet-600 border-violet-200",
  professional: "bg-amber-50 text-amber-600 border-amber-200",
  enterprise: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

function formatStorage(mb: number): string {
  if (mb >= 1048576) return `${mb / 1048576} TB`;
  if (mb >= 1024) return `${mb / 1024} GB`;
  return `${mb} MB`;
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────
function PlanCard({
  plan,
  isCurrent,
  seats,
  onSelect,
  loading,
}: {
  plan: Plan;
  isCurrent: boolean;
  seats: number;
  onSelect: (planId: string, seats: number) => void;
  loading: boolean;
}) {
  const [localSeats, setLocalSeats] = useState(seats || 1);

  return (
    <Card className={`relative flex flex-col transition-all border-2 ${isCurrent ? "border-primary shadow-lg shadow-primary/10" : plan.popular ? "border-violet-300" : "border-border"}`}>
      {plan.popular && !isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-violet-600 text-white border-0 text-xs font-semibold px-3 py-0.5">Most Popular</Badge>
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground border-0 text-xs font-semibold px-3 py-0.5">Current Plan</Badge>
        </div>
      )}
      <CardHeader className="pb-2">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border mb-3 ${PLAN_COLORS[plan.id]}`}>
          {PLAN_ICONS[plan.id]}
        </div>
        <CardTitle className="text-xl">{plan.name}</CardTitle>
        <CardDescription className="text-sm">{plan.description}</CardDescription>
        <div className="mt-2">
          {plan.id === "enterprise" ? (
            <span className="text-xl font-semibold text-muted-foreground">Custom Pricing</span>
          ) : (
            <>
              <span className="text-3xl font-bold">{plan.priceAed}</span>
              <span className="text-muted-foreground text-sm ml-1">AED / user / month</span>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-2">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-xs text-muted-foreground">
          {[
            plan.minUsers ? `Min. ${plan.minUsers} seats` : null,
            plan.minUsers && plan.maxUsers ? `${plan.minUsers}–${plan.maxUsers} users` : plan.maxUsers ? `Up to ${plan.maxUsers} users` : "Unlimited users",
            `${formatStorage(plan.storageMb)} storage`,
            plan.maxFileSizeMb
              ? `${plan.maxFileSizeMb >= 1024 ? `${plan.maxFileSizeMb / 1024} GB` : `${plan.maxFileSizeMb} MB`} max file`
              : null,
          ].filter(Boolean).join(" · ")}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        {plan.id === "enterprise" ? (
          <Button
            className="w-full"
            variant="outline"
            asChild
          >
            <a href="mailto:sales@arcscale.com">Contact Us</a>
          </Button>
        ) : (
          <>
            <div className="w-full flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Seats:</Label>
              <Input
                type="number"
                min={1}
                max={plan.maxUsers ?? 9999}
                value={localSeats}
                onChange={e => setLocalSeats(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-8 w-20 text-sm"
                disabled={loading || isCurrent}
              />
              <span className="text-xs text-muted-foreground ml-1">
                = <strong>{(plan.priceAed * localSeats).toLocaleString()}</strong> AED/mo
              </span>
            </div>
            <Button
              className="w-full"
              variant={isCurrent ? "outline" : "default"}
              disabled={loading}
              onClick={() => onSelect(plan.id, localSeats)}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isCurrent ? "Manage subscription" : `Subscribe to ${plan.name}`}
              {!loading && !isCurrent && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

// ─── AI Credits Section ────────────────────────────────────────────────────────
const LOW_BALANCE_THRESHOLD = 100;

const PACK_ACCENT: Record<string, { border: string; badge: string; icon: string }> = {
  ai_pack_small:  { border: "border-blue-200",   badge: "bg-blue-50 text-blue-700",   icon: "bg-blue-50 text-blue-600 border-blue-200" },
  ai_pack_medium: { border: "border-violet-200",  badge: "bg-violet-50 text-violet-700", icon: "bg-violet-50 text-violet-600 border-violet-200" },
  ai_pack_large:  { border: "border-amber-200",   badge: "bg-amber-50 text-amber-700",  icon: "bg-amber-50 text-amber-600 border-amber-200" },
};

function txLabel(tx: AiCreditTransaction): string {
  if (tx.transactionType === "grant") return "Free credits granted";
  if (tx.transactionType === "purchase") {
    const meta = tx.metadata as any;
    return meta?.packId ? `Pack purchased (${meta.packId.replace("ai_pack_", "")})` : "Credits purchased";
  }
  if (tx.feature) return tx.feature.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return "AI usage";
}

function AiCreditsSection({ token }: { token: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: balanceData, isLoading: balanceLoading, refetch: refetchBalance } = useQuery({
    queryKey: ["ai-credits-balance"],
    queryFn: () => fetchAiBalance(token),
    enabled: !!token,
    staleTime: 15_000,
  });

  const { data: packsData, isLoading: packsLoading } = useQuery({
    queryKey: ["ai-credits-packs"],
    queryFn: () => fetchAiPacks(token),
    enabled: !!token,
    staleTime: 300_000,
  });

  const purchaseMutation = useMutation({
    mutationFn: (packId: string) => purchaseAiPack(token, packId),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({
        title: "Purchase failed",
        description: err.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const balance = balanceData?.balance ?? 0;
  const totalPurchased = balanceData?.totalPurchased ?? 0;
  const transactions = balanceData?.recentTransactions ?? [];
  const packs = packsData?.packs ?? [];
  const stripeConfigured = packsData?.stripeConfigured ?? true;
  const isLow = balance <= LOW_BALANCE_THRESHOLD;
  const isZero = balance === 0;

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            AI Credits
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            One-time credit packs for AI features. No subscription — buy when you need.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetchBalance()} disabled={balanceLoading}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* Low / zero balance warning */}
      {!balanceLoading && isZero && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>No AI credits remaining.</strong> AI features are currently disabled for your organisation.
            Purchase a pack below to re-enable them.
          </AlertDescription>
        </Alert>
      )}
      {!balanceLoading && !isZero && isLow && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            <strong>Credits running low</strong> — {balance} remaining. Consider topping up to avoid interruptions.
          </AlertDescription>
        </Alert>
      )}

      {/* Balance summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            {balanceLoading ? (
              <div className="h-10 flex items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-1">Current Balance</p>
                <p className={`text-3xl font-bold ${isZero ? "text-red-600" : isLow ? "text-amber-600" : "text-foreground"}`}>
                  {balance.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">credits available</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            {balanceLoading ? (
              <div className="h-10 flex items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-1">Total Purchased</p>
                <p className="text-3xl font-bold">{totalPurchased.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">credits all time</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Credit packs */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          Buy Credits
        </h3>
        {!packsLoading && !stripeConfigured && (
          <Alert className="mb-4 border-yellow-300 bg-yellow-50">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              Credit purchases are currently unavailable — Stripe has not been configured by your system administrator. Contact your admin to enable payments.
            </AlertDescription>
          </Alert>
        )}
        {packsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {packs.map((pack) => {
              const accent = PACK_ACCENT[pack.id] ?? PACK_ACCENT.ai_pack_small;
              const isBuying = purchaseMutation.isPending && purchaseMutation.variables === pack.id;
              return (
                <Card key={pack.id} className={`border-2 ${accent.border} flex flex-col`}>
                  <CardHeader className="pb-2">
                    <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border mb-2 ${accent.icon}`}>
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-base">{pack.name}</CardTitle>
                    <CardDescription className="text-xs">{pack.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 pb-2">
                    <p className="text-2xl font-bold">{pack.credits.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">credits</p>
                  </CardContent>
                  <CardFooter>
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={purchaseMutation.isPending}
                      onClick={() => purchaseMutation.mutate(pack.id)}
                    >
                      {isBuying
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        : <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                      }
                      Buy
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent transactions */}
      {!balanceLoading && transactions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Recent Activity
          </h3>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {transactions.map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {tx.amount > 0
                        ? <TrendingUp className="h-4 w-4 text-green-500 shrink-0" />
                        : <TrendingDown className="h-4 w-4 text-red-400 shrink-0" />
                      }
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{txLabel(tx)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          {" "}
                          {new Date(tx.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-semibold shrink-0 ml-4 ${tx.amount > 0 ? "text-green-600" : "text-foreground"}`}>
                      {tx.amount > 0 ? "+" : ""}{tx.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {!balanceLoading && transactions.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No transactions yet.</p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const urlParams = new URLSearchParams(window.location.search);
  const justSucceeded = urlParams.get("success") === "true";
  const justCanceled = urlParams.get("canceled") === "true";
  const aiJustSucceeded = urlParams.get("ai_success") === "true";
  const aiJustCanceled = urlParams.get("ai_canceled") === "true";

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ["billing-plans"],
    queryFn: fetchPlans,
    staleTime: 60_000,
  });

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["billing-status"],
    queryFn: () => fetchStatus(token!),
    enabled: !!token,
    staleTime: 30_000,
  });

  const checkoutMutation = useMutation({
    mutationFn: ({ planId, seats }: { planId: string; seats: number }) =>
      startCheckout(token!, planId, seats),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({
        title: "Checkout failed",
        description: err.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => openPortal(token!),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({
        title: "Could not open billing portal",
        description: err.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSelect = (planId: string, seats: number) => {
    if (status?.tier === planId && status?.stripeSubscriptionId) {
      portalMutation.mutate();
    } else {
      checkoutMutation.mutate({ planId, seats });
    }
  };

  const isLoading = plansLoading || statusLoading;
  const mutating = checkoutMutation.isPending || portalMutation.isPending;
  const plans = plansData?.plans ?? [];

  const statusColor: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    trialing: "bg-blue-100 text-blue-700",
    past_due: "bg-amber-100 text-amber-700",
    canceled: "bg-red-100 text-red-700",
    inactive: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing &amp; Subscription</h1>
        <p className="text-muted-foreground mt-1">
          Manage your ArcScale subscription. Seat-based pricing — pay only for active users.
        </p>
      </div>

      {/* Success / cancel banners — subscription */}
      {justSucceeded && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Subscription activated successfully! Your plan is now live.
          </AlertDescription>
        </Alert>
      )}
      {justCanceled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Checkout was canceled. No charges were made.</AlertDescription>
        </Alert>
      )}

      {/* Success / cancel banners — AI credits */}
      {aiJustSucceeded && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            AI credits purchased successfully! Your balance has been updated.
          </AlertDescription>
        </Alert>
      )}
      {aiJustCanceled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>AI credit purchase was canceled. No charges were made.</AlertDescription>
        </Alert>
      )}

      {/* Current subscription card */}
      {!statusLoading && status && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Current Subscription
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => refetchStatus()} disabled={statusLoading}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6 items-center">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Plan</p>
                <p className="font-semibold capitalize">{status.plan?.name ?? "Free"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColor[status.subscriptionStatus] ?? statusColor.inactive}`}>
                  {status.subscriptionStatus}
                </span>
              </div>
              {status.seats > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Seats</p>
                  <p className="font-semibold">{status.seats}</p>
                </div>
              )}
              {status.currentPeriodEnd && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Renews / Ends</p>
                  <p className="font-semibold">{new Date(status.currentPeriodEnd).toLocaleDateString()}</p>
                </div>
              )}
              {status.plan && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Monthly Total</p>
                  <p className="font-semibold">{(status.plan.priceAed * (status.seats || 1)).toLocaleString()} AED</p>
                </div>
              )}
              {status.stripeSubscriptionId && (
                <div className="ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                  >
                    {portalMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <ExternalLink className="h-3.5 w-3.5 mr-1" />}
                    Manage in Stripe
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Plans grid */}
      <div>
        <h2 className="text-xl font-semibold mb-1">Available Plans</h2>
        <p className="text-sm text-muted-foreground mb-6">
          All prices in UAE Dirham (AED), billed monthly per active seat.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={status?.tier === plan.id}
                seats={status?.seats || 1}
                onSelect={handleSelect}
                loading={mutating}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stripe not configured notice */}
      {!isLoading && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Stripe integration:</strong> To enable live payments, connect your Stripe account in the integrations panel.
            Checkout buttons will direct you through Stripe's secure payment flow once connected.
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      {/* AI Credits section */}
      {token && <AiCreditsSection token={token} />}
    </div>
  );
}

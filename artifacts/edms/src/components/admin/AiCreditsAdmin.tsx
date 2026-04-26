import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sparkles, AlertCircle, RefreshCw, Loader2, CheckCircle2, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OrgBalance {
  id: number;
  name: string;
  balance: number;
  totalPurchased: number;
}

const BASE = import.meta.env.BASE_URL;

async function fetchBalances(): Promise<{ organizations: OrgBalance[] }> {
  const r = await fetch(`${BASE}api/ai-credits/admin/balances`);
  if (!r.ok) throw new Error("Failed to load balances");
  return r.json();
}

async function grantCredits(payload: { organizationId: number; amount: number; note: string }): Promise<{
  newBalance: number;
  organizationName: string;
  amount: number;
}> {
  const r = await fetch(`${BASE}api/ai-credits/admin/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? "Grant failed");
  return json;
}

export function AiCreditsAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin-ai-credit-balances"],
    queryFn: fetchBalances,
    staleTime: 15_000,
  });

  const grantMutation = useMutation({
    mutationFn: grantCredits,
    onSuccess: (result) => {
      toast({
        title: "Credits granted",
        description: `${result.amount.toLocaleString()} credits added to ${result.organizationName}. New balance: ${result.newBalance.toLocaleString()}.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-ai-credit-balances"] });
      setSelectedOrgId("");
      setAmount("");
      setNote("");
    },
    onError: (err: any) => {
      toast({
        title: "Grant failed",
        description: err.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const orgs = data?.organizations ?? [];

  const handleGrant = () => {
    const orgId = parseInt(selectedOrgId);
    const credits = parseInt(amount);
    if (!orgId || !credits || credits <= 0) return;
    grantMutation.mutate({ organizationId: orgId, amount: credits, note });
  };

  const amountNum = parseInt(amount) || 0;
  const canSubmit = !!selectedOrgId && amountNum > 0 && !grantMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Grant form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="h-4 w-4 text-violet-500" />
            Grant AI Credits
          </CardTitle>
          <CardDescription>
            Manually add credits to any organisation. Use for pilots, refunds, or promotions.
            All grants are recorded with your identity for audit purposes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Organisation selector */}
            <div className="space-y-1.5">
              <Label>Organisation *</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organisation…" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map(org => (
                    <SelectItem key={org.id} value={String(org.id)}>
                      {org.name}
                      <span className="ml-2 text-muted-foreground text-xs">
                        ({org.balance.toLocaleString()} credits)
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label>Credits to grant *</Label>
              <Input
                type="number"
                min={1}
                max={1000000}
                placeholder="e.g. 1000"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label>Reason / note</Label>
              <Input
                placeholder="e.g. pilot programme, refund…"
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleGrant}
              disabled={!canSubmit}
              className="gap-2"
            >
              {grantMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Sparkles className="h-4 w-4" />
              }
              Grant {amountNum > 0 ? amountNum.toLocaleString() : ""} credits
            </Button>
            {grantMutation.isSuccess && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" /> Done
              </span>
            )}
          </div>

          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 text-xs">
              Grants are permanent and cannot be automatically reversed. They are recorded with your user account in the transaction log.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* All org balances */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Credit Balances by Organisation
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No organisations found.</p>
          ) : (
            <ul className="divide-y">
              {orgs.map(org => {
                const isZero = org.balance === 0;
                const isLow = org.balance > 0 && org.balance <= 100;
                return (
                  <li key={org.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{org.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {org.totalPurchased.toLocaleString()} purchased all time
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      {isZero && (
                        <Badge variant="destructive" className="text-xs">No credits</Badge>
                      )}
                      {isLow && (
                        <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">Low</Badge>
                      )}
                      <span className={`text-sm font-semibold ${isZero ? "text-red-600" : isLow ? "text-amber-600" : ""}`}>
                        {org.balance.toLocaleString()}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

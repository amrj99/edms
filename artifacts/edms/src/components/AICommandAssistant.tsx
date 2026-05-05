import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Loader2, Sparkles, CheckCircle, AlertCircle, X, Send,
  Zap, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

// ─── Session flag — upgrade hint shown at most once per page load ─────────────
let _upgradeHintShownThisSession = false;

// ─── Example prompts ──────────────────────────────────────────────────────────
const EXAMPLES = [
  "Schedule a progress review meeting for next Tuesday at 10am in Conference Room A",
  "Create an RFI about anchor bolt specifications for foundation design",
  "Draft a memo informing the team about revised drawing submission dates",
  "Create a high priority notice about a non-conformance in concrete pour CE-042",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface AIMetadata {
  provider: string;
  tier: "free" | "premium";
  upgradeAvailable: boolean;
  complexity?: string;
  fallback?: boolean;
}

interface CommandResult {
  action: "create" | "unknown";
  type?: "correspondence" | "meeting" | "document" | "task";
  data?: Record<string, any>;
  summary: string;
  _ai?: AIMetadata;
}

interface GateResult {
  requiresPremium: true;
  estimatedCredits: number;
  complexity: string;
  complexityReason: string;
  _ai: AIMetadata;
}

type ApiResponse = CommandResult | GateResult;

function isGateResult(r: ApiResponse): r is GateResult {
  return "requiresPremium" in r && (r as GateResult).requiresPremium === true;
}

// ─── Tier badge ───────────────────────────────────────────────────────────────

function TierBadge({ ai }: { ai?: AIMetadata }) {
  if (!ai) return null;
  const isPremium = ai.tier === "premium";
  const label = ai.fallback
    ? `Free · Fallback`
    : isPremium
    ? `Premium · ${ai.provider}`
    : `Free · ${ai.provider}`;
  return (
    <Badge
      variant="outline"
      className={`text-[10px] h-5 px-1.5 gap-0.5 font-normal shrink-0 ${
        isPremium
          ? "border-amber-400/50 text-amber-600 dark:text-amber-400"
          : "border-green-500/40 text-green-600 dark:text-green-400"
      }`}
    >
      {isPremium
        ? <Zap className="h-2.5 w-2.5" />
        : <Sparkles className="h-2.5 w-2.5" />}
      {label}
    </Badge>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AICommandAssistant() {
  const [open, setOpen]                       = useState(false);
  const [command, setCommand]                 = useState("");
  const [advanced, setAdvanced]               = useState(false);
  const [showAdvancedPanel, setShowAdvancedPanel] = useState(false);
  const [result, setResult]                   = useState<CommandResult | null>(null);
  const [gateResult, setGateResult]           = useState<GateResult | null>(null);
  const [creating, setCreating]               = useState(false);
  const [showUpgradeHint, setShowUpgradeHint] = useState(false);

  const { toast }    = useToast();
  const qc           = useQueryClient();
  const [, navigate] = useLocation();

  // ── Core fetch ───────────────────────────────────────────────────────────────
  const sendCommand = async (cmd: string, adv: boolean, bypassGate = false): Promise<ApiResponse> => {
    const r = await fetch("/api/ai/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ command: cmd, advanced: adv, bypassGate }),
    });
    if (!r.ok) throw new Error("AI service unavailable");
    return r.json();
  };

  // ── Mutation ──────────────────────────────────────────────────────────────────
  const analyzeCmd = useMutation({
    mutationFn: ({ cmd, adv, bypassGate = false }: { cmd: string; adv: boolean; bypassGate?: boolean }) =>
      sendCommand(cmd, adv, bypassGate),
    onSuccess: (data) => {
      if (isGateResult(data)) {
        setGateResult(data);
        setResult(null);
      } else {
        setGateResult(null);
        setResult(data);
        // Upgrade hint — once per session only
        if (data._ai?.upgradeAvailable && !_upgradeHintShownThisSession) {
          setShowUpgradeHint(true);
          _upgradeHintShownThisSession = true;
        }
      }
    },
    onError: () =>
      toast({ title: "AI unavailable", description: "Could not process your command", variant: "destructive" }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleAnalyze = (adv: boolean = advanced) => {
    if (!command.trim() || analyzeCmd.isPending) return;
    analyzeCmd.mutate({ cmd: command.trim(), adv });
  };

  const handleFreeAnalysis = () => {
    setGateResult(null);
    analyzeCmd.mutate({ cmd: command.trim(), adv: false, bypassGate: true });
  };

  const handleAdvancedAnalysis = () => {
    setGateResult(null);
    analyzeCmd.mutate({ cmd: command.trim(), adv: true });
  };

  const handleCreate = async () => {
    if (!result?.data || result.action !== "create") return;
    setCreating(true);
    try {
      let endpoint = "";
      const body: Record<string, any> = { ...result.data };

      if (result.type === "meeting") {
        endpoint = "/api/meetings";
      } else if (result.type === "correspondence") {
        endpoint = "/api/projects/0/correspondence";
        body.sendNow = true;
      } else if (result.type === "task") {
        endpoint = "/api/tasks";
      } else if (result.type === "document") {
        endpoint = "/api/documents";
      } else {
        toast({ title: "Unsupported record type" });
        setCreating(false);
        return;
      }

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message || "Failed to create record");
      }

      toast({
        title: `${result.type?.charAt(0).toUpperCase()}${result.type?.slice(1)} created!`,
        description: result.summary,
      });
      qc.invalidateQueries({ queryKey: [result.type + "s"] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["correspondence"] });

      setOpen(false);
      setCommand("");
      setResult(null);

      if (result.type === "meeting") navigate("/meetings");
      else if (result.type === "correspondence") navigate("/correspondence");
    } catch (err: any) {
      toast({ title: "Creation failed", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setGateResult(null);
    setCommand("");
    setShowUpgradeHint(false);
  };

  const handleClose = () => {
    setOpen(false);
    handleReset();
    setAdvanced(false);
    setShowAdvancedPanel(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs px-2.5 border-primary/30 hover:border-primary/60 hover:bg-primary/5"
        onClick={() => setOpen(true)}
        title="AI Command Assistant"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="hidden md:block">AI</span>
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              AI Command Assistant
            </DialogTitle>
          </DialogHeader>

          {/* ── State: input ── */}
          {!result && !gateResult && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Describe what you want to create in plain language. The AI will parse your intent and pre-fill a new record.
              </p>

              <Textarea
                placeholder="e.g. Create an RFI about anchor bolt specifications for foundation design..."
                value={command}
                onChange={e => setCommand(e.target.value)}
                rows={4}
                className="resize-none"
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAnalyze();
                }}
              />

              {/* Advanced Analysis toggle */}
              <div className="border rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvancedPanel(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    Advanced Analysis
                  </span>
                  {showAdvancedPanel
                    ? <ChevronUp className="h-3.5 w-3.5" />
                    : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {showAdvancedPanel && (
                  <div className="border-t px-3 py-3 bg-muted/20 flex items-center justify-between gap-4">
                    <div>
                      <Label className="text-xs font-medium">Use premium model</Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Higher reasoning accuracy for complex requests — uses 5 credits
                      </p>
                    </div>
                    <Switch checked={advanced} onCheckedChange={setAdvanced} />
                  </div>
                )}
              </div>

              {/* Examples */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground font-medium">Examples:</p>
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left text-xs text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-3 py-2 rounded-md transition-colors"
                    onClick={() => setCommand(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button
                  onClick={() => handleAnalyze()}
                  disabled={!command.trim() || analyzeCmd.isPending}
                  className="gap-1.5"
                >
                  {analyzeCmd.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : advanced ? <Zap className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                  {analyzeCmd.isPending
                    ? "Analyzing…"
                    : advanced ? "Analyze — 5 credits ⌘↵" : "Analyze ⌘↵"}
                </Button>
              </div>
            </div>
          )}

          {/* ── State: gate (requiresPremium) ── */}
          {gateResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Zap className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      This looks like an advanced request
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 capitalize">
                      Reason: {gateResult.complexityReason}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  Advanced analysis uses <strong>{gateResult.estimatedCredits} credits</strong> and
                  runs on a higher-reasoning model. Free analysis is available but may give a simpler result.
                </p>
                {analyzeCmd.isPending && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analyzing…
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleReset} className="gap-1.5">
                  <X className="h-3.5 w-3.5" /> Back
                </Button>
                <Button
                  variant="outline"
                  onClick={handleFreeAnalysis}
                  disabled={analyzeCmd.isPending}
                  className="gap-1.5"
                >
                  {analyzeCmd.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5" />}
                  Use Free Analysis
                </Button>
                <Button
                  onClick={handleAdvancedAnalysis}
                  disabled={analyzeCmd.isPending}
                  className="gap-1.5"
                >
                  {analyzeCmd.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Zap className="h-3.5 w-3.5" />}
                  Advanced — {gateResult.estimatedCredits} credits
                </Button>
              </div>
            </div>
          )}

          {/* ── State: result ── */}
          {result && (
            <div className="space-y-4">
              {result.action === "unknown" ? (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Could not parse command</p>
                    <p className="text-sm text-amber-700 mt-0.5">{result.summary}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg dark:bg-green-950/20 dark:border-green-800">
                    <CheckCircle className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="secondary" className="capitalize">{result.type}</Badge>
                        <p className="text-sm font-medium text-green-800 dark:text-green-300">Ready to create</p>
                        <div className="ml-auto">
                          <TierBadge ai={result._ai} />
                        </div>
                      </div>
                      <p className="text-sm text-green-700 dark:text-green-400">{result.summary}</p>
                    </div>
                  </div>

                  {result.data && (
                    <div className="border rounded-lg divide-y text-sm">
                      {Object.entries(result.data)
                        .filter(([, v]) => v !== null && v !== undefined && v !== "")
                        .map(([k, v]) => (
                          <div key={k} className="flex gap-3 px-3 py-2">
                            <span className="text-muted-foreground capitalize w-28 shrink-0">
                              {k.replace(/([A-Z])/g, " $1").trim()}
                            </span>
                            <span className="font-medium text-foreground truncate">{String(v)}</span>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Soft upgrade hint — once per session */}
                  {showUpgradeHint && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary/60" />
                      <p>
                        For deeper analysis (compliance, multi-document, reports), enable{" "}
                        <strong>Advanced Analysis</strong> — 5 credits.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={handleReset} className="gap-1.5">
                  <X className="h-3.5 w-3.5" /> Try Again
                </Button>
                {result.action === "create" && (
                  <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
                    {creating
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle className="h-3.5 w-3.5" />}
                    {creating ? "Creating…" : `Create ${result.type}`}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

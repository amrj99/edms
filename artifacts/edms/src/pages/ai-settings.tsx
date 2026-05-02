import { useState, useEffect } from "react";
import {
  Brain, FileText, Mail, CheckSquare, Search, Bell, Users, Clipboard,
  Loader2, Save, Sparkles, Info, Check, AlertTriangle, Server, Zap,
  ChevronDown, ChevronUp, Settings2, Ban, Globe, Cloud, DollarSign, ExternalLink,
  Shield, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

interface AiModuleConfig {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  features: string[];
}

const AI_MODULES: AiModuleConfig[] = [
  {
    key: "documents",
    label: "Documents",
    description: "Auto-summarization, classification, intelligent tagging, and urgency detection.",
    icon: FileText,
    features: ["Auto summarize", "Classify document type", "Suggest discipline & tags", "Detect urgency level"],
  },
  {
    key: "correspondence",
    label: "Correspondence",
    description: "Categorize, detect urgency, suggest replies, and identify action items.",
    icon: Mail,
    features: ["Categorize type", "Urgency detection", "Reply draft suggestions", "Action item extraction"],
  },
  {
    key: "tasks",
    label: "Tasks & Workflow",
    description: "Priority prediction, bottleneck detection, and smart recommendations.",
    icon: CheckSquare,
    features: ["Priority scoring", "Bottleneck detection", "Risk assessment", "Workload recommendations"],
  },
  {
    key: "search",
    label: "Smart Search",
    description: "Natural language search queries across all project data.",
    icon: Search,
    features: ["Natural language queries", "Auto-extract filters", "Related search suggestions", "Context-aware results"],
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "Predict urgency and suggest escalations for incoming notifications.",
    icon: Bell,
    features: ["Urgency scoring", "Auto-escalation suggestions", "Critical alert detection"],
  },
  {
    key: "meetings",
    label: "Meetings",
    description: "Summarize meeting notes and auto-generate action items.",
    icon: Users,
    features: ["Meeting summarization", "Key point extraction", "Auto-generate tasks", "Follow-up tracking"],
  },
  {
    key: "inspections",
    label: "Inspections",
    description: "Categorize inspection reports and detect recurring issues.",
    icon: Clipboard,
    features: ["Report categorization", "Trend detection", "Outcome summaries", "Anomaly detection"],
  },
];

type AIProvider =
  | "cloudflare" | "openrouter" | "huggingface" | "together" | "ollama"
  | "openai" | "anthropic" | "groq" | "none";

interface ProviderInfo {
  configured: boolean;
  isFree: boolean;
  label: string;
  description: string;
  envVarsRequired: string[];
  docsUrl: string | null;
}

interface ProviderData {
  provider: AIProvider;
  fastModel: string;
  smartModel: string;
  providerStatus: Record<string, ProviderInfo>;
}

const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  cloudflare:  Cloud,
  openrouter:  Globe,
  huggingface: Sparkles,
  together:    Zap,
  ollama:      Server,
  openai:      Sparkles,
  anthropic:   Brain,
  groq:        Zap,
  none:        Ban,
};

const PROVIDER_COLORS: Record<string, string> = {
  cloudflare:  "text-orange-500",
  openrouter:  "text-blue-500",
  huggingface: "text-yellow-500",
  together:    "text-purple-500",
  ollama:      "text-green-600",
  openai:      "text-violet-600",
  anthropic:   "text-orange-400",
  groq:        "text-teal-500",
  none:        "text-muted-foreground",
};

const PROVIDER_DEFAULTS: Record<string, { fast: string; smart: string }> = {
  cloudflare:  { fast: "@cf/meta/llama-3.2-3b-instruct",        smart: "@cf/mistral/mistral-7b-instruct-v0.1" },
  openrouter:  { fast: "meta-llama/llama-3.2-3b-instruct:free", smart: "mistralai/mistral-7b-instruct:free" },
  huggingface: { fast: "mistralai/Mistral-7B-Instruct-v0.3",    smart: "meta-llama/Meta-Llama-3-8B-Instruct" },
  together:    { fast: "meta-llama/Llama-3.2-3B-Instruct-Turbo", smart: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" },
  groq:        { fast: "llama-3.1-8b-instant",                   smart: "llama-3.3-70b-versatile" },
  ollama:      { fast: "llama3.2",                               smart: "llama3.1" },
  openai:      { fast: "gpt-4o-mini",                            smart: "gpt-4o" },
  anthropic:   { fast: "claude-3-haiku-20240307",                smart: "claude-3-5-sonnet-20241022" },
  none:        { fast: "", smart: "" },
};

const PROVIDER_GROUPS: Array<{
  label: string;
  description: string;
  keys: string[];
}> = [
  {
    label: "Cloud — Free",
    description: "Recommended for production — zero cost, no API key required for Cloudflare",
    keys: ["cloudflare", "openrouter", "huggingface"],
  },
  {
    label: "Cloud — Fast",
    description: "Ultra-low latency inference, generous free tier",
    keys: ["groq"],
  },
  {
    label: "Cloud — Paid",
    description: "Higher accuracy for complex reasoning tasks, usage-based billing",
    keys: ["together", "openai", "anthropic"],
  },
  {
    label: "Local — Self-Hosted",
    description: "Runs on your infrastructure — no data leaves your network",
    keys: ["ollama"],
  },
];

export default function AISettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [providerData, setProviderData] = useState<ProviderData | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerSaving, setProviderSaving] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("cloudflare");
  const [fastModel, setFastModel] = useState("");
  const [smartModel, setSmartModel] = useState("");
  const [showModels, setShowModels] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [classificationEnabled, setClassificationEnabled] = useState(true);
  const [classificationLoading, setClassificationLoading] = useState(true);
  const [classificationSaving, setClassificationSaving] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(true);
  const [privacySaving, setPrivacySaving] = useState(false);

  const isSysAdmin = (user as any)?.isSysAdmin === true || (user as any)?.role === "sysadmin" || (user as any)?.role === "system_owner";

  useEffect(() => {
    fetch("/api/ai/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { setSettings(data); setIsLoading(false); })
      .catch(() => setIsLoading(false));

    fetch("/api/ai/provider", { credentials: "include" })
      .then((r) => r.json())
      .then((data: ProviderData) => {
        setProviderData(data);
        setSelectedProvider(data.provider as AIProvider);
        setFastModel(data.fastModel);
        setSmartModel(data.smartModel);
        setProviderLoading(false);
      })
      .catch(() => setProviderLoading(false));

    fetch("/api/admin/ai-classification", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { enabled: true })
      .then((d) => { setClassificationEnabled(d.enabled ?? true); setClassificationLoading(false); })
      .catch(() => setClassificationLoading(false));

    fetch("/api/ai/privacy-mode", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { aiPrivacyMode: false })
      .then((d) => { setPrivacyMode(d.aiPrivacyMode ?? false); setPrivacyLoading(false); })
      .catch(() => setPrivacyLoading(false));
  }, []);

  const handleSaveClassification = async (val: boolean) => {
    setClassificationSaving(true);
    try {
      const res = await fetch("/api/admin/ai-classification", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: val }),
      });
      if (!res.ok) throw new Error("Save failed");
      setClassificationEnabled(val);
      toast({ title: val ? "Classification enabled" : "Classification disabled" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save classification setting" });
    } finally {
      setClassificationSaving(false);
    }
  };

  const handleSavePrivacyMode = async (val: boolean) => {
    setPrivacySaving(true);
    try {
      const res = await fetch("/api/ai/privacy-mode", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiPrivacyMode: val }),
      });
      if (!res.ok) throw new Error("Save failed");
      setPrivacyMode(val);
      toast({
        title: val ? "Privacy mode enabled" : "Privacy mode disabled",
        description: val
          ? "AI analysis will use only document metadata — no content sent to external providers."
          : "AI analysis will use full document content for higher accuracy.",
      });
    } catch {
      toast({ variant: "destructive", title: "Failed to save privacy mode setting" });
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleToggle = (module: string, enabled: boolean) => {
    setSettings((prev) => ({ ...prev, [module]: enabled }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast({ title: "AI settings saved", description: "Module settings updated successfully." });
    } catch {
      toast({ variant: "destructive", title: "Save failed", description: "Could not save AI settings." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProvider = async () => {
    setProviderSaving(true);
    try {
      const res = await fetch("/api/ai/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: selectedProvider, fastModel, smartModel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to save");
      }
      const data: ProviderData = await res.json();
      setProviderData(data);
      setFastModel(data.fastModel);
      setSmartModel(data.smartModel);
      toast({ title: "AI provider saved", description: `Switched to ${data.providerStatus[data.provider]?.label ?? data.provider}.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e.message });
    } finally {
      setProviderSaving(false);
    }
  };

  const handleSelectProvider = (p: AIProvider) => {
    setSelectedProvider(p);
    if (providerData && p !== providerData.provider) {
      setFastModel(PROVIDER_DEFAULTS[p]?.fast ?? "");
      setSmartModel(PROVIDER_DEFAULTS[p]?.smart ?? "");
    } else if (providerData) {
      setFastModel(providerData.fastModel);
      setSmartModel(providerData.smartModel);
    }
  };

  const enabledCount = Object.values(settings).filter(Boolean).length;
  const activeProviderInfo = providerData?.providerStatus[providerData.provider];

  const renderProviderCard = (key: string, info: ProviderInfo) => {
    const Icon = PROVIDER_ICONS[key] ?? Globe;
    const colorCls = PROVIDER_COLORS[key] ?? "text-muted-foreground";
    const isSelected = selectedProvider === key;
    const isActive = providerData?.provider === key;

    return (
      <button
        key={key}
        onClick={() => isSysAdmin ? handleSelectProvider(key as AIProvider) : undefined}
        disabled={!isSysAdmin}
        className={`w-full text-left rounded-lg border p-4 transition-all ${
          isSelected
            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
            : "border-border hover:border-primary/40 hover:bg-muted/30"
        } ${!isSysAdmin ? "cursor-default" : "cursor-pointer"}`}
      >
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${
            isSelected ? "bg-primary/10" : "bg-muted"
          }`}>
            <Icon className={`h-4 w-4 ${isSelected ? colorCls : "text-muted-foreground"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{info.label}</span>
              {isActive && (
                <Badge className="text-[10px] py-0 px-1.5 h-4 bg-primary/10 text-primary border-0">Active</Badge>
              )}
              {info.isFree ? (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-green-500/40 text-green-600">Free</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-amber-500/40 text-amber-600 gap-0.5">
                  <DollarSign className="h-2.5 w-2.5" />Paid
                </Badge>
              )}
              <span className={`ml-auto flex items-center gap-1 text-xs ${info.configured ? "text-green-600" : "text-amber-500"}`}>
                {info.configured ? <><Check className="h-3 w-3" />Configured</> : <><AlertTriangle className="h-3 w-3" />Not set up</>}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
            {!info.configured && info.envVarsRequired.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Required:</span>
                {info.envVarsRequired.map((v) => (
                  <code key={v} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">{v}</code>
                ))}
                {info.docsUrl && (
                  <a href={info.docsUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary flex items-center gap-0.5 hover:underline ml-1" onClick={e => e.stopPropagation()}>
                    Get key <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            )}
          </div>
          {isSelected && (
            <div className="flex-shrink-0 text-primary">
              <Check className="h-4 w-4" />
            </div>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            AI Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your AI provider and control which modules use AI analysis.
          </p>
        </div>
      </div>

      {/* ── AI Provider Section ─────────────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">AI Provider</h2>
            {providerData && (
              <Badge variant="outline" className="ml-auto text-xs gap-1">
                {(() => { const I = PROVIDER_ICONS[providerData.provider] ?? Globe; return <I className="h-3 w-3" />; })()}
                {activeProviderInfo?.label ?? providerData.provider}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Free providers are recommended for production. Paid providers offer higher reasoning accuracy.
          </p>
        </div>

        {providerLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !providerData ? (
          <div className="p-5">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">Could not load provider settings.</AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {PROVIDER_GROUPS.map((group) => {
              const groupProviders = group.keys.filter(k => providerData.providerStatus[k]);
              if (groupProviders.length === 0) return null;
              return (
                <div key={group.label}>
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{group.description}</p>
                  </div>
                  <div className="grid gap-2">
                    {groupProviders.map(k => renderProviderCard(k, providerData.providerStatus[k]))}
                  </div>
                </div>
              );
            })}

            {/* Disable option (collapsible) */}
            <div>
              <button
                onClick={() => setShowDisable(v => !v)}
                className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground mb-2"
              >
                {showDisable ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Disable AI option
              </button>
              {showDisable && providerData.providerStatus["none"] && (
                <div className="grid gap-2">
                  {renderProviderCard("none", providerData.providerStatus["none"])}
                </div>
              )}
            </div>

            {/* Advanced model settings */}
            {isSysAdmin && selectedProvider !== "none" && (
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowModels((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/40 transition-colors"
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Settings2 className="h-3.5 w-3.5" />
                    Advanced: Model Names
                  </span>
                  {showModels ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {showModels && (
                  <div className="px-4 py-3 border-t bg-muted/20 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Fast Model <span className="text-muted-foreground">(standard tasks)</span></Label>
                      <Input
                        value={fastModel}
                        onChange={(e) => setFastModel(e.target.value)}
                        placeholder={PROVIDER_DEFAULTS[selectedProvider]?.fast ?? "e.g. llama-3.2-3b"}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Smart Model <span className="text-muted-foreground">(complex reasoning)</span></Label>
                      <Input
                        value={smartModel}
                        onChange={(e) => setSmartModel(e.target.value)}
                        placeholder={PROVIDER_DEFAULTS[selectedProvider]?.smart ?? "e.g. mistral-7b"}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isSysAdmin && (
              <Alert className="py-2.5">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">Only system administrators can change the AI provider.</AlertDescription>
              </Alert>
            )}

            {isSysAdmin && (
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSaveProvider} disabled={providerSaving} className="gap-1.5">
                  {providerSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save Provider
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Privacy Mode ─────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Privacy Mode</h2>
            {!privacyLoading && (
              <Badge
                variant="outline"
                className={`ml-auto text-xs ${privacyMode ? "border-blue-500/40 text-blue-600" : "border-muted text-muted-foreground"}`}
              >
                {privacyMode ? "Enabled" : "Disabled"}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            When enabled, AI analysis uses only document metadata — no content is sent to external providers.
          </p>
        </div>
        <div className="p-5">
          {privacyLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={privacyMode}
                      onCheckedChange={isSysAdmin ? handleSavePrivacyMode : undefined}
                      disabled={!isSysAdmin || privacySaving}
                    />
                    <Label className="text-sm">
                      {privacyMode ? "Privacy mode active — metadata only" : "Privacy mode off — full content analysis"}
                    </Label>
                    {privacySaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className={`rounded-lg border p-3 text-xs transition-opacity ${privacyMode ? "" : "opacity-40"}`}>
                      <p className="font-semibold flex items-center gap-1.5"><Lock className="h-3 w-3 text-blue-500" />Metadata Only</p>
                      <p className="text-muted-foreground mt-0.5">Filename, type, status, and revision — no body text</p>
                    </div>
                    <div className={`rounded-lg border p-3 text-xs transition-opacity ${!privacyMode ? "" : "opacity-40"}`}>
                      <p className="font-semibold flex items-center gap-1.5"><Brain className="h-3 w-3 text-primary" />Full Analysis</p>
                      <p className="text-muted-foreground mt-0.5">Title, description, and full content for higher accuracy</p>
                    </div>
                  </div>
                </div>
              </div>
              {privacyMode && (
                <Alert className="py-2.5 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <AlertDescription className="text-xs text-blue-700 dark:text-blue-300">
                    Privacy mode is active. Document and correspondence content will not leave your infrastructure. Analysis accuracy may be reduced.
                  </AlertDescription>
                </Alert>
              )}
              {!isSysAdmin && (
                <Alert className="py-2.5">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">Only system administrators can change the privacy mode setting.</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── AI Classification Section ─────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">AI Classification</h2>
            {!classificationLoading && (
              <Badge variant="outline" className={`ml-auto text-xs ${classificationEnabled ? "border-green-500 text-green-600" : "border-muted text-muted-foreground"}`}>
                {classificationEnabled ? "Enabled" : "Disabled"}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            When enabled, new documents and correspondence are automatically classified with a category, tags, and priority before any automation rules run.
          </p>
        </div>
        <div className="p-5">
          {classificationLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <Switch checked={classificationEnabled} onCheckedChange={handleSaveClassification} disabled={classificationSaving} />
                  <Label className="text-sm">
                    {classificationEnabled ? "Classification active" : "Classification disabled (rules-only mode)"}
                  </Label>
                  {classificationSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: "Category", desc: "Document or correspondence type" },
                    { label: "Tags", desc: "Keywords for search & filtering" },
                    { label: "Priority", desc: "Urgency level (low/medium/high)" },
                  ].map(({ label, desc }) => (
                    <div key={label} className={`rounded-lg border p-3 text-xs transition-opacity ${classificationEnabled ? "" : "opacity-40"}`}>
                      <p className="font-semibold">{label}</p>
                      <p className="text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                  ))}
                </div>
                {!classificationEnabled && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Rules will still execute, but without AI-suggested categories or tags as conditions.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Module Settings Section ─────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Module Settings</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Control which modules use AI analysis in your organization.
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving || isLoading} className="gap-2">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </Button>
      </div>

      <Alert className="bg-primary/5 border-primary/20">
        <Sparkles className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm">
          AI analysis is cached for 1 hour to minimize API usage.
          {" "}<span className="font-semibold">{enabledCount} of {AI_MODULES.length}</span> modules currently enabled.
        </AlertDescription>
      </Alert>

      {!user?.organizationId && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            AI settings are organization-specific. Your account is not linked to an organization — settings will apply globally.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-3">
          {AI_MODULES.map((mod) => {
            const Icon = mod.icon;
            const enabled = settings[mod.key] ?? true;
            return (
              <div
                key={mod.key}
                className={`rounded-xl border p-4 transition-all ${enabled ? "border-border bg-card" : "border-border/40 bg-muted/20 opacity-60"}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm">{mod.label}</h3>
                      <Switch checked={enabled} onCheckedChange={(v) => handleToggle(mod.key, v)} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{mod.description}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {mod.features.map((f) => (
                        <span key={f} className="text-xs text-muted-foreground flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${enabled ? "bg-primary" : "bg-muted-foreground"}`} />
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

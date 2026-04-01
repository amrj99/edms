import { useState, useEffect } from "react";
import {
  Brain, FileText, Mail, CheckSquare, Search, Bell, Users, Clipboard,
  Loader2, Save, Sparkles, Info, Check, AlertTriangle, Server, Zap,
  ChevronDown, ChevronUp, Settings2,
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

type AIProvider = "openai_replit" | "groq" | "ollama";

interface ProviderInfo {
  configured: boolean;
  label: string;
  description: string;
  envVarsRequired: string[];
}

interface ProviderData {
  provider: AIProvider;
  fastModel: string;
  smartModel: string;
  providerStatus: Record<AIProvider, ProviderInfo>;
}

const PROVIDER_ICONS: Record<AIProvider, React.ComponentType<{ className?: string }>> = {
  openai_replit: Sparkles,
  groq: Zap,
  ollama: Server,
};

const PROVIDER_COLORS: Record<AIProvider, string> = {
  openai_replit: "text-violet-600",
  groq: "text-orange-500",
  ollama: "text-green-600",
};

export default function AISettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [providerData, setProviderData] = useState<ProviderData | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerSaving, setProviderSaving] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("openai_replit");
  const [fastModel, setFastModel] = useState("");
  const [smartModel, setSmartModel] = useState("");
  const [showModels, setShowModels] = useState(false);

  const isSysAdmin = (user as any)?.isSysAdmin === true || (user as any)?.role === "sysadmin";

  useEffect(() => {
    fetch("/api/ai/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { setSettings(data); setIsLoading(false); })
      .catch(() => setIsLoading(false));

    fetch("/api/ai/provider", { credentials: "include" })
      .then((r) => r.json())
      .then((data: ProviderData) => {
        setProviderData(data);
        setSelectedProvider(data.provider);
        setFastModel(data.fastModel);
        setSmartModel(data.smartModel);
        setProviderLoading(false);
      })
      .catch(() => setProviderLoading(false));
  }, []);

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
    if (providerData) {
      const status = providerData.providerStatus[p];
      const defaults: Record<AIProvider, { fast: string; smart: string }> = {
        openai_replit: { fast: "gpt-4o-mini", smart: "gpt-4o" },
        groq:          { fast: "llama-3.1-8b-instant", smart: "llama-3.3-70b-versatile" },
        ollama:        { fast: "llama3.2", smart: "llama3.1" },
      };
      if (p !== providerData.provider) {
        setFastModel(defaults[p].fast);
        setSmartModel(defaults[p].smart);
      } else {
        setFastModel(providerData.fastModel);
        setSmartModel(providerData.smartModel);
      }
    }
  };

  const enabledCount = Object.values(settings).filter(Boolean).length;
  const currentProviderInfo = providerData?.providerStatus[selectedProvider];
  const activeProviderInfo = providerData?.providerStatus[providerData.provider];

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
                {(() => { const I = PROVIDER_ICONS[providerData.provider]; return <I className="h-3 w-3" />; })()}
                {activeProviderInfo?.label ?? providerData.provider}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Choose between a paid cloud provider or a free/open-source alternative. All use the same OpenAI-compatible API.
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
          <div className="p-5 space-y-4">
            {/* Provider cards */}
            <div className="grid gap-3">
              {(Object.entries(providerData.providerStatus) as [AIProvider, ProviderInfo][]).map(([key, info]) => {
                const Icon = PROVIDER_ICONS[key];
                const colorCls = PROVIDER_COLORS[key];
                const isSelected = selectedProvider === key;
                const isActive = providerData.provider === key;
                return (
                  <button
                    key={key}
                    onClick={() => !isSysAdmin ? undefined : handleSelectProvider(key)}
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
                            <Badge className="text-[10px] py-0 px-1.5 h-4 bg-primary/10 text-primary border-0">
                              Active
                            </Badge>
                          )}
                          <span className={`ml-auto flex items-center gap-1 text-xs ${
                            info.configured ? "text-green-600" : "text-amber-500"
                          }`}>
                            {info.configured
                              ? <><Check className="h-3 w-3" /> Configured</>
                              : <><AlertTriangle className="h-3 w-3" /> Not configured</>
                            }
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
                        {!info.configured && info.envVarsRequired.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {info.envVarsRequired.map((v) => (
                              <code key={v} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">
                                {v}
                              </code>
                            ))}
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
              })}
            </div>

            {/* Advanced model settings */}
            {isSysAdmin && (
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
                        placeholder="e.g. gpt-4o-mini"
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Smart Model <span className="text-muted-foreground">(complex reasoning)</span></Label>
                      <Input
                        value={smartModel}
                        onChange={(e) => setSmartModel(e.target.value)}
                        placeholder="e.g. gpt-4o"
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
                <Button
                  size="sm"
                  onClick={handleSaveProvider}
                  disabled={providerSaving}
                  className="gap-1.5"
                >
                  {providerSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save Provider
                </Button>
              </div>
            )}
          </div>
        )}
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
                className={`rounded-xl border p-4 transition-all ${
                  enabled ? "border-border bg-card" : "border-border/40 bg-muted/20 opacity-60"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 ${
                    enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm">{mod.label}</h3>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(v) => handleToggle(mod.key, v)}
                      />
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

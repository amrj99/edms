import { useState, useEffect } from "react";
import {
  Brain, FileText, Mail, CheckSquare, Search, Bell, Users, Clipboard,
  Loader2, Save, Sparkles, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

export default function AISettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/ai/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
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
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast({ title: "AI settings saved", description: "Module settings updated successfully." });
    } catch {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: "Could not save AI settings. Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const enabledCount = Object.values(settings).filter(Boolean).length;

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
            Configure AI features for each module. Changes apply to your organization.
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving || isLoading} className="gap-2">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </Button>
      </div>

      {/* Info banner */}
      <Alert className="bg-primary/5 border-primary/20">
        <Sparkles className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm">
          AI features use Replit AI Integrations (OpenAI GPT-5). Analysis is cached for 1 hour to minimize API usage.
          {" "}<span className="font-semibold">{enabledCount} of {AI_MODULES.length}</span> modules currently enabled.
        </AlertDescription>
      </Alert>

      {/* No org warning */}
      {!user?.organizationId && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            AI settings are organization-specific. Your account is not linked to an organization — settings will apply globally.
          </AlertDescription>
        </Alert>
      )}

      {/* Module cards */}
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
                  enabled
                    ? "border-border bg-card"
                    : "border-border/40 bg-muted/20 opacity-60"
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

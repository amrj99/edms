/**
 * AI Insights Dashboard
 * Organisation-wide AI analysis overview.
 * All data is loaded lazily — nothing triggers an AI call.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  Brain, Loader2, RefreshCw, AlertTriangle, CheckCircle2,
  FileText, BarChart3, Eye, TrendingUp, Layers, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InsightsData {
  totalDocs:           number;
  analyzedCount:       number;
  coveragePct:         number;
  urgencyDistribution: Record<string, number>;
  needsAttention:      AttentionDoc[];
  duplicateSignals:    DuplicateSignal[];
  generatedAt:         string;
}

interface AttentionDoc {
  id:             number;
  title:          string;
  documentNumber: string;
  documentType:   string;
  discipline?:    string;
  status:         string;
  projectId?:     number;
  urgencyLevel:   string;
  urgencyReason?: string;
  analyzedAt?:    string;
}

interface DuplicateSignal {
  projectId:    number | null;
  documentType: string;
  discipline:   string;
  cnt:          number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const URGENCY_CONFIG: Record<string, { label: string; color: string; barColor: string; icon: React.ElementType }> = {
  low:      { label: "Low",      color: "text-green-700 dark:text-green-400",  barColor: "bg-green-500",  icon: CheckCircle2 },
  medium:   { label: "Medium",   color: "text-yellow-700 dark:text-yellow-400", barColor: "bg-yellow-400", icon: AlertTriangle },
  high:     { label: "High",     color: "text-orange-700 dark:text-orange-400", barColor: "bg-orange-500", icon: AlertTriangle },
  critical: { label: "Critical", color: "text-red-700 dark:text-red-400",      barColor: "bg-red-500",    icon: AlertTriangle },
};

const STATUS_COLORS: Record<string, string> = {
  draft:        "bg-gray-100 text-gray-700",
  under_review: "bg-yellow-100 text-yellow-800",
  approved:     "bg-green-100 text-green-700",
  issued:       "bg-blue-100 text-blue-700",
  superseded:   "bg-purple-100 text-purple-700",
  void:         "bg-red-100 text-red-700",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIInsightsPage() {
  const [enabled, setEnabled] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<InsightsData>({
    queryKey: ["ai-insights"],
    queryFn: async () => {
      const r = await fetch("/api/ai/insights", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load insights");
      return r.json();
    },
    enabled,
    staleTime: 2 * 60_000,
  });

  // ── Not yet loaded ──
  if (!enabled) {
    return (
      <div className="max-w-4xl space-y-6 animate-in fade-in">
        <PageHeader />
        <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 py-16 text-center space-y-4">
          <Brain className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <div>
            <p className="text-base font-medium text-muted-foreground">AI Insights not loaded yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm mx-auto">
              Click below to aggregate AI analysis data across your organisation's documents.
              No new AI calls will be made.
            </p>
          </div>
          <Button onClick={() => setEnabled(true)} className="gap-2 mt-2">
            <Brain className="h-4 w-4" />
            Load Insights
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || isFetching) {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader />
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Aggregating insights…</span>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader />
        <div className="rounded-xl border py-12 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 mx-auto text-destructive/60" />
          <p className="text-sm text-muted-foreground">Failed to load insights. Check your connection.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const totalUrgency = Object.values(data.urgencyDistribution).reduce((s, c) => s + c, 0);

  return (
    <div className="max-w-4xl space-y-6 animate-in fade-in">
      <div className="flex items-center justify-between gap-3">
        <PageHeader />
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5 shrink-0"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground -mt-4">
        Generated {format(new Date(data.generatedAt), "dd MMM yyyy, HH:mm")} · No AI calls were made
      </p>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={FileText}
          label="Total Documents"
          value={data.totalDocs.toLocaleString()}
          iconColor="text-blue-500"
        />
        <StatCard
          icon={Brain}
          label="Analysed"
          value={data.analyzedCount.toLocaleString()}
          iconColor="text-primary"
        />
        <StatCard
          icon={TrendingUp}
          label="Coverage"
          value={`${data.coveragePct}%`}
          iconColor="text-green-500"
          subtext={`${data.totalDocs - data.analyzedCount} unanalysed`}
        />
        <StatCard
          icon={AlertTriangle}
          label="Need Attention"
          value={(data.needsAttention?.length ?? 0).toLocaleString()}
          iconColor="text-orange-500"
          subtext="high / critical"
        />
      </div>

      {/* ── Urgency distribution ── */}
      {totalUrgency > 0 && (
        <Section icon={BarChart3} title="Risk Distribution" subtitle="Urgency levels from latest AI analyses">
          <div className="space-y-3">
            {(["critical", "high", "medium", "low"] as const).map(lvl => {
              const cfg = URGENCY_CONFIG[lvl];
              const cnt = data.urgencyDistribution[lvl] ?? 0;
              const pct = totalUrgency > 0 ? (cnt / totalUrgency) * 100 : 0;
              if (cnt === 0) return null;
              return (
                <div key={lvl} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className={cn("font-medium", cfg.color)}>{cfg.label}</span>
                    <span className="text-muted-foreground tabular-nums">{cnt} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-700", cfg.barColor)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {totalUrgency < data.analyzedCount && (
            <p className="text-xs text-muted-foreground mt-2">
              {data.analyzedCount - totalUrgency} analyses had no urgency level recorded.
            </p>
          )}
        </Section>
      )}

      {totalUrgency === 0 && data.analyzedCount > 0 && (
        <Section icon={BarChart3} title="Risk Distribution" subtitle="Urgency levels from latest AI analyses">
          <p className="text-sm text-muted-foreground py-4 text-center">No urgency data in stored analyses yet.</p>
        </Section>
      )}

      {/* ── Needs attention ── */}
      {data.needsAttention.length > 0 && (
        <Section icon={AlertTriangle} title="Documents Needing Attention" subtitle="High or critical urgency from latest analysis">
          <div className="divide-y">
            {data.needsAttention.map(doc => {
              const urgencyCfg = URGENCY_CONFIG[doc.urgencyLevel] ?? URGENCY_CONFIG.medium;
              return (
                <div key={doc.id} className="py-3 flex items-start gap-3">
                  <urgencyCfg.icon className={cn("h-4 w-4 mt-0.5 shrink-0", urgencyCfg.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="text-sm font-medium hover:text-primary hover:underline truncate"
                      >
                        {doc.title}
                      </Link>
                      <span className="font-mono text-xs text-muted-foreground">{doc.documentNumber}</span>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", STATUS_COLORS[doc.status] ?? "bg-muted text-muted-foreground")}>
                        {doc.status?.replace(/_/g, " ")}
                      </span>
                    </div>
                    {doc.urgencyReason && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{doc.urgencyReason}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {doc.discipline && <span className="text-[11px] text-muted-foreground">{doc.discipline}</span>}
                      {doc.documentType && <span className="text-[11px] text-muted-foreground">{doc.documentType}</span>}
                      {doc.analyzedAt && (
                        <span className="text-[11px] text-muted-foreground">
                          Analysed {format(new Date(doc.analyzedAt), "dd MMM yyyy")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 shrink-0">
                    <Link href={`/documents/${doc.id}`}>
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Duplicate signals ── */}
      {data.duplicateSignals.length > 0 && (
        <Section
          icon={Layers}
          title="Duplicate Detection Signals"
          subtitle="Discipline + document type combinations with more than 5 documents in the same project"
        >
          <div className="divide-y">
            {data.duplicateSignals.map((sig, i) => (
              <div key={i} className="py-3 flex items-center gap-3">
                <Layers className="h-4 w-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{sig.discipline}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-sm text-muted-foreground">{sig.documentType}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sig.cnt} documents share this discipline + type in the same project
                    {sig.projectId ? ` (Project #${sig.projectId})` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {sig.cnt}
                </Badge>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Workflow bottleneck (future) ── */}
      <Section icon={Zap} title="Workflow Bottlenecks" subtitle="Coming soon — approval cycle time analysis">
        <div className="py-6 text-center text-muted-foreground/60 space-y-1">
          <Zap className="h-8 w-8 mx-auto" />
          <p className="text-sm">Workflow bottleneck insights are planned for a future release.</p>
        </div>
      </Section>

      {data.analyzedCount === 0 && (
        <div className="rounded-xl border bg-muted/20 px-6 py-8 text-center space-y-2">
          <Brain className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No documents have been analysed yet</p>
          <p className="text-xs text-muted-foreground/70">
            Open any document and click <strong>AI Analysis</strong> to run the first analysis.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">AI Insights</h1>
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        Organisation-wide AI analysis overview — risk distribution, documents needing attention, and duplicate signals.
      </p>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, iconColor, subtext,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  iconColor?: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-1">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", iconColor ?? "text-muted-foreground")} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {subtext && <p className="text-[11px] text-muted-foreground">{subtext}</p>}
    </div>
  );
}

function Section({
  icon: Icon, title, subtitle, children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-5 py-4 border-b bg-muted/20">
        <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

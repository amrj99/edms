/**
 * DocumentAiTab
 * Loads and displays AI analysis for a document on demand.
 * Never fetches or triggers AI automatically on mount — user must click "Run Analysis".
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Brain, RefreshCw, Loader2, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Tag, Lightbulb, Clock, Cpu, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const URGENCY_CONFIG = {
  low:      { label: "Low",      className: "bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300" },
  medium:   { label: "Medium",   className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  high:     { label: "High",     className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  critical: { label: "Critical", className: "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-300" },
};

interface AnalysisResult {
  summary:             string;
  classification:      string;
  suggestedTags:       string[];
  suggestedDiscipline?: string;
  urgencyLevel:        "low" | "medium" | "high" | "critical";
  urgencyReason:       string;
  recommendations:     string[];
  confidence:          number;
}

interface AnalysisRecord {
  id:             number;
  result:         AnalysisResult;
  model?:         string;
  provider?:      string;
  latencyMs?:     number;
  entityRevision?: string;
  isLatest:       boolean;
  createdAt:      string;
}

interface DocumentAiTabProps {
  documentId: number;
  documentTitle: string;
}

export function DocumentAiTab({ documentId, documentTitle }: DocumentAiTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);

  // Load history — only when the tab is mounted (lazy by design)
  const { data, isLoading, isError } = useQuery<{ analyses: AnalysisRecord[]; total: number }>({
    queryKey: ["ai-analysis-history", documentId],
    queryFn: async () => {
      const r = await fetch(
        `/api/ai/analysis/document/${documentId}?analysisType=analyze`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load analysis history");
      return r.json();
    },
    staleTime: 60_000,
  });

  const latest = data?.analyses?.find(a => a.isLatest) ?? data?.analyses?.[0];
  const history = data?.analyses?.filter(a => a.id !== latest?.id) ?? [];

  // Trigger analysis (force=false means use cache/store if available; force=true re-runs)
  const runMutation = useMutation({
    mutationFn: async (force: boolean) => {
      const r = await fetch(
        `/api/ai/documents/${documentId}/analyze${force ? "?force=true" : ""}`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Analysis failed");
      }
      return r.json() as Promise<AnalysisResult>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-analysis-history", documentId] });
      toast({ title: "Analysis complete", description: `AI has analysed "${documentTitle}".` });
    },
    onError: (err: Error) => {
      toast({
        title:       "Analysis failed",
        description: err.message,
        variant:     "destructive",
      });
    },
  });

  const isRunning = runMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading analysis history…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 text-center text-muted-foreground space-y-2">
        <AlertTriangle className="h-8 w-8 mx-auto text-destructive/60" />
        <p className="text-sm">Could not load analysis history. Check your connection.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary shrink-0" />
          <h3 className="font-semibold text-sm">AI Document Analysis</h3>
          {latest && (
            <Badge variant="secondary" className="text-[11px]">
              Last run {format(new Date(latest.createdAt), "dd MMM yyyy")}
            </Badge>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {latest ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => runMutation.mutate(true)}
              disabled={isRunning}
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-analyse
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => runMutation.mutate(false)}
              disabled={isRunning}
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
              Run Analysis
            </Button>
          )}
        </div>
      </div>

      {/* No analysis yet */}
      {!latest && !isRunning && (
        <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 py-12 text-center space-y-3">
          <Brain className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No analysis yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">
              Click <strong>Run Analysis</strong> to have the AI summarise, classify, and assess the urgency of this document.
            </p>
          </div>
        </div>
      )}

      {/* Running state */}
      {isRunning && (
        <div className="rounded-xl border bg-primary/5 py-10 text-center space-y-2">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Analysing document…</p>
        </div>
      )}

      {/* Latest analysis card */}
      {latest && !isRunning && (
        <AnalysisCard analysis={latest} isLatest />
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(s => !s)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <History className="h-3.5 w-3.5" />
            {showHistory ? "Hide" : "Show"} {history.length} previous {history.length === 1 ? "analysis" : "analyses"}
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showHistory && (
            <div className="mt-3 space-y-3">
              {history.map(a => (
                <AnalysisCard key={a.id} analysis={a} isLatest={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisCard({ analysis, isLatest }: { analysis: AnalysisRecord; isLatest: boolean }) {
  const r = analysis.result;
  const urgency = URGENCY_CONFIG[r.urgencyLevel] ?? URGENCY_CONFIG.low;
  const confidencePct = Math.round((r.confidence ?? 0) * 100);
  const [showRecs, setShowRecs] = useState(true);

  return (
    <div className={cn("rounded-xl border p-4 space-y-4", !isLatest && "opacity-75 bg-muted/20")}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold gap-1", urgency.className)}>
            <AlertTriangle className="h-3 w-3" />
            {urgency.label} Urgency
          </span>
          {r.classification && (
            <Badge variant="outline" className="text-xs capitalize">{r.classification}</Badge>
          )}
          {r.suggestedDiscipline && (
            <Badge variant="outline" className="text-xs">{r.suggestedDiscipline}</Badge>
          )}
          {!isLatest && (
            <span className="text-[11px] text-muted-foreground italic">superseded</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
          {analysis.model && (
            <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{analysis.model}</span>
          )}
          {analysis.latencyMs && (
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{(analysis.latencyMs / 1000).toFixed(1)}s</span>
          )}
          <span>Confidence: {confidencePct}%</span>
          <span>{format(new Date(analysis.createdAt), "dd MMM yyyy, HH:mm")}</span>
        </div>
      </div>

      {/* Summary */}
      {r.summary && (
        <p className="text-sm text-foreground/90 leading-relaxed">{r.summary}</p>
      )}

      {/* Urgency reason */}
      {r.urgencyReason && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/20 pl-3">{r.urgencyReason}</p>
      )}

      {/* Suggested tags */}
      {r.suggestedTags?.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
          {r.suggestedTags.map(tag => (
            <Badge key={tag} variant="secondary" className="text-[11px] px-1.5 py-0">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {r.recommendations?.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
            onClick={() => setShowRecs(s => !s)}
          >
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            {r.recommendations.length} Recommendation{r.recommendations.length !== 1 ? "s" : ""}
            {showRecs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showRecs && (
            <ul className="space-y-1.5">
              {r.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary/60 shrink-0 mt-0.5" />
                  {rec}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {analysis.entityRevision && (
        <>
          <Separator />
          <p className="text-[11px] text-muted-foreground">
            Analysis performed on revision <strong>{analysis.entityRevision}</strong>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * DocumentRevisionsTab
 * Shows revision history for a document.
 * Metadata diff is always available; AI narrative is optional and only triggered on demand.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  History, Loader2, Brain, ArrowRight, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, GitCompare, FileX2, Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  draft:        "bg-gray-100 text-gray-700",
  under_review: "bg-yellow-100 text-yellow-800",
  approved:     "bg-green-100 text-green-700",
  issued:       "bg-blue-100 text-blue-700",
  superseded:   "bg-purple-100 text-purple-700",
  void:         "bg-red-100 text-red-700",
};

interface Revision {
  id:                  number;
  documentId:          number;
  revision:            string;
  status:              string;
  fileName?:           string;
  fileSize?:           number;
  comment?:            string;
  createdAt:           string;
  createdByName?:      string;
  fileCarriedForward?: boolean;
}

interface DiffField {
  field: string;
  label: string;
  from:  string;
  to:    string;
}

interface CompareResult {
  diff:       DiffField[];
  summary:    string;
  aiSummary?: string | null;
  aiError?:   string;
}

interface DocumentRevisionsTabProps {
  documentId:    number;
  documentTitle: string;
}

export function DocumentRevisionsTab({ documentId, documentTitle }: DocumentRevisionsTabProps) {
  const { toast } = useToast();
  const [selectedA, setSelectedA] = useState<Revision | null>(null);
  const [selectedB, setSelectedB] = useState<Revision | null>(null);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);

  const { data, isLoading, isError } = useQuery<{ revisions: Revision[]; total: number }>({
    queryKey: ["doc-revisions", documentId],
    queryFn: async () => {
      const r = await fetch(`/api/documents/${documentId}/revisions`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load revisions");
      return r.json();
    },
    staleTime: 60_000,
  });

  const revisions = data?.revisions ?? [];

  // Metadata-only diff (no AI)
  const diffMutation = useMutation({
    mutationFn: async ({ a, b, withAI }: { a: Revision; b: Revision; withAI: boolean }) => {
      const r = await fetch("/api/ai/compare-revisions", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: documentTitle,
          revisionA: a,
          revisionB: b,
          withAI,
        }),
      });
      if (!r.ok) throw new Error("Comparison failed");
      return r.json() as Promise<CompareResult>;
    },
    onSuccess: result => setCompareResult(result),
    onError: (err: Error) => {
      toast({ title: "Comparison failed", description: err.message, variant: "destructive" });
    },
  });

  const handleCompare = (withAI = false) => {
    if (!selectedA || !selectedB) return;
    setCompareResult(null);
    diffMutation.mutate({ a: selectedA, b: selectedB, withAI });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading revision history…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-10 text-center text-muted-foreground space-y-2">
        <AlertCircle className="h-8 w-8 mx-auto text-destructive/60" />
        <p className="text-sm">Could not load revision history.</p>
      </div>
    );
  }

  if (revisions.length === 0) {
    return (
      <div className="py-12 text-center space-y-2">
        <History className="h-9 w-9 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No revision history yet</p>
        <p className="text-xs text-muted-foreground/70">Revisions are recorded when the document status or file is updated.</p>
      </div>
    );
  }

  const canCompare = selectedA && selectedB && selectedA.id !== selectedB.id;

  return (
    <div className="space-y-5">
      {/* Revision list */}
      <div className="space-y-2">
        {revisions.map((rev, i) => {
          const isA = selectedA?.id === rev.id;
          const isB = selectedB?.id === rev.id;
          return (
            <div
              key={rev.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
                isA && "border-primary/60 bg-primary/5 ring-1 ring-primary/20",
                isB && "border-blue-400/60 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-400/20",
                !isA && !isB && "hover:bg-muted/30 cursor-pointer",
              )}
            >
              {/* Timeline dot */}
              <div className="flex flex-col items-center gap-1 mt-0.5 shrink-0">
                <div className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  i === 0 ? "bg-primary" : "bg-muted-foreground/30",
                )} />
                {i < revisions.length - 1 && <div className="w-px h-6 bg-muted-foreground/20" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">Rev {rev.revision}</span>
                  {rev.status && (
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", STATUS_COLORS[rev.status] ?? "bg-muted text-muted-foreground")}>
                      {rev.status.replace(/_/g, " ")}
                    </span>
                  )}
                  {/* File indicator — visually distinct for carried-forward vs. newly uploaded */}
                  {rev.fileCarriedForward ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 italic"
                      title="No new file uploaded — previous file carried forward"
                    >
                      <FileX2 className="h-3.5 w-3.5 text-amber-400/70 shrink-0" />
                      <span className="line-through decoration-amber-400/50">{rev.fileName}</span>
                      <span className="not-italic no-underline text-amber-600/80 dark:text-amber-400/70">(no new file)</span>
                    </span>
                  ) : rev.fileName ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[220px]" title={rev.fileName}>
                      <Paperclip className="h-3 w-3 shrink-0" />
                      {rev.fileName}
                    </span>
                  ) : null}
                </div>
                {rev.comment && <p className="text-xs text-muted-foreground mt-1">{rev.comment}</p>}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {rev.createdByName && <>{rev.createdByName} · </>}
                  {format(new Date(rev.createdAt), "dd MMM yyyy, HH:mm")}
                </p>
              </div>

              {/* Selection buttons */}
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => setSelectedA(isA ? null : rev)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded font-medium border transition-colors",
                    isA
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-primary/30 text-primary hover:bg-primary/10",
                  )}
                >
                  A
                </button>
                <button
                  onClick={() => setSelectedB(isB ? null : rev)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded font-medium border transition-colors",
                    isB
                      ? "bg-blue-500 text-white border-blue-500"
                      : "border-blue-400/40 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20",
                  )}
                >
                  B
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Compare bar */}
      {canCompare && (
        <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono font-semibold text-primary">Rev {selectedA!.revision}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-mono font-semibold text-blue-600">Rev {selectedB!.revision}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => handleCompare(false)}
                disabled={diffMutation.isPending}
              >
                {diffMutation.isPending && !compareResult?.aiSummary
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <GitCompare className="h-3.5 w-3.5" />
                }
                Compare
              </Button>
              {compareResult && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
                  onClick={() => handleCompare(true)}
                  disabled={diffMutation.isPending}
                >
                  {diffMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Brain className="h-3.5 w-3.5" />
                  }
                  Summarise with AI
                </Button>
              )}
            </div>
          </div>

          {/* Diff result */}
          {compareResult && (
            <CompareResultPanel result={compareResult} />
          )}
        </div>
      )}

      {!canCompare && revisions.length >= 2 && (
        <p className="text-xs text-muted-foreground text-center">
          Select two revisions using the <strong>A</strong> and <strong>B</strong> buttons to compare them.
        </p>
      )}
    </div>
  );
}

function CompareResultPanel({ result }: { result: CompareResult }) {
  const [showAiDetail, setShowAiDetail] = useState(true);

  return (
    <div className="space-y-3">
      <Separator />

      {/* Diff table */}
      {result.diff.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          No tracked metadata differences between these two revisions.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Field</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">From (A)</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">To (B)</th>
              </tr>
            </thead>
            <tbody>
              {result.diff.map((d, i) => (
                <tr key={d.field} className={cn("border-b last:border-0", i % 2 === 0 && "bg-background")}>
                  <td className="px-3 py-2 font-medium text-muted-foreground">{d.label}</td>
                  <td className="px-3 py-2 font-mono text-red-600 dark:text-red-400 line-through">{d.from}</td>
                  <td className="px-3 py-2 font-mono text-green-700 dark:text-green-400">{d.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI narrative */}
      {result.aiSummary && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 space-y-1.5">
          <button
            className="flex items-center gap-1.5 text-xs font-medium text-primary"
            onClick={() => setShowAiDetail(s => !s)}
          >
            <Brain className="h-3.5 w-3.5" />
            AI Summary
            {showAiDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showAiDetail && (
            <p className="text-xs text-foreground/80 leading-relaxed">{result.aiSummary}</p>
          )}
        </div>
      )}

      {result.aiError && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          AI summary unavailable: {result.aiError}
        </p>
      )}
    </div>
  );
}

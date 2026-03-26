import { useState } from "react";
import {
  Brain, Sparkles, AlertTriangle, CheckCircle2, Tag, Lightbulb, Loader2,
  ChevronDown, ChevronUp, RefreshCw, MessageSquare, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type AIEntityType = "document" | "correspondence";

interface DocumentAnalysis {
  summary: string;
  classification: string;
  suggestedTags: string[];
  suggestedDiscipline?: string;
  urgencyLevel: "low" | "medium" | "high" | "critical";
  urgencyReason: string;
  recommendations: string[];
  confidence: number;
}

interface CorrespondenceAnalysis {
  category: string;
  urgencyLevel: "low" | "medium" | "high" | "critical";
  urgencyReason: string;
  keyPoints: string[];
  suggestedReply: string;
  actionRequired: boolean;
  actionDescription?: string;
  estimatedResponseDays: number;
  sentiment: "positive" | "neutral" | "negative" | "urgent";
  relatedTopics: string[];
}

type Analysis = DocumentAnalysis | CorrespondenceAnalysis;

const urgencyColors: Record<string, string> = {
  low: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800",
  medium: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-800",
  high: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800",
  critical: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800",
};

const urgencyBadge: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const sentimentColors: Record<string, string> = {
  positive: "text-green-600",
  neutral: "text-slate-500",
  negative: "text-red-600",
  urgent: "text-orange-600",
};

interface AIInsightsPanelProps {
  entityId: number;
  entityType: AIEntityType;
  entityTitle?: string;
  className?: string;
  compact?: boolean;
}

export function AIInsightsPanel({
  entityId,
  entityType,
  entityTitle,
  className,
  compact = false,
}: AIInsightsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [showReply, setShowReply] = useState(false);
  const { toast } = useToast();

  const runAnalysis = async (force = false) => {
    setIsLoading(true);
    setIsOpen(true);
    try {
      const url = `/api/ai/${entityType === "document" ? "documents" : "correspondence"}/${entityId}/analyze${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "AI analysis failed");
      }
      const data = await res.json();
      setAnalysis(data);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "AI Analysis Failed",
        description: err.message || "Unable to analyze this item",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (compact && !analysis && !isLoading) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => runAnalysis()}
        className="gap-1.5 text-xs border-dashed border-primary/40 hover:border-primary text-primary hover:bg-primary/5"
      >
        <Sparkles className="h-3 w-3" />
        AI Analyze
      </Button>
    );
  }

  return (
    <div className={cn("rounded-xl border border-border/60 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gradient-to-r from-primary/5 to-transparent border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-foreground">AI Insights</span>
            {entityTitle && (
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{entityTitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {analysis && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => runAnalysis(true)}
              title="Refresh analysis"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
          {!analysis && !isLoading ? (
            <Button
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => runAnalysis()}
            >
              <Sparkles className="h-3 w-3" />
              Analyze
            </Button>
          ) : null}
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm">Analyzing with AI...</p>
        </div>
      )}

      {analysis && !isLoading && (
        <div className="p-4 space-y-4">
          {/* Urgency banner */}
          {("urgencyLevel" in analysis) && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-sm",
              urgencyColors[analysis.urgencyLevel]
            )}>
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-semibold capitalize">{analysis.urgencyLevel} urgency</span>
                {" — "}{analysis.urgencyReason}
              </div>
            </div>
          )}

          {/* Document-specific */}
          {"summary" in analysis && (
            <>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Summary</h4>
                <p className="text-sm text-foreground leading-relaxed">{analysis.summary}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Classification:</span>
                  <Badge variant="secondary" className="text-xs capitalize">{analysis.classification}</Badge>
                </div>
                {analysis.suggestedDiscipline && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Discipline:</span>
                    <Badge variant="outline" className="text-xs">{analysis.suggestedDiscipline}</Badge>
                  </div>
                )}
              </div>

              {analysis.suggestedTags?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Suggested Tags</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.suggestedTags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs cursor-pointer hover:bg-primary/10">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {analysis.recommendations?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Recommendations</h4>
                  <ul className="space-y-1">
                    {analysis.recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.confidence !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">AI Confidence:</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-24">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.round(analysis.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-foreground">
                    {Math.round(analysis.confidence * 100)}%
                  </span>
                </div>
              )}
            </>
          )}

          {/* Correspondence-specific */}
          {"category" in analysis && (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="secondary" className="text-xs capitalize">{analysis.category}</Badge>
                <Badge className={cn("text-xs capitalize", urgencyBadge[analysis.urgencyLevel] ?? "")}>
                  {analysis.urgencyLevel} urgency
                </Badge>
                {"sentiment" in analysis && analysis.sentiment && (
                  <span className={cn("text-xs font-medium capitalize", sentimentColors[analysis.sentiment])}>
                    {analysis.sentiment} sentiment
                  </span>
                )}
              </div>

              {analysis.actionRequired && (
                <div className="flex items-start gap-2 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-semibold text-orange-700 dark:text-orange-300">Action Required</span>
                    {analysis.actionDescription && (
                      <p className="text-orange-600 dark:text-orange-400 mt-0.5">{analysis.actionDescription}</p>
                    )}
                    <p className="text-xs text-orange-500 dark:text-orange-500 mt-1">
                      Suggested response: {analysis.estimatedResponseDays} day{analysis.estimatedResponseDays !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              )}

              {analysis.keyPoints?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Key Points</h4>
                  <ul className="space-y-1">
                    {analysis.keyPoints.map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reply suggestion */}
              {analysis.suggestedReply && (
                <div>
                  <button
                    onClick={() => setShowReply(!showReply)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {showReply ? "Hide" : "Show"} AI Reply Draft
                    {showReply ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {showReply && (
                    <div className="mt-2 rounded-lg bg-muted/50 border border-border p-3 text-sm italic text-muted-foreground">
                      "{analysis.suggestedReply}"
                    </div>
                  )}
                </div>
              )}

              {analysis.relatedTopics?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Related Topics</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.relatedTopics.map((topic) => (
                      <Badge key={topic} variant="outline" className="text-xs">{topic}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { Brain, Sparkles, Loader2, TrendingUp, AlertTriangle, Lightbulb, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface TaskPriorityInsight {
  taskId: number;
  aiPriority: "low" | "medium" | "high" | "urgent";
  aiScore: number;
  reasoning: string;
  isBottleneck: boolean;
}

interface TaskListInsights {
  tasks: TaskPriorityInsight[];
  overallRisk: "low" | "medium" | "high" | "critical";
  bottlenecks: string[];
  topRecommendations: string[];
}

const priorityColors: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const riskColors: Record<string, string> = {
  low: "text-green-600",
  medium: "text-yellow-600",
  high: "text-orange-600",
  critical: "text-red-600",
};

interface AITaskInsightsProps {
  projectId?: number;
  taskIds?: number[];
  onPriorityChange?: (taskId: number, insight: TaskPriorityInsight) => void;
  className?: string;
}

export function AITaskInsights({ projectId, taskIds, onPriorityChange, className }: AITaskInsightsProps) {
  const [insights, setInsights] = useState<TaskListInsights | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const runPrioritization = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/ai/tasks/prioritize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, taskIds }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "AI prioritization failed");
      }

      const data: TaskListInsights = await res.json();
      setInsights(data);

      if (onPriorityChange) {
        data.tasks.forEach((t) => onPriorityChange(t.taskId, t));
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "AI Analysis Failed",
        description: err.message || "Unable to prioritize tasks",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("rounded-xl border border-border/60 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gradient-to-r from-primary/5 to-transparent border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <span className="text-sm font-semibold">AI Task Insights</span>
            <p className="text-xs text-muted-foreground">AI-powered priority analysis</p>
          </div>
        </div>
        <Button
          size="sm"
          variant={insights ? "outline" : "default"}
          className="gap-1.5 h-7 text-xs"
          onClick={runPrioritization}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : insights ? (
            <RefreshCw className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {insights ? "Refresh" : "Analyze"}
        </Button>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-sm">AI is analyzing task priorities...</p>
        </div>
      )}

      {insights && !isLoading && (
        <div className="p-4 space-y-4">
          {/* Overall risk */}
          <div className="flex items-center gap-3 pb-3 border-b border-border/50">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Overall project risk:</span>
            <span className={cn("text-sm font-bold capitalize", riskColors[insights.overallRisk])}>
              {insights.overallRisk}
            </span>
          </div>

          {/* Bottlenecks */}
          {insights.bottlenecks?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                Bottlenecks Detected
              </h4>
              <ul className="space-y-1">
                {insights.bottlenecks.map((b, i) => (
                  <li key={i} className="text-sm text-orange-600 dark:text-orange-400 flex items-start gap-2">
                    <span className="text-orange-400 mt-0.5">•</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Task priority scores */}
          {insights.tasks?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Task Priority Scores
              </h4>
              <div className="space-y-2.5">
                {insights.tasks
                  .sort((a, b) => b.aiScore - a.aiScore)
                  .slice(0, 6)
                  .map((t) => (
                  <div key={t.taskId} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge className={cn("text-xs capitalize flex-shrink-0", priorityColors[t.aiPriority])}>
                          {t.aiPriority}
                        </Badge>
                        {t.isBottleneck && (
                          <AlertTriangle className="h-3 w-3 text-orange-500 flex-shrink-0" title="Bottleneck" />
                        )}
                        <span className="text-xs text-muted-foreground truncate">{t.reasoning}</span>
                      </div>
                      <span className="text-xs font-mono font-semibold text-foreground flex-shrink-0">{t.aiScore}</span>
                    </div>
                    <Progress value={t.aiScore} className="h-1" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {insights.topRecommendations?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-primary" />
                Recommendations
              </h4>
              <ul className="space-y-1.5">
                {insights.topRecommendations.map((rec, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-primary mt-0.5 flex-shrink-0">{i + 1}.</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!insights && !isLoading && (
        <div className="flex flex-col items-center gap-2 p-6 text-muted-foreground text-center">
          <Brain className="h-8 w-8 opacity-30" />
          <p className="text-sm">Click Analyze to get AI insights on task priorities, bottlenecks, and recommendations</p>
        </div>
      )}
    </div>
  );
}

import { useState, useMemo } from "react";
import { useListTasks } from "@workspace/api-client-react";
import { CheckSquare, Clock, AlertCircle, Loader2, Brain, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AITaskInsights } from "@/components/ai/AITaskInsights";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface AIPriorityInsight {
  taskId: number;
  aiPriority: "low" | "medium" | "high" | "urgent";
  aiScore: number;
  reasoning: string;
  isBottleneck: boolean;
}

type SortKey = "dueDate" | "priority" | "status" | "title" | "projectName";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 };

export default function Tasks() {
  const { data, isLoading } = useListTasks({ assignedToMe: true });
  const [showAI, setShowAI] = useState(false);
  const [aiInsights, setAiInsights] = useState<Record<number, AIPriorityInsight>>({});
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "text-red-500 bg-red-50 dark:bg-red-500/10";
      case "high": return "text-orange-500 bg-orange-50 dark:bg-orange-500/10";
      case "medium": return "text-blue-500 bg-blue-50 dark:bg-blue-500/10";
      default: return "text-slate-500 bg-slate-50 dark:bg-slate-500/10";
    }
  };

  const getAIPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
      case "high": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
      case "medium": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
      default: return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    }
  };

  const handlePriorityChange = (taskId: number, insight: AIPriorityInsight) => {
    setAiInsights((prev) => ({ ...prev, [taskId]: insight }));
  };

  const tasks = data?.tasks ?? [];
  const taskIds = tasks.map((t) => t.id);

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "dueDate": {
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          cmp = ad - bd;
          break;
        }
        case "priority":
          cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
          break;
        case "status":
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
          break;
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
          break;
        case "projectName":
          cmp = (a.projectName ?? "").localeCompare(b.projectName ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tasks, sortKey, sortDir]);

  const SORT_OPTS: { key: SortKey; label: string }[] = [
    { key: "dueDate", label: "Due Date" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "title", label: "Title" },
    { key: "projectName", label: "Project" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Tasks</h1>
          <p className="text-muted-foreground mt-1">Manage your assigned workflows, reviews, and actions.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
          onClick={() => setShowAI((v) => !v)}
        >
          <Brain className="h-4 w-4" />
          {showAI ? "Hide" : "AI"} Insights
        </Button>
      </div>

      {/* AI Task Insights Panel */}
      {showAI && (
        <AITaskInsights
          taskIds={taskIds}
          onPriorityChange={handlePriorityChange}
        />
      )}

      {/* Filter / Sort bar */}
      <div className="flex items-center gap-3 border-b pb-4">
        <Badge variant="secondary" className="px-4 py-1 text-sm bg-primary text-primary-foreground hover:bg-primary">All Active</Badge>
        <Badge variant="outline" className="px-4 py-1 text-sm">Pending Review</Badge>
        <Badge variant="outline" className="px-4 py-1 text-sm">Action Required</Badge>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort by</span>
          <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTS.map(o => (
                <SelectItem key={o.key} value={o.key} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !sorted.length ? (
        <div className="text-center py-24 bg-card border rounded-xl">
          <CheckSquare className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">You're all caught up!</h3>
          <p className="text-muted-foreground">No pending tasks assigned to you.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {sorted.map(task => {
            const aiInsight = aiInsights[task.id];
            return (
              <Card key={task.id} className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${getPriorityColor(task.priority)}`}>
                    {task.priority === "urgent" ? <AlertCircle className="h-5 w-5" /> : <CheckSquare className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{task.projectName}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground capitalize">{task.sourceType}</span>
                      {aiInsight?.isBottleneck && (
                        <Badge className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                          Bottleneck
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold text-foreground truncate">{task.title}</h3>
                    {task.description && <p className="text-sm text-muted-foreground truncate mt-1">{task.description}</p>}
                    {aiInsight?.reasoning && (
                      <p className="text-xs text-primary mt-1 flex items-center gap-1">
                        <Brain className="h-3 w-3" />
                        {aiInsight.reasoning}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant="outline" className="capitalize">{task.status.replace("_", " ")}</Badge>
                    <Badge variant="outline" className={`capitalize text-[10px] ${getPriorityColor(task.priority)}`}>
                      {task.priority}
                    </Badge>
                    {aiInsight && (
                      <Badge className={`text-[10px] capitalize ${getAIPriorityBadge(aiInsight.aiPriority)}`}>
                        AI: {aiInsight.aiPriority}
                      </Badge>
                    )}
                    {task.dueDate && (
                      <div className="flex items-center text-xs font-medium text-orange-600 dark:text-orange-400">
                        <Clock className="mr-1 h-3 w-3" />
                        Due {format(new Date(task.dueDate), "MMM d, yyyy")}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

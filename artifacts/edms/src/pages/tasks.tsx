import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListTasks, useListProjects, getListTasksQueryKey } from "@workspace/api-client-react";
import {
  CheckSquare, Clock, AlertCircle, Loader2, Brain,
  ArrowUp, ArrowDown, Plus, FolderKanban, Mail, ExternalLink,
} from "lucide-react";
import { format, isPast, differenceInDays } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AITaskInsights } from "@/components/ai/AITaskInsights";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AIPriorityInsight {
  taskId: number;
  aiPriority: "low" | "medium" | "high" | "urgent";
  aiScore: number;
  reasoning: string;
  isBottleneck: boolean;
}

type SortKey = "dueDate" | "priority" | "status" | "title" | "projectName";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "pending" | "in_progress" | "completed" | "cancelled";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 };

const PRIORITY_COLORS: Record<string, string> = {
  urgent:  "text-red-500 bg-red-50 dark:bg-red-500/10",
  high:    "text-orange-500 bg-orange-50 dark:bg-orange-500/10",
  medium:  "text-blue-500 bg-blue-50 dark:bg-blue-500/10",
  low:     "text-slate-500 bg-slate-50 dark:bg-slate-500/10",
};

async function createTaskApi(payload: {
  title: string;
  description?: string;
  priority: string;
  dueDate?: string;
  projectId?: number | null;
}) {
  const r = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to create task");
  return r.json();
}

async function updateTaskStatusApi(id: number, status: string) {
  const r = await fetch(`/api/tasks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error("Failed to update task");
  return r.json();
}

export default function Tasks() {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useListTasks({ assignedToMe: true });
  const { data: projectsData } = useListProjects();

  const { data: corrTasksData } = useQuery({
    queryKey: ["correspondence-assigned-to-me"],
    queryFn: async () => {
      const r = await fetch("/api/correspondence/assigned-to-me", { credentials: "include" });
      if (!r.ok) return { items: [] };
      return r.json();
    },
  });
  const corrTasks: any[] = corrTasksData?.items ?? [];

  const [showAI, setShowAI] = useState(false);
  const [aiInsights, setAiInsights] = useState<Record<number, AIPriorityInsight>>({});
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newProjectId, setNewProjectId] = useState<string>("none");

  const projects = projectsData?.projects ?? projectsData ?? [];

  const createMutation = useMutation({
    mutationFn: createTaskApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getListTasksQueryKey({ assignedToMe: true }) });
      toast({ title: t("taskCreated") });
      setCreateOpen(false);
      setNewTitle(""); setNewDesc(""); setNewPriority("medium");
      setNewDueDate(""); setNewProjectId("none");
    },
    onError: () => toast({ title: t("taskCreateFailed"), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateTaskStatusApi(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getListTasksQueryKey({ assignedToMe: true }) });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createMutation.mutate({
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      priority: newPriority,
      dueDate: newDueDate || undefined,
      projectId: newProjectId !== "none" ? parseInt(newProjectId) : null,
    });
  };

  const tasks = data?.tasks ?? [];
  const taskIds = tasks.map(t => t.id);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return tasks;
    return tasks.filter(t => t.status === statusFilter);
  }, [tasks, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "dueDate": {
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          cmp = ad - bd; break;
        }
        case "priority":
          cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99); break;
        case "status":
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99); break;
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? ""); break;
        case "projectName":
          cmp = (a.projectName ?? "").localeCompare(b.projectName ?? ""); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: "all",         label: t("allActive") },
    { key: "pending",     label: t("taskPending") },
    { key: "in_progress", label: t("taskInProgress") },
    { key: "completed",   label: t("taskCompleted") },
  ];

  const SORT_OPTS: { key: SortKey; label: string }[] = [
    { key: "dueDate",     label: t("taskDueDate") },
    { key: "priority",    label: t("taskPriority") },
    { key: "status",      label: t("taskStatus") },
    { key: "title",       label: t("title") },
    { key: "projectName", label: t("project") },
  ];

  return (
    <div className={cn("space-y-6 animate-in fade-in", isRtl && "font-[Tahoma,Arial,sans-serif] text-right")} dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("myTasksTitle")}</h1>
          <p className="text-muted-foreground mt-1">{t("myTasksDesc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("addTask")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
            onClick={() => setShowAI(v => !v)}
          >
            <Brain className="h-4 w-4" />
            {showAI ? t("hideInsights") : t("aiInsights")}
          </Button>
        </div>
      </div>

      {showAI && (
        <AITaskInsights taskIds={taskIds} onPriorityChange={(id, insight) => setAiInsights(p => ({ ...p, [id]: insight }))} />
      )}

      {/* Status tabs + sort bar */}
      <div className="flex items-center gap-2 border-b pb-4 flex-wrap gap-y-2">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={cn(
              "text-sm px-3 py-1 rounded-full transition-colors",
              statusFilter === tab.key
                ? "bg-primary text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent",
            )}
          >
            {tab.label}
            {tab.key !== "all" && (
              <span className="ml-1.5 text-xs opacity-70">
                {tasks.filter(t => t.status === tab.key).length}
              </span>
            )}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("sortBy")}</span>
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
            variant="outline" size="sm" className="h-8 w-8 p-0"
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
          <h3 className="mt-4 text-lg font-medium">{t("noTasks")}</h3>
          <p className="text-muted-foreground">{t("noTasksDesc")}</p>
          <Button className="mt-6 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {t("addTask")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {sorted.map(task => {
            const aiInsight = aiInsights[task.id];
            return (
              <Card key={task.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", PRIORITY_COLORS[task.priority])}>
                    {task.priority === "urgent" ? <AlertCircle className="h-5 w-5" /> : <CheckSquare className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {task.projectName && (
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <FolderKanban className="h-3 w-3" /> {task.projectName}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground capitalize">{task.sourceType}</span>
                      {aiInsight?.isBottleneck && (
                        <Badge className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                          {t("taskBottleneck")}
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-foreground truncate">{task.title}</h3>
                    {task.description && (
                      <p className="text-sm text-muted-foreground truncate mt-0.5">{task.description}</p>
                    )}
                    {aiInsight?.reasoning && (
                      <p className="text-xs text-primary mt-1 flex items-center gap-1">
                        <Brain className="h-3 w-3" /> {aiInsight.reasoning}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Select
                      value={task.status}
                      onValueChange={val => updateMutation.mutate({ id: task.id, status: val })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending" className="text-xs">{t("taskPending")}</SelectItem>
                        <SelectItem value="in_progress" className="text-xs">{t("taskInProgress")}</SelectItem>
                        <SelectItem value="completed" className="text-xs">{t("taskCompleted")}</SelectItem>
                        <SelectItem value="cancelled" className="text-xs">{t("taskCancelled")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Badge variant="outline" className={cn("capitalize text-[10px]", PRIORITY_COLORS[task.priority])}>
                      {task.priority}
                    </Badge>
                    {aiInsight && (
                      <Badge className={cn("text-[10px] capitalize", {
                        "bg-red-100 text-red-800":    aiInsight.aiPriority === "urgent",
                        "bg-orange-100 text-orange-800": aiInsight.aiPriority === "high",
                        "bg-yellow-100 text-yellow-800": aiInsight.aiPriority === "medium",
                        "bg-green-100 text-green-800":   aiInsight.aiPriority === "low",
                      })}>
                        AI: {aiInsight.aiPriority}
                      </Badge>
                    )}
                    {task.dueDate && (
                      <div className="flex items-center text-xs font-medium text-orange-600 dark:text-orange-400">
                        <Clock className="mr-1 h-3 w-3" />
                        {t("taskDue")} {format(new Date(task.dueDate), "MMM d, yyyy")}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Correspondence assigned to me */}
      {corrTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Correspondence Requiring Action
            </h2>
            <Badge variant="outline" className="text-xs">{corrTasks.length}</Badge>
          </div>
          <div className="grid gap-3">
            {corrTasks.map((c: any) => {
              const isOverdue = c.dueDate && isPast(new Date(c.dueDate)) && c.status !== "closed";
              const daysUntilDue = c.dueDate ? differenceInDays(new Date(c.dueDate), new Date()) : null;
              const dueSoon = daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 3;

              return (
                <Card key={c.id} className={cn("hover:shadow-md transition-shadow", isOverdue && "border-red-300 dark:border-red-800")}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={cn(
                      "h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold",
                      isOverdue ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                        : PRIORITY_COLORS[c.priority] ?? "bg-slate-100 text-slate-600",
                    )}>
                      {isOverdue ? <AlertCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        {c.projectName && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <FolderKanban className="h-3 w-3" /> {c.projectName}
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px] capitalize">{c.type?.replace("_", " ")}</Badge>
                        {c.referenceNumber && (
                          <span className="text-[10px] text-muted-foreground font-mono">{c.referenceNumber}</span>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold truncate">{c.subject}</h3>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        From: {c.fromName ?? "Unknown"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Badge variant="outline" className={cn(
                        "text-[10px] capitalize",
                        isOverdue ? "border-red-400 text-red-600 bg-red-50 dark:bg-red-900/20"
                          : dueSoon ? "border-orange-400 text-orange-600 bg-orange-50 dark:bg-orange-900/20"
                          : "",
                      )}>
                        {isOverdue ? "Overdue" : c.status}
                      </Badge>
                      {c.dueDate && (
                        <div className={cn(
                          "flex items-center text-[11px] font-medium",
                          isOverdue ? "text-red-500" : dueSoon ? "text-orange-500" : "text-muted-foreground",
                        )}>
                          <Clock className="mr-1 h-3 w-3" />
                          {isOverdue
                            ? `${Math.abs(daysUntilDue!)} day${Math.abs(daysUntilDue!) === 1 ? "" : "s"} overdue`
                            : `Due ${format(new Date(c.dueDate), "MMM d, yyyy")}`}
                        </div>
                      )}
                      <a
                        href="/correspondence"
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </a>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Task Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("addTask")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">{t("taskTitle")} *</Label>
              <Input
                id="task-title"
                placeholder={t("taskTitlePlaceholder")}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-desc">{t("taskDescription")}</Label>
              <Textarea
                id="task-desc"
                placeholder={t("taskDescPlaceholder")}
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("taskPriority")}</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t("taskLow")}</SelectItem>
                    <SelectItem value="medium">{t("taskMedium")}</SelectItem>
                    <SelectItem value="high">{t("taskHigh")}</SelectItem>
                    <SelectItem value="urgent">{t("taskUrgent")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-due">{t("taskDueDate")}</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={newDueDate}
                  onChange={e => setNewDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("taskProject")}</Label>
              <Select value={newProjectId} onValueChange={setNewProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("taskOptionalProject")}</SelectItem>
                  {(Array.isArray(projects) ? projects : []).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.code} – {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!newTitle.trim() || createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

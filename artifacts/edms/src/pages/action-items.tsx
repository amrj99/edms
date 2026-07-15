import { useState } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isPast, isToday } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import {
  CheckSquare, AlertTriangle, Clock, Calendar, Filter, Search,
  ChevronDown, Flag, User, MoreHorizontal, CheckCircle2, Circle,
  Timer, ArrowUpRight, BarChart3, ListTodo, Loader2,
} from "lucide-react";

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  low:      { label: "Low",      color: "bg-slate-100 text-slate-600 border-slate-200",    icon: "↓" },
  medium:   { label: "Medium",   color: "bg-blue-50 text-blue-700 border-blue-200",        icon: "→" },
  high:     { label: "High",     color: "bg-orange-50 text-orange-700 border-orange-200",  icon: "↑" },
  critical: { label: "Critical", color: "bg-red-50 text-red-700 border-red-200",           icon: "⚡" },
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  open:        { label: "Open",        icon: <Circle className="h-3.5 w-3.5" />,        color: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In Progress", icon: <Timer className="h-3.5 w-3.5" />,         color: "bg-blue-100 text-blue-700" },
  done:        { label: "Done",        icon: <CheckCircle2 className="h-3.5 w-3.5" />,  color: "bg-green-100 text-green-700" },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
      <span className="text-[10px]">{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function OverdueDot() {
  return <span className="h-2 w-2 rounded-full bg-red-500 inline-block shrink-0" title="Overdue" />;
}

export default function ActionItemsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("_all");
  const [priorityFilter, setPriorityFilter] = useState("_all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [projectFilter, setProjectFilter] = useState("_all");
  const [selected, setSelected] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  const canEdit = user && ["system_owner", "admin", "project_manager", "document_controller"].includes(user.role);

  const { data, isLoading } = useQuery({
    queryKey: ["action-items-all"],
    queryFn: async () => {
      const r = await fetch("/api/meetings/action-items", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch");
      return r.json();
    },
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects-list-ai"],
    queryFn: async () => {
      const r = await fetch("/api/projects", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await fetch(`/api/meetings/${selected.meetingId}/action-items/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Action item updated" });
      qc.invalidateQueries({ queryKey: ["action-items-all"] });
      setEditing(false);
      setSelected(null);
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const quickStatusMutation = useMutation({
    mutationFn: async ({ item, status }: { item: any; status: string }) => {
      const r = await fetch(`/api/meetings/${item.meetingId}/action-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      qc.invalidateQueries({ queryKey: ["action-items-all"] });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const allItems: any[] = data?.actionItems ?? [];
  const projects: any[] = unwrapList<any>(projectsData, "projects");

  const now = new Date();
  const filtered = allItems.filter(item => {
    if (statusFilter !== "_all" && item.status !== statusFilter) return false;
    if (priorityFilter !== "_all" && item.priority !== priorityFilter) return false;
    if (projectFilter !== "_all" && String(item.projectId) !== projectFilter) return false;
    if (overdueOnly && !item.isOverdue) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !item.title?.toLowerCase().includes(q) &&
        !item.assignedToName?.toLowerCase().includes(q) &&
        !item.meetingTitle?.toLowerCase().includes(q) &&
        !item.projectName?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const overdueCount  = allItems.filter(i => i.isOverdue).length;
  const openCount     = allItems.filter(i => i.status === "open").length;
  const doneCount     = allItems.filter(i => i.status === "done").length;
  const criticalCount = allItems.filter(i => i.priority === "critical" && i.status !== "done").length;

  function openEdit(item: any) {
    setSelected(item);
    setEditForm({
      title: item.title,
      status: item.status,
      priority: item.priority ?? "medium",
      assignedToName: item.assignedToName ?? "",
      dueDate: item.dueDate ? item.dueDate.slice(0, 10) : "",
      notes: item.notes ?? "",
    });
    setEditing(true);
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-background shrink-0">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <ListTodo className="h-5 w-5 text-primary" />
              Action Items Tracker
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cross-project view of all meeting action items
            </p>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 shrink-0">
          {[
            { label: "Open",     value: openCount,     icon: <Circle className="h-4 w-4 text-slate-500" />,    bg: "bg-slate-50" },
            { label: "Overdue",  value: overdueCount,  icon: <AlertTriangle className="h-4 w-4 text-red-500" />, bg: "bg-red-50" },
            { label: "Critical", value: criticalCount, icon: <Flag className="h-4 w-4 text-orange-500" />,      bg: "bg-orange-50" },
            { label: "Done",     value: doneCount,     icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, bg: "bg-green-50" },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border p-4 flex items-center gap-3 ${s.bg}`}>
              <div className="rounded-lg bg-background/80 p-2">{s.icon}</div>
              <div>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 px-6 pb-3 shrink-0">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search action items…"
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-8 w-36 text-sm"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Priorities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Projects</SelectItem>
              {projects.map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.code} – {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={overdueOnly ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setOverdueOnly(v => !v)}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Overdue only
          </Button>
          <span className="ml-auto text-xs text-muted-foreground self-center">
            {filtered.length} of {allItems.length} items
          </span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <CheckSquare className="h-12 w-12 opacity-30" />
              <p className="text-sm">No action items match your filters</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((item: any) => {
                const isOverdue = item.isOverdue;
                const isDone = item.status === "done";
                return (
                  <div
                    key={item.id}
                    className={`group border rounded-lg p-3 hover:shadow-sm transition-all cursor-pointer ${
                      isDone ? "opacity-60" : isOverdue ? "border-red-200 bg-red-50/30" : "bg-background hover:bg-muted/20"
                    }`}
                    onClick={() => openEdit(item)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Quick status toggle */}
                      <button
                        className="mt-0.5 shrink-0 hover:scale-110 transition-transform"
                        onClick={e => {
                          e.stopPropagation();
                          if (!canEdit) return;
                          const nextStatus = item.status === "done" ? "open" : item.status === "open" ? "in_progress" : "done";
                          quickStatusMutation.mutate({ item, status: nextStatus });
                        }}
                        title="Click to cycle status"
                      >
                        {STATUS_CONFIG[item.status]?.icon ?? <Circle className="h-3.5 w-3.5 text-slate-400" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isOverdue && !isDone && <OverdueDot />}
                          <span className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
                            {item.title}
                          </span>
                          <PriorityBadge priority={item.priority ?? "medium"} />
                          <StatusBadge status={item.status} />
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                          {item.projectName && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <span className="font-mono bg-muted px-1 rounded text-[10px]">{item.projectCode}</span>
                              {item.projectName}
                            </span>
                          )}
                          {item.meetingRef && (
                            <Link
                              href="/meetings"
                              className="text-xs text-primary hover:underline flex items-center gap-0.5"
                              onClick={e => e.stopPropagation()}
                            >
                              {item.meetingRef} <ArrowUpRight className="h-3 w-3" />
                            </Link>
                          )}
                          {item.assignedToName && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {item.assignedToName}
                            </span>
                          )}
                          {item.dueDate && (
                            <span className={`text-xs flex items-center gap-1 ${
                              isOverdue && !isDone ? "text-red-600 font-medium" : "text-muted-foreground"
                            }`}>
                              <Calendar className="h-3 w-3" />
                              {isOverdue && !isDone ? "Overdue · " : ""}
                              {format(new Date(item.dueDate), "dd MMM yyyy")}
                            </span>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                        onClick={e => { e.stopPropagation(); openEdit(item); }}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editing} onOpenChange={v => { if (!v) { setEditing(false); setSelected(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Action Item</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-1">
              <div className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
                Meeting: <span className="font-medium">{selected.meetingRef}</span> — {selected.meetingTitle}
                {selected.projectName && <> · <span className="font-mono">{selected.projectCode}</span> {selected.projectName}</>}
              </div>
              <div>
                <Label className="text-xs">Title</Label>
                <Input
                  value={editForm.title ?? ""}
                  onChange={e => setEditForm((f: any) => ({ ...f, title: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={editForm.status} onValueChange={v => setEditForm((f: any) => ({ ...f, status: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Select value={editForm.priority} onValueChange={v => setEditForm((f: any) => ({ ...f, priority: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Assigned To</Label>
                  <Input
                    value={editForm.assignedToName}
                    onChange={e => setEditForm((f: any) => ({ ...f, assignedToName: e.target.value }))}
                    className="mt-1"
                    placeholder="Name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Due Date</Label>
                  <Input
                    type="date"
                    value={editForm.dueDate}
                    onChange={e => setEditForm((f: any) => ({ ...f, dueDate: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={editForm.notes}
                  onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
                  className="mt-1 text-sm"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate(editForm)}
            >
              {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

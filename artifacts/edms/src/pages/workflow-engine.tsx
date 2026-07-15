import { useState, useEffect, useCallback } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GitBranch, CheckCircle2, XCircle, AlertCircle, Clock, Loader2,
  ChevronRight, RefreshCw, Plus, Workflow, SkipForward, ArrowLeft, Layers,
  Play, Search, FileText, Settings2, Pencil, Copy, Power, PowerOff, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { TemplateEditorDialog, WfTemplate as EditorTemplate } from "@/components/workflow/TemplateEditorDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stage {
  id: number;
  templateId: number;
  stageOrder: number;
  name: string;
  description?: string;
  responsibleRole?: string;
  responsibleUserId?: number;
  isTerminal: boolean;
}

interface Transition {
  id: number;
  action: string;
  actorName?: string;
  comment?: string;
  fromStageName?: string;
  toStageName?: string;
  createdAt: string;
}

interface WfInstance {
  id: number;
  documentId: number;
  templateId: number;
  status: string;
  documentTitle?: string;
  documentNumber?: string;
  documentType?: string;
  workflowName?: string;
  projectName?: string;
  initiatedByName?: string;
  currentStageName?: string;
  currentStageRole?: string;
  currentStageSla?: number | null;
  currentStageReminderDays?: number | null;
  stagesTotal: number;
  stagesCurrent: number;
  stageDueAt?: string | null;
  isOverdue?: boolean;
  daysRemaining?: number | null;
  canAct?: boolean;
  transitions: Transition[];
  createdAt: string;
  updatedAt: string;
}

interface WfTemplate {
  id: number;
  name: string;
  documentType: string;
  description?: string;
  isActive: boolean;
  stages: Stage[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const api = {
  get: (path: string) => fetch(`/api${path}`, { credentials: "include" }).then(r => r.json()),
  post: async (path: string, body: object) => {
    const r = await fetch(`/api${path}`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 204) return {};
    return r.json();
  },
  put: (path: string, body: object) => fetch(`/api${path}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json()),
  del: (path: string) => fetch(`/api${path}`, { method: "DELETE", credentials: "include" }).then(r => r.json()),
};

// ─── Status badges ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; icon: any; cls: string }> = {
  active:    { label: "Active",    icon: Clock,         cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  completed: { label: "Completed", icon: CheckCircle2,  cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  rejected:  { label: "Rejected",  icon: XCircle,       cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  cancelled: { label: "Cancelled", icon: AlertCircle,   cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

const ACTION_LABELS: Record<string, string> = {
  started: "Started", advanced: "Advanced", completed: "Completed",
  rejected: "Rejected", returned: "Returned to previous stage", cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, icon: AlertCircle, cls: "bg-muted text-muted-foreground" };
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", cfg.cls)}>
      <Icon className="h-3 w-3" />{cfg.label}
    </span>
  );
}

function ProgressBar({ current, total, status }: { current: number; total: number; status: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const barCls = status === "completed" ? "bg-green-500" : status === "rejected" ? "bg-red-400" : "bg-blue-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barCls)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{current}/{total}</span>
    </div>
  );
}

// ─── Instance Detail Modal ────────────────────────────────────────────────────

function InstanceDetail({
  instance, onClose, onAction,
}: {
  instance: WfInstance;
  onClose: () => void;
  onAction: (id: number, action: "advance" | "reject", comment: string, rejectAction?: string) => Promise<void>;
}) {
  const { user } = useAuth();
  const [comment, setComment] = useState("");
  const [rejectType, setRejectType] = useState("rejected");
  const [loading, setLoading] = useState(false);
  const canAct = instance.canAct ?? false;

  const handle = async (type: "advance" | "reject") => {
    setLoading(true);
    try { await onAction(instance.id, type, comment, rejectType); }
    finally { setLoading(false); setComment(""); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5 text-primary" />
            {instance.documentNumber} — {instance.documentTitle}
          </DialogTitle>
        </DialogHeader>

        {/* Document link — primary action for the reviewer */}
        <Link
          href={`/documents/${instance.documentId}`}
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg border bg-muted/40 hover:bg-muted/70 px-3 py-2.5 transition-colors group"
        >
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs text-muted-foreground">{instance.documentNumber}</div>
            <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{instance.documentTitle}</div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </Link>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Workflow:</span> <strong>{instance.workflowName}</strong></div>
          <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={instance.status} /></div>
          <div><span className="text-muted-foreground">Type:</span> <Badge variant="outline">{instance.documentType}</Badge></div>
          <div><span className="text-muted-foreground">Project:</span> {instance.projectName ?? "—"}</div>
          <div><span className="text-muted-foreground">Started by:</span> {instance.initiatedByName ?? "—"}</div>
          <div><span className="text-muted-foreground">Progress:</span></div>
          <div className="col-span-2"><ProgressBar current={instance.stagesCurrent} total={instance.stagesTotal} status={instance.status} /></div>
        </div>

        {/* Current Stage */}
        {instance.status === "active" && instance.currentStageName && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-3">
            <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-0.5">CURRENT STAGE</div>
            <div className="font-semibold text-blue-900 dark:text-blue-200">{instance.currentStageName}</div>
            {instance.currentStageRole && (
              <div className="text-sm text-blue-700 dark:text-blue-300 mt-0.5">Responsible: {instance.currentStageRole}</div>
            )}
          </div>
        )}
        {instance.status === "completed" && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 p-3 flex items-center gap-2 text-green-700 dark:text-green-300">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">Workflow completed</span>
          </div>
        )}

        {/* Transition history */}
        <div>
          <div className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">History</div>
          <div className="space-y-2">
            {instance.transitions.map((t, i) => (
              <div key={t.id} className="flex gap-3 text-sm">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  {i < instance.transitions.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ACTION_LABELS[t.action] ?? t.action}</span>
                    {t.toStageName && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    {t.toStageName && <span className="text-primary font-medium">{t.toStageName}</span>}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t.actorName} · {format(new Date(t.createdAt), "dd MMM yyyy HH:mm")}
                  </div>
                  {t.comment && <div className="text-muted-foreground italic mt-0.5">"{t.comment}"</div>}
                </div>
              </div>
            ))}
            {instance.transitions.length === 0 && (
              <p className="text-muted-foreground text-sm">No history yet.</p>
            )}
          </div>
        </div>

        {/* Actions */}
        {canAct && instance.status === "active" && (
          <div className="border-t pt-4 space-y-3">
            <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Take Action</div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Comment (optional)</Label>
              <Textarea
                value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Add a comment..."
                className="h-20 text-sm resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => handle("advance")} disabled={loading} className="flex-1">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <SkipForward className="h-4 w-4 mr-2" />}
                Advance to Next Stage
              </Button>
              <Select value={rejectType} onValueChange={setRejectType}>
                <SelectTrigger className="w-36 h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rejected">Reject</SelectItem>
                  <SelectItem value="returned">Return to Previous</SelectItem>
                  <SelectItem value="cancelled">Cancel Workflow</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="destructive" onClick={() => handle("reject")} disabled={loading} className="flex-1">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                {rejectType === "returned" ? "Return" : rejectType === "cancelled" ? "Cancel" : "Reject"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowEnginePage() {
  const [, params] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [instances, setInstances] = useState<WfInstance[]>([]);
  const [templates, setTemplates] = useState<WfTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WfInstance | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [myActionsOnly, setMyActionsOnly] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Start workflow dialog state
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [docResults, setDocResults] = useState<Array<{ id: number; title: string; documentNumber: string; documentType: string }>>([]);
  const [docSearchLoading, setDocSearchLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<{ id: number; title: string; documentNumber: string; documentType: string } | null>(null);
  const [selectedDocPriorWorkflows, setSelectedDocPriorWorkflows] = useState<Array<{ status: string; workflowName?: string }>>([]);
  const [startTemplateId, setStartTemplateId] = useState<number | null>(null);
  const [startingWorkflow, setStartingWorkflow] = useState(false);

  // Template editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTemplate, setEditorTemplate] = useState<EditorTemplate | null>(null);

  const isAdmin = ["admin", "system_owner"].includes(user?.role ?? "");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [instData, tplData] = await Promise.all([
        api.get("/workflow-engine/instances"),
        api.get("/workflow-engine/templates"),
      ]);
      setInstances(unwrapList<any>(instData, "instances"));
      setTemplates(tplData.templates ?? []);
    } catch {
      toast({ title: "Failed to load workflow data", variant: "destructive" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive unique doc types from instances for tabs
  const docTypes = [...new Set(instances.map(i => i.documentType).filter(Boolean))] as string[];

  const myPendingCount = instances.filter(i => i.canAct && i.status === "active").length;

  const filtered = instances.filter(i => {
    if (myActionsOnly && !(i.canAct && i.status === "active")) return false;
    if (activeTab !== "all" && i.documentType !== activeTab) return false;
    if (statusFilter !== "all" && i.status !== statusFilter) return false;
    return true;
  });

  const handleAction = async (id: number, action: "advance" | "reject", comment: string, rejectAction?: string) => {
    try {
      const path = `/workflow-engine/instances/${id}/${action}`;
      const body = action === "reject" ? { comment, action: rejectAction } : { comment };
      const updated = await api.post(path, body);
      if (updated.error) throw new Error(updated.error);
      setInstances(prev => prev.map(i => i.id === id ? updated : i));
      setSelected(updated);
      toast({ title: action === "advance" ? "Advanced to next stage" : "Action taken" });
    } catch (e: any) {
      toast({ title: e.message ?? "Action failed", variant: "destructive" });
    }
  };

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await api.post("/workflow-engine/seed-defaults", {});
      if (res.error) throw new Error(res.error);
      const created = res.results?.filter((r: any) => r.status === "created").length ?? 0;
      toast({ title: created > 0 ? `${created} workflow template(s) created` : "All default templates already exist" });
      await load();
    } catch (e: any) {
      toast({ title: e.message ?? "Setup failed", variant: "destructive" });
    } finally { setSeeding(false); }
  };

  // Document search for start-workflow dialog
  const searchDocs = useCallback(async (q: string) => {
    if (!q.trim()) { setDocResults([]); return; }
    setDocSearchLoading(true);
    try {
      const res = await api.get(`/documents?search=${encodeURIComponent(q)}&limit=10`);
      setDocResults(unwrapList<any>(res, "documents"));
    } catch { setDocResults([]); }
    finally { setDocSearchLoading(false); }
  }, []);

  const selectDoc = useCallback(async (doc: { id: number; title: string; documentNumber: string; documentType: string }) => {
    setSelectedDoc(doc);
    setDocSearch("");
    setDocResults([]);
    setStartTemplateId(null);
    setSelectedDocPriorWorkflows([]);
    try {
      const hist = await api.get(`/workflow-engine/instances/for-document/${doc.id}`);
      setSelectedDocPriorWorkflows((unwrapList<any>(hist, "instances")).map((i: any) => ({ status: i.status, workflowName: i.workflowName })));
    } catch { /* non-critical — history badge is informational only */ }
  }, []);

  const closeStartDialog = useCallback(() => {
    setShowStartDialog(false);
    setSelectedDoc(null);
    setSelectedDocPriorWorkflows([]);
    setDocSearch("");
    setDocResults([]);
    setStartTemplateId(null);
  }, []);

  // Auto-select template when doc changes
  // Exact type match first; fall back to all active templates so the user can still pick one
  const exactTemplatesForDoc = selectedDoc
    ? templates.filter(t => t.documentType.toLowerCase() === selectedDoc.documentType?.toLowerCase())
    : [];
  const templatesForDoc = exactTemplatesForDoc.length > 0 ? exactTemplatesForDoc : (selectedDoc ? templates : []);
  const isExactMatch = exactTemplatesForDoc.length > 0;

  const startWorkflow = async () => {
    if (!selectedDoc) return;
    const templateId = startTemplateId ?? templatesForDoc[0]?.id;
    if (!templateId) { toast({ title: "No workflow template found for this document type", variant: "destructive" }); return; }
    setStartingWorkflow(true);
    try {
      const res = await api.post("/workflow-engine/instances", { documentId: selectedDoc.id, templateId });
      if (res.error) throw new Error(res.error);
      toast({ title: "Workflow started", description: `Stage: ${res.currentStageName}` });
      closeStartDialog();
      await load();
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to start workflow", variant: "destructive" });
    } finally { setStartingWorkflow(false); }
  };

  // ── Template editor handlers ────────────────────────────────────────────────

  const openNewTemplate = () => { setEditorTemplate(null); setEditorOpen(true); };
  const openEditTemplate = (tpl: WfTemplate) => {
    const mapped: EditorTemplate = { ...tpl, stages: tpl.stages as any };
    setEditorTemplate(mapped);
    setEditorOpen(true);
  };

  const handleEditorSaved = (saved: EditorTemplate) => {
    setEditorOpen(false);
    setTemplates(prev => {
      const idx = prev.findIndex(t => t.id === saved.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = saved as unknown as WfTemplate;
        return updated;
      }
      return [...prev, saved as unknown as WfTemplate];
    });
  };

  const duplicateTemplate = async (tpl: WfTemplate) => {
    try {
      const copy = await api.post(`/workflow-engine/templates/${tpl.id}/duplicate`, {});
      if (copy.error) throw new Error(copy.error);
      toast({ title: `Duplicated as "${copy.name}"` });
      setTemplates(prev => [...prev, copy]);
    } catch (e: any) {
      toast({ title: e.message ?? "Duplicate failed", variant: "destructive" });
    }
  };

  const toggleActiveTemplate = async (tpl: WfTemplate) => {
    try {
      const updated = await api.put(`/workflow-engine/templates/${tpl.id}`, {
        name: tpl.name,
        documentType: tpl.documentType,
        description: tpl.description,
        isActive: !tpl.isActive,
      });
      if (updated.error) throw new Error(updated.error);
      setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, isActive: !tpl.isActive } : t));
      toast({ title: !tpl.isActive ? "Template activated" : "Template deactivated" });
    } catch (e: any) {
      toast({ title: e.message ?? "Update failed", variant: "destructive" });
    }
  };

  const deleteTemplate = async (tpl: WfTemplate) => {
    if (!window.confirm(`Delete "${tpl.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/workflow-engine/templates/${tpl.id}`);
      setTemplates(prev => prev.filter(t => t.id !== tpl.id));
      toast({ title: "Template deleted" });
    } catch (e: any) {
      toast({ title: e.message ?? "Delete failed", variant: "destructive" });
    }
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = {
    total: instances.length,
    active: instances.filter(i => i.status === "active").length,
    completed: instances.filter(i => i.status === "completed").length,
    rejected: instances.filter(i => i.status === "rejected" || i.status === "cancelled").length,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            Workflow Engine
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configurable multi-stage document approval workflows
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={seedDefaults} disabled={seeding}>
              {seeding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Settings2 className="h-4 w-4 mr-2" />}
              Setup Default Templates
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={openNewTemplate}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          )}
          <Button size="sm" onClick={() => setShowStartDialog(true)}>
            <Play className="h-4 w-4 mr-2" />
            Start Workflow
          </Button>
        </div>
      </div>

      {/* My pending actions alert */}
      {myPendingCount > 0 && !myActionsOnly && (
        <div
          className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
          onClick={() => setMyActionsOnly(true)}
        >
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1 text-sm text-amber-800 dark:text-amber-200">
            <span className="font-semibold">{myPendingCount} workflow{myPendingCount > 1 ? "s" : ""} pending your action.</span>
            {" "}Click to filter.
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, cls: "text-foreground" },
          { label: "Active", value: stats.active, cls: "text-blue-600 dark:text-blue-400" },
          { label: "Completed", value: stats.completed, cls: "text-green-600 dark:text-green-400" },
          { label: "Rejected / Cancelled", value: stats.rejected, cls: "text-red-500" },
        ].map(s => (
          <Card key={s.label} className="py-4">
            <CardContent className="pt-0 pb-0 text-center">
              <div className={cn("text-3xl font-bold", s.cls)}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All Types</TabsTrigger>
            {docTypes.map(t => (
              <TabsTrigger key={t} value={t}>{t}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={myActionsOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setMyActionsOnly(v => !v)}
          className="gap-1.5"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          My Actions
          {myPendingCount > 0 && (
            <span className={cn("ml-1 rounded-full px-1.5 py-0 text-xs font-semibold",
              myActionsOnly ? "bg-white/20 text-white" : "bg-amber-500 text-white"
            )}>{myPendingCount}</span>
          )}
        </Button>
        {(activeTab !== "all" || statusFilter !== "all" || myActionsOnly) && (
          <Button variant="ghost" size="sm" onClick={() => { setActiveTab("all"); setStatusFilter("all"); setMyActionsOnly(false); }}>
            <ArrowLeft className="h-3 w-3 mr-1" />Clear filters
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} workflows</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Workflow className="h-12 w-12 text-muted-foreground/30" />
            <div className="text-muted-foreground text-sm">
              {instances.length === 0
                ? "No workflow instances found. Start a workflow by linking a document to a template."
                : "No workflows match the current filters."}
            </div>
            {instances.length === 0 && isAdmin && (
              <Button size="sm" onClick={seedDefaults} disabled={seeding}>
                {seeding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Setup Default Workflow Templates
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Current Stage</TableHead>
                  <TableHead>Responsible</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(inst => (
                  <TableRow
                    key={inst.id}
                    className={cn("cursor-pointer hover:bg-muted/40", inst.canAct && inst.status === "active" && "bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30")}
                    onClick={() => setSelected(inst)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/documents/${inst.documentId}`}
                        onClick={e => e.stopPropagation()}
                        className="font-mono text-xs text-primary hover:underline underline-offset-2"
                      >
                        {inst.documentNumber}
                      </Link>
                      <div className="font-medium text-sm truncate max-w-[180px]">{inst.documentTitle}</div>
                      {inst.canAct && inst.status === "active" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 mt-0.5">
                          <AlertCircle className="h-3 w-3" /> Action required
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{inst.documentType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{inst.workflowName}</TableCell>
                    <TableCell>
                      {inst.status === "active" ? (
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                          {inst.currentStageName ?? "—"}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inst.currentStageRole ?? "—"}
                    </TableCell>
                    <TableCell className="min-w-[120px]">
                      <ProgressBar current={inst.stagesCurrent} total={inst.stagesTotal} status={inst.status} />
                    </TableCell>
                    <TableCell><StatusBadge status={inst.status} /></TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {inst.status === "active" && inst.stageDueAt ? (
                        inst.isOverdue ? (
                          <Badge variant="destructive" className="text-xs font-normal gap-1">
                            Overdue {Math.abs(inst.daysRemaining ?? 0)}d
                          </Badge>
                        ) : (
                          <span className={inst.daysRemaining != null && inst.daysRemaining <= 2
                            ? "text-amber-600 dark:text-amber-400 font-medium"
                            : "text-muted-foreground"
                          }>
                            {format(new Date(inst.stageDueAt), "dd MMM yy")}
                            {inst.daysRemaining !== null && (
                              <span className="ml-1 text-xs opacity-75">
                                ({inst.daysRemaining}d)
                              </span>
                            )}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(inst.updatedAt), "dd MMM yy")}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Template configuration panel */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Workflow Templates by Document Type
            </CardTitle>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={seedDefaults} disabled={seeding}>
                {seeding ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Plus className="h-3 w-3 mr-1.5" />}
                Setup Missing Templates
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-center py-6 space-y-3">
              <Settings2 className="h-10 w-10 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No workflow templates configured yet.</p>
              {isAdmin && (
                <Button size="sm" onClick={seedDefaults} disabled={seeding}>
                  {seeding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Setup All Default Templates
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(tpl => (
                <div key={tpl.id} className={cn("flex items-start gap-4 p-3 rounded-lg border bg-muted/30 transition-opacity", !tpl.isActive && "opacity-60")}>
                  <div className="shrink-0 mt-0.5">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{tpl.name}</span>
                      <Badge variant="outline" className="text-xs capitalize">{tpl.documentType}</Badge>
                      <Badge variant={tpl.isActive ? "default" : "secondary"} className="text-xs">
                        {tpl.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {tpl.stages.map((s, i) => (
                        <span key={s.id} className="flex items-center gap-1 text-xs">
                          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                          <span className={cn(
                            "px-2 py-0.5 rounded-full",
                            s.isTerminal
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                              : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
                          )}>
                            {s.name}
                            {s.responsibleRole && <span className="opacity-60 ml-1">({s.responsibleRole})</span>}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Edit template"
                        onClick={() => openEditTemplate(tpl)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Duplicate template"
                        onClick={() => duplicateTemplate(tpl)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className={cn("h-7 w-7", tpl.isActive ? "text-green-600 hover:text-orange-500" : "text-muted-foreground hover:text-green-600")}
                        title={tpl.isActive ? "Deactivate template" : "Activate template"}
                        onClick={() => toggleActiveTemplate(tpl)}
                      >
                        {tpl.isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Delete template"
                        onClick={() => deleteTemplate(tpl)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail modal */}
      {selected && (
        <InstanceDetail
          instance={selected}
          onClose={() => setSelected(null)}
          onAction={handleAction}
        />
      )}

      {/* Start Workflow dialog */}
      {showStartDialog && (
        <Dialog open onOpenChange={v => { if (!v) { setShowStartDialog(false); setSelectedDoc(null); setDocSearch(""); setDocResults([]); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Play className="h-4 w-4 text-primary" />
                Start New Workflow
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Document search */}
              {!selectedDoc ? (
                <div>
                  <Label className="text-sm font-medium">Search for a document</Label>
                  <div className="relative mt-1.5">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Document number or title…"
                      value={docSearch}
                      onChange={e => {
                        setDocSearch(e.target.value);
                        searchDocs(e.target.value);
                      }}
                    />
                    {docSearchLoading && (
                      <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {docResults.length > 0 && (
                    <div className="mt-2 border rounded-lg divide-y max-h-48 overflow-y-auto">
                      {docResults.map(doc => (
                        <button
                          key={doc.id}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors"
                          onClick={() => selectDoc(doc)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-primary font-semibold">{doc.documentNumber}</span>
                            <Badge variant="outline" className="text-xs capitalize">{doc.documentType}</Badge>
                          </div>
                          <div className="text-sm mt-0.5 text-muted-foreground truncate">{doc.title}</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {docSearch && !docSearchLoading && docResults.length === 0 && (
                    <p className="text-sm text-muted-foreground mt-2">No documents found.</p>
                  )}
                </div>
              ) : (
                <div>
                  <Label className="text-sm font-medium">Selected document</Label>
                  <div className="mt-1.5 rounded-lg border bg-muted/30 px-3 py-2.5 flex items-start gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-primary">{selectedDoc.documentNumber}</span>
                        <Badge variant="outline" className="text-xs capitalize">{selectedDoc.documentType}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground truncate mt-0.5">{selectedDoc.title}</div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={() => { setSelectedDoc(null); setSelectedDocPriorWorkflows([]); setStartTemplateId(null); }}>
                      Change
                    </Button>
                  </div>

                  {/* Prior workflow history notice */}
                  {selectedDocPriorWorkflows.length > 0 && (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-medium">Prior workflow history:</span>
                        {" "}
                        {selectedDocPriorWorkflows.map((w, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            <span className={cn(
                              "font-medium capitalize",
                              w.status === "rejected" || w.status === "cancelled" ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400",
                            )}>{w.status}</span>
                            {w.workflowName && <span className="text-muted-foreground"> ({w.workflowName})</span>}
                          </span>
                        ))}
                        {". A new workflow can be started."}
                      </div>
                    </div>
                  )}

                  {/* Template selector */}
                  <div className="mt-3">
                    <Label className="text-sm font-medium">Workflow template</Label>
                    {!isExactMatch && templatesForDoc.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 mb-1.5">
                        No specific template for <strong className="capitalize">{selectedDoc.documentType}</strong> — select from all available:
                      </p>
                    )}
                    {templatesForDoc.length > 0 ? (
                      <Select
                        value={String(startTemplateId ?? templatesForDoc[0].id)}
                        onValueChange={v => setStartTemplateId(Number(v))}
                      >
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {templatesForDoc.map(t => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.name} <span className="text-muted-foreground capitalize ml-1">({t.documentType})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                        No templates configured yet. Use "Setup Default Templates" first.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeStartDialog}>
                Cancel
              </Button>
              <Button
                onClick={startWorkflow}
                disabled={!selectedDoc || templatesForDoc.length === 0 || startingWorkflow}
              >
                {startingWorkflow && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Start Workflow
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Template Editor Dialog */}
      <TemplateEditorDialog
        template={editorTemplate}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={handleEditorSaved}
      />

    </div>
  );
}

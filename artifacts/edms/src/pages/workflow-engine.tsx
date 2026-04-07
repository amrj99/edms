import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

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
  stagesTotal: number;
  stagesCurrent: number;
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
  post: (path: string, body: object) => fetch(`/api${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json()),
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
  const canAct = ["admin", "project_manager", "document_controller", "system_owner"].includes(user?.role ?? "");

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
  const [seeding, setSeeding] = useState(false);
  const [showSeedConfirm, setShowSeedConfirm] = useState(false);

  const isAdmin = ["admin", "system_owner"].includes(user?.role ?? "");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [instData, tplData] = await Promise.all([
        api.get("/workflow-engine/instances"),
        api.get("/workflow-engine/templates"),
      ]);
      setInstances(instData.instances ?? []);
      setTemplates(tplData.templates ?? []);
    } catch {
      toast({ title: "Failed to load workflow data", variant: "destructive" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive unique doc types from instances for tabs
  const docTypes = [...new Set(instances.map(i => i.documentType).filter(Boolean))] as string[];

  const filtered = instances.filter(i => {
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

  const seedInvoice = async () => {
    setSeeding(true);
    try {
      const res = await api.post("/workflow-engine/seed-invoice", {});
      if (res.error) throw new Error(res.error);
      toast({ title: "Invoice workflow template created" });
      await load();
    } catch (e: any) {
      toast({ title: e.message ?? "Seeding failed", variant: "destructive" });
    } finally { setSeeding(false); setShowSeedConfirm(false); }
  };

  const invoiceTemplate = templates.find(t => t.documentType === "Invoice");

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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          {isAdmin && !invoiceTemplate && (
            <Button size="sm" onClick={() => setShowSeedConfirm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Setup Invoice Workflow
            </Button>
          )}
        </div>
      </div>

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

      {/* Invoice template info banner */}
      {invoiceTemplate && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <GitBranch className="h-5 w-5 text-primary" />
              <div>
                <div className="font-medium text-sm">{invoiceTemplate.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  {invoiceTemplate.stages.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                      <span>{s.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("Invoice")}>
              View Invoice Workflows
            </Button>
          </CardContent>
        </Card>
      )}

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
        {(activeTab !== "all" || statusFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setActiveTab("all"); setStatusFilter("all"); }}>
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
            {instances.length === 0 && isAdmin && !invoiceTemplate && (
              <Button size="sm" onClick={() => setShowSeedConfirm(true)}>
                <Plus className="h-4 w-4 mr-2" />Setup Invoice Workflow Template
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
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(inst => (
                  <TableRow
                    key={inst.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelected(inst)}
                  >
                    <TableCell className="font-medium">
                      <div className="font-mono text-xs text-muted-foreground">{inst.documentNumber}</div>
                      <div className="font-medium text-sm truncate max-w-[180px]">{inst.documentTitle}</div>
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

      {/* Templates panel (admin only) */}
      {isAdmin && templates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Configured Templates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {templates.map(tpl => (
              <div key={tpl.id} className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-muted/30">
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {tpl.name}
                    <Badge variant={tpl.isActive ? "default" : "secondary"} className="text-xs">
                      {tpl.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Document type: <strong>{tpl.documentType}</strong> · {tpl.stages.length} stages
                  </div>
                  <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {tpl.stages.map((s, i) => (
                      <span key={s.id} className="flex items-center gap-1 text-xs">
                        {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                        <span className={cn(
                          "px-2 py-0.5 rounded-full",
                          s.isTerminal
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                            : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
                        )}>
                          {s.name}
                          {s.responsibleRole && <span className="opacity-70 ml-1">({s.responsibleRole})</span>}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Detail modal */}
      {selected && (
        <InstanceDetail
          instance={selected}
          onClose={() => setSelected(null)}
          onAction={handleAction}
        />
      )}

      {/* Seed confirm dialog */}
      {showSeedConfirm && (
        <Dialog open onOpenChange={() => setShowSeedConfirm(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Setup Invoice Workflow</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will create a 5-stage Invoice Approval Workflow for your organization:
            </p>
            <ol className="text-sm list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Finance Review</li>
              <li>Contracts Review</li>
              <li>Operations Review</li>
              <li>GM Approval</li>
              <li>Issued (Terminal)</li>
            </ol>
            <p className="text-xs text-muted-foreground">
              You can assign specific users to each stage and add or remove stages later without any code changes.
            </p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowSeedConfirm(false)}>Cancel</Button>
              <Button onClick={seedInvoice} disabled={seeding}>
                {seeding && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

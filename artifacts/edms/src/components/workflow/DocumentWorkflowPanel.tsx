/**
 * DocumentWorkflowPanel
 *
 * Embeds into the document detail page. Shows:
 * - Active workflow instance (stage progress, advance/reject/return controls)
 * - OR "Start Workflow" if no instance exists and a matching template is found
 * - History of past instances in a collapsed section
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Layers, CheckCircle2, XCircle, AlertCircle, Clock, Loader2,
  ChevronRight, Play, SkipForward, ChevronDown, ChevronUp, GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stage {
  id: number;
  stageOrder: number;
  name: string;
  responsibleRole?: string;
  isTerminal: boolean;
}

interface WfTemplate {
  id: number;
  name: string;
  documentType: string;
  stages: Stage[];
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
  status: string;
  workflowName?: string;
  currentStageName?: string;
  currentStageRole?: string;
  currentStageSla?: number | null;
  currentStageReminderDays?: number | null;
  currentStageResponsibleUserId?: number | null;
  canAct?: boolean;
  stagesTotal: number;
  stagesCurrent: number;
  stageDueAt?: string | null;
  isOverdue?: boolean;
  daysRemaining?: number | null;
  initiatedByName?: string;
  transitions: Transition[];
  createdAt: string;
  updatedAt: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const post = (path: string, body: object) =>
  fetch(`/api${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());

// ─── Status badges ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; icon: any; cls: string }> = {
  active:    { label: "Active",    icon: Clock,        cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  completed: { label: "Completed", icon: CheckCircle2, cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  rejected:  { label: "Rejected",  icon: XCircle,      cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  cancelled: { label: "Cancelled", icon: AlertCircle,  cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
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

function ProgressPips({ current, total, status }: { current: number; total: number; status: string }) {
  const completedColor = status === "completed" ? "bg-green-500" : status === "rejected" ? "bg-red-400" : "bg-blue-500";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 flex-1 min-w-[20px] rounded-full transition-all",
            i < current ? completedColor : "bg-muted",
          )}
        />
      ))}
      <span className="text-xs text-muted-foreground whitespace-nowrap ml-1">{current}/{total}</span>
    </div>
  );
}

// ─── Active Workflow Widget ───────────────────────────────────────────────────

function ActiveWorkflowWidget({
  instance, canAct, onAction, loading,
}: {
  instance: WfInstance;
  canAct: boolean;
  onAction: (action: "advance" | "reject", comment: string, rejectAction?: string) => void;
  loading: boolean;
}) {
  const [comment, setComment] = useState("");
  const [rejectType, setRejectType] = useState("rejected");
  const [showHistory, setShowHistory] = useState(false);

  const ACTION_LABELS: Record<string, string> = {
    started: "Started", advanced: "Advanced to", completed: "Completed",
    rejected: "Rejected", returned: "Returned to", cancelled: "Cancelled",
  };

  return (
    <div className="space-y-4">
      {/* Status + workflow name */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            {instance.workflowName}
          </div>
          <StatusBadge status={instance.status} />
        </div>
        {instance.initiatedByName && (
          <div className="text-xs text-muted-foreground">
            Started by <strong>{instance.initiatedByName}</strong>
            <br />{format(new Date(instance.createdAt), "dd MMM yyyy")}
          </div>
        )}
      </div>

      {/* Stage progress */}
      <ProgressPips current={instance.stagesCurrent} total={instance.stagesTotal} status={instance.status} />

      {/* Current stage highlight */}
      {instance.status === "active" && instance.currentStageName && (
        <div className={cn(
          "rounded-lg border p-3",
          instance.isOverdue
            ? "border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800"
            : "border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800",
        )}>
          <div className={cn(
            "text-xs font-medium uppercase tracking-wide mb-0.5",
            instance.isOverdue ? "text-red-500 dark:text-red-400" : "text-blue-500 dark:text-blue-400",
          )}>
            Current Stage
          </div>
          <div className={cn(
            "font-semibold",
            instance.isOverdue ? "text-red-900 dark:text-red-200" : "text-blue-900 dark:text-blue-200",
          )}>
            {instance.currentStageName}
          </div>
          {instance.currentStageRole && (
            <div className={cn(
              "text-sm mt-0.5",
              instance.isOverdue ? "text-red-700 dark:text-red-300" : "text-blue-700 dark:text-blue-300",
            )}>
              Responsible: {instance.currentStageRole}
            </div>
          )}
          {/* SLA due date */}
          {instance.stageDueAt && (
            <div className={cn(
              "text-xs mt-1.5 flex items-center gap-1",
              instance.isOverdue
                ? "text-red-700 dark:text-red-300 font-semibold"
                : instance.daysRemaining !== null && instance.daysRemaining <= 2
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-blue-600 dark:text-blue-400",
            )}>
              <Clock className="h-3 w-3 shrink-0" />
              {instance.isOverdue
                ? `SLA overdue by ${Math.abs(instance.daysRemaining ?? 0)} day${Math.abs(instance.daysRemaining ?? 0) !== 1 ? "s" : ""}`
                : `Due ${format(new Date(instance.stageDueAt), "dd MMM yyyy")}${instance.daysRemaining !== null ? ` (${instance.daysRemaining}d remaining)` : ""}`
              }
            </div>
          )}
        </div>
      )}

      {instance.status === "completed" && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 p-3 flex items-center gap-2 text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium text-sm">Workflow completed</div>
            <div className="text-xs opacity-75">Document status has been updated automatically</div>
          </div>
        </div>
      )}

      {/* Action controls */}
      {canAct && instance.status === "active" && (
        <div className="space-y-2.5 border-t pt-3">
          <div>
            <Label className="text-xs text-muted-foreground">Comment (optional)</Label>
            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add a note..."
              className="mt-1 h-16 text-sm resize-none"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onAction("advance", comment)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <SkipForward className="h-3.5 w-3.5 mr-1.5" />}
              Advance
            </Button>
            <Select value={rejectType} onValueChange={setRejectType}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rejected">Reject</SelectItem>
                <SelectItem value="returned">Return</SelectItem>
                <SelectItem value="cancelled">Cancel</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onAction("reject", comment, rejectType)}
              disabled={loading}
            >
              {rejectType === "returned" ? "Return" : rejectType === "cancelled" ? "Cancel" : "Reject"}
            </Button>
          </div>
        </div>
      )}

      {/* History */}
      <Collapsible open={showHistory} onOpenChange={setShowHistory}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between h-7 text-xs text-muted-foreground">
            History ({instance.transitions.length} entries)
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 mt-2">
            {instance.transitions.map((t, i) => (
              <div key={t.id} className="flex gap-2.5 text-xs">
                <div className="flex flex-col items-center shrink-0 pt-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {i < instance.transitions.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-0.5" />
                  )}
                </div>
                <div className="pb-2.5">
                  <span className="font-medium">{ACTION_LABELS[t.action] ?? t.action}</span>
                  {t.toStageName && (
                    <span className="text-primary ml-1 font-medium">{t.toStageName}</span>
                  )}
                  <div className="text-muted-foreground">
                    {t.actorName} · {format(new Date(t.createdAt), "dd MMM yyyy HH:mm")}
                  </div>
                  {t.comment && (
                    <div className="italic text-muted-foreground mt-0.5">"{t.comment}"</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ─── Start Workflow Widget ────────────────────────────────────────────────────

function StartWorkflowWidget({
  documentId, documentType, onStarted,
}: {
  documentId: number;
  documentType: string;
  onStarted: () => void;
}) {
  const { toast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["wf-templates-for-type", documentType],
    queryFn: async () => {
      const r = await fetch(`/api/workflow-engine/templates/for-type/${encodeURIComponent(documentType)}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load templates");
      return r.json() as Promise<{ templates: WfTemplate[] }>;
    },
    enabled: !!documentType,
    staleTime: 60_000,
  });

  const templates = data?.templates ?? [];
  const activeTemplate = templates.find(t => t.id === (selectedTemplateId ?? templates[0]?.id));

  const handleStart = async () => {
    const templateId = selectedTemplateId ?? templates[0]?.id;
    if (!templateId) return;
    setStarting(true);
    try {
      const res = await post("/workflow-engine/instances", { documentId, templateId });
      if (res.error) throw new Error(res.error);
      toast({ title: "Workflow started", description: `Entered stage: ${res.currentStageName}` });
      onStarted();
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to start workflow", variant: "destructive" });
    } finally { setStarting(false); }
  };

  if (isLoading) return (
    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Checking available workflows...
    </div>
  );

  if (!templates.length) return (
    <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
      <GitBranch className="h-8 w-8 mx-auto text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        No workflow template is configured for <strong>{documentType}</strong> documents.
      </p>
      <p className="text-xs text-muted-foreground">
        An admin can set one up on the{" "}
        <a href="/workflow-engine" className="text-primary hover:underline">Workflow Engine</a> page.
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Template selector */}
      {templates.length > 1 && (
        <div>
          <Label className="text-xs text-muted-foreground">Select workflow</Label>
          <Select
            value={String(selectedTemplateId ?? templates[0].id)}
            onValueChange={v => setSelectedTemplateId(Number(v))}
          >
            <SelectTrigger className="mt-1 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map(t => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Stage preview */}
      {activeTemplate && (
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
          <div className="text-muted-foreground font-medium mb-1.5">{activeTemplate.name}</div>
          <div className="flex flex-wrap items-center gap-1">
            {activeTemplate.stages.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50" />}
                <span className={cn(
                  "px-1.5 py-0.5 rounded",
                  s.isTerminal
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                    : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
                )}>
                  {s.name}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <Button
        className="w-full"
        size="sm"
        onClick={handleStart}
        disabled={starting || !templates.length}
      >
        {starting
          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          : <Play className="h-3.5 w-3.5 mr-1.5" />}
        Start Approval Workflow
      </Button>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function DocumentWorkflowPanel({
  documentId,
  documentType,
}: {
  documentId: number;
  documentType?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState(false);

  // Whether the user may start a new workflow cycle (separate from per-instance advance/reject permission)
  const canManageWorkflow = ["admin", "project_manager", "document_controller", "system_owner"].includes(user?.role ?? "");

  const key = ["wf-instances-doc", documentId];

  const { data, isLoading, refetch } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/workflow-engine/instances/for-document/${documentId}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load workflow");
      return r.json() as Promise<{ instances: WfInstance[] }>;
    },
    staleTime: 10_000,
  });

  const instances = data?.instances ?? [];
  const activeInstance = instances.find(i => i.status === "active");
  const latestCompleted = instances.find(i => i.status !== "active");

  const handleAction = async (action: "advance" | "reject", comment: string, rejectAction?: string) => {
    if (!activeInstance) return;
    setActionLoading(true);
    try {
      const path = `/workflow-engine/instances/${activeInstance.id}/${action}`;
      const body = action === "reject" ? { comment, action: rejectAction } : { comment };
      const res = await post(path, body);
      if (res.error) throw new Error(res.error);
      await refetch();
      // Also invalidate the document query so status badge refreshes
      queryClient.invalidateQueries({ queryKey: ["document-detail"] });
      const msg = action === "advance"
        ? res.status === "completed" ? "Workflow completed — document approved" : `Advanced to: ${res.currentStageName}`
        : `Action taken: ${rejectAction ?? "rejected"}`;
      toast({ title: msg });
    } catch (e: any) {
      toast({ title: e.message ?? "Action failed", variant: "destructive" });
    } finally { setActionLoading(false); }
  };

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 px-6 py-4 border-b">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Approval Workflow</h2>
        {activeInstance && <StatusBadge status={activeInstance.status} />}
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workflow...
          </div>
        ) : activeInstance ? (
          <ActiveWorkflowWidget
            instance={activeInstance}
            canAct={activeInstance.canAct ?? false}
            onAction={handleAction}
            loading={actionLoading}
          />
        ) : latestCompleted ? (
          <div className="space-y-3">
            <ActiveWorkflowWidget
              instance={latestCompleted}
              canAct={false}
              onAction={handleAction}
              loading={false}
            />
            {canManageWorkflow && documentType && (
              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground mb-3">Start a new workflow cycle for this document:</p>
                <StartWorkflowWidget
                  documentId={documentId}
                  documentType={documentType}
                  onStarted={refetch}
                />
              </div>
            )}
          </div>
        ) : (
          canManageWorkflow && documentType ? (
            <StartWorkflowWidget
              documentId={documentId}
              documentType={documentType}
              onStarted={refetch}
            />
          ) : (
            <p className="text-sm text-muted-foreground py-2">No workflow has been started for this document.</p>
          )
        )}
      </div>
    </div>
  );
}

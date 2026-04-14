/**
 * Submission Chains Tab — Phase 3 UI
 *
 * Self-contained tab component for /projects/:id → "Submission Chains" tab.
 * Renders a register list and a side-sheet detail view.
 *
 * Layout decisions (per user review):
 *  - Tab label: "Submission Chains"
 *  - Detail: Sheet (slide-in), structured so it can graduate to full-page
 *  - Actions: top of detail sheet (not just footer)
 *  - Documents: clicking a row calls onOpenDocument(documentId)
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import {
  ArrowRight, ArrowLeft, ChevronRight, Plus, Loader2, X,
  Clock, Building2, FileText, RotateCcw, CheckCircle2,
  AlertTriangle, Hourglass, Send, Lock, GitMerge, Layers,
  Trash2, ExternalLink, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChainSummary {
  id: number;
  chainNumber: string;
  title: string;
  description?: string | null;
  projectId: number;
  originatingOrgId: number;
  originatingOrgName: string;
  currentOrgId: number;
  currentOrgName: string;
  currentStatus: string;
  activeRevisionCycle: number;
  currentStepStartedAt: string;
  autoClosedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName?: string | null;
  documentCount: number;
  stepCount: number;
}

interface AllowedParty {
  id: number;
  orgId: number;
  stepOrder: number;
  label?: string | null;
  orgName?: string | null;
}

interface ChainStep {
  id: number;
  stepNumber: number;
  revisionCycle: number;
  action: "forward" | "return";
  fromOrgId: number;
  toOrgId: number;
  fromOrgName?: string;
  toOrgName?: string;
  stepStatus: string;
  reviewCode?: string | null;
  comments?: string | null;
  reviewedAt?: string | null;
  transmittalId?: number | null;
  createdAt: string;
  actionedByName?: string | null;
  reviewedByName?: string | null;
}

interface ChainDocument {
  id: number;
  documentId: number;
  revisionId: number;
  revisionCycle: number;
  addedAt: string;
  documentNumber?: string | null;
  documentTitle?: string | null;
  documentType?: string | null;
  discipline?: string | null;
  revision?: string | null;
  revisionStatus?: string | null;
  fileName?: string | null;
}

interface ChainDetail extends ChainSummary {
  parties: AllowedParty[];
  steps: ChainStep[];
  documents: ChainDocument[];
}

interface OrgOption {
  id: number;
  name: string;
}

// ─── Status + review code utilities ──────────────────────────────────────────

const CHAIN_STATUS: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft:                   { label: "Draft",                  color: "bg-gray-100 text-gray-600 border-gray-200",               icon: FileText },
  active:                  { label: "Active",                 color: "bg-blue-100 text-blue-700 border-blue-200",               icon: Send },
  returned:                { label: "Returned",               color: "bg-amber-100 text-amber-700 border-amber-200",            icon: RotateCcw },
  approved:                { label: "Approved",               color: "bg-green-100 text-green-700 border-green-200",            icon: CheckCircle2 },
  approved_with_comments:  { label: "Approved w/ Comments",   color: "bg-teal-100 text-teal-700 border-teal-200",              icon: CheckCircle2 },
  closed:                  { label: "Closed",                 color: "bg-gray-100 text-gray-400 border-gray-200",               icon: Lock },
};

const REVIEW_CODE: Record<string, { label: string; color: string; description: string }> = {
  A: { label: "A", color: "bg-green-100 text-green-700 border-green-300",  description: "Approved" },
  B: { label: "B", color: "bg-teal-100 text-teal-700 border-teal-300",    description: "Approved with Comments" },
  C: { label: "C", color: "bg-amber-100 text-amber-700 border-amber-300", description: "Revise & Resubmit" },
  D: { label: "D", color: "bg-red-100 text-red-700 border-red-300",       description: "Rejected" },
};

function ChainStatusBadge({ status }: { status: string }) {
  const cfg = CHAIN_STATUS[status];
  if (!cfg) return <span className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</span>;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border", cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function ReviewCodeBadge({ code }: { code?: string | null }) {
  if (!code) return <span className="text-xs text-muted-foreground italic">No code</span>;
  const cfg = REVIEW_CODE[code];
  if (!cfg) return <span className="text-xs font-mono">{code}</span>;
  return (
    <span
      className={cn("inline-flex items-center px-2 py-0.5 rounded border text-xs font-bold", cfg.color)}
      title={cfg.description}
    >
      {cfg.label}
    </span>
  );
}

function AgeIndicator({ since }: { since: string }) {
  const age = formatDistanceToNowStrict(parseISO(since), { addSuffix: false });
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3 w-3 shrink-0" />
      {age}
    </span>
  );
}

// ─── Step Timeline ────────────────────────────────────────────────────────────

function StepTimeline({ steps }: { steps: ChainStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No movement steps yet. Activate the chain to begin.
      </div>
    );
  }

  let renderedCycle = -1;

  return (
    <div className="space-y-0">
      {steps.map((step, idx) => {
        const showCycleDivider = step.revisionCycle !== renderedCycle;
        if (showCycleDivider) renderedCycle = step.revisionCycle;

        const isForward = step.action === "forward";

        return (
          <div key={step.id}>
            {/* Cycle divider */}
            {showCycleDivider && (
              <div className="flex items-center gap-3 my-3 first:mt-0">
                <div className="h-px flex-1 bg-muted" />
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  <Layers className="h-3 w-3" />
                  Revision Cycle {step.revisionCycle}
                </span>
                <div className="h-px flex-1 bg-muted" />
              </div>
            )}

            {/* Step row */}
            <div className="flex gap-3 group">
              {/* Icon + connector */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={cn(
                    "flex items-center justify-center w-7 h-7 rounded-full border-2 shrink-0 mt-0.5",
                    isForward
                      ? "bg-blue-50 border-blue-300 text-blue-600"
                      : "bg-amber-50 border-amber-300 text-amber-600",
                  )}
                >
                  {isForward
                    ? <ArrowRight className="h-3.5 w-3.5" />
                    : <ArrowLeft className="h-3.5 w-3.5" />
                  }
                </div>
                {idx < steps.length - 1 && (
                  <div className="w-px flex-1 my-1 bg-muted-foreground/20 min-h-[24px]" />
                )}
              </div>

              {/* Content */}
              <div className="pb-4 flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium leading-snug">
                      <span className="text-muted-foreground">Step {step.stepNumber} — </span>
                      <span>{isForward ? "Forwarded" : "Returned"}</span>
                      {" from "}
                      <span className="font-semibold">{step.fromOrgName ?? `Org #${step.fromOrgId}`}</span>
                      {" to "}
                      <span className="font-semibold">{step.toOrgName ?? `Org #${step.toOrgId}`}</span>
                    </p>
                    {step.reviewCode && (
                      <div className="flex items-center gap-1.5">
                        <ReviewCodeBadge code={step.reviewCode} />
                        <span className="text-xs text-muted-foreground">
                          {REVIEW_CODE[step.reviewCode]?.description ?? ""}
                        </span>
                      </div>
                    )}
                    {!step.reviewCode && (
                      <span className="text-xs text-muted-foreground italic">Forwarded without formal review</span>
                    )}
                    {step.comments && (
                      <p className="text-xs text-foreground/80 bg-muted/50 rounded px-2 py-1 mt-1 whitespace-pre-line border border-muted">
                        {step.comments}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">
                      {step.actionedByName ?? "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {format(parseISO(step.createdAt), "dd MMM yyyy, HH:mm")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Party breadcrumb ─────────────────────────────────────────────────────────

function PartyBreadcrumb({
  parties,
  currentOrgId,
}: {
  parties: AllowedParty[];
  currentOrgId: number;
}) {
  if (parties.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-0.5 text-xs">
      {parties.map((p, idx) => {
        const isCurrent = p.orgId === currentOrgId;
        return (
          <span key={p.id} className="flex items-center gap-0.5">
            {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
            <span
              className={cn(
                "px-2 py-0.5 rounded",
                isCurrent
                  ? "bg-blue-100 text-blue-700 font-semibold border border-blue-200"
                  : "text-muted-foreground",
              )}
            >
              {p.orgName ?? `Org #${p.orgId}`}
              {p.label ? ` (${p.label})` : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ─── Action panel ─────────────────────────────────────────────────────────────

type ActionMode = "activate" | "forward" | "return" | "resubmit" | "close" | null;

interface ActionPanelProps {
  chain: ChainDetail;
  userOrgId?: number | null;
  isAtLeastPM: boolean;
  onAction: (mode: ActionMode) => void;
  isMutating: boolean;
}

function ActionPanel({ chain, userOrgId, isAtLeastPM, onAction, isMutating }: ActionPanelProps) {
  const isCurrentHolder = !userOrgId || userOrgId === chain.currentOrgId;
  const isOriginator    = !userOrgId || userOrgId === chain.originatingOrgId;
  const { currentStatus } = chain;

  // Determine what to show
  const canActivate   = currentStatus === "draft"     && isOriginator && isAtLeastPM;
  const canForward    = ["active", "returned"].includes(currentStatus) && isCurrentHolder;
  const canReturn     = currentStatus === "active"    && isCurrentHolder;
  const canResubmit   = currentStatus === "returned"  && isOriginator;
  const canClose      = !["draft", "closed"].includes(currentStatus) && isAtLeastPM;

  const isWaiting = !canActivate && !canForward && !canReturn && !canResubmit && !canClose;
  const isTerminal = ["approved", "approved_with_comments", "closed"].includes(currentStatus);

  if (isTerminal && !canClose) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 border px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        <span className="text-sm">
          This submission chain has reached its final state:{" "}
          <span className="font-medium">{CHAIN_STATUS[currentStatus]?.label ?? currentStatus}</span>.
        </span>
      </div>
    );
  }

  if (isWaiting) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3">
        <Hourglass className="h-4 w-4 text-amber-600 shrink-0" />
        <span className="text-sm text-amber-900 dark:text-amber-300">
          Waiting for{" "}
          <span className="font-semibold">{chain.currentOrgName}</span>{" "}
          to act.{" "}
          <AgeIndicator since={chain.currentStepStartedAt} />
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 border px-4 py-3 flex-wrap">
      <span className="text-sm text-muted-foreground mr-1">Your actions:</span>

      {canActivate && (
        <Button size="sm" onClick={() => onAction("activate")} disabled={isMutating}>
          <Send className="h-3.5 w-3.5 mr-1.5" /> Activate Chain
        </Button>
      )}
      {canForward && (
        <Button size="sm" onClick={() => onAction("forward")} disabled={isMutating}>
          <ArrowRight className="h-3.5 w-3.5 mr-1.5" /> Forward
        </Button>
      )}
      {canReturn && (
        <Button size="sm" variant="outline" onClick={() => onAction("return")} disabled={isMutating}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Return
        </Button>
      )}
      {canResubmit && (
        <Button size="sm" onClick={() => onAction("resubmit")} disabled={isMutating}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Resubmit
        </Button>
      )}
      {canClose && (
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onAction("close")} disabled={isMutating}>
          <X className="h-3.5 w-3.5 mr-1.5" /> Close Chain
        </Button>
      )}
    </div>
  );
}

// ─── Action Dialog ────────────────────────────────────────────────────────────

interface ActionDialogProps {
  mode: ActionMode;
  chain: ChainDetail;
  onClose: () => void;
  onSuccess: () => void;
  projectId: number;
}

function ActionDialog({ mode, chain, onClose, onSuccess, projectId }: ActionDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reviewCode, setReviewCode] = useState<string>("_none");
  const [comments, setComments] = useState("");
  const [closeReason, setCloseReason] = useState("");

  const endpointMap: Record<NonNullable<ActionMode>, string> = {
    activate:  `/api/projects/${projectId}/submission-chains/${chain.id}/activate`,
    forward:   `/api/projects/${projectId}/submission-chains/${chain.id}/forward`,
    return:    `/api/projects/${projectId}/submission-chains/${chain.id}/return`,
    resubmit:  `/api/projects/${projectId}/submission-chains/${chain.id}/resubmit`,
    close:     `/api/projects/${projectId}/submission-chains/${chain.id}/close`,
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!mode) return;
      const body: Record<string, unknown> = {};
      if (mode === "forward" || mode === "return") {
        if (reviewCode !== "_none") body.reviewCode = reviewCode;
        if (comments.trim()) body.comments = comments.trim();
      }
      if (mode === "resubmit" && comments.trim()) body.comments = comments.trim();
      if (mode === "close" && closeReason.trim()) body.reason = closeReason.trim();

      const r = await fetch(endpointMap[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${r.status})`);
      }
      return r.json();
    },
    onSuccess: () => {
      const labels: Record<NonNullable<ActionMode>, string> = {
        activate: "Chain activated",
        forward:  "Forwarded successfully",
        return:   "Returned successfully",
        resubmit: "Resubmitted — cycle advanced",
        close:    "Chain closed",
      };
      toast({ title: labels[mode!] });
      queryClient.invalidateQueries({ queryKey: ["submission-chains", projectId] });
      queryClient.invalidateQueries({ queryKey: ["submission-chain", chain.id] });
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    },
  });

  if (!mode) return null;

  const returnRequiresComments = mode === "return" && !comments.trim();
  const activateRequiresDocs = mode === "activate" &&
    chain.documents.filter(d => d.revisionCycle === chain.activeRevisionCycle).length === 0;
  const canSubmit = !mutation.isPending &&
    (mode !== "return" || !!comments.trim()) &&
    !activateRequiresDocs;

  const titles: Record<NonNullable<ActionMode>, string> = {
    activate: "Activate Submission Chain",
    forward:  "Forward Submission",
    return:   "Return Submission",
    resubmit: "Resubmit",
    close:    "Close Chain",
  };

  const descriptions: Record<NonNullable<ActionMode>, string> = {
    activate: `Activate "${chain.chainNumber}" to begin the submission workflow. The chain will be set to active and documents will be locked for this revision cycle.`,
    forward:  "Forward the submission to the next party in the chain. Optionally assign a review code.",
    return:   "Return the submission to the previous party. A reason is required.",
    resubmit: `Resubmit to the chain's recipients. The revision cycle will advance from ${chain.activeRevisionCycle} to ${chain.activeRevisionCycle + 1}.`,
    close:    "Manually close this submission chain. This action cannot be undone.",
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[mode]}</DialogTitle>
          <p className="text-sm text-muted-foreground pt-1">{descriptions[mode]}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {(mode === "forward" || mode === "return") && (
            <>
              {/* Review code */}
              <div>
                <Label>
                  Review Code
                  {mode === "return" ? (
                    <span className="ml-1.5 text-xs text-muted-foreground font-normal">(optional)</span>
                  ) : (
                    <span className="ml-1.5 text-xs text-muted-foreground font-normal">(optional)</span>
                  )}
                </Label>
                <Select value={reviewCode} onValueChange={setReviewCode}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="No review code" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">No review code (forward without formal review)</SelectItem>
                    <SelectItem value="A">A — Approved</SelectItem>
                    <SelectItem value="B">B — Approved with Comments</SelectItem>
                    <SelectItem value="C">C — Revise &amp; Resubmit</SelectItem>
                    <SelectItem value="D">D — Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Comments */}
              <div>
                <Label>
                  Comments
                  {mode === "return" && <span className="text-destructive ml-1">*</span>}
                  {mode === "forward" && <span className="ml-1.5 text-xs text-muted-foreground font-normal">(optional)</span>}
                </Label>
                <Textarea
                  className={cn("mt-1", returnRequiresComments && "border-amber-300 focus-visible:ring-amber-400")}
                  rows={3}
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                  placeholder={mode === "return" ? "Required: explain the reason for return…" : "Add any notes or comments…"}
                />
                {returnRequiresComments && (
                  <p className="text-xs text-destructive mt-1">A reason is required when returning.</p>
                )}
              </div>
            </>
          )}

          {mode === "resubmit" && (
            <div>
              <Label>
                Notes <span className="ml-1.5 text-xs text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                className="mt-1"
                rows={3}
                value={comments}
                onChange={e => setComments(e.target.value)}
                placeholder="Describe the corrections made…"
              />
            </div>
          )}

          {mode === "close" && (
            <div>
              <Label>
                Reason <span className="ml-1.5 text-xs text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={closeReason}
                onChange={e => setCloseReason(e.target.value)}
                placeholder="Reason for manual closure…"
              />
            </div>
          )}

          {mode === "activate" && (
            activateRequiresDocs ? (
              <div className="rounded-md bg-amber-50 border border-amber-300 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                <span>
                  <span className="font-medium block mb-0.5">No documents attached</span>
                  At least one document must be linked to this chain before it can be activated. Close this dialog and use the Documents tab to add documents.
                </span>
              </div>
            ) : (
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
                {chain.documents.filter(d => d.revisionCycle === chain.activeRevisionCycle).length} document{chain.documents.filter(d => d.revisionCycle === chain.activeRevisionCycle).length !== 1 ? "s" : ""} and {chain.parties.length} parties will be locked for this revision cycle.
              </div>
            )
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            variant={mode === "close" ? "destructive" : "default"}
          >
            {mutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Working…</> : titles[mode]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Chain Dialog ──────────────────────────────────────────────────────

interface PartyRow {
  orgId: string;
  label: string;
}

function CreateChainDialog({
  projectId,
  onClose,
  onSuccess,
}: {
  projectId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parties, setParties] = useState<PartyRow[]>([
    { orgId: "", label: "" },
    { orgId: "", label: "" },
  ]);

  const { data: orgs = [] } = useQuery<OrgOption[]>({
    queryKey: ["organizations-list"],
    queryFn: async () => {
      const r = await fetch("/api/organizations");
      if (!r.ok) return [];
      const data = await r.json();
      // API returns { organizations: [...] } — extract the array safely
      return Array.isArray(data) ? data : (data.organizations ?? []);
    },
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const validParties = parties.filter(p => p.orgId);
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        allowedParties: validParties.map((p, i) => ({
          orgId: parseInt(p.orgId),
          stepOrder: i + 1,
          label: p.label.trim() || undefined,
        })),
      };
      const r = await fetch(`/api/projects/${projectId}/submission-chains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create chain");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Submission chain created" });
      queryClient.invalidateQueries({ queryKey: ["submission-chains", projectId] });
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create chain", description: err.message, variant: "destructive" });
    },
  });

  const addParty = () => setParties(p => [...p, { orgId: "", label: "" }]);
  const removeParty = (i: number) => setParties(p => p.filter((_, idx) => idx !== i));
  const updateParty = (i: number, field: keyof PartyRow, value: string) =>
    setParties(p => p.map((row, idx) => idx === i ? { ...row, [field]: value } : row));

  const validParties = parties.filter(p => p.orgId);
  const canCreate = title.trim() && validParties.length >= 2;

  const ROLE_LABELS = ["Originator", "Main Contractor", "Sub-Contractor", "Consultant", "Employer / Owner", "Authority", "Other"];

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Submission Chain</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Define the chain title, description, and the ordered list of participating organisations.
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Title */}
          <div>
            <Label>Title <span className="text-destructive">*</span></Label>
            <Input
              className="mt-1"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Structural Drawings — Package 1"
            />
          </div>

          {/* Description */}
          <div>
            <Label>Description <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this submission package…"
            />
          </div>

          <Separator />

          {/* Allowed parties */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <Label className="text-sm font-semibold">Participating Organisations</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Order determines the forward chain. Step 1 = originator.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addParty}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Party
              </Button>
            </div>

            <div className="space-y-2">
              {parties.map((row, i) => (
                <div key={i} className="flex gap-2 items-start">
                  {/* Step badge */}
                  <div className="flex items-center justify-center w-7 h-9 text-xs font-mono text-muted-foreground shrink-0">
                    {i + 1}
                  </div>

                  {/* Org picker */}
                  <Select value={row.orgId || "_none"} onValueChange={v => updateParty(i, "orgId", v === "_none" ? "" : v)}>
                    <SelectTrigger className="flex-1 h-9">
                      <SelectValue placeholder="Select organisation…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none" disabled>Select organisation…</SelectItem>
                      {orgs.map(o => (
                        <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Role label */}
                  <Select value={row.label || "_none"} onValueChange={v => updateParty(i, "label", v === "_none" ? "" : v)}>
                    <SelectTrigger className="w-[140px] h-9">
                      <SelectValue placeholder="Role…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No label</SelectItem>
                      {ROLE_LABELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {/* Remove — can't remove first two */}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={parties.length <= 2}
                    onClick={() => removeParty(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {validParties.length < 2 && (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                At least 2 organisations are required (originator + one recipient).
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canCreate || mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating…</> : "Create Chain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Chain Detail Sheet ───────────────────────────────────────────────────────

function ChainDetailSheet({
  chainId,
  projectId,
  userOrgId,
  isAtLeastPM,
  onClose,
  onOpenDocument,
}: {
  chainId: number;
  projectId: number;
  userOrgId?: number | null;
  isAtLeastPM: boolean;
  onClose: () => void;
  onOpenDocument: (documentId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [actionMode, setActionMode] = useState<ActionMode>(null);

  const { data: chain, isLoading, error } = useQuery<ChainDetail>({
    queryKey: ["submission-chain", chainId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/submission-chains/${chainId}`);
      if (!r.ok) throw new Error("Failed to load chain");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const activeDocs = useMemo(
    () => chain?.documents.filter(d => d.revisionCycle === chain.activeRevisionCycle) ?? [],
    [chain],
  );

  const isMutating = false; // handled inside ActionDialog

  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0"
      >
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full text-sm text-destructive">
            Failed to load chain detail.
          </div>
        )}

        {chain && (
          <>
            {/* Header */}
            <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{chain.chainNumber}</span>
                    <ChainStatusBadge status={chain.currentStatus} />
                    {chain.activeRevisionCycle > 1 && (
                      <span className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">
                        <Layers className="h-3 w-3" />
                        Cycle {chain.activeRevisionCycle}
                      </span>
                    )}
                  </div>
                  <SheetTitle className="text-lg leading-snug">{chain.title}</SheetTitle>
                  {chain.description && (
                    <p className="text-sm text-muted-foreground">{chain.description}</p>
                  )}
                </div>
              </div>

              {/* Org breadcrumb */}
              <div className="mt-3">
                <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wide font-medium">Submission path</p>
                <PartyBreadcrumb parties={chain.parties} currentOrgId={chain.currentOrgId} />
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  Originator: <span className="font-medium text-foreground ml-1">{chain.originatingOrgName}</span>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  At current holder for <span className="font-medium text-foreground ml-1"><AgeIndicator since={chain.currentStepStartedAt} /></span>
                </span>
              </div>
            </SheetHeader>

            {/* Action Panel — top of content, before documents */}
            <div className="px-6 pt-4 shrink-0">
              <ActionPanel
                chain={chain}
                userOrgId={userOrgId}
                isAtLeastPM={isAtLeastPM}
                onAction={setActionMode}
                isMutating={isMutating}
              />
            </div>

            {/* Documents section */}
            <div className="px-6 pt-5 shrink-0">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Documents — Cycle {chain.activeRevisionCycle}
                <span className="ml-auto text-xs font-normal text-muted-foreground">{activeDocs.length} document{activeDocs.length !== 1 ? "s" : ""}</span>
              </h3>

              {activeDocs.length === 0 ? (
                chain.currentStatus === "draft" ? (
                  <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-5 flex flex-col items-center text-center gap-3">
                    <div className="rounded-full bg-amber-100 p-2.5">
                      <FileText className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-amber-900">No documents attached yet</p>
                      <p className="text-xs text-amber-700 mt-1 leading-relaxed max-w-xs">
                        At least one document must be added before this chain can be activated. Go to the Documents tab, open a document, and link it to this chain.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-400 text-amber-800 hover:bg-amber-100 gap-1.5"
                      onClick={() => onOpenDocument(0)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Go to Documents tab
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic py-2">No documents added to this cycle yet.</p>
                )
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 border-b">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Doc #</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Title</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Rev</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="w-8 px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDocs.map(doc => (
                        <tr
                          key={doc.id}
                          className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => onOpenDocument(doc.documentId)}
                        >
                          <td className="px-3 py-2 font-mono text-primary">{doc.documentNumber ?? "—"}</td>
                          <td className="px-3 py-2 truncate max-w-[200px]" title={doc.documentTitle ?? undefined}>{doc.documentTitle ?? "—"}</td>
                          <td className="px-3 py-2 font-mono">{doc.revision ?? "—"}</td>
                          <td className="px-3 py-2 capitalize">{doc.revisionStatus?.replace(/_/g, " ") ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <ExternalLink className="h-3 w-3" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <Separator className="mx-6 my-5" />

            {/* Step timeline */}
            <div className="px-6 pb-8 flex-1">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-muted-foreground" />
                Movement History
                <span className="ml-auto text-xs font-normal text-muted-foreground">{chain.steps.length} step{chain.steps.length !== 1 ? "s" : ""}</span>
              </h3>
              <StepTimeline steps={chain.steps} />
            </div>
          </>
        )}
      </SheetContent>

      {/* Action dialog rendered outside the sheet so it stacks correctly */}
      {actionMode && chain && (
        <ActionDialog
          mode={actionMode}
          chain={chain}
          projectId={projectId}
          onClose={() => setActionMode(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["submission-chain", chainId] });
          }}
        />
      )}
    </Sheet>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

interface SubmissionChainsTabProps {
  projectId: number;
  /** Called when user clicks a document row — parent should open that document's detail */
  onOpenDocument: (documentId: number) => void;
  /** Whether the current user has PM+ effective role */
  isAtLeastPM: boolean;
}

export function SubmissionChainsTab({ projectId, onOpenDocument, isAtLeastPM }: SubmissionChainsTabProps) {
  const { user } = useAuth();
  const userOrgId = (user as any)?.organizationId ?? null;

  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("_all");
  const [search, setSearch] = useState("");

  const { data: chains = [], isLoading } = useQuery<ChainSummary[]>({
    queryKey: ["submission-chains", projectId, statusFilter],
    queryFn: async () => {
      const params = statusFilter !== "_all" ? `?status=${statusFilter}` : "";
      const r = await fetch(`/api/projects/${projectId}/submission-chains${params}`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return chains;
    const q = search.toLowerCase();
    return chains.filter(c =>
      c.chainNumber.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.currentOrgName?.toLowerCase().includes(q) ||
      c.originatingOrgName?.toLowerCase().includes(q),
    );
  }, [chains, search]);

  const statuses = ["draft", "active", "returned", "approved", "approved_with_comments", "closed"];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search chains…"
          className="h-9 w-[220px]"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All statuses</SelectItem>
            {statuses.map(s => (
              <SelectItem key={s} value={s}>
                {CHAIN_STATUS[s]?.label ?? s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isAtLeastPM && (
          <Button size="sm" className="ml-auto" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Submission Chain
          </Button>
        )}
      </div>

      {/* Register table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <GitMerge className="mx-auto h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">No submission chains found</p>
          {isAtLeastPM && (
            <p className="text-xs mt-1">
              Create one using the{" "}
              <button
                className="underline text-primary"
                onClick={() => setShowCreate(true)}
              >
                New Submission Chain
              </button>{" "}
              button.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[140px]">Chain #</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current Holder</TableHead>
                <TableHead className="w-[120px]">
                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Age</span>
                </TableHead>
                <TableHead className="w-[60px] text-center">Cycle</TableHead>
                <TableHead className="w-[60px] text-center">Docs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(chain => (
                <TableRow
                  key={chain.id}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setSelectedChainId(chain.id)}
                >
                  <TableCell className="font-mono text-xs text-primary font-medium">
                    {chain.chainNumber}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm truncate max-w-[260px]" title={chain.title}>
                      {chain.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      by {chain.originatingOrgName}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ChainStatusBadge status={chain.currentStatus} />
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {chain.currentOrgName}
                    </span>
                    {chain.currentOrgId === userOrgId && (
                      <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium border border-blue-200">
                        You
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {["closed", "approved", "approved_with_comments"].includes(chain.currentStatus) ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <AgeIndicator since={chain.currentStepStartedAt} />
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {chain.activeRevisionCycle}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {chain.documentCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail sheet */}
      {selectedChainId !== null && (
        <ChainDetailSheet
          chainId={selectedChainId}
          projectId={projectId}
          userOrgId={userOrgId}
          isAtLeastPM={isAtLeastPM}
          onClose={() => setSelectedChainId(null)}
          onOpenDocument={onOpenDocument}
        />
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreateChainDialog
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}

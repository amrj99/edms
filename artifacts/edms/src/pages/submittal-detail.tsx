import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ClipboardList, CheckCircle, RotateCcw, Send, ArrowRight, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { format } from "date-fns";
import { ReviewDialog } from "@/components/submittals/ReviewDialog";
import { ReturnDialog } from "@/components/submittals/ReturnDialog";
import { ResubmitDialog } from "@/components/submittals/ResubmitDialog";
import { ForwardDialog } from "@/components/submittals/ForwardDialog";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChainActions {
  canSetupParties: boolean;
  canReview: boolean;
  canForward: boolean;
  canReturn: boolean;
  canResubmit: boolean;
}

interface ChainParty {
  id: number;
  participantId: number | null;
  stepOrder: number;
  assignmentStrategy: string;
  label: string | null;
}

interface ChainStep {
  id: number;
  action: string;
  reviewCode: string | null;
  comments: string | null;
  createdAt: string;
  revisionCycle: number;
  fromParticipantId: number | null;
  toParticipantId: number | null;
}

interface ChainDocument {
  id: number;
  title: string;
  revision: string | null;
}

interface SubmissionChain {
  id: number;
  chainNumber: string;
  title: string;
  description: string | null;
  type: string;
  currentStatus: string;
  activeRevisionCycle: number;
  createdAt: string;
  currentParticipantId: number | null;
  originatingOrgId: number | null;
  steps: ChainStep[];
  documents: ChainDocument[];
  parties: ChainParty[];
  actions: ChainActions;
}

interface ProjectParticipant {
  id: number;
  role: string;
  entity: { id: number; name: string };
}

// ─── Badge helpers ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft:    "bg-gray-100 text-gray-600 border-gray-200",
  active:   "bg-blue-100 text-blue-700 border-blue-200",
  returned: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  closed:   "bg-slate-100 text-slate-600 border-slate-200",
};

const REVIEW_CODE_COLOR: Record<string, string> = {
  A: "bg-green-100 text-green-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-red-100 text-red-700",
};

const REVIEW_CODE_LABEL: Record<string, string> = {
  A: "A — Approved",
  B: "B — Approved with Comments",
  C: "C — Revise and Resubmit",
  D: "D — Rejected",
};

const ACTION_LABEL: Record<string, string> = {
  submit:    "Submitted",
  forward:   "Forwarded",
  return:    "Returned",
  review:    "Reviewed",
  resubmit:  "Resubmitted",
  setup_parties: "Parties Setup",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function SubmittalDetailPage() {
  const { id: projectIdStr, chainId: chainIdStr } = useParams<{ id: string; chainId: string }>();
  const [, navigate] = useLocation();

  const projectId = Number(projectIdStr);
  const chainId = Number(chainIdStr);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);

  const { data: chain, isLoading: chainLoading, error: chainError } = useQuery<SubmissionChain>({
    queryKey: ["submission-chain", chainId],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${projectId}/submission-chains/${chainId}`);
      if (res.status === 403) throw new Error("Access denied");
      if (res.status === 404) throw new Error("Submittal not found");
      if (!res.ok) throw new Error("Failed to load submittal");
      return res.json();
    },
  });

  const { data: participants = [] } = useQuery<ProjectParticipant[]>({
    queryKey: ["participants", projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${projectId}/participants`);
      return res.json();
    },
    enabled: !!chain,
  });

  if (chainLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (chainError || !chain) {
    return (
      <div className="p-12 text-center">
        <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">
          {chainError?.message ?? "Submittal not found."}
        </p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Project
        </Button>
      </div>
    );
  }

  const { actions, parties, steps, documents } = chain;
  const sortedParties = [...parties].sort((a, b) => a.stepOrder - b.stepOrder);

  function participantName(pid: number | null): string {
    if (pid === null) return "—";
    const p = participants.find((x) => x.id === pid);
    return p ? p.entity.name : `Participant #${pid}`;
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        onClick={() => navigate(`/projects/${projectId}?tab=submittals`)}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Project
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {chain.chainNumber}
            </span>
            <Badge
              variant="outline"
              className={`uppercase text-[10px] ${STATUS_COLOR[chain.currentStatus] ?? ""}`}
            >
              {chain.currentStatus}
            </Badge>
            <span className="text-xs text-muted-foreground capitalize">
              {chain.type} · Rev cycle {chain.activeRevisionCycle}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{chain.title}</h1>
          {chain.description && (
            <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm">{chain.description}</p>
          )}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {actions.canSetupParties && (
            <div className="text-sm text-muted-foreground italic">
              Setup parties via Create Submittal flow
            </div>
          )}
          {actions.canReview && (
            <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
              <CheckCircle className="h-4 w-4 mr-1.5" />
              Review
            </Button>
          )}
          {actions.canReturn && (
            <Button size="sm" variant="outline" onClick={() => setReturnOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Return
            </Button>
          )}
          {actions.canForward && (
            <Button size="sm" onClick={() => setForwardOpen(true)}>
              <Send className="h-4 w-4 mr-1.5" />
              Forward
            </Button>
          )}
          {actions.canResubmit && (
            <Button size="sm" onClick={() => setResubmitOpen(true)}>
              <ArrowRight className="h-4 w-4 mr-1.5" />
              Resubmit
            </Button>
          )}
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex gap-6 items-start">
        {/* Parties sidebar */}
        <div className="w-[240px] flex-shrink-0 rounded-lg border overflow-hidden">
          <div className="bg-muted/40 px-4 py-2.5 border-b flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Party Sequence</span>
          </div>
          {sortedParties.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No parties configured
            </div>
          ) : (
            <div className="divide-y">
              {sortedParties.map((party) => {
                const isCurrent =
                  party.participantId !== null &&
                  party.participantId === chain.currentParticipantId;
                const name = participantName(party.participantId);
                const participant = participants.find((p) => p.id === party.participantId);
                return (
                  <div
                    key={party.id}
                    className={`px-4 py-3 flex items-start gap-3 ${isCurrent ? "bg-primary/5" : ""}`}
                  >
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {party.stepOrder}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm truncate font-medium ${isCurrent ? "text-primary" : ""}`}>
                        {name}
                      </p>
                      {participant && (
                        <p className="text-xs text-muted-foreground capitalize truncate">
                          {participant.role.replace(/_/g, " ")}
                        </p>
                      )}
                      {isCurrent && (
                        <p className="text-xs text-primary font-medium mt-0.5">Current custodian</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Steps Timeline */}
          <div className="rounded-lg border overflow-hidden">
            <div className="bg-muted/40 px-4 py-2.5 border-b">
              <span className="text-sm font-medium">Activity Timeline</span>
            </div>
            {steps.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No activity yet
              </div>
            ) : (
              <div className="divide-y">
                {[...steps]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((step) => (
                    <div key={step.id} className="px-4 py-3 flex items-start gap-4">
                      <div className="pt-0.5 flex-shrink-0 text-muted-foreground">
                        <div className="h-2 w-2 rounded-full bg-current mt-1.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            {ACTION_LABEL[step.action] ?? step.action}
                          </span>
                          {step.reviewCode && (
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                REVIEW_CODE_COLOR[step.reviewCode] ?? ""
                              }`}
                            >
                              {REVIEW_CODE_LABEL[step.reviewCode] ?? step.reviewCode}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            Rev cycle {step.revisionCycle}
                          </span>
                        </div>
                        {step.fromParticipantId !== null && step.toParticipantId !== null && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {participantName(step.fromParticipantId)} →{" "}
                            {participantName(step.toParticipantId)}
                          </p>
                        )}
                        {step.comments && (
                          <p className="text-sm text-muted-foreground mt-1 italic">
                            "{step.comments}"
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex-shrink-0">
                        {format(new Date(step.createdAt), "dd MMM yyyy, HH:mm")}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Documents */}
          {documents.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2.5 border-b">
                <span className="text-sm font-medium">Documents ({documents.length})</span>
              </div>
              <div className="divide-y">
                {documents.map((doc) => (
                  <div key={doc.id} className="px-4 py-3 flex items-center gap-3">
                    <span className="flex-1 text-sm font-medium truncate">{doc.title}</span>
                    {doc.revision && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        Rev {doc.revision}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        projectId={projectId}
        chainId={chainId}
      />
      <ReturnDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        projectId={projectId}
        chainId={chainId}
      />
      <ResubmitDialog
        open={resubmitOpen}
        onClose={() => setResubmitOpen(false)}
        projectId={projectId}
        chainId={chainId}
        nextRevisionCycle={chain.activeRevisionCycle + 1}
      />
      <ForwardDialog
        open={forwardOpen}
        onClose={() => setForwardOpen(false)}
        projectId={projectId}
        chainId={chainId}
        parties={sortedParties}
        currentParticipantId={chain.currentParticipantId}
        participants={participants}
      />
    </div>
  );
}

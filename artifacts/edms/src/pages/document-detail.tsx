import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, FileText, Building2, FolderOpen, User, Calendar,
  Download, ExternalLink, Loader2, Paperclip, Tag, Hash, Globe,
  Brain, History, Info, Archive, Ban, ChevronDown, AlertTriangle, Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DocumentFilesPanel } from "@/components/documents/DocumentFilesPanel";
import { DocumentWorkflowPanel } from "@/components/workflow/DocumentWorkflowPanel";
import { DocumentAiTab } from "@/components/documents/DocumentAiTab";
import { DocumentRevisionsTab } from "@/components/documents/DocumentRevisionsTab";
import { DocumentActivityTab } from "@/components/documents/DocumentActivityTab";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  draft:                "bg-gray-100 text-gray-700",
  under_review:         "bg-yellow-100 text-yellow-800",
  approved:             "bg-green-100 text-green-700",
  approved_with_comments: "bg-emerald-100 text-emerald-700",
  for_revision:         "bg-orange-100 text-orange-800",
  rejected:             "bg-red-100 text-red-700",
  issued:               "bg-blue-100 text-blue-700",
  superseded:           "bg-purple-100 text-purple-700",
  void:                 "bg-red-100 text-red-700",
  archived:             "bg-slate-200 text-slate-600",
  obsolete:             "bg-amber-100 text-amber-800",
};

const LIFECYCLE_LOCKED = new Set(["approved", "approved_with_comments", "issued", "archived", "obsolete", "superseded"]);

type TabId = "overview" | "revisions" | "activity" | "ai";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview",  label: "Overview",   icon: Info },
  { id: "revisions", label: "Revisions",  icon: History },
  { id: "activity",  label: "Activity",   icon: Clock },
  { id: "ai",        label: "AI Analysis", icon: Brain },
];

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 text-muted-foreground shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

type LifecycleAction = "archive" | "obsolete";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [lifecycleDialog, setLifecycleDialog] = useState<LifecycleAction | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecyclePending, setLifecyclePending] = useState(false);

  const { data: doc, isLoading, isError } = useQuery({
    queryKey: ["document-detail", id],
    queryFn: async () => {
      const r = await fetch(`/api/documents/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load document");
      return r.json();
    },
    enabled: !!id,
  });

  const isAdminOrPm = user?.role && ["system_owner", "admin", "project_manager"].includes(user.role);
  const isSysAdmin = user?.role && ["system_owner", "admin"].includes(user.role);

  async function handleLifecycleAction(action: LifecycleAction) {
    if (!lifecycleReason.trim()) return;
    setLifecyclePending(true);
    try {
      const endpoint = action === "archive" ? "archive" : "obsolete";
      const r = await fetch(
        `/api/projects/${doc.projectId}/documents/${doc.id}/${endpoint}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: lifecycleReason.trim() }),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update document");
      }
      toast({
        title: action === "archive" ? "Document archived" : "Document marked obsolete",
        description: action === "archive"
          ? "The document has been archived and is no longer active."
          : "The document has been marked as obsolete.",
      });
      queryClient.invalidateQueries({ queryKey: ["document-detail", id] });
      setLifecycleDialog(null);
      setLifecycleReason("");
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setLifecyclePending(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !doc) {
    return (
      <div className="max-w-lg mx-auto py-24 text-center">
        <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">Document not found</h2>
        <p className="text-muted-foreground mt-1 mb-6">This document may have been deleted or you may not have access.</p>
        <Button asChild variant="outline">
          <Link href="/documents"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Documents</Link>
        </Button>
      </div>
    );
  }

  const docId = parseInt(id!);
  const isLocked = LIFECYCLE_LOCKED.has(doc.status);
  const canTakeLifecycleAction = isAdminOrPm && doc.status !== "archived" && doc.status !== "obsolete";

  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl">
      {/* Lifecycle status banner */}
      {doc.status === "archived" && (
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-100 border border-slate-300 rounded-lg text-slate-700 text-sm">
          <Archive className="h-4 w-4 shrink-0" />
          <span>This document has been <strong>archived</strong>. It is retained for record-keeping but is no longer active.</span>
        </div>
      )}
      {doc.status === "obsolete" && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-800 text-sm">
          <Ban className="h-4 w-4 shrink-0" />
          <span>This document has been marked <strong>obsolete</strong>. It has been superseded or is no longer current.</span>
        </div>
      )}

      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4" /> All Documents
          </Link>
        </Button>
        {doc.projectId && (
          <>
            <span className="text-muted-foreground">/</span>
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <Link href={`/projects/${doc.projectId}`}>
                <ExternalLink className="h-3.5 w-3.5" /> {doc.projectCode || "Project"}
              </Link>
            </Button>
          </>
        )}
      </div>

      {/* Header */}
      <div className="bg-card border rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-sm font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                {doc.documentNumber}
              </span>
              {doc.revision && (
                <span className="text-xs text-muted-foreground font-mono border rounded px-1.5 py-0.5">
                  Rev {doc.revision}
                </span>
              )}
              <span className={cn(
                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize",
                STATUS_COLORS[doc.status] ?? "bg-muted text-muted-foreground",
              )}>
                {doc.status?.replace(/_/g, " ")}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight leading-tight">{doc.title}</h1>
            {doc.description && (
              <p className="text-muted-foreground mt-2 text-sm">{doc.description}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {doc.fileUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                </a>
              </Button>
            )}
            {/* Lifecycle actions — only for PM/admin on non-terminal documents */}
            {canTakeLifecycleAction && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Actions <ChevronDown className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    className="gap-2 text-slate-700"
                    onSelect={() => { setLifecycleDialog("archive"); setLifecycleReason(""); }}
                  >
                    <Archive className="h-4 w-4" />
                    Archive document
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-amber-700"
                    onSelect={() => { setLifecycleDialog("obsolete"); setLifecycleReason(""); }}
                  >
                    <Ban className="h-4 w-4" />
                    Mark as obsolete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="flex border-b">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 divide-y sm:divide-y-0">
                <MetaRow
                  icon={<Building2 className="h-4 w-4" />}
                  label="Project"
                  value={
                    doc.projectId
                      ? <Link href={`/projects/${doc.projectId}`} className="hover:text-primary hover:underline">
                          {doc.projectName || `Project #${doc.projectId}`}
                        </Link>
                      : null
                  }
                />
                <MetaRow icon={<Tag className="h-4 w-4" />} label="Discipline" value={doc.discipline} />
                <MetaRow icon={<Hash className="h-4 w-4" />} label="Document Type" value={doc.documentType} />
                <MetaRow
                  icon={<Globe className="h-4 w-4" />}
                  label="Source"
                  value={doc.source ? <span className="capitalize">{doc.source}</span> : null}
                />
                <MetaRow icon={<User className="h-4 w-4" />} label="Issued By" value={doc.issuedBy} />
                <MetaRow icon={<User className="h-4 w-4" />} label="Uploaded By" value={doc.createdByName} />
                {doc.folderName && (
                  <MetaRow icon={<FolderOpen className="h-4 w-4" />} label="Folder" value={doc.folderName} />
                )}
                <MetaRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Created"
                  value={doc.createdAt ? format(new Date(doc.createdAt), "dd MMM yyyy, HH:mm") : null}
                />
                <MetaRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Last Updated"
                  value={doc.updatedAt ? format(new Date(doc.updatedAt), "dd MMM yyyy, HH:mm") : null}
                />
              </div>

              {doc.tags && doc.tags.length > 0 && (
                <>
                  <Separator />
                  <div className="flex flex-wrap gap-1.5">
                    {doc.tags.map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </>
              )}

              <Separator />

              <DocumentWorkflowPanel documentId={docId} documentType={doc.documentType} />

              <Separator />

              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold text-sm">Attached Files</h2>
                </div>
                <DocumentFilesPanel documentId={docId} projectId={doc.projectId} canEdit={true} />
              </div>
            </div>
          )}

          {activeTab === "revisions" && (
            <DocumentRevisionsTab documentId={docId} documentTitle={doc.title} />
          )}

          {activeTab === "activity" && (
            <DocumentActivityTab documentId={docId} projectId={doc.projectId} />
          )}

          {activeTab === "ai" && (
            <DocumentAiTab documentId={docId} documentTitle={doc.title} />
          )}
        </div>
      </div>

      {/* Lifecycle action dialog */}
      <Dialog open={!!lifecycleDialog} onOpenChange={(open) => { if (!open) { setLifecycleDialog(null); setLifecycleReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {lifecycleDialog === "archive" ? (
                <><Archive className="h-5 w-5 text-slate-600" /> Archive document</>
              ) : (
                <><Ban className="h-5 w-5 text-amber-600" /> Mark document as obsolete</>
              )}
            </DialogTitle>
            <DialogDescription>
              {lifecycleDialog === "archive"
                ? "Archiving removes this document from active use. It will be retained for record-keeping and cannot be deleted by standard users."
                : "Marking obsolete indicates this document is no longer current or has been superseded. It will be retained but flagged accordingly."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>This action is recorded in the audit log. The document status will be permanently changed unless an administrator overrides it.</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lifecycle-reason">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="lifecycle-reason"
              placeholder={lifecycleDialog === "archive"
                ? "e.g. Project phase complete — document retained for reference"
                : "e.g. Superseded by Rev C issued on 10 April 2026"}
              value={lifecycleReason}
              onChange={(e) => setLifecycleReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setLifecycleDialog(null); setLifecycleReason(""); }} disabled={lifecyclePending}>
              Cancel
            </Button>
            <Button
              variant={lifecycleDialog === "archive" ? "secondary" : "default"}
              onClick={() => lifecycleDialog && handleLifecycleAction(lifecycleDialog)}
              disabled={!lifecycleReason.trim() || lifecyclePending}
              className={lifecycleDialog === "obsolete" ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
            >
              {lifecyclePending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {lifecycleDialog === "archive" ? "Archive document" : "Mark as obsolete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

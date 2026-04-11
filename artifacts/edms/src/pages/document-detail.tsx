import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, FileText, Building2, FolderOpen, User, Calendar,
  Download, ExternalLink, Loader2, Paperclip, Tag, Hash, Globe,
  Brain, History, Info,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DocumentFilesPanel } from "@/components/documents/DocumentFilesPanel";
import { DocumentWorkflowPanel } from "@/components/workflow/DocumentWorkflowPanel";
import { DocumentAiTab } from "@/components/documents/DocumentAiTab";
import { DocumentRevisionsTab } from "@/components/documents/DocumentRevisionsTab";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  draft:        "bg-gray-100 text-gray-700",
  under_review: "bg-yellow-100 text-yellow-800",
  approved:     "bg-green-100 text-green-700",
  issued:       "bg-blue-100 text-blue-700",
  superseded:   "bg-purple-100 text-purple-700",
  void:         "bg-red-100 text-red-700",
};

type TabId = "overview" | "revisions" | "ai";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview",  label: "Overview",   icon: Info },
  { id: "revisions", label: "Revisions",  icon: History },
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

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const { data: doc, isLoading, isError } = useQuery({
    queryKey: ["document-detail", id],
    queryFn: async () => {
      const r = await fetch(`/api/documents/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load document");
      return r.json();
    },
    enabled: !!id,
  });

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

  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl">
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
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        {/* Tab bar */}
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
          {/* Overview tab */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Metadata grid */}
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
                <MetaRow
                  icon={<Tag className="h-4 w-4" />}
                  label="Discipline"
                  value={doc.discipline}
                />
                <MetaRow
                  icon={<Hash className="h-4 w-4" />}
                  label="Document Type"
                  value={doc.documentType}
                />
                <MetaRow
                  icon={<Globe className="h-4 w-4" />}
                  label="Source"
                  value={doc.source ? <span className="capitalize">{doc.source}</span> : null}
                />
                <MetaRow
                  icon={<User className="h-4 w-4" />}
                  label="Issued By"
                  value={doc.issuedBy}
                />
                <MetaRow
                  icon={<User className="h-4 w-4" />}
                  label="Uploaded By"
                  value={doc.createdByName}
                />
                {doc.folderName && (
                  <MetaRow
                    icon={<FolderOpen className="h-4 w-4" />}
                    label="Folder"
                    value={doc.folderName}
                  />
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

              {/* Tags */}
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

              {/* Approval Workflow Panel */}
              <DocumentWorkflowPanel
                documentId={docId}
                documentType={doc.documentType}
              />

              <Separator />

              {/* Files Panel */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold text-sm">Attached Files</h2>
                </div>
                <DocumentFilesPanel
                  documentId={docId}
                  projectId={doc.projectId}
                  canEdit={true}
                />
              </div>
            </div>
          )}

          {/* Revisions tab */}
          {activeTab === "revisions" && (
            <DocumentRevisionsTab
              documentId={docId}
              documentTitle={doc.title}
            />
          )}

          {/* AI Analysis tab */}
          {activeTab === "ai" && (
            <DocumentAiTab
              documentId={docId}
              documentTitle={doc.title}
            />
          )}
        </div>
      </div>
    </div>
  );
}

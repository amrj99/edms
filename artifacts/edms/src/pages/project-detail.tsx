import { useParams, Link, useLocation } from "wouter";
import { useResizableColumns } from "@/hooks/useResizableColumns";
import { unwrapList } from "@/lib/unwrap-list";
import { useGetProject, useListDocuments, useCreateDocument } from "@workspace/api-client-react";
import {
  FileText, Mail, CheckSquare, GitBranch, Users, ArrowLeft, Loader2,
  Plus, Download, Upload, Eye, Sparkles, Send, Package, AlertCircle,
  Clock, RefreshCw, Check, X, Square, Archive,
  Layers, UserCheck, FileDown, Trash2, ChevronDown,
  ClipboardCheck, GitCompare, ShieldAlert, History, ThumbsUp, ThumbsDown,
  UserPlus, Diff, Pencil, Link2, Paperclip, Building2, ExternalLink,
  LayoutList, FolderTree, ChevronRight, Folder, FolderMinus, ShieldCheck, Search, FolderInput,
  AlertTriangle, FilePlus2, GitMerge, ClipboardList,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileDropZone, type UploadedFile } from "@/components/file-drop-zone";
import { UploadDocumentsDialog, type DocMeta } from "@/components/upload-documents-dialog";
import { UploadDocumentDialog } from "@/components/upload-document-dialog";
import { MetadataFieldsForm } from "@/components/metadata-fields-form";
import { RecipientAutocomplete, EmailChipInput, type RecipientUser } from "@/components/recipient-autocomplete";
import { format, differenceInDays, parseISO } from "date-fns";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useColumnVisibility, type ColumnDef } from "@/hooks/useColumnVisibility";
import { ColumnVisibilityMenu } from "@/components/ui/column-visibility-menu";
import { DocumentFilesPanel } from "@/components/documents/DocumentFilesPanel";
import { DocumentPreviewContent } from "@/components/documents/DocumentPreviewContent";
import { FolderSidebar } from "@/components/documents/FolderSidebar";
import { useToast } from "@/hooks/use-toast";
import { partyAllows, type PartyRole } from "@/lib/party-ceiling";
import { ProjectRoleOverridesTab } from "@/components/governance/ProjectRoleOverridesTab";
import { GovernanceDashboardTab } from "@/components/governance/GovernanceDashboardTab";
import { AuditLogPanel } from "@/components/governance/AuditLogPanel";
import { RoleMatrix } from "@/components/governance/RoleMatrix";
import { ProjectPartiesTab } from "@/components/governance/ProjectPartiesTab";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/usePermissions";
import { SubmittalsTab } from "@/components/submittals/SubmittalsTab";

// ─── Shared Utilities ────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:                  "bg-gray-100 text-gray-600",
    sent:                   "bg-blue-100 text-blue-700",
    acknowledged:           "bg-emerald-100 text-emerald-700",
    rejected:               "bg-red-100 text-red-700",
    approved:               "bg-emerald-100 text-emerald-700",
    approved_with_comments: "bg-teal-100 text-teal-700",
    for_revision:           "bg-amber-100 text-amber-700",
    pending_review:         "bg-yellow-100 text-yellow-700",
    responded:              "bg-purple-100 text-purple-700",
    closed:                 "bg-gray-100 text-gray-500",
    overdue:                "bg-red-100 text-red-700",
    active:                 "bg-emerald-100 text-emerald-700",
    in_review:              "bg-blue-100 text-blue-700",
    under_review:           "bg-blue-100 text-blue-700",
    issued:                 "bg-indigo-100 text-indigo-700",
    superseded:             "bg-slate-100 text-slate-500",
    void:                   "bg-red-50 text-red-400",
    archived:               "bg-gray-50 text-gray-400",
  };
  const labels: Record<string, string> = {
    draft:                  "Draft",
    under_review:           "Under Review",
    approved:               "Approved",
    approved_with_comments: "Approved w/ Comments",
    for_revision:           "For Revision",
    rejected:               "Rejected",
    issued:                 "Issued",
    superseded:             "Superseded",
    void:                   "Void",
    archived:               "Archived",
    in_review:              "In Review",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

const REVIEW_DECISION_OPTIONS = [
  { value: "approved",              label: "Approved",              icon: "✓", activeClass: "border-emerald-500 bg-emerald-50 text-emerald-700" },
  { value: "approved_with_comments", label: "Approved w/ Comments", icon: "✎", activeClass: "border-teal-500 bg-teal-50 text-teal-700" },
  { value: "for_revision",          label: "Revise",                icon: "↩", activeClass: "border-amber-500 bg-amber-50 text-amber-700" },
  { value: "rejected",              label: "Rejected",              icon: "✗", activeClass: "border-red-500 bg-red-50 text-red-700" },
] as const;

// ─── Revision History Sheet ──────────────────────────────────────────────────
function RevisionHistorySheet({ doc, projectId, open, onClose }: { doc: any; projectId: number; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["revisions", doc?.id],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${doc.id}/revisions`);
      return r.json();
    },
    enabled: open && !!doc,
  });
  const revisions: any[] = data?.revisions ?? [];

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-[400px] sm:max-w-[400px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Revision History</SheetTitle>
          {doc && <p className="text-xs text-muted-foreground font-mono">{doc.documentNumber} · {doc.title}</p>}
        </SheetHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No revision history found.</p>
        ) : (
          <div className="space-y-3">
            {revisions.map((rev: any, idx: number) => (
              <div key={rev.id} className={`rounded-lg border p-3 ${idx === 0 ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-mono font-bold ${idx === 0 ? "text-primary" : ""}`}>Rev {rev.revision}</span>
                    {idx === 0 && <Badge variant="default" className="text-[10px]">Latest</Badge>}
                  </div>
                  {rev.fileUrl && (
                    <a href={rev.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                      <FileDown className="h-3 w-3" /> Download
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {rev.uploadedByName && <span className="mr-1">{rev.uploadedByName} ·</span>}
                  {rev.createdAt ? format(new Date(rev.createdAt), "dd MMM yyyy, HH:mm") : ""}
                </p>
                {rev.comment && <p className="text-xs text-foreground mt-1 italic">"{rev.comment}"</p>}
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const params = useParams();
  const projectId = parseInt(params.id || "0");
  const { data: project, isLoading: projLoading } = useGetProject(projectId);
  const [activeTab, setActiveTab] = useState("documents");
  const [govSubTab, setGovSubTab] = useState<"dashboard" | "audit" | "matrix">("dashboard");
  const [collaborationMode, setCollaborationMode] = useState<"org_only" | "parties">("org_only");
  const perms = usePermissions();
  // Bridge: Documents tab → Transmittals tab pre-populated create dialog
  const [pendingTransDocIds, setPendingTransDocIds] = useState<number[] | null>(null);
  function openTransmittalCreate(docIds: number[]) {
    setPendingTransDocIds(docIds);
    setActiveTab("transmittals");
  }
  // Sync collaborationMode from project data after load
  useEffect(() => {
    if (project) setCollaborationMode((project as any).collaborationMode ?? "org_only");
  }, [(project as any)?.id]);

  if (projLoading) return <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!project) return <div>Project not found</div>;

  const isAtLeastPM = ["system_owner", "admin", "project_manager"].includes(perms.effectiveRole ?? "");
  const isAdmin = ["system_owner", "admin"].includes(perms.effectiveRole ?? "");

  // Phase 6C: party members (external orgs) get a reduced, read-oriented view.
  // accessMode/partyRole come from GET /projects/:id; the backend enforces all
  // actions regardless of what is shown here.
  const partyRole: PartyRole | null =
    (project as any).accessMode === "party" ? ((project as any).partyRole ?? null) : null;

  const tabs = partyRole ? [
    { value: "documents", icon: FileText, label: "Documents" },
    { value: "transmittals", icon: Send, label: "Transmittals" },
  ] : [
    { value: "documents", icon: FileText, label: "Documents" },
    { value: "review", icon: ClipboardCheck, label: "Review" },
    { value: "transmittals", icon: Send, label: "Transmittals" },
    { value: "submittals", icon: ClipboardList, label: "Submittals" },
    { value: "correspondence", icon: Mail, label: "Correspondence" },
    { value: "packages", icon: Package, label: "Packages" },
    { value: "tasks", icon: CheckSquare, label: "Tasks" },
    { value: "workflows", icon: GitBranch, label: "Workflows" },
    { value: "members", icon: Users, label: "Members" },
    { value: "departments", icon: Building2, label: "Departments" },
    { value: "role-overrides", icon: ShieldCheck, label: "Role Overrides" },
    ...(isAdmin ? [{ value: "parties", icon: Building2, label: "Parties" }] : []),
    ...(perms.canEditDocument ? [{ value: "governance", icon: LayoutList, label: "Governance" }] : []),
  ];

  return (
    <div className="space-y-6 animate-in fade-in pb-12">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2 text-muted-foreground">
          <Link href="/projects"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Projects</Link>
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-bold">{project.code}</span>
              <Badge variant="outline" className="uppercase text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                {project.status.replace('_', ' ')}
              </Badge>
              {partyRole && (
                <Badge variant="outline" className="uppercase text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                  Partner Project — {partyRole}
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">{project.description}</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent p-0 flex-wrap gap-0">
          {tabs.map(({ value, icon: Icon, label }) => (
            <TabsTrigger key={value} value={value} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-5 font-medium">
              <Icon className="mr-2 h-4 w-4" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="documents">
            <DocumentTab projectId={projectId} projectCode={project.code} projectName={project.name} onCreateTransmittal={openTransmittalCreate} partyRole={partyRole} />
          </TabsContent>
          <TabsContent value="review">
            <ReviewTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="transmittals">
            <TransmittalsTab projectId={projectId} projectName={project.name} projectCode={project.code} prefillDocIds={pendingTransDocIds} onPrefillConsumed={() => setPendingTransDocIds(null)} partyRole={partyRole} />
          </TabsContent>
          <TabsContent value="submittals">
            <SubmittalsTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="correspondence">
            <CorrespondenceTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="packages">
            <PackagesTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="tasks">
            <TasksTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="workflows">
            <div className="bg-card p-12 text-center rounded-xl border border-dashed">
              <GitBranch className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Workflow Engine</h3>
              <p className="text-muted-foreground text-sm">Configure document approval workflows for this project.</p>
            </div>
          </TabsContent>
          <TabsContent value="members">
            <MembersTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="departments">
            <ProjectDepartmentsTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="role-overrides">
            <ProjectRoleOverridesTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="parties">
            <ProjectPartiesTab
              projectId={projectId}
              collaborationMode={collaborationMode}
              onModeChange={setCollaborationMode}
            />
          </TabsContent>
          <TabsContent value="governance">
            {/* Governance sub-nav */}
            <div className="flex gap-1 mb-6 bg-muted/40 rounded-lg p-1 w-fit">
              {(["dashboard", "audit", "matrix"] as const).map(sub => {
                const labels: Record<string, string> = { dashboard: "Dashboard", audit: "Audit Log", matrix: "Role Matrix" };
                return (
                  <button
                    key={sub}
                    onClick={() => setGovSubTab(sub)}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      govSubTab === sub
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {labels[sub]}
                  </button>
                );
              })}
            </div>
            {govSubTab === "dashboard" && <GovernanceDashboardTab projectId={projectId} />}
            {govSubTab === "audit" && <AuditLogPanel projectId={projectId} />}
            {govSubTab === "matrix" && <RoleMatrix />}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ─── Document Tab ─────────────────────────────────────────────────────────────
const PROJECT_DOC_COLS = [
  { key: "docNum",       defaultWidth: 120, minWidth: 80 },
  { key: "title",        defaultWidth: 220, minWidth: 100 },
  { key: "discipline",   defaultWidth: 100, minWidth: 70 },
  { key: "source",       defaultWidth: 100, minWidth: 70 },
  { key: "issuedBy",     defaultWidth: 110, minWidth: 70 },
  { key: "revision",     defaultWidth: 60,  minWidth: 50 },
  { key: "status",       defaultWidth: 120, minWidth: 80 },
  { key: "updatedAt",    defaultWidth: 110, minWidth: 90 },
];

const DOC_COLUMNS: ColumnDef[] = [
  { key: "docNum",     label: "Document No." },
  { key: "title",      label: "Title" },
  { key: "discipline", label: "Discipline" },
  { key: "source",     label: "Source" },
  { key: "issuedBy",   label: "Issued By" },
  { key: "revision",   label: "Rev" },
  { key: "status",     label: "Status" },
  { key: "updatedAt",  label: "Updated" },
];
const DOC_PINNED = ["docNum", "title"];

function DocumentTab({ projectId, projectCode, projectName, onCreateTransmittal, partyRole }: { projectId: number; projectCode?: string; projectName?: string; onCreateTransmittal?: (docIds: number[]) => void; partyRole?: PartyRole | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const perms = usePermissions();
  // Phase 6C: for party members the ceiling replaces role-based gating (backend enforces either way)
  const canUploadDocs = partyRole ? partyAllows(partyRole, "upload_document") : perms.canCreateDocument;
  const { isVisible: isDocColVis, toggle: toggleDocCol, reset: resetDocCols, visibleCount: docColVisCount } =
    useColumnVisibility(`docs-${projectId}`, DOC_COLUMNS);
  const [, navigate] = useLocation();
  const { getThStyle: getDocThStyle, startResize: startDocResize, resetWidths: resetDocWidths } = useResizableColumns(`project-docs-${projectId}`, PROJECT_DOC_COLS);
  const { data, isLoading, refetch: refetchDocs } = useListDocuments(projectId);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isUploadSingleOpen, setIsUploadSingleOpen] = useState(false);
  const [isBulkTransOpen, setIsBulkTransOpen] = useState(false);
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
  const createDoc = useCreateDocument();
  const [searchQ, setSearchQ] = useState("");
  const [filterDiscipline, setFilterDiscipline] = useState("_all");
  const [filterDocType, setFilterDocType] = useState("_all");
  // View mode: list or folder
  const [viewMode, setViewMode] = useState<"list" | "folder">("list");
  const [folderViewFolderId, setFolderViewFolderId] = useState<number | null>(null);
  const [compareDoc, setCompareDoc] = useState<any>(null);
  const [docPreview, setDocPreview] = useState<any>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ fileUrl: string; fileName: string; fileType?: string | null } | null>(null);
  const [revHistoryDoc, setRevHistoryDoc] = useState<any>(null);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Bulk transmittal form
  const [bulkTrsForm, setBulkTrsForm] = useState({ subject: "", purpose: "for_review", toExternal: "", description: "" });
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [bulkAssignStatus, setBulkAssignStatus] = useState("in_review");
  // Document edit state
  const [editDoc, setEditDoc] = useState<any>(null);
  const [editForm, setEditForm] = useState<{ title: string; discipline: string; revision: string; documentType: string; description: string; source: string; issuedBy: string; metadata: Record<string, unknown> }>({ title: "", discipline: "", revision: "", documentType: "", description: "", source: "", issuedBy: "", metadata: {} });
  const [editFile, setEditFile] = useState<UploadedFile | null>(null);
  const [editAdditionalFiles, setEditAdditionalFiles] = useState<UploadedFile[]>([]);
  // Department assignments for the edit dialog (Phase B — data only)
  const [editDocDeptIds, setEditDocDeptIds] = useState<Set<number>>(new Set());
  const [editDocOrigDeptIds, setEditDocOrigDeptIds] = useState<Set<number>>(new Set());
  // New Revision dialog state
  const [newRevDoc, setNewRevDoc] = useState<any>(null);
  const [newRevForm, setNewRevForm] = useState({ revision: "", notes: "" });
  const [newRevFile, setNewRevFile] = useState<UploadedFile | null>(null);
  // Send for Workflow (Transmittal) state
  const [wfDoc, setWfDoc] = useState<any>(null);
  const [wfForm, setWfForm] = useState({ subject: "", purpose: "for_review", toUserIds: [] as number[], externalEmails: "", description: "" });

  // Start Workflow Engine state
  const [wfEngineDoc, setWfEngineDoc] = useState<any>(null);
  const [wfEngineTemplates, setWfEngineTemplates] = useState<any[]>([]);
  const [wfEngineTemplateId, setWfEngineTemplateId] = useState<number | null>(null);
  const [wfEngineLoading, setWfEngineLoading] = useState(false);
  const [wfEngineStarting, setWfEngineStarting] = useState(false);

  // Document share state
  const [shareDoc, setShareDoc] = useState<any>(null);
  const [docShareForm, setDocShareForm] = useState({ expiresInDays: "30", password: "" });
  const [docShareResult, setDocShareResult] = useState<{ shareUrl: string; expiresAt: string | null } | null>(null);

  // Move to Folder state
  const [moveToFolderDoc, setMoveToFolderDoc] = useState<any>(null);
  const { data: folderPickData } = useQuery({
    queryKey: ["project-folders", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/folders`);
      if (!r.ok) return { folders: [] };
      return r.json();
    },
    enabled: !!moveToFolderDoc,
  });
  const pickerFolders: any[] = unwrapList<any>(folderPickData, "folders");
  const moveToFolderMut = useMutation({
    mutationFn: async ({ docId, folderId }: { docId: number; folderId: number | null }) => {
      const token = localStorage.getItem("edms_token");
      const r = await fetch(`/api/projects/${projectId}/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ folderId }),
      });
      if (!r.ok) throw new Error("Failed to move document");
      return r.json();
    },
    onSuccess: () => {
      refetchDocs();
      setMoveToFolderDoc(null);
      toast({ title: "Document moved successfully" });
    },
    onError: () => toast({ title: "Failed to move document", variant: "destructive" }),
  });

  const handleMultiUploadSuccess = async (
    uploads: { meta: DocMeta; fileUrl: string; fileName: string; fileSize: number }[]
  ) => {
    let failedCount = 0;
    const duplicates: string[] = [];
    for (const u of uploads) {
      try {
        await createDoc.mutateAsync({
          projectId,
          data: {
            documentNumber: u.meta.docNumber || `DOC-${Date.now()}`,
            title: u.meta.title || u.fileName.replace(/\.[^.]+$/, ""),
            revision: u.meta.revision || "01",
            status: (u.meta.status as any) || "draft",
            discipline: u.meta.discipline || undefined,
            documentType: u.meta.docType || "general",
            source: u.meta.source || undefined,
            issuedBy: u.meta.issuedBy || undefined,
            direction: u.meta.direction || undefined,
            metadata: u.meta.customFields ?? {},
            fileUrl: u.fileUrl,
            fileName: u.fileName,
            fileSize: u.fileSize,
          } as any,
        });
      } catch (err: any) {
        failedCount++;
        const msg: string = err?.message ?? "";
        if (msg.includes("409") || msg.toLowerCase().includes("already exists")) {
          duplicates.push(u.meta.docNumber || u.fileName);
        }
      }
    }
    if (duplicates.length > 0) {
      toast({
        title: `${duplicates.length} duplicate document number${duplicates.length > 1 ? "s" : ""}`,
        description: `${duplicates.join(", ")} already exist${duplicates.length === 1 ? "s" : ""} in this project. Use "Upload New Revision" for existing documents.`,
        variant: "destructive",
      });
    } else if (failedCount > 0) {
      toast({ title: `${failedCount} document${failedCount > 1 ? "s" : ""} failed to save`, variant: "destructive" });
    }
    if (failedCount < uploads.length) setIsUploadOpen(false);
  };

  const handleSingleUploadSuccess = async (result: { meta: DocMeta; fileUrl: string; fileName: string; fileSize: number }) => {
    try {
      await createDoc.mutateAsync({
        projectId,
        data: {
          documentNumber: result.meta.docNumber || undefined,
          title: result.meta.title || result.fileName.replace(/\.[^.]+$/, ""),
          revision: result.meta.revision || "01",
          status: (result.meta.status as any) || "draft",
          discipline: result.meta.discipline || undefined,
          documentType: result.meta.docType || "general",
          source: result.meta.source || undefined,
          issuedBy: result.meta.issuedBy || undefined,
          metadata: result.meta.customFields ?? {},
          fileUrl: result.fileUrl,
          fileName: result.fileName,
          fileSize: result.fileSize,
        } as any,
      });
      setIsUploadSingleOpen(false);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("409") || msg.toLowerCase().includes("already exists")) {
        toast({ title: "Document number already exists", description: "Use 'Upload New Revision' for existing documents.", variant: "destructive" });
      } else {
        toast({ title: "Failed to save document", variant: "destructive" });
      }
    }
  };

  // ── Department queries for edit dialog (Phase B) ─────────────────────────
  const { data: orgDeptsRaw } = useQuery({
    queryKey: ["org-departments"],
    queryFn: async () => {
      const r = await fetch("/api/departments");
      return r.ok ? r.json() : [];
    },
  });
  const orgDepts: any[] = Array.isArray(orgDeptsRaw) ? orgDeptsRaw.filter((d: any) => d.isActive !== false) : [];

  const { data: documentTypesRaw } = useQuery({
    queryKey: ["document-types"],
    queryFn: async () => {
      const r = await fetch("/api/document-types");
      return r.ok ? r.json() : [];
    },
  });
  const activeDocumentTypes: any[] = Array.isArray(documentTypesRaw) ? documentTypesRaw.filter((dt: any) => dt.isActive) : [];

  const { data: editDocDeptsRaw } = useQuery({
    queryKey: ["doc-departments", editDoc?.id],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${editDoc!.id}/departments`);
      return r.ok ? r.json() : [];
    },
    enabled: !!editDoc,
  });

  useEffect(() => {
    if (editDocDeptsRaw) {
      const ids = new Set<number>((editDocDeptsRaw as any[]).map((d: any) => d.id));
      setEditDocDeptIds(ids);
      setEditDocOrigDeptIds(new Set(ids));
    }
  }, [editDocDeptsRaw]);

  const updateDoc = useMutation({
    mutationFn: async (data: any) => {
      const docId = editDoc!.id;
      const r = await fetch(`/api/projects/${projectId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to update");

      // Sync department assignments (Phase B — no enforcement)
      for (const id of editDocOrigDeptIds) {
        if (!editDocDeptIds.has(id)) {
          await fetch(`/api/projects/${projectId}/documents/${docId}/departments/${id}`, { method: "DELETE" });
        }
      }
      for (const id of editDocDeptIds) {
        if (!editDocOrigDeptIds.has(id)) {
          await fetch(`/api/projects/${projectId}/documents/${docId}/departments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ departmentId: id }),
          });
        }
      }

      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["doc-departments", editDoc?.id] });
      setEditDoc(null);
      setEditFile(null);
      setEditDocDeptIds(new Set());
      setEditDocOrigDeptIds(new Set());
      toast({ title: "Document updated" });
    },
    onError: () => toast({ title: "Failed to update document", variant: "destructive" }),
  });

  // ─── New Revision helpers ─────────────────────────────────────────────────
  function suggestNextRevision(current: string): string {
    if (!current) return "";
    // Trailing numeric: "01" → "02", "P01" → "P02", "A1" → "A2"
    const numericMatch = current.match(/^(\D*)(\d+)$/);
    if (numericMatch) {
      const prefix = numericMatch[1];
      const digits = numericMatch[2];
      const next = String(parseInt(digits, 10) + 1).padStart(digits.length, "0");
      return prefix + next;
    }
    // Single uppercase letter: A → B, Z → AA
    if (/^[A-Z]$/.test(current)) {
      const code = current.charCodeAt(0);
      return code < 90 ? String.fromCharCode(code + 1) : "AA";
    }
    // Single lowercase letter
    if (/^[a-z]$/.test(current)) {
      const code = current.charCodeAt(0);
      return code < 122 ? String.fromCharCode(code + 1) : "aa";
    }
    return current;
  }

  const createRevision = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/projects/${projectId}/documents/${newRevDoc!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to create revision"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      setNewRevDoc(null);
      setNewRevFile(null);
      setNewRevForm({ revision: "", notes: "" });
      toast({ title: "New revision created", description: `Revision ${newRevForm.revision} saved and recorded in history.` });
    },
    onError: (e: any) => toast({ title: "Failed to create revision", description: e.message, variant: "destructive" }),
  });

  const createDocShare = useMutation({
    mutationFn: async ({ id, expiresInDays, password }: { id: number; expiresInDays: string; password: string }) => {
      const r = await fetch(`/api/projects/${projectId}/documents/${id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: expiresInDays ? parseInt(expiresInDays) : null, password: password || undefined }),
      });
      if (!r.ok) throw new Error("Failed to create share link");
      return r.json();
    },
    onSuccess: (data) => { setDocShareResult(data); toast({ title: "Share link created" }); },
    onError: () => toast({ title: "Failed to create share link", variant: "destructive" }),
  });

  const revokeDocShare = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/projects/${projectId}/documents/${id}/share`, { method: "DELETE" });
      return r.json();
    },
    onSuccess: () => { setDocShareResult(null); toast({ title: "Share link revoked" }); },
  });

  const openStartWorkflow = async (doc: any) => {
    setWfEngineDoc(doc);
    setWfEngineTemplateId(null);
    setWfEngineLoading(true);
    try {
      const r = await fetch("/api/workflow-engine/templates", { credentials: "include" });
      if (!r.ok) throw new Error();
      const data = await r.json();
      const all: any[] = data.templates ?? data ?? [];
      const active = all.filter((t: any) => t.isActive !== false);
      const exact = active.filter((t: any) => t.documentType?.toLowerCase() === doc.documentType?.toLowerCase());
      const list = exact.length > 0 ? exact : active;
      setWfEngineTemplates(list);
      if (list.length === 1) setWfEngineTemplateId(list[0].id);
    } catch {
      setWfEngineTemplates([]);
    } finally {
      setWfEngineLoading(false);
    }
  };

  const startWorkflowEngine = async () => {
    if (!wfEngineDoc) return;
    const templateId = wfEngineTemplateId ?? wfEngineTemplates[0]?.id;
    if (!templateId) {
      toast({ title: "No workflow template available", variant: "destructive" });
      return;
    }
    setWfEngineStarting(true);
    try {
      const r = await fetch("/api/workflow-engine/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ documentId: wfEngineDoc.id, templateId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to start workflow");
      toast({ title: "Workflow started", description: `Stage: ${data.currentStageName ?? "—"}` });
      setWfEngineDoc(null);
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to start workflow", variant: "destructive" });
    } finally {
      setWfEngineStarting(false);
    }
  };

  const sendForWorkflow = useMutation({
    mutationFn: async () => {
      if (!wfDoc) return;
      const r = await fetch(`/api/projects/${projectId}/transmittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: wfForm.subject || `For Review: ${wfDoc.documentNumber} — ${wfDoc.title}`,
          purpose: wfForm.purpose,
          toUserIds: wfForm.toUserIds,
          externalEmails: wfForm.externalEmails,
          description: wfForm.description,
          documentIds: [wfDoc.id],
        }),
      });
      if (!r.ok) throw new Error("Failed to create transmittal");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      toast({ title: `Transmittal created for ${wfDoc?.documentNumber}` });
      setWfDoc(null);
      setWfForm({ subject: "", purpose: "for_review", toUserIds: [], externalEmails: "", description: "" });
    },
    onError: () => toast({ title: "Failed to send for workflow", variant: "destructive" }),
  });

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });
  const allUsers = unwrapList<any>(usersData, "users").map((u: any) => ({
    id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email,
    organizationName: u.organizationName, role: u.role,
  }));


  const runValidation = async () => {
    setValidating(true);
    setValidateOpen(true);
    try {
      const r = await fetch("/api/ai/validate-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, documents: allDocs }),
      });
      const data = await r.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ issues: [], summary: "Validation could not be completed. Please try again." });
    } finally {
      setValidating(false);
    }
  };

  const allDocs = unwrapList<any>(data, "documents");
  const uniqueDisciplines = Array.from(new Set(allDocs.map((d: any) => d.discipline).filter(Boolean))) as string[];
  const uniqueDocTypes = Array.from(new Set(allDocs.map((d: any) => d.documentType).filter(Boolean))) as string[];
  const filtered = allDocs.filter((d: any) => {
    if (searchQ) {
      const q = searchQ.toLowerCase();
      const match = d.title?.toLowerCase().includes(q) ||
        d.documentNumber?.toLowerCase().includes(q) ||
        d.discipline?.toLowerCase().includes(q) ||
        d.revision?.toLowerCase().includes(q) ||
        d.documentType?.toLowerCase().includes(q);
      if (!match) return false;
    }
    if (filterDiscipline !== "_all" && d.discipline !== filterDiscipline) return false;
    if (filterDocType !== "_all" && d.documentType !== filterDocType) return false;
    // In folder view, filter by selected folder (null = all / root = no folder)
    if (viewMode === "folder" && folderViewFolderId !== null) {
      if (d.folderId !== folderViewFolderId) return false;
    }
    return true;
  });

  const toggleSelect = (id: number) => {
    setSelectedIds(s => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });
  };
  const toggleAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((d: any) => d.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const selectedDocs = filtered.filter((d: any) => selectedIds.has(d.id));

  const generateAISummary = async () => {
    setAiSummaryLoading(true);
    try {
      const formDocs = allDocs.filter((d: any) => selectedIds.has(d.id));
      const docList = formDocs.map((d: any) => `${d.documentNumber} - ${d.title} (Rev ${d.revision ?? "01"})`).join("; ");
      setBulkTrsForm(f => ({ ...f, description: `Transmittal covering ${formDocs.length} document(s): ${docList}. Please review and acknowledge receipt.` }));
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const createBulkTransmittal = useMutation({
    mutationFn: async () => {
      const docIds = Array.from(selectedIds);
      const r = await fetch(`/api/projects/${projectId}/transmittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bulkTrsForm, documentIds: docIds }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      const count = selectedIds.size;
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      setIsBulkTransOpen(false);
      clearSelection();
      setBulkTrsForm({ subject: "", purpose: "for_review", toExternal: "", description: "" });
      toast({ title: `Transmittal created with ${count} document(s)` });
    },
    onError: () => toast({ title: "Failed to create transmittal", variant: "destructive" }),
  });

  const bulkUpdateStatus = useMutation({
    mutationFn: async () => {
      await Promise.all(selectedDocs.map((d: any) =>
        fetch(`/api/projects/${projectId}/documents/${d.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: bulkAssignStatus }),
        })
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      setIsBulkAssignOpen(false);
      clearSelection();
      toast({ title: `${selectedDocs.length} document(s) updated` });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap justify-between items-center gap-2 bg-card p-2 rounded-lg border shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <Input placeholder="Search title, number, discipline…" className="w-[220px] h-9" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          {uniqueDisciplines.length > 0 && (
            <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
              <SelectTrigger className="h-9 w-[150px] text-sm">
                <SelectValue placeholder="Discipline" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Disciplines</SelectItem>
                {uniqueDisciplines.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {uniqueDocTypes.length > 0 && (
            <Select value={filterDocType} onValueChange={setFilterDocType}>
              <SelectTrigger className="h-9 w-[140px] text-sm">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Types</SelectItem>
                {uniqueDocTypes.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {(filterDiscipline !== "_all" || filterDocType !== "_all") && (
            <button onClick={() => { setFilterDiscipline("_all"); setFilterDocType("_all"); }} className="text-xs text-muted-foreground hover:text-foreground underline">
              Clear filters
            </button>
          )}
          {selectedIds.size > 0 && (
            <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {/* View toggle */}
          <div className="flex items-center rounded-md border overflow-hidden h-9">
            <button
              className={`flex items-center gap-1.5 px-2.5 h-full text-xs font-medium transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-transparent hover:bg-muted text-muted-foreground"}`}
              onClick={() => setViewMode("list")}
              title="List view"
            >
              <LayoutList className="h-3.5 w-3.5" /> List
            </button>
            <button
              className={`flex items-center gap-1.5 px-2.5 h-full text-xs font-medium transition-colors border-l ${viewMode === "folder" ? "bg-primary text-primary-foreground" : "bg-transparent hover:bg-muted text-muted-foreground"}`}
              onClick={() => setViewMode("folder")}
              title="Folder view"
            >
              <FolderTree className="h-3.5 w-3.5" /> Folders
            </button>
          </div>
          {selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onCreateTransmittal?.(Array.from(selectedIds))}>
                <Send className="h-3.5 w-3.5" /> Create Transmittal
              </Button>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setIsBulkAssignOpen(true)}>
                <UserCheck className="h-3.5 w-3.5" /> Change Status
              </Button>
              <Button size="sm" variant="outline" className="h-9 gap-1.5"
                onClick={() => { toast({ title: `Downloading ${selectedIds.size} document(s)...` }); clearSelection(); }}>
                <FileDown className="h-3.5 w-3.5" /> Download
              </Button>
              <Button size="sm" variant="ghost" className="h-9 gap-1 text-muted-foreground" onClick={clearSelection}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-9 w-9 p-0" title="Refresh documents" onClick={() => refetchDocs()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {/* Validation, migration import and master register are owner-org
              workflows — hidden for external party members (Phase 6C) */}
          {!partyRole && (
            <>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={runValidation} disabled={validating || allDocs.length === 0}>
                <ShieldAlert className="h-3.5 w-3.5" />
                {validating ? "Validating..." : "Validate"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 border-amber-400/60 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
                onClick={() => navigate(`/migration-wizard?projectId=${projectId}`)}
              >
                <FolderMinus className="h-3.5 w-3.5" /> Import Existing
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => navigate(`/reports?tab=master&projectId=${projectId}`)}
                title="Open this project in the Master Register"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Master Register
              </Button>
            </>
          )}
          {canUploadDocs && (
            <>
              <Button size="sm" className="h-9 gap-1.5" onClick={() => setIsUploadSingleOpen(true)}>
                <Upload className="h-3.5 w-3.5" /> Upload Document
              </Button>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setIsUploadOpen(true)}>
                <Upload className="h-3.5 w-3.5" /> Bulk Upload
              </Button>
            </>
          )}
          <UploadDocumentDialog
            open={isUploadSingleOpen}
            onOpenChange={setIsUploadSingleOpen}
            projectId={projectId}
            projectCode={projectCode}
            projectName={projectName}
            onSuccess={handleSingleUploadSuccess}
            onOpenDocument={id => {
              setIsUploadSingleOpen(false);
              const doc = (allDocs as any[]).find(d => d.id === id);
              if (doc) setDocPreview(doc);
            }}
            onUploadRevision={doc => {
              setIsUploadSingleOpen(false);
              setNewRevDoc(doc);
            }}
          />
          <UploadDocumentsDialog
            open={isUploadOpen}
            onOpenChange={setIsUploadOpen}
            projectId={projectId}
            projectCode={projectCode}
            projectName={projectName}
            onSuccess={handleMultiUploadSuccess}
            onOpenDocument={id => {
              setIsUploadOpen(false);
              const doc = (allDocs as any[]).find(d => d.id === id);
              if (doc) setDocPreview(doc);
            }}
            onUploadRevision={doc => {
              setIsUploadOpen(false);
              setNewRevDoc(doc);
            }}
          />
        </div>
      </div>

      {/* Bulk Transmittal Dialog */}
      <Dialog open={isBulkTransOpen} onOpenChange={setIsBulkTransOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Create Transmittal — {selectedIds.size} Document(s)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Selected doc list — with remove buttons */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs text-muted-foreground">Attached Documents ({selectedIds.size})</Label>
                {selectedIds.size === 0 && (
                  <span className="text-xs text-destructive">At least one document required</span>
                )}
              </div>
              <div className="border rounded-lg divide-y max-h-36 overflow-y-auto">
                {selectedIds.size === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">No documents selected</div>
                ) : allDocs.filter((d: any) => selectedIds.has(d.id)).map((d: any) => (
                  <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="font-mono text-muted-foreground shrink-0">{d.documentNumber}</span>
                    <span className="truncate flex-1">{d.title}</span>
                    <span className="font-mono text-muted-foreground shrink-0">Rev {d.revision ?? "01"}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedIds(prev => { const next = new Set(prev); next.delete(d.id); return next; })}
                      className="ml-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Remove from transmittal"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {/* Add more documents */}
              {allDocs.filter((d: any) => !selectedIds.has(d.id)).length > 0 && (
                <div className="mt-2">
                  <Select
                    value="_none"
                    onValueChange={(v) => {
                      if (v !== "_none") setSelectedIds(prev => new Set([...prev, parseInt(v)]));
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs border-dashed text-muted-foreground">
                      <SelectValue placeholder="+ Add another document…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none" className="text-xs text-muted-foreground">+ Add another document…</SelectItem>
                      {allDocs.filter((d: any) => !selectedIds.has(d.id)).map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)} className="text-xs">
                          <span className="font-mono text-muted-foreground mr-2">{d.documentNumber}</span>
                          <span className="truncate">{d.title}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <Label>Subject *</Label>
              <Input value={bulkTrsForm.subject} onChange={e => setBulkTrsForm(f => ({ ...f, subject: e.target.value }))} placeholder="Transmittal subject..." className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Purpose</Label>
                <Select value={bulkTrsForm.purpose} onValueChange={v => setBulkTrsForm(f => ({ ...f, purpose: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRS_PURPOSE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To (External)</Label>
                <Input value={bulkTrsForm.toExternal} onChange={e => setBulkTrsForm(f => ({ ...f, toExternal: e.target.value }))} placeholder="Recipient / company" className="mt-1" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Description / Cover Note</Label>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={generateAISummary} disabled={aiSummaryLoading}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiSummaryLoading ? "Generating..." : "AI Summary"}
                </Button>
              </div>
              <Textarea value={bulkTrsForm.description} onChange={e => setBulkTrsForm(f => ({ ...f, description: e.target.value }))} rows={3} className="mt-1" placeholder="Describe the purpose of this transmittal..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkTransOpen(false)}>Cancel</Button>
            <Button onClick={() => createBulkTransmittal.mutate()} disabled={createBulkTransmittal.isPending || !bulkTrsForm.subject || selectedIds.size === 0}>
              {createBulkTransmittal.isPending ? "Creating..." : "Create Transmittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Status Change Dialog */}
      <Dialog open={isBulkAssignOpen} onOpenChange={setIsBulkAssignOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Change Status — {selectedDocs.length} Document(s)</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3">
            <Label>New Status</Label>
            <Select value={bulkAssignStatus} onValueChange={setBulkAssignStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["draft","in_review","approved","rejected","superseded"].map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkAssignOpen(false)}>Cancel</Button>
            <Button onClick={() => bulkUpdateStatus.mutate()} disabled={bulkUpdateStatus.isPending}>
              {bulkUpdateStatus.isPending ? "Updating..." : `Update ${selectedDocs.length} Document(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Documents Table — with optional Folder sidebar */}
      <div className={`bg-card border rounded-xl shadow-sm overflow-hidden ${viewMode === "folder" ? "flex" : ""}`}>
        {viewMode === "folder" && (
          <div className="w-56 shrink-0 border-r bg-muted/20 flex flex-col overflow-hidden">
            <FolderSidebar
              projectId={projectId}
              selectedFolderId={folderViewFolderId}
              onSelectFolder={setFolderViewFolderId}
              canEdit={perms.canEditDocument}
            />
          </div>
        )}
        <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-3 py-1 border-b bg-muted/20">
          {viewMode === "folder" && folderViewFolderId !== null && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <button
                className="hover:text-foreground"
                onClick={() => setFolderViewFolderId(null)}
              >
                <Folder className="h-3.5 w-3.5 inline mr-0.5" /> All
              </button>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">
                {data?.documents?.find((d: any) => d.folderId === folderViewFolderId)?.folderName ?? `Folder ${folderViewFolderId}`}
              </span>
            </div>
          )}
          {viewMode !== "folder" && <span />}
          <div className="flex items-center gap-2 ml-auto">
            <ColumnVisibilityMenu
              columns={DOC_COLUMNS}
              isVisible={isDocColVis}
              toggle={toggleDocCol}
              reset={resetDocCols}
              pinnedKeys={DOC_PINNED}
            />
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
              onClick={resetDocWidths}
              title="Reset column widths"
            >Reset widths</button>
          </div>
        </div>

        {/* ── Quick-access bar: shows when search ≥ 3 chars ─────────────────── */}
        {searchQ.trim().length >= 3 && (() => {
          const q = searchQ.trim().toLowerCase();
          const exactMatch = (allDocs as any[]).find(d => d.documentNumber?.toLowerCase() === q);
          if (exactMatch) {
            return (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                <Check className="h-4 w-4 text-blue-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-200 flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{exactMatch.documentNumber}</span>
                    <span className="text-blue-500/70">—</span>
                    <span className="truncate">{exactMatch.title}</span>
                  </p>
                  <p className="text-xs text-blue-700/70 dark:text-blue-400 mt-0.5">
                    Rev {exactMatch.revision ?? "01"} · {String(exactMatch.status ?? "").replace(/_/g, " ")}
                    {exactMatch.discipline ? ` · ${exactMatch.discipline}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300"
                  onClick={() => setDocPreview(exactMatch)}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </Button>
                {canUploadDocs && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => setNewRevDoc(exactMatch)}
                  >
                    <FilePlus2 className="h-3.5 w-3.5" /> Upload New Revision
                  </Button>
                )}
              </div>
            );
          }
          // Always show "no exact match" when user has typed 3+ chars and no exact match exists.
          // If partial matches exist in the table they will still be visible below.
          return (
            <div className="flex items-center gap-3 px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-900 dark:text-amber-300">
                  No exact match for{" "}
                  <span className="font-mono font-medium">"{searchQ.trim()}"</span>
                  {filtered.length > 0 && (
                    <span className="text-amber-700/70 dark:text-amber-500"> — {filtered.length} partial {filtered.length === 1 ? "result" : "results"} shown below</span>
                  )}
                </p>
              </div>
              {canUploadDocs && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 shrink-0 border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400"
                  onClick={() => setIsUploadOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> Create Document
                </Button>
              )}
            </div>
          );
        })()}

        <div className="overflow-x-auto">
        <Table style={{ tableLayout: "fixed", minWidth: 850 }}>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-10">
                <button onClick={toggleAll} className="p-0.5 rounded hover:bg-accent transition-colors" title={selectedIds.size === filtered.length ? "Deselect all" : "Select all"}>
                  {selectedIds.size > 0 && selectedIds.size === filtered.length
                    ? <CheckSquare className="h-4 w-4 text-primary" />
                    : selectedIds.size > 0
                    ? <CheckSquare className="h-4 w-4 text-primary opacity-60" />
                    : <Square className="h-4 w-4 text-muted-foreground" />
                  }
                </button>
              </TableHead>
              <TableHead style={getDocThStyle("docNum")} className="overflow-hidden">
                <span className="truncate">Document No.</span>
                <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("docNum", e)} onClick={e => e.stopPropagation()} />
              </TableHead>
              <TableHead style={getDocThStyle("title")} className="overflow-hidden">
                <span className="truncate">Title</span>
                <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("title", e)} onClick={e => e.stopPropagation()} />
              </TableHead>
              {isDocColVis("discipline") && (
                <TableHead style={getDocThStyle("discipline")} className="overflow-hidden">
                  <span className="truncate">Discipline</span>
                  <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("discipline", e)} onClick={e => e.stopPropagation()} />
                </TableHead>
              )}
              {isDocColVis("source") && (
                <TableHead style={getDocThStyle("source")} className="overflow-hidden">
                  <span className="truncate">Source</span>
                  <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("source", e)} onClick={e => e.stopPropagation()} />
                </TableHead>
              )}
              {isDocColVis("issuedBy") && (
                <TableHead style={getDocThStyle("issuedBy")} className="overflow-hidden">
                  <span className="truncate">Issued By</span>
                  <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("issuedBy", e)} onClick={e => e.stopPropagation()} />
                </TableHead>
              )}
              {isDocColVis("revision") && (
                <TableHead style={getDocThStyle("revision")} className="overflow-hidden">
                  <span className="truncate">Rev</span>
                  <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("revision", e)} onClick={e => e.stopPropagation()} />
                </TableHead>
              )}
              {isDocColVis("status") && (
                <TableHead style={getDocThStyle("status")} className="overflow-hidden">
                  <span className="truncate">Status</span>
                  <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("status", e)} onClick={e => e.stopPropagation()} />
                </TableHead>
              )}
              {isDocColVis("updatedAt") && (
                <TableHead style={getDocThStyle("updatedAt")} className="overflow-hidden">
                  <span className="truncate">Updated</span>
                  <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50" onMouseDown={e => startDocResize("updatedAt", e)} onClick={e => e.stopPropagation()} />
                </TableHead>
              )}
              <TableHead className="text-right w-[150px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={docColVisCount + 2} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !filtered.length ? (
              <TableRow><TableCell colSpan={docColVisCount + 2} className="text-center py-12 text-muted-foreground">No documents found.</TableCell></TableRow>
            ) : filtered.map((doc: any) => {
              const isSelected = selectedIds.has(doc.id);
              return (
                <TableRow key={doc.id} className={`hover:bg-muted/30 group ${isSelected ? "bg-primary/5" : ""}`}>
                  <TableCell>
                    <button onClick={() => toggleSelect(doc.id)} className="p-0.5 rounded hover:bg-accent">
                      {isSelected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4 text-muted-foreground" />
                      }
                    </button>
                  </TableCell>
                  <TableCell
                    className="font-mono text-xs font-medium cursor-pointer hover:text-primary hover:underline underline-offset-2"
                    onClick={() => navigate(`/documents/${doc.id}`)}
                    title="Open full document page"
                  >{doc.documentNumber}</TableCell>
                  <TableCell
                    className="font-medium cursor-pointer hover:text-primary"
                    onClick={() => setDocPreview(doc)}
                    title="Click to quick preview"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary/70 shrink-0" />
                      <span className="line-clamp-1 hover:underline underline-offset-2" title={doc.title}>{doc.title}</span>
                    </div>
                  </TableCell>
                  {isDocColVis("discipline") && <TableCell className="text-sm">{(doc as any).discipline || "—"}</TableCell>}
                  {isDocColVis("source") && (
                    <TableCell>
                      {doc.source ? (
                        <span className="inline-flex items-center text-xs bg-muted/60 px-2 py-0.5 rounded-full capitalize">
                          {doc.source}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                  )}
                  {isDocColVis("issuedBy") && <TableCell className="text-xs text-muted-foreground max-w-[90px] truncate">{doc.issuedBy || "—"}</TableCell>}
                  {isDocColVis("revision") && <TableCell><span className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{doc.revision ?? "01"}</span></TableCell>}
                  {isDocColVis("status") && <TableCell><StatusBadge status={doc.status} /></TableCell>}
                  {isDocColVis("updatedAt") && <TableCell className="text-sm text-muted-foreground">{format(new Date(doc.updatedAt), "MMM d, yyyy")}</TableCell>}
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Compare revisions" onClick={() => setCompareDoc(doc)}>
                        <GitCompare className="h-4 w-4" />
                      </Button>
                      {(perms.canEditDocument || doc.createdById === user?.id) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit document metadata" onClick={() => {
                          setEditDocDeptIds(new Set());
                          setEditDocOrigDeptIds(new Set());
                          qc.invalidateQueries({ queryKey: ["doc-departments", doc.id] });
                          setEditDoc(doc);
                          setEditForm({ title: doc.title, discipline: doc.discipline ?? "", revision: doc.revision ?? "01", documentType: doc.documentType ?? "general", description: doc.description ?? "", source: doc.source ?? "", issuedBy: doc.issuedBy ?? "", metadata: doc.metadata ?? {} });
                          setEditFile(null);
                        }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {(perms.canEditDocument || doc.createdById === user?.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                          title="Upload new revision"
                          onClick={() => {
                            const suggested = suggestNextRevision(doc.revision ?? "01");
                            setNewRevDoc(doc);
                            setNewRevForm({ revision: suggested, notes: "" });
                            setNewRevFile(null);
                          }}
                        >
                          <FilePlus2 className="h-4 w-4" />
                        </Button>
                      )}
                      {perms.canSubmitForWorkflow && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Create Transmittal" onClick={() => {
                          setWfDoc(doc);
                          setWfForm({ subject: `For Review: ${doc.documentNumber} — ${doc.title}`, purpose: "for_review", toUserIds: [], externalEmails: "", description: "" });
                        }}>
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                      {perms.canSubmitForWorkflow && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Start Workflow" onClick={() => openStartWorkflow(doc)}>
                          <Layers className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Generate share link" onClick={() => {
                        setShareDoc(doc);
                        setDocShareResult(null);
                        setDocShareForm({ expiresInDays: "30", password: "" });
                      }}>
                        <Link2 className="h-4 w-4" />
                      </Button>
                      {(perms.canEditDocument || doc.createdById === user?.id) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Move to folder"
                          onClick={() => setMoveToFolderDoc(doc)}>
                          <FolderInput className="h-4 w-4" />
                        </Button>
                      )}
                      {doc.fileUrl && (
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8" title="Download"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const url = doc.fileUrl as string;
                            const filename = doc.fileName || doc.title || "download";
                            const tok = localStorage.getItem("edms_token");
                            const isInternal = url.startsWith("/api/storage/") || url.startsWith("/objects/");
                            if (!isInternal) { window.open(url, "_blank"); return; }
                            try {
                              const vtr = await fetch(`/api/storage/view-token?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${tok}` } });
                              const { token } = vtr.ok ? await vtr.json() : { token: null };
                              const fetchUrl = token ? `${url}?vt=${token}` : url;
                              const r = await fetch(fetchUrl, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
                              if (!r.ok) throw new Error();
                              const blob = await r.blob();
                              const blobUrl = URL.createObjectURL(blob);
                              const a = document.createElement("a"); a.href = blobUrl; a.download = filename; a.click();
                              setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                            } catch { window.open(url, "_blank"); }
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
        </div>
      </div>

      {/* Edit Document Dialog */}
      <Dialog open={!!editDoc} onOpenChange={v => { if (!v) { setEditDoc(null); setEditFile(null); setEditAdditionalFiles([]); setEditDocDeptIds(new Set()); setEditDocOrigDeptIds(new Set()); } }}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Edit Document</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Title *</Label>
                <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Discipline</Label>
                <Input value={editForm.discipline} onChange={e => setEditForm(f => ({ ...f, discipline: e.target.value }))} className="mt-1" placeholder="E.g. Electrical" />
              </div>
              <div>
                <Label>Revision</Label>
                <Input value={editForm.revision} onChange={e => setEditForm(f => ({ ...f, revision: e.target.value }))} className="mt-1 font-mono" placeholder="01" />
              </div>
              <div>
                <Label>Document Type</Label>
                <Select value={editForm.documentType || "_none"} onValueChange={v => setEditForm(f => ({ ...f, documentType: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select document type…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    {activeDocumentTypes.map((dt: any) => (
                      <SelectItem key={dt.id} value={dt.code}>{dt.name}</SelectItem>
                    ))}
                    {editForm.documentType && !activeDocumentTypes.some((dt: any) => dt.code === editForm.documentType) && (
                      <SelectItem value={editForm.documentType}>{editForm.documentType} (legacy)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Source</Label>
                <Select value={editForm.source || "_none"} onValueChange={v => setEditForm(f => ({ ...f, source: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select source…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    {["internal","external","client","contractor","consultant","supplier"].map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Issued By</Label>
                <Input value={editForm.issuedBy} onChange={e => setEditForm(f => ({ ...f, issuedBy: e.target.value }))} className="mt-1" placeholder="E.g. ABC Engineering" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className="mt-1" rows={3} />
            </div>
            <MetadataFieldsForm
              documentTypeId={activeDocumentTypes.find((dt: any) => dt.code === editForm.documentType)?.id ?? null}
              value={editForm.metadata}
              onChange={(v) => setEditForm(f => ({ ...f, metadata: v }))}
            />
            {/* Departments — Phase B data-only classification */}
            {orgDepts.length > 0 && (
              <div>
                <Label className="mb-2 block flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Departments</Label>
                <div className="flex flex-wrap gap-2">
                  {orgDepts.map((d: any) => {
                    const checked = editDocDeptIds.has(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setEditDocDeptIds(prev => {
                          const next = new Set(prev);
                          if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                          return next;
                        })}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                          checked
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        <span className="font-mono">{d.code}</span>
                        <span>— {d.name}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Click to toggle department classification. No access control applied yet.</p>
              </div>
            )}
            <div>
              <Label className="mb-2 block">Replace Primary File <span className="text-muted-foreground font-normal">(optional — for metadata-only edits leave blank)</span></Label>
              <FileDropZone onUpload={setEditFile} label="Drop replacement file here" />
              {editFile && <p className="text-xs text-muted-foreground mt-1">Staged: {editFile.name}</p>}
              {!editFile && editDoc?.fileName && <p className="text-xs text-muted-foreground mt-1">Current file: {editDoc.fileName}</p>}
              {/* Warning: file staged but revision unchanged — would silently overwrite */}
              {editFile && editForm.revision === (editDoc?.revision ?? "") && (
                <div className="mt-2 flex gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 dark:text-amber-300">
                    <p className="font-semibold">Revision identifier unchanged</p>
                    <p className="mt-0.5">The new file will replace the current one without creating a revision history record. To preserve history, update the <strong>Revision</strong> field above before saving — or use the <strong>Upload New Revision</strong> action instead.</p>
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label className="mb-2 block flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Additional Files</Label>
              <FileDropZone
                onUpload={f => setEditAdditionalFiles(prev => [...prev, f])}
                onMultiUpload={files => setEditAdditionalFiles(prev => [...prev, ...files])}
                label="Attach supporting files"
                multiple
              />
              {(() => {
                const existing: any[] = Array.isArray(editDoc?.additionalFiles) ? editDoc.additionalFiles : [];
                const combined = [...existing.filter((ef: any) => !editAdditionalFiles.find(nf => nf.name === ef.name)), ...editAdditionalFiles];
                if (!combined.length) return null;
                return (
                  <div className="mt-2 space-y-1">
                    {combined.map((f: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1">
                        <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">{f.name}</span>
                        <button type="button" onClick={() => {
                          const isNew = editAdditionalFiles.find(nf => nf.name === f.name);
                          if (isNew) setEditAdditionalFiles(prev => prev.filter(nf => nf.name !== f.name));
                          else if (editDoc) setEditDoc((d: any) => ({ ...d, additionalFiles: (d.additionalFiles || []).filter((_: any, j: number) => j !== i) }));
                        }} className="text-destructive hover:bg-destructive/10 rounded p-0.5 shrink-0">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditDoc(null); setEditFile(null); setEditAdditionalFiles([]); setEditDocDeptIds(new Set()); setEditDocOrigDeptIds(new Set()); }}>Cancel</Button>
            <Button
              onClick={() => {
                const existing: any[] = Array.isArray(editDoc?.additionalFiles) ? editDoc.additionalFiles : [];
                const combined = [...existing.filter((ef: any) => !editAdditionalFiles.find(nf => nf.name === ef.name)), ...editAdditionalFiles];
                updateDoc.mutate({
                  title: editForm.title, discipline: editForm.discipline, revision: editForm.revision,
                  documentType: editForm.documentType, description: editForm.description,
                  source: editForm.source || undefined, issuedBy: editForm.issuedBy || undefined,
                  metadata: editForm.metadata,
                  additionalFiles: combined,
                  ...(editFile ? { fileUrl: editFile.url, fileName: editFile.name, fileSize: editFile.size } : {}),
                });
              }}
              disabled={updateDoc.isPending || !editForm.title}
            >
              {updateDoc.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Revision Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={!!newRevDoc}
        onOpenChange={v => { if (!v) { setNewRevDoc(null); setNewRevFile(null); setNewRevForm({ revision: "", notes: "" }); } }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePlus2 className="h-4 w-4 text-blue-600" /> Upload New Revision
            </DialogTitle>
          </DialogHeader>

          {newRevDoc && (
            <div className="space-y-4 py-1">
              {/* Document context */}
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium truncate">{newRevDoc.title}</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {newRevDoc.documentNumber} · Current rev: <strong>{newRevDoc.revision ?? "01"}</strong>
                </p>
              </div>

              {/* Revision identifier — pre-filled with suggestion, blocked if unchanged */}
              <div>
                <Label>
                  New Revision Identifier <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={newRevForm.revision}
                    onChange={e => setNewRevForm(f => ({ ...f, revision: e.target.value.trim() }))}
                    className="font-mono"
                    placeholder="e.g. 02, B, P02"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-xs"
                    onClick={() => setNewRevForm(f => ({ ...f, revision: suggestNextRevision(newRevDoc.revision ?? "01") }))}
                  >
                    Auto-suggest
                  </Button>
                </div>
                {newRevForm.revision && newRevForm.revision === (newRevDoc.revision ?? "") && (
                  <p className="mt-1.5 text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Must differ from the current revision ({newRevDoc.revision}). Change it before saving.
                  </p>
                )}
                {newRevForm.revision && newRevForm.revision !== (newRevDoc.revision ?? "") && (
                  <p className="mt-1.5 text-xs text-green-700 dark:text-green-400">
                    A new revision history record will be created for revision <strong>{newRevForm.revision}</strong>.
                  </p>
                )}
              </div>

              {/* File upload */}
              <div>
                <Label className="mb-1.5 block">
                  Revised File
                  {newRevFile
                    ? <span className="ml-1.5 text-green-700 dark:text-green-400 font-normal text-xs">✓ attached</span>
                    : <span className="ml-1.5 text-amber-600 font-normal text-xs">not attached</span>
                  }
                </Label>
                <FileDropZone onUpload={setNewRevFile} label="Drop corrected file here, or click to browse" />
                {newRevFile && (
                  <p className="mt-1.5 text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                    <Check className="h-3 w-3 shrink-0" /> {newRevFile.name}
                  </p>
                )}
                {/* Strong warning when no file is staged */}
                {!newRevFile && (
                  <div className="mt-2 flex gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
                      <p className="font-semibold">No file attached</p>
                      <p>The existing file will be carried forward and marked as such in the revision history. This revision will be visually flagged as "no new file uploaded" wherever it appears.</p>
                      <p className="font-medium">Revision notes are required when no file is attached.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Revision notes — optional with file, required without */}
              <div>
                <Label>
                  Revision Notes
                  {!newRevFile
                    ? <span className="text-destructive ml-1">*</span>
                    : <span className="text-muted-foreground font-normal text-xs ml-1">(optional)</span>
                  }
                </Label>
                <Textarea
                  value={newRevForm.notes}
                  onChange={e => setNewRevForm(f => ({ ...f, notes: e.target.value }))}
                  className={`mt-1 ${!newRevFile && !newRevForm.notes.trim() ? "border-amber-300 focus-visible:ring-amber-400" : ""}`}
                  rows={2}
                  placeholder={newRevFile ? "Describe what changed in this revision…" : "Required: explain why no new file is being uploaded…"}
                />
                {!newRevFile && !newRevForm.notes.trim() && (
                  <p className="mt-1 text-xs text-destructive">Notes are required when no file is attached.</p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setNewRevDoc(null); setNewRevFile(null); setNewRevForm({ revision: "", notes: "" }); }}
            >
              Cancel
            </Button>
            <Button
              disabled={
                createRevision.isPending ||
                !newRevForm.revision ||
                newRevForm.revision === (newRevDoc?.revision ?? "") ||
                (!newRevFile && !newRevForm.notes.trim())
              }
              onClick={() => {
                createRevision.mutate({
                  revision: newRevForm.revision,
                  revisionNotes: newRevForm.notes.trim() || undefined,
                  description: newRevDoc?.description,
                  ...(newRevFile ? { fileUrl: newRevFile.url, fileName: newRevFile.name, fileSize: newRevFile.size } : {}),
                });
              }}
            >
              {createRevision.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating…</>
              ) : (
                <><FilePlus2 className="h-3.5 w-3.5 mr-1.5" /> Create Revision {newRevForm.revision || "—"}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Preview Dialog */}
      <Dialog open={!!docPreview} onOpenChange={v => { if (!v) { setDocPreview(null); setPreviewAttachment(null); } }}>
        <DialogContent className="max-w-5xl w-full h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b shrink-0 flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold truncate">{docPreview?.title}</DialogTitle>
                <p className="text-xs text-muted-foreground font-mono">{docPreview?.documentNumber} · Rev {docPreview?.revision ?? "01"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setRevHistoryDoc(docPreview)}>
                <History className="h-3.5 w-3.5" /> Revision History
              </Button>
              <Button
                variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                onClick={() => { setDocPreview(null); navigate(`/documents/${docPreview?.id}`); }}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Full Page
              </Button>
              {docPreview?.fileUrl && (
                <>
                  <Button
                    variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                    onClick={async () => {
                      const url = docPreview.fileUrl;
                      if (!url?.startsWith("/api/storage/")) { window.open(url, "_blank"); return; }
                      const tok = localStorage.getItem("edms_token");
                      const r = await fetch(`/api/storage/view-token?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${tok}` } });
                      if (r.ok) { const { token } = await r.json(); window.open(`${url}?vt=${token}`, "_blank"); }
                      else window.open(url, "_blank");
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open in Tab
                  </Button>
                  <Button
                    variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                    onClick={async () => {
                      const url = docPreview.fileUrl;
                      const filename = docPreview.fileName || docPreview.title || "download";
                      if (!url?.startsWith("/api/storage/")) {
                        const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); return;
                      }
                      const tok = localStorage.getItem("edms_token");
                      try {
                        const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
                        if (!r.ok) throw new Error();
                        const blob = await r.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement("a"); a.href = blobUrl; a.download = filename; a.click();
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                      } catch { window.open(url, "_blank"); }
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5" /> Download
                  </Button>
                </>
              )}
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-row">
            {/* Main preview area */}
            <div className="flex-1 overflow-hidden bg-muted/30">
              {docPreview && (
                <DocumentPreviewContent
                  key={previewAttachment?.fileUrl ?? (docPreview.fileUrl ?? "no-file")}
                  doc={docPreview}
                  overrideFile={previewAttachment}
                />
              )}
            </div>
            {/* Attachments side panel */}
            {docPreview && (
              <div className="w-72 border-l bg-card overflow-y-auto p-3 shrink-0 flex flex-col gap-3">
                {previewAttachment && (
                  <button
                    className="text-xs text-primary flex items-center gap-1 hover:underline"
                    onClick={() => setPreviewAttachment(null)}
                  >
                    ← Back to main document file
                  </button>
                )}
                <DocumentFilesPanel
                  documentId={docPreview.id}
                  projectId={projectId}
                  canEdit={perms.canEditDocument || docPreview?.createdById === user?.id}
                  onPreview={file => setPreviewAttachment({ fileUrl: file.fileUrl, fileName: file.fileName, fileType: file.fileType })}
                  activeFileUrl={previewAttachment?.fileUrl ?? null}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Revision History Sheet */}
      <RevisionHistorySheet
        doc={revHistoryDoc}
        projectId={projectId}
        open={!!revHistoryDoc}
        onClose={() => setRevHistoryDoc(null)}
      />

      <Dialog open={!!shareDoc} onOpenChange={v => { if (!v) { setShareDoc(null); setDocShareResult(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Share Document</DialogTitle></DialogHeader>
          {shareDoc && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">{shareDoc.documentNumber} — {shareDoc.title}</p>
              {docShareResult ? (
                <div className="space-y-3">
                  <div className="bg-muted rounded-md p-2 text-xs font-mono break-all text-muted-foreground">{docShareResult.shareUrl}</div>
                  {docShareResult.expiresAt && <p className="text-xs text-amber-600">Expires: {format(new Date(docShareResult.expiresAt), "dd MMM yyyy HH:mm")}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-xs" onClick={() => { navigator.clipboard.writeText(docShareResult.shareUrl); toast({ title: "Link copied" }); }}>
                      Copy Link
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => { setDocShareResult(null); revokeDocShare.mutate(shareDoc.id); }}>
                      Revoke
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">Expires in (days)</Label>
                      <Input type="number" min="1" max="365" value={docShareForm.expiresInDays} onChange={e => setDocShareForm(f => ({ ...f, expiresInDays: e.target.value }))} placeholder="30 (never if blank)" className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Password (optional)</Label>
                      <Input type="password" value={docShareForm.password} onChange={e => setDocShareForm(f => ({ ...f, password: e.target.value }))} placeholder="Leave blank for none" className="h-8 text-sm" />
                    </div>
                  </div>
                  <Button className="w-full gap-1.5" onClick={() => createDocShare.mutate({ id: shareDoc.id, ...docShareForm })} disabled={createDocShare.isPending}>
                    {createDocShare.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</> : <><Link2 className="h-3.5 w-3.5" /> Generate Secure Link</>}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => { setShareDoc(null); setDocShareResult(null); }}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Transmittal Dialog */}
      <Dialog open={!!wfDoc} onOpenChange={v => { if (!v) setWfDoc(null); }}>
        <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Create Transmittal</DialogTitle>
          </DialogHeader>
          {wfDoc && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg px-3 py-2 flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none truncate">{wfDoc.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{wfDoc.documentNumber} · Rev {wfDoc.revision ?? "01"}</p>
                </div>
              </div>
              <div>
                <Label>Purpose</Label>
                <Select value={wfForm.purpose} onValueChange={v => setWfForm(f => ({ ...f, purpose: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRS_PURPOSE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Subject</Label>
                <Input value={wfForm.subject} onChange={e => setWfForm(f => ({ ...f, subject: e.target.value }))} className="mt-1" placeholder="Transmittal subject…" />
              </div>
              <div>
                <Label>To (Internal Recipients)</Label>
                <RecipientAutocomplete
                  users={allUsers}
                  selectedIds={wfForm.toUserIds}
                  onChange={ids => setWfForm(f => ({ ...f, toUserIds: ids }))}
                  placeholder="Search by name or email…"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>External Recipients</Label>
                <Input value={wfForm.externalEmails} onChange={e => setWfForm(f => ({ ...f, externalEmails: e.target.value }))} placeholder="alice@firm.com, bob@client.com" className="mt-1 text-sm" />
                <p className="text-xs text-muted-foreground mt-1">Separate multiple emails with commas.</p>
              </div>
              <div>
                <Label>Cover Note / Instructions</Label>
                <Textarea value={wfForm.description} onChange={e => setWfForm(f => ({ ...f, description: e.target.value }))} rows={3} className="mt-1" placeholder="Optional instructions…" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWfDoc(null)}>Cancel</Button>
            <Button
              onClick={() => sendForWorkflow.mutate()}
              disabled={sendForWorkflow.isPending || (!wfForm.toUserIds.length && !wfForm.externalEmails)}
              className="gap-1.5"
            >
              {sendForWorkflow.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</> : <><Send className="h-3.5 w-3.5" /> Create Transmittal</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Start Workflow Dialog */}
      <Dialog open={!!wfEngineDoc} onOpenChange={v => { if (!v) setWfEngineDoc(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Start Workflow</DialogTitle>
          </DialogHeader>
          {wfEngineDoc && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg px-3 py-2 flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none truncate">{wfEngineDoc.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{wfEngineDoc.documentNumber} · Rev {wfEngineDoc.revision ?? "01"}</p>
                  {wfEngineDoc.documentType && (
                    <p className="text-xs text-muted-foreground">Type: {wfEngineDoc.documentType}</p>
                  )}
                </div>
              </div>
              {wfEngineLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
                </div>
              ) : wfEngineTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active workflow templates found.{" "}
                  <a href="/workflow-engine" className="text-primary hover:underline">
                    Create one in the Workflow Engine.
                  </a>
                </p>
              ) : (
                <div>
                  <Label className="text-xs">Workflow Template</Label>
                  <Select
                    value={wfEngineTemplateId ? String(wfEngineTemplateId) : (wfEngineTemplates[0] ? String(wfEngineTemplates[0].id) : "")}
                    onValueChange={v => setWfEngineTemplateId(parseInt(v))}
                  >
                    <SelectTrigger className="mt-1 w-full"><SelectValue placeholder="Select a template" /></SelectTrigger>
                    <SelectContent>
                      {wfEngineTemplates.map((t: any) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}{t.documentType ? ` (${t.documentType})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const selected = wfEngineTemplates.find((t: any) => t.id === (wfEngineTemplateId ?? wfEngineTemplates[0]?.id));
                    return selected?.stages?.length ? (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Stages: {selected.stages.map((s: any) => s.name).join(" → ")}
                      </p>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWfEngineDoc(null)}>Cancel</Button>
            <Button
              onClick={startWorkflowEngine}
              disabled={wfEngineStarting || wfEngineLoading || wfEngineTemplates.length === 0}
              className="gap-1.5"
            >
              {wfEngineStarting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</> : <><Layers className="h-3.5 w-3.5" /> Start Workflow</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selection summary bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-primary text-white rounded-full shadow-lg px-5 py-2.5 flex items-center gap-4 text-sm font-medium">
          <CheckSquare className="h-4 w-4" />
          {selectedIds.size} document{selectedIds.size !== 1 ? "s" : ""} selected
          <button onClick={() => onCreateTransmittal?.(Array.from(selectedIds))} className="px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-xs gap-1 flex items-center">
            <Send className="h-3.5 w-3.5" /> Transmit
          </button>
          <button onClick={clearSelection} className="text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}


      {/* Compare Revisions Dialog */}
      {compareDoc && (
        <CompareRevisionsDialog
          doc={compareDoc}
          projectId={projectId}
          open={!!compareDoc}
          onClose={() => setCompareDoc(null)}
        />
      )}

      {/* AI Validation Dialog */}
      <Dialog open={validateOpen} onOpenChange={v => { setValidateOpen(v); if (!v) setValidationResult(null); }}>
        <DialogContent className="sm:max-w-[640px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-500" />AI Document Control Validation</DialogTitle>
          </DialogHeader>
          {validating ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analysing {allDocs.length} document(s) for compliance issues...</p>
            </div>
          ) : validationResult ? (
            <div className="space-y-4 py-2">
              <div className="p-3 bg-muted/50 rounded-lg text-sm">{validationResult.summary}</div>
              {validationResult.issues?.length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2 text-emerald-600">
                  <Check className="h-8 w-8" />
                  <p className="font-medium">All documents pass validation checks</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{validationResult.issues.length} issue(s) found:</p>
                  {validationResult.issues.map((issue: any, i: number) => (
                    <div key={i} className={`p-3 rounded-lg border-l-4 text-sm ${
                      issue.severity === "error" ? "border-red-500 bg-red-50 dark:bg-red-950/20" :
                      issue.severity === "warning" ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" :
                      "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
                    }`}>
                      <div className="flex items-start gap-2">
                        <AlertCircle className={`h-4 w-4 mt-0.5 shrink-0 ${issue.severity === "error" ? "text-red-500" : issue.severity === "warning" ? "text-amber-500" : "text-blue-500"}`} />
                        <div>
                          <p className="font-medium">{issue.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{issue.detail}</p>
                          {issue.document && <p className="text-xs font-mono mt-1 opacity-70">{issue.document}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setValidateOpen(false)}>Close</Button>
            {!validating && <Button onClick={runValidation} variant="outline" className="gap-2"><RefreshCw className="h-4 w-4" />Re-run</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={!!moveToFolderDoc} onOpenChange={open => !open && setMoveToFolderDoc(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FolderInput className="h-4 w-4" /> Move to Folder</DialogTitle>
          </DialogHeader>
          {moveToFolderDoc && (
            <div className="space-y-4 py-1">
              <div className="bg-muted/40 rounded-lg p-3 border">
                <p className="font-mono font-semibold text-primary text-xs">{moveToFolderDoc.documentNumber}</p>
                <p className="text-muted-foreground text-xs mt-0.5 truncate">{moveToFolderDoc.title}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Select destination folder</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={moveToFolderDoc.folderId ? String(moveToFolderDoc.folderId) : "_root"}
                  onChange={e => {
                    const val = e.target.value;
                    moveToFolderMut.mutate({ docId: moveToFolderDoc.id, folderId: val === "_root" ? null : Number(val) });
                  }}
                >
                  <option value="_root">— Root (no folder) —</option>
                  {pickerFolders.map((f: any) => (
                    <option key={f.id} value={String(f.id)}>{f.name}</option>
                  ))}
                </select>
                {pickerFolders.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-2">No folders in this project yet. Create folders from the Folders panel.</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveToFolderDoc(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Compare Revisions Dialog ──────────────────────────────────────────────────
function CompareRevisionsDialog({ doc, projectId, open, onClose }: { doc: any; projectId: number; open: boolean; onClose: () => void }) {
  const [revA, setRevA] = useState<string>("");
  const [revB, setRevB] = useState<string>("");
  const [aiComparison, setAiComparison] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);

  const { data: revisionsData } = useQuery({
    queryKey: ["revisions", doc.id],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${doc.id}/revisions`);
      return r.json();
    },
    enabled: open,
  });
  const revisions: any[] = revisionsData?.revisions ?? [];

  const revAData = revisions.find((r: any) => r.revision === revA);
  const revBData = revisions.find((r: any) => r.revision === revB) ?? { ...doc, revision: "current" };

  const FIELDS = [
    { label: "Revision", key: "revision" },
    { label: "Status", key: "status" },
    { label: "File Name", key: "fileName" },
    { label: "Comment", key: "comment" },
  ];

  const generateComparison = async () => {
    setComparing(true);
    try {
      const r = await fetch("/api/ai/compare-revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: doc.title, revisionA: revAData, revisionB: revBData }),
      });
      const d = await r.json();
      setAiComparison(d.summary || "Unable to generate comparison at this time.");
    } catch {
      setAiComparison("Unable to generate AI comparison. Check that the AI service is configured.");
    } finally {
      setComparing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-[680px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            Compare Revisions — {doc.documentNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground font-medium">{doc.title}</p>

          {revisions.length < 2 ? (
            <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
              <Diff className="h-8 w-8 opacity-30" />
              <p className="text-sm">This document needs at least 2 revisions to compare.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Revision A (older)</label>
                  <Select value={revA} onValueChange={setRevA}>
                    <SelectTrigger><SelectValue placeholder="Select revision" /></SelectTrigger>
                    <SelectContent>
                      {revisions.map((r: any) => (
                        <SelectItem key={r.id} value={r.revision}>Rev {r.revision} — {r.createdByName ?? "System"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Revision B (newer)</label>
                  <Select value={revB} onValueChange={setRevB}>
                    <SelectTrigger><SelectValue placeholder="Select revision" /></SelectTrigger>
                    <SelectContent>
                      {revisions.map((r: any) => (
                        <SelectItem key={r.id} value={r.revision}>Rev {r.revision} — {r.createdByName ?? "System"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {revA && revB && revA !== revB && (
                <>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 pl-3 font-medium text-xs">Field</th>
                          <th className="text-left p-2 font-medium text-xs">Rev {revA}</th>
                          <th className="text-left p-2 font-medium text-xs">Rev {revB}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {FIELDS.map(({ label, key }) => {
                          const aVal = revAData?.[key] ?? "—";
                          const bVal = revBData?.[key] ?? "—";
                          const changed = aVal !== bVal;
                          return (
                            <tr key={key} className={`border-t ${changed ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                              <td className="p-2 pl-3 text-muted-foreground font-medium">{label}</td>
                              <td className={`p-2 font-mono text-xs ${changed ? "line-through text-red-500/70" : ""}`}>{String(aVal)}</td>
                              <td className={`p-2 font-mono text-xs ${changed ? "text-emerald-600 font-medium" : ""}`}>{String(bVal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {aiComparison ? (
                    <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm">
                      <p className="font-medium text-primary mb-1 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> AI Summary</p>
                      <p className="text-muted-foreground">{aiComparison}</p>
                    </div>
                  ) : (
                    <Button variant="outline" className="gap-2 w-full" onClick={generateComparison} disabled={comparing}>
                      <Sparkles className="h-4 w-4" />
                      {comparing ? "Generating AI summary..." : "Generate AI Comparison Summary"}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Transmittals Tab ─────────────────────────────────────────────────────────
const TRS_PURPOSE_LABELS: Record<string, string> = {
  for_information: "For Information",
  for_review:      "For Review",
  for_approval:    "For Approval",
  for_action:      "For Action",
  for_construction:"For Construction",
  for_record:      "For Record / Filing",
};

/**
 * ADR — ABCD Review Codes
 * ABCD codes are document-level review outcomes assigned during transmittal review.
 * They apply to individual transmittal items (documents), NOT to the transmittal itself.
 * The transmittal's overall "Review Outcome" is the rolled-up worst-code result.
 * A = Approved (no changes required)
 * B = Approved as Noted (minor comments, no resubmission required)
 * C = Revise & Resubmit (significant comments, new revision must be issued)
 * D = Rejected (document rejected, full revision required)
 */
const TRS_REVIEW_CODES: { value: string; label: string; desc: string; cls: string }[] = [
  { value: "A", label: "A — Approved",           desc: "Approved — no changes required. Document is accepted as submitted.", cls: "bg-emerald-100 text-emerald-800" },
  { value: "B", label: "B — Approved as Noted",  desc: "Approved as Noted — minor comments only, no resubmission required.", cls: "bg-teal-100 text-teal-800" },
  { value: "C", label: "C — Revise & Resubmit",  desc: "Revise & Resubmit — significant comments, a revised document must be issued.", cls: "bg-amber-100 text-amber-800" },
  { value: "D", label: "D — Rejected",            desc: "Rejected — document does not meet requirements, full revision required.", cls: "bg-red-100 text-red-800" },
];

function TrsReviewPill({ code }: { code?: string | null }) {
  if (!code) return <span className="text-muted-foreground text-xs">—</span>;
  const entry = TRS_REVIEW_CODES.find(r => r.value === code);
  if (!entry) return <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{code}</span>;
  return (
    <span
      title={entry.desc}
      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap cursor-help ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}

function TrsDirectionBadge({ direction }: { direction?: string | null }) {
  if (!direction) return <span className="text-muted-foreground text-xs">—</span>;
  const isIn = direction === "incoming";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full font-semibold ${isIn ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400"}`}>
      {isIn ? "↓ Incoming" : "↑ Outgoing"}
    </span>
  );
}

const TRS_OUTCOME_CONFIG: Record<string, { label: string; cls: string }> = {
  A: { label: "Approved",               cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  B: { label: "Approved with Comments", cls: "bg-teal-100 text-teal-800 border-teal-200" },
  C: { label: "Revise & Resubmit",      cls: "bg-amber-100 text-amber-800 border-amber-200" },
  D: { label: "Rejected",               cls: "bg-red-100 text-red-800 border-red-200" },
};

function TrsReviewOutcomeBadge({ outcome }: { outcome?: string | null }) {
  if (!outcome) return null;
  const cfg = TRS_OUTCOME_CONFIG[outcome] ?? { label: outcome, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${cfg.cls}`}>
      <ClipboardCheck className="h-3.5 w-3.5" />
      Review Outcome: {outcome} — {cfg.label}
    </span>
  );
}

const TRS_COLUMNS: ColumnDef[] = [
  { key: "trsNo",     label: "TRS No." },
  { key: "subject",   label: "Subject" },
  { key: "purpose",   label: "Purpose" },
  { key: "to",        label: "To" },
  { key: "direction", label: "Direction" },
  { key: "status",    label: "Review Outcome" },
  { key: "due",       label: "Due" },
  { key: "actions",   label: "Actions" },
];
const TRS_PINNED = ["trsNo", "actions"];

// ─── CreateTransmittalDialog ─────────────────────────────────────────────────
// Self-contained component. Receives a key= prop from TransmittalsTab so React
// fully re-mounts (and resets all state) each time the dialog is opened.
function CreateTransmittalDialog({
  open, onClose, initialDocIds, projectId, projectName, projectCode,
}: {
  open: boolean;
  onClose: () => void;
  initialDocIds: number[];
  projectId: number;
  projectName?: string;
  projectCode?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    subject: "", description: "", purpose: "for_information",
    toExternal: "", dueDate: "", direction: "outgoing",
  });
  const [toEmails, setToEmails] = useState("");
  const [ccEmails, setCcEmails] = useState("");
  const [docIds, setDocIds] = useState<number[]>(initialDocIds);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data: docsData } = useListDocuments(projectId);
  const documents: any[] = unwrapList<any>(docsData, "documents");

  const { data: usersRaw } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });
  const userList: RecipientUser[] = unwrapList<RecipientUser>(usersRaw, "users").map((u: any) => ({
    id: u.id, firstName: u.firstName ?? "", lastName: u.lastName ?? "",
    email: u.email, organizationName: u.organizationName, role: u.role,
  }));

  const pickerDocs = documents.filter(d =>
    !docIds.includes(d.id) && (
      !docSearch ||
      d.documentNumber?.toLowerCase().includes(docSearch.toLowerCase()) ||
      d.title?.toLowerCase().includes(docSearch.toLowerCase())
    )
  );

  async function uploadAttachments(transmittalId: number) {
    const orgId = user?.organizationId;
    for (const file of pendingFiles) {
      try {
        const token = localStorage.getItem("edms_token");
        const urlRes = await fetch("/api/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
          body: JSON.stringify({ orgId, projectId, fileType: "attachment", filename: file.name }),
        });
        if (!urlRes.ok) continue;
        const { uploadURL } = await urlRes.json();
        await new Promise<void>(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadURL);
          if (uploadURL.startsWith("/") || uploadURL.includes(window.location.host)) {
            if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          }
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.onload = () => resolve();
          xhr.onerror = () => resolve();
          xhr.send(file);
        });
        const fileUrl = uploadURL.split("?")[0];
        await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}/upload-attachment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileUrl, fileSize: file.size }),
        });
      } catch { /* non-fatal */ }
    }
  }

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          externalEmails: toEmails || undefined,
          ccEmails: ccEmails || undefined,
          documentIds: docIds,
        }),
      });
      if (!r.ok) throw new Error("Failed to create transmittal");
      return r.json();
    },
    onSuccess: async (data) => {
      if (pendingFiles.length > 0) {
        setUploading(true);
        try { await uploadAttachments(data.id); } finally { setUploading(false); }
      }
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      onClose();
      toast({ title: "Transmittal created" });
    },
    onError: () => toast({ title: "Failed to create transmittal", variant: "destructive" }),
  });

  return (
    <>
      {/* ── Document picker popup ───────────────────────────────────── */}
      <Dialog open={docPickerOpen} onOpenChange={v => { setDocPickerOpen(v); if (!v) setDocSearch(""); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Attach Project Document
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input
              placeholder="Search by title or document number…"
              value={docSearch}
              onChange={e => setDocSearch(e.target.value)}
              className="h-9"
              autoFocus
            />
            <div className="h-60 overflow-y-auto border rounded-lg">
              {pickerDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">{docSearch ? "No matching documents" : (documents.length === 0 ? "No documents in this project" : "All documents already attached")}</p>
                </div>
              ) : (
                <div className="p-1">
                  {pickerDocs.map((doc: any) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => {
                        setDocIds(prev => [...prev, doc.id]);
                        setDocPickerOpen(false);
                        setDocSearch("");
                      }}
                      className="w-full flex items-start gap-3 px-3 py-2 rounded-md hover:bg-accent text-left transition-colors"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.title}</p>
                        <p className="text-xs text-muted-foreground font-mono">{doc.documentNumber} · Rev {doc.revision ?? "01"}</p>
                      </div>
                      <Plus className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDocPickerOpen(false); setDocSearch(""); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Main transmittal form ───────────────────────────────────── */}
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-[620px] flex flex-col max-h-[90vh] p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle>Create Transmittal</DialogTitle>
            {(projectName || projectCode) && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Project: <span className="font-medium text-foreground">{projectCode ? `[${projectCode}]` : ""} {projectName ?? ""}</span>
              </p>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

            <div>
              <Label>Subject *</Label>
              <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Transmittal subject" className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Purpose</Label>
                <Select value={form.purpose} onValueChange={v => setForm(f => ({ ...f, purpose: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRS_PURPOSE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="mt-1" />
              </div>
            </div>

            <div>
              <Label>To (Company / Organisation)</Label>
              <Input value={form.toExternal} onChange={e => setForm(f => ({ ...f, toExternal: e.target.value }))} placeholder="e.g. ABC Contractors, Client Name…" className="mt-1" />
            </div>

            <div>
              <Label>To (Email Recipients)</Label>
              <div className="mt-1">
                <EmailChipInput
                  users={userList}
                  value={toEmails}
                  onChange={setToEmails}
                  placeholder="Type name or email and press Enter…"
                />
              </div>
            </div>

            <div>
              <Label>CC</Label>
              <div className="mt-1">
                <EmailChipInput
                  users={userList}
                  value={ccEmails}
                  onChange={setCcEmails}
                  placeholder="Type name or email and press Enter…"
                />
              </div>
            </div>

            {/* ── Project Documents ───────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label>Project Documents</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Official documents from the project register</p>
                </div>
                <Button
                  type="button" variant="outline" size="sm"
                  className="h-7 text-xs gap-1.5 shrink-0"
                  onClick={() => { setDocSearch(""); setDocPickerOpen(true); }}
                >
                  <Link2 className="h-3 w-3" /> Attach Document
                </Button>
              </div>
              {docIds.length > 0 ? (
                <div className="border rounded-lg divide-y overflow-hidden bg-background">
                  {docIds.map(id => {
                    const d = documents.find((doc: any) => doc.id === id);
                    if (!d) return null;
                    return (
                      <div key={id} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium block truncate">{d.title}</span>
                          <span className="text-muted-foreground font-mono text-[10px]">{d.documentNumber} · Rev {d.revision ?? "01"}</span>
                        </div>
                        <button type="button" title="Remove"
                          onClick={() => setDocIds(prev => prev.filter(x => x !== id))}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors ml-1">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setDocSearch(""); setDocPickerOpen(true); }}
                  className="w-full border border-dashed rounded-lg px-4 py-5 flex flex-col items-center gap-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                >
                  <FileText className="h-6 w-6 opacity-40" />
                  <span className="text-xs">Click to attach project documents</span>
                </button>
              )}
            </div>

            {/* ── Additional Attachments ──────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label>Additional Attachments</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">External files not in the project register</p>
                </div>
              </div>
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files ?? []);
                  setPendingFiles(prev => [...prev, ...files]);
                  e.target.value = "";
                }} />
              {pendingFiles.length > 0 && (
                <div className="border rounded-lg divide-y overflow-hidden bg-background mb-2">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-muted-foreground shrink-0 text-[10px]">{(f.size / 1024).toFixed(0)} KB</span>
                      <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors ml-1">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-8"
                onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="h-3.5 w-3.5" /> Attach Files
              </Button>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional notes for recipients..." className="mt-1" rows={3} />
            </div>

          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0 bg-background">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || uploading || !form.subject}>
              {create.isPending || uploading ? "Creating…" : "Create Transmittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransmittalsTab({ projectId, projectName, projectCode, prefillDocIds, onPrefillConsumed, partyRole }: {
  projectId: number;
  projectName: string;
  projectCode: string;
  prefillDocIds?: number[] | null;
  onPrefillConsumed?: () => void;
  partyRole?: PartyRole | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const perms = usePermissions();
  // Phase 6C: party ceiling replaces role gating for party members (backend enforces either way).
  // Send stays hidden for party members: POST /:id/send is role-gated (admin/PM/DC) on the backend.
  const canCreateTrs = partyRole ? partyAllows(partyRole, "create_transmittal") : perms.canCreateTransmittal;
  const canAcknowledgeTrs = partyRole ? partyAllows(partyRole, "acknowledge_transmittal") : true;
  const canSendTrs = partyRole ? false : perms.canSendTransmittal;
  const { isVisible: isColVis, toggle: toggleCol, reset: resetCols, visibleCount: trsColCount } =
    useColumnVisibility(`trs-${projectId}`, TRS_COLUMNS);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [createInitialDocs, setCreateInitialDocs] = useState<number[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareForm, setShareForm] = useState({ expiresInDays: "30", password: "" });
  const [shareResult, setShareResult] = useState<{ shareUrl: string; expiresAt: string | null } | null>(null);
  const [directionFilter, setDirectionFilter] = useState("all");

  function openCreate(docIds: number[] = []) {
    setCreateInitialDocs(docIds);
    setCreateKey(k => k + 1);
    setCreateOpen(true);
  }

  // Auto-open create dialog when Documents tab hands off pre-selected docs
  useEffect(() => {
    if (prefillDocIds && prefillDocIds.length > 0) {
      openCreate(prefillDocIds);
      onPrefillConsumed?.();
    }
  }, [prefillDocIds]);
  const [addItemDocId, setAddItemDocId] = useState("_none");

  const { data: transmittalsData, isLoading, isError: isTrsError, error: trsError } = useQuery({
    queryKey: ["transmittals", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw Object.assign(new Error(body.message ?? "Failed to load transmittals"), { code: body.error, status: r.status });
      }
      return r.json();
    },
  });
  const allTransmittals: any[] = Array.isArray(transmittalsData) ? transmittalsData : Array.isArray(transmittalsData?.transmittals) ? transmittalsData.transmittals : [];
  const transmittals = allTransmittals.filter((t: any) =>
    directionFilter === "all" || (t.direction ?? "") === directionFilter
  );

  // Full detail query (with items) when detail sheet is open
  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["transmittal-detail", selected?.id],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${selected!.id}`);
      return r.json();
    },
    enabled: !!selected?.id && detailOpen,
  });
  const detailItems: any[] = detailData?.items ?? [];

  const { data: docsData } = useListDocuments(projectId);
  const documents = unwrapList<any>(docsData, "documents");

  const addItemMutation = useMutation({
    mutationFn: async ({ transmittalId, documentId }: { transmittalId: number; documentId: number }) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (!r.ok) throw new Error("Failed to add item");
      return r.json();
    },
    onSuccess: () => { refetchDetail(); setAddItemDocId("_none"); toast({ title: "Document added to transmittal" }); },
    onError: () => toast({ title: "Failed to add item", variant: "destructive" }),
  });

  const removeItemMutation = useMutation({
    mutationFn: async ({ transmittalId, itemId }: { transmittalId: number; itemId: number }) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}/items/${itemId}`, { method: "DELETE" });
      return r.json();
    },
    onSuccess: () => { refetchDetail(); toast({ title: "Item removed" }); },
  });

  const sendTransmittal = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${id}/send`, { method: "POST" });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      toast({ title: "Transmittal sent" });
    },
  });

  const ackTransmittal = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${id}/acknowledge`, { method: "POST" });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      toast({ title: "Transmittal acknowledged" });
    },
  });

  const [reviewComment, setReviewComment] = useState("");

  const completeReview = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${id}/complete-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewComment: reviewComment.trim() || undefined }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      qc.invalidateQueries({ queryKey: ["transmittal-detail", selected?.id] });
      setReviewComment("");
      const outcomeLabel: Record<string, string> = {
        A: "Approved ✓", B: "Approved with Comments", C: "Revise & Resubmit", D: "Rejected",
      };
      toast({
        title: `Review submitted — ${outcomeLabel[data.reviewOutcome] ?? data.reviewOutcome}`,
        description: `Response draft ${data.responseTrs?.transmittalNumber} created automatically`,
      });
    },
    onError: (e: any) => toast({ title: "Could not complete review", description: e.message, variant: "destructive" }),
  });

  const createShareLink = useMutation({
    mutationFn: async ({ id, expiresInDays, password }: { id: number; expiresInDays: string; password: string }) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiresInDays: expiresInDays ? parseInt(expiresInDays) : null,
          password: password || undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed to create share link");
      return r.json();
    },
    onSuccess: (data) => {
      setShareResult(data);
      toast({ title: "Secure share link created" });
    },
    onError: () => toast({ title: "Failed to create share link", variant: "destructive" }),
  });

  const revokeShareLink = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${id}/share`, { method: "DELETE" });
      return r.json();
    },
    onSuccess: () => {
      setShareResult(null);
      toast({ title: "Share link revoked" });
    },
  });

  const setItemReviewCode = async (itemId: number, reviewCode: string | null) => {
    await fetch(`/api/projects/${projectId}/transmittals/${selected!.id}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewCode }),
    });
    refetchDetail();
  };

  if (isTrsError) {
    const isModuleDisabled = (trsError as any)?.code === "MODULE_DISABLED";
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Send className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-semibold text-base">
          {isModuleDisabled ? "Transmittals not available on your plan" : "Could not load transmittals"}
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {isModuleDisabled
            ? "The Transmittals register requires a Professional plan or higher. Contact your administrator to upgrade."
            : (trsError as any)?.message ?? "An unexpected error occurred. Please refresh and try again."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-lg">Transmittals</h3>
          <p className="text-sm text-muted-foreground">{allTransmittals.length} transmittal(s) in this project</p>
        </div>
        {canCreateTrs && (
          <Button onClick={() => openCreate()} className="gap-2">
            <Plus className="h-4 w-4" /> New Transmittal
          </Button>
        )}
      </div>

      {/* Direction filter chips + column visibility */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Direction:</span>
        {[["all","All"], ["outgoing","↑ Outgoing"], ["incoming","↓ Incoming"]].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setDirectionFilter(val)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${directionFilter === val ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted"}`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto">
          <ColumnVisibilityMenu
            columns={TRS_COLUMNS}
            isVisible={isColVis}
            toggle={toggleCol}
            reset={resetCols}
            pinnedKeys={TRS_PINNED}
          />
        </div>
      </div>

      <CreateTransmittalDialog
        key={createKey}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initialDocIds={createInitialDocs}
        projectId={projectId}
        projectName={projectName}
        projectCode={projectCode}
      />

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[120px]">TRS No.</TableHead>
              {isColVis("subject")   && <TableHead>Subject</TableHead>}
              {isColVis("purpose")   && <TableHead className="w-[140px]">Purpose</TableHead>}
              {isColVis("to")        && <TableHead className="w-[140px]">To</TableHead>}
              {isColVis("direction") && <TableHead className="w-[100px]">Direction</TableHead>}
              {isColVis("status")    && <TableHead className="w-[90px]">Status</TableHead>}
              {isColVis("due")       && <TableHead className="w-[90px]">Due</TableHead>}
              <TableHead className="w-[110px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={trsColCount} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !transmittals.length ? (
              <TableRow><TableCell colSpan={trsColCount} className="text-center py-12 text-muted-foreground">
                {directionFilter !== "all" ? "No transmittals matching this direction filter." : "No transmittals yet. Create the first one."}
              </TableCell></TableRow>
            ) : transmittals.map((t: any) => {
              const isOverdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "acknowledged";
              return (
                <TableRow key={t.id} className={`hover:bg-muted/30 ${isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
                  <TableCell className="font-mono text-xs font-medium">{t.transmittalNumber}</TableCell>
                  {isColVis("subject") && (
                    <TableCell className="max-w-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="line-clamp-1 min-w-0">{t.subject}</span>
                        {t.reviewOutcome && (() => {
                          const cfg = TRS_OUTCOME_CONFIG[t.reviewOutcome];
                          return cfg ? (
                            <span className={`shrink-0 inline-block text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${cfg.cls}`}>
                              {t.reviewOutcome}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </TableCell>
                  )}
                  {isColVis("purpose")   && <TableCell className="text-xs">{TRS_PURPOSE_LABELS[t.purpose] ?? (t.purpose || "").replace(/_/g, " ")}</TableCell>}
                  {isColVis("to")        && <TableCell className="text-xs text-muted-foreground">{t.toExternal || "—"}</TableCell>}
                  {isColVis("direction") && <TableCell><TrsDirectionBadge direction={t.direction} /></TableCell>}
                  {isColVis("status")    && <TableCell><StatusBadge status={t.status} /></TableCell>}
                  {isColVis("due") && (
                    <TableCell>
                      {t.dueDate ? (
                        <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {format(new Date(t.dueDate), "dd MMM yy")}
                        </span>
                      ) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setSelected(t); setDetailOpen(true); }}>
                        <Eye className="h-3 w-3" /> Detail
                      </Button>
                      {t.status === "draft" && canSendTrs && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => sendTransmittal.mutate(t.id)}>
                          <Send className="h-3 w-3" /> Send
                        </Button>
                      )}
                      {t.status === "sent" && canAcknowledgeTrs && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-600" onClick={() => ackTransmittal.mutate(t.id)}>
                          <Check className="h-3 w-3" /> Acknowledge
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Transmittal Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={v => { setDetailOpen(v); if (!v) setSelected(null); }}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4" /> {selected?.transmittalNumber}
            </SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="space-y-1">
                <h3 className="font-semibold">{selected.subject}</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={selected.status} />
                  <TrsDirectionBadge direction={selected.direction} />
                  <span className="text-xs text-muted-foreground">{TRS_PURPOSE_LABELS[selected.purpose] ?? (selected.purpose || "").replace(/_/g, " ")}</span>
                  {selected.dueDate && (
                    <span className="text-xs text-muted-foreground">Due: {format(new Date(selected.dueDate), "dd MMM yyyy")}</span>
                  )}
                </div>
                {selected.description && <p className="text-sm text-muted-foreground mt-2">{selected.description}</p>}

                {/* Traceability links */}
                {(detailData?.sourceTransmittalNumber || detailData?.responseTransmittalNumber) && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {detailData?.sourceTransmittalNumber && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs bg-muted/50 text-muted-foreground">
                        <Link2 className="h-3 w-3" /> Response to: <span className="font-mono font-medium">{detailData.sourceTransmittalNumber}</span>
                      </span>
                    )}
                    {detailData?.responseTransmittalNumber && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs bg-blue-50 text-blue-700 border-blue-200">
                        <Link2 className="h-3 w-3" /> Has response: <span className="font-mono font-medium">{detailData.responseTransmittalNumber}</span>
                      </span>
                    )}
                  </div>
                )}

                {/* Review outcome badge */}
                {detailData?.reviewOutcome && (
                  <div className="mt-2">
                    <TrsReviewOutcomeBadge outcome={detailData.reviewOutcome} />
                  </div>
                )}
              </div>

              {/* Recipients */}
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipients</p>
                {selected.toExternal && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground w-6 shrink-0 mt-0.5">To</span>
                    <span className="font-medium">{selected.toExternal}</span>
                  </div>
                )}
                {detailData?.externalEmails && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground w-6 shrink-0 mt-0.5">To</span>
                    <div className="flex flex-wrap gap-1">
                      {detailData.externalEmails.split(",").map((e: string) => e.trim()).filter(Boolean).map((email: string) => (
                        <span key={email} className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">{email}</span>
                      ))}
                    </div>
                  </div>
                )}
                {detailData?.ccEmails && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground w-6 shrink-0 mt-0.5">CC</span>
                    <div className="flex flex-wrap gap-1">
                      {detailData.ccEmails.split(",").map((e: string) => e.trim()).filter(Boolean).map((email: string) => (
                        <span key={email} className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-medium">{email}</span>
                      ))}
                    </div>
                  </div>
                )}
                {!selected.toExternal && !detailData?.externalEmails && !detailData?.ccEmails && (
                  <p className="text-xs text-muted-foreground">No recipients specified</p>
                )}
              </div>

              {/* Attached Documents / Items */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" /> Attached Documents
                </p>
                {detailItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No documents attached</p>
                ) : (
                  <div className="border rounded-lg divide-y text-sm">
                    {detailItems.map((item: any) => (
                      <div key={item.id} className="flex items-center gap-2 p-2 group">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs text-muted-foreground shrink-0">{item.documentNumber ?? "—"}</span>
                        <span className="text-xs truncate flex-1">{item.documentTitle ?? item.fileName ?? "Attachment"}</span>
                        {/* Review Code */}
                        <div className="shrink-0 flex items-center gap-0.5">
                          {(() => {
                            const isAssigned = selected.toUserId === user?.id || selected.createdById === user?.id;
                            const canCode = perms.canSetReviewCode(isAssigned);
                            if (item.reviewCode) {
                              return (
                                <>
                                  <TrsReviewPill code={item.reviewCode} />
                                  {canCode && (
                                    <button
                                      className="ml-1 text-muted-foreground hover:text-destructive text-[10px]"
                                      onClick={() => setItemReviewCode(item.id, null)}
                                      title="Clear review code"
                                    >✕</button>
                                  )}
                                </>
                              );
                            }
                            if (selected.status !== "draft" && canCode) {
                              return (
                                <Select value="" onValueChange={v => setItemReviewCode(item.id, v || null)}>
                                  <SelectTrigger className="h-6 text-[10px] w-28 border-dashed text-muted-foreground">
                                    <SelectValue placeholder="Set code…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TRS_REVIEW_CODES.map(rc => (
                                      <SelectItem key={rc.value} value={rc.value} className="text-xs">{rc.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        {(item.fileUrl || item.documentTitle) && (
                          <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0"><Download className="h-3 w-3" /></a>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 shrink-0" onClick={() => removeItemMutation.mutate({ transmittalId: selected.id, itemId: item.id })}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add from project docs */}
                {selected?.status === "draft" && (
                  <div className="flex gap-2 mt-1">
                    <Select value={addItemDocId} onValueChange={setAddItemDocId}>
                      <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Add project document..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— Select document —</SelectItem>
                        {documents.filter((d: any) => !detailItems.some((it: any) => it.documentId === d.id)).map((d: any) => (
                          <SelectItem key={d.id} value={String(d.id)}>{d.documentNumber} — {d.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 text-xs gap-1 shrink-0" disabled={addItemDocId === "_none" || addItemMutation.isPending}
                      onClick={() => addItemMutation.mutate({ transmittalId: selected.id, documentId: parseInt(addItemDocId) })}>
                      <Plus className="h-3 w-3" /> Add
                    </Button>
                  </div>
                )}

                {/* Resubmission banner — shown when outcome is C or D and a response TRS exists */}
                {(detailData?.reviewOutcome === "C" || detailData?.reviewOutcome === "D") && detailData?.responseTransmittalNumber && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 space-y-1">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {detailData.reviewOutcome === "D" ? "Documents Rejected — Resubmission Required" : "Revise and Resubmit Required"}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Response draft <span className="font-mono font-medium">{detailData.responseTransmittalNumber}</span> has been created automatically.
                      Attach the revised documents to that transmittal, then send it to the recipient.
                    </p>
                  </div>
                )}

                {/* Complete Review — only when all items have codes, no outcome set, no response yet */}
                {(() => {
                  if (detailItems.length === 0) return null;
                  if (detailData?.reviewOutcome) return null;
                  if (detailData?.responseTransmittalNumber) return null;
                  const isAssigned = selected.toUserId === user?.id || selected.createdById === user?.id;
                  const canComplete = perms.canCompleteReview(isAssigned);
                  if (!canComplete) return null;
                  const coded = detailItems.filter((i: any) => !!i.reviewCode).length;
                  const total = detailItems.length;
                  const allCoded = coded === total;
                  return (
                    <div className={`mt-3 rounded-lg border p-3 space-y-3 ${allCoded ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}>
                      <div>
                        <p className="text-xs font-semibold">
                          {allCoded
                            ? "All items reviewed — ready to submit"
                            : `Review in progress — ${coded} of ${total} items coded`}
                        </p>
                        {!allCoded && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">Set a review code on every document to enable submission</p>
                        )}
                      </div>
                      {allCoded && (
                        <div>
                          <Label className="text-xs">Reviewer Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Textarea
                            value={reviewComment}
                            onChange={e => setReviewComment(e.target.value)}
                            placeholder="Add overall review comments, conditions, or instructions for the originator…"
                            className="mt-1 text-xs resize-none"
                            rows={3}
                          />
                        </div>
                      )}
                      <Button
                        size="sm"
                        className="gap-1.5 w-full"
                        disabled={!allCoded || completeReview.isPending}
                        onClick={() => completeReview.mutate(selected.id)}
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        {completeReview.isPending ? "Submitting Review…" : "Submit Review"}
                      </Button>
                      <p className="text-[10px] text-muted-foreground text-center">
                        Submitting will update document statuses and create a response transmittal draft automatically.
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Secure Share Link */}
              <div className="border rounded-lg p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <FileDown className="h-3.5 w-3.5" /> Secure External Share Link
                </p>

                {shareResult ? (
                  <>
                    <div className="bg-muted rounded-md p-2 text-xs font-mono break-all text-muted-foreground">
                      {shareResult.shareUrl}
                    </div>
                    {shareResult.expiresAt && (
                      <p className="text-xs text-amber-600">Expires: {format(new Date(shareResult.expiresAt), "dd MMM yyyy HH:mm")}</p>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5 flex-1 text-xs" onClick={() => {
                        navigator.clipboard.writeText(shareResult.shareUrl);
                        toast({ title: "Share link copied" });
                      }}>
                        Copy Link
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="text-xs text-destructive hover:bg-destructive/10"
                        onClick={() => { setShareResult(null); revokeShareLink.mutate(selected.id); }}
                      >
                        Revoke
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">Generate a secure, time-limited link for external access. Optionally protect it with a password.</p>
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs font-medium mb-1">Expires in (days)</p>
                          <input
                            type="number"
                            min="1" max="365"
                            value={shareForm.expiresInDays}
                            onChange={e => setShareForm(f => ({ ...f, expiresInDays: e.target.value }))}
                            placeholder="30 (leave blank = never)"
                            className="w-full h-8 px-2 rounded border bg-background text-xs"
                          />
                        </div>
                        <div>
                          <p className="text-xs font-medium mb-1">Password (optional)</p>
                          <input
                            type="password"
                            value={shareForm.password}
                            onChange={e => setShareForm(f => ({ ...f, password: e.target.value }))}
                            placeholder="Leave blank = no password"
                            className="w-full h-8 px-2 rounded border bg-background text-xs"
                          />
                        </div>
                      </div>
                      <Button
                        size="sm" className="gap-1.5 w-full text-xs"
                        onClick={() => createShareLink.mutate({ id: selected.id, ...shareForm })}
                        disabled={createShareLink.isPending}
                      >
                        {createShareLink.isPending ? <><RefreshCw className="h-3 w-3 animate-spin" /> Generating...</> : <><FileDown className="h-3 w-3" /> Generate Secure Link</>}
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* Audit / Status Timeline */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" /> Audit Trail
                </p>
                <div className="space-y-2">
                  <div className="flex gap-3 text-sm">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Plus className="h-3 w-3 text-primary" />
                    </div>
                    <div className="flex-1 border rounded-lg p-2">
                      <p className="font-medium text-xs">Created</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(selected.createdAt), "dd MMM yyyy HH:mm")}</p>
                    </div>
                  </div>
                  {(selected.status === "sent" || selected.status === "acknowledged") && selected.sentAt && (
                    <div className="flex gap-3 text-sm">
                      <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <Send className="h-3 w-3 text-blue-700" />
                      </div>
                      <div className="flex-1 border rounded-lg p-2">
                        <p className="font-medium text-xs">Sent</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(selected.sentAt), "dd MMM yyyy HH:mm")}</p>
                      </div>
                    </div>
                  )}
                  {selected.status === "acknowledged" && selected.acknowledgedAt && (
                    <div className="flex gap-3 text-sm">
                      <div className="h-7 w-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3 text-emerald-700" />
                      </div>
                      <div className="flex-1 border rounded-lg p-2">
                        <p className="font-medium text-xs text-emerald-700">Acknowledged</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(selected.acknowledgedAt), "dd MMM yyyy HH:mm")}</p>
                      </div>
                    </div>
                  )}
                  {selected.status !== "acknowledged" && (
                    <div className="flex gap-3 text-sm opacity-40">
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3" />
                      </div>
                      <div className="flex-1 border border-dashed rounded-lg p-2">
                        <p className="text-xs">Awaiting acknowledgement</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Correspondence Tab ───────────────────────────────────────────────────────
const CORR_TYPES = ["rfi", "submittal", "ncr", "technical_query", "letter", "memo", "email", "internal", "notice"];
const CORR_TYPE_LABELS: Record<string, string> = {
  rfi: "RFI", submittal: "Submittal", ncr: "NCR", technical_query: "TQ",
  transmittal: "Transmittal", letter: "Letter", memo: "Memo",
  email: "Email", internal: "Internal", notice: "Notice",
};
const PRIORITIES = ["low", "medium", "high", "urgent"];

const CORR_COLUMNS: ColumnDef[] = [
  { key: "ref",       label: "Ref." },
  { key: "type",      label: "Type" },
  { key: "subject",   label: "Subject" },
  { key: "direction", label: "Direction" },
  { key: "priority",  label: "Priority" },
  { key: "status",    label: "Status" },
  { key: "due",       label: "Due" },
  { key: "created",   label: "Created" },
];
const CORR_PINNED = ["subject"];

function CorrespondenceTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const perms = usePermissions();
  const { isVisible: isCorrColVis, toggle: toggleCorrCol, reset: resetCorrCols, visibleCount: corrColCount } =
    useColumnVisibility(`corr-${projectId}`, CORR_COLUMNS);
  const [, navigate] = useLocation();
  const { data: project } = useGetProject(projectId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [savedDraft, setSavedDraft] = useState<{ id: number; referenceNumber?: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [corrDetail, setCorrDetail] = useState<any>(null);
  const [form, setForm] = useState({
    subject: "", type: "rfi", body: "", priority: "medium",
    dueDate: "", referenceNumber: "",
    toUserIds: [] as number[], ccUserIds: [] as number[],
    direction: "outgoing",
  });

  type CorrUploadAtt = { kind: "upload"; url: string; name: string; size: number };
  type CorrRefAtt    = { kind: "ref"; documentId: number; name: string; documentNumber: string; fileUrl: string };
  type CorrAttachment = CorrUploadAtt | CorrRefAtt;
  const [composeAttachments, setComposeAttachments] = useState<CorrAttachment[]>([]);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [docSearch, setDocSearch] = useState("");

  const { data: corrData, isLoading } = useQuery({
    queryKey: ["correspondence", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/correspondence`);
      return r.json();
    },
  });
  const correspondence = corrData?.items ?? [];

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });
  const corrUsers: RecipientUser[] = unwrapList<RecipientUser>(usersData, "users").map((u: any) => ({
    id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email,
  }));

  const { data: projDocsData } = useQuery({
    queryKey: ["project-docs-picker", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents`);
      return r.json();
    },
    enabled: docPickerOpen,
  });
  const pickerDocs: any[] = unwrapList<any>(projDocsData, "documents").filter((d: any) =>
    !docSearch || d.title?.toLowerCase().includes(docSearch.toLowerCase()) || d.documentNumber?.toLowerCase().includes(docSearch.toLowerCase())
  );

  const resetCreateForm = () => {
    setForm({ subject: "", type: "rfi", body: "", priority: "medium", dueDate: "", referenceNumber: "", toUserIds: [], ccUserIds: [], direction: "outgoing" });
    setComposeAttachments([]);
  };

  const create = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/projects/${projectId}/correspondence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: data.subject,
          type: data.type,
          priority: data.priority,
          dueDate: data.dueDate || undefined,
          referenceNumber: data.referenceNumber || undefined,
          body: data.body || undefined,
          toUserIds: data.toUserIds.length > 0 ? data.toUserIds : undefined,
          ccUserIds: data.ccUserIds.length > 0 ? data.ccUserIds : undefined,
          direction: data.direction || undefined,
          attachments: composeAttachments.length > 0 ? composeAttachments.map(a =>
            a.kind === "ref"
              ? { fileName: a.name, fileUrl: a.fileUrl, documentNumber: a.documentNumber }
              : { fileName: a.name, fileUrl: a.url, fileSize: a.size }
          ) : undefined,
          folder: "draft",
          sendNow: false,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["correspondence", projectId] });
      resetCreateForm();
      setSavedDraft({ id: data.id, referenceNumber: data.referenceNumber });
    },
    onError: () => toast({ title: "Failed to create correspondence", variant: "destructive" }),
  });

  const filtered = correspondence.filter((c: any) => {
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (directionFilter !== "all" && (c.direction ?? "") !== directionFilter) return false;
    if (searchQ && !c.subject?.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const priorityColor: Record<string, string> = {
    low: "bg-gray-100 text-gray-600",
    medium: "bg-blue-100 text-blue-700",
    high: "bg-orange-100 text-orange-700",
    urgent: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex gap-2 flex-wrap items-center">
          <Input placeholder="Search..." className="w-48 h-9" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {CORR_TYPES.map(t => <SelectItem key={t} value={t}>{CORR_TYPE_LABELS[t] || t}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Direction filter */}
          <div className="flex items-center rounded-md border overflow-hidden h-9">
            {([["all", "All"], ["incoming", "↓ In"], ["outgoing", "↑ Out"]] as [string, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setDirectionFilter(val)}
                className={`px-2.5 h-full text-xs font-medium transition-colors border-r last:border-r-0 ${directionFilter === val ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <ColumnVisibilityMenu
            columns={CORR_COLUMNS}
            isVisible={isCorrColVis}
            toggle={toggleCorrCol}
            reset={resetCorrCols}
            pinnedKeys={CORR_PINNED}
          />
          {perms.canCreateCorrespondence && (
            <Button onClick={() => setIsCreateOpen(true)} className="gap-2 h-9">
              <Plus className="h-4 w-4" /> New Correspondence
            </Button>
          )}
        </div>
      </div>

      {/* Type summary pills */}
      <div className="flex flex-wrap gap-2">
        {CORR_TYPES.map(t => {
          const count = correspondence.filter((c: any) => c.type === t).length;
          if (!count) return null;
          return (
            <button key={t} onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${typeFilter === t ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-transparent hover:border-border"}`}>
              {CORR_TYPE_LABELS[t]} ({count})
            </button>
          );
        })}
      </div>

      {/* Correspondence Detail Popup (double-click) */}
      <Dialog open={!!corrDetail} onOpenChange={v => !v && setCorrDetail(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{CORR_TYPE_LABELS[corrDetail?.type] || corrDetail?.type}</Badge>
              {corrDetail?.subject}
            </DialogTitle>
          </DialogHeader>
          {corrDetail && (
            <div className="space-y-3 py-1 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div><span className="text-muted-foreground">Reference:</span> <span className="font-mono font-medium">{corrDetail.referenceNumber || `#${corrDetail.id}`}</span></div>
                <div><span className="text-muted-foreground">Priority:</span> <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${priorityColor[corrDetail.priority] ?? "bg-muted"}`}>{corrDetail.priority}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={corrDetail.status} /></div>
                {corrDetail.direction && (
                  <div>
                    <span className="text-muted-foreground">Direction:</span>{" "}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${corrDetail.direction === "incoming" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"}`}>
                      {corrDetail.direction === "incoming" ? "↓ Incoming" : "↑ Outgoing"}
                    </span>
                  </div>
                )}
                {corrDetail.dueDate && <div><span className="text-muted-foreground">Due:</span> {format(new Date(corrDetail.dueDate), "dd MMM yyyy")}</div>}
                {corrDetail.toUserNames?.length > 0 && <div className="col-span-2"><span className="text-muted-foreground">To:</span> {corrDetail.toUserNames.join(", ")}</div>}
                {corrDetail.ccUserNames?.length > 0 && <div className="col-span-2"><span className="text-muted-foreground">CC:</span> {corrDetail.ccUserNames.join(", ")}</div>}
                <div><span className="text-muted-foreground">Created:</span> {format(new Date(corrDetail.createdAt), "dd MMM yyyy")}</div>
              </div>
              {corrDetail.body && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium mb-1.5">Message</p>
                  <div className="bg-muted/40 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{corrDetail.body}</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => window.open(`/correspondence?openCorr=${corrDetail?.id}`, "_blank", "width=1200,height=800,menubar=no,toolbar=no")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in New Window
            </Button>
            <Button variant="outline" onClick={() => setCorrDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document picker for attachments */}
      <Dialog open={docPickerOpen} onOpenChange={setDocPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Attach Project Document
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input
              placeholder="Search by title or document number…"
              value={docSearch}
              onChange={e => setDocSearch(e.target.value)}
              className="h-9"
              autoFocus
            />
            <div className="h-60 overflow-y-auto border rounded-lg">
              {pickerDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">{docSearch ? "No matching documents" : "No documents in this project"}</p>
                </div>
              ) : (
                <div className="p-1">
                  {pickerDocs.map((doc: any) => {
                    const already = composeAttachments.some(a => a.kind === "ref" && a.documentId === doc.id);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        disabled={already}
                        onClick={() => {
                          if (already) return;
                          setComposeAttachments(prev => [...prev, { kind: "ref", documentId: doc.id, name: doc.title, documentNumber: doc.documentNumber, fileUrl: doc.fileUrl ?? "" }]);
                          setDocPickerOpen(false);
                          setDocSearch("");
                        }}
                        className="w-full flex items-start gap-3 px-3 py-2 rounded-md hover:bg-accent text-left disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.title}</p>
                          <p className="text-xs text-muted-foreground font-mono">{doc.documentNumber}</p>
                        </div>
                        {already && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDocPickerOpen(false); setDocSearch(""); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen || !!savedDraft} onOpenChange={v => { if (!v) { setIsCreateOpen(false); setSavedDraft(null); } }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          {savedDraft ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <Check className="h-5 w-5" /> Draft Saved
                </DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-1">
                  <p className="font-medium">Correspondence saved as draft</p>
                  {savedDraft.referenceNumber && (
                    <p className="text-muted-foreground font-mono text-xs">{savedDraft.referenceNumber}</p>
                  )}
                  <p className="text-muted-foreground text-xs mt-2">
                    To send this correspondence, open it in the Correspondence View where you can review, edit, and send.
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => setSavedDraft(null)}>Close</Button>
                <Button
                  className="gap-2"
                  onClick={() => {
                    setSavedDraft(null);
                    navigate(`/correspondence?openCorr=${savedDraft.id}`);
                  }}
                >
                  <ExternalLink className="h-4 w-4" /> Open in Correspondence View
                </Button>
              </DialogFooter>
            </>
          ) : (
          <>
          <DialogHeader><DialogTitle>New Correspondence</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {/* Project auto-fill indicator */}
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
              <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Project</p>
                <p className="text-sm font-medium truncate">{project?.name} <span className="font-mono text-xs text-muted-foreground">({project?.code})</span></p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CORR_TYPES.map(t => <SelectItem key={t} value={t}>{CORR_TYPE_LABELS[t] || t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Subject *</Label>
              <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Enter subject..." className="mt-1" />
            </div>
            <div>
              <Label>To (Recipients)</Label>
              <RecipientAutocomplete
                users={corrUsers}
                selectedIds={form.toUserIds}
                onChange={ids => setForm(f => ({ ...f, toUserIds: ids }))}
                placeholder="Search by name or email…"
                className="mt-1"
              />
            </div>
            <div>
              <Label>CC</Label>
              <RecipientAutocomplete
                users={corrUsers}
                selectedIds={form.ccUserIds}
                onChange={ids => setForm(f => ({ ...f, ccUserIds: ids }))}
                placeholder="Search by name or email…"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Reference Number</Label>
                <Input value={form.referenceNumber} onChange={e => setForm(f => ({ ...f, referenceNumber: e.target.value }))} placeholder="Auto or manual" className="mt-1 font-mono" />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Body</Label>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Write message here..." className="mt-1" rows={4} />
            </div>
            {/* Attachments */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Attachments</Label>
                <div className="flex gap-2">
                  <Button
                    type="button" variant="outline" size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => { setDocSearch(""); setDocPickerOpen(true); }}
                  >
                    <Link2 className="h-3 w-3" /> Attach Document
                  </Button>
                </div>
              </div>
              <FileDropZone
                onUpload={file => setComposeAttachments(prev => [...prev, { kind: "upload", ...file }])}
                onMultiUpload={files => setComposeAttachments(prev => [...prev, ...files.map(f => ({ kind: "upload" as const, ...f }))])}
                label="Upload File — drop or click to attach external files"
                multiple
              />
              {composeAttachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {composeAttachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1.5">
                      {att.kind === "ref"
                        ? <Link2 className="h-3 w-3 text-primary shrink-0" />
                        : <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <span className="truncate block font-medium">{att.name}</span>
                        {att.kind === "ref" && <span className="text-muted-foreground font-mono text-[10px]">{att.documentNumber}</span>}
                        {att.kind === "upload" && <span className="text-muted-foreground">{(att.size / 1024).toFixed(0)} KB</span>}
                      </div>
                      {att.kind === "ref" && att.fileUrl && (
                        <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))}
                        className="text-destructive hover:bg-destructive/10 rounded p-0.5 shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
            <Button
              onClick={() => create.mutate(form)}
              disabled={create.isPending || !form.subject}
              className="gap-1.5"
            >
              {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
              {create.isPending ? "Saving…" : "Save Draft"}
            </Button>
          </DialogFooter>
          </>
          )}
        </DialogContent>
      </Dialog>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              {isCorrColVis("ref")       && <TableHead className="w-[110px]">Ref.</TableHead>}
              {isCorrColVis("type")      && <TableHead className="w-[120px]">Type</TableHead>}
              <TableHead>Subject</TableHead>
              {isCorrColVis("direction") && <TableHead className="w-[90px]">Direction</TableHead>}
              {isCorrColVis("priority")  && <TableHead className="w-[80px]">Priority</TableHead>}
              {isCorrColVis("status")    && <TableHead className="w-[100px]">Status</TableHead>}
              {isCorrColVis("due")       && <TableHead className="w-[90px]">Due</TableHead>}
              {isCorrColVis("created")   && <TableHead className="w-[100px]">Created</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={corrColCount} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !filtered.length ? (
              <TableRow><TableCell colSpan={corrColCount} className="text-center py-12 text-muted-foreground">No correspondence found.</TableCell></TableRow>
            ) : filtered.map((c: any) => {
              const isOverdue = c.dueDate && new Date(c.dueDate) < new Date() && c.status !== "closed";
              return (
                <TableRow
                  key={c.id}
                  className={`hover:bg-muted/30 cursor-pointer ${isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}
                  onClick={() => setCorrDetail(c)}
                  onDoubleClick={() => window.open(`/correspondence?openCorr=${c.id}`, "_blank", "width=1200,height=800,menubar=no,toolbar=no")}
                  title="Click to view — double-click to open in new window"
                >
                  {isCorrColVis("ref") && <TableCell className="font-mono text-xs">{c.referenceNumber || `#${c.id}`}</TableCell>}
                  {isCorrColVis("type") && (
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{CORR_TYPE_LABELS[c.type] || c.type}</Badge>
                    </TableCell>
                  )}
                  <TableCell className="max-w-xs"><span className="line-clamp-1">{c.subject}</span></TableCell>
                  {isCorrColVis("direction") && (
                    <TableCell>
                      {c.direction ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.direction === "incoming" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400"}`}>
                          {c.direction === "incoming" ? "↓ In" : "↑ Out"}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                  )}
                  {isCorrColVis("priority") && (
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${priorityColor[c.priority] ?? "bg-muted"}`}>{c.priority}</span>
                    </TableCell>
                  )}
                  {isCorrColVis("status") && <TableCell><StatusBadge status={c.status} /></TableCell>}
                  {isCorrColVis("due") && (
                    <TableCell>
                      {c.dueDate ? (
                        <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {format(new Date(c.dueDate), "dd MMM yy")}
                          {isOverdue && <span className="ml-1 text-red-500">!</span>}
                        </span>
                      ) : "—"}
                    </TableCell>
                  )}
                  {isCorrColVis("created") && <TableCell className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "dd MMM yyyy")}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Packages Tab ─────────────────────────────────────────────────────────────
function PackagesTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", description: "" });

  const { data: packagesRaw, isLoading } = useQuery({
    queryKey: ["packages", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/packages`);
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d.packages ?? []);
    },
  });
  const packages: any[] = Array.isArray(packagesRaw) ? packagesRaw : [];

  const create = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/projects/${projectId}/packages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages", projectId] });
      setIsCreateOpen(false);
      setForm({ name: "", code: "", description: "" });
      toast({ title: "Package created" });
    },
    onError: () => toast({ title: "Failed to create package", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/projects/${projectId}/packages/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages", projectId] });
      toast({ title: "Package deleted" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-lg">Document Packages</h3>
          <p className="text-sm text-muted-foreground">Group documents into work packages for structured delivery</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New Package
        </Button>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>Create Package</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Package Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="E.g. Foundation Package" className="mt-1" />
              </div>
              <div>
                <Label>Code *</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="PKG-001" className="mt-1 font-mono" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate(form)} disabled={create.isPending || !form.name || !form.code}>
              {create.isPending ? "Creating..." : "Create Package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : packages.length === 0 ? (
        <div className="bg-card border border-dashed rounded-xl p-12 text-center text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No packages yet</p>
          <p className="text-sm mt-1">Create a package to group documents for structured delivery</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg: any) => (
            <div key={pkg.id} className="bg-card border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Package className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">{pkg.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{pkg.code}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => remove.mutate(pkg.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {pkg.description && <p className="text-sm text-muted-foreground">{pkg.description}</p>}
              <p className="text-xs text-muted-foreground mt-3">
                Created {format(new Date(pkg.createdAt), "dd MMM yyyy")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────
function TasksTab({ projectId }: { projectId: number }) {
  const { data: tasksData, isLoading } = useQuery({
    queryKey: ["tasks", "project", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/tasks?projectId=${projectId}`);
      return r.json();
    },
  });
  const tasks = tasksData?.tasks ?? [];

  const priorityColor: Record<string, string> = {
    low: "bg-gray-100 text-gray-600", medium: "bg-blue-100 text-blue-700",
    high: "bg-orange-100 text-orange-700", urgent: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">Project Tasks</h3>
        <div className="flex gap-2">
          <Button asChild size="sm" className="h-8 gap-1.5">
            <Link href={`/tasks?projectId=${projectId}&create=1`}>
              <Plus className="h-3.5 w-3.5" /> Add Task
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
            <Link href="/tasks">View All <ArrowLeft className="h-3.5 w-3.5 rotate-180" /></Link>
          </Button>
        </div>
      </div>
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Assigned To</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !tasks.length ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No tasks for this project.</TableCell></TableRow>
            ) : tasks.map((t: any) => {
              const isOverdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "completed";
              return (
                <TableRow key={t.id} className={isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : ""}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColor[t.priority] ?? "bg-muted"}`}>{t.priority}</span></TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell>
                    {t.dueDate ? (
                      <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                        {format(new Date(t.dueDate), "dd MMM yyyy")}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.assignedToName || "Unassigned"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Members Tab ──────────────────────────────────────────────────────────────
function MembersTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState("reviewer");
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwUserId, setResetPwUserId] = useState<number | null>(null);
  const [resetPwUser, setResetPwUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: async () => { const r = await fetch(`/api/projects/${projectId}/members`); return r.json(); },
  });
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });

  const members = membersData?.members ?? [];
  const allUsers: any[] = unwrapList<any>(usersData, "users");
  const memberUserIds = new Set(members.map((m: any) => m.userId));
  const availableUsers = allUsers.filter((u: any) => !memberUserIds.has(u.id) && u.isActive);

  const addMember = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: parseInt(addUserId), role: addRole }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || "Failed to add member");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
      setAddOpen(false);
      setAddUserId("");
      toast({ title: "Member added to project" });
    },
    onError: (err: any) => toast({ title: "Failed to add member", description: err?.message, variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: number) => {
      await fetch(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
      toast({ title: "Member removed" });
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: string }) => {
      await fetch(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
      toast({ title: "Role updated" });
    },
  });

  const blockUser = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: number; isActive: boolean }) => {
      const r = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: vars.isActive ? "User unblocked" : "User blocked" });
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const resetPassword = useMutation({
    mutationFn: async ({ userId, password }: { userId: number; password: string }) => {
      const r = await fetch(`/api/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      setResetPwOpen(false);
      setNewPassword("");
      toast({ title: "Password reset successfully" });
    },
    onError: () => toast({ title: "Failed to reset password", variant: "destructive" }),
  });

  const filteredMembers = memberSearch
    ? members.filter((m: any) =>
        `${m.user?.firstName} ${m.user?.lastName} ${m.user?.email}`.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : members;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-lg">Project Team</h3>
        <div className="flex items-center gap-2 ml-auto">
          <input
            type="text"
            placeholder="Search members..."
            value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            className="h-8 px-3 rounded-md border bg-background text-sm w-48"
          />
          <Button className="gap-2" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add Member
          </Button>
        </div>
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={resetPwOpen} onOpenChange={open => { setResetPwOpen(open); if (!open) setNewPassword(""); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Reset Password</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              Setting new password for: <strong>{resetPwUser?.firstName} {resetPwUser?.lastName}</strong>
            </p>
            <div>
              <Label>New Password</Label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min. 6 characters"
                className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPwOpen(false); setNewPassword(""); }}>Cancel</Button>
            <Button
              onClick={() => resetPwUserId && resetPassword.mutate({ userId: resetPwUserId, password: newPassword })}
              disabled={resetPassword.isPending || newPassword.length < 6}
            >
              {resetPassword.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>User</Label>
              <Select value={addUserId} onValueChange={setAddUserId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select user..." /></SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.firstName} {u.lastName} — {u.email}</SelectItem>
                  ))}
                  {availableUsers.length === 0 && <SelectItem value="_none" disabled>All users are already members</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project Role</Label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                  <SelectItem value="document_controller">Document Controller</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMember.mutate()} disabled={addMember.isPending || !addUserId || addUserId === "_none"}>
              {addMember.isPending ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !members.length ? (
        <div className="bg-card border border-dashed rounded-xl p-12 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No team members assigned yet. Click "Add Member" to get started.</p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Project Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers.map((m: any) => {
                const fullUser = allUsers.find((u: any) => u.id === m.userId);
                const orgName = fullUser?.organizationName;
                const isActive = m.user?.isActive ?? true;
                return (
                  <TableRow key={m.id} className={!isActive ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          {m.user?.firstName?.[0]}{m.user?.lastName?.[0]}
                        </div>
                        <span className="font-medium text-sm">{m.user?.firstName} {m.user?.lastName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.user?.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{orgName || "—"}</TableCell>
                    <TableCell>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-500 font-medium">
                          <X className="h-3 w-3" /> Blocked
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select value={m.role} onValueChange={role => updateRole.mutate({ userId: m.userId, role })}>
                        <SelectTrigger className="w-38 h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="project_manager" className="text-xs">Project Manager</SelectItem>
                          <SelectItem value="document_controller" className="text-xs">Document Controller</SelectItem>
                          <SelectItem value="reviewer" className="text-xs">Reviewer</SelectItem>
                          <SelectItem value="member" className="text-xs">Member</SelectItem>
                          <SelectItem value="viewer" className="text-xs">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          title="Reset password"
                          onClick={() => {
                            setResetPwUserId(m.userId);
                            setResetPwUser(m.user);
                            setResetPwOpen(true);
                          }}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className={`h-7 w-7 ${isActive ? "text-amber-500 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"}`}
                          title={isActive ? "Block user" : "Unblock user"}
                          onClick={() => blockUser.mutate({ userId: m.userId, isActive: !isActive })}
                        >
                          {isActive ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          title="Remove from project"
                          onClick={() => removeMember.mutate(m.userId)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Review Tab ────────────────────────────────────────────────────────────────
function ReviewTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const perms = usePermissions();
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewDecision, setReviewDecision] = useState<string>("approved");
  const [submitComment, setSubmitComment] = useState("");
  const [reviewerIds, setReviewerIds] = useState<number[]>([]);

  const { data: docsData, isLoading: docsLoading } = useListDocuments(projectId);
  const allDocs = unwrapList<any>(docsData, "documents");

  const { data: membersData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: async () => { const r = await fetch(`/api/projects/${projectId}/members`); return r.json(); },
  });
  const members = membersData?.members ?? [];

  const { data: reviewsData, isLoading: reviewsLoading } = useQuery({
    queryKey: ["reviews", selectedDoc?.id],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${selectedDoc.id}/reviews`);
      return r.json();
    },
    enabled: !!selectedDoc,
  });
  const reviewHistory: any[] = reviewsData?.history ?? [];

  const submitForReview = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${selectedDoc.id}/submit-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerIds, comment: submitComment }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["reviews", selectedDoc?.id] });
      setSelectedDoc(data);
      setSubmitOpen(false);
      setSubmitComment("");
      setReviewerIds([]);
      toast({ title: "Document submitted for review" });
    },
    onError: () => toast({ title: "Failed to submit for review", variant: "destructive" }),
  });

  const submitReviewDecision = useMutation({
    mutationFn: async () => {
      const endpoint = (reviewDecision === "approved" || reviewDecision === "approved_with_comments")
        ? "approve" : "reject";
      const r = await fetch(`/api/projects/${projectId}/documents/${selectedDoc.id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: reviewComment, decision: reviewDecision }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["reviews", selectedDoc?.id] });
      setSelectedDoc(data);
      setReviewComment("");
      const labels: Record<string, string> = {
        approved: "Document approved",
        approved_with_comments: "Document approved with comments",
        for_revision: "Document sent back for revision",
        rejected: "Document rejected",
      };
      toast({ title: labels[reviewDecision] ?? "Decision submitted" });
    },
    onError: () => toast({ title: "Failed to submit decision", variant: "destructive" }),
  });

  const approveDoc = submitReviewDecision;
  const rejectDoc = submitReviewDecision;

  const REVIEW_STATES = [
    { key: "draft",                  label: "Draft",                  color: "bg-gray-100 text-gray-700" },
    { key: "under_review",           label: "Under Review",           color: "bg-blue-100 text-blue-700" },
    { key: "approved",               label: "Approved",               color: "bg-emerald-100 text-emerald-700" },
    { key: "approved_with_comments", label: "Approved w/ Comments",   color: "bg-teal-100 text-teal-700" },
    { key: "for_revision",           label: "For Revision",           color: "bg-amber-100 text-amber-700" },
    { key: "rejected",               label: "Rejected",               color: "bg-red-100 text-red-700" },
  ];

  const reviewableDocs = allDocs.filter((d: any) =>
    ["draft", "under_review", "approved", "approved_with_comments", "for_revision", "rejected"].includes(d.status)
  );

  return (
    <div className="flex gap-6 h-[calc(100vh-16rem)]">
      {/* Left: Document List */}
      <div className="w-72 shrink-0 border rounded-xl overflow-hidden flex flex-col">
        <div className="p-3 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">Documents for Review</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{reviewableDocs.length} document(s)</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {docsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : reviewableDocs.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No documents available for review
            </div>
          ) : reviewableDocs.map((doc: any) => (
            <button
              key={doc.id}
              onClick={() => setSelectedDoc(doc)}
              className={`w-full text-left p-3 border-b hover:bg-muted/30 transition-colors ${selectedDoc?.id === doc.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
            >
              <p className="font-medium text-xs font-mono text-muted-foreground">{doc.documentNumber}</p>
              <p className="text-sm font-medium line-clamp-2 mt-0.5">{doc.title}</p>
              <div className="mt-1.5">
                <StatusBadge status={doc.status} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Review Detail */}
      <div className="flex-1 border rounded-xl overflow-hidden flex flex-col">
        {!selectedDoc ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
            <ClipboardCheck className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">Select a document to manage its review</p>
            <p className="text-sm mt-1">Documents are tracked through: Draft → Review → Approved/Rejected</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b bg-muted/20">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{selectedDoc.documentNumber} · Rev {selectedDoc.revision ?? "01"}</p>
                  <h3 className="font-semibold text-lg">{selectedDoc.title}</h3>
                </div>
                <StatusBadge status={selectedDoc.status} />
              </div>

              {/* State machine visualization */}
              <div className="flex items-center gap-1 mt-3 flex-wrap">
                {REVIEW_STATES.map((state, idx) => (
                  <div key={state.key} className="flex items-center gap-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                      selectedDoc.status === state.key ? state.color + " border-current" : "border-muted text-muted-foreground bg-muted/30"
                    }`}>
                      {selectedDoc.status === state.key && <span className="mr-1">●</span>}
                      {state.label}
                    </span>
                    {idx < REVIEW_STATES.length - 1 && <ChevronDown className="h-3 w-3 text-muted-foreground rotate-[-90deg]" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 border-b flex flex-wrap gap-2 items-end">
              {selectedDoc.status === "draft" && perms.canSubmitForWorkflow && (
                <Button className="gap-2" onClick={() => setSubmitOpen(true)}>
                  <Send className="h-4 w-4" /> Submit for Review
                </Button>
              )}
              {selectedDoc.status === "under_review" && (
                <div className="flex-1 space-y-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Review Decision</Label>
                  <div className="flex flex-wrap gap-2">
                    {REVIEW_DECISION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setReviewDecision(opt.value)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                          reviewDecision === opt.value
                            ? opt.activeClass
                            : "border-transparent bg-muted hover:bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        <span>{opt.icon}</span> {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={reviewComment}
                      onChange={e => setReviewComment(e.target.value)}
                      placeholder="Add a comment (optional)..."
                      className="h-9"
                    />
                    <Button
                      className={`gap-1.5 shrink-0 ${
                        reviewDecision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" :
                        reviewDecision === "approved_with_comments" ? "bg-teal-600 hover:bg-teal-700" :
                        reviewDecision === "for_revision" ? "bg-amber-600 hover:bg-amber-700" :
                        "bg-red-600 hover:bg-red-700"
                      }`}
                      onClick={() => submitReviewDecision.mutate()}
                      disabled={submitReviewDecision.isPending}
                    >
                      {submitReviewDecision.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <ClipboardCheck className="h-4 w-4" />}
                      Submit Decision
                    </Button>
                  </div>
                </div>
              )}
              {(selectedDoc.status === "approved" || selectedDoc.status === "approved_with_comments") && (
                <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium">
                  <Check className="h-5 w-5" />
                  {selectedDoc.status === "approved_with_comments"
                    ? "Document approved with comments."
                    : "This document has been approved."}
                  <Button variant="outline" size="sm" className="ml-2" onClick={() => setSubmitOpen(true)}>Resubmit</Button>
                </div>
              )}
              {selectedDoc.status === "for_revision" && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-muted-foreground">Document requires revision. Resubmit after changes.</span>
                  <Button size="sm" className="ml-2" onClick={() => setSubmitOpen(true)}>Resubmit</Button>
                </div>
              )}
              {selectedDoc.status === "rejected" && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span className="text-muted-foreground">Document was rejected. Revise and resubmit.</span>
                  <Button size="sm" className="ml-2" onClick={() => setSubmitOpen(true)}>Resubmit</Button>
                </div>
              )}
            </div>

            {/* Submit Dialog */}
            <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
              <DialogContent className="sm:max-w-[480px]">
                <DialogHeader><DialogTitle>Submit for Review — {selectedDoc.documentNumber}</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>Assign Reviewers (optional)</Label>
                    <div className="mt-1 space-y-1 max-h-32 overflow-y-auto border rounded-lg p-2">
                      {members.length === 0 && <p className="text-xs text-muted-foreground">No project members to assign</p>}
                      {members.map((m: any) => (
                        <label key={m.id} className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/30 p-1 rounded">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={reviewerIds.includes(m.userId)}
                            onChange={e => {
                              if (e.target.checked) setReviewerIds(ids => [...ids, m.userId]);
                              else setReviewerIds(ids => ids.filter(id => id !== m.userId));
                            }}
                          />
                          {m.user?.firstName} {m.user?.lastName}
                          <span className="text-xs text-muted-foreground capitalize ml-1">({m.role?.replace(/_/g, " ")})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Submission Note</Label>
                    <Textarea value={submitComment} onChange={e => setSubmitComment(e.target.value)} rows={3} className="mt-1" placeholder="Add a note for reviewers..." />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button>
                  <Button onClick={() => submitForReview.mutate()} disabled={submitForReview.isPending}>
                    {submitForReview.isPending ? "Submitting..." : "Submit for Review"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Review History */}
            <div className="flex-1 overflow-y-auto p-4">
              <h4 className="font-medium text-sm mb-3 flex items-center gap-1.5">
                <History className="h-4 w-4" /> Review History
              </h4>
              {reviewsLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : reviewHistory.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-lg">
                  No review activity yet for this document
                </div>
              ) : (
                <div className="space-y-3">
                  {reviewHistory.map((event: any) => {
                    const actionColorMap: Record<string, string> = {
                      approved:               "bg-emerald-100 text-emerald-700",
                      approved_with_comments: "bg-teal-100 text-teal-700",
                      for_revision:           "bg-amber-100 text-amber-700",
                      rejected:               "bg-red-100 text-red-700",
                      submitted:              "bg-blue-100 text-blue-700",
                      commented:              "bg-purple-100 text-purple-700",
                    };
                    const actionLabelMap: Record<string, string> = {
                      approved:               "Approved",
                      approved_with_comments: "Approved with Comments",
                      for_revision:           "Sent for Revision",
                      rejected:               "Rejected",
                      submitted:              "Submitted for Review",
                      commented:              "Commented",
                    };
                    const colorClass = actionColorMap[event.action] ?? "bg-blue-100 text-blue-700";
                    return (
                      <div key={event.id} className="flex gap-3 text-sm">
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${colorClass}`}>
                          {event.action === "approved" || event.action === "approved_with_comments"
                            ? <ThumbsUp className="h-3.5 w-3.5" />
                            : event.action === "rejected" || event.action === "for_revision"
                            ? <ThumbsDown className="h-3.5 w-3.5" />
                            : <Send className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 border rounded-lg p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">
                              {actionLabelMap[event.action] ?? event.action?.replace(/_/g, " ")}
                            </span>
                            <span className="text-xs text-muted-foreground">{format(new Date(event.createdAt), "dd MMM yyyy HH:mm")}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">by {event.userName}</p>
                          {event.comment && <p className="text-xs mt-1.5 text-foreground/80 italic">"{event.comment}"</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Project Departments Tab (Phase B — data layer, no enforcement) ──────────
function ProjectDepartmentsTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [addDeptId, setAddDeptId] = useState("");

  const { data: assignedRaw, isLoading } = useQuery({
    queryKey: ["project-departments", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/departments`);
      return r.ok ? r.json() : [];
    },
  });
  const assigned: any[] = Array.isArray(assignedRaw) ? assignedRaw : [];

  const { data: allDeptsRaw } = useQuery({
    queryKey: ["org-departments"],
    queryFn: async () => {
      const r = await fetch("/api/departments");
      return r.ok ? r.json() : [];
    },
  });
  const allDepts: any[] = Array.isArray(allDeptsRaw) ? allDeptsRaw.filter((d: any) => d.isActive !== false) : [];
  const assignedIds = new Set(assigned.map((d: any) => d.id));
  const available = allDepts.filter((d: any) => !assignedIds.has(d.id));

  const assignDept = useMutation({
    mutationFn: async (departmentId: number) => {
      const r = await fetch(`/api/projects/${projectId}/departments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId }),
      });
      if (!r.ok) throw new Error("Failed to assign department");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-departments", projectId] });
      setAddOpen(false);
      setAddDeptId("");
      toast({ title: "Department assigned to project" });
    },
    onError: (e: any) => toast({ title: "Failed to assign department", description: e?.message, variant: "destructive" }),
  });

  const removeDept = useMutation({
    mutationFn: async (departmentId: number) => {
      await fetch(`/api/projects/${projectId}/departments/${departmentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-departments", projectId] });
      toast({ title: "Department removed from project" });
    },
    onError: () => toast({ title: "Failed to remove department", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Project Departments</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Classification only — no access restrictions applied.
          </p>
        </div>
        {available.length > 0 && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Department
          </Button>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Departments are for classification only.</span>
          {" "}Assigning or removing a department from this project does not change who can see or edit it.
          Department-based access control is not yet enforced.
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : assigned.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No departments assigned</p>
          <p className="text-xs text-muted-foreground mt-1">Assign departments to classify this project for future access control.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assigned.map((dept: any) => (
              <TableRow key={dept.id}>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">{dept.code}</Badge>
                </TableCell>
                <TableCell className="font-medium">{dept.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {dept.assignedAt ? format(new Date(dept.assignedAt), "dd MMM yyyy") : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => removeDept.mutate(dept.id)}
                    disabled={removeDept.isPending}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Department Dialog */}
      <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) setAddDeptId(""); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Add Department</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs">Select Department</Label>
            <Select value={addDeptId} onValueChange={setAddDeptId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a department…" /></SelectTrigger>
              <SelectContent>
                {available.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    <span className="font-mono text-xs mr-2">{d.code}</span> {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setAddDeptId(""); }}>Cancel</Button>
            <Button
              disabled={!addDeptId || assignDept.isPending}
              onClick={() => assignDept.mutate(parseInt(addDeptId))}
            >
              {assignDept.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Adding…</> : "Add Department"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


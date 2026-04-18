import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { DocumentFilesPanel } from "@/components/documents/DocumentFilesPanel";
import { DocumentPreviewContent } from "@/components/documents/DocumentPreviewContent";
import { FolderSidebar } from "@/components/documents/FolderSidebar";
import { useResizableColumns } from "@/hooks/useResizableColumns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText, Search, Send, Download, Sparkles, ExternalLink, FileDown,
  Filter, X, ChevronDown, Loader2, Building2, FolderOpen,
  Plus, RefreshCw, History, Star, Clock, CheckCircle2, User,
  ArrowUp, ArrowDown, ChevronsUpDown, Trash2, Paperclip,
  LayoutList, FolderTree, FolderInput, Layers,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { RecipientAutocomplete, type RecipientUser } from "@/components/recipient-autocomplete";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  under_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-700",
  issued: "bg-blue-100 text-blue-700",
  superseded: "bg-purple-100 text-purple-700",
  void: "bg-red-100 text-red-700",
};

const SOURCE_OPTIONS = ["internal", "external", "client", "contractor", "consultant", "supplier"];

type SortKey = "documentNumber" | "title" | "projectName" | "discipline" | "source" | "issuedBy" | "revision" | "status" | "updatedAt" | "direction";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="h-3 w-3 ml-1 text-muted-foreground/50 inline" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary inline" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary inline" />;
}

// ─── Column definitions for resizable table ───────────────────────────────────
const DOC_COLS_BASE = [
  { key: "documentNumber", defaultWidth: 120, minWidth: 80 },
  { key: "title",          defaultWidth: 240, minWidth: 120 },
  { key: "projectName",    defaultWidth: 140, minWidth: 80 },
  { key: "discipline",     defaultWidth: 110, minWidth: 70 },
  { key: "direction",      defaultWidth: 90,  minWidth: 60 },
  { key: "source",         defaultWidth: 100, minWidth: 70 },
  { key: "issuedBy",       defaultWidth: 120, minWidth: 70 },
  { key: "revision",       defaultWidth: 65,  minWidth: 50 },
  { key: "status",         defaultWidth: 110, minWidth: 80 },
  { key: "updatedAt",      defaultWidth: 110, minWidth: 90 },
];

export default function DocumentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Column visibility
  const [showDirectionCol, setShowDirectionCol] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("_all");
  const [filterDiscipline, setFilterDiscipline] = useState("_all");
  const [filterStatus, setFilterStatus] = useState("_all");
  const [filterSource, setFilterSource] = useState("_all");
  const [filterIssuedBy, setFilterIssuedBy] = useState("");
  const [filterDirection, setFilterDirection] = useState("_all");

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (col: SortKey) => {
    if (sortKey === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  };

  // View mode: list or folder
  type ViewMode = "list" | "folders";
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [moveToFolderDoc, setMoveToFolderDoc] = useState<any>(null);

  // Quick preview dialog
  const [docPreview, setDocPreview] = useState<any>(null);

  // Version history sheet
  const [historyDoc, setHistoryDoc] = useState<any>(null);

  // Files panel sheet
  const [filesDoc, setFilesDoc] = useState<any>(null);

  const { data: revisionData, isLoading: revisionLoading } = useQuery({
    queryKey: ["doc-revisions", historyDoc?.id],
    enabled: !!historyDoc?.id,
    queryFn: async () => {
      const r = await fetch(`/api/documents/${historyDoc.id}/revisions`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  // Send for Workflow dialog
  const [workflowDoc, setWorkflowDoc] = useState<any>(null);
  const [wfAttachIds, setWfAttachIds] = useState<number[]>([]);
  const [wfForm, setWfForm] = useState({
    subject: "",
    purpose: "for_review",
    toUserIds: [] as number[],
    externalEmails: "",
    description: "",
  });

  const { data: docsData, isLoading, refetch } = useQuery({
    queryKey: ["global-documents"],
    queryFn: async () => {
      const r = await fetch("/api/documents");
      if (!r.ok) throw new Error("Failed to load documents");
      return r.json();
    },
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });

  const allDocs: any[] = docsData?.documents ?? [];
  const projects: any[] = projectsData?.projects ?? [];
  const allUsers: RecipientUser[] = (usersData?.users ?? []).map((u: any) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    organizationName: u.organizationName,
    role: u.role,
  }));

  // Compute unique filter options from loaded data
  const uniqueDisciplines = useMemo(() =>
    Array.from(new Set(allDocs.map((d: any) => d.discipline).filter(Boolean))) as string[],
    [allDocs]
  );
  const uniqueSources = useMemo(() =>
    Array.from(new Set(allDocs.map((d: any) => d.source).filter(Boolean))) as string[],
    [allDocs]
  );

  // Client-side filtering + sorting
  const filtered = useMemo(() => {
    let docs = allDocs.filter((d: any) => {
      if (filterProject !== "_all" && d.projectId !== parseInt(filterProject)) return false;
      if (filterDiscipline !== "_all" && d.discipline !== filterDiscipline) return false;
      if (filterStatus !== "_all" && d.status !== filterStatus) return false;
      if (filterSource !== "_all" && d.source !== filterSource) return false;
      if (filterDirection !== "_all" && (d.direction ?? "") !== filterDirection) return false;
      if (filterIssuedBy && !d.issuedBy?.toLowerCase().includes(filterIssuedBy.toLowerCase())) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          d.title?.toLowerCase().includes(q) ||
          d.documentNumber?.toLowerCase().includes(q) ||
          d.discipline?.toLowerCase().includes(q) ||
          d.revision?.toLowerCase().includes(q) ||
          d.issuedBy?.toLowerCase().includes(q) ||
          d.source?.toLowerCase().includes(q) ||
          d.projectName?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    docs = [...docs].sort((a, b) => {
      let av = a[sortKey] ?? "";
      let bv = b[sortKey] ?? "";
      if (sortKey === "updatedAt") {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return docs;
  }, [allDocs, filterProject, filterDiscipline, filterStatus, filterSource, filterIssuedBy, filterDirection, search, sortKey, sortDir]);

  const hasFilters = filterProject !== "_all" || filterDiscipline !== "_all" || filterStatus !== "_all" ||
    filterSource !== "_all" || filterIssuedBy || filterDirection !== "_all" || !!search;

  const clearFilters = () => {
    setFilterProject("_all"); setFilterDiscipline("_all");
    setFilterStatus("_all"); setFilterSource("_all");
    setFilterIssuedBy(""); setSearch(""); setFilterDirection("_all");
  };

  // Project docs for the workflow attachment picker
  const projectDocs = useMemo(() =>
    workflowDoc ? allDocs.filter(d => d.projectId === workflowDoc.projectId) : [],
    [allDocs, workflowDoc]
  );

  const sendForWorkflow = useMutation({
    mutationFn: async () => {
      if (!workflowDoc) return;
      const r = await fetch(`/api/projects/${workflowDoc.projectId}/transmittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: wfForm.subject || `For Review: ${workflowDoc.documentNumber} — ${workflowDoc.title}`,
          purpose: wfForm.purpose,
          toUserIds: wfForm.toUserIds,
          externalEmails: wfForm.externalEmails,
          description: wfForm.description,
          documentIds: wfAttachIds,
        }),
      });
      if (!r.ok) throw new Error("Failed to create transmittal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: `Transmittal created for ${workflowDoc?.documentNumber}` });
      qc.invalidateQueries({ queryKey: ["global-documents"] });
      setWorkflowDoc(null);
      setWfAttachIds([]);
      setWfForm({ subject: "", purpose: "for_review", toUserIds: [], externalEmails: "", description: "" });
    },
    onError: () => toast({ title: "Failed to send document for workflow", variant: "destructive" }),
  });

  const openWorkflow = (doc: any) => {
    setWorkflowDoc(doc);
    setWfAttachIds([doc.id]);
    setWfForm({
      subject: `For Review: ${doc.documentNumber} — ${doc.title}`,
      purpose: "for_review",
      toUserIds: [],
      externalEmails: "",
      description: "",
    });
  };

  // Start Workflow Engine dialog
  const [wfEngineDoc, setWfEngineDoc] = useState<any>(null);
  const [wfEngineTemplates, setWfEngineTemplates] = useState<any[]>([]);
  const [wfEngineTemplateId, setWfEngineTemplateId] = useState<number | null>(null);
  const [wfEngineLoading, setWfEngineLoading] = useState(false);
  const [wfEngineStarting, setWfEngineStarting] = useState(false);

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
      qc.invalidateQueries({ queryKey: ["global-documents"] });
      setWfEngineDoc(null);
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to start workflow", variant: "destructive" });
    } finally {
      setWfEngineStarting(false);
    }
  };

  // Move to folder mutation
  const moveToFolderMut = useMutation({
    mutationFn: async ({ docId, projectId, folderId }: { docId: number; projectId: number; folderId: number | null }) => {
      const r = await fetch(`/api/projects/${projectId}/documents/${docId}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (!r.ok) throw new Error("Failed to move document");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["global-documents"] });
      qc.invalidateQueries({ queryKey: ["project-folders"] });
      setMoveToFolderDoc(null);
      toast({ title: "Document moved" });
    },
    onError: () => toast({ title: "Failed to move document", variant: "destructive" }),
  });

  // Folder view: need folder list for move target selector
  const folderViewProjectId = filterProject !== "_all" ? parseInt(filterProject) : null;
  const { data: folderPickData } = useQuery({
    queryKey: ["project-folders", moveToFolderDoc?.projectId],
    queryFn: async () => {
      if (!moveToFolderDoc?.projectId) return { folders: [] };
      const r = await fetch(`/api/projects/${moveToFolderDoc.projectId}/documents/folders`);
      return r.json();
    },
    enabled: !!moveToFolderDoc,
  });
  const pickerFolders: any[] = folderPickData?.folders ?? [];

  const DOC_COLS = DOC_COLS_BASE.filter(c => c.key !== "direction" || showDirectionCol);

  const { getThStyle, startResize, resetWidths } = useResizableColumns("global-documents", DOC_COLS);

  const COLS: { key: SortKey; label: string }[] = [
    { key: "documentNumber", label: "Doc No." },
    { key: "title",          label: "Title" },
    { key: "projectName",    label: "Project" },
    { key: "discipline",     label: "Discipline" },
    ...(showDirectionCol ? [{ key: "direction" as SortKey, label: "Direction" }] : []),
    { key: "source",         label: "Source" },
    { key: "issuedBy",       label: "Issued By" },
    { key: "revision",       label: "Rev" },
    { key: "status",         label: "Status" },
    { key: "updatedAt",      label: "Updated" },
  ];

  // Filter docs by folder in folder view
  const folderFiltered = useMemo(() => {
    if (viewMode !== "folders" || !folderViewProjectId) return filtered;
    return filtered.filter(d => {
      if (selectedFolderId === null) return d.projectId === folderViewProjectId;
      return d.folderId === selectedFolderId && d.projectId === folderViewProjectId;
    });
  }, [viewMode, folderViewProjectId, selectedFolderId, filtered]);

  const displayDocs = viewMode === "folders" ? folderFiltered : filtered;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {viewMode === "folders" && folderViewProjectId
              ? `Folder view — ${displayDocs.length} document${displayDocs.length !== 1 ? "s" : ""}`
              : `All documents across your projects — ${filtered.length} of ${allDocs.length} shown`}
          </p>
        </div>
        <div className="flex gap-2">
          {/* View toggle */}
          <div className="flex rounded-md border overflow-hidden">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-9 px-3 gap-1.5 border-0"
              onClick={() => setViewMode("list")}
              title="List view"
            >
              <LayoutList className="h-3.5 w-3.5" /> List
            </Button>
            <Button
              variant={viewMode === "folders" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-9 px-3 gap-1.5 border-0 border-l"
              onClick={() => {
                setViewMode("folders");
                if (filterProject === "_all" && projects.length > 0) {
                  setFilterProject(String(projects[0].id));
                }
              }}
              title="Folder view (requires project filter)"
            >
              <FolderTree className="h-3.5 w-3.5" /> Folders
            </Button>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button asChild size="sm" className="gap-1.5 h-9">
            <Link href="/projects">
              <Plus className="h-3.5 w-3.5" /> Upload via Project
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-card border rounded-xl p-3 space-y-2 shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search title, number, discipline, issuer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>

          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Projects</SelectItem>
              {projects.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
            <SelectTrigger className="h-9 w-[140px] text-sm">
              <SelectValue placeholder="Discipline" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Disciplines</SelectItem>
              {uniqueDisciplines.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 w-[130px] text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Statuses</SelectItem>
              {["draft","under_review","approved","issued","superseded","void"].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="h-9 w-[130px] text-sm">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Sources</SelectItem>
              {Array.from(new Set([...SOURCE_OPTIONS, ...uniqueSources])).map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Issued by…"
            value={filterIssuedBy}
            onChange={e => setFilterIssuedBy(e.target.value)}
            className="h-9 w-[130px] text-sm"
          />

          {/* Direction filter chips */}
          <div className="flex items-center rounded-md border overflow-hidden h-9">
            {([["_all", "All"], ["incoming", "↓ In"], ["outgoing", "↑ Out"]] as [string, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilterDirection(val)}
                className={`px-2.5 h-full text-xs font-medium transition-colors border-r last:border-r-0 ${filterDirection === val ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 gap-1 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Folder view: require project filter */}
      {viewMode === "folders" && !folderViewProjectId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-center gap-2">
          <FolderTree className="h-4 w-4 shrink-0" />
          Select a project in the filter bar above to use the folder view.
        </div>
      )}

      {/* Main content area — sidebar + table layout in folder mode */}
      <div className={viewMode === "folders" && folderViewProjectId ? "flex gap-4 items-start" : ""}>
        {/* Folder sidebar */}
        {viewMode === "folders" && folderViewProjectId && (
          <div className="w-56 shrink-0 border rounded-xl bg-card shadow-sm overflow-hidden">
            <FolderSidebar
              projectId={folderViewProjectId}
              selectedFolderId={selectedFolderId}
              onSelectFolder={setSelectedFolderId}
              canEdit={true}
            />
          </div>
        )}

      {/* Table */}
      <div className={`bg-card border rounded-xl shadow-sm overflow-hidden ${viewMode === "folders" && folderViewProjectId ? "flex-1 min-w-0" : ""}`}>
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
          <button
            onClick={() => setShowDirectionCol(v => !v)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${showDirectionCol ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:bg-muted border-transparent"}`}
            title="Toggle Direction column visibility"
          >
            {showDirectionCol ? "↓↑ Hide Direction" : "↓↑ Show Direction"}
          </button>
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
            onClick={resetWidths}
            title="Reset column widths to default"
          >
            Reset columns
          </button>
        </div>
        <div className="overflow-x-auto">
          <Table style={{ tableLayout: "fixed", minWidth: 900 }}>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {COLS.map(col => (
                  <TableHead
                    key={col.key}
                    style={getThStyle(col.key)}
                    className="cursor-pointer select-none hover:bg-muted/60 transition-colors text-xs overflow-hidden"
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="truncate inline-flex items-center">
                      {col.label}
                      <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                    </span>
                    {/* Resize handle — stops sort click from firing */}
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary"
                      onMouseDown={e => startResize(col.key, e)}
                      onClick={e => e.stopPropagation()}
                    />
                  </TableHead>
                ))}
                <TableHead className="text-right w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={COLS.length + 1} className="py-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : displayDocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLS.length + 1} className="py-12 text-center text-muted-foreground">
                    <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    {viewMode === "folders"
                      ? "No documents in this folder."
                      : "No documents match the current filters."}
                  </TableCell>
                </TableRow>
              ) : displayDocs.map((doc: any) => (
                <TableRow
                  key={doc.id}
                  className="hover:bg-muted/20 group"
                >
                  <TableCell
                    className="font-mono text-xs font-semibold text-primary truncate cursor-pointer hover:underline underline-offset-2"
                    onClick={() => navigate(`/documents/${doc.id}`)}
                    title="Open full document page"
                  >{doc.documentNumber}</TableCell>
                  <TableCell
                    className="cursor-pointer"
                    onClick={() => setDocPreview(doc)}
                    title="Click to quick preview"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate hover:underline underline-offset-2" title={doc.title}>{doc.title}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate">{doc.projectName || "—"}</TableCell>
                  <TableCell className="text-xs truncate">{doc.discipline || "—"}</TableCell>
                  {showDirectionCol && (
                    <TableCell>
                      {doc.direction ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${doc.direction === "incoming" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400"}`}>
                          {doc.direction === "incoming" ? "↓ In" : "↑ Out"}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-xs capitalize truncate">{doc.source || "—"}</TableCell>
                  <TableCell className="text-xs truncate">{doc.issuedBy || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{doc.revision || "—"}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${STATUS_COLORS[doc.status] || "bg-muted text-muted-foreground"}`}>
                      {doc.status?.replace(/_/g, " ") || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {doc.updatedAt ? format(new Date(doc.updatedAt), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {doc.fileUrl && (
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7" title="Download"
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
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30" title="AI Analysis / Open Document"
                        onClick={() => navigate(`/documents/${doc.id}`)}>
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Files"
                        onClick={() => setFilesDoc(doc)}>
                        <Paperclip className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Version History"
                        onClick={() => setHistoryDoc(doc)}>
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Move to Folder"
                        onClick={() => setMoveToFolderDoc(doc)}>
                        <FolderInput className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Create Transmittal"
                        onClick={() => openWorkflow(doc)}>
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Start Workflow"
                        onClick={() => openStartWorkflow(doc)}>
                        <Layers className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Open Project" asChild>
                        <Link href={`/projects/${doc.projectId}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      </div>{/* end flex wrapper */}

      {/* Files Panel Sheet */}
      <Sheet open={!!filesDoc} onOpenChange={open => !open && setFilesDoc(null)}>
        <SheetContent className="w-[440px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Files — {filesDoc?.documentNumber}
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            {filesDoc && (
              <DocumentFilesPanel
                documentId={filesDoc.id}
                projectId={filesDoc.projectId}
                canEdit={true}
              />
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Version History Sheet */}
      <Sheet open={!!historyDoc} onOpenChange={open => !open && setHistoryDoc(null)}>
        <SheetContent className="w-[440px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Version History — {historyDoc?.documentNumber}
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            {revisionLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : !revisionData?.revisions?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">No revision history found.</p>
            ) : (
              <div className="space-y-3">
                {revisionData.revisions.map((rev: any, i: number) => (
                  <div key={rev.id} className="border rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-semibold text-primary">Rev {rev.revision}</span>
                      {i === 0 && <Badge variant="secondary" className="text-[10px]">Latest</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{rev.changeDescription || "No description"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {rev.createdAt ? format(new Date(rev.createdAt), "dd MMM yyyy HH:mm") : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Quick Preview Dialog */}
      <Dialog open={!!docPreview} onOpenChange={v => { if (!v) setDocPreview(null); }}>
        <DialogContent className="max-w-5xl w-full h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b shrink-0 flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold truncate">{docPreview?.title}</DialogTitle>
                <p className="text-xs text-muted-foreground font-mono">{docPreview?.documentNumber} · Rev {docPreview?.revision ?? "01"}</p>
                {docPreview?.projectName && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Building2 className="h-3 w-3" />
                    {docPreview.projectName}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
            <div className="flex-1 overflow-hidden bg-muted/30">
              {docPreview && <DocumentPreviewContent doc={docPreview} />}
            </div>
            {docPreview && (
              <div className="w-72 border-l bg-card overflow-y-auto p-3 shrink-0 flex flex-col gap-3">
                <DocumentFilesPanel
                  documentId={docPreview.id}
                  projectId={docPreview.projectId}
                  canEdit={false}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={!!moveToFolderDoc} onOpenChange={open => !open && setMoveToFolderDoc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderInput className="h-4 w-4" /> Move to Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="bg-muted/40 rounded-lg p-3 text-sm">
              <p className="font-mono font-semibold text-primary text-xs">{moveToFolderDoc?.documentNumber}</p>
              <p className="text-muted-foreground text-xs mt-0.5 truncate">{moveToFolderDoc?.title}</p>
            </div>
            <Select
              value={moveToFolderDoc?.folderId ? String(moveToFolderDoc.folderId) : "_root"}
              onValueChange={val => {
                if (!moveToFolderDoc) return;
                moveToFolderMut.mutate({
                  docId: moveToFolderDoc.id,
                  projectId: moveToFolderDoc.projectId,
                  folderId: val === "_root" ? null : parseInt(val),
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select folder…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_root">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <FolderOpen className="h-3.5 w-3.5" /> Root (no folder)
                  </span>
                </SelectItem>
                {pickerFolders.map((f: any) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    <span className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-amber-500" /> {f.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pickerFolders.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No folders in this project yet. Create folders first via the Folders view.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveToFolderDoc(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Transmittal Dialog */}
      <Dialog open={!!workflowDoc} onOpenChange={open => { if (!open) { setWorkflowDoc(null); setWfAttachIds([]); } }}>
        <DialogContent className="max-w-lg max-h-[88vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" />
              Create Transmittal
            </DialogTitle>
            {workflowDoc?.projectName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Building2 className="h-3 w-3" />
                <span className="font-semibold text-foreground">{workflowDoc.projectName}</span>
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2 overflow-y-auto flex-1 pr-1">
            <div className="bg-muted/40 rounded-lg p-3 text-sm">
              <p className="font-mono font-semibold text-primary text-xs">{workflowDoc?.documentNumber}</p>
              <p className="font-medium text-sm mt-0.5">{workflowDoc?.title}</p>
            </div>

            {/* Attachments */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
                Attached Documents
              </Label>
              <div className="space-y-1.5 mb-2">
                {wfAttachIds.map(id => {
                  const doc = allDocs.find(d => d.id === id);
                  if (!doc) return null;
                  return (
                    <div key={id} className="flex items-center justify-between bg-muted/30 rounded px-3 py-1.5 text-sm">
                      <span className="font-mono text-xs text-primary font-semibold">{doc.documentNumber}</span>
                      <span className="text-xs text-muted-foreground truncate mx-2 flex-1">{doc.title}</span>
                      <Button
                        variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setWfAttachIds(prev => prev.filter(x => x !== id))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
                {wfAttachIds.length === 0 && (
                  <p className="text-xs text-muted-foreground italic px-1">No documents attached. Add at least one below.</p>
                )}
              </div>
              {/* Add more docs from same project */}
              {projectDocs.filter(d => !wfAttachIds.includes(d.id)).length > 0 && (
                <Select
                  value="_none"
                  onValueChange={val => {
                    if (val !== "_none") setWfAttachIds(prev => [...prev, parseInt(val)]);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="+ Add another document from this project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">+ Add another document…</SelectItem>
                    {projectDocs.filter(d => !wfAttachIds.includes(d.id)).map(d => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.documentNumber} — {d.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div>
              <Label htmlFor="wf-subject" className="text-xs">Subject</Label>
              <Input
                id="wf-subject"
                value={wfForm.subject}
                onChange={e => setWfForm(f => ({ ...f, subject: e.target.value }))}
                className="mt-1 h-9 text-sm"
              />
            </div>

            <div>
              <Label htmlFor="wf-purpose" className="text-xs">Purpose</Label>
              <Select value={wfForm.purpose} onValueChange={v => setWfForm(f => ({ ...f, purpose: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="for_review">For Review</SelectItem>
                  <SelectItem value="for_approval">For Approval</SelectItem>
                  <SelectItem value="for_action">For Action</SelectItem>
                  <SelectItem value="for_information">For Information</SelectItem>
                  <SelectItem value="for_construction">For Construction</SelectItem>
                  <SelectItem value="for_record">For Record / Filing</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Recipients</Label>
              <div className="mt-1">
                <RecipientAutocomplete
                  users={allUsers}
                  selectedIds={wfForm.toUserIds}
                  onChange={ids => setWfForm(f => ({ ...f, toUserIds: ids }))}
                  placeholder="Select team members…"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="wf-emails" className="text-xs">External Emails (comma-separated)</Label>
              <Input
                id="wf-emails"
                value={wfForm.externalEmails}
                onChange={e => setWfForm(f => ({ ...f, externalEmails: e.target.value }))}
                placeholder="user@external.com"
                className="mt-1 h-9 text-sm"
              />
            </div>

            <div>
              <Label htmlFor="wf-desc" className="text-xs">Notes</Label>
              <Textarea
                id="wf-desc"
                value={wfForm.description}
                onChange={e => setWfForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                className="mt-1 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => { setWorkflowDoc(null); setWfAttachIds([]); }}>Cancel</Button>
            <Button
              onClick={() => sendForWorkflow.mutate()}
              disabled={sendForWorkflow.isPending || wfAttachIds.length === 0}
            >
              {sendForWorkflow.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : "Create Transmittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Start Workflow Dialog */}
      <Dialog open={!!wfEngineDoc} onOpenChange={open => { if (!open) setWfEngineDoc(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Start Workflow
            </DialogTitle>
          </DialogHeader>
          {wfEngineDoc && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg p-3 text-sm">
                <p className="font-medium">{wfEngineDoc.documentNumber}</p>
                <p className="text-muted-foreground text-xs mt-0.5">{wfEngineDoc.title}</p>
                {wfEngineDoc.documentType && (
                  <p className="text-xs text-muted-foreground mt-0.5">Type: {wfEngineDoc.documentType}</p>
                )}
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
                    <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {wfEngineTemplates.map((t: any) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                          {t.documentType ? ` (${t.documentType})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {wfEngineTemplates.length > 0 && (() => {
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
            >
              {wfEngineStarting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Starting…</> : <><Layers className="h-4 w-4 mr-1.5" />Start Workflow</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

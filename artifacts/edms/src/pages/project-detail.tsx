import { useParams, Link } from "wouter";
import { useGetProject, useListDocuments, useCreateDocument } from "@workspace/api-client-react";
import {
  FileText, Mail, CheckSquare, GitBranch, Users, ArrowLeft, Loader2,
  Plus, Download, Upload, Eye, Sparkles, Send, Package, AlertCircle,
  Clock, RefreshCw, Check, X, Square,
  Layers, UserCheck, FileDown, Trash2, ChevronDown,
  ClipboardCheck, GitCompare, ShieldAlert, History, ThumbsUp, ThumbsDown,
  UserPlus, Diff, Pencil, Link2, Paperclip, Building2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileDropZone, type UploadedFile } from "@/components/file-drop-zone";
import { RecipientAutocomplete } from "@/components/recipient-autocomplete";
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
import { AIInsightsPanel } from "@/components/ai/AIInsightsPanel";
import { AIProcedurePanel } from "@/components/ai/AIProcedurePanel";
import { useToast } from "@/hooks/use-toast";

// ─── Shared Utilities ────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    sent: "bg-blue-100 text-blue-700",
    acknowledged: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    approved: "bg-green-100 text-green-700",
    pending_review: "bg-yellow-100 text-yellow-700",
    responded: "bg-purple-100 text-purple-700",
    closed: "bg-gray-100 text-gray-500",
    overdue: "bg-red-100 text-red-700",
    active: "bg-emerald-100 text-emerald-700",
    in_review: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const params = useParams();
  const projectId = parseInt(params.id || "0");
  const { data: project, isLoading: projLoading } = useGetProject(projectId);
  const [activeTab, setActiveTab] = useState("documents");

  if (projLoading) return <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!project) return <div>Project not found</div>;

  const tabs = [
    { value: "documents", icon: FileText, label: "Documents" },
    { value: "review", icon: ClipboardCheck, label: "Review" },
    { value: "transmittals", icon: Send, label: "Transmittals" },
    { value: "correspondence", icon: Mail, label: "Correspondence" },
    { value: "packages", icon: Package, label: "Packages" },
    { value: "tasks", icon: CheckSquare, label: "Tasks" },
    { value: "workflows", icon: GitBranch, label: "Workflows" },
    { value: "members", icon: Users, label: "Members" },
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
            <DocumentTab projectId={projectId} projectCode={project.code} projectName={project.name} />
          </TabsContent>
          <TabsContent value="review">
            <ReviewTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="transmittals">
            <TransmittalsTab projectId={projectId} />
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
        </div>
      </Tabs>
    </div>
  );
}

// ─── Document Tab ─────────────────────────────────────────────────────────────
function DocumentTab({ projectId, projectCode, projectName }: { projectId: number; projectCode?: string; projectName?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListDocuments(projectId);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isBulkTransOpen, setIsBulkTransOpen] = useState(false);
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
  const createDoc = useCreateDocument();
  const [docNumber, setDocNumber] = useState("");
  const [title, setTitle] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [revision, setRevision] = useState("01");
  const [docType, setDocType] = useState("general");
  const [uploadSource, setUploadSource] = useState("");
  const [uploadIssuedBy, setUploadIssuedBy] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [filterDiscipline, setFilterDiscipline] = useState("_all");
  const [filterDocType, setFilterDocType] = useState("_all");
  const [aiDoc, setAiDoc] = useState<any>(null);
  const [compareDoc, setCompareDoc] = useState<any>(null);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Bulk transmittal form
  const [bulkTrsForm, setBulkTrsForm] = useState({ subject: "", purpose: "for_review", toExternal: "", description: "" });
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [bulkAssignStatus, setBulkAssignStatus] = useState("in_review");
  // File upload state
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  // Document edit state
  const [editDoc, setEditDoc] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: "", discipline: "", revision: "", documentType: "", description: "", source: "", issuedBy: "" });
  const [editFile, setEditFile] = useState<UploadedFile | null>(null);
  const [editAdditionalFiles, setEditAdditionalFiles] = useState<UploadedFile[]>([]);
  // Send for Workflow state
  const [wfDoc, setWfDoc] = useState<any>(null);
  const [wfForm, setWfForm] = useState({ subject: "", purpose: "for_review", toUserIds: [] as number[], externalEmails: "", description: "" });
  // Upload form validation
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Document share state
  const [shareDoc, setShareDoc] = useState<any>(null);
  const [docShareForm, setDocShareForm] = useState({ expiresInDays: "30", password: "" });
  const [docShareResult, setDocShareResult] = useState<{ shareUrl: string; expiresAt: string | null } | null>(null);

  const handleUpload = async () => {
    const resolvedTitle = title.trim() || (uploadedFile ? uploadedFile.name.replace(/\.[^.]+$/, "") : "");
    if (!resolvedTitle) { setUploadError("Title is required."); return; }
    setUploadError(null);
    await createDoc.mutateAsync({
      projectId,
      data: {
        documentNumber: docNumber || `DOC-${Date.now()}`,
        title: resolvedTitle,
        revision: revision || "01",
        status: "draft",
        discipline: discipline || undefined,
        documentType: docType || "general",
        source: uploadSource || undefined,
        issuedBy: uploadIssuedBy || undefined,
        fileUrl: uploadedFile?.url,
        fileName: uploadedFile?.name,
        fileSize: uploadedFile?.size,
      } as any
    });
    setIsUploadOpen(false);
    setDocNumber(""); setTitle(""); setDiscipline(""); setRevision("01"); setDocType("general");
    setUploadSource(""); setUploadIssuedBy("");
    setUploadedFile(null);
  };

  const updateDoc = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/projects/${projectId}/documents/${editDoc!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to update");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      setEditDoc(null);
      setEditFile(null);
      toast({ title: "Document updated" });
    },
    onError: () => toast({ title: "Failed to update document", variant: "destructive" }),
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
  const allUsers = (usersData?.users ?? []).map((u: any) => ({
    id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email,
    organizationName: u.organizationName, role: u.role,
  }));

  const handleAIProcedureApply = (suggestion: any) => {
    if (suggestion.documentNumber) setDocNumber(suggestion.documentNumber);
    if (suggestion.discipline) setDiscipline(suggestion.discipline);
    if (suggestion.documentType) setDocType(suggestion.documentType);
    if (suggestion.revision) setRevision(suggestion.revision);
    if (suggestion.title && !title) setTitle(suggestion.title);
  };

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

  const allDocs = data?.documents ?? [];
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
      const docList = selectedDocs.map((d: any) => `${d.documentNumber} - ${d.title} (Rev ${d.revision ?? "01"})`).join("; ");
      setBulkTrsForm(f => ({ ...f, description: `Transmittal covering ${selectedDocs.length} document(s): ${docList}. Please review and acknowledge receipt.` }));
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const createBulkTransmittal = useMutation({
    mutationFn: async () => {
      const docIds = selectedDocs.map((d: any) => d.id);
      const r = await fetch(`/api/projects/${projectId}/transmittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bulkTrsForm, documentIds: docIds }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      setIsBulkTransOpen(false);
      clearSelection();
      setBulkTrsForm({ subject: "", purpose: "for_review", toExternal: "", description: "" });
      toast({ title: `Transmittal created with ${selectedDocs.length} document(s)` });
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
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setIsBulkTransOpen(true)}>
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
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={runValidation} disabled={validating || allDocs.length === 0}>
            <ShieldAlert className="h-3.5 w-3.5" />
            {validating ? "Validating..." : "Validate"}
          </Button>
          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <Button size="sm" className="h-9" onClick={() => setIsUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Upload Document
            </Button>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <AIProcedurePanel projectCode={projectCode} projectName={projectName} discipline={discipline} documentType={docType} partialTitle={title} onApply={handleAIProcedureApply} />
                <FileDropZone
                  onUpload={(f) => { setUploadedFile(f); if (!title) setTitle(f.name.replace(/\.[^.]+$/, "")); }}
                  label="Click to browse or drag file here"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">Document Number</label>
                    <Input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Auto-generated or from AI" className="font-mono" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">Title *</label>
                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="E.g. Ground Floor Plan" />
                    {uploadError && <p className="text-xs text-destructive mt-1">{uploadError}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Discipline</label>
                    <Input value={discipline} onChange={e => setDiscipline(e.target.value)} placeholder="E.g. Electrical" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Revision</label>
                    <Input value={revision} onChange={e => setRevision(e.target.value)} placeholder="01" className="font-mono" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Source</label>
                    <Select value={uploadSource || "_none"} onValueChange={v => setUploadSource(v === "_none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Select source…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— None —</SelectItem>
                        {["internal","external","client","contractor","consultant","supplier"].map(s => (
                          <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Issued By</label>
                    <Input value={uploadIssuedBy} onChange={e => setUploadIssuedBy(e.target.value)} placeholder="E.g. ABC Engineering" />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
                <Button onClick={handleUpload} disabled={createDoc.isPending}>
                  {createDoc.isPending ? "Saving..." : "Save Document"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Bulk Transmittal Dialog */}
      <Dialog open={isBulkTransOpen} onOpenChange={setIsBulkTransOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Create Transmittal — {selectedDocs.length} Document(s)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Selected doc list */}
            <div className="bg-muted/40 rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
              {selectedDocs.map((d: any) => (
                <div key={d.id} className="flex items-center gap-2 text-xs">
                  <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-mono text-muted-foreground">{d.documentNumber}</span>
                  <span className="truncate">{d.title}</span>
                  <span className="font-mono text-muted-foreground shrink-0">Rev {d.revision ?? "01"}</span>
                </div>
              ))}
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
                    {[["for_information","For Information"],["for_review","For Review"],["for_approval","For Approval"],["for_construction","For Construction"],["as_built","As Built"]].map(([v,l]) => (
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
            <Button onClick={() => createBulkTransmittal.mutate()} disabled={createBulkTransmittal.isPending || !bulkTrsForm.subject}>
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

      {/* Documents Table */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
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
              <TableHead>Document No.</TableHead>
              <TableHead className="w-1/4">Title</TableHead>
              <TableHead>Discipline</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Issued By</TableHead>
              <TableHead>Rev</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !filtered.length ? (
              <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No documents found.</TableCell></TableRow>
            ) : filtered.map((doc: any) => {
              const isSelected = selectedIds.has(doc.id);
              return (
                <TableRow key={doc.id} className={`hover:bg-muted/30 group cursor-pointer ${isSelected ? "bg-primary/5" : ""}`} onClick={() => toggleSelect(doc.id)}>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <button onClick={() => toggleSelect(doc.id)} className="p-0.5 rounded hover:bg-accent">
                      {isSelected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4 text-muted-foreground" />
                      }
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium">{doc.documentNumber}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary/70 shrink-0" />
                      <span className="line-clamp-1">{doc.title}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{(doc as any).discipline || "—"}</TableCell>
                  <TableCell>
                    {doc.source ? (
                      <span className="inline-flex items-center text-xs bg-muted/60 px-2 py-0.5 rounded-full capitalize">
                        {doc.source}
                      </span>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[90px] truncate">{doc.issuedBy || "—"}</TableCell>
                  <TableCell><span className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{doc.revision ?? "01"}</span></TableCell>
                  <TableCell><StatusBadge status={doc.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(doc.updatedAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10" title="AI Analyze" onClick={() => setAiDoc(doc)}>
                        <Sparkles className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Compare revisions" onClick={() => setCompareDoc(doc)}>
                        <GitCompare className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit document" onClick={() => {
                        setEditDoc(doc);
                        setEditForm({ title: doc.title, discipline: doc.discipline ?? "", revision: doc.revision ?? "01", documentType: doc.documentType ?? "general", description: doc.description ?? "", source: doc.source ?? "", issuedBy: doc.issuedBy ?? "" });
                        setEditFile(null);
                      }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Send for Workflow" onClick={() => {
                        setWfDoc(doc);
                        setWfForm({ subject: `For Review: ${doc.documentNumber} — ${doc.title}`, purpose: "for_review", toUserIds: [], externalEmails: "", description: "" });
                      }}>
                        <Send className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Generate share link" onClick={() => {
                        setShareDoc(doc);
                        setDocShareResult(null);
                        setDocShareForm({ expiresInDays: "30", password: "" });
                      }}>
                        <Link2 className="h-4 w-4" />
                      </Button>
                      {doc.fileUrl && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Download" asChild>
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" /></a>
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

      {/* Edit Document Dialog */}
      <Dialog open={!!editDoc} onOpenChange={v => { if (!v) { setEditDoc(null); setEditFile(null); setEditAdditionalFiles([]); } }}>
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
                <Input value={editForm.documentType} onChange={e => setEditForm(f => ({ ...f, documentType: e.target.value }))} className="mt-1" placeholder="E.g. drawing" />
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
            <div>
              <Label className="mb-2 block">Replace Primary File (optional)</Label>
              <FileDropZone onUpload={setEditFile} label="Drop new file version here" />
              {editFile && <p className="text-xs text-muted-foreground mt-1">New file: {editFile.name}</p>}
              {!editFile && editDoc?.fileName && <p className="text-xs text-muted-foreground mt-1">Current: {editDoc.fileName}</p>}
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
            <Button variant="outline" onClick={() => { setEditDoc(null); setEditFile(null); setEditAdditionalFiles([]); }}>Cancel</Button>
            <Button
              onClick={() => {
                const existing: any[] = Array.isArray(editDoc?.additionalFiles) ? editDoc.additionalFiles : [];
                const combined = [...existing.filter((ef: any) => !editAdditionalFiles.find(nf => nf.name === ef.name)), ...editAdditionalFiles];
                updateDoc.mutate({
                  title: editForm.title, discipline: editForm.discipline, revision: editForm.revision,
                  documentType: editForm.documentType, description: editForm.description,
                  source: editForm.source || undefined, issuedBy: editForm.issuedBy || undefined,
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

      {/* Share Document Dialog */}
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

      {/* Send for Workflow Dialog */}
      <Dialog open={!!wfDoc} onOpenChange={v => { if (!v) setWfDoc(null); }}>
        <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Send for Workflow</DialogTitle>
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
                    {[["for_review","For Review"],["for_approval","For Approval"],["for_information","For Information"],["for_construction","For Construction"],["as_built","As Built"]].map(([v,l]) => (
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
              {sendForWorkflow.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</> : <><Send className="h-3.5 w-3.5" /> Send for Workflow</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selection summary bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-primary text-white rounded-full shadow-lg px-5 py-2.5 flex items-center gap-4 text-sm font-medium">
          <CheckSquare className="h-4 w-4" />
          {selectedIds.size} document{selectedIds.size !== 1 ? "s" : ""} selected
          <button onClick={() => setIsBulkTransOpen(true)} className="px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-xs gap-1 flex items-center">
            <Send className="h-3.5 w-3.5" /> Transmit
          </button>
          <button onClick={clearSelection} className="text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Sheet open={!!aiDoc} onOpenChange={(open) => !open && setAiDoc(null)}>
        <SheetContent className="w-[420px] sm:max-w-[420px] overflow-y-auto">
          <SheetHeader className="mb-4"><SheetTitle className="text-base">Document AI Analysis</SheetTitle></SheetHeader>
          {aiDoc && <AIInsightsPanel entityId={aiDoc.id} entityType="document" entityTitle={`${aiDoc.documentNumber} — ${aiDoc.title}`} />}
        </SheetContent>
      </Sheet>

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
function TransmittalsTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareForm, setShareForm] = useState({ expiresInDays: "30", password: "" });
  const [shareResult, setShareResult] = useState<{ shareUrl: string; expiresAt: string | null } | null>(null);
  const [form, setForm] = useState({
    subject: "", description: "", purpose: "for_information",
    toExternal: "", externalEmails: "", dueDate: "",
  });
  const [createDocIds, setCreateDocIds] = useState<number[]>([]);
  const [addItemDocId, setAddItemDocId] = useState("_none");

  const { data: transmittalsData, isLoading } = useQuery({
    queryKey: ["transmittals", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals`);
      return r.json();
    },
  });
  const transmittals = Array.isArray(transmittalsData) ? transmittalsData : (transmittalsData?.transmittals ?? transmittalsData ?? []);

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
  const documents = docsData?.documents ?? [];

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

  const create = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, documentIds: createDocIds }),
      });
      if (!r.ok) throw new Error("Failed to create transmittal");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      setIsCreateOpen(false);
      setForm({ subject: "", description: "", purpose: "for_information", toExternal: "", externalEmails: "", dueDate: "" });
      setCreateDocIds([]);
      toast({ title: "Transmittal created" });
    },
    onError: () => toast({ title: "Failed to create transmittal", variant: "destructive" }),
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

  const purposes = ["for_information", "for_review", "for_approval", "for_construction", "as_built"];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-lg">Transmittals</h3>
          <p className="text-sm text-muted-foreground">{transmittals.length} transmittal(s) in this project</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New Transmittal
        </Button>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader><DialogTitle>Create Transmittal</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
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
                    {purposes.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
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
              <Input value={form.toExternal} onChange={e => setForm(f => ({ ...f, toExternal: e.target.value }))} placeholder="Contractor, consultant, client name..." className="mt-1" />
            </div>
            <div>
              <Label>External Recipients (emails)</Label>
              <Input value={form.externalEmails} onChange={e => setForm(f => ({ ...f, externalEmails: e.target.value }))} placeholder="alice@firm.com, bob@client.com (comma separated)" className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Separate multiple email addresses with commas. Recipients will receive an external access link.</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Attach Documents from Project</Label>
                {documents.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (createDocIds.length === documents.length) setCreateDocIds([]);
                      else setCreateDocIds(documents.map((d: any) => d.id));
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {createDocIds.length === documents.length ? "Deselect All" : "Select All"}
                  </button>
                )}
              </div>
              <div className="border rounded-lg p-2 max-h-40 overflow-y-auto space-y-1 bg-muted/20">
                {documents.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">No documents in this project yet</p>
                ) : documents.map((d: any) => {
                  const checked = createDocIds.includes(d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded hover:bg-muted/50">
                      <input type="checkbox" checked={checked} onChange={() => setCreateDocIds(prev => checked ? prev.filter(id => id !== d.id) : [...prev, d.id])} className="rounded" />
                      <span className="text-xs font-mono text-muted-foreground shrink-0">{d.documentNumber}</span>
                      <span className="text-xs truncate">{d.title}</span>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">Rev {d.revision ?? "01"}</span>
                    </label>
                  );
                })}
              </div>
              {createDocIds.length > 0 && (
                <p className="text-xs text-primary mt-1">{createDocIds.length} of {documents.length} document(s) selected</p>
              )}
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes for recipients..." className="mt-1" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate(form)} disabled={create.isPending || !form.subject}>
              {create.isPending ? "Creating..." : "Create Transmittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>TRS No.</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !transmittals.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No transmittals yet. Create the first one.</TableCell></TableRow>
            ) : transmittals.map((t: any) => {
              const isOverdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "acknowledged";
              return (
                <TableRow key={t.id} className={`hover:bg-muted/30 ${isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
                  <TableCell className="font-mono text-xs font-medium">{t.transmittalNumber}</TableCell>
                  <TableCell className="max-w-xs"><span className="line-clamp-1">{t.subject}</span></TableCell>
                  <TableCell className="text-xs capitalize">{(t.purpose || "").replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.toExternal || "—"}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell>
                    {t.dueDate ? (
                      <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                        {format(new Date(t.dueDate), "dd MMM yy")}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setSelected(t); setDetailOpen(true); }}>
                        <Eye className="h-3 w-3" /> Detail
                      </Button>
                      {t.status === "draft" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => sendTransmittal.mutate(t.id)}>
                          <Send className="h-3 w-3" /> Send
                        </Button>
                      )}
                      {t.status === "sent" && (
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
                  <span className="text-xs text-muted-foreground capitalize">{(selected.purpose || "").replace(/_/g, " ")}</span>
                  {selected.dueDate && (
                    <span className="text-xs text-muted-foreground">Due: {format(new Date(selected.dueDate), "dd MMM yyyy")}</span>
                  )}
                </div>
                {selected.description && <p className="text-sm text-muted-foreground mt-2">{selected.description}</p>}
              </div>

              {/* External Recipients */}
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">External Recipients</p>
                {selected.toExternal ? (
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-3 w-3 text-primary" />
                    </div>
                    <span className="font-medium">{selected.toExternal}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No external company specified</p>
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
                        <span className="font-mono text-xs text-muted-foreground shrink-0">{item.document?.documentNumber ?? "—"}</span>
                        <span className="text-xs truncate flex-1">{item.document?.title ?? item.fileName ?? "Attachment"}</span>
                        {item.document?.fileUrl && (
                          <a href={item.document.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0"><Download className="h-3 w-3" /></a>
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
const CORR_TYPES = ["rfi", "submittal", "ncr", "technical_query", "transmittal", "letter", "memo", "email", "internal", "notice"];
const CORR_TYPE_LABELS: Record<string, string> = {
  rfi: "RFI", submittal: "Submittal", ncr: "NCR", technical_query: "TQ",
  transmittal: "Transmittal", letter: "Letter", memo: "Memo",
  email: "Email", internal: "Internal", notice: "Notice",
};
const PRIORITIES = ["low", "medium", "high", "urgent"];

function CorrespondenceTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [form, setForm] = useState({
    subject: "", type: "rfi", body: "", priority: "medium",
    dueDate: "", referenceNumber: "",
  });

  const { data: corrData, isLoading } = useQuery({
    queryKey: ["correspondence", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/correspondence`);
      return r.json();
    },
  });
  const correspondence = corrData?.items ?? [];

  const create = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/projects/${projectId}/correspondence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, folder: "inbox", status: "draft" }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["correspondence", projectId] });
      setIsCreateOpen(false);
      setForm({ subject: "", type: "rfi", body: "", priority: "medium", dueDate: "", referenceNumber: "" });
      toast({ title: "Correspondence created" });
    },
    onError: () => toast({ title: "Failed to create", variant: "destructive" }),
  });

  const filtered = correspondence.filter((c: any) => {
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
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
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Search..." className="w-48 h-9" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {CORR_TYPES.map(t => <SelectItem key={t} value={t}>{CORR_TYPE_LABELS[t] || t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2 h-9">
          <Plus className="h-4 w-4" /> New Correspondence
        </Button>
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

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader><DialogTitle>New Correspondence</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate(form)} disabled={create.isPending || !form.subject}>
              {create.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Ref.</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !filtered.length ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No correspondence found.</TableCell></TableRow>
            ) : filtered.map((c: any) => {
              const isOverdue = c.dueDate && new Date(c.dueDate) < new Date() && c.status !== "closed";
              return (
                <TableRow key={c.id} className={`hover:bg-muted/30 ${isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
                  <TableCell className="font-mono text-xs">{c.referenceNumber || `#${c.id}`}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{CORR_TYPE_LABELS[c.type] || c.type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs"><span className="line-clamp-1">{c.subject}</span></TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColor[c.priority] ?? "bg-muted"}`}>{c.priority}</span>
                  </TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell>
                    {c.dueDate ? (
                      <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                        {format(new Date(c.dueDate), "dd MMM yy")}
                        {isOverdue && <span className="ml-1 text-red-500">!</span>}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "dd MMM yyyy")}</TableCell>
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
        <Button asChild variant="outline" className="gap-2">
          <Link href="/tasks">View All Tasks <ArrowLeft className="h-4 w-4 rotate-180" /></Link>
        </Button>
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
  const allUsers: any[] = usersData?.users ?? [];
  const memberUserIds = new Set(members.map((m: any) => m.userId));
  const availableUsers = allUsers.filter((u: any) => !memberUserIds.has(u.id) && u.isActive);

  const addMember = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: parseInt(addUserId), role: addRole }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
      setAddOpen(false);
      setAddUserId("");
      toast({ title: "Member added to project" });
    },
    onError: () => toast({ title: "Failed to add member", variant: "destructive" }),
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
                  <SelectItem value="project_admin">Project Admin</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                  <SelectItem value="document_controller">Document Controller</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
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
                          <SelectItem value="project_admin" className="text-xs">Project Admin</SelectItem>
                          <SelectItem value="project_manager" className="text-xs">Project Manager</SelectItem>
                          <SelectItem value="document_controller" className="text-xs">Document Controller</SelectItem>
                          <SelectItem value="reviewer" className="text-xs">Reviewer</SelectItem>
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
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [submitComment, setSubmitComment] = useState("");
  const [reviewerIds, setReviewerIds] = useState<number[]>([]);

  const { data: docsData, isLoading: docsLoading } = useListDocuments(projectId);
  const allDocs = docsData?.documents ?? [];

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

  const approveDoc = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${selectedDoc.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: reviewComment }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["reviews", selectedDoc?.id] });
      setSelectedDoc(data);
      setReviewComment("");
      toast({ title: "Document approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectDoc = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${selectedDoc.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: reviewComment }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["reviews", selectedDoc?.id] });
      setSelectedDoc(data);
      setReviewComment("");
      toast({ title: "Document rejected — returned to draft" });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const REVIEW_STATES = [
    { key: "draft", label: "Draft", color: "bg-gray-100 text-gray-700" },
    { key: "under_review", label: "Under Review", color: "bg-blue-100 text-blue-700" },
    { key: "approved", label: "Approved", color: "bg-emerald-100 text-emerald-700" },
    { key: "rejected", label: "Rejected", color: "bg-red-100 text-red-700" },
  ];

  const reviewableDocs = allDocs.filter((d: any) => ["draft", "under_review", "approved", "rejected"].includes(d.status));

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
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  doc.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                  doc.status === "under_review" ? "bg-blue-100 text-blue-700" :
                  doc.status === "rejected" ? "bg-red-100 text-red-700" :
                  "bg-gray-100 text-gray-700"
                }`}>{doc.status.replace(/_/g, " ")}</span>
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
              {selectedDoc.status === "draft" && (
                <Button className="gap-2" onClick={() => setSubmitOpen(true)}>
                  <Send className="h-4 w-4" /> Submit for Review
                </Button>
              )}
              {selectedDoc.status === "under_review" && (
                <>
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">Review Comment</Label>
                    <div className="flex gap-2">
                      <Input value={reviewComment} onChange={e => setReviewComment(e.target.value)} placeholder="Add a comment..." className="h-9" />
                      <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => approveDoc.mutate()} disabled={approveDoc.isPending}>
                        <ThumbsUp className="h-4 w-4" /> Approve
                      </Button>
                      <Button variant="destructive" className="gap-1.5" onClick={() => rejectDoc.mutate()} disabled={rejectDoc.isPending}>
                        <ThumbsDown className="h-4 w-4" /> Reject
                      </Button>
                    </div>
                  </div>
                </>
              )}
              {selectedDoc.status === "approved" && (
                <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium">
                  <Check className="h-5 w-5" /> This document has been approved.
                  <Button variant="outline" size="sm" className="ml-2" onClick={() => rejectDoc.mutate()}>Revoke Approval</Button>
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
                  {reviewHistory.map((event: any) => (
                    <div key={event.id} className="flex gap-3 text-sm">
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        event.action === "approved" ? "bg-emerald-100 text-emerald-700" :
                        event.action === "rejected" ? "bg-red-100 text-red-700" :
                        "bg-blue-100 text-blue-700"
                      }`}>
                        {event.action === "approved" ? <ThumbsUp className="h-3.5 w-3.5" /> :
                         event.action === "rejected" ? <ThumbsDown className="h-3.5 w-3.5" /> :
                         <Send className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 border rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium capitalize">{event.action?.replace(/_/g, " ")}</span>
                          <span className="text-xs text-muted-foreground">{format(new Date(event.createdAt), "dd MMM yyyy HH:mm")}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">by {event.userName}</p>
                        {event.comment && <p className="text-xs mt-1.5 text-foreground/80 italic">"{event.comment}"</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

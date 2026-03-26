import { useParams, Link } from "wouter";
import { useGetProject, useListDocuments, useCreateDocument } from "@workspace/api-client-react";
import {
  FileText, Mail, CheckSquare, GitBranch, Users, ArrowLeft, Loader2,
  Plus, Download, Upload, Eye, Sparkles, Send, Package, AlertCircle,
  Clock, RefreshCw, Check, X, Square,
  Layers, UserCheck, FileDown, Trash2, ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  const [searchQ, setSearchQ] = useState("");
  const [aiDoc, setAiDoc] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Bulk transmittal form
  const [bulkTrsForm, setBulkTrsForm] = useState({ subject: "", purpose: "for_review", toExternal: "", description: "" });
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [bulkAssignStatus, setBulkAssignStatus] = useState("in_review");

  const handleUpload = async () => {
    await createDoc.mutateAsync({
      projectId,
      data: {
        documentNumber: docNumber || `DOC-${Date.now()}`,
        title: title || "New Document",
        revision: revision || "01",
        status: "draft",
        discipline: discipline || undefined,
        documentType: docType || "general",
      }
    });
    setIsUploadOpen(false);
    setDocNumber(""); setTitle(""); setDiscipline(""); setRevision("01"); setDocType("general");
  };

  const handleAIProcedureApply = (suggestion: any) => {
    if (suggestion.documentNumber) setDocNumber(suggestion.documentNumber);
    if (suggestion.discipline) setDiscipline(suggestion.discipline);
    if (suggestion.documentType) setDocType(suggestion.documentType);
    if (suggestion.revision) setRevision(suggestion.revision);
    if (suggestion.title && !title) setTitle(suggestion.title);
  };

  const allDocs = data?.documents ?? [];
  const filtered = allDocs.filter((d: any) =>
    !searchQ || d.title?.toLowerCase().includes(searchQ.toLowerCase()) || d.documentNumber?.toLowerCase().includes(searchQ.toLowerCase())
  );

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
        <div className="flex gap-2 items-center">
          <Input placeholder="Search documents..." className="w-[240px] h-9" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
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
          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <Button size="sm" className="h-9" onClick={() => setIsUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Upload Document
            </Button>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <AIProcedurePanel projectCode={projectCode} projectName={projectName} discipline={discipline} documentType={docType} partialTitle={title} onApply={handleAIProcedureApply} />
                <div className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center text-center hover:bg-muted/50 transition-colors cursor-pointer">
                  <Upload className="h-6 w-6 text-muted-foreground mb-2" />
                  <p className="font-medium text-sm">Click to browse or drag file here</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, DWG, XLSX up to 50MB</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">Document Number</label>
                    <Input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Auto-generated or from AI" className="font-mono" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">Title *</label>
                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="E.g. Ground Floor Plan" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Discipline</label>
                    <Input value={discipline} onChange={e => setDiscipline(e.target.value)} placeholder="E.g. Electrical" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Revision</label>
                    <Input value={revision} onChange={e => setRevision(e.target.value)} placeholder="01" className="font-mono" />
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
              <TableHead className="w-1/3">Title</TableHead>
              <TableHead>Discipline</TableHead>
              <TableHead>Rev</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
            ) : !filtered.length ? (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No documents found.</TableCell></TableRow>
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
                  <TableCell><span className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{doc.revision ?? "01"}</span></TableCell>
                  <TableCell><StatusBadge status={doc.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(doc.updatedAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10" title="AI Analyze" onClick={() => setAiDoc(doc)}>
                        <Sparkles className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Download className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

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
    </div>
  );
}

// ─── Transmittals Tab ─────────────────────────────────────────────────────────
function TransmittalsTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ subject: "", description: "", purpose: "for_information", toExternal: "", dueDate: "" });

  const { data: transmittalsData, isLoading } = useQuery({
    queryKey: ["transmittals", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals`);
      return r.json();
    },
  });
  const transmittals = Array.isArray(transmittalsData) ? transmittalsData : (transmittalsData?.transmittals ?? transmittalsData ?? []);

  const { data: docsData } = useListDocuments(projectId);
  const documents = docsData?.documents ?? [];

  const create = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/projects/${projectId}/transmittals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to create transmittal");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      setIsCreateOpen(false);
      setForm({ subject: "", description: "", purpose: "for_information", toExternal: "", dueDate: "" });
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
              <Label>To (External)</Label>
              <Input value={form.toExternal} onChange={e => setForm(f => ({ ...f, toExternal: e.target.value }))} placeholder="Contractor, consultant name..." className="mt-1" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes..." className="mt-1" rows={3} />
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

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["packages", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/packages`);
      return r.json();
    },
  });

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
  const { data: membersData, isLoading } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/members`);
      return r.json();
    },
  });
  const members = membersData?.members ?? [];

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Project Team</h3>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !members.length ? (
        <div className="bg-card border border-dashed rounded-xl p-12 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No team members assigned</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 p-4 bg-card border rounded-xl shadow-sm">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                {m.firstName?.[0]}{m.lastName?.[0]}
              </div>
              <div>
                <p className="font-medium text-sm">{m.firstName} {m.lastName}</p>
                <p className="text-xs text-muted-foreground capitalize">{m.role?.replace("_", " ")}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText, Search, Send, Download, Eye, ExternalLink,
  Filter, X, ChevronDown, Loader2, Building2, FolderOpen,
  Plus, RefreshCw,
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

export default function DocumentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("_all");
  const [filterDiscipline, setFilterDiscipline] = useState("_all");
  const [filterStatus, setFilterStatus] = useState("_all");
  const [filterSource, setFilterSource] = useState("_all");
  const [filterIssuedBy, setFilterIssuedBy] = useState("");

  // Send for Workflow dialog
  const [workflowDoc, setWorkflowDoc] = useState<any>(null);
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

  // Client-side filtering
  const filtered = useMemo(() => {
    return allDocs.filter((d: any) => {
      if (filterProject !== "_all" && d.projectId !== parseInt(filterProject)) return false;
      if (filterDiscipline !== "_all" && d.discipline !== filterDiscipline) return false;
      if (filterStatus !== "_all" && d.status !== filterStatus) return false;
      if (filterSource !== "_all" && d.source !== filterSource) return false;
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
  }, [allDocs, filterProject, filterDiscipline, filterStatus, filterSource, filterIssuedBy, search]);

  const hasFilters = filterProject !== "_all" || filterDiscipline !== "_all" || filterStatus !== "_all" ||
    filterSource !== "_all" || filterIssuedBy || search;

  const clearFilters = () => {
    setFilterProject("_all"); setFilterDiscipline("_all");
    setFilterStatus("_all"); setFilterSource("_all");
    setFilterIssuedBy(""); setSearch("");
  };

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
          documentIds: [workflowDoc.id],
        }),
      });
      if (!r.ok) throw new Error("Failed to create transmittal");
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: `Transmittal created for ${workflowDoc?.documentNumber}` });
      qc.invalidateQueries({ queryKey: ["global-documents"] });
      setWorkflowDoc(null);
      setWfForm({ subject: "", purpose: "for_review", toUserIds: [], externalEmails: "", description: "" });
    },
    onError: () => toast({ title: "Failed to send document for workflow", variant: "destructive" }),
  });

  const openWorkflow = (doc: any) => {
    setWorkflowDoc(doc);
    setWfForm({
      subject: `For Review: ${doc.documentNumber} — ${doc.title}`,
      purpose: "for_review",
      toUserIds: [],
      externalEmails: "",
      description: "",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All documents across your projects — {filtered.length} of {allDocs.length} shown
          </p>
        </div>
        <div className="flex gap-2">
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

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 gap-1 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[110px]">Doc No.</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Project</TableHead>
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
              <TableRow>
                <TableCell colSpan={10} className="py-16 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileText className="h-10 w-10 opacity-20" />
                    <p className="font-medium">{hasFilters ? "No documents match your filters" : "No documents yet"}</p>
                    {!hasFilters && (
                      <p className="text-xs">Upload documents from within a project.</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.map((doc: any) => (
              <TableRow key={doc.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-mono text-xs text-muted-foreground">{doc.documentNumber}</TableCell>
                <TableCell>
                  <div className="font-medium text-sm leading-none">{doc.title}</div>
                  {doc.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[260px]">{doc.description}</p>
                  )}
                </TableCell>
                <TableCell>
                  {doc.projectCode ? (
                    <Link href={`/projects/${doc.projectId}`} className="flex items-center gap-1 text-xs hover:text-primary">
                      <span className="font-mono font-bold text-[10px] bg-muted px-1 py-0.5 rounded">{doc.projectCode}</span>
                      <span className="text-muted-foreground truncate max-w-[80px]">{doc.projectName}</span>
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{doc.discipline || "—"}</TableCell>
                <TableCell>
                  {doc.source ? (
                    <span className="inline-flex items-center text-xs bg-muted/60 px-2 py-0.5 rounded-full capitalize">
                      {doc.source}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[100px] truncate">{doc.issuedBy || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{doc.revision ?? "A"}</TableCell>
                <TableCell>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[doc.status] ?? "bg-muted text-muted-foreground"}`}>
                    {doc.status?.replace(/_/g, " ")}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {doc.updatedAt ? format(new Date(doc.updatedAt), "dd MMM yy") : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {doc.fileUrl && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a href={`/api/storage/objects/${encodeURIComponent(doc.fileUrl)}`} target="_blank" rel="noopener noreferrer">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                      <Link href={`/projects/${doc.projectId}?tab=documents`}>
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => openWorkflow(doc)}
                    >
                      <Send className="h-3 w-3" /> Send
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Send for Workflow Dialog */}
      <Dialog open={!!workflowDoc} onOpenChange={v => { if (!v) setWorkflowDoc(null); }}>
        <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> Send for Workflow
            </DialogTitle>
          </DialogHeader>
          {workflowDoc && (
            <div className="space-y-4 py-2">
              {/* Document summary */}
              <div className="bg-muted/40 rounded-lg px-3 py-2 flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none truncate">{workflowDoc.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {workflowDoc.documentNumber} · Rev {workflowDoc.revision ?? "A"} ·{" "}
                    <span className="capitalize">{workflowDoc.status?.replace(/_/g, " ")}</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
              </div>

              <div>
                <Label>Subject</Label>
                <Input
                  value={wfForm.subject}
                  onChange={e => setWfForm(f => ({ ...f, subject: e.target.value }))}
                  className="mt-1"
                  placeholder="Transmittal subject…"
                />
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
                <Label>External Recipients (email addresses)</Label>
                <Input
                  value={wfForm.externalEmails}
                  onChange={e => setWfForm(f => ({ ...f, externalEmails: e.target.value }))}
                  placeholder="alice@firm.com, bob@client.com"
                  className="mt-1 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Separate multiple emails with commas.</p>
              </div>

              <div>
                <Label>Cover Note / Instructions</Label>
                <Textarea
                  value={wfForm.description}
                  onChange={e => setWfForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="mt-1"
                  placeholder="Optional instructions for reviewers…"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkflowDoc(null)}>Cancel</Button>
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
    </div>
  );
}

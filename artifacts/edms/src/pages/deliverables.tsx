import { useState, useMemo } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useOrgContext, useOrgOverrideUrl } from "@/lib/org-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ClipboardList, Plus, Search, Filter, X, FileSpreadsheet, FileText as FileTextIcon,
  Printer, Loader2, Edit2, Trash2, Link as LinkIcon, Calendar, User, ArrowUp, ArrowDown,
  ShieldAlert,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  submitted: "bg-indigo-100 text-indigo-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  on_hold: "bg-yellow-100 text-yellow-800",
  closed: "bg-gray-100 text-gray-500",
};

function fmt(d?: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return d; }
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const DELIVERABLE_TYPES = ["report", "drawing", "specification", "calculation", "method_statement", "risk_assessment", "schedule", "submittal", "other"];
const DELIVERABLE_STATUSES = ["not_started", "in_progress", "submitted", "approved", "rejected", "on_hold", "closed"];

const EMPTY_FORM = {
  deliverableId: "", title: "", type: "", plannedDate: "", actualDate: "",
  status: "not_started", responsible: "", linkedDocumentId: "", remarks: "",
};

export default function DeliverablesPage() {
  const { isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeOrgId } = useOrgContext();
  const addOverride = useOrgOverrideUrl();

  const [projectId, setProjectId] = useState<string>("_all");
  const [statusFilter, setStatusFilter] = useState("_all");
  const [typeFilter, setTypeFilter] = useState("_all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteItem, setDeleteItem] = useState<any>(null);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [sortKey, setSortKey] = useState<string>("plannedDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: string) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };

  const { data: projectsData } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: async () => { const r = await fetch(addOverride("/api/projects")); return r.json(); },
  });
  const projects: any[] = projectsData?.projects ?? [];

  const { data, isLoading, isError: isModuleError, error: queryError, refetch } = useQuery({
    queryKey: ["deliverables", projectId],
    queryFn: async () => {
      if (projectId === "_all") return { deliverables: [] };
      const r = await fetch(`/api/projects/${projectId}/deliverables`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw Object.assign(new Error(body.message ?? "Failed to load deliverables"), { code: body.error, status: r.status });
      }
      return r.json();
    },
    enabled: projectId !== "_all",
  });
  const all: any[] = data?.deliverables ?? [];

  const { data: docsData } = useQuery({
    queryKey: ["project-docs", projectId],
    queryFn: async () => {
      if (projectId === "_all") return { documents: [] };
      const r = await fetch(`/api/projects/${projectId}/documents?limit=500`);
      return r.json();
    },
    enabled: projectId !== "_all",
  });
  const docs: any[] = unwrapList<any>(docsData, "documents");

  const filtered = useMemo(() => {
    let d = all;
    if (statusFilter !== "_all") d = d.filter(x => x.status === statusFilter);
    if (typeFilter !== "_all") d = d.filter(x => x.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      d = d.filter(x =>
        x.deliverableId?.toLowerCase().includes(q) ||
        x.title?.toLowerCase().includes(q) ||
        x.responsible?.toLowerCase().includes(q)
      );
    }
    return [...d].sort((a, b) => {
      let av: any = a[sortKey as keyof typeof a] ?? "";
      let bv: any = b[sortKey as keyof typeof b] ?? "";
      if (sortKey === "plannedDate" || sortKey === "actualDate") {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [all, statusFilter, typeFilter, search, sortKey, sortDir]);

  const openAdd = () => { setForm({ ...EMPTY_FORM }); setAddOpen(true); };
  const openEdit = (item: any) => {
    setForm({
      deliverableId: item.deliverableId || "",
      title: item.title || "",
      type: item.type || "",
      plannedDate: item.plannedDate ? item.plannedDate.slice(0, 10) : "",
      actualDate: item.actualDate ? item.actualDate.slice(0, 10) : "",
      status: item.status || "not_started",
      responsible: item.responsible || "",
      linkedDocumentId: item.linkedDocumentId ? String(item.linkedDocumentId) : "",
      remarks: item.remarks || "",
    });
    setEditItem(item);
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/deliverables`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, linkedDocumentId: form.linkedDocumentId ? parseInt(form.linkedDocumentId) : undefined }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Failed"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deliverables"] }); setAddOpen(false); toast({ title: "Deliverable added" }); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/deliverables/${editItem.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, linkedDocumentId: form.linkedDocumentId ? parseInt(form.linkedDocumentId) : undefined }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deliverables"] }); setEditItem(null); toast({ title: "Deliverable updated" }); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/projects/${projectId}/deliverables/${deleteItem.id}`, { method: "DELETE" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deliverables"] }); setDeleteItem(null); toast({ title: "Deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const COLS = [
    { key: "deliverableId", label: "ID" }, { key: "title", label: "Title" }, { key: "type", label: "Type" },
    { key: "plannedDate", label: "Planned" }, { key: "actualDate", label: "Actual" },
    { key: "status", label: "Status" }, { key: "responsible", label: "Responsible" },
    { key: "linkedDocumentTitle", label: "Linked Doc" }, { key: "remarks", label: "Remarks" },
  ];

  const exportExcel = () => {
    const rows = filtered.map(d => ({
      ID: d.deliverableId, Title: d.title, Type: d.type || "—", "Planned Date": fmt(d.plannedDate),
      "Actual Date": fmt(d.actualDate), Status: d.status?.replace(/_/g, " ") || "—",
      Responsible: d.responsible || "—", "Linked Doc": d.linkedDocumentTitle || d.linkedDocumentNumber || "—",
      Remarks: d.remarks || "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Deliverables");
    XLSX.writeFile(wb, "deliverables-register.xlsx");
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(13);
    doc.text("Deliverables Register", 14, 15);
    doc.setFontSize(8);
    doc.text(`Generated: ${format(new Date(), "dd MMM yyyy HH:mm")}   Records: ${filtered.length}`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [["ID", "Title", "Type", "Planned", "Actual", "Status", "Responsible"]],
      body: filtered.map(d => [d.deliverableId, d.title, d.type || "—", fmt(d.plannedDate), fmt(d.actualDate), d.status?.replace(/_/g, " ") || "—", d.responsible || "—"]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
    });
    doc.save("deliverables-register.pdf");
  };

  const statusCounts = DELIVERABLE_STATUSES.reduce((acc, s) => ({ ...acc, [s]: all.filter(d => d.status === s).length }), {} as Record<string, number>);

  if (isModuleError && (queryError as any)?.code === "MODULE_DISABLED") {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground justify-center">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        Deliverables tracking is not available on your plan. Contact your administrator to upgrade.
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${isRtl ? "font-[Tahoma,Arial,sans-serif] text-right" : ""}`} dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> Deliverables
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track project deliverables, planned dates, and linked documents</p>
        </div>
        {projectId !== "_all" && (
          <Button onClick={openAdd} className="gap-1.5 h-8 text-sm">
            <Plus className="h-4 w-4" /> Add Deliverable
          </Button>
        )}
      </div>

      {/* Status summary cards */}
      {projectId !== "_all" && all.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
          {DELIVERABLE_STATUSES.map(s => (
            <div key={s} className={`rounded-lg border p-2 text-center cursor-pointer transition-colors hover:bg-muted/40 ${statusFilter === s ? "border-primary bg-primary/5" : ""}`}
              onClick={() => setStatusFilter(statusFilter === s ? "_all" : s)}>
              <p className="text-lg font-bold">{statusCounts[s]}</p>
              <p className="text-xs text-muted-foreground capitalize">{s.replace(/_/g, " ")}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-card border rounded-xl p-3 shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Select project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Select a project…</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Statuses</SelectItem>
              {DELIVERABLE_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Types</SelectItem>
              {DELIVERABLE_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 w-[180px] text-xs"
          />
          {(statusFilter !== "_all" || typeFilter !== "_all" || search) && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setStatusFilter("_all"); setTypeFilter("_all"); setSearch(""); }}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" onClick={exportExcel} className="h-8 gap-1.5 text-xs">
              <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf} className="h-8 gap-1.5 text-xs">
              <FileTextIcon className="h-3.5 w-3.5 text-red-500" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="h-8 gap-1.5 text-xs">
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      {projectId === "_all" ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <ClipboardList className="h-10 w-10 opacity-20" />
          <p className="text-sm font-medium">Select a project to view deliverables</p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-2 border-b flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{filtered.length} deliverable{filtered.length !== 1 ? "s" : ""}</span>
          </div>
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {([
                  ["deliverableId", "ID"], ["title", "Title"], ["type", "Type"],
                  ["plannedDate", "Planned"], ["actualDate", "Actual"], ["status", "Status"],
                  ["responsible", "Responsible"],
                ] as [string, string][]).map(([key, label]) => (
                  <TableHead key={key} className="text-xs cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort(key)}>
                    <span className="flex items-center gap-1">
                      {label}
                      {sortKey === key ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUp className="h-3 w-3 opacity-20" />}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="text-xs">Linked Doc</TableHead>
                <TableHead className="text-xs w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground text-sm">
                  {all.length === 0 ? "No deliverables yet. Click \"Add Deliverable\" to create one." : "No deliverables match the current filters."}
                </TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailItem(item)}>
                  <TableCell className="font-mono text-xs font-semibold text-primary">{item.deliverableId}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate font-medium">{item.title}</TableCell>
                  <TableCell className="text-xs capitalize">{item.type?.replace(/_/g, " ") || "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(item.plannedDate)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {item.actualDate ? (
                      <span className={`${item.plannedDate && new Date(item.actualDate) > new Date(item.plannedDate) ? "text-red-500" : "text-green-600"} font-medium`}>
                        {fmt(item.actualDate)}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell><StatusBadge status={item.status} /></TableCell>
                  <TableCell className="text-xs">{item.responsible || "—"}</TableCell>
                  <TableCell className="text-xs">
                    {item.linkedDocumentNumber ? (
                      <span className="font-mono text-primary">{item.linkedDocumentNumber}</span>
                    ) : "—"}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteItem(item)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      {(addOpen || editItem) && (
        <Dialog open={addOpen || !!editItem} onOpenChange={() => { setAddOpen(false); setEditItem(null); }}>
          <DialogContent className="sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                {editItem ? "Edit Deliverable" : "Add Deliverable"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div>
                <Label className="text-xs">Deliverable ID</Label>
                <Input value={form.deliverableId} onChange={e => setForm(f => ({ ...f, deliverableId: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="DEL-001 (auto if blank)" />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={form.type || "_none"} onValueChange={v => setForm(f => ({ ...f, type: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select type…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Select type —</SelectItem>
                    {DELIVERABLE_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Title *</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Planned Date</Label>
                <Input type="date" value={form.plannedDate} onChange={e => setForm(f => ({ ...f, plannedDate: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Actual Date</Label>
                <Input type="date" value={form.actualDate} onChange={e => setForm(f => ({ ...f, actualDate: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DELIVERABLE_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Responsible</Label>
                <Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="Name or role" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Linked Document</Label>
                <Select value={form.linkedDocumentId || "_none"} onValueChange={v => setForm(f => ({ ...f, linkedDocumentId: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Link a document (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    {docs.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.documentNumber} — {d.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Remarks</Label>
                <Textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} rows={2} className="mt-1 text-sm" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddOpen(false); setEditItem(null); }}>Cancel</Button>
              <Button
                onClick={() => editItem ? editMutation.mutate() : addMutation.mutate()}
                disabled={!form.title || addMutation.isPending || editMutation.isPending}
              >
                {(addMutation.isPending || editMutation.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editItem ? "Save Changes" : "Add Deliverable"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirm */}
      {deleteItem && (
        <Dialog open onOpenChange={() => setDeleteItem(null)}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader><DialogTitle>Delete Deliverable?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground py-2">Are you sure you want to delete <strong>{deleteItem.title}</strong>? This action cannot be undone.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Detail Sheet */}
      {detailItem && (
        <Sheet open onOpenChange={() => setDetailItem(null)}>
          <SheetContent className="w-[420px]">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                <span className="font-mono">{detailItem.deliverableId}</span>
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-4 py-4 overflow-y-auto">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Title</p>
                <p className="text-base font-semibold">{detailItem.title}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Type</p><p className="capitalize">{detailItem.type?.replace(/_/g, " ") || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={detailItem.status} /></div>
                <div><p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Planned</p><p>{fmt(detailItem.plannedDate)}</p></div>
                <div><p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Actual</p><p className={detailItem.actualDate && detailItem.plannedDate && new Date(detailItem.actualDate) > new Date(detailItem.plannedDate) ? "text-red-500 font-medium" : "text-green-600 font-medium"}>{fmt(detailItem.actualDate)}</p></div>
                <div><p className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" />Responsible</p><p>{detailItem.responsible || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground flex items-center gap-1"><LinkIcon className="h-3 w-3" />Linked Doc</p>
                  <p className="font-mono text-xs text-primary">{detailItem.linkedDocumentNumber || "—"}</p>
                </div>
                {(() => { const orgName = projects.find((p: any) => p.id === detailItem.projectId)?.organizationName; return orgName ? <div className="col-span-2"><p className="text-xs text-muted-foreground">Organization</p><p className="text-sm font-medium">{orgName}</p></div> : null; })()}
              </div>
              {detailItem.remarks && (
                <div><p className="text-xs text-muted-foreground">Remarks</p><p className="text-sm mt-1 bg-muted/40 rounded-lg p-2">{detailItem.remarks}</p></div>
              )}
              <div className="text-xs text-muted-foreground border-t pt-3">
                Created: {fmt(detailItem.createdAt)} · Updated: {fmt(detailItem.updatedAt)}
              </div>
            </div>
            <div className="flex gap-2 border-t pt-3">
              <Button variant="outline" className="flex-1 gap-1.5 h-8 text-xs" onClick={() => { setDetailItem(null); openEdit(detailItem); }}>
                <Edit2 className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button variant="destructive" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { setDetailItem(null); setDeleteItem(detailItem); }}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

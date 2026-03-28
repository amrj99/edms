import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isBefore, isAfter } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  BarChart3, FileSpreadsheet, FileText, Printer, RefreshCw, Loader2,
  Mail, Send, PenLine, ClipboardList, ShieldAlert, FileCheck, Plus, Filter, X,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return d; }
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    sent: "bg-blue-100 text-blue-700",
    acknowledged: "bg-green-100 text-green-700",
    closed: "bg-gray-100 text-gray-500",
    open: "bg-orange-100 text-orange-700",
    pending: "bg-yellow-100 text-yellow-800",
    in_progress: "bg-blue-100 text-blue-700",
    passed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    cancelled: "bg-gray-100 text-gray-500",
    issued: "bg-indigo-100 text-indigo-700",
    under_review: "bg-yellow-100 text-yellow-800",
    superseded: "bg-purple-100 text-purple-700",
    void: "bg-red-100 text-red-600",
    expired: "bg-orange-100 text-orange-700",
    voided: "bg-gray-100 text-gray-400",
    scheduled: "bg-cyan-100 text-cyan-700",
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ExportButtons({ data, filename, columns, title }: {
  data: any[]; filename: string; columns: { key: string; label: string }[]; title: string;
}) {
  const { t } = useI18n();

  const exportExcel = () => {
    if (!data.length) return;
    const rows = data.map(row => {
      const out: Record<string, any> = {};
      columns.forEach(col => { out[col.label] = row[col.key] ?? ""; });
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Register");
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const exportPdf = () => {
    if (!data.length) return;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(13);
    doc.text(title, 14, 15);
    doc.setFontSize(8);
    doc.text(`Generated: ${format(new Date(), "dd MMM yyyy HH:mm")}   Records: ${data.length}`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [columns.map(c => c.label)],
      body: data.map(row => columns.map(col => String(row[col.key] ?? "—"))),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 255] },
    });
    doc.save(`${filename}.pdf`);
  };

  const handlePrint = () => window.print();

  return (
    <div className="flex gap-1.5 flex-wrap">
      <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1.5 text-xs h-8">
        <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" /> {t("exportExcel")}
      </Button>
      <Button variant="outline" size="sm" onClick={exportPdf} className="gap-1.5 text-xs h-8">
        <FileText className="h-3.5 w-3.5 text-red-500" /> {t("exportPdf")}
      </Button>
      <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 text-xs h-8">
        <Printer className="h-3.5 w-3.5" /> {t("print")}
      </Button>
    </div>
  );
}

// ─── Global filter state type ─────────────────────────────────────────────────
interface Filters {
  projectId: string;
  status: string;
  search: string;
  dateFrom: string;
  dateTo: string;
  discipline: string;
  docType: string;
  party: string;
}

const DEFAULT_FILTERS: Filters = {
  projectId: "_all", status: "_all", search: "",
  dateFrom: "", dateTo: "", discipline: "_all", docType: "_all", party: "_all",
};

function applyDateFilter(items: any[], dateField: string, from: string, to: string) {
  let r = items;
  if (from) r = r.filter(i => i[dateField] && !isBefore(new Date(i[dateField]), new Date(from)));
  if (to) r = r.filter(i => i[dateField] && !isAfter(new Date(i[dateField]), new Date(to + "T23:59:59")));
  return r;
}

function applyTextFilter(items: any[], q: string, keys: string[]) {
  if (!q) return items;
  const ql = q.toLowerCase();
  return items.filter(item => keys.some(k => String(item[k] ?? "").toLowerCase().includes(ql)));
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────
function FilterBar({
  filters, onFiltersChange, projects, showDiscipline, showParty, showDocType,
  disciplines = [],
}: {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  projects: any[];
  showDiscipline?: boolean;
  showParty?: boolean;
  showDocType?: boolean;
  disciplines?: string[];
}) {
  const { t, isRtl } = useI18n();
  const set = (key: keyof Filters, val: string) => onFiltersChange({ ...filters, [key]: val });
  const hasFilters = filters.projectId !== "_all" || filters.status !== "_all" || filters.search ||
    filters.dateFrom || filters.dateTo || filters.discipline !== "_all" || filters.party !== "_all";

  return (
    <div className={`bg-card border rounded-xl p-3 shadow-sm ${isRtl ? "font-[Tahoma,Arial,sans-serif]" : ""}`}>
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        <Select value={filters.projectId} onValueChange={v => set("projectId", v)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder={t("allProjects")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">{t("allProjects")}</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.status} onValueChange={v => set("status", v)}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">{t("allStatuses")}</SelectItem>
            {["draft","pending","approved","rejected","sent","acknowledged","closed","open","in_progress","issued","under_review","passed","failed","cancelled","expired","voided"].map(s => (
              <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {showDiscipline && disciplines.length > 0 && (
          <Select value={filters.discipline} onValueChange={v => set("discipline", v)}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder={t("allDisciplines")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">{t("allDisciplines")}</SelectItem>
              {disciplines.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {showParty && (
          <Select value={filters.party} onValueChange={v => set("party", v)}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue placeholder={t("allParties")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">{t("allParties")}</SelectItem>
              {["client","consultant","subcontractor","other"].map(p => (
                <SelectItem key={p} value={p} className="capitalize">{t(p as any)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-1">
          <Label className="text-xs shrink-0 text-muted-foreground">{t("dateFrom")}</Label>
          <Input type="date" value={filters.dateFrom} onChange={e => set("dateFrom", e.target.value)} className="h-8 w-[130px] text-xs" />
        </div>
        <div className="flex items-center gap-1">
          <Label className="text-xs shrink-0 text-muted-foreground">{t("dateTo")}</Label>
          <Input type="date" value={filters.dateTo} onChange={e => set("dateTo", e.target.value)} className="h-8 w-[130px] text-xs" />
        </div>

        <Input
          placeholder={t("search")}
          value={filters.search}
          onChange={e => set("search", e.target.value)}
          className="h-8 w-[180px] text-xs"
        />

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
            <X className="h-3.5 w-3.5" /> {t("clearFilters")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Icon className="h-10 w-10 opacity-20" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

// ─── 1. Master Register ────────────────────────────────────────────────────────
function MasterRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-global-docs"],
    queryFn: async () => {
      const r = await fetch("/api/documents?limit=1000");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });
  const allDocs: any[] = data?.documents ?? [];

  const filtered = useMemo(() => {
    let d = allDocs;
    if (filters.projectId !== "_all") d = d.filter(x => x.projectId === parseInt(filters.projectId));
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    d = applyDateFilter(d, "updatedAt", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["documentNumber", "title", "discipline", "documentType", "source", "issuedBy"]);
    return d;
  }, [allDocs, filters]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  const COLS = [
    { key: "documentNumber", label: t("docNumber") },
    { key: "title", label: t("title") },
    { key: "documentType", label: t("documentType") },
    { key: "discipline", label: t("discipline") },
    { key: "revision", label: t("revision") },
    { key: "status", label: t("status") },
    { key: "source", label: t("source") },
    { key: "issuedBy", label: t("issuedBy") },
    { key: "projectName", label: t("project_col") },
    { key: "updatedAt", label: t("updatedAt") },
  ];

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <div>
          <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        </div>
        <ExportButtons
          data={filtered.map(d => ({ ...d, updatedAt: fmt(d.updatedAt) }))}
          filename="master-register"
          columns={COLS}
          title={t("masterRegister")}
        />
      </div>
      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              {COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
              </TableCell></TableRow>
            ) : paginated.length === 0 ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">
                {t("noData")}
              </TableCell></TableRow>
            ) : paginated.map(doc => (
              <TableRow key={doc.id} className="hover:bg-muted/20 transition-colors">
                <TableCell className="font-mono text-xs">{doc.documentNumber}</TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{doc.title}</TableCell>
                <TableCell className="text-xs capitalize">{doc.documentType || "—"}</TableCell>
                <TableCell className="text-xs">{doc.discipline || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{doc.revision || "—"}</TableCell>
                <TableCell><StatusPill status={doc.status} /></TableCell>
                <TableCell className="text-xs capitalize">{doc.source || "—"}</TableCell>
                <TableCell className="text-xs max-w-[100px] truncate">{doc.issuedBy || "—"}</TableCell>
                <TableCell className="text-xs">{doc.projectName || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(doc.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>←</Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}>→</Button>
        </div>
      )}
    </div>
  );
}

// ─── 2. Correspondence Register ───────────────────────────────────────────────
function CorrespondenceRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-corr", filters.projectId],
    queryFn: async () => {
      if (filters.projectId === "_all") return { correspondence: [] };
      const r = await fetch(`/api/projects/${filters.projectId}/correspondence`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: filters.projectId !== "_all",
  });
  const allItems: any[] = data?.correspondence ?? data?.items ?? (Array.isArray(data) ? data : []);

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    if (filters.party !== "_all") d = d.filter(x =>
      filters.party === "client" ? x.folder === "client" || x.type === "letter" :
      filters.party === "consultant" ? x.folder === "consultant" :
      filters.party === "subcontractor" ? x.folder === "subcontractor" || x.folder === "vendor" :
      true
    );
    d = applyDateFilter(d, "createdAt", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["subject", "referenceNumber", "type"]);
    return d;
  }, [allItems, filters]);

  const COLS = [
    { key: "referenceNumber", label: t("correspondenceNo") },
    { key: "createdAt", label: t("date") },
    { key: "type", label: t("type") },
    { key: "subject", label: t("subject") },
    { key: "status", label: t("status") },
    { key: "priority", label: t("priority") },
    { key: "dueDate", label: t("dueDate") },
  ];

  if (filters.projectId === "_all") return (
    <EmptyState icon={Mail} message={t("selectProject")} />
  );

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <ExportButtons
          data={filtered.map(d => ({ ...d, createdAt: fmt(d.createdAt), dueDate: fmt(d.dueDate) }))}
          filename="correspondence-register"
          columns={COLS}
          title={t("correspondenceRegister")}
        />
      </div>
      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>{COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
            ) : filtered.map(c => (
              <TableRow key={c.id} className="hover:bg-muted/20">
                <TableCell className="font-mono text-xs">{c.referenceNumber || `COR-${String(c.id).padStart(4,"0")}`}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(c.createdAt)}</TableCell>
                <TableCell className="text-xs capitalize">{c.type?.replace(/_/g," ") || "—"}</TableCell>
                <TableCell className="text-sm max-w-[250px] truncate">{c.subject}</TableCell>
                <TableCell><StatusPill status={c.status} /></TableCell>
                <TableCell className="text-xs capitalize">{c.priority || "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(c.dueDate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── 3. Transmittal Register ──────────────────────────────────────────────────
function TransmittalRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-trans", filters.projectId],
    queryFn: async () => {
      if (filters.projectId === "_all") return { transmittals: [] };
      const r = await fetch(`/api/projects/${filters.projectId}/transmittals`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: filters.projectId !== "_all",
  });
  const allItems: any[] = data?.transmittals ?? (Array.isArray(data) ? data : []);

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    d = applyDateFilter(d, "createdAt", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["transmittalNumber", "subject", "toExternal"]);
    return d;
  }, [allItems, filters]);

  const COLS = [
    { key: "transmittalNumber", label: t("transmittalNo") },
    { key: "createdAt", label: t("date") },
    { key: "subject", label: t("subject") },
    { key: "toExternal", label: t("to") },
    { key: "purpose", label: t("purpose") },
    { key: "status", label: t("status") },
    { key: "sentAt", label: t("sentDate") },
    { key: "acknowledgedAt", label: t("acknowledged") },
  ];

  if (filters.projectId === "_all") return <EmptyState icon={Send} message={t("selectProject")} />;

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <ExportButtons
          data={filtered.map(d => ({ ...d, createdAt: fmt(d.createdAt), sentAt: fmt(d.sentAt), acknowledgedAt: fmt(d.acknowledgedAt) }))}
          filename="transmittal-register"
          columns={COLS}
          title={t("transmittalRegister")}
        />
      </div>
      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>{COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
            ) : filtered.map(tr => (
              <TableRow key={tr.id} className="hover:bg-muted/20">
                <TableCell className="font-mono text-xs">{tr.transmittalNumber || `TRS-${String(tr.id).padStart(4,"0")}`}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(tr.createdAt)}</TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{tr.subject}</TableCell>
                <TableCell className="text-xs max-w-[120px] truncate">{tr.toExternal || "—"}</TableCell>
                <TableCell className="text-xs capitalize">{tr.purpose?.replace(/_/g," ") || "—"}</TableCell>
                <TableCell><StatusPill status={tr.status} /></TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(tr.sentAt)}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(tr.acknowledgedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── 4. Drawing Register ──────────────────────────────────────────────────────
function DrawingRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-drawings", filters.projectId],
    queryFn: async () => {
      if (filters.projectId === "_all") return { documents: [] };
      const r = await fetch(`/api/projects/${filters.projectId}/documents?limit=1000`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: filters.projectId !== "_all",
  });
  const allDocs: any[] = (data?.documents ?? (Array.isArray(data) ? data : []));
  const drawings = allDocs.filter(d => ["drawing","dwg","plan","section","elevation","detail"].includes((d.documentType || "").toLowerCase()));

  const filtered = useMemo(() => {
    let d = drawings;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    if (filters.discipline !== "_all") d = d.filter(x => x.discipline === filters.discipline);
    d = applyDateFilter(d, "updatedAt", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["documentNumber", "title", "discipline", "revision"]);
    return d;
  }, [drawings, filters]);

  const disciplines = Array.from(new Set(drawings.map((d: any) => d.discipline).filter(Boolean))) as string[];

  const COLS = [
    { key: "documentNumber", label: t("drawingNo") },
    { key: "title", label: t("title") },
    { key: "discipline", label: t("discipline") },
    { key: "revision", label: t("revision") },
    { key: "status", label: t("status") },
    { key: "issuedBy", label: t("issuedBy") },
    { key: "updatedAt", label: t("date") },
    { key: "remarks", label: t("remarks") },
  ];

  if (filters.projectId === "_all") return <EmptyState icon={PenLine} message={t("selectProject")} />;

  return (
    <div className="space-y-3">
      {disciplines.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {disciplines.map(d => (
            <button key={d} onClick={() => {}}
              className="text-xs px-2.5 py-1 rounded-full bg-muted hover:bg-primary/10 transition-colors">
              {d}
            </button>
          ))}
        </div>
      )}
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <ExportButtons
          data={filtered.map(d => ({ ...d, updatedAt: fmt(d.updatedAt) }))}
          filename="drawing-register"
          columns={COLS}
          title={t("drawingRegister")}
        />
      </div>
      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>{COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
            ) : filtered.map(doc => (
              <TableRow key={doc.id} className="hover:bg-muted/20">
                <TableCell className="font-mono text-xs">{doc.documentNumber}</TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{doc.title}</TableCell>
                <TableCell className="text-xs">{doc.discipline || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{doc.revision || "—"}</TableCell>
                <TableCell><StatusPill status={doc.status} /></TableCell>
                <TableCell className="text-xs max-w-[100px] truncate">{doc.issuedBy || "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(doc.updatedAt)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{doc.description || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── 5. ITR / MIR Register ────────────────────────────────────────────────────
function ItrMirRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ requestNumber: "", type: "itr", description: "", location: "", date: "", status: "pending", contractor: "", remarks: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-itr", filters.projectId],
    queryFn: async () => {
      if (filters.projectId === "_all") return { inspectionRequests: [] };
      const r = await fetch(`/api/projects/${filters.projectId}/inspection-requests`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: filters.projectId !== "_all",
  });
  const allItems: any[] = data?.inspectionRequests ?? [];

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    d = applyDateFilter(d, "date", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["requestNumber", "description", "location", "contractor"]);
    return d;
  }, [allItems, filters]);

  const addRecord = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${filters.projectId}/inspection-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, requestNumber: form.requestNumber || `${form.type.toUpperCase()}-${Date.now()}` }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-itr"] });
      setAddOpen(false);
      setForm({ requestNumber: "", type: "itr", description: "", location: "", date: "", status: "pending", contractor: "", remarks: "" });
      toast({ title: "Inspection request added" });
    },
    onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
  });

  const COLS = [
    { key: "requestNumber", label: t("requestNo") },
    { key: "type", label: t("requestType") },
    { key: "description", label: t("description") },
    { key: "location", label: t("location") },
    { key: "date", label: t("date") },
    { key: "status", label: t("status") },
    { key: "contractor", label: t("contractor") },
    { key: "remarks", label: t("remarks") },
  ];

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-2">
          {filters.projectId !== "_all" && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {t("addRecord")}
            </Button>
          )}
          <ExportButtons
            data={filtered.map(d => ({ ...d, date: fmt(d.date) }))}
            filename="itr-mir-register"
            columns={COLS}
            title={t("itrMirRegister")}
          />
        </div>
      </div>

      {filters.projectId === "_all" ? (
        <EmptyState icon={ClipboardList} message={t("selectProject")} />
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>{COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs">{item.requestNumber}</TableCell>
                  <TableCell><span className="text-xs font-semibold uppercase text-primary">{item.type}</span></TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{item.description || "—"}</TableCell>
                  <TableCell className="text-xs">{item.location || "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(item.date)}</TableCell>
                  <TableCell><StatusPill status={item.status} /></TableCell>
                  <TableCell className="text-xs">{item.contractor || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{item.remarks || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> {t("addRecord")} — {t("itrMirRegister")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("requestNo")}</Label>
                <Input value={form.requestNumber} onChange={e => setForm(f => ({ ...f, requestNumber: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="Auto-generated if blank" />
              </div>
              <div>
                <Label className="text-xs">{t("type")}</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="itr">ITR</SelectItem>
                    <SelectItem value="mir">MIR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{t("description")}</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("location")}</Label>
                <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("date")}</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("contractor")}</Label>
                <Input value={form.contractor} onChange={e => setForm(f => ({ ...f, contractor: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("status")}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pending","scheduled","in_progress","passed","failed","cancelled"].map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g," ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{t("remarks")}</Label>
                <Textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} rows={2} className="mt-1 text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addRecord.mutate()} disabled={addRecord.isPending}>
              {addRecord.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("addRecord")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 6. NCR / SOR Register ────────────────────────────────────────────────────
function NcrSorRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ reportNumber: "", type: "ncr", description: "", location: "", raisedBy: "", status: "open", correctiveAction: "", closeDate: "", remarks: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-ncr", filters.projectId],
    queryFn: async () => {
      if (filters.projectId === "_all") return { ncrRecords: [] };
      const r = await fetch(`/api/projects/${filters.projectId}/ncr-records`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: filters.projectId !== "_all",
  });
  const allItems: any[] = data?.ncrRecords ?? [];

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    d = applyDateFilter(d, "createdAt", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["reportNumber", "description", "location", "raisedBy"]);
    return d;
  }, [allItems, filters]);

  const addRecord = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${filters.projectId}/ncr-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, reportNumber: form.reportNumber || `${form.type.toUpperCase()}-${Date.now()}` }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-ncr"] });
      setAddOpen(false);
      setForm({ reportNumber: "", type: "ncr", description: "", location: "", raisedBy: "", status: "open", correctiveAction: "", closeDate: "", remarks: "" });
      toast({ title: "NCR/SOR record added" });
    },
    onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
  });

  const COLS = [
    { key: "reportNumber", label: t("reportNo") },
    { key: "type", label: t("type") },
    { key: "description", label: t("description") },
    { key: "location", label: t("location") },
    { key: "raisedBy", label: t("raisedBy") },
    { key: "status", label: t("status") },
    { key: "correctiveAction", label: t("correctiveAction") },
    { key: "closeDate", label: t("closeDate") },
  ];

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-2">
          {filters.projectId !== "_all" && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {t("addRecord")}
            </Button>
          )}
          <ExportButtons
            data={filtered.map(d => ({ ...d, closeDate: fmt(d.closeDate) }))}
            filename="ncr-sor-register"
            columns={COLS}
            title={t("ncrSorRegister")}
          />
        </div>
      </div>

      {filters.projectId === "_all" ? (
        <EmptyState icon={ShieldAlert} message={t("selectProject")} />
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>{COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs">{item.reportNumber}</TableCell>
                  <TableCell><span className="text-xs font-semibold uppercase text-destructive">{item.type}</span></TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{item.description || "—"}</TableCell>
                  <TableCell className="text-xs">{item.location || "—"}</TableCell>
                  <TableCell className="text-xs">{item.raisedBy || "—"}</TableCell>
                  <TableCell><StatusPill status={item.status} /></TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">{item.correctiveAction || "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(item.closeDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> {t("addRecord")} — {t("ncrSorRegister")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("reportNo")}</Label>
                <Input value={form.reportNumber} onChange={e => setForm(f => ({ ...f, reportNumber: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="Auto-generated if blank" />
              </div>
              <div>
                <Label className="text-xs">{t("type")}</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ncr">NCR</SelectItem>
                    <SelectItem value="sor">SOR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{t("description")}</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="mt-1 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("location")}</Label>
                <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("raisedBy")}</Label>
                <Input value={form.raisedBy} onChange={e => setForm(f => ({ ...f, raisedBy: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("status")}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["open","in_progress","closed","voided"].map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g," ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("closeDate")}</Label>
                <Input type="date" value={form.closeDate} onChange={e => setForm(f => ({ ...f, closeDate: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{t("correctiveAction")}</Label>
                <Textarea value={form.correctiveAction} onChange={e => setForm(f => ({ ...f, correctiveAction: e.target.value }))} rows={2} className="mt-1 text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addRecord.mutate()} disabled={addRecord.isPending}>
              {addRecord.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("addRecord")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 7. NOC Register ──────────────────────────────────────────────────────────
function NocRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ nocNumber: "", authority: "", date: "", status: "pending", linkedDocumentId: "", remarks: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["rpt-noc", filters.projectId],
    queryFn: async () => {
      if (filters.projectId === "_all") return { nocRecords: [] };
      const r = await fetch(`/api/projects/${filters.projectId}/noc-records`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: filters.projectId !== "_all",
  });
  const allItems: any[] = data?.nocRecords ?? [];

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    d = applyDateFilter(d, "date", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["nocNumber", "authority", "remarks"]);
    return d;
  }, [allItems, filters]);

  const addRecord = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${filters.projectId}/noc-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          nocNumber: form.nocNumber || `NOC-${Date.now()}`,
          linkedDocumentId: form.linkedDocumentId ? parseInt(form.linkedDocumentId) : undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-noc"] });
      setAddOpen(false);
      setForm({ nocNumber: "", authority: "", date: "", status: "pending", linkedDocumentId: "", remarks: "" });
      toast({ title: "NOC record added" });
    },
    onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
  });

  const COLS = [
    { key: "nocNumber", label: t("nocNo") },
    { key: "authority", label: t("authority") },
    { key: "date", label: t("date") },
    { key: "status", label: t("status") },
    { key: "remarks", label: t("remarks") },
  ];

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-2">
          {filters.projectId !== "_all" && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {t("addRecord")}
            </Button>
          )}
          <ExportButtons
            data={filtered.map(d => ({ ...d, date: fmt(d.date) }))}
            filename="noc-register"
            columns={COLS}
            title={t("nocRegister")}
          />
        </div>
      </div>

      {filters.projectId === "_all" ? (
        <EmptyState icon={FileCheck} message={t("selectProject")} />
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>{COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs">{item.nocNumber}</TableCell>
                  <TableCell className="text-sm max-w-[150px] truncate">{item.authority || "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(item.date)}</TableCell>
                  <TableCell><StatusPill status={item.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{item.remarks || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileCheck className="h-4 w-4" /> {t("addRecord")} — {t("nocRegister")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("nocNo")}</Label>
                <Input value={form.nocNumber} onChange={e => setForm(f => ({ ...f, nocNumber: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="Auto-generated if blank" />
              </div>
              <div>
                <Label className="text-xs">{t("authority")}</Label>
                <Input value={form.authority} onChange={e => setForm(f => ({ ...f, authority: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("date")}</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t("status")}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pending","approved","rejected","expired"].map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{t("remarks")}</Label>
                <Textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} rows={3} className="mt-1 text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addRecord.mutate()} disabled={addRecord.isPending}>
              {addRecord.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("addRecord")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Reports Page ────────────────────────────────────────────────────────
export default function Reports() {
  const { t, lang, isRtl } = useI18n();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [activeTab, setActiveTab] = useState("master");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects: any[] = projectsData?.projects ?? [];

  const { data: dashData } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => { const r = await fetch("/api/dashboard"); return r.json(); },
  });

  const { data: globalDocsData } = useQuery({
    queryKey: ["rpt-summary"],
    queryFn: async () => { const r = await fetch("/api/documents?limit=1"); return r.json(); },
  });

  const metrics = [
    { label: t("totalDocuments"), value: globalDocsData?.total ?? "—", icon: FileText, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/30" },
    { label: t("activeProjects"), value: projects.filter((p: any) => p.status === "active").length, icon: BarChart3, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/30" },
    { label: t("openRfis"), value: dashData?.correspondence?.filter((c: any) => c.status !== "closed").length ?? "—", icon: Mail, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/30" },
    { label: t("transmittals"), value: dashData?.transmittals?.length ?? "—", icon: Send, color: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-950/30" },
  ];

  const tabs = [
    { id: "master", label: t("masterRegister"), icon: FileText },
    { id: "correspondence", label: t("correspondenceRegister"), icon: Mail },
    { id: "transmittals", label: t("transmittalRegister"), icon: Send },
    { id: "drawings", label: t("drawingRegister"), icon: PenLine },
    { id: "itr", label: t("itrMirRegister"), icon: ClipboardList },
    { id: "ncr", label: t("ncrSorRegister"), icon: ShieldAlert },
    { id: "noc", label: t("nocRegister"), icon: FileCheck },
  ];

  return (
    <div className={`space-y-5 ${isRtl ? "font-[Tahoma,Arial,sans-serif] text-right" : ""}`} dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className={`flex flex-wrap items-center justify-between gap-3 ${isRtl ? "flex-row-reverse" : ""}`}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            {t("reports")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {lang === "ar"
              ? "سجلات المستندات، المراسلات، الإرسال، الرسومات وتقارير الموقع"
              : "Document registers, correspondence, transmittals, drawings & site reports"}
          </p>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map(m => (
          <Card key={m.label} className="overflow-hidden">
            <CardContent className={`flex items-center gap-3 p-4 ${isRtl ? "flex-row-reverse" : ""}`}>
              <div className={`p-2 rounded-lg ${m.bg} shrink-0`}>
                <m.icon className={`h-5 w-5 ${m.color}`} />
              </div>
              <div className={isRtl ? "text-right" : ""}>
                <p className="text-xl font-bold leading-none">{m.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        projects={projects}
        showParty={activeTab === "correspondence"}
        showDiscipline={activeTab === "drawings"}
      />

      {/* Register Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className={`h-auto p-1 flex gap-0.5 w-max min-w-full ${isRtl ? "flex-row-reverse" : ""}`}>
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="h-8 px-3 text-xs gap-1.5 shrink-0 whitespace-nowrap data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-4">
          <TabsContent value="master" className="mt-0">
            <MasterRegister filters={filters} />
          </TabsContent>
          <TabsContent value="correspondence" className="mt-0">
            <CorrespondenceRegister filters={filters} />
          </TabsContent>
          <TabsContent value="transmittals" className="mt-0">
            <TransmittalRegister filters={filters} />
          </TabsContent>
          <TabsContent value="drawings" className="mt-0">
            <DrawingRegister filters={filters} />
          </TabsContent>
          <TabsContent value="itr" className="mt-0">
            <ItrMirRegister filters={filters} />
          </TabsContent>
          <TabsContent value="ncr" className="mt-0">
            <NcrSorRegister filters={filters} />
          </TabsContent>
          <TabsContent value="noc" className="mt-0">
            <NocRegister filters={filters} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

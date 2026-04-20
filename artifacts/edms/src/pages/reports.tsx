import { useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isBefore, isAfter } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useOrgContext, useOrgOverrideUrl } from "@/lib/org-context";

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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import {
  BarChart3, FileSpreadsheet, FileText, Printer, RefreshCw, Loader2,
  Mail, Send, PenLine, ClipboardList, ShieldAlert, FileCheck, Plus, Filter, X,
  Eye, EyeOff, Columns3, Save, BookOpen, ChevronDown, Trash2,
  CheckCircle2, XCircle, Clock, CircleDot, ArrowUp, ArrowDown,
  Sparkles, Link2, ExternalLink,
} from "lucide-react";

function SortableHead({ label, colKey, sortKey, sortDir, onSort, className = "" }: {
  label: string; colKey: string; sortKey: string; sortDir: "asc" | "desc";
  onSort: (key: string) => void; className?: string;
}) {
  const active = sortKey === colKey;
  return (
    <TableHead
      className={`text-xs cursor-pointer select-none hover:text-foreground whitespace-nowrap ${className}`}
      onClick={() => onSort(colKey)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ArrowUp className="h-3 w-3 opacity-20" />}
      </span>
    </TableHead>
  );
}

function sortItems<T extends Record<string, any>>(items: T[], key: string, dir: "asc" | "desc"): T[] {
  return [...items].sort((a, b) => {
    let av: any = a[key] ?? "";
    let bv: any = b[key] ?? "";
    const dateKeys = ["date", "closeDate", "createdAt", "updatedAt", "sentAt", "acknowledgedAt"];
    if (dateKeys.some(k => key.endsWith(k) || key === k)) {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    } else {
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
    }
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

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

// ─── Approval Badge ───────────────────────────────────────────────────────────
function ApprovalBadge({ status }: { status?: string | null }) {
  const { t } = useI18n();
  if (!status || status === "none") return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
      <CircleDot className="h-3 w-3" />{t("approvalNone")}
    </span>
  );
  if (status === "pending") return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
      <Clock className="h-3 w-3" />{t("approvalPending")}
    </span>
  );
  if (status === "approved") return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      <CheckCircle2 className="h-3 w-3" />{t("approvalApproved")}
    </span>
  );
  if (status === "rejected") return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
      <XCircle className="h-3 w-3" />{t("approvalRejected")}
    </span>
  );
  return null;
}

// ─── Approval Panel ───────────────────────────────────────────────────────────
const PANEL_DECISION_OPTIONS = [
  { value: "approved",               label: "Approved",              color: "border-emerald-500 bg-emerald-50 text-emerald-700" },
  { value: "approved_with_comments", label: "Approved w/ Comments",  color: "border-teal-500 bg-teal-50 text-teal-700" },
  { value: "for_revision",           label: "Revise",                color: "border-amber-500 bg-amber-50 text-amber-700" },
  { value: "rejected",               label: "Rejected",              color: "border-red-500 bg-red-50 text-red-700" },
] as const;

function ApprovalPanel({
  record,
  entityType,
  projectId,
  queryKey,
  onRecordUpdated,
}: {
  record: any;
  entityType: "ncr" | "itr" | "transmittal";
  projectId: string | number;
  queryKey: string[];
  onRecordUpdated?: (updated: any) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<string>("approved");
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);

  const role = user?.role ?? "";
  const canSubmit = ["admin", "project_manager", "document_controller"].includes(role);
  const canDecide = ["admin", "project_manager"].includes(role);

  const baseUrl = entityType === "transmittal"
    ? `/api/projects/${projectId}/transmittals/${record.id}`
    : entityType === "ncr"
      ? `/api/projects/${projectId}/ncr-records/${record.id}`
      : `/api/projects/${projectId}/inspection-requests/${record.id}`;

  const doMutation = useMutation({
    mutationFn: async (action: "submit-approval" | "approve" | "reject") => {
      const r = await fetch(`${baseUrl}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, decision }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (data, action) => {
      qc.invalidateQueries({ queryKey });
      onRecordUpdated?.(data);
      const msgs: Record<string, string> = {
        "submit-approval": t("approvalSubmitted"),
        approve: t("approvalApprovedMsg"),
        reject: t("approvalRejectedMsg"),
      };
      toast({ title: msgs[action] ?? t("approvalSubmitted") });
      setComment("");
      setConfirmAction(null);
    },
    onError: () => toast({ title: t("approvalError"), variant: "destructive" }),
  });

  const approvalStatus = record?.approvalStatus ?? "none";

  const handleSubmitDecision = () => {
    const isApproveType = decision === "approved" || decision === "approved_with_comments";
    doMutation.mutate(isApproveType ? "approve" : "reject");
  };

  return (
    <div className="border-t mt-4 pt-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("approvalWorkflow")}</p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium">{t("approvalStatus")}:</span>
        <ApprovalBadge status={approvalStatus} />
      </div>
      {record?.approvedAt && (
        <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
          <span className="text-xs text-muted-foreground font-medium">{t("approvedAt")}</span>
          <span className="text-xs">{fmt(record.approvedAt)}</span>
        </div>
      )}
      {record?.approvalComment && (
        <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
          <span className="text-xs text-muted-foreground font-medium">{t("approvalComment")}</span>
          <span className="text-xs break-words">{record.approvalComment}</span>
        </div>
      )}

      {canSubmit && approvalStatus === "none" && (
        <Button
          size="sm" variant="outline" className="h-8 gap-1.5 text-xs w-full"
          onClick={() => doMutation.mutate("submit-approval")}
          disabled={doMutation.isPending}
        >
          {doMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
          {t("submitForApproval")}
        </Button>
      )}

      {canDecide && approvalStatus === "pending" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Decision</Label>
            <div className="flex flex-wrap gap-1.5">
              {PANEL_DECISION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDecision(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border-2 transition-colors ${
                    decision === opt.value ? opt.color : "border-transparent bg-muted text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("approvalComment")}</Label>
            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={t("approvalCommentPlaceholder")}
              rows={2}
              className="mt-1 text-xs"
            />
          </div>
          <Button
            size="sm"
            className={`h-8 gap-1.5 text-xs w-full ${
              decision === "approved" ? "bg-green-600 hover:bg-green-700" :
              decision === "approved_with_comments" ? "bg-teal-600 hover:bg-teal-700" :
              decision === "for_revision" ? "bg-amber-600 hover:bg-amber-700" :
              "bg-red-600 hover:bg-red-700"
            }`}
            onClick={handleSubmitDecision}
            disabled={doMutation.isPending}
          >
            {doMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Submit Decision
          </Button>
        </>
      )}

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "approve" ? t("confirmApprove") : t("confirmReject")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction === "approve" ? t("confirmApproveDesc") : t("confirmRejectDesc")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>{t("cancel")}</Button>
            <Button
              variant={confirmAction === "approve" ? "default" : "destructive"}
              onClick={() => { if (confirmAction) doMutation.mutate(confirmAction); }}
              disabled={doMutation.isPending}
            >
              {doMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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

// ─── Review Code Pill ─────────────────────────────────────────────────────────
function ReviewCodePill({ code }: { code?: string | null }) {
  if (!code) return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, { label: string; cls: string }> = {
    A: { label: "A – Approved",              cls: "bg-green-100 text-green-800" },
    B: { label: "B – Approved w/ Comments",  cls: "bg-teal-100 text-teal-800" },
    C: { label: "C – Revise & Resubmit",     cls: "bg-amber-100 text-amber-800" },
    D: { label: "D – Rejected",              cls: "bg-red-100 text-red-800" },
  };
  const entry = map[code];
  if (!entry) return <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{code}</span>;
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${entry.cls}`}>
      {entry.label}
    </span>
  );
}

function DirectionBadge({ direction }: { direction?: string | null }) {
  if (!direction) return <span className="text-muted-foreground text-xs">—</span>;
  const isIn = direction.toUpperCase() === "IN";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full font-semibold ${isIn ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"}`}>
      {isIn ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
      {direction.toUpperCase()}
    </span>
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
  direction: string;
  trsPartyType: string;
}

const DEFAULT_FILTERS: Filters = {
  projectId: "_all", status: "_all", search: "",
  dateFrom: "", dateTo: "", discipline: "_all", docType: "_all", party: "_all",
  direction: "_all", trsPartyType: "_all",
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
  filters, onFiltersChange, projects, showDiscipline, showParty, showDocType, showDirection, showTrsPartyType,
  disciplines = [],
}: {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  projects: any[];
  showDiscipline?: boolean;
  showParty?: boolean;
  showDocType?: boolean;
  showDirection?: boolean;
  showTrsPartyType?: boolean;
  disciplines?: string[];
}) {
  const { t, isRtl } = useI18n();
  const set = (key: keyof Filters, val: string) => onFiltersChange({ ...filters, [key]: val });
  const hasFilters = filters.projectId !== "_all" || filters.status !== "_all" || filters.search ||
    filters.dateFrom || filters.dateTo || filters.discipline !== "_all" || filters.party !== "_all" ||
    filters.direction !== "_all" || filters.trsPartyType !== "_all";

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

        {showDirection && (
          <Select value={filters.direction} onValueChange={v => set("direction", v)}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue placeholder="All Directions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Directions</SelectItem>
              <SelectItem value="IN">↓ Incoming</SelectItem>
              <SelectItem value="OUT">↑ Outgoing</SelectItem>
            </SelectContent>
          </Select>
        )}

        {showTrsPartyType && (
          <Select value={filters.trsPartyType} onValueChange={v => set("trsPartyType", v)}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="All Party Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Party Types</SelectItem>
              <SelectItem value="Owner">Owner</SelectItem>
              <SelectItem value="Consultant">Consultant</SelectItem>
              <SelectItem value="Main Contractor">Main Contractor</SelectItem>
              <SelectItem value="Subcontractor">Subcontractor</SelectItem>
              <SelectItem value="Authority">Authority</SelectItem>
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
        <div className="ml-auto">
          <SavedFiltersUI filters={filters} onLoad={onFiltersChange} />
        </div>
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

// ─── Record Detail Sheet ───────────────────────────────────────────────────────
function RecordDetailSheet({
  item, open, onClose, title, fields, children,
}: {
  item: any; open: boolean; onClose: () => void;
  title: string;
  fields: { key: string; label: string; format?: (v: any) => string }[];
  children?: React.ReactNode;
}) {
  if (!item) return null;
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[440px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">Record #{item.id}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto space-y-3 py-4">
          {fields.map(f => (
            <div key={f.key} className="grid grid-cols-[120px_1fr] gap-2 items-start">
              <span className="text-xs text-muted-foreground font-medium pt-0.5">{f.label}</span>
              <span className="text-sm break-words">
                {f.format ? f.format(item[f.key]) : (item[f.key] ?? "—") || "—"}
              </span>
            </div>
          ))}
          <div className="border-t pt-3 grid grid-cols-[120px_1fr] gap-2">
            <span className="text-xs text-muted-foreground font-medium">Created</span>
            <span className="text-xs">{fmt(item.createdAt)}</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-xs text-muted-foreground font-medium">Updated</span>
            <span className="text-xs">{fmt(item.updatedAt)}</span>
          </div>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Column Visibility Toggle ─────────────────────────────────────────────────
function ColumnToggleButton({
  allCols, visibleKeys, onToggle, storageKey,
}: {
  allCols: { key: string; label: string }[];
  visibleKeys: Set<string>;
  onToggle: (key: string) => void;
  storageKey: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Columns3 className="h-3.5 w-3.5" /> Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allCols.map(col => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={visibleKeys.has(col.key)}
            onCheckedChange={() => onToggle(col.key)}
            className="text-xs"
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useColumnVisibility(storageKey: string, defaultKeys: string[]) {
  const [visible, setVisible] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`edms_cols_${storageKey}`);
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set(defaultKeys);
  });

  const toggle = (key: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(`edms_cols_${storageKey}`, JSON.stringify([...next]));
      return next;
    });
  };
  return { visible, toggle };
}

// ─── Saved Filters ────────────────────────────────────────────────────────────
const SAVED_FILTERS_KEY = "edms_saved_filters";

function loadSavedFilters(): { name: string; filters: Filters }[] {
  try { return JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) ?? "[]"); } catch { return []; }
}
function saveSavedFilters(list: { name: string; filters: Filters }[]) {
  localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list));
}

function SavedFiltersUI({ filters, onLoad }: { filters: Filters; onLoad: (f: Filters) => void }) {
  const [saved, setSaved] = useState<{ name: string; filters: Filters }[]>(() => loadSavedFilters());
  const [saveName, setSaveName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);

  const handleSave = () => {
    if (!saveName.trim()) return;
    const updated = [...saved.filter(s => s.name !== saveName.trim()), { name: saveName.trim(), filters }];
    saveSavedFilters(updated);
    setSaved(updated);
    setSaveName("");
    setSaveOpen(false);
  };

  const handleDelete = (name: string) => {
    const updated = saved.filter(s => s.name !== name);
    saveSavedFilters(updated);
    setSaved(updated);
  };

  return (
    <div className="flex items-center gap-1.5">
      {saved.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
              <BookOpen className="h-3.5 w-3.5" /> Saved <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuLabel className="text-xs">Saved filters</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {saved.map(s => (
              <div key={s.name} className="flex items-center gap-1 px-2 py-1">
                <button className="flex-1 text-xs text-left hover:text-primary" onClick={() => onLoad(s.filters)}>{s.name}</button>
                <button className="text-muted-foreground hover:text-destructive" onClick={() => handleDelete(s.name)}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {saveOpen ? (
        <div className="flex items-center gap-1">
          <Input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setSaveOpen(false); }}
            placeholder="Filter name…"
            className="h-7 w-[130px] text-xs"
            autoFocus
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave}><Save className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSaveOpen(false)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setSaveOpen(true)}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      )}
    </div>
  );
}

// ─── 1. Master Register ────────────────────────────────────────────────────────
function MasterRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [detailItem, setDetailItem] = useState<any>(null);
  const [bulkStatus, setBulkStatus] = useState("_none");
  const PER_PAGE = 50;

  const COLS_DEF = [
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

  const { visible: visibleCols, toggle: toggleCol } = useColumnVisibility("master", COLS_DEF.map(c => c.key));
  const COLS = COLS_DEF.filter(c => visibleCols.has(c.key));

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

  const allPageSelected = paginated.length > 0 && paginated.every(d => selectedIds.has(d.id));
  const toggleAll = () => {
    if (allPageSelected) {
      setSelectedIds(prev => { const n = new Set(prev); paginated.forEach(d => n.delete(d.id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); paginated.forEach(d => n.add(d.id)); return n; });
    }
  };

  const bulkMutation = useMutation({
    mutationFn: async (status: string) => {
      const ids = [...selectedIds];
      await Promise.all(ids.map(id =>
        fetch(`/api/documents/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        })
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-global-docs"] });
      setSelectedIds(new Set());
      setBulkStatus("_none");
      toast({ title: `Updated ${selectedIds.size} documents` });
    },
    onError: () => toast({ title: "Bulk update failed", variant: "destructive" }),
  });

  const handleBulkExport = () => {
    const selected = filtered.filter(d => selectedIds.has(d.id));
    const rows = selected.map(d => Object.fromEntries(COLS_DEF.map(c => [c.label, c.key === "updatedAt" ? fmt(d.updatedAt) : d[c.key] ?? "—"])));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Selected");
    XLSX.writeFile(wb, "selected-documents.xlsx");
  };

  const DETAIL_FIELDS = [
    { key: "documentNumber", label: "Doc Number" },
    { key: "title", label: "Title" },
    { key: "documentType", label: "Type" },
    { key: "discipline", label: "Discipline" },
    { key: "revision", label: "Revision" },
    { key: "status", label: "Status" },
    { key: "source", label: "Source" },
    { key: "issuedBy", label: "Issued By" },
    { key: "projectName", label: "Project" },
    { key: "description", label: "Description" },
    { key: "updatedAt", label: "Last Updated", format: fmt },
  ];

  return (
    <div className="space-y-3">
      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg flex-wrap">
          <span className="text-xs font-semibold text-primary">{selectedIds.size} selected</span>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue placeholder="Change status…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Change status —</SelectItem>
              {["draft","pending","approved","rejected","issued","superseded","cancelled"].map(s => (
                <SelectItem key={s} value={s} className="capitalize text-xs">{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 text-xs" disabled={bulkStatus === "_none" || bulkMutation.isPending}
            onClick={() => bulkStatus !== "_none" && bulkMutation.mutate(bulkStatus)}>
            {bulkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleBulkExport}>
            <FileSpreadsheet className="h-3 w-3 text-green-600" /> Export selected
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={() => setSelectedIds(new Set())}>
            <X className="h-3 w-3" /> Clear
          </Button>
        </div>
      )}

      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-1.5 flex-wrap">
          <ColumnToggleButton allCols={COLS_DEF} visibleKeys={visibleCols} onToggle={toggleCol} storageKey="master" />
          <ExportButtons
            data={filtered.map(d => ({ ...d, updatedAt: fmt(d.updatedAt) }))}
            filename="master-register"
            columns={COLS_DEF}
            title={t("masterRegister")}
          />
        </div>
      </div>
      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[36px]">
                <Checkbox checked={allPageSelected} onCheckedChange={toggleAll} className="h-3.5 w-3.5" />
              </TableHead>
              {COLS.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={COLS.length + 1} className="py-12 text-center">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
              </TableCell></TableRow>
            ) : paginated.length === 0 ? (
              <TableRow><TableCell colSpan={COLS.length + 1} className="py-12 text-center text-muted-foreground text-sm">
                {t("noData")}
              </TableCell></TableRow>
            ) : paginated.map(doc => (
              <TableRow key={doc.id} className={`hover:bg-muted/20 transition-colors cursor-pointer ${selectedIds.has(doc.id) ? "bg-primary/5" : ""}`}
                onClick={() => setDetailItem(doc)}>
                <TableCell onClick={e => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(doc.id)} className="h-3.5 w-3.5"
                    onCheckedChange={checked => setSelectedIds(prev => { const n = new Set(prev); checked ? n.add(doc.id) : n.delete(doc.id); return n; })} />
                </TableCell>
                {visibleCols.has("documentNumber") && <TableCell className="font-mono text-xs text-primary">{doc.documentNumber}</TableCell>}
                {visibleCols.has("title") && <TableCell className="text-sm max-w-[200px] truncate font-medium">{doc.title}</TableCell>}
                {visibleCols.has("documentType") && <TableCell className="text-xs capitalize">{doc.documentType || "—"}</TableCell>}
                {visibleCols.has("discipline") && <TableCell className="text-xs">{doc.discipline || "—"}</TableCell>}
                {visibleCols.has("revision") && <TableCell className="font-mono text-xs">{doc.revision || "—"}</TableCell>}
                {visibleCols.has("status") && <TableCell><StatusPill status={doc.status} /></TableCell>}
                {visibleCols.has("source") && <TableCell className="text-xs capitalize">{doc.source || "—"}</TableCell>}
                {visibleCols.has("issuedBy") && <TableCell className="text-xs max-w-[100px] truncate">{doc.issuedBy || "—"}</TableCell>}
                {visibleCols.has("projectName") && <TableCell className="text-xs">{doc.projectName || "—"}</TableCell>}
                {visibleCols.has("updatedAt") && <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(doc.updatedAt)}</TableCell>}
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
      <RecordDetailSheet
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={detailItem?.title ?? "Document Detail"}
        fields={DETAIL_FIELDS}
      />
    </div>
  );
}

// ─── 2. Correspondence Register ───────────────────────────────────────────────
function CorrespondenceRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const [detailItem, setDetailItem] = useState<any>(null);

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
              <TableRow key={c.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailItem(c)}>
                <TableCell className="font-mono text-xs text-primary">{c.referenceNumber || `COR-${String(c.id).padStart(4,"0")}`}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(c.createdAt)}</TableCell>
                <TableCell className="text-xs capitalize">{c.type?.replace(/_/g," ") || "—"}</TableCell>
                <TableCell className="text-sm max-w-[250px] truncate font-medium">{c.subject}</TableCell>
                <TableCell><StatusPill status={c.status} /></TableCell>
                <TableCell className="text-xs capitalize">{c.priority || "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmt(c.dueDate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RecordDetailSheet
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={detailItem?.subject ?? "Correspondence Detail"}
        fields={[
          { key: "referenceNumber", label: "Reference No" },
          { key: "subject", label: "Subject" },
          { key: "type", label: "Type" },
          { key: "status", label: "Status" },
          { key: "priority", label: "Priority" },
          { key: "folder", label: "Folder" },
          { key: "dueDate", label: "Due Date", format: fmt },
          { key: "createdAt", label: "Date", format: fmt },
        ]}
      />
    </div>
  );
}

// ─── Smart Link Panel (AI-assisted transmittal linking) ───────────────────────
function SmartLinkPanel({ transmittalId, projectId }: { transmittalId: number; projectId: string | number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["trs-suggest", transmittalId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}/suggest-links`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: false,
  });

  const handleOpen = () => {
    setOpen(v => !v);
    if (!data) refetch();
  };

  const acceptDoc = async (doc: any) => {
    setAccepting(doc.id);
    try {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, revision: doc.revision }),
      });
      if (!r.ok) throw new Error("Failed to add");
      qc.invalidateQueries({ queryKey: ["trs-detail", transmittalId] });
      qc.invalidateQueries({ queryKey: ["trs-suggest", transmittalId] });
      toast({ title: "Document linked", description: `${doc.documentNumber} added to transmittal.` });
    } catch {
      toast({ title: "Failed to link document", variant: "destructive" });
    } finally {
      setAccepting(null);
    }
  };

  const docs: any[] = data?.documents ?? [];
  const corr: any[] = data?.correspondence ?? [];
  const hasResults = docs.length > 0 || corr.length > 0;

  const scoreBar = (score: number) => (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.round(score * 100)}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-7">{Math.round(score * 100)}%</span>
    </div>
  );

  return (
    <div className="border-t mt-4 pt-3">
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Smart Link Suggestions
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analysing transmittal subject for matches…
            </div>
          )}

          {!isLoading && !hasResults && data && (
            <p className="text-xs text-muted-foreground italic">
              No strong matches found. Try adding more detail to the transmittal subject or description.
            </p>
          )}

          {docs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> Document Matches
              </p>
              <div className="rounded-md border divide-y">
                {docs.map((doc: any) => (
                  <div key={doc.id} className="flex items-center gap-2 px-2.5 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-primary truncate">{doc.documentNumber}</p>
                      <p className="text-xs text-foreground truncate" title={doc.title}>{doc.title}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{doc.revision ? `Rev ${doc.revision}` : ""} · {doc.status?.replace(/_/g," ")}</p>
                    </div>
                    {scoreBar(doc.score)}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2 shrink-0"
                      disabled={accepting === doc.id}
                      onClick={() => acceptDoc(doc)}
                    >
                      {accepting === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Link2 className="h-3 w-3 mr-1" />Link</>}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {corr.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Mail className="h-3 w-3" /> Correspondence Matches
              </p>
              <div className="rounded-md border divide-y">
                {corr.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 px-2.5 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-primary truncate">{c.referenceNumber || `CORR-${c.id}`}</p>
                      <p className="text-xs text-foreground truncate" title={c.subject}>{c.subject}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{c.direction ?? ""} · {c.status?.replace(/_/g," ")}</p>
                    </div>
                    {scoreBar(c.score)}
                    <span className="inline-flex items-center text-[10px] text-muted-foreground gap-0.5 shrink-0">
                      <ExternalLink className="h-3 w-3" /> ref
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TransmittalDocumentList({ transmittalId, projectId }: { transmittalId: number; projectId: string | number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["trs-detail", transmittalId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });
  const items: any[] = data?.items ?? [];

  const setItemReviewCode = async (itemId: number, reviewCode: string | null) => {
    await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewCode }),
    });
    qc.invalidateQueries({ queryKey: ["trs-detail", transmittalId] });
  };

  const docStatusColor: Record<string, string> = {
    approved: "text-green-700",
    in_review: "text-amber-700",
    draft: "text-muted-foreground",
    rejected: "text-red-700",
    superseded: "text-muted-foreground",
    issued: "text-blue-700",
  };

  return (
    <div className="border-t mt-4 pt-4 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Documents Transmitted
        <span className="ml-2 font-normal normal-case text-muted-foreground">({items.length})</span>
      </p>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No documents attached to this transmittal.</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Doc No</th>
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Rev</th>
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Review Code</th>
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, idx: number) => (
                <tr key={item.id} className={`border-b last:border-b-0 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                  <td className="px-2 py-1.5 font-mono text-primary whitespace-nowrap">{item.documentNumber || "—"}</td>
                  <td className="px-2 py-1.5 max-w-[160px] truncate" title={item.documentTitle}>{item.documentTitle || "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{item.revision || "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <select
                      value={item.reviewCode ?? ""}
                      onChange={e => setItemReviewCode(item.id, e.target.value || null)}
                      className="text-xs border rounded px-1 py-0.5 bg-background cursor-pointer"
                    >
                      <option value="">—</option>
                      <option value="A">A – Approved</option>
                      <option value="B">B – Approved w/ Comments</option>
                      <option value="C">C – Revise & Resubmit</option>
                      <option value="D">D – Rejected</option>
                      <option value="UR">UR – Under Review</option>
                    </select>
                  </td>
                  <td className={`px-2 py-1.5 whitespace-nowrap capitalize ${docStatusColor[item.documentStatus ?? ""] ?? "text-muted-foreground"}`}>
                    {item.documentStatus?.replace(/_/g, " ") ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Transmittal History Panel ────────────────────────────────────────────────
function TransmittalHistoryPanel({ transmittalId, projectId }: { transmittalId: number; projectId: string | number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["trs-history", transmittalId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transmittals/${transmittalId}/history`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });
  const entries: any[] = data?.history ?? [];

  type EventMeta = { icon: ReactNode; color: string; line: string };
  const eventMeta = (eventType: string): EventMeta => {
    const map: Record<string, EventMeta> = {
      created:           { icon: <Plus className="h-3 w-3" />,          color: "bg-blue-500",   line: "border-blue-200" },
      sent:              { icon: <Send className="h-3 w-3" />,           color: "bg-indigo-500", line: "border-indigo-200" },
      acknowledged:      { icon: <CheckCircle2 className="h-3 w-3" />,  color: "bg-green-500",  line: "border-green-200" },
      review_code_set:   { icon: <BookOpen className="h-3 w-3" />,      color: "bg-amber-500",  line: "border-amber-200" },
      approval_submitted:{ icon: <Clock className="h-3 w-3" />,         color: "bg-yellow-500", line: "border-yellow-200" },
      record_approved:   { icon: <CheckCircle2 className="h-3 w-3" />,  color: "bg-green-600",  line: "border-green-300" },
      record_rejected:   { icon: <XCircle className="h-3 w-3" />,       color: "bg-red-500",    line: "border-red-200" },
      item_added:        { icon: <Plus className="h-3 w-3" />,           color: "bg-sky-500",    line: "border-sky-200" },
      item_removed:      { icon: <Trash2 className="h-3 w-3" />,        color: "bg-gray-400",   line: "border-gray-200" },
    };
    return map[eventType] ?? { icon: <CircleDot className="h-3 w-3" />, color: "bg-gray-400", line: "border-gray-200" };
  };

  return (
    <div className="border-t mt-4 pt-4 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transmittal History</p>
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No history recorded yet.</p>
      ) : (
        <div className="relative pl-5">
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
          <div className="space-y-3">
            {entries.map((e) => {
              const meta = eventMeta(e.eventType);
              return (
                <div key={e.id} className="relative flex items-start gap-3 text-xs">
                  <span className={`absolute -left-5 flex h-[18px] w-[18px] items-center justify-center rounded-full text-white shrink-0 mt-0.5 ${meta.color}`}>
                    {meta.icon}
                  </span>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-foreground leading-snug">{e.description}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {e.performedByName && <span className="font-medium text-foreground/70">{e.performedByName}</span>}
                      {e.performedByName && " · "}
                      {fmt(e.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 3. Transmittal Register ──────────────────────────────────────────────────
function TransmittalRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const [detailItem, setDetailItem] = useState<any>(null);
  const TRS_COLS = [
    { key: "transmittalNumber", label: t("transmittalNo") },
    { key: "direction", label: "Direction" },
    { key: "createdAt", label: t("date") },
    { key: "subject", label: t("subject") },
    { key: "toExternal", label: t("to") },
    { key: "partyType", label: "Party Type" },
    { key: "purpose", label: t("purpose") },
    { key: "reviewCode", label: "Review Code" },
    { key: "itemCount", label: "Docs" },
    { key: "status", label: t("status") },
    { key: "approvalStatus", label: t("approvalStatus") },
    { key: "sentAt", label: t("sentDate") },
    { key: "acknowledgedAt", label: t("acknowledged") },
  ];
  const { visible: visibleCols, toggle: toggleCol } = useColumnVisibility("transmittal", TRS_COLS.map(c => c.key));

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
    if (filters.direction !== "_all") d = d.filter(x => (x.direction ?? "").toUpperCase() === filters.direction);
    if (filters.trsPartyType !== "_all") d = d.filter(x => x.partyType === filters.trsPartyType);
    d = applyDateFilter(d, "createdAt", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["transmittalNumber", "subject", "toExternal", "partyType"]);
    return d;
  }, [allItems, filters]);

  if (filters.projectId === "_all") return <EmptyState icon={Send} message={t("selectProject")} />;

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-2">
          <ColumnToggleButton allCols={TRS_COLS} visibleKeys={visibleCols} onToggle={toggleCol} storageKey="transmittal" />
          <ExportButtons
            data={filtered.map(d => ({ ...d, createdAt: fmt(d.createdAt), sentAt: fmt(d.sentAt), acknowledgedAt: fmt(d.acknowledgedAt) }))}
            filename="transmittal-register"
            columns={TRS_COLS}
            title={t("transmittalRegister")}
          />
        </div>
      </div>
      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>{TRS_COLS.filter(c => visibleCols.has(c.key)).map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={visibleCols.size} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={visibleCols.size} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
            ) : filtered.map(tr => (
              <TableRow key={tr.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailItem(tr)}>
                {visibleCols.has("transmittalNumber") && <TableCell className="font-mono text-xs text-primary">{tr.transmittalNumber || `TRS-${String(tr.id).padStart(4,"0")}`}</TableCell>}
                {visibleCols.has("direction") && <TableCell><DirectionBadge direction={tr.direction} /></TableCell>}
                {visibleCols.has("createdAt") && <TableCell className="text-xs whitespace-nowrap">{fmt(tr.createdAt)}</TableCell>}
                {visibleCols.has("subject") && <TableCell className="text-sm max-w-[200px] truncate font-medium">{tr.subject}</TableCell>}
                {visibleCols.has("toExternal") && <TableCell className="text-xs max-w-[120px] truncate">{tr.toExternal || "—"}</TableCell>}
                {visibleCols.has("partyType") && <TableCell className="text-xs">{tr.partyType || "—"}</TableCell>}
                {visibleCols.has("purpose") && <TableCell className="text-xs capitalize">{tr.purpose?.replace(/_/g," ") || "—"}</TableCell>}
                {visibleCols.has("reviewCode") && <TableCell><ReviewCodePill code={tr.reviewCode} /></TableCell>}
                {visibleCols.has("itemCount") && (
                  <TableCell>
                    {(tr.itemCount ?? 0) > 0
                      ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          <BookOpen className="h-3 w-3" />{tr.itemCount}
                        </span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                )}
                {visibleCols.has("status") && <TableCell><StatusPill status={tr.status} /></TableCell>}
                {visibleCols.has("approvalStatus") && <TableCell><ApprovalBadge status={tr.approvalStatus} /></TableCell>}
                {visibleCols.has("sentAt") && <TableCell className="text-xs whitespace-nowrap">{fmt(tr.sentAt)}</TableCell>}
                {visibleCols.has("acknowledgedAt") && <TableCell className="text-xs whitespace-nowrap">{fmt(tr.acknowledgedAt)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RecordDetailSheet
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={detailItem?.subject ?? "Transmittal Detail"}
        fields={[
          { key: "transmittalNumber", label: "Transmittal No" },
          { key: "direction", label: "Direction" },
          { key: "partyType", label: "Party Type" },
          { key: "subject", label: "Subject" },
          { key: "toExternal", label: "To" },
          { key: "purpose", label: "Purpose" },
          { key: "reviewCode", label: "Review Code" },
          { key: "status", label: "Status" },
          { key: "sentAt", label: "Sent Date", format: fmt },
          { key: "acknowledgedAt", label: "Acknowledged", format: fmt },
        ]}
      >
        {detailItem && filters.projectId !== "_all" && (
          <>
            <ApprovalPanel
              record={detailItem}
              entityType="transmittal"
              projectId={filters.projectId}
              queryKey={["rpt-trans", filters.projectId]}
              onRecordUpdated={setDetailItem}
            />
            <TransmittalDocumentList transmittalId={detailItem.id} projectId={filters.projectId} />
            <SmartLinkPanel transmittalId={detailItem.id} projectId={filters.projectId} />
            <TransmittalHistoryPanel transmittalId={detailItem.id} projectId={filters.projectId} />
          </>
        )}
      </RecordDetailSheet>
    </div>
  );
}

// ─── 4. Drawing Register ──────────────────────────────────────────────────────
function DrawingRegister({ filters }: { filters: Filters }) {
  const { t, isRtl } = useI18n();
  const [detailItem, setDetailItem] = useState<any>(null);

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
              <TableRow key={doc.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailItem(doc)}>
                <TableCell className="font-mono text-xs text-primary">{doc.documentNumber}</TableCell>
                <TableCell className="text-sm max-w-[200px] truncate font-medium">{doc.title}</TableCell>
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
      <RecordDetailSheet
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={detailItem?.documentNumber ?? "Drawing Detail"}
        fields={[
          { key: "documentNumber", label: "Drawing No" },
          { key: "title", label: "Title" },
          { key: "discipline", label: "Discipline" },
          { key: "revision", label: "Revision" },
          { key: "status", label: "Status" },
          { key: "issuedBy", label: "Issued By" },
          { key: "description", label: "Description" },
          { key: "updatedAt", label: "Updated", format: fmt },
        ]}
      />
    </div>
  );
}

// ─── 5. ITR / MIR Register ────────────────────────────────────────────────────
function ItrMirRegister({ filters, projects = [] }: { filters: Filters; projects?: any[] }) {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = !["viewer", "reviewer"].includes(user?.role ?? "");
  const isCrossOrg = user?.role === "system_owner" && filters.projectId === "_all";
  const [addOpen, setAddOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: string) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };
  const ITR_COLS = [
    { key: "requestNumber", label: t("requestNo") },
    { key: "type", label: t("requestType") },
    { key: "direction", label: "Direction" },
    { key: "partyType", label: "Party Type" },
    { key: "description", label: t("description") },
    { key: "location", label: t("location") },
    { key: "date", label: t("date") },
    { key: "reviewCode", label: "Review Code" },
    { key: "status", label: t("status") },
    { key: "approvalStatus", label: t("approvalStatus") },
    { key: "contractor", label: t("contractor") },
    { key: "remarks", label: t("remarks") },
    ...(isCrossOrg ? [{ key: "_orgName", label: t("orgName_label") }, { key: "_projectName", label: t("project_col") }] : []),
  ];
  const { visible: visibleCols, toggle: toggleCol } = useColumnVisibility("itr", ITR_COLS.map(c => c.key));
  const [form, setForm] = useState({ requestNumber: "", type: "itr", description: "", location: "", date: "", status: "pending", contractor: "", remarks: "", direction: "", partyType: "", reviewCode: "" });

  const { data, isLoading, isError: isModuleError, error: queryError } = useQuery({
    queryKey: ["rpt-itr", filters.projectId, projects.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      if (filters.projectId !== "_all") {
        const r = await fetch(`/api/projects/${filters.projectId}/inspection-requests`);
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw Object.assign(new Error(body.message ?? "Failed"), { code: body.error, status: r.status });
        }
        return r.json();
      }
      if (!isCrossOrg || projects.length === 0) return { inspectionRequests: [] };
      const results = await Promise.all(
        projects.map(async (p: any) => {
          const r = await fetch(`/api/projects/${p.id}/inspection-requests`);
          if (!r.ok) return [];
          const d = await r.json();
          return (d.inspectionRequests ?? []).map((item: any) => ({
            ...item, _projectName: p.name, _orgName: p.organizationName,
          }));
        }),
      );
      return { inspectionRequests: results.flat() };
    },
    enabled: filters.projectId !== "_all" || isCrossOrg,
  });
  const allItems: any[] = data?.inspectionRequests ?? [];

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    if (filters.direction !== "_all") d = d.filter(x => (x.direction ?? "").toUpperCase() === filters.direction);
    d = applyDateFilter(d, "date", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["requestNumber", "description", "location", "contractor", "partyType"]);
    return sortItems(d, sortKey, sortDir);
  }, [allItems, filters, sortKey, sortDir]);

  const addRecord = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${filters.projectId}/inspection-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          requestNumber: form.requestNumber || `${form.type.toUpperCase()}-${Date.now()}`,
          direction: form.direction || null,
          partyType: form.partyType || null,
          reviewCode: form.reviewCode || null,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-itr"] });
      setAddOpen(false);
      setForm({ requestNumber: "", type: "itr", description: "", location: "", date: "", status: "pending", contractor: "", remarks: "", direction: "", partyType: "", reviewCode: "" });
      toast({ title: "Inspection request added" });
    },
    onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
  });

  if (isModuleError && (queryError as any)?.code === "MODULE_DISABLED") {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground justify-center">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        Inspection Requests (Registers module) are not available on your plan. Contact your administrator to upgrade.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-2">
          {filters.projectId !== "_all" && canWrite && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {t("addRecord")}
            </Button>
          )}
          <ColumnToggleButton allCols={ITR_COLS} visibleKeys={visibleCols} onToggle={toggleCol} storageKey="itr" />
          <ExportButtons
            data={filtered.map(d => ({ ...d, date: fmt(d.date) }))}
            filename="itr-mir-register"
            columns={ITR_COLS}
            title={t("itrMirRegister")}
          />
        </div>
      </div>

      {filters.projectId === "_all" && !isCrossOrg ? (
        <EmptyState icon={ClipboardList} message={t("selectProject")} />
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {ITR_COLS.filter(c => visibleCols.has(c.key)).map(c => (
                  <SortableHead key={c.key} label={c.label} colKey={c.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={visibleCols.size} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={visibleCols.size} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailItem(item)}>
                  {visibleCols.has("requestNumber") && <TableCell className="font-mono text-xs text-primary">{item.requestNumber}</TableCell>}
                  {visibleCols.has("type") && <TableCell><span className="text-xs font-semibold uppercase text-primary">{item.type}</span></TableCell>}
                  {visibleCols.has("direction") && <TableCell><DirectionBadge direction={item.direction} /></TableCell>}
                  {visibleCols.has("partyType") && <TableCell className="text-xs">{item.partyType || "—"}</TableCell>}
                  {visibleCols.has("description") && <TableCell className="text-sm max-w-[200px] truncate font-medium">{item.description || "—"}</TableCell>}
                  {visibleCols.has("location") && <TableCell className="text-xs">{item.location || "—"}</TableCell>}
                  {visibleCols.has("date") && <TableCell className="text-xs whitespace-nowrap">{fmt(item.date)}</TableCell>}
                  {visibleCols.has("reviewCode") && <TableCell><ReviewCodePill code={item.reviewCode} /></TableCell>}
                  {visibleCols.has("status") && <TableCell><StatusPill status={item.status} /></TableCell>}
                  {visibleCols.has("approvalStatus") && <TableCell><ApprovalBadge status={item.approvalStatus} /></TableCell>}
                  {visibleCols.has("contractor") && <TableCell className="text-xs">{item.contractor || "—"}</TableCell>}
                  {visibleCols.has("remarks") && <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{item.remarks || "—"}</TableCell>}
                  {visibleCols.has("_orgName") && <TableCell className="text-xs font-medium text-blue-700 dark:text-blue-400">{item._orgName || "—"}</TableCell>}
                  {visibleCols.has("_projectName") && <TableCell className="text-xs text-muted-foreground">{item._projectName || "—"}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <RecordDetailSheet
        item={detailItem ? { ...detailItem, _orgName: projects.find((p: any) => p.id === detailItem.projectId)?.organizationName } : detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={detailItem?.requestNumber ?? "ITR/MIR Detail"}
        fields={[
          { key: "requestNumber", label: "Request No" },
          { key: "type", label: "Type" },
          { key: "direction", label: "Direction" },
          { key: "partyType", label: "Party Type" },
          { key: "description", label: "Description" },
          { key: "location", label: "Location" },
          { key: "reviewCode", label: "Review Code" },
          { key: "status", label: "Status" },
          { key: "contractor", label: "Contractor" },
          { key: "date", label: "Date", format: fmt },
          { key: "remarks", label: "Remarks" },
          { key: "_orgName", label: t("orgName_label") },
        ]}
      >
        {detailItem && filters.projectId !== "_all" && (
          <ApprovalPanel
            record={detailItem}
            entityType="itr"
            projectId={filters.projectId}
            queryKey={["rpt-itr", filters.projectId]}
            onRecordUpdated={setDetailItem}
          />
        )}
      </RecordDetailSheet>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[520px]">
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
              <div>
                <Label className="text-xs">Direction</Label>
                <Select value={form.direction || "_none"} onValueChange={v => setForm(f => ({ ...f, direction: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="IN">↓ IN</SelectItem>
                    <SelectItem value="OUT">↑ OUT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Party Type</Label>
                <Select value={form.partyType || "_none"} onValueChange={v => setForm(f => ({ ...f, partyType: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="Client">Client</SelectItem>
                    <SelectItem value="Consultant">Consultant</SelectItem>
                    <SelectItem value="Contractor">Contractor</SelectItem>
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
                <Label className="text-xs">Review Code <span className="text-muted-foreground">(auto-sets status)</span></Label>
                <Select value={form.reviewCode || "_none"} onValueChange={v => setForm(f => ({ ...f, reviewCode: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="A">A – Approved</SelectItem>
                    <SelectItem value="B">B – Approved w/ Comments</SelectItem>
                    <SelectItem value="C">C – Revise & Resubmit</SelectItem>
                    <SelectItem value="D">D – Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!form.reviewCode && (
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
              )}
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
function NcrSorRegister({ filters, projects = [] }: { filters: Filters; projects?: any[] }) {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = !["viewer", "reviewer"].includes(user?.role ?? "");
  const isCrossOrg = user?.role === "system_owner" && filters.projectId === "_all";
  const [addOpen, setAddOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [sortKey, setSortKey] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: string) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };
  const NCR_COLS = [
    { key: "reportNumber", label: t("reportNo") },
    { key: "type", label: t("type") },
    { key: "direction", label: "Direction" },
    { key: "partyType", label: "Party Type" },
    { key: "description", label: t("description") },
    { key: "location", label: t("location") },
    { key: "raisedBy", label: t("raisedBy") },
    { key: "reviewCode", label: "Review Code" },
    { key: "status", label: t("status") },
    { key: "approvalStatus", label: t("approvalStatus") },
    { key: "correctiveAction", label: t("correctiveAction") },
    { key: "closeDate", label: t("closeDate") },
    ...(isCrossOrg ? [{ key: "_orgName", label: t("orgName_label") }, { key: "_projectName", label: t("project_col") }] : []),
  ];
  const { visible: visibleCols, toggle: toggleCol } = useColumnVisibility("ncr", NCR_COLS.map(c => c.key));
  const [form, setForm] = useState({ reportNumber: "", type: "ncr", description: "", location: "", raisedBy: "", status: "open", correctiveAction: "", closeDate: "", remarks: "", direction: "", partyType: "", reviewCode: "" });

  const { data, isLoading, isError: isModuleError, error: queryError } = useQuery({
    queryKey: ["rpt-ncr", filters.projectId, projects.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      if (filters.projectId !== "_all") {
        const r = await fetch(`/api/projects/${filters.projectId}/ncr-records`);
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw Object.assign(new Error(body.message ?? "Failed"), { code: body.error, status: r.status });
        }
        return r.json();
      }
      if (!isCrossOrg || projects.length === 0) return { ncrRecords: [] };
      const results = await Promise.all(
        projects.map(async (p: any) => {
          const r = await fetch(`/api/projects/${p.id}/ncr-records`);
          if (!r.ok) return [];
          const d = await r.json();
          return (d.ncrRecords ?? []).map((item: any) => ({
            ...item, _projectName: p.name, _orgName: p.organizationName,
          }));
        }),
      );
      return { ncrRecords: results.flat() };
    },
    enabled: filters.projectId !== "_all" || isCrossOrg,
  });
  const allItems: any[] = data?.ncrRecords ?? [];

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    d = applyDateFilter(d, "createdAt", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["reportNumber", "description", "location", "raisedBy"]);
    return sortItems(d, sortKey, sortDir);
  }, [allItems, filters, sortKey, sortDir]);

  const addRecord = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${filters.projectId}/ncr-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          reportNumber: form.reportNumber || `${form.type.toUpperCase()}-${Date.now()}`,
          direction: form.direction || null,
          partyType: form.partyType || null,
          reviewCode: form.reviewCode || null,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-ncr"] });
      setAddOpen(false);
      setForm({ reportNumber: "", type: "ncr", description: "", location: "", raisedBy: "", status: "open", correctiveAction: "", closeDate: "", remarks: "", direction: "", partyType: "", reviewCode: "" });
      toast({ title: "NCR/SOR record added" });
    },
    onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
  });

  if (isModuleError && (queryError as any)?.code === "MODULE_DISABLED") {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground justify-center">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        NCR/SOR records (Registers module) are not available on your plan. Contact your administrator to upgrade.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-2">
          {filters.projectId !== "_all" && canWrite && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {t("addRecord")}
            </Button>
          )}
          <ColumnToggleButton allCols={NCR_COLS} visibleKeys={visibleCols} onToggle={toggleCol} storageKey="ncr" />
          <ExportButtons
            data={filtered.map(d => ({ ...d, closeDate: fmt(d.closeDate) }))}
            filename="ncr-sor-register"
            columns={NCR_COLS}
            title={t("ncrSorRegister")}
          />
        </div>
      </div>

      {filters.projectId === "_all" && !isCrossOrg ? (
        <EmptyState icon={ShieldAlert} message={t("selectProject")} />
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {NCR_COLS.filter(c => visibleCols.has(c.key)).map(c => (
                  <SortableHead key={c.key} label={c.label} colKey={c.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={visibleCols.size} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={visibleCols.size} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailItem(item)}>
                  {visibleCols.has("reportNumber") && <TableCell className="font-mono text-xs text-destructive font-semibold">{item.reportNumber}</TableCell>}
                  {visibleCols.has("type") && <TableCell><span className="text-xs font-semibold uppercase text-destructive">{item.type}</span></TableCell>}
                  {visibleCols.has("direction") && <TableCell><DirectionBadge direction={item.direction} /></TableCell>}
                  {visibleCols.has("partyType") && <TableCell className="text-xs">{item.partyType || "—"}</TableCell>}
                  {visibleCols.has("description") && <TableCell className="text-sm max-w-[200px] truncate font-medium">{item.description || "—"}</TableCell>}
                  {visibleCols.has("location") && <TableCell className="text-xs">{item.location || "—"}</TableCell>}
                  {visibleCols.has("raisedBy") && <TableCell className="text-xs">{item.raisedBy || "—"}</TableCell>}
                  {visibleCols.has("reviewCode") && <TableCell><ReviewCodePill code={item.reviewCode} /></TableCell>}
                  {visibleCols.has("status") && <TableCell><StatusPill status={item.status} /></TableCell>}
                  {visibleCols.has("approvalStatus") && <TableCell><ApprovalBadge status={item.approvalStatus} /></TableCell>}
                  {visibleCols.has("correctiveAction") && <TableCell className="text-xs max-w-[150px] truncate">{item.correctiveAction || "—"}</TableCell>}
                  {visibleCols.has("closeDate") && <TableCell className="text-xs whitespace-nowrap">{fmt(item.closeDate)}</TableCell>}
                  {visibleCols.has("_orgName") && <TableCell className="text-xs font-medium text-blue-700 dark:text-blue-400">{item._orgName || "—"}</TableCell>}
                  {visibleCols.has("_projectName") && <TableCell className="text-xs text-muted-foreground">{item._projectName || "—"}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <RecordDetailSheet
        item={detailItem ? { ...detailItem, _orgName: projects.find((p: any) => p.id === detailItem.projectId)?.organizationName } : detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={detailItem?.reportNumber ?? "NCR/SOR Detail"}
        fields={[
          { key: "reportNumber", label: "Report No" },
          { key: "type", label: "Type" },
          { key: "direction", label: "Direction" },
          { key: "partyType", label: "Party Type" },
          { key: "description", label: "Description" },
          { key: "location", label: "Location" },
          { key: "raisedBy", label: "Raised By" },
          { key: "reviewCode", label: "Review Code" },
          { key: "status", label: "Status" },
          { key: "correctiveAction", label: "Corrective Action" },
          { key: "closeDate", label: "Close Date", format: fmt },
          { key: "remarks", label: "Remarks" },
          { key: "_orgName", label: t("orgName_label") },
        ]}
      >
        {detailItem && filters.projectId !== "_all" && (
          <ApprovalPanel
            record={detailItem}
            entityType="ncr"
            projectId={filters.projectId}
            queryKey={["rpt-ncr", filters.projectId]}
            onRecordUpdated={setDetailItem}
          />
        )}
      </RecordDetailSheet>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[520px]">
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
              <div>
                <Label className="text-xs">Direction</Label>
                <Select value={form.direction || "_none"} onValueChange={v => setForm(f => ({ ...f, direction: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="IN">↓ IN</SelectItem>
                    <SelectItem value="OUT">↑ OUT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Party Type</Label>
                <Select value={form.partyType || "_none"} onValueChange={v => setForm(f => ({ ...f, partyType: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="Client">Client</SelectItem>
                    <SelectItem value="Consultant">Consultant</SelectItem>
                    <SelectItem value="Contractor">Contractor</SelectItem>
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
                <Label className="text-xs">Review Code <span className="text-muted-foreground">(auto-sets status)</span></Label>
                <Select value={form.reviewCode || "_none"} onValueChange={v => setForm(f => ({ ...f, reviewCode: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="A">A – Approved / Closed</SelectItem>
                    <SelectItem value="B">B – In Progress</SelectItem>
                    <SelectItem value="C">C – Revise & Resubmit</SelectItem>
                    <SelectItem value="D">D – Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!form.reviewCode && (
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
              )}
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
function NocRegister({ filters, projects = [] }: { filters: Filters; projects?: any[] }) {
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = !["viewer", "reviewer"].includes(user?.role ?? "");
  const isCrossOrg = user?.role === "system_owner" && filters.projectId === "_all";
  const [addOpen, setAddOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: string) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };
  const [form, setForm] = useState({ nocNumber: "", authority: "", date: "", status: "pending", linkedDocumentId: "", remarks: "", direction: "", partyType: "", reviewCode: "" });

  const { data, isLoading, isError: isModuleError, error: queryError } = useQuery({
    queryKey: ["rpt-noc", filters.projectId, projects.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      if (filters.projectId !== "_all") {
        const r = await fetch(`/api/projects/${filters.projectId}/noc-records`);
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw Object.assign(new Error(body.message ?? "Failed"), { code: body.error, status: r.status });
        }
        return r.json();
      }
      if (!isCrossOrg || projects.length === 0) return { nocRecords: [] };
      const results = await Promise.all(
        projects.map(async (p: any) => {
          const r = await fetch(`/api/projects/${p.id}/noc-records`);
          if (!r.ok) return [];
          const d = await r.json();
          return (d.nocRecords ?? []).map((item: any) => ({
            ...item, _projectName: p.name, _orgName: p.organizationName,
          }));
        }),
      );
      return { nocRecords: results.flat() };
    },
    enabled: filters.projectId !== "_all" || isCrossOrg,
  });
  const allItems: any[] = data?.nocRecords ?? [];

  const filtered = useMemo(() => {
    let d = allItems;
    if (filters.status !== "_all") d = d.filter(x => x.status === filters.status);
    if (filters.direction !== "_all") d = d.filter(x => (x.direction ?? "").toUpperCase() === filters.direction);
    d = applyDateFilter(d, "date", filters.dateFrom, filters.dateTo);
    d = applyTextFilter(d, filters.search, ["nocNumber", "authority", "remarks", "partyType"]);
    return sortItems(d, sortKey, sortDir);
  }, [allItems, filters, sortKey, sortDir]);

  const addRecord = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${filters.projectId}/noc-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          nocNumber: form.nocNumber || `NOC-${Date.now()}`,
          linkedDocumentId: form.linkedDocumentId ? parseInt(form.linkedDocumentId) : undefined,
          direction: form.direction || null,
          partyType: form.partyType || null,
          reviewCode: form.reviewCode || null,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rpt-noc"] });
      setAddOpen(false);
      setForm({ nocNumber: "", authority: "", date: "", status: "pending", linkedDocumentId: "", remarks: "", direction: "", partyType: "", reviewCode: "" });
      toast({ title: "NOC record added" });
    },
    onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
  });

  const COLS = [
    { key: "nocNumber", label: t("nocNo") },
    { key: "direction", label: "Direction" },
    { key: "partyType", label: "Party Type" },
    { key: "authority", label: t("authority") },
    { key: "date", label: t("date") },
    { key: "reviewCode", label: "Review Code" },
    { key: "status", label: t("status") },
    { key: "remarks", label: t("remarks") },
    ...(isCrossOrg ? [{ key: "_orgName", label: t("orgName_label") }, { key: "_projectName", label: t("project_col") }] : []),
  ];

  if (isModuleError && (queryError as any)?.code === "MODULE_DISABLED") {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground justify-center">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        NOC records (Registers module) are not available on your plan. Contact your administrator to upgrade.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <p className="text-sm text-muted-foreground">{filtered.length} {t("records")}</p>
        <div className="flex gap-2">
          {filters.projectId !== "_all" && canWrite && (
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

      {filters.projectId === "_all" && !isCrossOrg ? (
        <EmptyState icon={FileCheck} message={t("selectProject")} />
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {COLS.map(c => (
                  <SortableHead key={c.key} label={c.label} colKey={c.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="py-12 text-center text-muted-foreground text-sm">{t("noData")}</TableCell></TableRow>
              ) : filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailItem(item)}>
                  <TableCell className="font-mono text-xs text-primary font-semibold">{item.nocNumber}</TableCell>
                  <TableCell><DirectionBadge direction={item.direction} /></TableCell>
                  <TableCell className="text-xs">{item.partyType || "—"}</TableCell>
                  <TableCell className="text-sm max-w-[150px] truncate font-medium">{item.authority || "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmt(item.date)}</TableCell>
                  <TableCell><ReviewCodePill code={item.reviewCode} /></TableCell>
                  <TableCell><StatusPill status={item.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{item.remarks || "—"}</TableCell>
                  {isCrossOrg && <TableCell className="text-xs font-medium text-blue-700 dark:text-blue-400">{item._orgName || "—"}</TableCell>}
                  {isCrossOrg && <TableCell className="text-xs text-muted-foreground">{item._projectName || "—"}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <RecordDetailSheet
        item={detailItem ? { ...detailItem, _orgName: projects.find((p: any) => p.id === detailItem.projectId)?.organizationName } : detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={detailItem?.nocNumber ?? "NOC Detail"}
        fields={[
          { key: "nocNumber", label: "NOC No" },
          { key: "direction", label: "Direction" },
          { key: "partyType", label: "Party Type" },
          { key: "authority", label: "Authority" },
          { key: "date", label: "Date", format: fmt },
          { key: "reviewCode", label: "Review Code" },
          { key: "status", label: "Status" },
          { key: "remarks", label: "Remarks" },
          { key: "_orgName", label: t("orgName_label") },
        ]}
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[520px]">
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
                <Label className="text-xs">Direction</Label>
                <Select value={form.direction || "_none"} onValueChange={v => setForm(f => ({ ...f, direction: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="IN">↓ IN</SelectItem>
                    <SelectItem value="OUT">↑ OUT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Party Type</Label>
                <Select value={form.partyType || "_none"} onValueChange={v => setForm(f => ({ ...f, partyType: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="Client">Client</SelectItem>
                    <SelectItem value="Consultant">Consultant</SelectItem>
                    <SelectItem value="Contractor">Contractor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("date")}</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Review Code <span className="text-muted-foreground">(auto-sets status)</span></Label>
                <Select value={form.reviewCode || "_none"} onValueChange={v => setForm(f => ({ ...f, reviewCode: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    <SelectItem value="A">A – Approved</SelectItem>
                    <SelectItem value="B">B – Approved w/ Comments</SelectItem>
                    <SelectItem value="C">C – Revise & Resubmit</SelectItem>
                    <SelectItem value="D">D – Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!form.reviewCode && (
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
              )}
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
  const { activeOrgId } = useOrgContext();
  const addOverride = useOrgOverrideUrl();

  const { data: projectsData } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: async () => { const r = await fetch(addOverride("/api/projects")); return r.json(); },
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
        showDirection={["transmittals","itr","ncr","noc"].includes(activeTab)}
        showTrsPartyType={activeTab === "transmittals"}
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
            <ItrMirRegister filters={filters} projects={projects} />
          </TabsContent>
          <TabsContent value="ncr" className="mt-0">
            <NcrSorRegister filters={filters} projects={projects} />
          </TabsContent>
          <TabsContent value="noc" className="mt-0">
            <NocRegister filters={filters} projects={projects} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

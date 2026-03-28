import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import * as XLSX from "xlsx";

import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  ClipboardCheck, Filter, X, FileSpreadsheet, RefreshCw, ChevronLeft, ChevronRight,
  User, FolderKanban, Activity, Calendar, Info, ShieldOff,
} from "lucide-react";

// Roles that may access this page
const ALLOWED_ROLES = ["system_owner", "admin", "project_manager", "document_controller"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy HH:mm"); } catch { return d; }
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    create: "bg-green-100 text-green-700",
    update: "bg-blue-100 text-blue-700",
    delete: "bg-red-100 text-red-700",
    approve: "bg-emerald-100 text-emerald-700",
    reject: "bg-rose-100 text-rose-700",
    upload: "bg-purple-100 text-purple-700",
    submit: "bg-yellow-100 text-yellow-700",
    workflow_approve: "bg-emerald-100 text-emerald-700",
    workflow_reject: "bg-rose-100 text-rose-700",
    workflow_submit: "bg-yellow-100 text-yellow-700",
    login: "bg-slate-100 text-slate-700",
    share: "bg-indigo-100 text-indigo-700",
  };
  const cls = map[action] ?? "bg-muted text-muted-foreground";
  const label = action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

function EntityTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    document: "bg-blue-50 text-blue-600",
    correspondence: "bg-yellow-50 text-yellow-700",
    transmittal: "bg-purple-50 text-purple-600",
    ncr: "bg-red-50 text-red-600",
    itr: "bg-cyan-50 text-cyan-700",
    noc: "bg-green-50 text-green-700",
    deliverable: "bg-orange-50 text-orange-700",
    project: "bg-indigo-50 text-indigo-700",
    user: "bg-slate-50 text-slate-700",
    task: "bg-rose-50 text-rose-600",
    workflow: "bg-violet-50 text-violet-700",
  };
  const cls = map[type] ?? "bg-muted text-muted-foreground";
  const label = type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

// ─── Detail Sheet ─────────────────────────────────────────────────────────────
function LogDetailSheet({ item, open, onClose }: { item: any; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  if (!item) return null;

  let details: Record<string, any> = {};
  try {
    details = typeof item.details === "string" ? JSON.parse(item.details) : (item.details ?? {});
  } catch {}

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            {t("activityDetail")}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {t("logEntry")} #{item.id}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          <div className="space-y-3">
            <Row label={t("timestamp")} value={fmtDateTime(item.createdAt)} icon={<Calendar className="h-3.5 w-3.5" />} />
            <Row label={t("user")} value={item.userName + (item.userEmail ? ` <${item.userEmail}>` : "")} icon={<User className="h-3.5 w-3.5" />} />
            <Row label={t("action")} value={<ActionBadge action={item.action} />} icon={<Activity className="h-3.5 w-3.5" />} />
            <Row label={t("entityType")} value={<EntityTypeBadge type={item.entityType} />} icon={<Info className="h-3.5 w-3.5" />} />
            <Row label={t("entityTitle")} value={item.entityTitle ?? `ID: ${item.entityId}`} />
            {item.projectName && (
              <Row
                label={t("project_col")}
                value={`${item.projectCode ? `[${item.projectCode}] ` : ""}${item.projectName}`}
                icon={<FolderKanban className="h-3.5 w-3.5" />}
              />
            )}
          </div>

          {Object.keys(details).length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {t("changeDetails")}
              </p>
              <div className="space-y-2">
                {Object.entries(details).map(([key, val]) => (
                  <div key={key} className="grid grid-cols-[120px_1fr] gap-2 items-start">
                    <span className="text-xs text-muted-foreground font-medium capitalize break-words">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs break-words font-mono bg-muted/50 rounded px-1.5 py-0.5">
                      {typeof val === "object" ? JSON.stringify(val, null, 2) : String(val ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
        {icon}
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

// ─── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, totalPages, total, perPage, onPage }: {
  page: number; totalPages: number; total: number; perPage: number; onPage: (p: number) => void;
}) {
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t pt-3 mt-2">
      <span className="text-xs text-muted-foreground">
        {from}–{to} / {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs font-medium px-2">{page} / {totalPages}</span>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Activity Log Page ────────────────────────────────────────────────────────
interface LogFilters {
  projectId: string;
  entityType: string;
  action: string;
  userId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

const DEFAULT_FILTERS: LogFilters = {
  projectId: "_all", entityType: "_all", action: "_all",
  userId: "_all", dateFrom: "", dateTo: "", search: "",
};

const ENTITY_TYPES = [
  "document", "correspondence", "transmittal", "ncr", "itr", "noc",
  "deliverable", "project", "user", "task", "workflow",
];

const ACTIONS = [
  "create", "update", "delete", "approve", "reject", "upload",
  "submit", "workflow_approve", "workflow_reject", "workflow_submit", "share", "login",
];

export default function ActivityLogPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const PER_PAGE = 50;

  // Role guard — show access-denied message for unauthorised roles
  const hasAccess = user && ALLOWED_ROLES.includes(user.role);

  const set = (key: keyof LogFilters, val: string) => {
    setFilters(f => ({ ...f, [key]: val }));
    setPage(1);
  };

  const hasFilters = Object.entries(filters).some(([k, v]) =>
    k === "search" ? v !== "" : v !== "_all" && v !== ""
  );

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(PER_PAGE));
    if (filters.projectId !== "_all") p.set("projectId", filters.projectId);
    if (filters.entityType !== "_all") p.set("entityType", filters.entityType);
    if (filters.action !== "_all") p.set("action", filters.action);
    if (filters.userId !== "_all") p.set("userId", filters.userId);
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) p.set("dateTo", filters.dateTo);
    if (filters.search) p.set("search", filters.search);
    return p.toString();
  }, [filters, page]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["activity-logs", params],
    queryFn: async () => {
      const r = await fetch(`/api/audit-logs?${params}`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!hasAccess,
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects-list"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
    enabled: !!hasAccess,
  });
  const projects: any[] = projectsData?.projects ?? [];

  const { data: usersData } = useQuery({
    queryKey: ["users-list"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
    enabled: !!hasAccess,
  });
  const users: any[] = usersData?.users ?? usersData ?? [];

  const logs: any[] = data?.logs ?? [];
  const total: number = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  // ─── Access Denied ────────────────────────────────────────────────────────
  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-4">
        <ShieldOff className="h-12 w-12 opacity-30" />
        <p className="text-base font-medium">Access Restricted</p>
        <p className="text-sm">
          {isRtl
            ? "هذه الصفحة متاحة للمسؤولين ومديري المشاريع ومتحكمي المستندات فقط."
            : "This page is available to admins, project managers, and document controllers only."}
        </p>
      </div>
    );
  }

  // ─── Export ───────────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const exportParams = new URLSearchParams();
      if (filters.projectId !== "_all") exportParams.set("projectId", filters.projectId);
      if (filters.entityType !== "_all") exportParams.set("entityType", filters.entityType);
      if (filters.action !== "_all") exportParams.set("action", filters.action);
      if (filters.userId !== "_all") exportParams.set("userId", filters.userId);
      if (filters.dateFrom) exportParams.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) exportParams.set("dateTo", filters.dateTo);
      if (filters.search) exportParams.set("search", filters.search);

      const r = await fetch(`/api/audit-logs/export-xlsx?${exportParams.toString()}`);
      if (!r.ok) throw new Error("Export failed");
      const json = await r.json();
      const rows = json.data.map((d: any) => ({
        "ID": d.id,
        "Timestamp": d.timestamp,
        "User": d.user,
        "Email": d.userEmail,
        "Action": d.action,
        "Entity Type": d.entityType,
        "Entity Title": d.entityTitle,
        "Project": d.project,
        "Project Code": d.projectCode,
        "Details": d.details,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Activity Log");
      XLSX.writeFile(wb, `activity-log-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-6 ${isRtl ? "font-[Tahoma,Arial,sans-serif]" : ""}`} dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("activityLog")}</h1>
            <p className="text-sm text-muted-foreground">{t("activityLogDesc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> {t("refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="h-8 gap-1.5 text-xs">
            <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" /> {t("exportExcelLabel")}
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

            <Select value={filters.projectId} onValueChange={v => set("projectId", v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t("allProjects")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allProjects")}</SelectItem>
                {projects.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.entityType} onValueChange={v => set("entityType", v)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder={t("allEntityTypes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allEntityTypes")}</SelectItem>
                {ENTITY_TYPES.map(et => (
                  <SelectItem key={et} value={et} className="capitalize">
                    {et.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.action} onValueChange={v => set("action", v)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder={t("allActions")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allActions")}</SelectItem>
                {ACTIONS.map(a => (
                  <SelectItem key={a} value={a} className="capitalize">
                    {a.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.userId} onValueChange={v => set("userId", v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t("allUsers")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allUsers")}</SelectItem>
                {users.map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Label className="text-xs shrink-0 text-muted-foreground">{t("dateFrom")}</Label>
              <Input type="date" value={filters.dateFrom} onChange={e => set("dateFrom", e.target.value)} className="h-8 w-[130px] text-xs" />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-xs shrink-0 text-muted-foreground">{t("dateTo")}</Label>
              <Input type="date" value={filters.dateTo} onChange={e => set("dateTo", e.target.value)} className="h-8 w-[130px] text-xs" />
            </div>

            <Input
              placeholder={t("searchEntities")}
              value={filters.search}
              onChange={e => set("search", e.target.value)}
              className="h-8 w-[180px] text-xs"
            />

            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
                onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}>
                <X className="h-3.5 w-3.5" /> {t("clear")}
              </Button>
            )}

            <div className="ml-auto">
              <Badge variant="secondary" className="text-xs font-mono">
                {total.toLocaleString()} {t("entries")}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" /> {t("loadingActivity")}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <ClipboardCheck className="h-10 w-10 opacity-20" />
              <p className="text-sm">{t("noActivityRecords")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs font-semibold w-[140px]">{t("timestamp")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("user")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("action")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("entityType")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("entityTitle")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("project_col")}</TableHead>
                    <TableHead className="text-xs font-semibold max-w-[180px]">{t("details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: any) => {
                    let detailSnippet = "";
                    try {
                      const d = typeof log.details === "string" ? JSON.parse(log.details) : log.details;
                      if (d && Object.keys(d).length > 0) {
                        detailSnippet = Object.entries(d)
                          .slice(0, 2)
                          .map(([k, v]) => `${k}: ${String(v).slice(0, 20)}`)
                          .join(", ");
                      }
                    } catch {}

                    return (
                      <TableRow
                        key={log.id}
                        className="cursor-pointer hover:bg-accent/40 transition-colors text-sm"
                        onClick={() => setSelectedLog(log)}
                      >
                        <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                          {fmtDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[110px]">{log.userName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <ActionBadge action={log.action} />
                        </TableCell>
                        <TableCell>
                          <EntityTypeBadge type={log.entityType} />
                        </TableCell>
                        <TableCell className="text-xs max-w-[160px] truncate" title={log.entityTitle ?? ""}>
                          {log.entityTitle ?? <span className="text-muted-foreground">ID: {log.entityId}</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {log.projectName ? (
                            <span className="flex items-center gap-1">
                              <FolderKanban className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[90px]">{log.projectName}</span>
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate font-mono" title={detailSnippet}>
                          {detailSnippet || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {!isLoading && logs.length > 0 && (
            <div className="px-4 pb-4">
              <Pagination page={page} totalPages={totalPages} total={total} perPage={PER_PAGE} onPage={setPage} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <LogDetailSheet item={selectedLog} open={!!selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}

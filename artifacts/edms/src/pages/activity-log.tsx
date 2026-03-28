import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import * as XLSX from "xlsx";

import { useI18n, type TranslationKeys } from "@/lib/i18n";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type TranslateFn = (key: TranslationKeys) => string;

interface AuditLogItem {
  id: number;
  createdAt: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  entityTitle: string | null;
  details: Record<string, unknown> | string | null;
  userId: number | null;
  projectId: number | null;
  userName: string;
  userEmail: string | null;
  projectName: string | null;
  projectCode: string | null;
}

interface LogsResponse {
  logs: AuditLogItem[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

interface Project {
  id: number;
  name: string;
  code: string;
}

interface OrgUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface LogFilters {
  projectId: string;
  entityType: string;
  action: string;
  userId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ["system_owner", "admin", "project_manager", "document_controller"] as const;

const ENTITY_TYPES = [
  "document", "correspondence", "transmittal", "ncr", "itr", "noc",
  "deliverable", "project", "user", "task", "workflow",
] as const;

const ACTIONS = [
  "create", "update", "delete", "approve", "reject", "upload",
  "submit", "workflow_approve", "workflow_reject", "workflow_submit", "share", "login",
] as const;

type EntityTypeKey = (typeof ENTITY_TYPES)[number];
type ActionKey = (typeof ACTIONS)[number];

// Maps action/entity slugs to their i18n translation keys
const ACTION_I18N: Record<ActionKey, TranslationKeys> = {
  create: "action_create",
  update: "action_update",
  delete: "action_delete",
  approve: "action_approve",
  reject: "action_reject",
  upload: "action_upload",
  submit: "action_submit",
  workflow_approve: "action_workflow_approve",
  workflow_reject: "action_workflow_reject",
  workflow_submit: "action_workflow_submit",
  share: "action_share",
  login: "action_login",
};

const ENTITY_I18N: Record<EntityTypeKey, TranslationKeys> = {
  document: "entity_document",
  correspondence: "entity_correspondence",
  transmittal: "entity_transmittal",
  ncr: "entity_ncr",
  itr: "entity_itr",
  noc: "entity_noc",
  deliverable: "entity_deliverable",
  project: "entity_project",
  user: "entity_user",
  task: "entity_task",
  workflow: "entity_workflow",
};

const ACTION_COLORS: Record<ActionKey | string, string> = {
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

const ENTITY_COLORS: Record<EntityTypeKey | string, string> = {
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

const DEFAULT_FILTERS: LogFilters = {
  projectId: "_all", entityType: "_all", action: "_all",
  userId: "_all", dateFrom: "", dateTo: "", search: "",
};

const PER_PAGE = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy HH:mm"); } catch { return d; }
}

function actionLabel(action: string, t: TranslateFn): string {
  const key = ACTION_I18N[action as ActionKey];
  return key ? t(key) : action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function entityLabel(type: string, t: TranslateFn): string {
  const key = ENTITY_I18N[type as EntityTypeKey];
  return key ? t(key) : type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function parseDetails(raw: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return raw;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionBadge({ action, t }: { action: string; t: TranslateFn }) {
  const cls = ACTION_COLORS[action] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {actionLabel(action, t)}
    </span>
  );
}

function EntityTypeBadge({ type, t }: { type: string; t: TranslateFn }) {
  const cls = ENTITY_COLORS[type] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {entityLabel(type, t)}
    </span>
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

function LogDetailSheet({ item, open, onClose, t }: {
  item: AuditLogItem | null; open: boolean; onClose: () => void; t: TranslateFn;
}) {
  if (!item) return null;
  const details = parseDetails(item.details);

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
            <Row
              label={t("user")}
              value={item.userName + (item.userEmail ? ` <${item.userEmail}>` : "")}
              icon={<User className="h-3.5 w-3.5" />}
            />
            <Row label={t("action")} value={<ActionBadge action={item.action} t={t} />} icon={<Activity className="h-3.5 w-3.5" />} />
            <Row label={t("entityType")} value={<EntityTypeBadge type={item.entityType} t={t} />} icon={<Info className="h-3.5 w-3.5" />} />
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

function Pagination({ page, totalPages, total, onPage }: {
  page: number; totalPages: number; total: number; onPage: (p: number) => void;
}) {
  const from = (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, total);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t pt-3 mt-2">
      <span className="text-xs text-muted-foreground">{from}–{to} / {total}</span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ActivityLogPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const hasAccess = user != null && (ALLOWED_ROLES as readonly string[]).includes(user.role);
  const isSysOwner = user?.role === "system_owner";

  const setFilter = (key: keyof LogFilters, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val }));
    setPage(1);
  };

  const hasFilters = Object.entries(filters).some(([k, v]) =>
    k === "search" ? v !== "" : v !== "_all" && v !== ""
  );

  const queryParams = useMemo(() => {
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

  const { data: logsData, isLoading, refetch } = useQuery<LogsResponse>({
    queryKey: ["activity-logs", queryParams],
    queryFn: async () => {
      const r = await fetch(`/api/audit-logs?${queryParams}`);
      if (!r.ok) throw new Error("Failed to load audit logs");
      return r.json() as Promise<LogsResponse>;
    },
    enabled: hasAccess,
  });

  const { data: projectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ["projects-list"],
    queryFn: async () => {
      const r = await fetch("/api/projects");
      return r.json() as Promise<{ projects: Project[] }>;
    },
    enabled: hasAccess,
  });

  const usersUrl = useMemo(() => {
    if (!hasAccess) return null;
    return isSysOwner || !user?.organizationId
      ? "/api/users"
      : `/api/users?organizationId=${user.organizationId}`;
  }, [hasAccess, isSysOwner, user?.organizationId]);

  const { data: usersData } = useQuery<OrgUser[] | { users: OrgUser[] }>({
    queryKey: ["activity-log-users", usersUrl],
    queryFn: async () => {
      const r = await fetch(usersUrl!);
      return r.json() as Promise<OrgUser[] | { users: OrgUser[] }>;
    },
    enabled: !!usersUrl,
  });

  const logs: AuditLogItem[] = logsData?.logs ?? [];
  const total: number = logsData?.total ?? 0;
  const totalPages: number = logsData?.totalPages ?? 1;
  const projects: Project[] = projectsData?.projects ?? [];
  const users: OrgUser[] = Array.isArray(usersData) ? usersData : (usersData?.users ?? []);

  // ─── Access Denied ─────────────────────────────────────────────────────────
  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-4">
        <ShieldOff className="h-12 w-12 opacity-30" />
        <p className="text-base font-medium">{isRtl ? "وصول مقيّد" : "Access Restricted"}</p>
        <p className="text-sm text-center max-w-sm">
          {isRtl
            ? "هذه الصفحة متاحة للمسؤولين ومديري المشاريع ومتحكمي المستندات فقط."
            : "This page is available to admins, project managers, and document controllers only."}
        </p>
      </div>
    );
  }

  // ─── Export Excel ──────────────────────────────────────────────────────────
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
      const json = await r.json() as { data: Array<Record<string, string | number>> };

      const rows = json.data.map(d => ({
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
      toast({ title: t("exportFailed"), variant: "destructive" });
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
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

            <Select value={filters.projectId} onValueChange={v => setFilter("projectId", v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t("allProjects")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allProjects")}</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.entityType} onValueChange={v => setFilter("entityType", v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t("allEntityTypes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allEntityTypes")}</SelectItem>
                {ENTITY_TYPES.map(et => (
                  <SelectItem key={et} value={et}>
                    {entityLabel(et, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.action} onValueChange={v => setFilter("action", v)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder={t("allActions")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allActions")}</SelectItem>
                {ACTIONS.map(a => (
                  <SelectItem key={a} value={a}>
                    {actionLabel(a, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.userId} onValueChange={v => setFilter("userId", v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t("allUsers")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">{t("allUsers")}</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Label className="text-xs shrink-0 text-muted-foreground">{t("dateFrom")}</Label>
              <Input
                type="date" value={filters.dateFrom}
                onChange={e => setFilter("dateFrom", e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-xs shrink-0 text-muted-foreground">{t("dateTo")}</Label>
              <Input
                type="date" value={filters.dateTo}
                onChange={e => setFilter("dateTo", e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
            </div>

            <Input
              placeholder={t("searchEntities")}
              value={filters.search}
              onChange={e => setFilter("search", e.target.value)}
              className="h-8 w-[180px] text-xs"
            />

            {hasFilters && (
              <Button
                variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
                onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}
              >
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
                  {logs.map(log => {
                    const details = parseDetails(log.details);
                    const detailSnippet = Object.entries(details)
                      .slice(0, 2)
                      .map(([k, v]) => `${k}: ${String(v).slice(0, 20)}`)
                      .join(", ");

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
                          <ActionBadge action={log.action} t={t} />
                        </TableCell>
                        <TableCell>
                          <EntityTypeBadge type={log.entityType} t={t} />
                        </TableCell>
                        <TableCell className="text-xs max-w-[160px] truncate" title={log.entityTitle ?? ""}>
                          {log.entityTitle ?? (
                            <span className="text-muted-foreground">ID: {log.entityId}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {log.projectName ? (
                            <span className="flex items-center gap-1">
                              <FolderKanban className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[90px]">{log.projectName}</span>
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground max-w-[180px] truncate font-mono"
                          title={detailSnippet}
                        >
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
              <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <LogDetailSheet item={selectedLog} open={selectedLog != null} onClose={() => setSelectedLog(null)} t={t} />
    </div>
  );
}

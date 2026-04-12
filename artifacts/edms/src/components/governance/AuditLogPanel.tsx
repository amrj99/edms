import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays } from "date-fns";
import {
  Search, Download, ChevronLeft, ChevronRight, Filter,
  Loader2, AlertCircle, Shield, FileText, Send, Mail,
  User, Settings, Activity, Globe, Server,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface AuditLogEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  entityTitle: string | null;
  projectId: number | null;
  projectName: string | null;
  projectCode: string | null;
  ipAddress: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  userName: string;
  userEmail: string | null;
}

interface ApiResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

interface Props {
  projectId?: number;
}

const ENTITY_TYPES = [
  { value: "_all", label: "All entity types" },
  { value: "document", label: "Document" },
  { value: "correspondence", label: "Correspondence" },
  { value: "transmittal", label: "Transmittal" },
  { value: "user", label: "User" },
  { value: "auth", label: "Auth" },
  { value: "workflow", label: "Workflow" },
  { value: "wf_instance", label: "WF Instance" },
  { value: "task", label: "Task" },
  { value: "project", label: "Project" },
  { value: "storage", label: "Storage" },
];

const ACTIONS = [
  { value: "_all", label: "All actions" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "login_success", label: "Login success" },
  { value: "login_failure", label: "Login failure" },
  { value: "workflow_advance", label: "Workflow advance" },
  { value: "workflow_approve", label: "Workflow approve" },
  { value: "workflow_reject", label: "Workflow reject" },
  { value: "upload", label: "Upload" },
  { value: "download", label: "Download" },
];

const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
];

function getEntityIcon(entityType: string | null) {
  switch (entityType) {
    case "document": return <FileText className="h-3.5 w-3.5" />;
    case "correspondence": return <Mail className="h-3.5 w-3.5" />;
    case "transmittal": return <Send className="h-3.5 w-3.5" />;
    case "user": return <User className="h-3.5 w-3.5" />;
    case "auth": return <Shield className="h-3.5 w-3.5" />;
    case "task": return <Activity className="h-3.5 w-3.5" />;
    case "project": return <Settings className="h-3.5 w-3.5" />;
    case "storage": return <Server className="h-3.5 w-3.5" />;
    default: return <Globe className="h-3.5 w-3.5" />;
  }
}

function ActionBadge({ action }: { action: string }) {
  let cls = "bg-slate-100 text-slate-600";
  if (action.startsWith("login_failure")) cls = "bg-red-100 text-red-700";
  else if (action.startsWith("login")) cls = "bg-green-100 text-green-700";
  else if (action === "create") cls = "bg-blue-100 text-blue-700";
  else if (action === "update") cls = "bg-amber-100 text-amber-700";
  else if (action === "delete") cls = "bg-red-100 text-red-700";
  else if (action.includes("approve")) cls = "bg-emerald-100 text-emerald-700";
  else if (action.includes("reject")) cls = "bg-red-100 text-red-700";
  else if (action.includes("upload") || action.includes("download")) cls = "bg-purple-100 text-purple-700";
  else if (action.includes("workflow")) cls = "bg-indigo-100 text-indigo-700";

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {action.replace(/_/g, " ")}
    </span>
  );
}

function fmtTs(ts: string) {
  try { return format(parseISO(ts), "dd MMM yyyy HH:mm:ss"); } catch { return ts; }
}

function buildParams(opts: {
  projectId?: number; entityType: string; action: string;
  search: string; page: number; dateFrom: string; dateTo: string; limit: number;
}): string {
  const p = new URLSearchParams();
  if (opts.projectId) p.set("projectId", String(opts.projectId));
  if (opts.entityType && opts.entityType !== "_all") p.set("entityType", opts.entityType);
  if (opts.action && opts.action !== "_all") p.set("action", opts.action);
  if (opts.search) p.set("search", opts.search);
  if (opts.dateFrom) p.set("dateFrom", opts.dateFrom);
  if (opts.dateTo) p.set("dateTo", opts.dateTo);
  p.set("page", String(opts.page));
  p.set("limit", String(opts.limit));
  return p.toString();
}

function datePresetToRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const today = fmt(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: fmt(subDays(now, 7)), to: today };
  if (preset === "30d") return { from: fmt(subDays(now, 30)), to: today };
  if (preset === "90d") return { from: fmt(subDays(now, 90)), to: today };
  return { from: "", to: "" };
}

export function AuditLogPanel({ projectId }: Props) {
  const [entityType, setEntityType] = useState("_all");
  const [action, setAction] = useState("_all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [datePreset, setDatePreset] = useState("30d");
  const [dateFrom, setDateFrom] = useState(() => datePresetToRange("30d").from);
  const [dateTo, setDateTo] = useState(() => datePresetToRange("30d").to);
  const LIMIT = 25;

  const queryParams = buildParams({ projectId, entityType, action, search, page, dateFrom, dateTo, limit: LIMIT });

  const { data, isLoading, isError, isFetching } = useQuery<ApiResponse>({
    queryKey: ["audit-logs", queryParams],
    queryFn: async () => {
      const r = await fetch(`/api/audit-logs?${queryParams}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    keepPreviousData: true,
  } as any);

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  const handlePreset = (preset: string) => {
    setDatePreset(preset);
    if (preset !== "custom") {
      const { from, to } = datePresetToRange(preset);
      setDateFrom(from);
      setDateTo(to);
      setPage(1);
    }
  };

  const handleEntityType = (v: string) => { setEntityType(v); setPage(1); };
  const handleAction = (v: string) => { setAction(v); setPage(1); };

  const exportUrl = `/api/audit-logs/export-xlsx?${buildParams({ projectId, entityType, action, search, page: 1, dateFrom, dateTo, limit: 10000 })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Audit Log</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data ? `${data.total.toLocaleString()} event${data.total !== 1 ? "s" : ""} found` : "System activity trail"}
          </p>
        </div>
        <a href={exportUrl} download>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
        </a>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="Search entity title or action…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
                className="h-9"
              />
              <Button size="sm" variant="secondary" onClick={handleSearch} className="gap-1.5 shrink-0">
                <Search className="h-3.5 w-3.5" /> Search
              </Button>
            </div>

            {/* Entity type */}
            <Select value={entityType} onValueChange={handleEntityType}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="Entity type" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Action */}
            <Select value={action} onValueChange={handleAction}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map(a => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date preset */}
            <Select value={datePreset} onValueChange={handlePreset}>
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Custom date range */}
            {datePreset === "custom" && (
              <>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                  className="h-9 w-[150px]"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPage(1); }}
                  className="h-9 w-[150px]"
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="py-16 text-center text-muted-foreground">
            <AlertCircle className="mx-auto h-6 w-6 mb-2" />
            <p className="text-sm">Failed to load audit log.</p>
          </div>
        ) : (data?.logs.length ?? 0) === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Activity className="mx-auto h-8 w-8 mb-3" />
            <p className="text-sm">No events match the current filters.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[170px]">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Title</TableHead>
                {!projectId && <TableHead>Project</TableHead>}
                <TableHead className="w-[120px]">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.logs ?? []).map((log) => (
                <TableRow key={log.id} className={isFetching ? "opacity-60" : ""}>
                  <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {fmtTs(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{log.userName}</span>
                      {log.userEmail && <span className="text-xs text-muted-foreground">{log.userEmail}</span>}
                    </div>
                  </TableCell>
                  <TableCell><ActionBadge action={log.action} /></TableCell>
                  <TableCell>
                    {log.entityType && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        {getEntityIcon(log.entityType)}
                        {log.entityType}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <span className="text-sm truncate block">{log.entityTitle ?? "—"}</span>
                  </TableCell>
                  {!projectId && (
                    <TableCell className="text-xs text-muted-foreground">
                      {log.projectCode ? (
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{log.projectCode}</span>
                      ) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-xs font-mono text-muted-foreground">{log.ipAddress ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data?.page} of {data?.totalPages} · {data?.total.toLocaleString()} events
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage(p => p - 1)}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={!data?.hasMore || isFetching}
              onClick={() => setPage(p => p + 1)}
              className="gap-1"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

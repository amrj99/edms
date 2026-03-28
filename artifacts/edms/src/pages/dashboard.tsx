import { useGetDashboard } from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  FileText, ClipboardCheck, Mail, CheckSquare, ArrowRight, Loader2, Clock,
  AlertCircle, TrendingUp, Activity, Send, FolderOpen, Upload, CheckCircle2,
  BrainCircuit, Zap, Settings2, GripVertical, X, Plus, ClipboardList,
  ShieldAlert, FileCheck, PenLine, Bell, RefreshCw, Building2,
} from "lucide-react";
import { format, isAfter, parseISO } from "date-fns";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n";

// ─── Constants ────────────────────────────────────────────────────────────────
const DOC_STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8", pending_review: "#f59e0b", in_review: "#3b82f6",
  approved: "#22c55e", rejected: "#ef4444", superseded: "#a855f7", issued: "#06b6d4",
};
const CORR_COLORS: Record<string, string> = {
  rfi: "#f59e0b", submittal: "#3b82f6", transmittal: "#8b5cf6", ncr: "#ef4444",
  letter: "#06b6d4", memo: "#22c55e", technical_query: "#f97316", email: "#64748b",
  internal: "#84cc16", notice: "#ec4899",
};
const ACTIVITY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  create_document: { icon: Upload, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-500/10" },
  approve: { icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50 dark:bg-green-500/10" },
  reject: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-500/10" },
  send_transmittal: { icon: Send, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-500/10" },
  share: { icon: Zap, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-500/10" },
  ai_check: { icon: BrainCircuit, color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-500/10" },
  create: { icon: FileText, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10" },
  update: { icon: Activity, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-500/10" },
  delete: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-50 dark:bg-red-500/10" },
};

// ─── All available widgets ─────────────────────────────────────────────────
const ALL_WIDGETS = [
  { id: "documents_by_status", label: "Documents by Status", icon: FileText },
  { id: "drawings_by_status", label: "Drawings by Status", icon: PenLine },
  { id: "project_portfolio", label: "Project Portfolio", icon: TrendingUp },
  { id: "open_itr", label: "Open ITR", icon: ClipboardList },
  { id: "open_ncr", label: "Open NCR / SOR", icon: ShieldAlert },
  { id: "noc_status", label: "NOC Status", icon: FileCheck },
  { id: "open_correspondence", label: "Open Correspondence", icon: Mail },
  { id: "overdue_items", label: "Overdue Items", icon: Clock },
  { id: "recent_documents", label: "Recent Documents", icon: FileText },
  { id: "my_tasks", label: "My Tasks", icon: CheckSquare },
  { id: "system_activity", label: "System Activity", icon: Activity },
  { id: "cross_org_stats", label: "Cross-Org Overview", icon: Building2 },
];

const DEFAULT_LAYOUT = [
  "documents_by_status", "project_portfolio", "overdue_items",
  "open_itr", "open_ncr", "noc_status",
  "open_correspondence", "recent_documents", "my_tasks", "system_activity",
  "drawings_by_status",
];

const STORAGE_KEY = "edms_dashboard_layout";

function loadLayout(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_LAYOUT;
}
function saveLayout(layout: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

// ─── Drag helpers ─────────────────────────────────────────────────────────────
function useDraggableList(initial: string[]) {
  const [items, setItems] = useState(initial);
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const onDragStart = (i: number) => { dragItem.current = i; };
  const onDragEnter = (i: number) => { dragOver.current = i; };
  const onDragEnd = () => {
    if (dragItem.current === null || dragOver.current === null) return;
    const next = [...items];
    const [moved] = next.splice(dragItem.current, 1);
    next.splice(dragOver.current, 0, moved);
    dragItem.current = null;
    dragOver.current = null;
    setItems(next);
    return next;
  };

  return { items, setItems, onDragStart, onDragEnter, onDragEnd };
}

// ─── Notification Alert Banner ────────────────────────────────────────────────
function AlertBanner({ summary }: { summary: any }) {
  const alerts = [
    summary.openNCR > 0 && { color: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200", icon: ShieldAlert, msg: `${summary.openNCR} open NCR/SOR`, href: "/reports" },
    summary.overdueCorrespondence > 0 && { color: "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-200", icon: Mail, msg: `${summary.overdueCorrespondence} overdue correspondence`, href: "/correspondence" },
    summary.openITR > 0 && { color: "bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/30 dark:border-yellow-800 dark:text-yellow-200", icon: ClipboardList, msg: `${summary.openITR} open inspection requests`, href: "/reports" },
    summary.pendingNOC > 0 && { color: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-200", icon: FileCheck, msg: `${summary.pendingNOC} pending NOC`, href: "/reports" },
  ].filter(Boolean) as any[];

  if (!alerts.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {alerts.map((a, i) => (
        <Link key={i} href={a.href}>
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${a.color}`}>
            <a.icon className="h-3.5 w-3.5 shrink-0" />
            {a.msg}
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── Individual Widgets ────────────────────────────────────────────────────────
function DocumentsByStatusWidget({ docs }: { docs: any[] }) {
  const countMap: Record<string, number> = {};
  docs.forEach(d => { const s = d.status || "draft"; countMap[s] = (countMap[s] || 0) + 1; });
  const data = Object.entries(countMap).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-3.5 w-3.5" />Documents by Status</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? <p className="text-xs text-muted-foreground text-center py-6">No documents yet</p> : (
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                {data.map(e => <Cell key={e.name} fill={DOC_STATUS_COLORS[e.name.replace(" ", "_")] ?? "#94a3b8"} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [v, String(n)]} />
              <Legend iconSize={8} formatter={v => <span className="text-xs">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function DrawingsByStatusWidget({ docs }: { docs: any[] }) {
  const drawings = docs.filter(d => ["drawing","dwg","plan","section","elevation","detail"].includes((d.documentType || "").toLowerCase()));
  const countMap: Record<string, number> = {};
  drawings.forEach(d => { const s = d.status || "draft"; countMap[s] = (countMap[s] || 0) + 1; });
  const data = Object.entries(countMap).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><PenLine className="h-3.5 w-3.5" />Drawings by Status</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? <p className="text-xs text-muted-foreground text-center py-6">No drawings yet</p> : (
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                {data.map(e => <Cell key={e.name} fill={DOC_STATUS_COLORS[e.name.replace(" ", "_")] ?? "#94a3b8"} />)}
              </Pie>
              <Tooltip />
              <Legend iconSize={8} formatter={v => <span className="text-xs">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectPortfolioWidget({ projects }: { projects: any[] }) {
  const statuses = [
    { status: "active", label: "Active", color: "bg-green-500" },
    { status: "on_hold", label: "On Hold", color: "bg-yellow-500" },
    { status: "completed", label: "Completed", color: "bg-blue-500" },
    { status: "cancelled", label: "Cancelled", color: "bg-gray-400" },
  ];
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5" />Project Portfolio</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {statuses.map(({ status, label, color }) => {
          const count = projects.filter((p: any) => p.status === status).length;
          const pct = projects.length > 0 ? Math.round((count / projects.length) * 100) : 0;
          return (
            <div key={status} className="space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium">{count} ({pct}%)</span></div>
              <Progress value={pct} className={`h-1.5 [&>div]:${color}`} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function OpenITRWidget({ summary }: { summary: any }) {
  return (
    <Card className={summary.openITR > 0 ? "border-yellow-300 dark:border-yellow-800" : ""}>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ClipboardList className="h-3.5 w-3.5 text-yellow-600" />Open ITR / MIR</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 mb-3">
          <span className={`text-3xl font-bold ${summary.openITR > 0 ? "text-yellow-600" : "text-muted-foreground"}`}>{summary.openITR}</span>
          <span className="text-xs text-muted-foreground mb-1">pending / in-progress</span>
        </div>
        <Link href="/reports"><Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1"><ArrowRight className="h-3 w-3" />View in Reports</Button></Link>
      </CardContent>
    </Card>
  );
}

function OpenNCRWidget({ summary }: { summary: any }) {
  return (
    <Card className={summary.openNCR > 0 ? "border-red-300 dark:border-red-800" : ""}>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="h-3.5 w-3.5 text-red-600" />Open NCR / SOR</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 mb-3">
          <span className={`text-3xl font-bold ${summary.openNCR > 0 ? "text-red-600" : "text-muted-foreground"}`}>{summary.openNCR}</span>
          <span className="text-xs text-muted-foreground mb-1">open / in-progress</span>
        </div>
        <Link href="/reports"><Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1"><ArrowRight className="h-3 w-3" />View in Reports</Button></Link>
      </CardContent>
    </Card>
  );
}

function NocStatusWidget({ summary }: { summary: any }) {
  return (
    <Card className={summary.pendingNOC > 0 ? "border-blue-300 dark:border-blue-800" : ""}>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileCheck className="h-3.5 w-3.5 text-blue-600" />NOC Status</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 mb-3">
          <span className={`text-3xl font-bold ${summary.pendingNOC > 0 ? "text-blue-600" : "text-muted-foreground"}`}>{summary.pendingNOC}</span>
          <span className="text-xs text-muted-foreground mb-1">pending approval</span>
        </div>
        <Link href="/reports"><Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1"><ArrowRight className="h-3 w-3" />View in Reports</Button></Link>
      </CardContent>
    </Card>
  );
}

function OpenCorrespondenceWidget({ correspondence }: { correspondence: any[] }) {
  const open = correspondence.filter((c: any) => c.status !== "closed" && c.status !== "acknowledged");
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><Mail className="h-3.5 w-3.5" />Open Correspondence</CardTitle>
        <Badge variant="secondary" className="text-xs">{open.length}</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {open.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">Inbox clear</p> :
            open.slice(0, 6).map((c: any) => (
              <Link key={c.id} href={`/projects/${c.projectId}`}>
                <div className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <span className="font-mono text-muted-foreground shrink-0">{c.referenceNumber || `COR-${c.id}`}</span>
                  <span className="truncate flex-1">{c.subject}</span>
                  <span className="capitalize shrink-0 text-muted-foreground">{c.status}</span>
                </div>
              </Link>
            ))
          }
        </div>
        <Link href="/correspondence"><Button variant="ghost" size="sm" className="w-full mt-2 h-7 text-xs">View All <ArrowRight className="ml-1 h-3 w-3" /></Button></Link>
      </CardContent>
    </Card>
  );
}

function OverdueItemsWidget({ tasks, correspondence }: { tasks: any[]; correspondence: any[] }) {
  const overdueTasks = tasks.filter((t: any) => t.dueDate && isAfter(new Date(), parseISO(t.dueDate)) && t.status !== "completed");
  const overdueCorr = correspondence.filter((c: any) => c.dueDate && isAfter(new Date(), parseISO(c.dueDate)) && c.status !== "closed");
  const total = overdueTasks.length + overdueCorr.length;
  return (
    <Card className={total > 0 ? "border-orange-300 dark:border-orange-800" : ""}>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-orange-500" />Overdue Items</CardTitle></CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="flex flex-col items-center py-4 text-muted-foreground gap-1">
            <CheckCircle2 className="h-6 w-6 opacity-40" />
            <p className="text-xs">All caught up!</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {overdueTasks.slice(0, 3).map((t: any) => (
              <div key={`t-${t.id}`} className="flex items-center gap-2 p-1.5 rounded bg-red-50 dark:bg-red-950/20 border border-red-200/50">
                <CheckSquare className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <span className="text-xs truncate">{t.title}</span>
                <span className="text-xs text-red-500 shrink-0">{format(parseISO(t.dueDate), "dd MMM")}</span>
              </div>
            ))}
            {overdueCorr.slice(0, 3).map((c: any) => (
              <div key={`c-${c.id}`} className="flex items-center gap-2 p-1.5 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200/50">
                <Mail className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                <span className="text-xs truncate">{c.subject}</span>
                <span className="text-xs text-orange-500 shrink-0">{format(parseISO(c.dueDate), "dd MMM")}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentDocumentsWidget({ docs }: { docs: any[] }) {
  return (
    <Card className="col-span-2">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-3.5 w-3.5" />Recent Documents</CardTitle>
        <Link href="/documents"><Button variant="ghost" size="sm" className="h-7 text-xs">View all <ArrowRight className="ml-1 h-3 w-3" /></Button></Link>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {docs.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No documents yet</p> :
            docs.slice(0, 6).map((doc: any) => (
              <Link key={doc.id} href={`/projects/${doc.projectId}`}>
                <div className="flex items-center gap-3 p-2 rounded hover:bg-muted/40 cursor-pointer">
                  <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-medium shrink-0">
                    {(doc.documentType ?? "DOC").slice(0, 3).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{doc.title}</p>
                    <p className="text-xs text-muted-foreground font-mono">{doc.documentNumber}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs capitalize shrink-0">{(doc.status ?? "draft").replace("_", " ")}</Badge>
                </div>
              </Link>
            ))
          }
        </div>
      </CardContent>
    </Card>
  );
}

function MyTasksWidget({ tasks }: { tasks: any[] }) {
  const pending = tasks.filter((t: any) => t.status !== "completed").slice(0, 6);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckSquare className="h-3.5 w-3.5" />My Tasks</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {pending.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">All done!</p> :
            pending.map((t: any) => {
              const overdue = t.dueDate && isAfter(new Date(), parseISO(t.dueDate));
              return (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <CheckSquare className={`h-3.5 w-3.5 shrink-0 ${overdue ? "text-red-500" : "text-muted-foreground"}`} />
                  <span className="flex-1 truncate">{t.title}</span>
                  {t.dueDate && <span className={`shrink-0 ${overdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>{format(parseISO(t.dueDate), "dd MMM")}</span>}
                </div>
              );
            })
          }
        </div>
        <Link href="/tasks"><Button variant="ghost" size="sm" className="w-full mt-2 h-7 text-xs">View all tasks <ArrowRight className="ml-1 h-3 w-3" /></Button></Link>
      </CardContent>
    </Card>
  );
}

function SystemActivityWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: async () => { const r = await fetch("/api/audit-logs?limit=15"); return r.json(); },
    refetchInterval: 30000,
  });
  const logs: any[] = data?.logs ?? data?.items ?? [];
  return (
    <Card className="col-span-2">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-3.5 w-3.5" />System Activity</CardTitle>
        <Link href="/admin"><Button variant="ghost" size="sm" className="h-7 text-xs">Audit log <ArrowRight className="ml-1 h-3 w-3" /></Button></Link>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div> :
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {logs.map((log: any, i) => {
              const key = log.action === "create" && log.entityType === "document" ? "create_document"
                : log.action === "send" && log.entityType === "transmittal" ? "send_transmittal" : log.action;
              const { icon: Icon, color, bg } = ACTIVITY_ICONS[key] ?? { icon: Activity, color: "text-muted-foreground", bg: "bg-muted" };
              return (
                <div key={log.id ?? i} className="flex items-start gap-2">
                  <div className={`h-6 w-6 rounded ${bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`h-3 w-3 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{log.entityTitle || `${log.action} ${log.entityType}`.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">{log.userName ? `${log.userName} · ` : ""}{log.createdAt ? format(new Date(log.createdAt), "MMM d, HH:mm") : ""}</p>
                  </div>
                </div>
              );
            })}
          </div>
        }
      </CardContent>
    </Card>
  );
}

// ─── Cross-Org Stats Widget (system_owner only) ───────────────────────────────
function CrossOrgStatsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["cross-org-stats"],
    queryFn: async () => { const r = await fetch("/api/organizations/cross-org-stats"); return r.json(); },
    refetchInterval: 60000,
  });
  const stats: any[] = data?.stats ?? [];

  return (
    <Card className="col-span-2">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-primary" />Cross-Organization Overview</CardTitle>
          <CardDescription className="text-xs">Project and document counts per organization</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : stats.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No organizations found</p>
        ) : (
          <div className="space-y-2 max-h-[240px] overflow-y-auto">
            {stats.map((o: any) => (
              <div key={o.id} className="grid grid-cols-[1fr_80px_80px_80px] items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/40">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-3 w-3 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{o.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{o.type}</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold">{o.projectCount}</p>
                  <p className="text-[10px] text-muted-foreground">Projects</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold">{o.documentCount}</p>
                  <p className="text-[10px] text-muted-foreground">Docs</p>
                </div>
                <div className="text-center">
                  <p className={`text-sm font-bold ${o.openNcrCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{o.openNcrCount}</p>
                  <p className="text-[10px] text-muted-foreground">Open NCR</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <Link href="/organizations"><Button variant="ghost" size="sm" className="w-full mt-2 h-7 text-xs">Manage Organizations <ArrowRight className="ml-1 h-3 w-3" /></Button></Link>
      </CardContent>
    </Card>
  );
}

// ─── Widget Renderer ──────────────────────────────────────────────────────────
function WidgetRenderer({ id, data }: { id: string; data: any }) {
  switch (id) {
    case "documents_by_status": return <DocumentsByStatusWidget docs={data.recentDocuments} />;
    case "drawings_by_status": return <DrawingsByStatusWidget docs={data.globalDocs} />;
    case "project_portfolio": return <ProjectPortfolioWidget projects={data.projects} />;
    case "open_itr": return <OpenITRWidget summary={data.summary} />;
    case "open_ncr": return <OpenNCRWidget summary={data.summary} />;
    case "noc_status": return <NocStatusWidget summary={data.summary} />;
    case "open_correspondence": return <OpenCorrespondenceWidget correspondence={data.unreadCorrespondence} />;
    case "overdue_items": return <OverdueItemsWidget tasks={data.myTasks} correspondence={data.unreadCorrespondence} />;
    case "recent_documents": return <RecentDocumentsWidget docs={data.recentDocuments} />;
    case "my_tasks": return <MyTasksWidget tasks={data.myTasks} />;
    case "system_activity": return <SystemActivityWidget />;
    case "cross_org_stats": return data.isSysAdmin ? <CrossOrgStatsWidget /> : null;
    default: return null;
  }
}

// ─── Customize Panel ──────────────────────────────────────────────────────────
function CustomizePanel({
  open, onClose, layout, onSave,
}: {
  open: boolean; onClose: () => void; layout: string[]; onSave: (l: string[]) => void;
}) {
  const drag = useDraggableList(layout);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(layout));

  const toggle = (id: string) => {
    setEnabled(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleSave = () => {
    const ordered = drag.items.filter(id => enabled.has(id));
    ALL_WIDGETS.filter(w => enabled.has(w.id) && !drag.items.includes(w.id)).forEach(w => ordered.push(w.id));
    onSave(ordered);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[360px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4" />Customize Dashboard</SheetTitle>
          <SheetDescription>Toggle widgets on/off and drag to reorder</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-4 space-y-1">
          {drag.items.map((id, i) => {
            const w = ALL_WIDGETS.find(w => w.id === id);
            if (!w) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={() => drag.onDragStart(i)}
                onDragEnter={() => drag.onDragEnter(i)}
                onDragEnd={() => { const nl = drag.onDragEnd(); if (nl) {} }}
                className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-muted/40 cursor-grab active:cursor-grabbing select-none"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <w.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm">{w.label}</span>
                <Switch checked={enabled.has(id)} onCheckedChange={() => toggle(id)} />
              </div>
            );
          })}
          {ALL_WIDGETS.filter(w => !drag.items.includes(w.id)).map(w => (
            <div key={w.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-card opacity-60">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <w.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm">{w.label}</span>
              <Switch checked={enabled.has(w.id)} onCheckedChange={() => toggle(w.id)} />
            </div>
          ))}
        </div>
        <div className="border-t pt-3 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave}>Save Layout</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { isRtl } = useI18n();
  const { user } = useAuth();
  const { data, isLoading, error } = useGetDashboard();
  const [layout, setLayout] = useState<string[]>(() => loadLayout());
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects = projectsData?.projects ?? [];

  const { data: summaryData, refetch: refetchSummary } = useQuery({
    queryKey: ["notif-summary"],
    queryFn: async () => { const r = await fetch("/api/notifications/summary"); return r.json(); },
    refetchInterval: 60000,
  });
  const summary = summaryData ?? { openITR: 0, openNCR: 0, pendingNOC: 0, overdueCorrespondence: 0, newRevisions: 0 };

  const { data: globalDocsData } = useQuery({
    queryKey: ["global-docs-dash"],
    queryFn: async () => { const r = await fetch("/api/documents?limit=500"); return r.json(); },
  });
  const globalDocs = globalDocsData?.documents ?? [];

  const handleSaveLayout = (newLayout: string[]) => {
    setLayout(newLayout);
    saveLayout(newLayout);
    fetch("/api/user/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboardLayout: newLayout }),
    }).catch(() => {});
  };

  if (isLoading) return (
    <div className="flex h-[50vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (error || !data) return (
    <div className="flex h-[50vh] flex-col items-center justify-center text-center">
      <AlertCircle className="h-12 w-12 text-destructive mb-4" />
      <h2 className="text-2xl font-bold">Failed to load dashboard</h2>
    </div>
  );

  const { stats, recentDocuments, pendingApprovals, myTasks, unreadCorrespondence } = data;
  const overdueTasks = myTasks.filter((t: any) => t.dueDate && isAfter(new Date(), parseISO(t.dueDate)) && t.status !== "completed");

  const statCards = [
    { title: "Total Documents", value: stats.totalDocuments, icon: FileText, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10", sub: `+${stats.documentsThisMonth} this month` },
    { title: "Pending Approvals", value: stats.pendingApprovals, icon: ClipboardCheck, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-500/10" },
    { title: "Open Tasks", value: stats.openTasks, icon: CheckSquare, color: "text-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-500/10", sub: overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : undefined },
    { title: "Active Projects", value: projects.filter((p: any) => p.status === "active").length, icon: FolderOpen, color: "text-green-500", bg: "bg-green-50 dark:bg-green-500/10" },
  ];

  const isSysAdmin = user?.role === "system_owner" || user?.role === "admin";

  const widgetData = {
    recentDocuments,
    globalDocs,
    projects,
    myTasks,
    unreadCorrespondence,
    summary,
    isSysAdmin,
  };

  return (
    <div className={`space-y-5 animate-in fade-in duration-500 ${isRtl ? "font-[Tahoma,Arial,sans-serif]" : ""}`}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 flex-wrap ${isRtl ? "flex-row-reverse" : ""}`}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here's what's happening across your projects today.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetchSummary()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setCustomizeOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Customize
          </Button>
        </div>
      </div>

      {/* KPI Stat Cards — always visible */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat, i) => (
          <Card key={i} className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground">{stat.title}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
                {stat.sub && <p className="text-xs text-muted-foreground">{stat.sub}</p>}
              </div>
              <div className={`h-10 w-10 rounded-xl ${stat.bg} flex items-center justify-center shrink-0`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alert Banner */}
      {(summary.openNCR > 0 || summary.overdueCorrespondence > 0 || summary.openITR > 0 || summary.pendingNOC > 0) && (
        <AlertBanner summary={summary} />
      )}

      {/* Configurable Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-min">
        {layout.map(id => (
          <WidgetRenderer key={id} id={id} data={widgetData} />
        ))}
      </div>

      {layout.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Settings2 className="h-10 w-10 opacity-30" />
          <p className="text-sm">No widgets visible. Click <strong>Customize</strong> to add widgets.</p>
        </div>
      )}

      <CustomizePanel
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        layout={layout}
        onSave={handleSaveLayout}
      />
    </div>
  );
}

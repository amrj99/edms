import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  FileText, AlertCircle, CheckSquare, Calendar, Mail, ClipboardList,
  TrendingUp, Loader2, RefreshCw, BarChart3,
} from "lucide-react";

const DOC_STATUS_COLORS: Record<string, string> = {
  draft:      "#94a3b8",
  in_review:  "#60a5fa",
  approved:   "#34d399",
  issued:     "#a78bfa",
  superseded: "#fb923c",
  archived:   "#e2e8f0",
};

const DELIVERABLE_STATUS_COLORS: Record<string, string> = {
  not_started: "#94a3b8",
  in_progress: "#60a5fa",
  submitted:   "#fbbf24",
  approved:    "#34d399",
  rejected:    "#f87171",
  closed:      "#a78bfa",
};

function SummaryCard({ icon: Icon, label, value, sub, color }: any) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
      <div className={`rounded-lg p-2.5 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function WidgetCard({ title, icon: Icon, children, className = "" }: any) {
  return (
    <div className={`rounded-xl border bg-card overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const CHART_COLORS = ["#6366f1","#22d3ee","#f59e0b","#34d399","#f87171","#a78bfa","#fb923c"];

export default function ReportsDashboard() {
  const [projectFilter, setProjectFilter] = useState("_all");

  const { data: projectsData } = useQuery({
    queryKey: ["projects-list-reports"],
    queryFn: async () => {
      const r = await fetch("/api/projects", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const params = projectFilter !== "_all" ? `?projectId=${projectFilter}` : "";
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["reports-summary", projectFilter],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard/reports${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const projects: any[] = projectsData?.items ?? [];
  const summary = data?.summary ?? {};

  // Build doc status chart data
  const docsByStatus = (data?.documentsByStatus ?? []).map((r: any) => ({
    name: (r.status ?? "unknown").replace(/_/g, " "),
    value: Number(r.cnt),
    status: r.status,
  }));

  // Deliverables donut
  const delData = Object.entries(data?.deliverablesProgress ?? {}).map(([status, cnt]) => ({
    name: status.replace(/_/g, " "),
    value: cnt as number,
    status,
  }));
  const delTotal = data?.totalDeliverables ?? 0;
  const delComplete = data?.summary?.completedDeliverables ?? 0;
  const delPct = delTotal > 0 ? Math.round((delComplete / delTotal) * 100) : 0;

  // Meetings this week
  const meetingsThisWeek: any[] = data?.meetingsThisWeek ?? [];

  // Correspondence volume line chart
  const corrVolume: any[] = (data?.correspondenceVolume ?? []).map((r: any) => ({
    ...r,
    date: (() => { try { return format(parseISO(r.date), "EEE dd"); } catch { return r.date; } })(),
  }));

  // Open NCRs
  const openNcrs: any[] = data?.openNcrs ?? [];

  // Overdue action items
  const overdueItems: any[] = data?.overdueActionItems ?? [];

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-background shrink-0">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Reports Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Key metrics and KPIs across your organization
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="h-8 w-52 text-sm">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Projects</SelectItem>
                {projects.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code} – {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <SummaryCard
              icon={FileText}
              label="Total Documents"
              value={summary.totalDocuments ?? 0}
              color="bg-blue-50 text-blue-600"
            />
            <SummaryCard
              icon={AlertCircle}
              label="Open NCRs"
              value={summary.openNcrCount ?? 0}
              color="bg-orange-50 text-orange-600"
            />
            <SummaryCard
              icon={CheckSquare}
              label="Overdue Actions"
              value={summary.overdueActionItemCount ?? 0}
              color="bg-red-50 text-red-600"
            />
            <SummaryCard
              icon={Calendar}
              label="Meetings This Week"
              value={summary.meetingsThisWeekCount ?? 0}
              color="bg-purple-50 text-purple-600"
            />
            <SummaryCard
              icon={ClipboardList}
              label="Total Deliverables"
              value={summary.totalDeliverables ?? 0}
              sub={`${delPct}% complete`}
              color="bg-green-50 text-green-600"
            />
            <SummaryCard
              icon={TrendingUp}
              label="Completed Deliverables"
              value={summary.completedDeliverables ?? 0}
              color="bg-violet-50 text-violet-600"
            />
          </div>

          {/* Widgets row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Widget 1: Documents by Status */}
            <WidgetCard title="Documents by Status" icon={FileText}>
              {docsByStatus.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No documents</div>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie
                        data={docsByStatus}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                      >
                        {docsByStatus.map((entry: any, idx: number) => (
                          <Cell key={idx} fill={DOC_STATUS_COLORS[entry.status] ?? CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any, n: any) => [v, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {docsByStatus.map((d: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ background: DOC_STATUS_COLORS[d.status] ?? CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                          <span className="text-xs capitalize">{d.name}</span>
                        </div>
                        <span className="text-xs font-semibold">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </WidgetCard>

            {/* Widget 2: Deliverables Progress */}
            <WidgetCard title="Deliverables Progress" icon={ClipboardList}>
              {delData.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No deliverables</div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie data={delData} dataKey="value" cx="50%" cy="50%" innerRadius={38} outerRadius={56} paddingAngle={2}>
                          {delData.map((d: any, i: number) => (
                            <Cell key={i} fill={DELIVERABLE_STATUS_COLORS[d.status] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-bold">{delPct}%</span>
                      <span className="text-[10px] text-muted-foreground">done</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {delData.map((d: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ background: DELIVERABLE_STATUS_COLORS[d.status] ?? CHART_COLORS[i] }}
                          />
                          <span className="text-xs capitalize">{d.name}</span>
                        </div>
                        <span className="text-xs font-semibold">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </WidgetCard>
          </div>

          {/* Widgets row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Widget 3: Correspondence Volume (last 7 days) */}
            <WidgetCard title="Correspondence Volume — Last 7 Days" icon={Mail}>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={corrVolume} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="corrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" name="Correspondence" stroke="#6366f1" fill="url(#corrGrad)" strokeWidth={2} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </WidgetCard>

            {/* Widget 4: Meetings This Week */}
            <WidgetCard title="Meetings This Week" icon={Calendar}>
              {meetingsThisWeek.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No meetings scheduled this week</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {meetingsThisWeek.map((m: any) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border p-2.5 bg-muted/20">
                      <div className="rounded-md bg-primary/10 p-1.5 shrink-0">
                        <Calendar className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          {format(new Date(m.meetingDate), "EEE d MMM · HH:mm")}
                          {m.projectName && <> · <span className="font-mono">{m.projectCode}</span></>}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="capitalize text-xs shrink-0"
                      >
                        {m.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </WidgetCard>
          </div>

          {/* Widgets row 3 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Widget 5: Open NCRs */}
            <WidgetCard title="Open NCRs / Non-Conformances" icon={AlertCircle}>
              {openNcrs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No open NCRs</div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {openNcrs.map((ncr: any) => (
                    <div key={ncr.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                      <AlertCircle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ncr.title || ncr.referenceNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {ncr.referenceNumber} · {format(new Date(ncr.createdAt), "dd MMM yyyy")}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-xs capitalize shrink-0 ${ncr.status === "open" ? "border-orange-300 text-orange-700 bg-orange-50" : "border-blue-300 text-blue-700 bg-blue-50"}`}
                      >
                        {ncr.status?.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </WidgetCard>

            {/* Widget 6: Overdue Action Items */}
            <WidgetCard title="Overdue Action Items" icon={CheckSquare}>
              {overdueItems.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  <span className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-green-500" />
                    No overdue action items
                  </span>
                </div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {overdueItems.slice(0, 10).map((item: any) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/30 p-2.5">
                      <div className="h-2 w-2 rounded-full bg-red-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.assignedToName && <>{item.assignedToName} · </>}
                          Due {item.dueDate ? format(new Date(item.dueDate), "dd MMM yyyy") : "unknown"}
                          {item.meetingRef && <> · {item.meetingRef}</>}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-xs shrink-0 ${
                          item.priority === "critical" ? "border-red-400 text-red-700 bg-red-50"
                          : item.priority === "high" ? "border-orange-400 text-orange-700 bg-orange-50"
                          : "border-slate-300 text-slate-700"
                        }`}
                      >
                        {item.priority ?? "medium"}
                      </Badge>
                    </div>
                  ))}
                  {overdueItems.length > 10 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      +{overdueItems.length - 10} more — see Action Items tracker
                    </p>
                  )}
                </div>
              )}
            </WidgetCard>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

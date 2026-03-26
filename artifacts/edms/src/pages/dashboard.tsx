import { useGetDashboard } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  FileText, 
  ClipboardCheck, 
  Mail, 
  CheckSquare, 
  ArrowRight,
  Loader2,
  Clock,
  AlertCircle,
  TrendingUp,
  Activity,
  Send,
  FolderOpen,
  Upload,
  CheckCircle2,
  BrainCircuit,
  Zap,
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

const DOC_STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  pending_review: "#f59e0b",
  in_review: "#3b82f6",
  approved: "#22c55e",
  rejected: "#ef4444",
  superseded: "#a855f7",
  issued: "#06b6d4",
};

const CORR_COLORS: Record<string, string> = {
  rfi: "#f59e0b",
  submittal: "#3b82f6",
  transmittal: "#8b5cf6",
  ncr: "#ef4444",
  letter: "#06b6d4",
  memo: "#22c55e",
  technical_query: "#f97316",
  email: "#64748b",
  internal: "#84cc16",
  notice: "#ec4899",
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

function getActivityIcon(action: string, entityType: string) {
  const key = action === "create" && entityType === "document" ? "create_document"
    : action === "send" && entityType === "transmittal" ? "send_transmittal"
    : action;
  return ACTIVITY_ICONS[key] ?? { icon: Activity, color: "text-muted-foreground", bg: "bg-muted" };
}

function SystemActivityFeed() {
  const { data, isLoading } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: async () => {
      const r = await fetch("/api/audit-logs?limit=20");
      return r.json();
    },
    refetchInterval: 30000,
  });
  const logs: any[] = data?.logs ?? data?.items ?? [];

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />System Activity</CardTitle>
          <CardDescription>Recent actions across all projects</CardDescription>
        </div>
        <Link href="/admin" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
          View audit log <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">No activity recorded yet.</div>
        ) : (
          <div className="space-y-2">
            {logs.slice(0, 12).map((log: any, i: number) => {
              const { icon: Icon, color, bg } = getActivityIcon(log.action, log.entityType);
              const label = `${log.action} ${log.entityType}`.replace(/_/g, " ");
              return (
                <div key={log.id ?? i} className="flex items-start gap-3 group">
                  <div className={`h-7 w-7 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon className={`h-3.5 w-3.5 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-medium capitalize truncate">{log.entityTitle || label}</p>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {log.createdAt ? format(new Date(log.createdAt), "MMM d, HH:mm") : ""}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">
                      {label}{log.userName ? ` · ${log.userName}` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniStatCard({ title, value, icon: Icon, color, bg, sub }: {
  title: string; value: number | string; icon: any; color: string; bg: string; sub?: string;
}) {
  return (
    <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-6 flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold text-foreground">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className={`h-12 w-12 rounded-xl ${bg} flex items-center justify-center`}>
          <Icon className={`h-6 w-6 ${color}`} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data, isLoading, error } = useGetDashboard();

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const r = await fetch("/api/projects");
      return r.json();
    },
  });
  const projects = projectsData?.projects ?? [];

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-bold">Failed to load dashboard</h2>
        <p className="text-muted-foreground mt-2">There was a problem loading your overview.</p>
      </div>
    );
  }

  const { stats, recentDocuments, pendingApprovals, myTasks, unreadCorrespondence } = data;

  // Build document status distribution data
  const docStatusCount: Record<string, number> = {};
  recentDocuments.forEach((doc: any) => {
    const s = doc.status || "draft";
    docStatusCount[s] = (docStatusCount[s] || 0) + 1;
  });
  const docStatusData = Object.entries(docStatusCount).map(([name, value]) => ({ name: name.replace("_", " "), value }));

  // Project activity data
  const projectActivity = projects.slice(0, 6).map((p: any) => ({
    name: p.code || p.name.slice(0, 8),
    status: p.status,
  }));

  // Overdue tasks
  const overdueTasks = myTasks.filter((t: any) => t.dueDate && isAfter(new Date(), parseISO(t.dueDate)) && t.status !== "completed");

  // Correspondence by type chart data
  const corrTypeCount: Record<string, number> = {};
  unreadCorrespondence.forEach((c: any) => {
    corrTypeCount[c.type] = (corrTypeCount[c.type] || 0) + 1;
  });
  const corrChartData = Object.entries(corrTypeCount).map(([name, value]) => ({ name: name.toUpperCase(), value }));

  const statCards = [
    { title: "Total Documents", value: stats.totalDocuments, icon: FileText, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10", sub: `+${stats.documentsThisMonth} this month` },
    { title: "Pending Approvals", value: stats.pendingApprovals, icon: ClipboardCheck, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-500/10" },
    { title: "Open Tasks", value: stats.openTasks, icon: CheckSquare, color: "text-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-500/10", sub: overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : undefined },
    { title: "Active Projects", value: projects.filter((p: any) => p.status === "active").length, icon: FolderOpen, color: "text-green-500", bg: "bg-green-50 dark:bg-green-500/10" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Overview</h1>
        <p className="text-muted-foreground mt-1">Here's what's happening across your projects today.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat, i) => (
          <MiniStatCard key={i} {...stat} />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Document Status Chart */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Document Status
            </CardTitle>
            <CardDescription>Recent document distribution by status</CardDescription>
          </CardHeader>
          <CardContent>
            {docStatusData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No documents yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={docStatusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value">
                    {docStatusData.map((entry) => (
                      <Cell key={entry.name} fill={DOC_STATUS_COLORS[entry.name.replace(" ", "_")] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, String(n).replace("_", " ")]} />
                  <Legend formatter={(v) => v.replace("_", " ")} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Projects Overview */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Project Portfolio
            </CardTitle>
            <CardDescription>Active vs on-hold vs completed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { status: "active", label: "Active", color: "bg-green-500" },
              { status: "on_hold", label: "On Hold", color: "bg-yellow-500" },
              { status: "completed", label: "Completed", color: "bg-blue-500" },
              { status: "cancelled", label: "Cancelled", color: "bg-gray-400" },
            ].map(({ status, label, color }) => {
              const count = projects.filter((p: any) => p.status === status).length;
              const pct = projects.length > 0 ? Math.round((count / projects.length) * 100) : 0;
              return (
                <div key={status} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{count} ({pct}%)</span>
                  </div>
                  <Progress value={pct} className={`h-2 [&>div]:${color}`} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Overdue Tasks or Correspondence Metrics */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Overdue Items
            </CardTitle>
            <CardDescription>Tasks and correspondence past due date</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {overdueTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                <CheckSquare className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No overdue items</p>
              </div>
            ) : (
              overdueTasks.slice(0, 5).map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded border border-red-200 bg-red-50 dark:bg-red-950/20">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{t.title}</p>
                    <p className="text-xs text-red-500">Due {format(parseISO(t.dueDate), "dd MMM")}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity Feed */}
      <SystemActivityFeed />

      {/* Bottom row */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Documents */}
        <Card className="lg:col-span-4 border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Recent Documents</CardTitle>
              <CardDescription>Latest documents uploaded to your projects.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/search?type=document">View all <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentDocuments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No recent documents.</div>
              ) : (
                recentDocuments.map((doc: any) => (
                  <Link key={doc.id} href={`/projects/${doc.projectId}`} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center text-primary font-medium text-xs">
                        {doc.documentType?.slice(0, 3).toUpperCase() || 'DOC'}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground line-clamp-1">{doc.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <span className="font-mono">{doc.documentNumber}</span>
                          <span>•</span>
                          <span>Rev {doc.revision ?? "0"}</span>
                          {doc.discipline && <><span>•</span><span>{doc.discipline}</span></>}
                        </div>
                      </div>
                    </div>
                    <Badge variant={doc.status === 'approved' ? 'default' : 'secondary'} className="capitalize">
                      {(doc.status ?? "draft").replace('_', ' ')}
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tasks & Correspondence Column */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckSquare className="h-4 w-4" />
                My Pending Tasks
                {overdueTasks.length > 0 && (
                  <Badge variant="destructive" className="text-xs">{overdueTasks.length} overdue</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {myTasks.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">All caught up!</div>
                ) : (
                  myTasks.slice(0, 5).map((task: any) => {
                    const isOverdue = task.dueDate && isAfter(new Date(), parseISO(task.dueDate));
                    return (
                      <div key={task.id} className={`flex items-start gap-3 group p-2 rounded-lg ${isOverdue ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                        <div className="mt-0.5">
                          <CheckSquare className={`h-4 w-4 ${isOverdue ? "text-red-500" : "text-muted-foreground"} group-hover:text-primary transition-colors`} />
                        </div>
                        <div className="flex-1 space-y-1">
                          <Link href={`/tasks`} className="font-medium text-sm hover:underline">{task.title}</Link>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {task.dueDate && (
                              <span className={`flex items-center gap-1 ${isOverdue ? "text-red-500 font-medium" : "text-orange-500"}`}>
                                <Clock className="h-3 w-3" />
                                {format(parseISO(task.dueDate), 'MMM d')}
                              </span>
                            )}
                            <span>{task.projectName}</span>
                          </div>
                        </div>
                        <Badge variant={task.priority === "urgent" ? "destructive" : "outline"} className="text-xs capitalize">
                          {task.priority}
                        </Badge>
                      </div>
                    );
                  })
                )}
                {myTasks.length > 0 && (
                  <Button variant="ghost" size="sm" className="w-full mt-1" asChild>
                    <Link href="/tasks">View all tasks <ArrowRight className="ml-1 h-3 w-3" /></Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Unread Correspondence
              </CardTitle>
              <Badge variant="destructive">{unreadCorrespondence.length}</Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {unreadCorrespondence.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">Inbox is empty.</div>
                ) : (
                  unreadCorrespondence.slice(0, 4).map((msg: any) => (
                    <Link key={msg.id} href={`/projects/${msg.projectId}`} className="block border-b border-border/50 last:border-0 pb-3 last:pb-0 group">
                      <p className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-1">{msg.subject}</p>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-muted-foreground">{msg.fromUserName}</span>
                        <Badge variant="outline" className="text-xs" style={{ borderColor: CORR_COLORS[msg.type] || "#94a3b8", color: CORR_COLORS[msg.type] || "#94a3b8" }}>
                          {(msg.type || "").toUpperCase()}
                        </Badge>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

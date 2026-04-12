import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import {
  AlertTriangle, Clock, CheckCircle2, FileText, Send, GitBranch,
  BarChart3, TrendingUp, ChevronRight, RefreshCw, AlertCircle, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  projectId: number;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return "—"; }
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    urgent: "bg-red-100 text-red-700",
    high: "bg-orange-100 text-orange-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${map[priority] ?? "bg-slate-100 text-slate-600"}`}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    sent: "bg-blue-100 text-blue-700",
    overdue: "bg-red-100 text-red-700",
    responded: "bg-green-100 text-green-700",
    closed: "bg-slate-100 text-slate-600",
    read: "bg-indigo-100 text-indigo-700",
    pending: "bg-amber-100 text-amber-700",
    acknowledged: "bg-teal-100 text-teal-700",
    rejected: "bg-red-100 text-red-700",
    none: "bg-slate-100 text-slate-500",
    approved: "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ReviewCodeBadge({ code }: { code: string | null }) {
  if (!code) return <span className="text-muted-foreground text-xs italic">No code</span>;
  const map: Record<string, string> = {
    A: "bg-green-100 text-green-800 border-green-200",
    B: "bg-amber-100 text-amber-800 border-amber-200",
    C: "bg-orange-100 text-orange-800 border-orange-200",
    D: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border font-bold text-xs ${map[code] ?? "bg-slate-100 text-slate-600 border-transparent"}`}>
      {code}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: number | string | null;
  sub?: string; color?: string;
}) {
  const iconClass = `h-5 w-5 ${color ?? "text-muted-foreground"}`;
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value ?? "—"}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted`}><Icon className={iconClass} /></div>
        </div>
      </CardContent>
    </Card>
  );
}

export function GovernanceDashboardTab({ projectId }: Props) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["governance-stats", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/governance/stats`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );

  if (isError) return (
    <div className="py-16 text-center text-muted-foreground">
      <AlertCircle className="mx-auto h-8 w-8 mb-3" />
      <p>Failed to load governance data.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>Retry</Button>
    </div>
  );

  const corr = data?.correspondence ?? {};
  const trans = data?.transmittals ?? {};
  const wfs = data?.workflows ?? {};
  const docs = data?.documents ?? {};

  // SLA colour
  const slaColor = corr.slaCompliance == null
    ? "text-muted-foreground"
    : corr.slaCompliance >= 80 ? "text-emerald-600"
      : corr.slaCompliance >= 60 ? "text-amber-600"
        : "text-red-600";

  // doc counts
  const totalDocs: number = (docs.byStatus ?? []).reduce((s: number, r: any) => s + Number(r.cnt), 0);
  const pendingReviewDocs: number = (docs.byStatus ?? [])
    .filter((r: any) => ["under_review", "pending_review"].includes(r.status))
    .reduce((s: number, r: any) => s + Number(r.cnt), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Governance Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Operational overview for project leadership</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={AlertTriangle}
          label="Overdue Correspondence"
          value={corr.overdueCount ?? 0}
          color={corr.overdueCount > 0 ? "text-red-600" : "text-emerald-600"}
          sub={corr.overdueCount > 0 ? "Past due date, not closed" : "All on time"}
        />
        <StatCard
          icon={Clock}
          label="Awaiting Response"
          value={corr.awaitingResponseCount ?? 0}
          color={corr.awaitingResponseCount > 0 ? "text-amber-600" : "text-emerald-600"}
          sub="Requires response, still open"
        />
        <StatCard
          icon={TrendingUp}
          label="SLA Compliance"
          value={corr.slaCompliance != null ? `${corr.slaCompliance}%` : "N/A"}
          color={slaColor}
          sub="Responded within due date"
        />
        <StatCard
          icon={GitBranch}
          label="Active Workflows"
          value={wfs.activeCount ?? 0}
          color={wfs.activeCount > 0 ? "text-blue-600" : "text-muted-foreground"}
          sub={wfs.bottlenecks?.[0] ? `Bottleneck: ${wfs.bottlenecks[0].stage}` : "No bottlenecks"}
        />
      </div>

      {/* Overdue Correspondence */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-base">Overdue Correspondence</CardTitle>
          </div>
          <CardDescription>Correspondence items past their due date that are not yet closed.</CardDescription>
        </CardHeader>
        <CardContent>
          {corr.overdue?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="mx-auto h-8 w-8 mb-2 text-emerald-500" />
              No overdue correspondence — all items are on track.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Overdue by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corr.overdue?.map((item: any) => {
                  const daysDiff = item.dueDate
                    ? Math.ceil((Date.now() - new Date(item.dueDate).getTime()) / 86_400_000)
                    : null;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.referenceNumber ?? `#${item.id}`}</TableCell>
                      <TableCell className="max-w-[220px] truncate font-medium">{item.subject}</TableCell>
                      <TableCell className="text-xs text-muted-foreground uppercase">{item.type}</TableCell>
                      <TableCell><PriorityBadge priority={item.priority} /></TableCell>
                      <TableCell className="text-xs">{fmtDate(item.dueDate)}</TableCell>
                      <TableCell><StatusBadge status={item.status} /></TableCell>
                      <TableCell className="text-xs font-semibold text-red-600">
                        {daysDiff != null ? `${daysDiff}d` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Awaiting Response */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-base">Items Requiring Response</CardTitle>
          </div>
          <CardDescription>Correspondence flagged as requiring a response that has not yet been provided.</CardDescription>
        </CardHeader>
        <CardContent>
          {corr.awaitingResponse?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="mx-auto h-8 w-8 mb-2 text-emerald-500" />
              No items awaiting response.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corr.awaitingResponse?.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.referenceNumber ?? `#${item.id}`}</TableCell>
                    <TableCell className="max-w-[220px] truncate font-medium">{item.subject}</TableCell>
                    <TableCell className="text-xs text-muted-foreground uppercase">{item.type}</TableCell>
                    <TableCell><PriorityBadge priority={item.priority} /></TableCell>
                    <TableCell className="text-xs">{fmtDate(item.dueDate)}</TableCell>
                    <TableCell><StatusBadge status={item.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Correspondence Status Breakdown + SLA */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Correspondence by Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(corr.byStatus ?? []).map((row: any) => {
                const total = (corr.byStatus ?? []).reduce((s: number, r: any) => s + Number(r.cnt), 0);
                const pct = total > 0 ? Math.round((Number(row.cnt) / total) * 100) : 0;
                return (
                  <div key={row.status} className="flex items-center gap-3">
                    <div className="w-24 shrink-0"><StatusBadge status={row.status} /></div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-medium w-8 text-right">{row.cnt}</span>
                  </div>
                );
              })}
              {(corr.byStatus ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No correspondence yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4" /> Transmittal Review Codes
            </CardTitle>
            <CardDescription>Distribution of review codes across all sent transmittal items.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(trans.reviewCodeSummary ?? []).map((row: any) => {
                const total = (trans.reviewCodeSummary ?? []).reduce((s: number, r: any) => s + Number(r.cnt), 0);
                const pct = total > 0 ? Math.round((Number(row.cnt) / total) * 100) : 0;
                return (
                  <div key={row.reviewCode ?? "none"} className="flex items-center gap-3">
                    <div className="w-16 shrink-0"><ReviewCodeBadge code={row.reviewCode} /></div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-medium w-8 text-right">{row.cnt}</span>
                  </div>
                );
              })}
              {(trans.reviewCodeSummary ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No transmittal items yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overdue Transmittals */}
      {trans.overdueCount > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <CardTitle className="text-base text-red-700">Overdue Transmittals ({trans.overdueCount})</CardTitle>
            </div>
            <CardDescription>Sent transmittals that have not been acknowledged by their due date.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Overdue by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trans.overdue?.map((t: any) => {
                  const daysDiff = t.dueDate
                    ? Math.ceil((Date.now() - new Date(t.dueDate).getTime()) / 86_400_000)
                    : null;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.transmittalNumber ?? `#${t.id}`}</TableCell>
                      <TableCell className="max-w-[200px] truncate font-medium">{t.subject}</TableCell>
                      <TableCell className="text-xs">{fmtDate(t.sentAt)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(t.dueDate)}</TableCell>
                      <TableCell className="text-xs font-semibold text-red-600">{daysDiff != null ? `${daysDiff}d` : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Active Workflow Bottlenecks */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-500" />
            <CardTitle className="text-base">Active Document Workflows</CardTitle>
          </div>
          <CardDescription>
            {wfs.activeCount > 0
              ? `${wfs.activeCount} workflow${wfs.activeCount !== 1 ? "s" : ""} currently active.${wfs.bottlenecks?.[0] ? ` Top bottleneck: "${wfs.bottlenecks[0].stage}" (${wfs.bottlenecks[0].count} items).` : ""}`
              : "No active workflows."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {wfs.active?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="mx-auto h-8 w-8 mb-2 text-emerald-500" />
              No active workflows — all reviews are complete.
            </div>
          ) : (
            <>
              {/* Bottleneck summary */}
              {wfs.bottlenecks?.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <p className="text-xs font-semibold text-blue-700 mb-2">Stage Bottlenecks</p>
                  <div className="flex flex-wrap gap-2">
                    {wfs.bottlenecks.map((b: any) => (
                      <span key={b.stage} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-blue-200 rounded text-xs font-medium text-blue-800">
                        <GitBranch className="h-3 w-3" /> {b.stage} <span className="font-bold">×{b.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Current Stage</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wfs.active?.map((wf: any) => (
                    <TableRow key={wf.id}>
                      <TableCell className="max-w-[280px] truncate font-medium text-sm">{wf.documentTitle}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 border border-blue-100 text-blue-700 rounded text-xs font-medium">
                          <ChevronRight className="h-3 w-3" /> {wf.currentStage}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(wf.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Documents by Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Document Status Breakdown
          </CardTitle>
          <CardDescription>
            {totalDocs} total document{totalDocs !== 1 ? "s" : ""}{pendingReviewDocs > 0 ? ` · ${pendingReviewDocs} under review` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(docs.byStatus ?? []).map((row: any) => (
              <div key={row.status} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div>
                  <StatusBadge status={row.status} />
                </div>
                <span className="text-xl font-bold">{row.cnt}</span>
              </div>
            ))}
            {(docs.byStatus ?? []).length === 0 && (
              <div className="col-span-3 text-sm text-muted-foreground text-center py-4">No documents yet.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

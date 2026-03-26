import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart3, Download, Filter, RefreshCw, FileText, Mail, Send, AlertCircle, Clock,
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    sent: "bg-blue-100 text-blue-700",
    acknowledged: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    approved: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    responded: "bg-purple-100 text-purple-700",
    closed: "bg-gray-100 text-gray-600",
    overdue: "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${variants[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function ExportButton({ data, filename }: { data: any[]; filename: string }) {
  const exportCsv = () => {
    if (!data.length) return;
    const headers = Object.keys(data[0]).join(",");
    const rows = data.map(r => Object.values(r).map(v => `"${v ?? ""}"`).join(",")).join("\n");
    const blob = new Blob([headers + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
      <Download className="h-4 w-4" /> Export CSV
    </Button>
  );
}

export default function Reports() {
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchFilter, setSearchFilter] = useState("");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const r = await fetch("/api/projects");
      return r.json();
    },
  });
  const projects = projectsData?.projects ?? [];

  const { data: dashData } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard");
      return r.json();
    },
  });

  // Document Register — API returns {documents:[...], total, ...}
  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ["reports-documents", projectFilter],
    queryFn: async () => {
      if (projectFilter === "all") return null;
      const r = await fetch(`/api/projects/${projectFilter}/documents?limit=500`);
      if (!r.ok) throw new Error("Failed to load documents");
      return r.json();
    },
    enabled: projectFilter !== "all",
  });
  const documents: any[] = Array.isArray(docsData)
    ? docsData
    : (docsData?.documents ?? []);

  // Correspondence — API returns {items:[...], total}
  const { data: corrData, isLoading: corrLoading } = useQuery({
    queryKey: ["reports-correspondence", projectFilter],
    queryFn: async () => {
      if (projectFilter === "all") return null;
      const r = await fetch(`/api/projects/${projectFilter}/correspondence`);
      if (!r.ok) throw new Error("Failed to load correspondence");
      return r.json();
    },
    enabled: projectFilter !== "all",
  });
  const correspondence: any[] = Array.isArray(corrData)
    ? corrData
    : (corrData?.items ?? corrData?.correspondence ?? []);

  // Transmittals — API returns plain array
  const { data: transData, isLoading: transLoading } = useQuery({
    queryKey: ["reports-transmittals", projectFilter],
    queryFn: async () => {
      if (projectFilter === "all") return null;
      const r = await fetch(`/api/projects/${projectFilter}/transmittals`);
      if (!r.ok) throw new Error("Failed to load transmittals");
      return r.json();
    },
    enabled: projectFilter !== "all",
  });
  const transmittals: any[] = Array.isArray(transData)
    ? transData
    : (transData?.transmittals ?? []);

  const filterText = (items: any[], keys: string[]) =>
    !searchFilter
      ? items
      : items.filter(item =>
          keys.some(k => String(item[k] ?? "").toLowerCase().includes(searchFilter.toLowerCase()))
        );

  const filteredDocs = filterText(
    statusFilter === "all" ? documents : documents.filter((d: any) => d.status === statusFilter),
    ["documentNumber", "title", "discipline", "documentType"]
  );

  const rfis = correspondence.filter((c: any) => c.type === "rfi");
  const submittals = correspondence.filter((c: any) => c.type === "submittal");
  const ncrs = correspondence.filter((c: any) => c.type === "ncr");

  const metrics = [
    {
      label: "Total Documents",
      value: dashData?.totalDocuments ?? "—",
      icon: FileText,
      color: "text-blue-500",
    },
    {
      label: "Open RFIs",
      value: dashData?.correspondence?.filter((c: any) => c.type === "rfi" && c.status !== "closed").length ?? "—",
      icon: AlertCircle,
      color: "text-orange-500",
    },
    {
      label: "Pending Tasks",
      value: dashData?.tasks?.filter((t: any) => t.status === "pending").length ?? "—",
      icon: Clock,
      color: "text-yellow-500",
    },
    {
      label: "Active Projects",
      value: projects.filter((p: any) => p.status === "active").length,
      icon: BarChart3,
      color: "text-green-500",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Reports
          </h1>
          <p className="text-muted-foreground mt-1">Document registers, RFI logs, transmittal logs, and project metrics</p>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <m.icon className={`h-8 w-8 ${m.color}`} />
              <div>
                <p className="text-2xl font-bold">{m.value}</p>
                <p className="text-xs text-muted-foreground">{m.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap gap-4 pt-4 pb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Label className="shrink-0">Project</Label>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code} - {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Search..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="w-48"
          />
        </CardContent>
      </Card>

      {projectFilter === "all" && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Filter className="h-10 w-10 mb-3 opacity-30" />
            <p className="font-medium">Select a project to view detailed reports</p>
            <p className="text-sm mt-1">Choose a project from the filter above to see document registers, RFI logs and transmittals</p>
          </CardContent>
        </Card>
      )}

      {projectFilter !== "all" && (
        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents" className="gap-1">
              <FileText className="h-3 w-3" /> Document Register
              <Badge variant="secondary" className="ml-1">{filteredDocs.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="rfis" className="gap-1">
              <AlertCircle className="h-3 w-3" /> RFI Log
              <Badge variant="secondary" className="ml-1">{rfis.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="submittals" className="gap-1">
              <Mail className="h-3 w-3" /> Submittals
              <Badge variant="secondary" className="ml-1">{submittals.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="transmittals" className="gap-1">
              <Send className="h-3 w-3" /> Transmittals
              <Badge variant="secondary" className="ml-1">{transmittals.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* Document Register */}
          <TabsContent value="documents" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Document Register</CardTitle>
                  <CardDescription>{filteredDocs.length} documents</CardDescription>
                </div>
                <ExportButton data={filteredDocs} filename="document-register.csv" />
              </CardHeader>
              <CardContent className="p-0">
                {docsLoading ? (
                  <div className="flex justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Doc No.</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Discipline</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Rev.</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDocs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            No documents found
                          </TableCell>
                        </TableRow>
                      ) : filteredDocs.map((doc: any) => (
                        <TableRow key={doc.id}>
                          <TableCell className="font-mono text-xs">{doc.documentNumber}</TableCell>
                          <TableCell className="max-w-xs truncate">{doc.title}</TableCell>
                          <TableCell>{doc.discipline ?? "—"}</TableCell>
                          <TableCell>{doc.documentType ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{doc.revision ?? "0"}</TableCell>
                          <TableCell><StatusBadge status={doc.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {doc.updatedAt ? format(parseISO(doc.updatedAt), "dd MMM yyyy") : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* RFI Log */}
          <TabsContent value="rfis" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>RFI Log</CardTitle>
                  <CardDescription>{rfis.length} RFIs</CardDescription>
                </div>
                <ExportButton data={rfis} filename="rfi-log.csv" />
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ref. No.</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Days Open</TableHead>
                      <TableHead>Raised</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rfis.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No RFIs found</TableCell>
                      </TableRow>
                    ) : rfis.map((r: any) => {
                      const daysOpen = differenceInDays(new Date(), new Date(r.createdAt));
                      const isOverdue = r.dueDate && new Date(r.dueDate) < new Date() && r.status !== "closed";
                      return (
                        <TableRow key={r.id} className={isOverdue ? "bg-red-50 dark:bg-red-950/20" : ""}>
                          <TableCell className="font-mono text-xs">{r.referenceNumber || `RFI-${String(r.id).padStart(4, "0")}`}</TableCell>
                          <TableCell className="max-w-xs truncate">{r.subject}</TableCell>
                          <TableCell>
                            <Badge variant={r.priority === "urgent" || r.priority === "high" ? "destructive" : "secondary"} className="text-xs">
                              {r.priority}
                            </Badge>
                          </TableCell>
                          <TableCell><StatusBadge status={r.status} /></TableCell>
                          <TableCell className="text-xs">
                            {r.dueDate ? (
                              <span className={isOverdue ? "text-red-600 font-medium" : ""}>
                                {format(parseISO(r.dueDate), "dd MMM yyyy")}
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={daysOpen > 14 ? "destructive" : "outline"} className="text-xs">
                              {daysOpen}d
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {format(parseISO(r.createdAt), "dd MMM yyyy")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Submittals */}
          <TabsContent value="submittals" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Submittal Log</CardTitle>
                  <CardDescription>{submittals.length} submittals</CardDescription>
                </div>
                <ExportButton data={submittals} filename="submittal-log.csv" />
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ref. No.</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submittals.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No submittals found</TableCell>
                      </TableRow>
                    ) : submittals.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.referenceNumber || `SUB-${String(s.id).padStart(4, "0")}`}</TableCell>
                        <TableCell className="max-w-xs truncate">{s.subject}</TableCell>
                        <TableCell>
                          <Badge variant={s.priority === "urgent" || s.priority === "high" ? "destructive" : "secondary"} className="text-xs">
                            {s.priority}
                          </Badge>
                        </TableCell>
                        <TableCell><StatusBadge status={s.status} /></TableCell>
                        <TableCell className="text-xs">
                          {s.dueDate ? format(parseISO(s.dueDate), "dd MMM yyyy") : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(parseISO(s.createdAt), "dd MMM yyyy")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transmittal Log */}
          <TabsContent value="transmittals" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Transmittal Log</CardTitle>
                  <CardDescription>{transmittals.length} transmittals</CardDescription>
                </div>
                <ExportButton data={transmittals} filename="transmittal-log.csv" />
              </CardHeader>
              <CardContent className="p-0">
                {transLoading ? (
                  <div className="flex justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>No.</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>Purpose</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Acknowledged</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transmittals.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transmittals found</TableCell>
                        </TableRow>
                      ) : transmittals.map((t: any) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono text-xs">{t.transmittalNumber}</TableCell>
                          <TableCell className="max-w-xs truncate">{t.subject}</TableCell>
                          <TableCell className="text-xs">{t.toExternal || "—"}</TableCell>
                          <TableCell className="text-xs capitalize">{t.purpose?.replace(/_/g, " ")}</TableCell>
                          <TableCell><StatusBadge status={t.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {t.sentAt ? format(parseISO(t.sentAt), "dd MMM yyyy") : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {t.acknowledgedAt ? format(parseISO(t.acknowledgedAt), "dd MMM yyyy") : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

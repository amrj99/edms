import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  FileSpreadsheet, BookOpen,
} from "lucide-react";
import { format, parseISO, differenceInDays, isAfter, isBefore, parseISO as pi } from "date-fns";

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

function ExportButtons({ data, filename, columns }: { data: any[]; filename: string; columns: { key: string; label: string }[] }) {
  const exportExcel = () => {
    if (!data.length) return;
    const rows = data.map(row => {
      const out: Record<string, any> = {};
      columns.forEach(col => { out[col.label] = row[col.key] ?? ""; });
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const exportPdf = () => {
    if (!data.length) return;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(13);
    doc.text(filename.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()), 14, 15);
    doc.setFontSize(9);
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

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1.5 text-xs">
        <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" /> Excel
      </Button>
      <Button variant="outline" size="sm" onClick={exportPdf} className="gap-1.5 text-xs">
        <BookOpen className="h-3.5 w-3.5 text-red-500" /> PDF
      </Button>
    </div>
  );
}

export default function Reports() {
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userFilter, setUserFilter] = useState("all");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const r = await fetch("/api/projects");
      return r.json();
    },
  });
  const projects = projectsData?.projects ?? [];

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const r = await fetch("/api/users");
      return r.json();
    },
  });
  const allUsers: any[] = usersData?.users ?? [];

  const { data: dashData } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard");
      return r.json();
    },
  });

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
  const documents: any[] = Array.isArray(docsData) ? docsData : (docsData?.documents ?? []);

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
  const correspondence: any[] = Array.isArray(corrData) ? corrData : (corrData?.items ?? corrData?.correspondence ?? []);

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
  const transmittals: any[] = Array.isArray(transData) ? transData : (transData?.transmittals ?? []);

  const applyDateFilter = (items: any[], dateField: string) => {
    let result = items;
    if (fromDate) result = result.filter(i => i[dateField] && !isBefore(new Date(i[dateField]), new Date(fromDate)));
    if (toDate) result = result.filter(i => i[dateField] && !isAfter(new Date(i[dateField]), new Date(toDate + "T23:59:59")));
    return result;
  };

  const applyUserFilter = (items: any[]) => {
    if (userFilter === "all") return items;
    const uid = parseInt(userFilter);
    return items.filter(i => i.createdBy === uid || i.assignedToId === uid || i.toUserIds?.includes(uid));
  };

  const filterText = (items: any[], keys: string[]) =>
    !searchFilter ? items : items.filter(item => keys.some(k => String(item[k] ?? "").toLowerCase().includes(searchFilter.toLowerCase())));

  const filteredDocs = useMemo(() => {
    let d = documents;
    if (statusFilter !== "all") d = d.filter((i: any) => i.status === statusFilter);
    d = applyDateFilter(d, "updatedAt");
    d = applyUserFilter(d);
    return filterText(d, ["documentNumber", "title", "discipline", "documentType"]);
  }, [documents, statusFilter, fromDate, toDate, userFilter, searchFilter]);

  const rfis = useMemo(() => applyUserFilter(applyDateFilter(filterText(correspondence.filter((c: any) => c.type === "rfi"), ["subject", "referenceNumber"]), "createdAt")), [correspondence, fromDate, toDate, userFilter, searchFilter]);
  const submittals = useMemo(() => applyUserFilter(applyDateFilter(filterText(correspondence.filter((c: any) => c.type === "submittal"), ["subject", "referenceNumber"]), "createdAt")), [correspondence, fromDate, toDate, userFilter, searchFilter]);
  const filteredTrans = useMemo(() => applyUserFilter(applyDateFilter(filterText(transmittals, ["transmittalNumber", "subject"]), "createdAt")), [transmittals, fromDate, toDate, userFilter, searchFilter]);

  const metrics = [
    { label: "Total Documents", value: dashData?.totalDocuments ?? "—", icon: FileText, color: "text-blue-500" },
    { label: "Open RFIs", value: dashData?.correspondence?.filter((c: any) => c.type === "rfi" && c.status !== "closed").length ?? "—", icon: AlertCircle, color: "text-orange-500" },
    { label: "Pending Tasks", value: dashData?.tasks?.filter((t: any) => t.status === "pending").length ?? "—", icon: Clock, color: "text-yellow-500" },
    { label: "Active Projects", value: projects.filter((p: any) => p.status === "active").length, icon: BarChart3, color: "text-green-500" },
  ];

  const DOC_COLS = [
    { key: "documentNumber", label: "Doc No." },
    { key: "title", label: "Title" },
    { key: "discipline", label: "Discipline" },
    { key: "documentType", label: "Type" },
    { key: "revision", label: "Rev." },
    { key: "status", label: "Status" },
    { key: "updatedAt", label: "Updated" },
  ];
  const RFI_COLS = [
    { key: "referenceNumber", label: "Ref. No." },
    { key: "subject", label: "Subject" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "dueDate", label: "Due Date" },
    { key: "createdAt", label: "Raised" },
  ];
  const SUB_COLS = [
    { key: "referenceNumber", label: "Ref. No." },
    { key: "subject", label: "Subject" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "dueDate", label: "Due Date" },
    { key: "createdAt", label: "Submitted" },
  ];
  const TRANS_COLS = [
    { key: "transmittalNumber", label: "No." },
    { key: "subject", label: "Subject" },
    { key: "toExternal", label: "To" },
    { key: "purpose", label: "Purpose" },
    { key: "status", label: "Status" },
    { key: "sentAt", label: "Sent" },
    { key: "acknowledgedAt", label: "Acknowledged" },
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
        <CardContent className="flex flex-wrap gap-3 pt-4 pb-4 items-end">
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
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="shrink-0">User</Label>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {allUsers.map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.firstName} {u.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-36 h-8 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-xs">To</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-36 h-8 text-sm" />
          </div>
          <Input
            placeholder="Search..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="w-40 h-8 text-sm"
          />
          {(fromDate || toDate || userFilter !== "all" || searchFilter) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFromDate(""); setToDate(""); setUserFilter("all"); setSearchFilter(""); }}>
              Clear filters
            </Button>
          )}
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
              <Badge variant="secondary" className="ml-1">{filteredTrans.length}</Badge>
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
                <ExportButtons data={filteredDocs} filename="document-register" columns={DOC_COLS} />
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
                <ExportButtons data={rfis} filename="rfi-log" columns={RFI_COLS} />
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
                <ExportButtons data={submittals} filename="submittal-log" columns={SUB_COLS} />
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
                  <CardDescription>{filteredTrans.length} transmittals</CardDescription>
                </div>
                <ExportButtons data={filteredTrans} filename="transmittal-log" columns={TRANS_COLS} />
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
                      {filteredTrans.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transmittals found</TableCell>
                        </TableRow>
                      ) : filteredTrans.map((t: any) => (
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

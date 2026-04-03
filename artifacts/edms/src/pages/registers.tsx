import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  Search, Filter, Download, RefreshCw, ChevronDown,
  FileText, Send, Layers, ArrowUpDown, ExternalLink, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

// ─── Type helpers ──────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return d; }
}

const REVIEW_CODE_LABELS: Record<string, { label: string; color: string }> = {
  A:  { label: "A – Approved",               color: "bg-green-100 text-green-800" },
  B:  { label: "B – Approved w/ Comments",   color: "bg-blue-100 text-blue-800" },
  C:  { label: "C – Revise & Resubmit",      color: "bg-yellow-100 text-yellow-800" },
  D:  { label: "D – Rejected",               color: "bg-red-100 text-red-800" },
  UR: { label: "UR – Under Review",          color: "bg-gray-100 text-gray-700" },
};

const PARTY_TYPE_LABELS: Record<string, string> = {
  owner: "Owner",
  consultant: "Consultant",
  main_contractor: "Main Contractor",
  subcontractor: "Subcontractor",
  authority: "Authority",
};

const DRAWING_TYPE_LABELS: Record<string, string> = {
  design: "Design",
  shop: "Shop",
  ifc: "IFC",
  as_built: "As-Built",
};

function ReviewCodeBadge({ code }: { code?: string | null }) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  const info = REVIEW_CODE_LABELS[code];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${info?.color ?? "bg-gray-100 text-gray-700"}`}>{code}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    under_review: "bg-blue-100 text-blue-700",
    approved: "bg-green-100 text-green-800",
    approved_with_comments: "bg-teal-100 text-teal-800",
    for_revision: "bg-yellow-100 text-yellow-800",
    rejected: "bg-red-100 text-red-800",
    issued: "bg-purple-100 text-purple-800",
    superseded: "bg-orange-100 text-orange-800",
    void: "bg-gray-200 text-gray-500",
    sent: "bg-blue-100 text-blue-700",
    acknowledged: "bg-green-100 text-green-800",
    none: "bg-gray-100 text-gray-600",
    pending: "bg-yellow-100 text-yellow-800",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${MAP[status] ?? "bg-gray-100 text-gray-700"}`}>
      {label}
    </span>
  );
}

// ─── Filter bar component ──────────────────────────────────────────────────────
function FilterBar({
  filters, setFilters, filterFields,
}: {
  filters: Record<string, string>;
  setFilters: (f: Record<string, string>) => void;
  filterFields: { key: string; label: string; options: { value: string; label: string }[] }[];
}) {
  const hasActive = Object.values(filters).some(Boolean);
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {filterFields.map(ff => (
        <Select
          key={ff.key}
          value={filters[ff.key] || "__all__"}
          onValueChange={v => setFilters({ ...filters, [ff.key]: v === "__all__" ? "" : v })}
        >
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder={ff.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All {ff.label}</SelectItem>
            {ff.options.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {hasActive && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
          onClick={() => setFilters({})}>
          <X className="h-3 w-3 mr-1" /> Clear
        </Button>
      )}
    </div>
  );
}

// ─── Documents Register ────────────────────────────────────────────────────────
function DocumentsRegister({ projectId }: { projectId: number }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (filters.partyType) params.set("partyType", filters.partyType);
  if (filters.discipline) params.set("discipline", filters.discipline);
  if (filters.status) params.set("status", filters.status);
  params.set("limit", "100");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["register-documents", projectId, params.toString()],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/registers/documents?${params}`);
      return r.json();
    },
    enabled: !!projectId,
  });

  const documents: any[] = data?.documents ?? [];

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearch as any).__t);
    (handleSearch as any).__t = setTimeout(() => setDebouncedSearch(v), 400);
  };

  const filterFields = [
    {
      key: "partyType", label: "Party",
      options: Object.entries(PARTY_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
    },
    {
      key: "discipline", label: "Discipline",
      options: ["Civil", "Structural", "Mechanical", "Electrical", "Architecture", "HVAC", "Plumbing"].map(d => ({ value: d, label: d })),
    },
    {
      key: "status", label: "Status",
      options: ["draft", "under_review", "approved", "approved_with_comments", "for_revision", "rejected", "issued", "superseded", "void"]
        .map(s => ({ value: s, label: s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) })),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search by number or title…" value={search} onChange={e => handleSearch(e.target.value)} />
        </div>
        <FilterBar filters={filters} setFilters={setFilters} filterFields={filterFields} />
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[150px]">Doc Number</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead className="w-[100px]">Discipline</TableHead>
              <TableHead className="w-[80px]">Rev</TableHead>
              <TableHead className="w-[130px]">Status</TableHead>
              <TableHead className="w-[130px]">Party</TableHead>
              <TableHead className="w-[100px]">Issued By</TableHead>
              <TableHead className="w-[110px]">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 9 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && documents.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                  No documents found for the current filters.
                </TableCell>
              </TableRow>
            )}
            {documents.map(doc => (
              <TableRow key={doc.id} className="hover:bg-muted/30">
                <TableCell className="font-mono text-xs font-medium">
                  <Link href={`/documents/${doc.id}`} className="text-blue-600 hover:underline">{doc.documentNumber}</Link>
                </TableCell>
                <TableCell className="font-medium max-w-[260px] truncate" title={doc.title}>{doc.title}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{doc.documentType ?? "—"}</TableCell>
                <TableCell className="text-sm">{doc.discipline ?? "—"}</TableCell>
                <TableCell className="text-center text-sm font-mono">{doc.revision}</TableCell>
                <TableCell><StatusBadge status={doc.status} /></TableCell>
                <TableCell className="text-sm">{PARTY_TYPE_LABELS[doc.partyType ?? ""] ?? doc.partyType ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[100px]">{doc.issuedBy ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(doc.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{documents.length} document{documents.length !== 1 ? "s" : ""}</p>
    </div>
  );
}

// ─── Drawings Register ─────────────────────────────────────────────────────────
function DrawingsRegister({ projectId }: { projectId: number }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (filters.partyType) params.set("partyType", filters.partyType);
  if (filters.discipline) params.set("discipline", filters.discipline);
  if (filters.drawingType) params.set("drawingType", filters.drawingType);
  if (filters.reviewCode) params.set("reviewCode", filters.reviewCode);
  params.set("limit", "100");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["register-drawings", projectId, params.toString()],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/registers/drawings?${params}`);
      return r.json();
    },
    enabled: !!projectId,
  });

  const drawings: any[] = data?.drawings ?? [];

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearch as any).__t);
    (handleSearch as any).__t = setTimeout(() => setDebouncedSearch(v), 400);
  };

  const filterFields = [
    {
      key: "drawingType", label: "Drawing Type",
      options: Object.entries(DRAWING_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
    },
    {
      key: "discipline", label: "Discipline",
      options: ["Civil", "Structural", "Mechanical", "Electrical", "Architecture", "HVAC", "Plumbing"].map(d => ({ value: d, label: d })),
    },
    {
      key: "partyType", label: "Party",
      options: Object.entries(PARTY_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
    },
    {
      key: "reviewCode", label: "Review Code",
      options: Object.keys(REVIEW_CODE_LABELS).map(k => ({ value: k, label: k })),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search drawings…" value={search} onChange={e => handleSearch(e.target.value)} />
        </div>
        <FilterBar filters={filters} setFilters={setFilters} filterFields={filterFields} />
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[150px]">Drawing No.</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-[110px]">Type</TableHead>
              <TableHead className="w-[100px]">Discipline</TableHead>
              <TableHead className="w-[70px]">Rev</TableHead>
              <TableHead className="w-[80px]">Code</TableHead>
              <TableHead className="w-[130px]">Party</TableHead>
              <TableHead className="w-[110px]">Submitted</TableHead>
              <TableHead className="w-[110px]">Response</TableHead>
              <TableHead className="w-[130px]">Transmittal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 10 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && drawings.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                  No drawings found. Documents with type "Drawing" will appear here.
                </TableCell>
              </TableRow>
            )}
            {drawings.map(d => (
              <TableRow key={d.id} className="hover:bg-muted/30">
                <TableCell className="font-mono text-xs font-medium">
                  <Link href={`/documents/${d.id}`} className="text-blue-600 hover:underline">{d.documentNumber}</Link>
                </TableCell>
                <TableCell className="font-medium max-w-[220px] truncate" title={d.title}>{d.title}</TableCell>
                <TableCell className="text-sm">{DRAWING_TYPE_LABELS[d.drawingType ?? ""] ?? d.drawingType ?? "—"}</TableCell>
                <TableCell className="text-sm">{d.discipline ?? "—"}</TableCell>
                <TableCell className="text-center text-sm font-mono">{d.revision}</TableCell>
                <TableCell><ReviewCodeBadge code={d.reviewCode} /></TableCell>
                <TableCell className="text-sm">{PARTY_TYPE_LABELS[d.partyType ?? ""] ?? d.partyType ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(d.sentAt)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(d.reviewDate)}</TableCell>
                <TableCell className="text-xs font-mono text-blue-600">{d.transmittalNumber ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{drawings.length} drawing{drawings.length !== 1 ? "s" : ""}</p>
    </div>
  );
}

// ─── Transmittal Register ──────────────────────────────────────────────────────
function TransmittalRegister({ projectId }: { projectId: number }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.partyType) params.set("partyType", filters.partyType);
  if (filters.status) params.set("status", filters.status);
  if (filters.reviewCode) params.set("reviewCode", filters.reviewCode);
  params.set("limit", "100");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["register-transmittals", projectId, params.toString()],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/registers/transmittals?${params}`);
      return r.json();
    },
    enabled: !!projectId,
  });

  const transmittals: any[] = data?.transmittals ?? [];

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearch as any).__t);
    (handleSearch as any).__t = setTimeout(() => setDebouncedSearch(v), 400);
  };

  const filterFields = [
    {
      key: "direction", label: "Direction",
      options: [{ value: "outgoing", label: "Outgoing" }, { value: "incoming", label: "Incoming" }],
    },
    {
      key: "partyType", label: "Party",
      options: Object.entries(PARTY_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
    },
    {
      key: "status", label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "sent", label: "Sent" },
        { value: "acknowledged", label: "Acknowledged" },
        { value: "rejected", label: "Rejected" },
      ],
    },
    {
      key: "reviewCode", label: "Review Code",
      options: Object.keys(REVIEW_CODE_LABELS).map(k => ({ value: k, label: k })),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search transmittals…" value={search} onChange={e => handleSearch(e.target.value)} />
        </div>
        <FilterBar filters={filters} setFilters={setFilters} filterFields={filterFields} />
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[140px]">TRS Number</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="w-[90px]">Direction</TableHead>
              <TableHead className="w-[130px]">Party</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[110px]">Purpose</TableHead>
              <TableHead className="w-[110px]">Sent</TableHead>
              <TableHead className="w-[110px]">Due</TableHead>
              <TableHead className="w-[110px]">Approval</TableHead>
              <TableHead className="w-[60px]">Items</TableHead>
              <TableHead className="w-[90px]">Codes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 11 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && transmittals.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-12">
                  No transmittals found for the current filters.
                </TableCell>
              </TableRow>
            )}
            {transmittals.map(t => (
              <TableRow key={t.id} className="hover:bg-muted/30">
                <TableCell className="font-mono text-xs font-medium text-blue-600">{t.transmittalNumber}</TableCell>
                <TableCell className="font-medium max-w-[220px] truncate" title={t.subject}>{t.subject}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={t.direction === "incoming"
                    ? "border-green-300 text-green-700" : "border-blue-300 text-blue-700"}>
                    {t.direction === "incoming" ? "↓ In" : "↑ Out"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{PARTY_TYPE_LABELS[t.partyType ?? ""] ?? t.partyType ?? "—"}</TableCell>
                <TableCell><StatusBadge status={t.status} /></TableCell>
                <TableCell className="text-sm capitalize">{(t.purpose ?? "—").replace(/_/g, " ")}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(t.sentAt)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(t.dueDate)}</TableCell>
                <TableCell><StatusBadge status={t.approvalStatus ?? "none"} /></TableCell>
                <TableCell className="text-center text-sm">{t.itemsCount}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(t.reviewCodes ?? []).map((c: string) => (
                      <ReviewCodeBadge key={c} code={c} />
                    ))}
                    {!(t.reviewCodes?.length) && <span className="text-muted-foreground text-xs">—</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{transmittals.length} transmittal{transmittals.length !== 1 ? "s" : ""}</p>
    </div>
  );
}

// ─── Main Registers Page ───────────────────────────────────────────────────────
export default function RegistersPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("documents");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const r = await fetch("/api/projects");
      return r.json();
    },
  });

  const projects: any[] = projectsData?.projects ?? [];

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Registers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Master Document, Drawings, and Transmittal registers for your project
          </p>
        </div>
      </div>

      {/* Project selector */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Select Project</span>
            <Select
              value={selectedProjectId ? String(selectedProjectId) : ""}
              onValueChange={v => setSelectedProjectId(parseInt(v))}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Choose a project to view its registers…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    <span className="font-mono text-xs mr-2 text-muted-foreground">{p.code}</span>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProject && (
              <Badge variant="outline" className="text-xs">{selectedProject.status}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedProjectId ? (
        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <Layers className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">Select a project to view its registers</p>
          <p className="text-sm mt-1">Choose a project above to see the Master Document, Drawings, and Transmittal registers.</p>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 max-w-lg">
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="h-4 w-4" />
              Master Documents
            </TabsTrigger>
            <TabsTrigger value="drawings" className="gap-2">
              <Layers className="h-4 w-4" />
              Drawings
            </TabsTrigger>
            <TabsTrigger value="transmittals" className="gap-2">
              <Send className="h-4 w-4" />
              Transmittals
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="mt-6">
            <DocumentsRegister projectId={selectedProjectId} />
          </TabsContent>

          <TabsContent value="drawings" className="mt-6">
            <DrawingsRegister projectId={selectedProjectId} />
          </TabsContent>

          <TabsContent value="transmittals" className="mt-6">
            <TransmittalRegister projectId={selectedProjectId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

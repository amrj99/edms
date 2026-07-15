import { useState, useRef } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useSearch } from "@workspace/api-client-react";
import {
  FileText, Mail, Loader2, Sparkles, Search as SearchIcon,
  Filter, X, SlidersHorizontal, Clock, FolderOpen, Tag, CheckCircle2, Send,
  CalendarDays,
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchParams {
  q: string;
  type?: string;
  discipline?: string;
  status?: string;
  documentType?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  projectName?: string;
  aiInterpretation?: string;
}

const DISCIPLINES = ["Civil", "Structural", "Mechanical", "Electrical", "Instrumentation", "Piping", "Process", "HVAC", "Fire & Safety"];
const STATUSES = ["draft", "under_review", "approved", "rejected", "issued", "superseded"];
const RESULT_TYPES = ["all", "documents", "correspondence", "transmittals"];

export default function Search() {
  const [searchParams, setSearchParams] = useState<SearchParams>({ q: "" });
  const [mode, setMode] = useState<"keyword">("keyword");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ type: "all", status: "", discipline: "", projectId: "", dateFrom: "", dateTo: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects: any[] = unwrapList<any>(projectsData, "projects");

  const activeFilterCount = [filters.type !== "all", filters.status, filters.discipline, filters.projectId, filters.dateFrom, filters.dateTo].filter(Boolean).length;

  const mergedParams = {
    q: searchParams.q,
    type: (filters.type !== "all" ? filters.type : "all") as any,
    discipline: filters.discipline || undefined,
    status: filters.status || undefined,
    projectId: filters.projectId ? parseInt(filters.projectId) : undefined,
  };

  const { data, isLoading } = useSearch(
    mergedParams,
    { query: { enabled: searchParams.q.length > 0 } }
  );

  const handleAISearch = (params: SearchParams) => setSearchParams(params);

  const handleKeywordSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = inputRef.current?.value?.trim();
    if (q) setSearchParams({ q });
  };

  const clearFilters = () => setFilters({ type: "all", status: "", discipline: "", projectId: "", dateFrom: "", dateTo: "" });

  const effectiveDateFrom = filters.dateFrom || searchParams.dateFrom || "";
  const effectiveDateTo = filters.dateTo || searchParams.dateTo || "";
  const effectiveProjectName = searchParams.projectName || "";

  const filterDoc = (doc: any) => {
    if (effectiveDateFrom && new Date(doc.updatedAt) < new Date(effectiveDateFrom)) return false;
    if (effectiveDateTo && new Date(doc.updatedAt) > new Date(effectiveDateTo)) return false;
    if (effectiveProjectName && !doc.projectName?.toLowerCase().includes(effectiveProjectName.toLowerCase())) return false;
    return true;
  };
  const filterCorr = (c: any) => {
    if (effectiveDateFrom && new Date(c.createdAt) < new Date(effectiveDateFrom)) return false;
    if (effectiveDateTo && new Date(c.createdAt) > new Date(effectiveDateTo)) return false;
    return true;
  };

  const filteredDocs = (data?.documents ?? []).filter(filterDoc);
  const filteredCorr = (data?.correspondence ?? []).filter(filterCorr);
  const filteredMeetings = (data?.meetings ?? []);
  const total = filteredDocs.length + filteredCorr.length + filteredMeetings.length;

  return (
    <div className="space-y-6 animate-in fade-in max-w-4xl mx-auto">
      <div className="text-center py-6">
        <h1 className="text-4xl font-display font-bold tracking-tight mb-2">Search</h1>
        <p className="text-muted-foreground mb-5">Search across all documents, correspondence, transmittals and metadata.</p>

        <form onSubmit={handleKeywordSearch} className="flex max-w-2xl mx-auto gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              ref={inputRef}
              defaultValue={searchParams.q}
              placeholder="Search by document number, title, correspondence subject..."
              className="h-14 w-full pl-12 text-lg rounded-xl border border-input bg-background px-3 py-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <button type="submit" className="h-14 px-8 rounded-xl text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
            Search
          </button>
        </form>

        {/* Filter toggle */}
        <div className="flex justify-center mt-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setShowFilters(s => !s)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">{activeFilterCount}</span>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="gap-1 ml-1 text-muted-foreground" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium">
            <Filter className="h-4 w-4" /> Advanced Filters
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1"><Tag className="h-3 w-3" /> Result Type</label>
              <Select value={filters.type} onValueChange={v => setFilters(f => ({ ...f, type: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESULT_TYPES.map(t => <SelectItem key={t} value={t}>{t === "all" ? "All Types" : t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1"><FolderOpen className="h-3 w-3" /> Project</label>
              <Select value={filters.projectId || "_all"} onValueChange={v => setFilters(f => ({ ...f, projectId: v === "_all" ? "" : v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Projects</SelectItem>
                  {projects.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Status</label>
              <Select value={filters.status || "_any"} onValueChange={v => setFilters(f => ({ ...f, status: v === "_any" ? "" : v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Any status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any Status</SelectItem>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Discipline</label>
              <Select value={filters.discipline || "_any"} onValueChange={v => setFilters(f => ({ ...f, discipline: v === "_any" ? "" : v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Any discipline" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any Discipline</SelectItem>
                  {DISCIPLINES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1"><Clock className="h-3 w-3" /> Date From</label>
              <Input type="date" className="h-9" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1"><Clock className="h-3 w-3" /> Date To</label>
              <Input type="date" className="h-9" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
            </div>
          </div>
        </div>
      )}

      {searchParams.aiInterpretation && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span>AI interpreted: <span className="font-medium text-foreground">{searchParams.aiInterpretation}</span></span>
            {(searchParams.dateFrom || searchParams.dateTo || searchParams.projectName) && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {searchParams.projectName && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <FolderOpen className="h-3 w-3" /> {searchParams.projectName}
                  </Badge>
                )}
                {(searchParams.dateFrom || searchParams.dateTo) && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {searchParams.dateFrom && searchParams.dateTo
                      ? `${searchParams.dateFrom} – ${searchParams.dateTo}`
                      : searchParams.dateFrom
                        ? `From ${searchParams.dateFrom}`
                        : `Until ${searchParams.dateTo}`}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              {total > 0
                ? <>Found <span className="text-foreground font-semibold">{total}</span> results for "<span className="text-foreground font-semibold">{searchParams.q}</span>"</>
                : <>No results for "<span className="text-foreground font-semibold">{searchParams.q}</span>"</>
              }
            </p>
            {activeFilterCount > 0 && (
              <p className="text-xs text-muted-foreground">{activeFilterCount} filter(s) applied</p>
            )}
          </div>

          {filteredDocs.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Documents
                <Badge variant="secondary">{filteredDocs.length}</Badge>
              </h2>
              <div className="grid gap-2">
                {filteredDocs.map((doc: any) => (
                  <Link key={doc.id} href={`/projects/${doc.projectId}`}>
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-mono font-bold bg-muted px-2 py-0.5 rounded">{doc.documentNumber}</span>
                            <Badge variant="outline" className="text-[10px] uppercase">{doc.status}</Badge>
                            {doc.discipline && <Badge variant="secondary" className="text-[10px]">{doc.discipline}</Badge>}
                            {doc.revision && <span className="text-xs text-muted-foreground">Rev {doc.revision}</span>}
                          </div>
                          <h3 className="font-medium text-foreground truncate">{doc.title}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {doc.projectName && <span className="mr-2">{doc.projectName}</span>}
                            {doc.updatedAt && <span>Updated {format(new Date(doc.updatedAt), "dd MMM yyyy")}</span>}
                          </p>
                        </div>
                        <FileText className="h-5 w-5 text-muted-foreground shrink-0 ml-3" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {filteredCorr.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" /> Correspondence
                <Badge variant="secondary">{filteredCorr.length}</Badge>
              </h2>
              <div className="grid gap-2">
                {filteredCorr.map((msg: any) => (
                  <Link key={msg.id} href={`/projects/${msg.projectId}/correspondence`}>
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="secondary" className="text-[10px] uppercase">{msg.type}</Badge>
                            <span className="text-xs text-muted-foreground">From: {msg.fromUserName}</span>
                            {msg.status && <Badge variant="outline" className="text-[10px]">{msg.status}</Badge>}
                          </div>
                          <h3 className="font-medium text-foreground truncate">{msg.subject}</h3>
                          {msg.createdAt && (
                            <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(msg.createdAt), "dd MMM yyyy")}</p>
                          )}
                        </div>
                        <Mail className="h-5 w-5 text-muted-foreground shrink-0 ml-3" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {filteredMeetings.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" /> Meetings
                <Badge variant="secondary">{filteredMeetings.length}</Badge>
              </h2>
              <div className="grid gap-2">
                {filteredMeetings.map((meeting: any) => (
                  <Link key={meeting.id} href={`/projects/${meeting.projectId}/meetings`}>
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="secondary" className="text-[10px]">Meeting</Badge>
                            {meeting.referenceNumber && <span className="text-xs font-mono font-bold bg-muted px-2 py-0.5 rounded">{meeting.referenceNumber}</span>}
                            {meeting.status && <Badge variant="outline" className="text-[10px] capitalize">{meeting.status.replace(/_/g, " ")}</Badge>}
                          </div>
                          <h3 className="font-medium text-foreground truncate">{meeting.title}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {meeting.projectName && <span className="mr-2">{meeting.projectName}</span>}
                            {meeting.meetingDate && <span>{format(new Date(meeting.meetingDate), "dd MMM yyyy")}</span>}
                          </p>
                        </div>
                        <CalendarDays className="h-5 w-5 text-muted-foreground shrink-0 ml-3" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {total === 0 && searchParams.q && (
            <div className="text-center py-20 bg-card border rounded-xl border-dashed">
              <SearchIcon className="mx-auto h-12 w-12 text-muted-foreground opacity-30 mb-4" />
              <h3 className="text-lg font-medium">No results found</h3>
              <p className="text-muted-foreground mt-1">
                {activeFilterCount > 0
                  ? "Try removing some filters to broaden your search."
                  : mode === "ai"
                    ? "Try rephrasing your question or switch to keyword search."
                    : "Try adjusting your search terms or switch to AI Search."}
              </p>
              {activeFilterCount > 0 && (
                <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                  Clear all filters
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {!data && !isLoading && !searchParams.q && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {[
            { icon: FileText, label: "Documents", hint: "Search by document number, title, discipline, or revision" },
            { icon: Mail, label: "Correspondence", hint: "Find RFIs, Submittals, NCRs, TQs, and Letters" },
            { icon: Send, label: "Transmittals", hint: "Locate transmittals by number, subject, or recipient" },
          ].map(({ icon: Icon, label, hint }) => (
            <div key={label} className="bg-card border rounded-xl p-5 text-center hover:border-primary/50 transition-colors">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <p className="font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground mt-1">{hint}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

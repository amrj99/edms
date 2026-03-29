import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isPast, parseISO } from "date-fns";
import {
  Mail, Inbox, Send, Folder, FolderOpen, Search, Plus, Flag, Star,
  RefreshCw, Filter, ChevronDown, ArrowUp, ArrowDown, Clock, AlertCircle,
  MessageSquare, Reply, MoreHorizontal, X, Tag, Archive, Loader2,
  FolderKanban, Globe, CheckSquare, TriangleAlert, Paperclip, Link2, FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { FileDropZone } from "@/components/file-drop-zone";
import { RecipientAutocomplete, CCAutocomplete, type RecipientUser } from "@/components/recipient-autocomplete";

const CORR_TYPES = ["rfi", "submittal", "ncr", "technical_query", "transmittal", "letter", "memo", "email", "internal", "notice"];
const CORR_TYPE_LABELS: Record<string, string> = {
  rfi: "RFI", submittal: "Submittal", ncr: "NCR", technical_query: "TQ",
  transmittal: "Transmittal", letter: "Letter", memo: "Memo",
  email: "Email", internal: "Internal", notice: "Notice",
};
const TYPE_COLORS: Record<string, string> = {
  rfi: "bg-blue-100 text-blue-700", submittal: "bg-purple-100 text-purple-700",
  ncr: "bg-red-100 text-red-700", technical_query: "bg-cyan-100 text-cyan-700",
  transmittal: "bg-green-100 text-green-700", letter: "bg-amber-100 text-amber-700",
  memo: "bg-orange-100 text-orange-700", email: "bg-gray-100 text-gray-700",
  internal: "bg-indigo-100 text-indigo-700", notice: "bg-pink-100 text-pink-700",
};
const PRIORITY_COLORS: Record<string, string> = {
  low: "text-gray-400", medium: "text-blue-500", high: "text-orange-500", urgent: "text-red-500",
};

type SortKey = "date" | "priority" | "subject" | "type";
type SortDir = "asc" | "desc";

function PriorityIcon({ priority }: { priority: string }) {
  const cls = PRIORITY_COLORS[priority] ?? "text-gray-400";
  if (priority === "urgent") return <TriangleAlert className={`h-3.5 w-3.5 ${cls}`} />;
  if (priority === "high") return <ArrowUp className={`h-3.5 w-3.5 ${cls}`} />;
  if (priority === "medium") return <ArrowUp className={`h-3.5 w-3.5 ${cls} opacity-50`} />;
  return <ArrowDown className={`h-3.5 w-3.5 ${cls}`} />;
}

export default function CorrespondencePage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [selectedFolder, setSelectedFolder] = useState<string>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("all");
  const [searchQ, setSearchQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<any>(null);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [starred, setStarred] = useState<Set<number>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [compose, setCompose] = useState<{
    subject: string; type: string; body: string; priority: string; dueDate: string;
    projectId: string; toUserIds: number[]; cc: string; bcc: string; taskToId: string;
  }>({ subject: "", type: "rfi", body: "", priority: "medium", dueDate: "", projectId: "", toUserIds: [], cc: "", bcc: "", taskToId: "" });
  const [toPickUser, setToPickUser] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<{ url: string; name: string; size: number }[]>([]);
  const [corrShareOpen, setCorrShareOpen] = useState(false);
  const [corrShareForm, setCorrShareForm] = useState({ expiresInDays: "30", password: "" });
  const [corrShareResult, setCorrShareResult] = useState<{ shareUrl: string; expiresAt: string | null } | null>(null);

  // Fetch projects
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects = projectsData?.projects ?? [];

  // Fetch all correspondence (general + all projects)
  const { data: generalData, isLoading: genLoading } = useQuery({
    queryKey: ["correspondence", "general"],
    queryFn: async () => { const r = await fetch("/api/general/correspondence"); return r.json(); },
  });
  const generalItems = generalData?.items ?? [];

  // Fetch project correspondence based on selected project or all
  const { data: projectCorrData } = useQuery({
    queryKey: ["correspondence", "all-projects", selectedProjectId],
    queryFn: async () => {
      if (selectedProjectId) {
        const r = await fetch(`/api/projects/${selectedProjectId}/correspondence`);
        return r.json();
      }
      // Fetch all project correspondence (aggregate)
      if (projects.length === 0) return { items: [] };
      const results = await Promise.all(
        projects.slice(0, 10).map((p: any) =>
          fetch(`/api/projects/${p.id}/correspondence`).then(r => r.json())
        )
      );
      const allItems = results.flatMap((r: any) => r.items ?? []);
      return { items: allItems };
    },
    enabled: projects.length > 0,
  });
  const projectItems = projectCorrData?.items ?? [];

  const allItems = useMemo(() => {
    const combined = [...generalItems.map((i: any) => ({ ...i, _source: "general" })),
                      ...projectItems.map((i: any) => ({ ...i, _source: "project" }))];
    return combined;
  }, [generalItems, projectItems]);

  const filteredItems = useMemo(() => {
    let items = allItems;

    // Folder filter
    if (selectedFolder === "general") items = items.filter((i: any) => i._source === "general");
    else if (selectedFolder === "projects") items = items.filter((i: any) => i._source === "project");
    else if (selectedFolder === "flagged") items = items.filter((i: any) => flagged.has(i.id));
    else if (selectedFolder === "starred") items = items.filter((i: any) => starred.has(i.id));
    else if (selectedFolder === "overdue") items = items.filter((i: any) => i.dueDate && isPast(new Date(i.dueDate)) && i.status !== "closed");

    if (selectedProjectId && selectedFolder !== "general") items = items.filter((i: any) => i.projectId === selectedProjectId);
    if (selectedTypeFilter !== "all") items = items.filter((i: any) => i.type === selectedTypeFilter);
    if (searchQ) items = items.filter((i: any) =>
      i.subject?.toLowerCase().includes(searchQ.toLowerCase()) ||
      i.referenceNumber?.toLowerCase().includes(searchQ.toLowerCase()) ||
      i.body?.toLowerCase().includes(searchQ.toLowerCase())
    );

    // Sort
    items = [...items].sort((a: any, b: any) => {
      let av: any, bv: any;
      if (sortKey === "date") { av = new Date(a.createdAt).getTime(); bv = new Date(b.createdAt).getTime(); }
      else if (sortKey === "priority") {
        const order = ["urgent", "high", "medium", "low"];
        av = order.indexOf(a.priority ?? "low"); bv = order.indexOf(b.priority ?? "low");
      } else if (sortKey === "subject") { av = a.subject ?? ""; bv = b.subject ?? ""; }
      else if (sortKey === "type") { av = a.type ?? ""; bv = b.type ?? ""; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return items;
  }, [allItems, selectedFolder, selectedProjectId, selectedTypeFilter, searchQ, sortKey, sortDir, flagged, starred]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });
  const allUsers: any[] = usersData?.users ?? [];

  const createCorr = useMutation({
    mutationFn: async ({ data, sendNow }: { data: typeof compose; sendNow: boolean }) => {
      const projectId = data.projectId && data.projectId !== "_none" ? parseInt(data.projectId) : null;
      const url = projectId ? `/api/projects/${projectId}/correspondence` : "/api/general/correspondence";
      const payload = {
        subject: data.subject,
        type: data.type,
        body: data.body,
        priority: data.priority,
        dueDate: data.dueDate || undefined,
        toUserIds: data.toUserIds.length > 0 ? data.toUserIds : undefined,
        cc: data.cc || undefined,
        bcc: data.bcc || undefined,
        taskToId: data.taskToId && data.taskToId !== "_none" ? data.taskToId : undefined,
        attachments: composeAttachments.length > 0 ? composeAttachments.map(a => ({ fileName: a.name, fileUrl: a.url, fileSize: a.size })) : undefined,
        sendNow,
        folder: "inbox",
      };
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["correspondence"] });
      setComposeOpen(false);
      setCompose({ subject: "", type: "rfi", body: "", priority: "medium", dueDate: "", projectId: "", toUserIds: [], cc: "", bcc: "", taskToId: "" });
      setToPickUser("");
      setComposeAttachments([]);
      toast({ title: vars.sendNow ? "Correspondence sent" : "Draft saved" });
    },
    onError: () => toast({ title: "Failed to create", variant: "destructive" }),
  });

  const createCorrShare = useMutation({
    mutationFn: async ({ id, source, expiresInDays, password }: { id: number; source: string; expiresInDays: string; password: string }) => {
      const url = source === "general"
        ? `/api/general/correspondence/${id}/share`
        : `/api/projects/${selected?.projectId}/correspondence/${id}/share`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: expiresInDays ? parseInt(expiresInDays) : null, password: password || undefined }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (data) => setCorrShareResult({ shareUrl: data.shareUrl, expiresAt: data.expiresAt }),
    onError: () => toast({ title: "Failed to generate share link", variant: "destructive" }),
  });

  const revokeCorrShare = useMutation({
    mutationFn: async ({ id, source }: { id: number; source: string }) => {
      const url = source === "general"
        ? `/api/general/correspondence/${id}/share`
        : `/api/projects/${selected?.projectId}/correspondence/${id}/share`;
      await fetch(url, { method: "DELETE" });
    },
    onSuccess: () => { setCorrShareResult(null); toast({ title: "Share link revoked" }); },
  });

  const sendReply = useMutation({
    mutationFn: async ({ id, source, projectId, body }: { id: number; source: string; projectId?: number | null; body: string }) => {
      const url = source === "general"
        ? `/api/general/correspondence/${id}/reply`
        : `/api/projects/${projectId}/correspondence/${id}/reply`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error("Failed to send reply");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["correspondence"] });
      qc.invalidateQueries({ queryKey: ["corr-thread", selected?.id] });
      setReplyText("");
      setReplyingToId(null);
      toast({ title: "Reply sent" });
    },
    onError: () => toast({ title: "Failed to send reply", variant: "destructive" }),
  });

  const { data: threadData } = useQuery({
    queryKey: ["corr-thread", selected?.id, selected?._source],
    queryFn: async () => {
      if (!selected) return { items: [] };
      const url = selected._source === "general"
        ? `/api/general/correspondence?parentId=${selected.id}`
        : `/api/projects/${selected.projectId}/correspondence?parentId=${selected.id}`;
      const r = await fetch(url);
      if (!r.ok) return { items: [] };
      return r.json();
    },
    enabled: !!selected,
  });
  const threadReplies: any[] = threadData?.items ?? [];

  const handleForward = () => {
    if (!selected) return;
    setCompose({
      subject: `Fwd: ${selected.subject}`,
      type: selected.type ?? "rfi",
      body: `\n\n---------- Forwarded message ----------\nFrom: ${selected.fromName || "Unknown"}\nSubject: ${selected.subject}\n\n${selected.body || ""}`,
      priority: selected.priority ?? "medium",
      dueDate: "",
      projectId: selected.projectId ? String(selected.projectId) : "_none",
      toUserIds: [],
      cc: "",
      bcc: "",
      taskToId: "",
    });
    setComposeAttachments([]);
    setComposeOpen(true);
  };

  const overdueCount = allItems.filter((i: any) => i.dueDate && isPast(new Date(i.dueDate)) && i.status !== "closed").length;
  const flaggedCount = flagged.size;

  const FOLDERS = [
    { id: "all", label: "All Correspondence", icon: Mail, count: allItems.length },
    { id: "general", label: "General Inbox", icon: Inbox, count: generalItems.length },
    { id: "projects", label: "Projects", icon: FolderKanban, count: projectItems.length },
    { id: "flagged", label: "Flagged", icon: Flag, count: flaggedCount },
    { id: "starred", label: "Starred", icon: Star, count: starred.size },
    { id: "overdue", label: "Overdue", icon: AlertCircle, count: overdueCount },
  ];

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-4 md:-m-6 lg:-m-8 rounded-xl overflow-hidden border bg-card shadow-sm">
      {/* LEFT: Folder Panel */}
      <div className="w-52 shrink-0 border-r bg-muted/30 flex flex-col">
        <div className="p-3 border-b">
          <Button size="sm" className="w-full gap-2" onClick={() => setComposeOpen(true)}>
            <Plus className="h-4 w-4" /> Compose
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground px-2 py-1 mt-1">Folders</p>
            {FOLDERS.map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => { setSelectedFolder(id); setSelectedProjectId(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${selectedFolder === id && !selectedProjectId ? "bg-primary text-white" : "hover:bg-accent text-foreground"}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
                {count > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full ${selectedFolder === id && !selectedProjectId ? "bg-white/20" : "bg-muted-foreground/20"}`}>{count}</span>}
              </button>
            ))}

            <p className="text-[10px] font-semibold uppercase text-muted-foreground px-2 py-1 mt-3">Projects</p>
            {projects.slice(0, 8).map((p: any) => (
              <button
                key={p.id}
                onClick={() => { setSelectedProjectId(p.id); setSelectedFolder("projects"); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${selectedProjectId === p.id ? "bg-primary text-white" : "hover:bg-accent text-foreground"}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-xs">{p.code}</span>
                </span>
              </button>
            ))}

            <p className="text-[10px] font-semibold uppercase text-muted-foreground px-2 py-1 mt-3">By Type</p>
            {CORR_TYPES.map(t => {
              const cnt = allItems.filter((i: any) => i.type === t).length;
              if (!cnt) return null;
              return (
                <button
                  key={t}
                  onClick={() => { setSelectedTypeFilter(selectedTypeFilter === t ? "all" : t); }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors ${selectedTypeFilter === t ? "bg-primary text-white" : "hover:bg-accent text-foreground"}`}
                >
                  <span className="flex items-center gap-2">
                    <Tag className="h-3 w-3 shrink-0" />
                    {CORR_TYPE_LABELS[t]}
                  </span>
                  <span className="text-xs">{cnt}</span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* MIDDLE: List Panel */}
      <div className="w-80 shrink-0 border-r flex flex-col">
        {/* Search + Sort bar */}
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-8 h-8 text-sm" placeholder="Search..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          </div>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 flex-1">
                  <Filter className="h-3 w-3" />
                  Sort: {sortKey.charAt(0).toUpperCase() + sortKey.slice(1)}
                  {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {(["date", "priority", "subject", "type"] as SortKey[]).map(k => (
                  <DropdownMenuItem key={k} onClick={() => toggleSort(k)} className="capitalize">
                    {k} {sortKey === k && (sortDir === "asc" ? "↑" : "↓")}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Select value={selectedTypeFilter} onValueChange={setSelectedTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-24 shrink-0">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {CORR_TYPES.map(t => <SelectItem key={t} value={t}>{CORR_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {genLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Mail className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No correspondence found</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredItems.map((item: any) => {
                const isOverdue = item.dueDate && isPast(new Date(item.dueDate)) && item.status !== "closed";
                const isSelected = selected?.id === item.id;
                const isFlagged = flagged.has(item.id);
                const isStarred = starred.has(item.id);
                return (
                  <div
                    key={`${item._source}-${item.id}`}
                    onClick={() => setSelected(item)}
                    className={`p-3 cursor-pointer transition-colors relative ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"} ${isOverdue ? "bg-red-50/50 dark:bg-red-950/5" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0"><PriorityIcon priority={item.priority ?? "medium"} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground"}`}>
                            {CORR_TYPE_LABELS[item.type] || item.type}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm font-medium mt-1 line-clamp-1">{item.subject}</p>
                        {item.referenceNumber && (
                          <p className="text-[10px] font-mono text-muted-foreground">{item.referenceNumber}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {isOverdue && <span className="text-[10px] text-red-500 flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />Overdue</span>}
                          {isFlagged && <Flag className="h-3 w-3 text-orange-500" />}
                          {isStarred && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                          {item._source === "general" && <Globe className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={e => { e.stopPropagation(); setFlagged(s => { const ns = new Set(s); ns.has(item.id) ? ns.delete(item.id) : ns.add(item.id); return ns; }); }}
                          className={`p-0.5 rounded hover:bg-orange-100 ${isFlagged ? "text-orange-500" : "text-muted-foreground/30"}`}>
                          <Flag className="h-3 w-3" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); setStarred(s => { const ns = new Set(s); ns.has(item.id) ? ns.delete(item.id) : ns.add(item.id); return ns; }); }}
                          className={`p-0.5 rounded hover:bg-yellow-100 ${isStarred ? "text-yellow-500" : "text-muted-foreground/30"}`}>
                          <Star className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="p-2 border-t text-xs text-muted-foreground text-center">
          {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* RIGHT: Preview Panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Mail className="h-16 w-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">Select an item to read</p>
            <p className="text-sm mt-1">Choose correspondence from the list to view details</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_COLORS[selected.type] ?? "bg-muted"}`}>
                      {CORR_TYPE_LABELS[selected.type] || selected.type}
                    </span>
                    {selected.referenceNumber && <span className="font-mono text-xs text-muted-foreground">{selected.referenceNumber}</span>}
                    <span className={`text-xs capitalize px-2 py-0.5 rounded-full font-medium ${
                      selected.priority === "urgent" ? "bg-red-100 text-red-700" :
                      selected.priority === "high" ? "bg-orange-100 text-orange-700" :
                      selected.priority === "medium" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}>{selected.priority || "medium"}</span>
                    {selected.status && <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{selected.status.replace(/_/g, " ")}</span>}
                  </div>
                  <h2 className="text-lg font-semibold mt-2 leading-snug">{selected.subject}</h2>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span>{format(new Date(selected.createdAt), "dd MMM yyyy HH:mm")}</span>
                    {selected.dueDate && (
                      <span className={isPast(new Date(selected.dueDate)) && selected.status !== "closed" ? "text-red-500 font-medium" : ""}>
                        Due: {format(new Date(selected.dueDate), "dd MMM yyyy")}
                        {isPast(new Date(selected.dueDate)) && selected.status !== "closed" && " (Overdue)"}
                      </span>
                    )}
                    {selected._source === "general" && <span className="flex items-center gap-0.5"><Globe className="h-3 w-3" /> General</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => { setReplyingToId(selected.id); setTimeout(() => document.getElementById("quick-reply-ta")?.focus(), 50); }}>
                    <Reply className="h-3.5 w-3.5" /> Reply
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleForward}>
                    <Send className="h-3.5 w-3.5" /> Forward
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelected(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Body */}
            <ScrollArea className="flex-1 p-4">
              <div className="max-w-2xl">
                {selected.body ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {selected.body}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm italic">No body content</p>
                )}

                {/* Attachments */}
                {selected.attachments && selected.attachments.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Paperclip className="h-3.5 w-3.5" /> Attachments ({selected.attachments.length})
                    </p>
                    <div className="space-y-1">
                      {selected.attachments.map((att: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1.5">
                          <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{att.fileName ?? att.name ?? "Attachment"}</span>
                          {att.fileUrl && (
                            <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0 text-xs">Download</a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Share Link */}
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Link2 className="h-3.5 w-3.5" /> Secure Share Link
                  </p>
                  {corrShareResult ? (
                    <div className="space-y-2">
                      <div className="bg-muted rounded-md p-2 text-xs font-mono break-all text-muted-foreground">{corrShareResult.shareUrl}</div>
                      {corrShareResult.expiresAt && <p className="text-xs text-amber-600">Expires: {format(new Date(corrShareResult.expiresAt), "dd MMM yyyy HH:mm")}</p>}
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1 text-xs gap-1" onClick={() => { navigator.clipboard.writeText(corrShareResult.shareUrl); toast({ title: "Link copied" }); }}>Copy Link</Button>
                        <Button variant="ghost" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => revokeCorrShare.mutate({ id: selected.id, source: selected._source })}>Revoke</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs font-medium mb-1">Expires in (days)</p>
                          <input type="number" min="1" max="365" value={corrShareForm.expiresInDays} onChange={e => setCorrShareForm(f => ({ ...f, expiresInDays: e.target.value }))} placeholder="30" className="w-full h-7 px-2 rounded border bg-background text-xs" />
                        </div>
                        <div>
                          <p className="text-xs font-medium mb-1">Password (optional)</p>
                          <input type="password" value={corrShareForm.password} onChange={e => setCorrShareForm(f => ({ ...f, password: e.target.value }))} placeholder="None" className="w-full h-7 px-2 rounded border bg-background text-xs" />
                        </div>
                      </div>
                      <Button size="sm" className="w-full gap-1.5 text-xs" onClick={() => createCorrShare.mutate({ id: selected.id, source: selected._source, ...corrShareForm })} disabled={createCorrShare.isPending}>
                        {createCorrShare.isPending ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</> : <><Link2 className="h-3 w-3" /> Generate Link</>}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Conversation Thread */}
                <div className="mt-6 pt-4 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" /> Conversation Thread
                    {threadReplies.length > 0 && <span className="ml-1 bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-xs">{threadReplies.length}</span>}
                  </p>
                  {threadReplies.length === 0 ? (
                    <div className="text-sm text-muted-foreground italic text-center py-4 border rounded-lg border-dashed">
                      No replies yet
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {threadReplies.map((reply: any) => (
                        <div key={reply.id} className="border rounded-lg p-3 bg-muted/30">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-semibold">{reply.fromName || "User"}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(reply.createdAt), "dd MMM yyyy HH:mm")}</span>
                            {reply.status && <span className="text-xs capitalize px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{reply.status}</span>}
                          </div>
                          <div className="text-sm whitespace-pre-wrap leading-relaxed">{reply.body || <span className="italic text-muted-foreground">No content</span>}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>

            {/* Quick Reply */}
            <div className="p-4 border-t bg-muted/20">
              {replyingToId && (
                <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Reply className="h-3 w-3" /> Replying to this message
                  <button onClick={() => setReplyingToId(null)} className="ml-1 hover:text-foreground"><X className="h-3 w-3" /></button>
                </div>
              )}
              <div className="flex gap-2">
                <Textarea
                  id="quick-reply-ta"
                  rows={2}
                  placeholder="Write a quick reply..."
                  className="flex-1 text-sm resize-none"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                />
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    className="gap-1.5 h-8"
                    disabled={!replyText.trim() || sendReply.isPending}
                    onClick={() => {
                      if (!selected || !replyText.trim()) return;
                      sendReply.mutate({
                        id: selected.id,
                        source: selected._source,
                        projectId: selected.projectId,
                        body: replyText,
                      });
                    }}
                  >
                    {sendReply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs gap-1">
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Compose Dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Correspondence</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {/* Type + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type *</Label>
                <Select value={compose.type} onValueChange={v => setCompose(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CORR_TYPES.map(t => <SelectItem key={t} value={t}>{CORR_TYPE_LABELS[t] || t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={compose.priority} onValueChange={v => setCompose(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high", "urgent"].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Project */}
            <div>
              <Label>Project (optional)</Label>
              <Select value={compose.projectId} onValueChange={v => setCompose(f => ({ ...f, projectId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="General (no project)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">General (no project)</SelectItem>
                  {projects.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* To Recipients */}
            <div>
              <Label>To (Recipients)</Label>
              <RecipientAutocomplete
                users={allUsers as RecipientUser[]}
                selectedIds={compose.toUserIds}
                onChange={ids => setCompose(f => ({ ...f, toUserIds: ids }))}
                placeholder="Search by name or email…"
                className="mt-1"
              />
            </div>
            {/* CC / BCC */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>CC (email addresses)</Label>
                <CCAutocomplete
                  users={allUsers as RecipientUser[]}
                  value={compose.cc}
                  onChange={v => setCompose(f => ({ ...f, cc: v }))}
                  placeholder="cc@example.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>BCC (email addresses)</Label>
                <CCAutocomplete
                  users={allUsers as RecipientUser[]}
                  value={compose.bcc}
                  onChange={v => setCompose(f => ({ ...f, bcc: v }))}
                  placeholder="bcc@example.com"
                  className="mt-1"
                />
              </div>
            </div>
            {/* Subject */}
            <div>
              <Label>Subject *</Label>
              <Input value={compose.subject} onChange={e => setCompose(f => ({ ...f, subject: e.target.value }))} placeholder="Enter subject..." className="mt-1" />
            </div>
            {/* Due Date + Task To */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={compose.dueDate} onChange={e => setCompose(f => ({ ...f, dueDate: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Task To (assign responsible)</Label>
                <RecipientAutocomplete
                  users={allUsers as RecipientUser[]}
                  selectedIds={compose.taskToId && compose.taskToId !== "_none" ? [parseInt(compose.taskToId)] : []}
                  onChange={ids => setCompose(f => ({ ...f, taskToId: ids[0] ? String(ids[0]) : "" }))}
                  placeholder="Search user…"
                  single
                  className="mt-1"
                />
              </div>
            </div>
            {/* Attachments */}
            <div>
              <Label className="flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Attachments</Label>
              <div className="mt-1">
                <FileDropZone
                  onUpload={file => setComposeAttachments(prev => [...prev, file])}
                  onMultiUpload={files => setComposeAttachments(prev => [...prev, ...files])}
                  label="Drop files or click to attach"
                  multiple
                />
                {composeAttachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {composeAttachments.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1">
                        <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                        <button type="button" onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))} className="text-destructive hover:bg-destructive/10 rounded p-0.5">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Body */}
            <div>
              <Label>Body</Label>
              <Textarea value={compose.body} onChange={e => setCompose(f => ({ ...f, body: e.target.value }))} rows={5} className="mt-1" placeholder="Write message..." />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setComposeOpen(false)} className="sm:mr-auto">Cancel</Button>
            <Button
              variant="outline"
              onClick={() => createCorr.mutate({ data: compose, sendNow: false })}
              disabled={createCorr.isPending || !compose.subject}
              className="gap-1.5"
            >
              {createCorr.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
              Save Draft
            </Button>
            <Button
              onClick={() => createCorr.mutate({ data: compose, sendNow: true })}
              disabled={createCorr.isPending || !compose.subject}
              className="gap-1.5"
            >
              {createCorr.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

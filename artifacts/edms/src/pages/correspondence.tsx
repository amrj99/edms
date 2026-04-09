import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isPast, parseISO } from "date-fns";
import {
  Mail, Inbox, Send, Folder, FolderOpen, Search, Plus, Flag, Star,
  RefreshCw, Filter, ChevronDown, ArrowUp, ArrowDown, Clock, AlertCircle,
  MessageSquare, Reply, ReplyAll, MoreHorizontal, X, Tag, Archive, Loader2,
  FolderKanban, Globe, CheckSquare, TriangleAlert, Paperclip, Link2, FileDown,
  Trash2, Square, CheckCheck, ChevronLeft, PanelLeftOpen, ExternalLink,
  Download, FileText, LinkIcon, Info,
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
import { RecipientAutocomplete, EmailChipInput, type RecipientUser } from "@/components/recipient-autocomplete";
import { SearchableSelect } from "@/components/ui/searchable-select";

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

type SortKey = "date" | "priority" | "subject" | "type" | "from" | "status" | "updatedAt";
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

  const [selectedFolder, setSelectedFolder] = useState<string>("inbox");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("all");
  const [searchQ, setSearchQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<any>(null);
  const [mobilePanel, setMobilePanel] = useState<"list" | "detail">("list");
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [starred, setStarred] = useState<Set<number>>(new Set());
  const [localReadIds, setLocalReadIds] = useState<Set<number>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [compose, setCompose] = useState<{
    subject: string; type: string; body: string; priority: string; dueDate: string;
    projectId: string; toUserIds: number[]; cc: string; bcc: string; taskToId: string;
    scope: string; referenceNumber: string;
  }>({ subject: "", type: "rfi", body: "", priority: "medium", dueDate: "", projectId: "", toUserIds: [], cc: "", bcc: "", taskToId: "", scope: "project", referenceNumber: "" });
  const [toPickUser, setToPickUser] = useState("");
  type UploadAttachment = { kind: "upload"; url: string; name: string; size: number };
  type RefAttachment = { kind: "ref"; documentId: number; name: string; documentNumber: string; fileUrl: string };
  type ComposeAttachment = UploadAttachment | RefAttachment;

  const [composeAttachments, setComposeAttachments] = useState<ComposeAttachment[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerSearch, setProjectPickerSearch] = useState("");
  const [corrShareOpen, setCorrShareOpen] = useState(false);
  const [corrShareForm, setCorrShareForm] = useState({ expiresInDays: "30", password: "" });
  const [corrShareResult, setCorrShareResult] = useState<{ shareUrl: string; expiresAt: string | null } | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  // Fetch projects
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects = projectsData?.projects ?? [];

  // Fetch all correspondence (general + all projects)
  const { data: generalData, isLoading: genLoading, refetch: refetchGeneral } = useQuery({
    queryKey: ["correspondence", "general"],
    queryFn: async () => { const r = await fetch("/api/correspondence"); return r.json(); },
  });
  const generalItems = generalData?.items ?? [];

  // Fetch project correspondence based on selected project or all
  const { data: projectCorrData, refetch: refetchProject } = useQuery({
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
    const projectMap = new Map(projects.map((p: any) => [p.id, p.name ?? p.code]));
    const normalize = (i: any, source: string) => ({
      ...i,
      _source: source,
      fromName: i.fromName ?? i.fromUserName,
      projectName: i.projectId ? (projectMap.get(i.projectId) ?? null) : null,
    });
    const combined = [...generalItems.map((i: any) => normalize(i, "general")),
                      ...projectItems.map((i: any) => normalize(i, "project"))];
    return combined;
  }, [generalItems, projectItems, projects]);

  // Handle ?openCorr=<id> URL param — auto-selects a specific correspondence item
  useEffect(() => {
    if (allItems.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("openCorr");
    if (!openId) return;
    const found = allItems.find((i: any) => String(i.id) === openId);
    if (found && !selected) {
      setSelected(found);
    }
  }, [allItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredItems = useMemo(() => {
    let items = allItems;

    // Folder filter
    if (selectedFolder === "inbox")   items = items.filter((i: any) => i.folder === "inbox");
    else if (selectedFolder === "sent")    items = items.filter((i: any) => i.folder === "sent");
    else if (selectedFolder === "draft")   items = items.filter((i: any) => i.folder === "draft");
    else if (selectedFolder === "archive") items = items.filter((i: any) => i.folder === "archive");
    else if (selectedFolder === "general") items = items.filter((i: any) => i._source === "general");
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
      else if (sortKey === "updatedAt") { av = new Date(a.updatedAt ?? a.createdAt).getTime(); bv = new Date(b.updatedAt ?? b.createdAt).getTime(); }
      else if (sortKey === "priority") {
        const order = ["urgent", "high", "medium", "low"];
        av = order.indexOf(a.priority ?? "low"); bv = order.indexOf(b.priority ?? "low");
      } else if (sortKey === "subject") { av = a.subject ?? ""; bv = b.subject ?? ""; }
      else if (sortKey === "type") { av = a.type ?? ""; bv = b.type ?? ""; }
      else if (sortKey === "from") { av = (a.fromName ?? "").toLowerCase(); bv = (b.fromName ?? "").toLowerCase(); }
      else if (sortKey === "status") { av = a.status ?? ""; bv = b.status ?? ""; }
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

  const composeProjectId = compose.projectId && compose.projectId !== "_none" ? parseInt(compose.projectId) : null;
  const { data: projectDocsData } = useQuery({
    queryKey: ["project-docs-picker", composeProjectId],
    queryFn: async () => {
      if (!composeProjectId) return { documents: [] };
      const r = await fetch(`/api/projects/${composeProjectId}/documents`);
      return r.json();
    },
    enabled: !!composeProjectId && projectPickerOpen,
  });
  const projectDocs: any[] = projectDocsData?.documents ?? [];
  const filteredProjectDocs = projectPickerSearch.trim()
    ? projectDocs.filter(d =>
        d.title?.toLowerCase().includes(projectPickerSearch.toLowerCase()) ||
        d.documentNumber?.toLowerCase().includes(projectPickerSearch.toLowerCase())
      )
    : projectDocs;

  const createCorr = useMutation({
    mutationFn: async ({ data, sendNow }: { data: typeof compose; sendNow: boolean }) => {
      const projectId = data.projectId && data.projectId !== "_none" ? parseInt(data.projectId) : null;
      // Respect the user's explicit scope choice — never override based on projectId alone.
      // internal + projectId → still internal (INT numbering), projectId stored as reference.
      // project + projectId  → project scope, routed through project endpoint.
      const effectiveScope = data.scope;
      const url = effectiveScope === "project" && projectId
        ? `/api/projects/${projectId}/correspondence`
        : `/api/correspondence`;
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
        attachments: composeAttachments.length > 0 ? composeAttachments.map(a =>
          a.kind === "ref"
            ? { fileName: a.name, fileUrl: a.fileUrl, documentNumber: a.documentNumber }
            : { fileName: a.name, fileUrl: a.url, fileSize: a.size }
        ) : undefined,
        scope: effectiveScope,
        // For internal scope with a project reference, pass projectId in the body
        // so the API stores it as a contextual reference (no scope override).
        projectId: effectiveScope === "internal" && projectId ? projectId : undefined,
        referenceNumber: data.referenceNumber?.trim() || undefined,
        sendNow,
        folder: "inbox",
      };
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create correspondence");
      }
      return r.json();
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["correspondence"] });
      setComposeOpen(false);
      setCompose({ subject: "", type: "rfi", body: "", priority: "medium", dueDate: "", projectId: "", toUserIds: [], cc: "", bcc: "", taskToId: "", scope: "project", referenceNumber: "" });
      setToPickUser("");
      setComposeAttachments([]);
      setShowBcc(false);
      toast({ title: vars.sendNow ? "Correspondence sent" : "Draft saved" });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Failed to create correspondence", variant: "destructive" }),
  });

  const createCorrShare = useMutation({
    mutationFn: async ({ id, source, expiresInDays, password }: { id: number; source: string; expiresInDays: string; password: string }) => {
      const url = source === "general"
        ? `/api/correspondence/${id}/share`
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
        ? `/api/correspondence/${id}/share`
        : `/api/projects/${selected?.projectId}/correspondence/${id}/share`;
      await fetch(url, { method: "DELETE" });
    },
    onSuccess: () => { setCorrShareResult(null); toast({ title: "Share link revoked" }); },
  });

  const sendReply = useMutation({
    mutationFn: async ({ id, source, projectId, body }: { id: number; source: string; projectId?: number | null; body: string }) => {
      const url = source === "general"
        ? `/api/correspondence/${id}/reply`
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

  const bulkKey = (item: any) => `${item._source}-${item.id}`;

  const bulkMarkRead = useMutation({
    mutationFn: async ({ isRead }: { isRead: boolean }) => {
      const targets = filteredItems.filter((i: any) => bulkSelected.has(bulkKey(i)));
      await Promise.all(targets.map((item: any) => {
        const endpoint = item._source === "general"
          ? `/api/correspondence/${item.id}/read`
          : `/api/projects/${item.projectId}/correspondence/${item.id}/read`;
        return fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isRead }) });
      }));
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["correspondence"] });
      setBulkSelected(new Set());
      setLocalReadIds(s => { const n = new Set(s); filteredItems.filter((i: any) => bulkSelected.has(bulkKey(i))).forEach((i: any) => vars.isRead ? n.add(i.id) : n.delete(i.id)); return n; });
      toast({ title: vars.isRead ? "Marked as read" : "Marked as unread" });
    },
  });

  const bulkArchive = useMutation({
    mutationFn: async () => {
      const targets = filteredItems.filter((i: any) => bulkSelected.has(bulkKey(i)));
      await Promise.all(targets.map((item: any) => {
        if (item._source === "general") {
          return fetch(`/api/correspondence/${item.id}/move`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: "archive" }),
          });
        }
        return fetch(`/api/projects/${item.projectId}/correspondence/${item.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: "archive" }),
        });
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["correspondence"] });
      setBulkSelected(new Set());
      toast({ title: "Archived" });
    },
  });

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const targets = filteredItems.filter((i: any) => bulkSelected.has(bulkKey(i)));
      await Promise.all(targets.map((item: any) => {
        if (item._source === "general") {
          return fetch(`/api/correspondence/${item.id}`, { method: "DELETE" });
        }
        return fetch(`/api/projects/${item.projectId}/correspondence/${item.id}`, { method: "DELETE" });
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["correspondence"] });
      setBulkSelected(new Set());
      if (selected && bulkSelected.has(bulkKey(selected))) setSelected(null);
      toast({ title: "Deleted" });
    },
  });

  const { data: threadData } = useQuery({
    queryKey: ["corr-thread", selected?.id, selected?._source],
    queryFn: async () => {
      if (!selected) return { items: [] };
      const url = selected._source === "general"
        ? `/api/correspondence?parentId=${selected.id}`
        : `/api/projects/${selected.projectId}/correspondence?parentId=${selected.id}`;
      const r = await fetch(url);
      if (!r.ok) return { items: [] };
      return r.json();
    },
    enabled: !!selected,
  });
  const threadReplies: any[] = threadData?.items ?? [];

  // Resolve the parent item when this correspondence has a parentId
  // First look in the already-loaded list; if not found, fetch from API
  const parentItemFromList = selected?.parentId
    ? allItems.find((i: any) => i.id === selected.parentId) ?? null
    : null;
  const { data: parentItemFetched } = useQuery({
    queryKey: ["corr-parent", selected?.parentId, selected?.projectId],
    queryFn: async () => {
      if (!selected?.parentId) return null;
      const url = `/api/projects/${selected.projectId}/correspondence/${selected.parentId}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!selected?.parentId && !parentItemFromList,
  });
  const parentItem: any = parentItemFromList ?? parentItemFetched ?? null;

  const markAsRead = useCallback(async (item: any) => {
    if (item.isRead || localReadIds.has(item.id)) return;
    setLocalReadIds(s => { const n = new Set(s); n.add(item.id); return n; });
    try {
      const endpoint = item._source === "general"
        ? `/api/correspondence/${item.id}/read`
        : `/api/projects/${item.projectId}/correspondence/${item.id}/read`;
      await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
    } catch { /* silent */ }
  }, [localReadIds]);

  const handleSelectItem = useCallback((item: any) => {
    setSelected(item);
    setMobilePanel("detail");
    markAsRead(item);
  }, [markAsRead]);

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
    setShowBcc(false);
    setComposeOpen(true);
  };

  const handleReplyAll = () => {
    if (!selected) return;
    // Include original sender + all recipients in "To"
    const allRecipientIds: number[] = [
      ...(selected.fromUserId ? [selected.fromUserId] : []),
      ...(selected.toUserIds ?? []),
    ].filter((id, idx, arr) => arr.indexOf(id) === idx);
    setCompose({
      subject: `Re: ${selected.subject}`,
      type: selected.type ?? "letter",
      body: `\n\n---------- Original message ----------\n${selected.body || ""}`,
      priority: selected.priority ?? "medium",
      dueDate: "",
      projectId: selected.projectId ? String(selected.projectId) : "_none",
      toUserIds: allRecipientIds,
      cc: selected.cc ?? "",
      bcc: "",
      taskToId: "",
    });
    setComposeAttachments([]);
    setShowBcc(false);
    setReplyingToId(selected.id);
    setComposeOpen(true);
  };

  const overdueCount = allItems.filter((i: any) => i.dueDate && isPast(new Date(i.dueDate)) && i.status !== "closed").length;
  const flaggedCount = flagged.size;

  const MAIL_FOLDERS = [
    { id: "inbox",   label: "Incoming",   icon: Inbox,   count: allItems.filter((i: any) => i.folder === "inbox").length },
    { id: "sent",    label: "Outgoing",   icon: Send,    count: allItems.filter((i: any) => i.folder === "sent").length },
    { id: "draft",   label: "Drafts",     icon: Folder,  count: allItems.filter((i: any) => i.folder === "draft").length },
    { id: "archive", label: "Archive",    icon: Archive, count: allItems.filter((i: any) => i.folder === "archive").length },
  ];
  const SMART_FOLDERS = [
    { id: "flagged",  label: "Flagged",  icon: Flag,        count: flaggedCount },
    { id: "starred",  label: "Starred",  icon: Star,        count: starred.size },
    { id: "overdue",  label: "Overdue",  icon: AlertCircle, count: overdueCount },
    { id: "projects", label: "Projects", icon: FolderKanban, count: projectItems.length },
    { id: "general",  label: "General",  icon: Globe,       count: generalItems.length },
  ];

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-4 md:-m-6 lg:-m-8 rounded-xl overflow-hidden border bg-card shadow-sm">
      {/* LEFT: Folder Panel — hidden on mobile */}
      <div className="hidden md:flex w-52 shrink-0 border-r bg-muted/30 flex-col">
        <div className="p-3 border-b">
          <Button size="sm" className="w-full gap-2" onClick={() => setComposeOpen(true)}>
            <Plus className="h-4 w-4" /> Compose
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground px-2 py-1 mt-1">Folders</p>
            {MAIL_FOLDERS.map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => { setSelectedFolder(id); setSelectedProjectId(null); setBulkSelected(new Set()); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${selectedFolder === id && !selectedProjectId ? "bg-primary text-white" : "hover:bg-accent text-foreground"}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
                {count > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full ${selectedFolder === id && !selectedProjectId ? "bg-white/20" : "bg-muted-foreground/20"}`}>{count}</span>}
              </button>
            ))}
            <p className="text-[10px] font-semibold uppercase text-muted-foreground px-2 py-1 mt-3">Smart Views</p>
            {SMART_FOLDERS.map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => { setSelectedFolder(id); setSelectedProjectId(null); setBulkSelected(new Set()); }}
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

      {/* MIDDLE: List Panel — full width on mobile, fixed on desktop; hidden on mobile when detail open */}
      <div className={`${mobilePanel === "detail" ? "hidden" : "flex"} md:flex w-full md:w-80 md:shrink-0 border-r flex-col`}>
        {/* Bulk action toolbar */}
        {bulkSelected.size > 0 && (
          <div className="px-3 py-2 border-b bg-primary/5 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setBulkSelected(bulkSelected.size === filteredItems.length ? new Set() : new Set(filteredItems.map(bulkKey)))}
              className="text-xs text-primary font-medium hover:underline"
            >
              {bulkSelected.size === filteredItems.length ? "Deselect all" : "Select all"}
            </button>
            <span className="text-xs text-muted-foreground">{bulkSelected.size} selected</span>
            <div className="flex gap-1 ml-auto">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => bulkMarkRead.mutate({ isRead: true })} disabled={bulkMarkRead.isPending}>
                <CheckCheck className="h-3 w-3" /> Read
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => bulkMarkRead.mutate({ isRead: false })} disabled={bulkMarkRead.isPending}>
                <Square className="h-3 w-3" /> Unread
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => bulkArchive.mutate()} disabled={bulkArchive.isPending}>
                <Archive className="h-3 w-3" /> Archive
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2 text-destructive hover:text-destructive" onClick={() => bulkDelete.mutate()} disabled={bulkDelete.isPending}>
                <Trash2 className="h-3 w-3" /> Delete
              </Button>
            </div>
          </div>
        )}
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
                  Sort: {sortKey === "updatedAt" ? "Updated" : sortKey.charAt(0).toUpperCase() + sortKey.slice(1)}
                  {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                {([
                  ["date", "Date Created"],
                  ["updatedAt", "Last Updated"],
                  ["priority", "Priority"],
                  ["subject", "Subject"],
                  ["type", "Type"],
                  ["from", "From"],
                  ["status", "Status"],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <DropdownMenuItem key={k} onClick={() => toggleSort(k)}>
                    {label} {sortKey === k && (sortDir === "asc" ? "↑" : "↓")}
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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0"
              title="Refresh"
              onClick={() => { refetchGeneral(); refetchProject(); }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
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
                    onClick={() => handleSelectItem(item)}
                    className={`p-3 cursor-pointer transition-colors relative ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"} ${isOverdue ? "bg-red-50/50 dark:bg-red-950/5" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); const k = bulkKey(item); setBulkSelected(s => { const ns = new Set(s); ns.has(k) ? ns.delete(k) : ns.add(k); return ns; }); }}
                        className={`mt-0.5 shrink-0 h-4 w-4 rounded border flex items-center justify-center transition-colors ${bulkSelected.has(bulkKey(item)) ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 hover:border-primary/50"}`}
                      >
                        {bulkSelected.has(bulkKey(item)) && <CheckSquare className="h-3 w-3" />}
                      </button>
                      <div className="mt-0.5 shrink-0 relative">
                        <PriorityIcon priority={item.priority ?? "medium"} />
                        {!item.isRead && !localReadIds.has(item.id) && (
                          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-500 ring-1 ring-background" title="Unread" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground"}`}>
                            {CORR_TYPE_LABELS[item.type] || item.type}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className={`text-sm mt-1 line-clamp-1 ${!item.isRead && !localReadIds.has(item.id) ? "font-semibold" : "font-medium"}`}>{item.subject}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {item.fromName && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={`From: ${item.fromName}`}>↩ {item.fromName}</span>
                          )}
                          {item.projectName && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]" title={`Project: ${item.projectName}`}>📁 {item.projectName}</span>
                          )}
                          {item.scope === "internal" && item.projectId && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 font-medium shrink-0">
                              Internal · Project Ref
                            </span>
                          )}
                          {item.referenceNumber && (
                            <span className="text-[10px] font-mono text-muted-foreground">{item.referenceNumber}</span>
                          )}
                        </div>
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

      {/* RIGHT: Preview Panel — full width on mobile when detail open */}
      <div className={`${mobilePanel === "list" ? "hidden" : "flex"} md:flex flex-1 flex-col min-w-0`}>
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
              {/* Mobile: back button row */}
              <button
                className="md:hidden flex items-center gap-1 text-xs text-muted-foreground mb-3 hover:text-foreground"
                onClick={() => setMobilePanel("list")}
              >
                <ChevronLeft className="h-4 w-4" /> Back to list
              </button>
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
                  <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleReplyAll}>
                    <ReplyAll className="h-3.5 w-3.5" /> Reply All
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleForward}>
                    <Send className="h-3.5 w-3.5" /> Forward
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelected(null); setMobilePanel("list"); }}>
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

                {/* In Reply To — shows when this item has a parent */}
                {selected.parentId && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5" /> In Reply To
                    </p>
                    {parentItem ? (
                      <button
                        className="w-full text-left rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors p-3 group"
                        onClick={() => setSelected(parentItem)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">{parentItem.subject}</p>
                            {parentItem.referenceNumber && (
                              <p className="text-[11px] text-muted-foreground font-mono">{parentItem.referenceNumber}</p>
                            )}
                            <p className="text-[11px] text-muted-foreground mt-0.5">{format(new Date(parentItem.createdAt), "dd MMM yyyy")}</p>
                          </div>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                        </div>
                      </button>
                    ) : (
                      <div className="text-xs text-muted-foreground italic py-2 px-3 rounded-lg border border-dashed">
                        Parent item #{selected.parentId} (not in current view)
                      </div>
                    )}
                  </div>
                )}

                {/* Conversation Thread */}
                <div className="mt-6 pt-4 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" /> Conversation Thread
                    {threadReplies.length > 0 && (
                      <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold">{threadReplies.length}</span>
                    )}
                  </p>

                  {/* Original message as first item in thread */}
                  <div className="relative pl-8 mb-4">
                    <div className="absolute left-0 top-1 h-7 w-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold shrink-0">
                      {(selected.fromName || selected.subject || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{selected.fromName || "Sender"}</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Original</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{format(new Date(selected.createdAt), "dd MMM yyyy · HH:mm")}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90 line-clamp-4">
                        {selected.body || <span className="italic text-muted-foreground">No content</span>}
                      </div>
                    </div>
                  </div>

                  {threadReplies.length === 0 ? (
                    <div className="text-sm text-muted-foreground italic text-center py-4 border rounded-lg border-dashed">
                      No replies yet — be the first to reply
                    </div>
                  ) : (
                    <div className="relative pl-8 space-y-3">
                      {/* Timeline line */}
                      <div className="absolute left-3 top-0 bottom-4 w-px bg-border" />
                      {threadReplies.map((reply: any, idx: number) => {
                        const initials = (reply.fromName || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                        const colors = ["bg-blue-500","bg-emerald-500","bg-amber-500","bg-violet-500","bg-rose-500","bg-cyan-500"];
                        const color = colors[idx % colors.length];
                        return (
                          <div key={reply.id} className="relative">
                            <div className={`absolute -left-5 top-1 h-7 w-7 rounded-full ${color} flex items-center justify-center text-white text-[10px] font-bold shrink-0 ring-2 ring-background`}>
                              {initials}
                            </div>
                            <div className="rounded-xl border bg-muted/20 p-3 hover:bg-muted/30 transition-colors">
                              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold">{reply.fromName || "User"}</span>
                                  {reply.status && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                                      {reply.status.replace(/_/g, " ")}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-muted-foreground">
                                  {format(new Date(reply.createdAt), "dd MMM yyyy · HH:mm")}
                                </span>
                              </div>
                              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                                {reply.body || <span className="italic text-muted-foreground">No content</span>}
                              </div>
                              {reply.attachments?.length > 0 && (
                                <div className="mt-2 pt-2 border-t flex flex-wrap gap-1">
                                  {reply.attachments.map((att: any, ai: number) => (
                                    <a
                                      key={ai}
                                      href={att.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] bg-background border rounded px-1.5 py-0.5 text-muted-foreground hover:text-primary"
                                    >
                                      <Paperclip className="h-2.5 w-2.5" />
                                      {att.fileName || "Attachment"}
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
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
            {/* Scope + Project */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Scope *</Label>
                <Select
                  value={compose.scope}
                  onValueChange={v => setCompose(f => ({ ...f, scope: v }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">Project</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  Related Project{" "}
                  <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
                </Label>
                <div className="mt-1">
                  <SearchableSelect
                    options={[
                      { value: "_none", label: "None" },
                      ...projects.map((p: any) => ({ value: String(p.id), label: p.code, sublabel: p.name })),
                    ]}
                    value={compose.projectId || "_none"}
                    onValueChange={v => {
                      setCompose(f => ({
                        ...f,
                        projectId: v,
                        // Only auto-set scope to "project" when picking a project in project scope;
                        // leave scope unchanged if already "internal".
                        scope: v && v !== "_none" && f.scope !== "internal" ? "project" : f.scope,
                      }));
                    }}
                    placeholder="No project"
                    searchPlaceholder="Search projects..."
                    emptyText="No projects found."
                  />
                </div>
                {/* Contextual hint when internal scope + project selected */}
                {compose.scope === "internal" && compose.projectId && compose.projectId !== "_none" && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground leading-tight">
                    <Info className="h-3 w-3 shrink-0 mt-0.5 text-blue-500" />
                    Internal correspondence related to project (reference only) — uses INT numbering, visible when filtering by this project.
                  </p>
                )}
              </div>
            </div>
            {/* Reference Number (optional) */}
            <div>
              <Label>
                Reference Number
                <span className="ml-1 text-xs text-muted-foreground font-normal">
                  (leave blank to auto-generate)
                </span>
              </Label>
              <Input
                value={compose.referenceNumber}
                onChange={e => setCompose(f => ({ ...f, referenceNumber: e.target.value }))}
                placeholder={
                  compose.scope === "internal"
                    ? "e.g. INT-2026-0001 or leave blank"
                    : "e.g. PROJA-2026-0001 or leave blank"
                }
                className="mt-1 font-mono text-sm"
              />
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
            {/* CC */}
            <div>
              <Label>CC</Label>
              <EmailChipInput
                users={allUsers as RecipientUser[]}
                value={compose.cc}
                onChange={v => setCompose(f => ({ ...f, cc: v }))}
                placeholder="Add email, press Enter or comma…"
                className="mt-1"
              />
            </div>
            {/* BCC — hidden by default, toggle with link */}
            {!showBcc ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-primary transition-colors w-fit -mt-1"
                onClick={() => setShowBcc(true)}
              >
                + Add BCC
              </button>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <Label>BCC</Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => { setShowBcc(false); setCompose(f => ({ ...f, bcc: "" })); }}
                  >
                    Remove BCC
                  </button>
                </div>
                <EmailChipInput
                  users={allUsers as RecipientUser[]}
                  value={compose.bcc}
                  onChange={v => setCompose(f => ({ ...f, bcc: v }))}
                  placeholder="Add email, press Enter or comma…"
                  className="mt-1"
                />
              </div>
            )}
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
              <div className="flex items-center justify-between mb-1">
                <Label className="flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Attachments</Label>
                {composeProjectId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => { setProjectPickerSearch(""); setProjectPickerOpen(true); }}
                  >
                    <LinkIcon className="h-3 w-3" /> Attach from Project
                  </Button>
                )}
              </div>
              <FileDropZone
                onUpload={file => setComposeAttachments(prev => [...prev, { kind: "upload", ...file }])}
                onMultiUpload={files => setComposeAttachments(prev => [...prev, ...files.map(f => ({ kind: "upload" as const, ...f }))])}
                label="Drop files or click to attach"
                multiple
              />
              {composeAttachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {composeAttachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1.5">
                      {att.kind === "ref"
                        ? <LinkIcon className="h-3 w-3 text-primary shrink-0" />
                        : <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <span className="truncate block font-medium">{att.name}</span>
                        {att.kind === "ref" && (
                          <span className="text-muted-foreground font-mono text-[10px]">{att.documentNumber}</span>
                        )}
                        {att.kind === "upload" && (
                          <span className="text-muted-foreground">{(att.size / 1024).toFixed(0)} KB</span>
                        )}
                      </div>
                      {att.kind === "ref" && att.fileUrl && (
                        <>
                          <a
                            href={att.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline shrink-0 flex items-center gap-0.5"
                            title="Open"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <a
                            href={att.fileUrl}
                            download
                            className="text-muted-foreground hover:text-foreground shrink-0 flex items-center gap-0.5"
                            title="Download"
                          >
                            <Download className="h-3 w-3" />
                          </a>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))}
                        className="text-destructive hover:bg-destructive/10 rounded p-0.5 shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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

      {/* Attach from Project dialog */}
      <Dialog open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4" /> Attach from Project
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input
              placeholder="Search documents…"
              value={projectPickerSearch}
              onChange={e => setProjectPickerSearch(e.target.value)}
              className="h-9"
              autoFocus
            />
            <ScrollArea className="h-64 border rounded-lg">
              {filteredProjectDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">
                    {projectPickerSearch ? "No matching documents" : "No documents in this project"}
                  </p>
                </div>
              ) : (
                <div className="p-1">
                  {filteredProjectDocs.map((doc: any) => {
                    const alreadyAdded = composeAttachments.some(a => a.kind === "ref" && a.documentId === doc.id);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        disabled={alreadyAdded}
                        className="w-full flex items-start gap-3 px-3 py-2 rounded-md hover:bg-accent text-left disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        onClick={() => {
                          if (alreadyAdded) return;
                          setComposeAttachments(prev => [
                            ...prev,
                            {
                              kind: "ref" as const,
                              documentId: doc.id,
                              name: doc.title,
                              documentNumber: doc.documentNumber,
                              fileUrl: doc.fileUrl ?? "",
                            },
                          ]);
                          setProjectPickerOpen(false);
                        }}
                      >
                        <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.title}</p>
                          <p className="text-xs text-muted-foreground font-mono">{doc.documentNumber}</p>
                          {doc.folderName && (
                            <p className="text-[10px] text-muted-foreground">{doc.folderName}</p>
                          )}
                        </div>
                        {alreadyAdded && (
                          <span className="text-xs text-muted-foreground shrink-0 self-center">Added</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectPickerOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

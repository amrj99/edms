import { useState } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isPast, parseISO } from "date-fns";
import {
  CalendarDays, Plus, X, ChevronRight, Clock, MapPin, Users, CheckSquare,
  FileText, Loader2, Check, Pencil, Trash2, User, AlertCircle, CheckCheck,
  CalendarClock, Paperclip, Mail, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useI18n } from "@/lib/i18n";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
};
const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled",
};
const ACTION_STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  done: "bg-green-100 text-green-700",
};

const BLANK_FORM = {
  title: "", projectId: "", meetingDate: "", duration: "", location: "", meetingLink: "", agenda: "", status: "scheduled",
};

// ─── Linked Correspondence mini-component ─────────────────────────────────────
function LinkedCorrespondence({ projectId }: { meetingId: number; projectId: number }) {
  const { data } = useQuery({
    queryKey: ["linked-correspondence", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/correspondence`);
      return r.json();
    },
  });
  const items: any[] = (data?.items ?? []).slice(0, 5);
  if (items.length === 0) return <p className="text-sm text-muted-foreground italic">No correspondence in this project.</p>;
  return (
    <div className="space-y-1.5">
      {items.map((item: any) => (
        <div key={item.id} className="flex items-center gap-2 p-2 border rounded text-xs">
          <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{item.subject}</p>
            <p className="text-muted-foreground">{item.referenceNumber} · {item.type?.toUpperCase()}</p>
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${item.status === "sent" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{item.status}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Linked Documents mini-component ─────────────────────────────────────────
function LinkedDocuments({ projectId }: { meetingId: number; projectId: number }) {
  const { data } = useQuery({
    queryKey: ["linked-documents", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents`);
      return r.json();
    },
  });
  const docs: any[] = (unwrapList<any>(data, "documents")).slice(0, 5);
  if (docs.length === 0) return <p className="text-sm text-muted-foreground italic">No documents in this project.</p>;
  return (
    <div className="space-y-1.5">
      {docs.map((doc: any) => (
        <div key={doc.id} className="flex items-center gap-2 p-2 border rounded text-xs">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{doc.title}</p>
            <p className="text-muted-foreground">{doc.documentNumber} · {doc.discipline}</p>
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${doc.status === "approved" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{doc.status}</span>
        </div>
      ))}
    </div>
  );
}

export default function MeetingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [minutesText, setMinutesText] = useState("");
  const [newAction, setNewAction] = useState({ title: "", assignedToName: "", dueDate: "", notes: "" });
  const [addingAction, setAddingAction] = useState(false);

  // ─── Data Fetching ────────────────────────────────────────────────────────────
  const { data: meetingsData, isLoading } = useQuery({
    queryKey: ["meetings", statusFilter, searchQ, projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchQ) params.set("q", searchQ);
      if (projectFilter !== "all") params.set("projectId", projectFilter);
      const r = await fetch(`/api/meetings?${params}`);
      return r.json();
    },
  });
  const meetings: any[] = meetingsData?.meetings ?? [];

  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["meeting-detail", selectedId],
    queryFn: async () => {
      const r = await fetch(`/api/meetings/${selectedId}`);
      return r.json();
    },
    enabled: !!selectedId,
  });
  const detail = detailData?.meeting ?? null;
  const attendees: any[] = detailData?.attendees ?? [];
  const actionItems: any[] = detailData?.actionItems ?? [];

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects: any[] = unwrapList<any>(projectsData, "projects");

  // ─── Mutations ────────────────────────────────────────────────────────────────
  const createMeeting = useMutation({
    mutationFn: async (data: typeof BLANK_FORM) => {
      const r = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          projectId: data.projectId && data.projectId !== "_none" ? parseInt(data.projectId) : undefined,
          meetingDate: data.meetingDate,
          duration: data.duration ? parseInt(data.duration) : undefined,
          location: data.location || undefined,
          meetingLink: data.meetingLink || undefined,
          agenda: data.agenda || undefined,
          status: data.status,
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Failed"); }
      return r.json();
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      setDialogOpen(false);
      setForm(BLANK_FORM);
      setSelectedId(d.meeting.id);
      toast({ title: editingId ? "Meeting updated" : "Meeting created" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed", variant: "destructive" }),
  });

  const updateMeeting = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof BLANK_FORM> & { minutes?: string } }) => {
      const r = await fetch(`/api/meetings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          projectId: data.projectId && data.projectId !== "_none" ? parseInt(data.projectId) : undefined,
          duration: data.duration ? parseInt(data.duration) : undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meeting-detail", selectedId] });
      setDialogOpen(false);
      setMinutesOpen(false);
      toast({ title: "Meeting updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const addActionItem = useMutation({
    mutationFn: async ({ meetingId, data }: { meetingId: number; data: typeof newAction }) => {
      const r = await fetch(`/api/meetings/${meetingId}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          assignedToName: data.assignedToName || undefined,
          dueDate: data.dueDate || undefined,
          notes: data.notes || undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      refetchDetail();
      setNewAction({ title: "", assignedToName: "", dueDate: "", notes: "" });
      setAddingAction(false);
      toast({ title: "Action item added" });
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const updateActionStatus = useMutation({
    mutationFn: async ({ meetingId, itemId, status }: { meetingId: number; itemId: number; status: string }) => {
      const r = await fetch(`/api/meetings/${meetingId}/action-items/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => refetchDetail(),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setDialogOpen(true);
  };

  const openEdit = () => {
    if (!detail) return;
    setEditingId(detail.id);
    setForm({
      title: detail.title,
      projectId: detail.projectId ? String(detail.projectId) : "_none",
      meetingDate: detail.meetingDate ? detail.meetingDate.slice(0, 16) : "",
      duration: detail.duration ? String(detail.duration) : "",
      location: detail.location || "",
      meetingLink: detail.meetingLink || "",
      agenda: detail.agenda || "",
      status: detail.status,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingId) {
      updateMeeting.mutate({ id: editingId, data: form });
    } else {
      createMeeting.mutate(form);
    }
  };

  const selected = meetings.find(m => m.id === selectedId) ?? null;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] -m-4 md:-m-6 lg:-m-8">
      {/* LEFT: Meeting List */}
      <div className="w-80 shrink-0 border-r flex flex-col bg-card">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-primary" /> Meetings
            </h2>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={openCreate}>
              <Plus className="h-3 w-3" /> New
            </Button>
          </div>
          <Input
            placeholder="Search meetings..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="h-7 text-xs"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : meetings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm px-4">
              <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-20" />
              No meetings found
            </div>
          ) : (
            <div className="divide-y">
              {meetings.map((m: any) => (
                <button
                  key={m.id}
                  className={`w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors ${selectedId === m.id ? "bg-accent border-l-2 border-primary" : ""}`}
                  onClick={() => setSelectedId(m.id)}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[m.status]}`}>
                          {STATUS_LABELS[m.status]}
                        </span>
                        {m.referenceNumber && (
                          <span className="font-mono text-xs text-muted-foreground">{m.referenceNumber}</span>
                        )}
                      </div>
                      <p className="text-sm font-medium leading-snug truncate">{m.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {format(new Date(m.meetingDate), "dd MMM yyyy, HH:mm")}
                        </span>
                      </div>
                      {m.project && (
                        <div className="mt-1">
                          <span className="inline-flex items-center gap-0.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                            <FileText className="h-2.5 w-2.5" />
                            {m.project.code} — {m.project.name}
                          </span>
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="p-2 border-t text-xs text-muted-foreground text-center">
          {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* RIGHT: Detail Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {!selectedId || !detail ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <CalendarDays className="h-16 w-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">Select a meeting</p>
            <p className="text-sm mt-1">Choose a meeting from the list to view details</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-5 border-b">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[detail.status]}`}>
                      {STATUS_LABELS[detail.status]}
                    </span>
                    {detail.referenceNumber && (
                      <span className="font-mono text-xs text-muted-foreground">{detail.referenceNumber}</span>
                    )}
                  </div>
                  <h2 className="text-xl font-semibold leading-snug">{detail.title}</h2>
                  <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {format(new Date(detail.meetingDate), "EEEE, dd MMMM yyyy 'at' HH:mm")}
                      {detail.duration && <span className="text-xs ml-1">({detail.duration} min)</span>}
                    </span>
                    {detail.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" /> {detail.location}
                      </span>
                    )}
                    {detail.meetingLink && (
                      <a
                        href={detail.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <Link2 className="h-4 w-4" /> Join Meeting
                      </a>
                    )}
                    {detail.project && (
                      <span className="flex items-center gap-1">
                        <FileText className="h-4 w-4" /> {detail.project.code} — {detail.project.name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={openEdit}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => { setMinutesText(detail.minutes || ""); setMinutesOpen(true); }}
                  >
                    <FileText className="h-3.5 w-3.5" /> Minutes
                  </Button>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="agenda" className="flex-1 flex flex-col overflow-hidden">
              <div className="px-5 border-b">
                <TabsList className="h-9">
                  <TabsTrigger value="agenda" className="text-xs">Agenda</TabsTrigger>
                  <TabsTrigger value="attendees" className="text-xs">
                    Attendees {attendees.length > 0 && <Badge variant="secondary" className="ml-1 text-xs h-4">{attendees.length}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="actions" className="text-xs">
                    Action Items {actionItems.length > 0 && <Badge variant="secondary" className="ml-1 text-xs h-4">{actionItems.length}</Badge>}
                  </TabsTrigger>
                  {detail.minutes && <TabsTrigger value="minutes" className="text-xs">Minutes</TabsTrigger>}
                  <TabsTrigger value="linked" className="text-xs">Linked</TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-5">
                  {/* Agenda Tab */}
                  <TabsContent value="agenda" className="mt-0">
                    {detail.agenda ? (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{detail.agenda}</div>
                    ) : (
                      <p className="text-muted-foreground text-sm italic">No agenda set for this meeting.</p>
                    )}
                    {detail.organizer && (
                      <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
                        Organized by: <span className="font-medium text-foreground">{detail.organizer.firstName} {detail.organizer.lastName}</span>
                      </div>
                    )}
                  </TabsContent>

                  {/* Attendees Tab */}
                  <TabsContent value="attendees" className="mt-0">
                    {attendees.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No attendees recorded.</p>
                    ) : (
                      <div className="space-y-2">
                        {attendees.map((att: any) => {
                          const name = att.user ? `${att.user.firstName} ${att.user.lastName}` : att.name || att.email || "Unknown";
                          const email = att.user?.email || att.email;
                          return (
                            <div key={att.id} className="flex items-center gap-3 p-2.5 border rounded-lg">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                                {name[0]?.toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{name}</p>
                                {email && <p className="text-xs text-muted-foreground">{email}</p>}
                              </div>
                              <button
                                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${att.attended ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                                onClick={() => updateActionStatus.mutate({ meetingId: detail.id, itemId: att.id, status: att.attended ? "open" : "done" })}
                              >
                                {att.attended ? <><CheckCheck className="h-3 w-3" /> Attended</> : <><User className="h-3 w-3" /> Absent</>}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* Action Items Tab */}
                  <TabsContent value="actions" className="mt-0">
                    <div className="space-y-2 mb-4">
                      {actionItems.length === 0 && !addingAction && (
                        <p className="text-sm text-muted-foreground italic">No action items yet.</p>
                      )}
                      {actionItems.map((item: any) => (
                        <div key={item.id} className="flex items-start gap-3 p-2.5 border rounded-lg">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ACTION_STATUS_COLORS[item.status] ?? "bg-gray-100 text-gray-500"}`}>
                                {item.status.replace(/_/g, " ")}
                              </span>
                              {item.dueDate && (
                                <span className={`text-xs flex items-center gap-0.5 ${isPast(new Date(item.dueDate)) && item.status !== "done" ? "text-red-500" : "text-muted-foreground"}`}>
                                  <AlertCircle className="h-3 w-3" /> {format(new Date(item.dueDate), "dd MMM yyyy")}
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium">{item.title}</p>
                            {item.assignedToName && <p className="text-xs text-muted-foreground">→ {item.assignedToName}</p>}
                            {item.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{item.notes}</p>}
                          </div>
                          <Select
                            value={item.status}
                            onValueChange={s => updateActionStatus.mutate({ meetingId: detail.id, itemId: item.id, status: s })}
                          >
                            <SelectTrigger className="h-7 text-xs w-28 shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>

                    {addingAction ? (
                      <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                        <p className="text-xs font-semibold text-muted-foreground">New Action Item</p>
                        <Input
                          placeholder="Action item title *"
                          value={newAction.title}
                          onChange={e => setNewAction(f => ({ ...f, title: e.target.value }))}
                          className="h-8 text-sm"
                          autoFocus
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Assigned to (name)"
                            value={newAction.assignedToName}
                            onChange={e => setNewAction(f => ({ ...f, assignedToName: e.target.value }))}
                            className="h-8 text-sm"
                          />
                          <Input
                            type="date"
                            value={newAction.dueDate}
                            onChange={e => setNewAction(f => ({ ...f, dueDate: e.target.value }))}
                            className="h-8 text-sm"
                          />
                        </div>
                        <Input
                          placeholder="Notes (optional)"
                          value={newAction.notes}
                          onChange={e => setNewAction(f => ({ ...f, notes: e.target.value }))}
                          className="h-8 text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={!newAction.title.trim() || addActionItem.isPending}
                            onClick={() => addActionItem.mutate({ meetingId: detail.id, data: newAction })}
                          >
                            {addActionItem.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Add
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setAddingAction(false)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddingAction(true)}>
                        <Plus className="h-3.5 w-3.5" /> Add Action Item
                      </Button>
                    )}
                  </TabsContent>

                  {/* Minutes Tab */}
                  {detail.minutes && (
                    <TabsContent value="minutes" className="mt-0">
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{detail.minutes}</div>
                    </TabsContent>
                  )}

                  {/* Linked Tab */}
                  <TabsContent value="linked" className="mt-0 space-y-5">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" /> Linked Correspondence
                      </p>
                      {detail.projectId ? (
                        <LinkedCorrespondence meetingId={detail.id} projectId={detail.projectId} />
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Assign a project to view linked correspondence.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" /> Linked Documents
                      </p>
                      {detail.projectId ? (
                        <LinkedDocuments meetingId={detail.id} projectId={detail.projectId} />
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Assign a project to view linked documents.</p>
                      )}
                    </div>
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("editMeeting") : t("newMeeting")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Meeting title..."
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date & Time *</Label>
                <Input
                  type="datetime-local"
                  value={form.meetingDate}
                  onChange={e => setForm(f => ({ ...f, meetingDate: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  value={form.duration}
                  onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
                  placeholder="60"
                  className="mt-1"
                  min={15}
                  step={15}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Project <span className="text-red-500">*</span></Label>
                <div className="mt-1">
                  <SearchableSelect
                    options={projects.map((p: any) => ({ value: String(p.id), label: p.code, sublabel: p.name }))}
                    value={form.projectId || ""}
                    onValueChange={v => setForm(f => ({ ...f, projectId: v }))}
                    placeholder="Select project..."
                    searchPlaceholder="Search projects..."
                    emptyText="No projects found."
                  />
                </div>
              </div>
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="Conference Room A, Building 2..."
                className="mt-1"
              />
            </div>
            <div>
              <Label className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Meeting Link (Teams / Zoom / Google Meet)</Label>
              <Input
                value={form.meetingLink}
                onChange={e => setForm(f => ({ ...f, meetingLink: e.target.value }))}
                placeholder="https://teams.microsoft.com/l/meetup-join/..."
                className="mt-1"
                type="url"
              />
            </div>
            <div>
              <Label>Agenda</Label>
              <Textarea
                value={form.agenda}
                onChange={e => setForm(f => ({ ...f, agenda: e.target.value }))}
                rows={4}
                placeholder="Meeting agenda items..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.title.trim() || !form.meetingDate || !form.projectId || form.projectId === "_none" || createMeeting.isPending || updateMeeting.isPending}
              className="gap-1.5"
            >
              {(createMeeting.isPending || updateMeeting.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {editingId ? t("saveMeeting") : t("createMeeting")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Minutes Dialog */}
      <Dialog open={minutesOpen} onOpenChange={setMinutesOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Meeting Minutes</DialogTitle>
          </DialogHeader>
          <Textarea
            value={minutesText}
            onChange={e => setMinutesText(e.target.value)}
            rows={15}
            placeholder="Record meeting minutes here..."
            className="font-mono text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMinutesOpen(false)}>Cancel</Button>
            <Button
              onClick={() => updateMeeting.mutate({ id: selectedId!, data: { minutes: minutesText } })}
              disabled={updateMeeting.isPending}
            >
              {updateMeeting.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Save Minutes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

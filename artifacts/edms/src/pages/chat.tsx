import { useState, useRef, useEffect, useCallback } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useModules } from "@/hooks/use-modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Search, Send, Paperclip, CornerDownRight, Hash, Building2,
  FolderKanban, Users, MoreVertical, Trash2, Edit2, LogOut, UserPlus,
  X, ChevronLeft, CheckCheck, AlertCircle, Mail,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format, isToday, isYesterday } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatUser {
  id: number;
  name: string;
  email: string;
  role?: string;
}

interface ChatGroup {
  id: number;
  name: string;
  description?: string;
  type: "project" | "department" | "general";
  projectId?: number;
  projectName?: string;
  department?: string;
  unreadCount: number;
  createdById: number;
  createdAt: string;
}

interface ChatMessage {
  id: number;
  groupId: number;
  userId: number;
  content: string | null;
  parentId?: number;
  messageType: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  isDeleted: boolean;
  isRead: boolean;
  editedAt?: string;
  createdAt: string;
  user: ChatUser | null;
}

interface GroupMember {
  id: number;
  userId: number;
  role: "admin" | "member";
  joinedAt: string;
  name: string;
  email: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function getAvatarColor(userId: number): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500",
    "bg-pink-500", "bg-teal-500", "bg-rose-500", "bg-indigo-500",
  ];
  return colors[userId % colors.length];
}

function formatMsgTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return `Yesterday ${format(d, "HH:mm")}`;
  return format(d, "dd MMM HH:mm");
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, dd MMMM yyyy");
}

function sameDay(a: string, b: string): boolean {
  return format(new Date(a), "yyyy-MM-dd") === format(new Date(b), "yyyy-MM-dd");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Group Icon ───────────────────────────────────────────────────────────────

function GroupTypeIcon({ type }: { type: string }) {
  if (type === "project") return <FolderKanban className="h-3 w-3" />;
  if (type === "department") return <Building2 className="h-3 w-3" />;
  return <Hash className="h-3 w-3" />;
}

// ─── Create Group Dialog ───────────────────────────────────────────────────────

function CreateGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"project" | "department" | "general">("general");
  const [projectId, setProjectId] = useState<string>("_none");
  const [department, setDepartment] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [userSearch, setUserSearch] = useState("");

  const { data: projectsData } = useQuery({
    queryKey: ["projects-list"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
    enabled: open,
  });
  const { data: usersData } = useQuery({
    queryKey: ["chat-users"],
    queryFn: async () => { const r = await fetch("/api/chat/users"); return r.json(); },
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (body: object) => {
      const r = await fetch("/api/chat/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      toast({ title: t("groupCreated") });
      onClose();
      setName(""); setDescription(""); setType("general"); setProjectId("_none"); setDepartment(""); setSelectedUsers([]);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const projects = unwrapList<any>(projectsData, "projects");
  const users: ChatUser[] = (usersData?.users ?? []).filter((u: ChatUser) => String(u.name).toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newGroup")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t("groupName")} *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groupName")} />
          </div>
          <div className="space-y-1">
            <Label>{t("groupDescription")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("groupDescription")} />
          </div>
          <div className="space-y-1">
            <Label>{t("groupType")}</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">{t("groupTypeGeneral")}</SelectItem>
                <SelectItem value="project">{t("groupTypeProject")}</SelectItem>
                <SelectItem value="department">{t("groupTypeDept")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "project" && (
            <div className="space-y-1">
              <Label>{t("linkToProject")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "department" && (
            <div className="space-y-1">
              <Label>{t("linkToDept")}</Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Engineering" />
            </div>
          )}
          <div className="space-y-2">
            <Label>{t("addMembers")}</Label>
            <Input placeholder="Search users..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
            <ScrollArea className="h-40 border rounded-md p-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-2 py-1 px-1 hover:bg-muted rounded cursor-pointer" onClick={() => setSelectedUsers((prev) => prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id])}>
                  <Checkbox checked={selectedUsers.includes(u.id)} readOnly />
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className={`text-xs text-white ${getAvatarColor(u.id)}`}>{getInitials(u.name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{u.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{u.email}</span>
                </div>
              ))}
            </ScrollArea>
            {selectedUsers.length > 0 && (
              <p className="text-xs text-muted-foreground">{selectedUsers.length} member(s) selected</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createMutation.mutate({ name, description, type, projectId: projectId !== "_none" ? parseInt(projectId) : undefined, department: department || undefined, memberIds: selectedUsers })} disabled={!name.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : t("createGroup")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage Members Dialog ─────────────────────────────────────────────────────

function ManageMembersDialog({ open, onClose, groupId }: { open: boolean; onClose: () => void; groupId: number }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [userSearch, setUserSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);

  const { data: membersData, refetch: refetchMembers } = useQuery({
    queryKey: ["chat-members", groupId],
    queryFn: async () => { const r = await fetch(`/api/chat/groups/${groupId}/members`); return r.json(); },
    enabled: open,
  });
  const { data: usersData } = useQuery({
    queryKey: ["chat-users"],
    queryFn: async () => { const r = await fetch("/api/chat/users"); return r.json(); },
    enabled: open,
  });

  const members: GroupMember[] = membersData?.members ?? [];
  const memberIds = new Set(members.map((m) => m.userId));
  const nonMembers: ChatUser[] = (usersData?.users ?? []).filter((u: ChatUser) => !memberIds.has(u.id) && (u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase())));

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/chat/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userIds: selectedUsers }) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["chat-members", groupId] }); refetchMembers(); setSelectedUsers([]); toast({ title: "Members added" }); },
    onError: () => toast({ title: "Failed to add members", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: number) => {
      const r = await fetch(`/api/chat/groups/${groupId}/members/${userId}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["chat-members", groupId] }); refetchMembers(); toast({ title: "Member removed" }); },
    onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("manageMembers")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold uppercase text-muted-foreground mb-2 block">Current Members ({members.length})</Label>
            <ScrollArea className="h-36 border rounded-md">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className={`text-xs text-white ${getAvatarColor(m.userId)}`}>{getInitials(m.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.name}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{m.role}</Badge>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeMutation.mutate(m.userId)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </ScrollArea>
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase text-muted-foreground mb-2 block">Add Members</Label>
            <Input placeholder="Search users..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="mb-2" />
            <ScrollArea className="h-36 border rounded-md">
              {nonMembers.map((u) => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer" onClick={() => setSelectedUsers((prev) => prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id])}>
                  <Checkbox checked={selectedUsers.includes(u.id)} readOnly />
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className={`text-xs text-white ${getAvatarColor(u.id)}`}>{getInitials(u.name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{u.name}</span>
                </div>
              ))}
              {nonMembers.length === 0 && (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4">All users are already members</div>
              )}
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => addMutation.mutate()} disabled={selectedUsers.length === 0 || addMutation.isPending}>
            Add {selectedUsers.length > 0 ? `(${selectedUsers.length})` : ""} Members
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isOwn,
  onReply,
  onDelete,
  showAvatar,
  showDayLabel,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onReply: (msg: ChatMessage) => void;
  onDelete: (id: number) => void;
  showAvatar: boolean;
  showDayLabel: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {showDayLabel && (
        <div className="flex items-center gap-3 py-2">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground font-medium px-2">{formatDayLabel(message.createdAt)}</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      <div className={`flex gap-2 group ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
        {showAvatar ? (
          <Avatar className="h-8 w-8 flex-shrink-0 mt-1">
            <AvatarFallback className={`text-xs text-white ${getAvatarColor(message.userId)}`}>
              {message.user ? getInitials(message.user.name) : "?"}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className="w-8 flex-shrink-0" />
        )}
        <div className={`flex flex-col max-w-[70%] ${isOwn ? "items-end" : "items-start"}`}>
          {showAvatar && !isOwn && (
            <span className="text-xs text-muted-foreground font-medium mb-0.5 px-1">{message.user?.name ?? "Unknown"}</span>
          )}
          {message.parentId && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1 px-1">
              <CornerDownRight className="h-3 w-3" />
              <span>Reply</span>
            </div>
          )}
          <div
            className={`rounded-2xl px-3.5 py-2 text-sm break-words relative ${
              isOwn
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted rounded-bl-sm"
            } ${message.isDeleted ? "opacity-60 italic" : ""}`}
          >
            {message.isDeleted ? (
              <span className="text-xs">{t("messageDeleted")}</span>
            ) : message.messageType === "file" ? (
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 flex-shrink-0" />
                <div>
                  <a href={message.fileUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium text-sm">
                    {message.fileName ?? "Attachment"}
                  </a>
                  {message.fileSize && (
                    <div className="text-xs opacity-70">{formatFileSize(message.fileSize)}</div>
                  )}
                </div>
              </div>
            ) : (
              <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
            )}
          </div>
          <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
            <span className="text-xs text-muted-foreground">{formatMsgTime(message.createdAt)}</span>
            {isOwn && message.isRead && <CheckCheck className="h-3 w-3 text-blue-500" />}
            {message.editedAt && <span className="text-xs text-muted-foreground">(edited)</span>}
          </div>
        </div>
        {!message.isDeleted && (
          <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity self-center ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onReply(message)} title={t("reply")}>
              <CornerDownRight className="h-3 w-3" />
            </Button>
            {isOwn && (
              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => onDelete(message.id)} title={t("deleteMessage")}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main Chat Page ────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [location] = useLocation();
  const { modules } = useModules();

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [messageText, setMessageText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [manageMembersGroupId, setManageMembersGroupId] = useState<number | null>(null);
  const [fileUploading, setFileUploading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse group ID from URL query param ?group=X
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gId = params.get("group");
    if (gId) setSelectedGroupId(parseInt(gId));
  }, [location]);

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const { data: groupsData, isError: isGroupsError, error: groupsError, refetch: refetchGroups } = useQuery({
    queryKey: ["chat-groups"],
    queryFn: async () => {
      const r = await fetch("/api/chat/groups");
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw Object.assign(new Error(body.message ?? "Failed to load chat"), { code: body.error, status: r.status });
      }
      return r.json();
    },
    refetchInterval: 5000,
  });

  const groups: ChatGroup[] = groupsData?.groups ?? [];
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  const { data: messagesData, refetch: refetchMessages } = useQuery({
    queryKey: ["chat-messages", selectedGroupId, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "60" });
      if (searchQuery) params.set("q", searchQuery);
      const r = await fetch(`/api/chat/groups/${selectedGroupId}/messages?${params}`);
      return r.json();
    },
    enabled: !!selectedGroupId,
    refetchInterval: 3000,
  });

  const messages: ChatMessage[] = messagesData?.messages ?? [];

  const { data: groupDetail } = useQuery({
    queryKey: ["chat-group-detail", selectedGroupId],
    queryFn: async () => { const r = await fetch(`/api/chat/groups/${selectedGroupId}`); return r.json(); },
    enabled: !!selectedGroupId,
  });
  const members: GroupMember[] = groupDetail?.members ?? [];

  // ─── Auto-scroll to bottom ─────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedGroupId]);

  // ─── Mark all as read when group selected ─────────────────────────────────

  useEffect(() => {
    if (!selectedGroupId) return;
    fetch(`/api/chat/groups/${selectedGroupId}/read-all`, { method: "POST" }).then(() => {
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    });
  }, [selectedGroupId]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: async (body: object) => {
      const r = await fetch(`/api/chat/groups/${selectedGroupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to send");
      return r.json();
    },
    onSuccess: () => {
      setMessageText("");
      setReplyTo(null);
      refetchMessages();
      refetchGroups();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (msgId: number) => {
      const r = await fetch(`/api/chat/groups/${selectedGroupId}/messages/${msgId}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => refetchMessages(),
    onError: () => toast({ title: "Failed to delete message", variant: "destructive" }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      const r = await fetch(`/api/chat/groups/${groupId}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      setSelectedGroupId(null);
      toast({ title: t("groupDeleted") });
    },
    onError: () => toast({ title: "Failed to delete group", variant: "destructive" }),
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      const r = await fetch(`/api/chat/groups/${groupId}/members/${user!.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      setSelectedGroupId(null);
      toast({ title: "Left group" });
    },
    onError: () => toast({ title: "Failed to leave group", variant: "destructive" }),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    if (!messageText.trim() || !selectedGroupId) return;
    sendMutation.mutate({ content: messageText, parentId: replyTo?.id ?? null });
  }, [messageText, selectedGroupId, replyTo]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedGroupId) return;
    setFileUploading(true);
    try {
      const reqRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, folder: "chat" }),
      });
      if (!reqRes.ok) throw new Error("Upload request failed");
      const { uploadUrl, publicUrl, storagePath } = await reqRes.json();

      await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });

      sendMutation.mutate({
        content: file.name,
        messageType: "file",
        fileUrl: publicUrl ?? storagePath,
        fileName: file.name,
        fileSize: file.size,
        parentId: replyTo?.id ?? null,
      });
    } catch {
      toast({ title: "File upload failed", variant: "destructive" });
    } finally {
      setFileUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const canManageGroup = (group: ChatGroup) => {
    if (!user) return false;
    return user.role === "admin" || user.role === "system_owner" || group.createdById === user.id;
  };

  // ─── Filter groups ─────────────────────────────────────────────────────────

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
    (g.projectName ?? "").toLowerCase().includes(groupSearch.toLowerCase()) ||
    (g.department ?? "").toLowerCase().includes(groupSearch.toLowerCase())
  );

  const totalUnread = groups.reduce((sum, g) => sum + g.unreadCount, 0);
  const hasOrg = !!(user as any)?.organizationId;

  if (!modules.chat || (isGroupsError && (groupsError as any)?.code === "MODULE_DISABLED")) {
    return null;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background">
      {/* ── Left Panel: Group List ─────────────────────────────────────────── */}
      <div className={`flex flex-col border-r bg-card w-80 flex-shrink-0 ${selectedGroupId ? "hidden md:flex" : "flex"}`}>
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-lg">{t("chat")}</h2>
              {totalUnread > 0 && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0.5 rounded-full">{totalUnread}</Badge>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => hasOrg ? setCreateOpen(true) : toast({ title: "Organization required", description: "You must belong to an organization to create chat groups. Contact your admin to be assigned.", variant: "destructive" })}
              title={hasOrg ? "New group" : "Organization required to create groups"}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-8 text-sm" placeholder="Search groups..." value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
          </div>
        </div>

        {/* No-org warning banner */}
        {!hasOrg && (
          <div className="mx-3 mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1">No organization assigned</p>
                <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                  You need to be assigned to an organization to create or join chat groups. Contact your system administrator.
                </p>
                <a
                  href="mailto:admin@arcscale.com"
                  className="inline-flex items-center gap-1 mt-2 text-amber-700 dark:text-amber-400 underline hover:no-underline font-medium"
                >
                  <Mail className="h-3 w-3" /> Contact Admin
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Group List */}
        <ScrollArea className="flex-1">
          {filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Hash className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium text-sm">{t("noGroups")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("noGroupsDesc")}</p>
              {hasOrg ? (
                <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" />
                  {t("newGroup")}
                </Button>
              ) : (
                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Assign an organization to your account to get started.
                </p>
              )}
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {filteredGroups.map((group) => (
                <button
                  key={group.id}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors hover:bg-muted ${selectedGroupId === group.id ? "bg-primary/10 border border-primary/20" : ""}`}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 text-muted-foreground">
                      <GroupTypeIcon type={group.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium truncate ${group.unreadCount > 0 ? "font-semibold" : ""}`}>{group.name}</span>
                        {group.unreadCount > 0 && (
                          <Badge variant="destructive" className="text-xs px-1.5 py-0 rounded-full ml-auto flex-shrink-0">{group.unreadCount}</Badge>
                        )}
                      </div>
                      {(group.projectName || group.department) && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-muted-foreground truncate">
                            {group.projectName ?? group.department}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Right Panel: Message Thread ────────────────────────────────────── */}
      {!selectedGroupId ? (
        <div className="hidden md:flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Hash className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium text-muted-foreground">{t("selectGroup")}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Group Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-card flex-shrink-0">
            <Button size="icon" variant="ghost" className="md:hidden h-8 w-8" onClick={() => setSelectedGroupId(null)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-muted-foreground">
              <GroupTypeIcon type={selectedGroup?.type ?? "general"} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{selectedGroup?.name}</h3>
              {(selectedGroup?.projectName || selectedGroup?.department) && (
                <p className="text-xs text-muted-foreground truncate">{selectedGroup.projectName ?? selectedGroup.department}</p>
              )}
            </div>
            {/* Search within group */}
            <div className="relative hidden sm:block">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-7 h-7 text-xs w-40" placeholder={t("searchMessages")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{members.length}</span>
            </div>
            {/* Group actions dropdown */}
            {canManageGroup(selectedGroup!) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setManageMembersGroupId(selectedGroupId)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    {t("manageMembers")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => deleteGroupMutation.mutate(selectedGroupId)}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t("deleteGroup")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!canManageGroup(selectedGroup!) && (
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => leaveGroupMutation.mutate(selectedGroupId)}>
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Messages Area */}
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Hash className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="font-medium">{t("noMessages")}</p>
                <p className="text-sm text-muted-foreground mt-1">{t("noMessagesDesc")}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map((msg, idx) => {
                  const prev = idx > 0 ? messages[idx - 1] : null;
                  const isOwn = msg.userId === user?.id;
                  const showAvatar = !prev || prev.userId !== msg.userId || new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000;
                  const showDayLabel = !prev || !sameDay(prev.createdAt, msg.createdAt);
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isOwn={isOwn}
                      showAvatar={showAvatar}
                      showDayLabel={showDayLabel}
                      onReply={(m) => { setReplyTo(m); textareaRef.current?.focus(); }}
                      onDelete={(id) => deleteMutation.mutate(id)}
                    />
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </ScrollArea>

          {/* Reply Banner */}
          {replyTo && (
            <div className="px-4 py-2 bg-muted/50 border-t flex items-center gap-2 text-sm">
              <CornerDownRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">Replying to</span>
              <span className="font-medium truncate">{replyTo.user?.name ?? "Unknown"}</span>
              <span className="text-muted-foreground truncate flex-1">: {replyTo.content?.slice(0, 60)}</span>
              <Button size="icon" variant="ghost" className="h-5 w-5 flex-shrink-0" onClick={() => setReplyTo(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Compose Area */}
          <div className="px-4 py-3 border-t bg-card flex-shrink-0">
            <div className="flex items-end gap-2 bg-muted rounded-xl px-3 py-2">
              <Textarea
                ref={textareaRef}
                className="flex-1 bg-transparent border-0 shadow-none focus-visible:ring-0 resize-none text-sm min-h-[36px] max-h-32 p-0"
                placeholder={t("sendMessage")}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <div className="flex items-center gap-1 pb-0.5">
                <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={handleFileChange} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={fileUploading}
                  title={t("attachFile")}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleSend}
                  disabled={!messageText.trim() || sendMutation.isPending}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1 px-1">Press Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <CreateGroupDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {manageMembersGroupId && (
        <ManageMembersDialog
          open={!!manageMembersGroupId}
          onClose={() => setManageMembersGroupId(null)}
          groupId={manageMembersGroupId}
        />
      )}
    </div>
  );
}

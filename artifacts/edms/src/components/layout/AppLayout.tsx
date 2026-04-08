import { ReactNode, useEffect, useState } from "react";
import { TermsGate } from "@/components/legal/TermsGate";
import { TermsOfUseModal, PrivacyPolicyModal } from "@/components/legal/LegalModals";
import { useRealtime } from "@/hooks/use-realtime";
import { AICommandAssistant } from "@/components/AICommandAssistant";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/hooks/use-theme";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgContext } from "@/lib/org-context";

import {
  Brain, Building2, CheckSquare, FolderKanban, Home, Inbox, LogOut, Moon,
  Search, Settings, Sun, Users, Bell, BarChart3, SlidersHorizontal, Send,
  X, Check, CheckCheck, Mail, Clock, ChevronDown, ChevronRight, ShieldCheck,
  History, Star, FileText, ClipboardList, AlertCircle, ClipboardCheck, User,
  CalendarDays, FileSearch, Hash, Loader2, ListTodo, TrendingUp, MessageSquare,
  ExternalLink, Menu, MoreHorizontal, Eye, EyeOff, Trash2, CreditCard, Layers,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
  SidebarHeader, SidebarFooter, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useModules } from "@/hooks/use-modules";

// ─── Recent Projects helpers ──────────────────────────────────────────────────
const RECENT_KEY = "edms_recent_projects";
export function trackRecentProject(project: { id: number; code: string; name: string }) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: typeof project[] = raw ? JSON.parse(raw) : [];
    const filtered = list.filter(p => p.id !== project.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([project, ...filtered].slice(0, 5)));
  } catch {}
}
function getRecentProjects(): { id: number; code: string; name: string }[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ─── Notification Bell ────────────────────────────────────────────────────────
const NOTIF_FILTER_GROUPS = [
  { key: "all", labelKey: "notifAll" as const },
  { key: "documents", labelKey: "notifDocs" as const, types: ["document_uploaded","document_approved","document_rejected","document_approval_request","workflow_action_required","rfi_opened","rfi_responded","submittal_returned"] },
  { key: "tasks", labelKey: "notifTasks" as const, types: ["task_assigned","task_overdue","task_status_updated","action_item_assigned"] },
  { key: "correspondence", labelKey: "notifMail" as const, types: ["correspondence_received","transmittal_received","transmittal_acknowledged"] },
  { key: "meetings", labelKey: "notifMeetings" as const, types: ["meeting_assigned","meeting_reminder"] },
  { key: "chat", labelKey: "notifChat" as const, types: ["chat_message","mention"] },
];

function NotificationIcon(type: string) {
  if (type === "task_assigned" || type === "task_overdue" || type === "task_status_updated") return <CheckSquare className="h-4 w-4 text-blue-500" />;
  if (type === "action_item_assigned") return <CheckSquare className="h-4 w-4 text-violet-500" />;
  if (type === "document_approval_request") return <FolderKanban className="h-4 w-4 text-amber-500" />;
  if (type === "document_approved") return <FolderKanban className="h-4 w-4 text-green-600" />;
  if (type === "document_rejected") return <FolderKanban className="h-4 w-4 text-red-500" />;
  if (type.startsWith("document") || type.startsWith("rfi") || type.startsWith("submittal") || type === "workflow_action_required") return <FolderKanban className="h-4 w-4 text-green-500" />;
  if (type.startsWith("transmittal")) return <Send className="h-4 w-4 text-purple-500" />;
  if (type === "correspondence_received") return <Mail className="h-4 w-4 text-orange-500" />;
  if (type === "meeting_assigned") return <CalendarDays className="h-4 w-4 text-indigo-500" />;
  if (type === "meeting_reminder") return <CalendarDays className="h-4 w-4 text-amber-500" />;
  if (type === "chat_message" || type === "mention") return <MessageSquare className="h-4 w-4 text-cyan-500" />;
  return <Bell className="h-4 w-4 text-muted-foreground" />;
}

function NotificationBell() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const { t, isRtl } = useI18n();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => { const r = await fetch("/api/notifications"); return r.json(); },
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => { await fetch(`/api/notifications/${id}/read`, { method: "POST" }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markUnread = useMutation({
    mutationFn: async (id: number) => { await fetch(`/api/notifications/${id}/unread`, { method: "POST" }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteNotif = useMutation({
    mutationFn: async (id: number) => { await fetch(`/api/notifications/${id}`, { method: "DELETE" }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => { await fetch("/api/notifications/read-all", { method: "POST" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast({ title: t("notifMarkAllRead") }); },
  });

  const notifications: any[] = data?.notifications ?? [];
  const unreadCount: number = data?.unreadCount ?? 0;

  const activeGroup = NOTIF_FILTER_GROUPS.find(g => g.key === filterType);
  const filtered = activeGroup && "types" in activeGroup
    ? notifications.filter(n => (activeGroup.types as string[]).includes(n.type))
    : notifications;

  const handleNotificationClick = (n: any) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.actionUrl) { navigate(n.actionUrl); setOpen(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className={`absolute -top-1 h-5 w-5 p-0 flex items-center justify-center text-[10px] ${isRtl ? "-left-1" : "-right-1"}`}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="font-semibold">{t("notifBell")}</span>
            {unreadCount > 0 && <Badge variant="secondary">{unreadCount}</Badge>}
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} className="h-7 text-xs gap-1">
              <CheckCheck className="h-3 w-3" /> {t("notifMarkAllRead")}
            </Button>
          )}
        </div>
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {NOTIF_FILTER_GROUPS.map(g => (
            <button
              key={g.key}
              onClick={() => setFilterType(g.key)}
              className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${filterType === g.key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}
            >
              {t(g.labelKey)}
            </button>
          ))}
        </div>
        <div className="border-t" />
        <ScrollArea className="h-[360px]">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm font-medium">{t("notifEmpty")}</p>
              <p className="text-xs mt-1">{t("notifEmptyDesc")}</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((n: any) => (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 p-4 hover:bg-accent/50 transition-colors ${!n.isRead ? "bg-primary/5" : ""}`}
                >
                  <div
                    className="mt-0.5 shrink-0 cursor-pointer"
                    onClick={() => handleNotificationClick(n)}
                  >
                    {NotificationIcon(n.type)}
                  </div>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => handleNotificationClick(n)}
                  >
                    <p className={`text-sm ${!n.isRead ? "font-medium" : "text-muted-foreground"}`}>{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary" />}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={e => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {n.isRead
                          ? <DropdownMenuItem onClick={e => { e.stopPropagation(); markUnread.mutate(n.id); }}>
                              <EyeOff className="h-3.5 w-3.5 mr-2" /> {t("notifMarkUnread")}
                            </DropdownMenuItem>
                          : <DropdownMenuItem onClick={e => { e.stopPropagation(); markRead.mutate(n.id); }}>
                              <Eye className="h-3.5 w-3.5 mr-2" /> {t("notifMarkRead")}
                            </DropdownMenuItem>
                        }
                        {n.actionUrl && (
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); navigate(n.actionUrl); setOpen(false); }}>
                            <ExternalLink className="h-3.5 w-3.5 mr-2" /> {t("globalOpenResult")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={e => { e.stopPropagation(); deleteNotif.mutate(n.id); }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> {t("notifDelete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ─── Global Project Switcher ──────────────────────────────────────────────────
const STATUS_BADGE_COLORS: Record<string, string> = {
  active:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  on_hold:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  cancelled: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
  planning:  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
};

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const [location, navigate] = useLocation();
  const { t, isRtl } = useI18n();

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects: any[] = projectsData?.projects ?? [];

  // Detect the current project from the URL
  const projectIdFromUrl = (() => {
    const m = location.match(/^\/projects\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  })();
  const currentProject = projectIdFromUrl ? projects.find(p => p.id === projectIdFromUrl) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-auto py-1 px-2.5 gap-1.5 text-xs hidden md:flex flex-col items-start max-w-[200px] hover:border-primary/50"
        >
          <span className="text-[10px] text-muted-foreground leading-none font-normal w-full">
            {currentProject ? "Current Project" : t("switchProject")}
          </span>
          <span className="flex items-center gap-1.5 w-full">
            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate font-medium text-foreground leading-none">
              {currentProject
                ? `${currentProject.name} (${currentProject.code})`
                : t("switchProject")}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground ml-auto" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" dir={isRtl ? "rtl" : "ltr"}>
        <Command>
          <CommandInput placeholder="Search projects…" className="h-9" />
          <CommandEmpty>{t("globalNoResults")}</CommandEmpty>
          <CommandGroup heading={t("navProjects")}>
            <ScrollArea className="max-h-80">
              {projects.map((p: any) => {
                const isCurrent = p.id === projectIdFromUrl;
                const statusColor = STATUS_BADGE_COLORS[p.status] ?? "bg-muted text-muted-foreground";
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.code} ${p.name}`}
                    onSelect={() => {
                      trackRecentProject({ id: p.id, code: p.code, name: p.name });
                      navigate(`/projects/${p.id}`);
                      setOpen(false);
                    }}
                    className={`cursor-pointer py-2.5 ${isCurrent ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center gap-2.5 w-full min-w-0">
                      <FolderKanban className={`h-4 w-4 shrink-0 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm truncate">{p.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{p.code}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize shrink-0 ${statusColor}`}>
                            {p.status?.replace("_", " ") ?? "—"}
                          </span>
                        </div>
                      </div>
                      {isCurrent && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-auto" />}
                    </div>
                  </CommandItem>
                );
              })}
            </ScrollArea>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [recentProjects, setRecentProjects] = useState<{ id: number; code: string; name: string }[]>([]);
  const [recentOpen, setRecentOpen] = useState(true);
  const { modules } = useModules();
  const { t, isRtl } = useI18n();
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const isAdmin = user?.role === "admin" || user?.role === "system_owner";
  const canSeeActivityLog = user && ["system_owner", "admin", "project_manager", "document_controller"].includes(user.role);

  useEffect(() => {
    setRecentProjects(getRecentProjects());
    const handler = () => setRecentProjects(getRecentProjects());
    window.addEventListener("edms_recent_updated", handler);
    return () => window.removeEventListener("edms_recent_updated", handler);
  }, [location]);

  const navigation = [
    { title: t("navDashboard"), url: "/", icon: Home },
    { title: t("navCorrespondence"), url: "/correspondence", icon: Mail },
    { title: t("navProjects"), url: "/projects", icon: FolderKanban },
    { title: t("navDocuments"), url: "/documents", icon: FileText },
    { title: t("navCalendar"), url: "/calendar", icon: CalendarDays },
    {
      title: t("navMeetings"), url: "/meetings", icon: CalendarDays,
      children: [{ title: t("navActionItems"), url: "/action-items", icon: ListTodo }],
    },
    { title: t("navMyTasks"), url: "/tasks", icon: CheckSquare },
    ...(modules.deliverables ? [{ title: t("navDeliverables"), url: "/deliverables", icon: ClipboardList }] : []),
    { title: "Workflow Engine", url: "/workflow-engine", icon: Layers },
    {
      title: t("navReports"), url: "/reports-dashboard", icon: TrendingUp,
      ...(modules.registers ? { children: [{ title: t("navRegisters"), url: "/reports", icon: BarChart3 }] } : {}),
    },
    ...(modules.chat ? [{ title: t("navChat"), url: "/chat", icon: MessageSquare }] : []),
    ...(canSeeActivityLog ? [{ title: t("navActivityLog"), url: "/activity-log", icon: ClipboardCheck }] : []),
    { title: t("navSearch"), url: "/search", icon: Search },
  ];

  const adminNav = [
    { title: t("navOrganizations"), url: "/organizations", icon: Building2 },
    { title: t("navUsersRoles"), url: "/users", icon: Users },
    { title: t("navConfig"), url: "/config", icon: SlidersHorizontal },
    { title: t("navAdmin"), url: "/admin", icon: ShieldCheck },
    { title: "Billing", url: "/billing", icon: CreditCard },
    { title: t("navAISettings"), url: "/ai-settings", icon: Brain },
  ];

  return (
    <Sidebar variant="inset" side={isRtl ? "right" : "left"} className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="flex h-16 items-center px-4 border-b border-sidebar-border/50">
        <div className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          ArcScale EDMS
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase font-semibold tracking-wider">{t("mainMenu")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}>
                    <Link href={item.url} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sidebar-foreground transition-all hover:bg-sidebar-accent hover:text-white">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {(item as any).children?.length > 0 && (
                    <SidebarMenuSub>
                      {(item as any).children.map((child: any) => (
                        <SidebarMenuSubItem key={child.url}>
                          <SidebarMenuSubButton asChild isActive={location === child.url || location.startsWith(child.url)}>
                            <Link href={child.url} className="flex items-center gap-2">
                              <child.icon className="h-3.5 w-3.5" />
                              <span>{child.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel
              className="text-sidebar-foreground/50 text-xs uppercase font-semibold tracking-wider flex items-center justify-between cursor-pointer"
              onClick={() => setRecentOpen(o => !o)}
            >
              <span className="flex items-center gap-1"><History className="h-3 w-3" /> {t("recentProjects")}</span>
              {recentOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className={`h-3 w-3 ${isRtl ? "rotate-180" : ""}`} />}
            </SidebarGroupLabel>
            {recentOpen && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {recentProjects.map((p) => (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuButton asChild isActive={location === `/projects/${p.id}`}>
                        <Link href={`/projects/${p.id}`} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sidebar-foreground transition-all hover:bg-sidebar-accent hover:text-white">
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-sidebar-foreground/10 shrink-0">{p.code}</span>
                          <span className="text-xs truncate">{p.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}

        {isAdmin && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase font-semibold tracking-wider">{t("adminMenu")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNav.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={location.startsWith(item.url)}>
                      <Link href={item.url} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sidebar-foreground transition-all hover:bg-sidebar-accent hover:text-white">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/50 p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 px-2 hover:bg-sidebar-accent text-white">
              <Avatar className="h-8 w-8 bg-primary/20">
                <AvatarFallback className="text-xs text-primary">{user?.firstName?.[0]}{user?.lastName?.[0]}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start text-sm overflow-hidden">
                <span className="font-medium truncate w-full">{user?.firstName} {user?.lastName}</span>
                <span className="text-xs text-sidebar-foreground/70 capitalize truncate w-full">{user?.role?.replace(/_/g, " ")}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56" dir={isRtl ? "rtl" : "ltr"}>
            <DropdownMenuLabel>{t("myAccount")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link href="/profile">
              <DropdownMenuItem className="cursor-pointer">
                <User className="me-2 h-4 w-4" />
                {t("myProfile")}
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="cursor-pointer">
              {theme === "dark" ? <Sun className="me-2 h-4 w-4" /> : <Moon className="me-2 h-4 w-4" />}
              {t("toggleTheme")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
              <LogOut className="me-2 h-4 w-4" />
              {t("logOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="mt-3 border-t border-sidebar-border/40 pt-3 space-y-1">
          <div className="flex items-center gap-2 px-1">
            <button
              onClick={() => setShowTerms(true)}
              className="text-[10px] text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
            >
              Terms of Use
            </button>
            <span className="text-[10px] text-sidebar-foreground/30">·</span>
            <button
              onClick={() => setShowPrivacy(true)}
              className="text-[10px] text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
            >
              Privacy
            </button>
          </div>
          <p className="text-[10px] text-sidebar-foreground/30 px-1">
            © {new Date().getFullYear()} ArcScale EDMS
          </p>
        </div>
      </SidebarFooter>

      <TermsOfUseModal open={showTerms} onOpenChange={setShowTerms} />
      <PrivacyPolicyModal open={showPrivacy} onOpenChange={setShowPrivacy} />
    </Sidebar>
  );
}

// ─── Org Context Switcher (system_owner only) ─────────────────────────────────
function OrgSwitcher() {
  const { user } = useAuth();
  const { activeOrgId, setActiveOrgId } = useOrgContext();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => { const r = await fetch("/api/organizations"); return r.json(); },
    enabled: user?.role === "system_owner",
  });
  const orgs: any[] = data?.organizations ?? [];

  if (user?.role !== "system_owner") return null;

  const activeOrg = orgs.find(o => o.id === activeOrgId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-8 gap-1.5 text-xs max-w-[200px] ${activeOrgId ? "border-primary text-primary" : ""}`}>
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{activeOrg ? activeOrg.name : t("orgSwitcherAll")}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder={t("orgSwitcher") + "..."} className="h-9" />
          <CommandEmpty>{t("noOrgsFound")}</CommandEmpty>
          <CommandGroup heading={t("organizations")}>
            <ScrollArea className="max-h-72">
              <CommandItem
                value="_all"
                onSelect={() => { setActiveOrgId(null); setOpen(false); }}
                className="cursor-pointer"
              >
                <Building2 className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <span>{t("orgSwitcherAll")}</span>
                {!activeOrgId && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </CommandItem>
              {orgs.map((o: any) => (
                <CommandItem
                  key={o.id}
                  value={`${o.name} ${o.type}`}
                  onSelect={() => { setActiveOrgId(o.id); setOpen(false); }}
                  className="cursor-pointer"
                >
                  <Building2 className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="truncate text-xs font-medium">{o.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize">{o.type}</span>
                  </div>
                  {activeOrgId === o.id && <Check className="ml-auto h-3.5 w-3.5 text-primary shrink-0" />}
                </CommandItem>
              ))}
            </ScrollArea>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Language Toggle ──────────────────────────────────────────────────────────
function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      onClick={() => setLang(lang === "en" ? "ar" : "en")}
      title={lang === "en" ? "Switch to Arabic / العربية" : "Switch to English"}
    >
      <span className="text-base leading-none">{lang === "en" ? "🇦🇪" : "🇬🇧"}</span>
      <span className="hidden sm:inline">{lang === "en" ? "عربي" : "EN"}</span>
    </Button>
  );
}

// ─── Global Search ────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { icon: any; label: string; color: string; bg: string }> = {
  project:        { icon: FolderKanban, label: "Project",        color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-900/30" },
  document:       { icon: FileText,     label: "Document",       color: "text-blue-600",   bg: "bg-blue-100 dark:bg-blue-900/30" },
  correspondence: { icon: Mail,         label: "Correspondence", color: "text-amber-600",  bg: "bg-amber-100 dark:bg-amber-900/30" },
  meeting:        { icon: CalendarDays, label: "Meeting",        color: "text-green-600",  bg: "bg-green-100 dark:bg-green-900/30" },
  task:           { icon: CheckSquare,  label: "Task",           color: "text-rose-600",   bg: "bg-rose-100 dark:bg-rose-900/30" },
};

const TYPE_URL: Record<string, (r: any) => string> = {
  document:       r => r.projectId ? `/projects/${r.projectId}?tab=documents` : "/documents",
  project:        r => `/projects/${r.id}`,
  correspondence: r => r.projectId ? `/projects/${r.projectId}?tab=correspondence&openCorr=${r.id}` : `/correspondence?openCorr=${r.id}`,
  meeting:        _r => "/meetings",
  task:           _r => "/tasks",
};

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [, navigate] = useLocation();
  const { t, isRtl } = useI18n();

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", q],
    queryFn: async () => {
      if (!q.trim()) return {};
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=all`);
      return r.json();
    },
    enabled: q.trim().length >= 2,
  });

  const results: any[] = [
    ...(data?.projects ?? []).map((p: any) => ({ ...p, _type: "project", _label: p.name, _sub: p.code })),
    ...(data?.documents ?? []).map((d: any) => ({ ...d, _type: "document", _label: d.title || d.documentNumber, _sub: d.documentNumber, _projectName: d.project?.name })),
    ...(data?.correspondence ?? []).map((c: any) => ({ ...c, _type: "correspondence", _label: c.subject || c.referenceNumber, _sub: c.referenceNumber, _projectName: c.project?.name })),
    ...(data?.meetings ?? []).map((m: any) => ({ ...m, _type: "meeting", _label: m.title || m.referenceNumber, _sub: m.referenceNumber, _projectName: m.project?.name })),
  ];

  // Group results by type
  const grouped = Object.entries(
    results.reduce((acc: Record<string, any[]>, r) => {
      acc[r._type] = acc[r._type] ?? [];
      acc[r._type].push(r);
      return acc;
    }, {})
  );

  const handleSelect = (result: any) => {
    setOpen(false);
    setQ("");
    const getUrl = TYPE_URL[result._type];
    if (getUrl) navigate(getUrl(result));
  };

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(o => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-8 px-3 rounded-md border bg-muted/40 hover:bg-muted text-muted-foreground text-xs transition-colors"
        title="Search (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:block w-32 text-start">{t("globalSearchPlaceholder")}</span>
        <kbd className="hidden sm:block ms-auto font-mono text-xs bg-background/80 border rounded px-1 py-0.5">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" onClick={() => setOpen(false)} dir={isRtl ? "rtl" : "ltr"}>
          <div className="w-full max-w-xl bg-popover border shadow-xl rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center border-b px-3 gap-2">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                placeholder={t("globalSearchHint")}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === "Escape" && setOpen(false)}
              />
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
              <button onClick={() => setOpen(false)} className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[28rem] overflow-y-auto">
              {q.trim().length < 2 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("globalSearchMin")}</div>
              ) : results.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">{isFetching ? t("globalSearching") : t("globalNoResults")}</div>
              ) : (
                <div className="py-1">
                  {grouped.map(([type, items]) => {
                    const meta = TYPE_META[type] ?? { icon: Hash, label: type, color: "text-muted-foreground", bg: "bg-muted" };
                    const Icon = meta.icon;
                    return (
                      <div key={type}>
                        <div className="px-4 pt-2.5 pb-1 flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${meta.bg} ${meta.color}`}>
                            <Icon className="h-3 w-3" />
                            {meta.label}s
                          </span>
                          <span className="text-xs text-muted-foreground">{items.length} result{items.length !== 1 ? "s" : ""}</span>
                        </div>
                        {items.map((r: any, i: number) => (
                          <button
                            key={i}
                            className="w-full flex items-center gap-3 px-4 py-2 hover:bg-accent text-start transition-colors group"
                            onClick={() => handleSelect(r)}
                          >
                            <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${meta.bg}`}>
                              <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{r._label || r.name || "Untitled"}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {r._sub && <span className="font-mono">{r._sub}</span>}
                                {r._sub && r._projectName && <span className="mx-1">·</span>}
                                {r._projectName && <span className="text-muted-foreground">{r._projectName}</span>}
                              </p>
                            </div>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t px-4 py-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><kbd className="font-mono bg-muted border rounded px-1">↵</kbd> {t("globalOpenResult")}</span>
              <span className="flex items-center gap-1"><kbd className="font-mono bg-muted border rounded px-1">Esc</kbd> {t("closeMenu")}</span>
              <span className="flex items-center gap-1"><kbd className="font-mono bg-muted border rounded px-1">⌘K</kbd> Toggle</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── App Layout ───────────────────────────────────────────────────────────────
export function AppLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const { modules } = useModules();
  const { isRtl } = useI18n();
  const { activeOrgId } = useOrgContext();

  // Establish WebSocket connection for real-time updates (notifications, chat)
  useRealtime();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!user && location !== "/login") return null;
  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "4rem" } as React.CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-6 shadow-sm z-10 sticky top-0">
            <SidebarTrigger className="hover:bg-accent shrink-0" />
            <div className="hidden md:block flex-1 max-w-sm">
              <GlobalSearch />
            </div>
            <div className="flex-1 min-w-0" />
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <div className="hidden md:block">
                <AICommandAssistant />
              </div>
              {user?.organizationName && !activeOrgId && (
                <div className="hidden lg:flex flex-col items-end max-w-[160px] shrink-0">
                  <span className="text-[10px] text-muted-foreground/70 leading-none">Organization</span>
                  <span className="text-xs font-semibold text-foreground truncate leading-tight mt-0.5">{user.organizationName}</span>
                </div>
              )}
              <LanguageToggle />
              <OrgSwitcher />
              <ProjectSwitcher />
              {modules.notifications && <NotificationBell />}
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
              <TermsGate>
                {children}
              </TermsGate>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

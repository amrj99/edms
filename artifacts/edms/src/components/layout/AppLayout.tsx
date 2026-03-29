import { ReactNode, useEffect, useState } from "react";
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
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
  SidebarHeader, SidebarFooter,
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
function NotificationIcon(type: string) {
  if (type.startsWith("task")) return <CheckSquare className="h-4 w-4 text-blue-500" />;
  if (type.startsWith("document")) return <FolderKanban className="h-4 w-4 text-green-500" />;
  if (type.startsWith("transmittal")) return <Send className="h-4 w-4 text-purple-500" />;
  return <Bell className="h-4 w-4 text-muted-foreground" />;
}

function NotificationBell() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => { const r = await fetch("/api/notifications"); return r.json(); },
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => { await fetch(`/api/notifications/${id}/read`, { method: "POST" }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => { await fetch("/api/notifications/read-all", { method: "POST" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast({ title: "All notifications marked as read" }); },
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="font-semibold">Notifications</span>
            {unreadCount > 0 && <Badge variant="secondary">{unreadCount}</Badge>}
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} className="h-7 text-xs gap-1">
              <CheckCheck className="h-3 w-3" /> Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[400px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n: any) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 p-4 hover:bg-accent/50 transition-colors cursor-pointer ${!n.isRead ? "bg-primary/5" : ""}`}
                  onClick={() => !n.isRead && markRead.mutate(n.id)}
                >
                  <div className="mt-0.5 shrink-0">{NotificationIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!n.isRead ? "font-medium" : "text-muted-foreground"}`}>{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                  </div>
                  {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />}
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
function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });
  const projects = projectsData?.projects ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs max-w-[180px]">
          <FolderKanban className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Switch Project</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search projects..." className="h-9" />
          <CommandEmpty>No projects found</CommandEmpty>
          <CommandGroup heading="All Projects">
            <ScrollArea className="max-h-72">
              {projects.map((p: any) => (
                <CommandItem
                  key={p.id}
                  value={`${p.code} ${p.name}`}
                  onSelect={() => {
                    trackRecentProject({ id: p.id, code: p.code, name: p.name });
                    navigate(`/projects/${p.id}`);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <span className="font-mono text-xs text-muted-foreground mr-2">{p.code}</span>
                  <span className="truncate">{p.name}</span>
                </CommandItem>
              ))}
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

  const isAdmin = user?.role === "admin" || user?.role === "system_owner";
  const canSeeActivityLog = user && ["system_owner", "admin", "project_manager", "document_controller"].includes(user.role);

  useEffect(() => {
    setRecentProjects(getRecentProjects());
    const handler = () => setRecentProjects(getRecentProjects());
    window.addEventListener("edms_recent_updated", handler);
    return () => window.removeEventListener("edms_recent_updated", handler);
  }, [location]);

  const navigation = [
    { title: "Dashboard", url: "/", icon: Home },
    { title: "Correspondence", url: "/correspondence", icon: Mail },
    { title: "Projects", url: "/projects", icon: FolderKanban },
    { title: "Documents", url: "/documents", icon: FileText },
    { title: "Meetings", url: "/meetings", icon: CalendarDays },
    { title: "Action Items", url: "/action-items", icon: ListTodo },
    { title: "My Tasks", url: "/tasks", icon: CheckSquare },
    ...(modules.deliverables ? [{ title: "Deliverables", url: "/deliverables", icon: ClipboardList }] : []),
    { title: "Reports Dashboard", url: "/reports-dashboard", icon: TrendingUp },
    ...(modules.registers ? [{ title: "Registers", url: "/reports", icon: BarChart3 }] : []),
    ...(modules.chat ? [{ title: "Chat", url: "/chat", icon: MessageSquare }] : []),
    ...(canSeeActivityLog ? [{ title: "Activity Log", url: "/activity-log", icon: ClipboardCheck }] : []),
    { title: "Search", url: "/search", icon: Search },
  ];

  const adminNav = [
    { title: "Organizations", url: "/organizations", icon: Building2 },
    { title: "Users & Roles", url: "/users", icon: Users },
    { title: "Configuration", url: "/config", icon: SlidersHorizontal },
    { title: "System Admin", url: "/admin", icon: ShieldCheck },
    { title: "Settings", url: "/settings", icon: Settings },
    { title: "AI Settings", url: "/ai-settings", icon: Brain },
  ];

  return (
    <Sidebar variant="inset" className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
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
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase font-semibold tracking-wider">Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}>
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

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel
              className="text-sidebar-foreground/50 text-xs uppercase font-semibold tracking-wider flex items-center justify-between cursor-pointer"
              onClick={() => setRecentOpen(o => !o)}
            >
              <span className="flex items-center gap-1"><History className="h-3 w-3" /> Recent Projects</span>
              {recentOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
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
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase font-semibold tracking-wider">Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
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
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link href="/profile">
              <DropdownMenuItem className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                My Profile
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="cursor-pointer">
              {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              Toggle Theme
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
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
function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [, navigate] = useLocation();

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", q],
    queryFn: async () => {
      if (!q.trim()) return {};
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=all`);
      return r.json();
    },
    enabled: q.trim().length >= 2,
  });

  // Merge all result types into a unified list
  const results: any[] = [
    ...(data?.documents ?? []).map((d: any) => ({ ...d, type: "document", _label: d.title || d.documentNumber })),
    ...(data?.correspondence ?? []).map((c: any) => ({ ...c, type: "correspondence", _label: c.subject || c.referenceNumber })),
    ...(data?.meetings ?? []).map((m: any) => ({ ...m, type: "meeting", _label: m.title || m.referenceNumber })),
  ];

  const typeIcon: Record<string, any> = {
    document: FileText,
    project: FolderKanban,
    correspondence: Mail,
    task: CheckSquare,
    deliverable: ClipboardList,
    ncr: AlertCircle,
    meeting: CalendarDays,
  };

  const typeUrl: Record<string, (r: any) => string> = {
    document: r => r.projectId ? `/projects/${r.projectId}?tab=documents` : "/documents",
    project: r => `/projects/${r.id}`,
    correspondence: _r => "/correspondence",
    task: _r => "/tasks",
    deliverable: r => r.projectId ? `/projects/${r.projectId}?tab=deliverables` : "/deliverables",
    ncr: r => r.projectId ? `/projects/${r.projectId}?tab=ncr` : "/reports",
    meeting: _r => "/meetings",
  };

  const handleSelect = (result: any) => {
    setOpen(false);
    setQ("");
    const getUrl = typeUrl[result.type];
    if (getUrl) navigate(getUrl(result));
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-8 px-3 rounded-md border bg-muted/40 hover:bg-muted text-muted-foreground text-xs transition-colors"
        title="Search (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:block w-32 text-left">Search...</span>
        <kbd className="hidden sm:block ml-auto font-mono text-xs bg-background/80 border rounded px-1 py-0.5">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl bg-popover border shadow-xl rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center border-b px-3 gap-2">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                placeholder="Search documents, projects, correspondence, meetings..."
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === "Escape" && setOpen(false)}
              />
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
              <button onClick={() => setOpen(false)} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {q.trim().length < 2 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">Type at least 2 characters to search...</div>
              ) : results.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">{isFetching ? "Searching..." : "No results found"}</div>
              ) : (
                <div className="py-1">
                  {results.map((r: any, i: number) => {
                    const Icon = typeIcon[r.type] ?? Hash;
                    return (
                      <button
                        key={i}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent text-left transition-colors"
                        onClick={() => handleSelect(r)}
                      >
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r._label || r.title || r.name || r.referenceNumber || "Untitled"}</p>
                          {(r.description || r.projectCode) && (
                            <p className="text-xs text-muted-foreground truncate">{r.projectCode ? `${r.projectCode} · ` : ""}{r.description || ""}</p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground capitalize shrink-0">{r.type}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t px-4 py-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span>↵ Open</span>
              <span>ESC Close</span>
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
        <div className="flex flex-col flex-1 w-full overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-card px-6 shadow-sm z-10 sticky top-0">
            <SidebarTrigger className="hover:bg-accent" />
            <div className="hidden sm:block flex-1">
              <GlobalSearch />
            </div>
            <div className="flex-1 sm:flex-none" />
            <div className="flex items-center gap-2">
              <AICommandAssistant />
              <div className="text-sm font-medium text-muted-foreground hidden sm:block">{user?.organizationName}</div>
              <LanguageToggle />
              <OrgSwitcher />
              <ProjectSwitcher />
              {modules.notifications && <NotificationBell />}
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

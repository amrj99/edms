import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/hooks/use-theme";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { 
  Brain,
  Building2, 
  CheckSquare, 
  FolderKanban, 
  Home, 
  Inbox,
  LogOut, 
  Moon, 
  Search, 
  Settings, 
  Sun, 
  Users,
  Bell,
  BarChart3,
  SlidersHorizontal,
  Send,
  X,
  Check,
  CheckCheck,
} from "lucide-react";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarMenu, 
  SidebarMenuButton, 
  SidebarMenuItem, 
  SidebarProvider, 
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

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
    queryFn: async () => {
      const r = await fetch("/api/notifications");
      return r.json();
    },
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/read-all", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "All notifications marked as read" });
    },
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
              <CheckCheck className="h-3 w-3" />
              Mark all read
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
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {!n.isRead && (
                    <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  const isAdmin = user?.role === "admin";

  const navigation = [
    { title: "Dashboard", url: "/", icon: Home },
    { title: "Projects", url: "/projects", icon: FolderKanban },
    { title: "General Inbox", url: "/general", icon: Inbox },
    { title: "My Tasks", url: "/tasks", icon: CheckSquare },
    { title: "Reports", url: "/reports", icon: BarChart3 },
    { title: "Search", url: "/search", icon: Search },
  ];

  const adminNav = [
    { title: "Organizations", url: "/organizations", icon: Building2 },
    { title: "Users & Roles", url: "/users", icon: Users },
    { title: "Configuration", url: "/config", icon: SlidersHorizontal },
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

        {isAdmin && (
          <SidebarGroup className="mt-6">
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
                <span className="text-xs text-sidebar-foreground/70 capitalize truncate w-full">{user?.role?.replace('_', ' ')}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="cursor-pointer">
              {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
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

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!user && location !== "/login") {
    return null;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-col flex-1 w-full overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-card px-6 shadow-sm z-10 sticky top-0">
            <SidebarTrigger className="hover:bg-accent" />
            <div className="flex-1" />
            <div className="text-sm font-medium text-muted-foreground hidden sm:block mr-2">
              {user?.organizationName}
            </div>
            <NotificationBell />
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

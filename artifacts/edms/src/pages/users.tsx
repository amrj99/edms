import { useState, useMemo } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users as UsersIcon, Search, Plus, ShieldAlert, Loader2, MoreHorizontal,
  Building2, ChevronDown, X, KeyRound, UserCheck, UserX, Eye, Pencil,
  FolderKanban, BadgeCheck, ShieldCheck, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const ORG_TYPES = ["client", "consultant", "contractor", "subcontractor"] as const;
type OrgType = typeof ORG_TYPES[number];

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  client: "Client",
  consultant: "Consultant",
  contractor: "Contractor",
  subcontractor: "Subcontractor",
};

const ORG_TYPE_COLORS: Record<OrgType, string> = {
  client:       "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  consultant:   "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  contractor:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  subcontractor:"bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

const ALL_ROLES = ["system_owner", "admin", "project_manager", "document_controller", "reviewer", "member", "viewer"];

const ROLE_LABELS: Record<string, string> = {
  system_owner: "System Owner",
  admin: "Admin",
  project_manager: "Project Manager",
  document_controller: "Doc Controller",
  reviewer: "Reviewer",
  member: "Member",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  system_owner: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  admin: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  project_manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  document_controller: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  reviewer: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  member: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  viewer: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function userInitials(u: { firstName?: string | null; lastName?: string | null; email: string }) {
  const first = u.firstName?.[0] ?? "";
  const last = u.lastName?.[0] ?? "";
  return (first + last).toUpperCase() || u.email[0].toUpperCase();
}

function userName(u: { firstName?: string | null; lastName?: string | null; email: string }) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user: me } = useAuth();

  const isSysAdmin = me?.role === "system_owner" || me?.role === "admin";
  const isOrgAdmin = me?.role === "admin" || me?.role === "project_manager";

  const [searchQ, setSearchQ] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<number | "all">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [orgSearchQ, setOrgSearchQ] = useState("");
  const [orgTypeFilter, setOrgTypeFilter] = useState<OrgType | "all">("all");
  const [orgSort, setOrgSort] = useState<"alpha" | "count">("alpha");
  const [addOpen, setAddOpen] = useState(false);
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");

  const [addForm, setAddForm] = useState({
    email: "", firstName: "", lastName: "", role: "member",
    organizationId: "", department: "", password: "",
  });

  const { data: usersData, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ["users-mgmt", selectedOrgId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedOrgId !== "all" && isSysAdmin) params.set("organizationId", String(selectedOrgId));
      const r = await fetch(`/api/users?${params}`);
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    },
  });

  const { data: orgsData } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => { const r = await fetch("/api/organizations"); return r.json(); },
    enabled: isSysAdmin,
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["user-detail", selectedUserId],
    queryFn: async () => {
      const r = await fetch(`/api/users/${selectedUserId}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !!selectedUserId && detailOpen,
  });

  const allUsers: any[] = usersData?.users ?? [];
  const organizations: any[] = unwrapList<any>(orgsData, "organizations");

  const orgUserCounts = useMemo(() => {
    const m: Record<number | string, number> = { all: allUsers.length };
    for (const u of allUsers) {
      const k = u.organizationId ?? "none";
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [allUsers]);

  const filtered = useMemo(() => {
    const lq = searchQ.toLowerCase();
    return allUsers.filter(u => {
      if (lq && !`${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(lq)) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      if (selectedOrgId !== "all" && u.organizationId !== selectedOrgId) return false;
      return true;
    });
  }, [allUsers, searchQ, roleFilter, statusFilter, selectedOrgId]);

  const createUser = useMutation({
    mutationFn: async (body: any) => {
      const r = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users-mgmt"] });
      setAddOpen(false);
      setAddForm({ email: "", firstName: "", lastName: "", role: "member", organizationId: "", department: "", password: "" });
      toast({ title: "User created", description: "The new user can now sign in." });
    },
    onError: (e: any) => toast({ title: "Could not create user", description: e.message, variant: "destructive" }),
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, ...body }: any) => {
      const r = await fetch(`/api/users/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users-mgmt"] });
      qc.invalidateQueries({ queryKey: ["user-detail", actionTarget?.id] });
      setEditRoleOpen(false);
      toast({ title: "User updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const resetPassword = useMutation({
    mutationFn: async ({ id, newPassword }: { id: number; newPassword: string }) => {
      const r = await fetch(`/api/users/${id}/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      setResetPwOpen(false);
      setNewPassword("");
      toast({ title: "Password reset successfully" });
    },
    onError: (e: any) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  const openDetail = (u: any) => {
    setSelectedUserId(u.id);
    setDetailOpen(true);
  };

  const openEditRole = (u: any) => {
    setActionTarget({ ...u });
    setEditRoleOpen(true);
  };

  const openResetPw = (u: any) => {
    setActionTarget(u);
    setNewPassword("");
    setResetPwOpen(true);
  };

  const toggleActive = (u: any) => {
    updateUser.mutate({ id: u.id, isActive: !u.isActive });
  };

  if (usersError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground mt-2">You do not have permission to view user management.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden">

      {/* LEFT: Org filter sidebar */}
      {isSysAdmin && (
        <div className="hidden md:flex w-64 shrink-0 border-r bg-muted/30 flex-col">

          {/* Sticky header + controls */}
          <div className="shrink-0 border-b bg-muted/30">
            {/* Title + sort toggle */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Organizations</p>
              <button
                onClick={() => setOrgSort(s => s === "alpha" ? "count" : "alpha")}
                title={orgSort === "alpha" ? "Sorted A–Z — click for most users first" : "Sorted by user count — click for A–Z"}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {orgSort === "alpha" ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 4h8M2 8h6M2 12h4" strokeLinecap="round"/>
                    <path d="M12 3v10M12 13l2-2M12 13l-2-2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 4h8M2 8h5M2 12h3" strokeLinecap="round"/>
                    <path d="M12 3v10M12 3l-2 2M12 3l2 2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Search input */}
            <div className="relative px-2 pb-2">
              <Search className="absolute left-4 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={orgSearchQ}
                onChange={e => setOrgSearchQ(e.target.value)}
                placeholder="Search organizations…"
                className="h-7 pl-7 pr-6 text-xs bg-background"
              />
              {orgSearchQ && (
                <button onClick={() => setOrgSearchQ("")} className="absolute right-4 top-2 text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Type filter chips */}
            <div className="px-2 pb-2.5 flex flex-wrap gap-1">
              <button
                onClick={() => setOrgTypeFilter("all")}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
                  orgTypeFilter === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
              >
                All
              </button>
              {ORG_TYPES.map(t => {
                const cnt = organizations.filter((o: any) => o.type === t).length;
                return (
                  <button
                    key={t}
                    onClick={() => setOrgTypeFilter(prev => prev === t ? "all" : t)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
                      orgTypeFilter === t
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {ORG_TYPE_LABELS[t]} {cnt > 0 ? `·${cnt}` : ""}
                  </button>
                );
              })}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {/* "All" entry — hidden when any filter is active */}
              {!orgSearchQ && orgTypeFilter === "all" && (
                <button
                  onClick={() => setSelectedOrgId("all")}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedOrgId === "all"
                      ? "bg-primary text-primary-foreground font-medium shadow-sm"
                      : "hover:bg-accent"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <UsersIcon className="h-3.5 w-3.5 shrink-0" />
                    All Organizations
                  </span>
                  <span className={`text-xs shrink-0 ${selectedOrgId === "all" ? "opacity-80" : "text-muted-foreground"}`}>
                    {orgUserCounts.all ?? 0}
                  </span>
                </button>
              )}

              {(() => {
                const visible = [...organizations]
                  .filter((org: any) =>
                    (!orgSearchQ || org.name.toLowerCase().includes(orgSearchQ.toLowerCase())) &&
                    (orgTypeFilter === "all" || org.type === orgTypeFilter)
                  )
                  .sort((a: any, b: any) =>
                    orgSort === "alpha"
                      ? a.name.localeCompare(b.name)
                      : (orgUserCounts[b.id] ?? 0) - (orgUserCounts[a.id] ?? 0)
                  );

                if (visible.length === 0) {
                  return (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      No organizations match
                    </p>
                  );
                }

                return visible.map((org: any) => {
                  const isSelected = selectedOrgId === org.id;
                  const typeLabel = ORG_TYPE_LABELS[org.type as OrgType];
                  const typeColor = ORG_TYPE_COLORS[org.type as OrgType];
                  return (
                    <button
                      key={org.id}
                      onClick={() => setSelectedOrgId(org.id)}
                      className={`w-full flex flex-col px-3 py-2 rounded-md text-sm transition-colors text-left ${
                        isSelected
                          ? "bg-primary text-primary-foreground font-medium shadow-sm"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-medium">{org.name}</span>
                        </span>
                        <span className={`text-xs shrink-0 ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                          {orgUserCounts[org.id] ?? 0}
                        </span>
                      </div>
                      {typeLabel && (
                        <span className={`mt-0.5 ml-5.5 self-start inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium ${
                          isSelected ? "bg-white/20 text-white" : typeColor
                        }`}>
                          {typeLabel}
                        </span>
                      )}
                    </button>
                  );
                });
              })()}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* MAIN: User table */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold">User Management</h1>
            <p className="text-xs text-muted-foreground">{filtered.length} user{filtered.length !== 1 ? "s" : ""} {selectedOrgId !== "all" ? "in selected organization" : "across all organizations"}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name or email…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="pl-8 h-8 text-sm w-52"
              />
              {searchQ && (
                <button onClick={() => setSearchQ("")} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Role filter */}
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-8 text-xs w-40">
                <Filter className="h-3 w-3 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {ALL_ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* Status filter */}
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {/* Add user */}
            {isSysAdmin && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add User
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <ScrollArea className="flex-1">
          {usersLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
              <UsersIcon className="h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">No users found</p>
              <p className="text-xs mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 border-b z-10">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</th>
                  {isSysAdmin && <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Organization</th>}
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">System Role</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Projects</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openDetail(u)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className={`text-xs font-semibold ${u.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                            {userInitials(u)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{userName(u)}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    {isSysAdmin && (
                      <td className="px-4 py-3 text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Building2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">{u.organizationName ?? "—"}</span>
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] ?? ROLE_COLORS.viewer}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FolderKanban className="h-3 w-3" />
                        {u.projectCount ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openDetail(u)} className="gap-2">
                            <Eye className="h-3.5 w-3.5" /> View Details
                          </DropdownMenuItem>
                          {isSysAdmin && (
                            <>
                              <DropdownMenuItem onClick={() => openEditRole(u)} className="gap-2">
                                <Pencil className="h-3.5 w-3.5" /> Edit Role
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => toggleActive(u)} className="gap-2">
                                {u.isActive ? (
                                  <><UserX className="h-3.5 w-3.5" /> Deactivate</>
                                ) : (
                                  <><UserCheck className="h-3.5 w-3.5" /> Activate</>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openResetPw(u)} className="gap-2">
                                <KeyRound className="h-3.5 w-3.5" /> Reset Password
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScrollArea>
      </div>

      {/* ── User Detail Sheet ───────────────────────────────────────────────────── */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">
          <SheetHeader className="p-5 border-b">
            <SheetTitle className="text-base">User Profile</SheetTitle>
          </SheetHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : detailData ? (
            <ScrollArea className="flex-1">
              <div className="p-5 space-y-5">
                {/* Avatar + basic info */}
                <div className="flex items-start gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarFallback className={`text-base font-bold ${detailData.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {userInitials(detailData)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold leading-tight">{userName(detailData)}</p>
                    <p className="text-sm text-muted-foreground">{detailData.email}</p>
                    {detailData.department && (
                      <p className="text-xs text-muted-foreground mt-0.5">{detailData.department}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[detailData.role] ?? ROLE_COLORS.viewer}`}>
                        {ROLE_LABELS[detailData.role] ?? detailData.role}
                      </span>
                      {detailData.isActive ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> Inactive
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Organization */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Organization</p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm min-w-0">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{detailData.organizationName ?? "—"}</span>
                    </div>
                    {detailData.organizationType && ORG_TYPE_LABELS[detailData.organizationType as OrgType] && (
                      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        ORG_TYPE_COLORS[detailData.organizationType as OrgType]
                      }`}>
                        {ORG_TYPE_LABELS[detailData.organizationType as OrgType]}
                      </span>
                    )}
                  </div>
                </div>

                {/* Project Memberships */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <FolderKanban className="h-3.5 w-3.5" />
                    Project Memberships ({detailData.projectMemberships?.length ?? 0})
                  </p>
                  {detailData.projectMemberships?.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 px-1">Not a member of any project</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detailData.projectMemberships?.map((pm: any) => (
                        <div key={pm.projectId} className="flex items-center justify-between rounded-md border px-3 py-2 bg-background hover:bg-muted/30 transition-colors">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{pm.projectName ?? `Project #${pm.projectId}`}</p>
                            {pm.projectCode && <p className="text-xs text-muted-foreground font-mono">{pm.projectCode}</p>}
                          </div>
                          <span className={`ml-2 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[pm.role] ?? ROLE_COLORS.viewer}`}>
                            {ROLE_LABELS[pm.role] ?? pm.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Account info */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</p>
                  <p className="text-xs text-muted-foreground">
                    Joined {detailData.createdAt ? new Date(detailData.createdAt).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }) : "—"}
                  </p>
                </div>

                {/* Admin actions */}
                {isSysAdmin && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { openEditRole(detailData); }}>
                        <Pencil className="h-3 w-3" /> Edit Role
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { openResetPw(detailData); }}>
                        <KeyRound className="h-3 w-3" /> Reset Password
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`gap-1.5 text-xs col-span-2 ${detailData.isActive ? "text-destructive hover:bg-destructive/10" : "text-emerald-600 hover:bg-emerald-50"}`}
                        onClick={() => { toggleActive(detailData); setDetailOpen(false); }}
                      >
                        {detailData.isActive
                          ? <><UserX className="h-3 w-3" /> Deactivate Account</>
                          : <><UserCheck className="h-3 w-3" /> Activate Account</>}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ── Add User Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add New User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">First Name</Label>
                <Input className="mt-1 h-8 text-sm" value={addForm.firstName} onChange={e => setAddForm(f => ({ ...f, firstName: e.target.value }))} placeholder="John" />
              </div>
              <div>
                <Label className="text-xs">Last Name</Label>
                <Input className="mt-1 h-8 text-sm" value={addForm.lastName} onChange={e => setAddForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Smith" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Email <span className="text-destructive">*</span></Label>
              <Input type="email" className="mt-1 h-8 text-sm" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="user@company.com" />
            </div>
            <div className={me?.role === "system_owner" ? "grid grid-cols-2 gap-3" : ""}>
              <div>
                <Label className="text-xs">System Role</Label>
                <Select value={addForm.role} onValueChange={v => setAddForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.filter(r => r !== "system_owner" || me?.role === "system_owner").map(r => (
                      <SelectItem key={r} value={r} className="text-xs">{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {me?.role === "system_owner" && (
                <div>
                  <Label className="text-xs">Organization</Label>
                  <Select value={addForm.organizationId || "_none"} onValueChange={v => setAddForm(f => ({ ...f, organizationId: v === "_none" ? "" : v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {organizations.map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-xs">{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <Input className="mt-1 h-8 text-sm" value={addForm.department} onChange={e => setAddForm(f => ({ ...f, department: e.target.value }))} placeholder="Engineering, Finance…" />
            </div>
            <div>
              <Label className="text-xs">Initial Password <span className="text-destructive">*</span></Label>
              <Input type="password" className="mt-1 h-8 text-sm" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Minimum 8 characters" />
              <p className="text-[10px] text-muted-foreground mt-0.5">The user should change this on first sign-in.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createUser.mutate({
                email: addForm.email,
                firstName: addForm.firstName,
                lastName: addForm.lastName,
                role: addForm.role,
                organizationId: addForm.organizationId ? parseInt(addForm.organizationId) : undefined,
                department: addForm.department || undefined,
                password: addForm.password,
              })}
              disabled={!addForm.email || !addForm.password || createUser.isPending}
            >
              {createUser.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Role Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Edit User Role</DialogTitle>
          </DialogHeader>
          {actionTarget && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">{userInitials(actionTarget)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{userName(actionTarget)}</p>
                  <p className="text-xs text-muted-foreground">{actionTarget.email}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">System Role</Label>
                  <Select value={actionTarget.role} onValueChange={v => setActionTarget((t: any) => ({ ...t, role: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ALL_ROLES.filter(r => r !== "system_owner" || me?.role === "system_owner").map(r => (
                        <SelectItem key={r} value={r} className="text-xs">{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Organization</Label>
                  <Select
                    value={actionTarget.organizationId ? String(actionTarget.organizationId) : "_none"}
                    onValueChange={v => setActionTarget((t: any) => ({ ...t, organizationId: v === "_none" ? null : parseInt(v) }))}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {organizations.map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-xs">{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRoleOpen(false)}>Cancel</Button>
            <Button
              onClick={() => updateUser.mutate({ id: actionTarget.id, role: actionTarget.role, organizationId: actionTarget.organizationId ?? null })}
              disabled={updateUser.isPending}
            >
              {updateUser.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ────────────────────────────────────────────────── */}
      <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Reset Password</DialogTitle>
          </DialogHeader>
          {actionTarget && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Set a new password for <span className="font-medium text-foreground">{userName(actionTarget)}</span>.
              </p>
              <div>
                <Label className="text-xs">New Password</Label>
                <Input
                  type="password"
                  className="mt-1 h-8 text-sm"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwOpen(false)}>Cancel</Button>
            <Button
              onClick={() => resetPassword.mutate({ id: actionTarget.id, newPassword })}
              disabled={newPassword.length < 6 || resetPassword.isPending}
            >
              {resetPassword.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

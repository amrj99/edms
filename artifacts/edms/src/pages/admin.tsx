import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ShieldCheck, Building2, Users, Brain,
  Mail, HardDrive, Plus, X, Save, RefreshCw, Key, Globe,
  FileType, Hash, GitBranch, Clock, Layers,
  Pencil, Lock, UserX, UserCheck, UserPlus, FolderKanban,
  CheckCircle2, AlertCircle, Loader2, Activity, Database,
  Download, Upload, Filter, Search, ChevronLeft, ChevronRight,
  Server, Wifi, WifiOff, Palette, Image as ImageIcon,
} from "lucide-react";

const ROLES = ["system_owner", "admin", "project_manager", "document_controller", "reviewer", "viewer"];
const ROLE_DESCRIPTIONS: Record<string, string> = {
  system_owner: "Full system access including global settings and configuration",
  admin: "Manage organization data, users, and most settings",
  project_manager: "Manage projects, documents, and team members",
  document_controller: "Upload, revise, and control document workflow",
  reviewer: "Review and comment on documents",
  viewer: "Read-only access to assigned documents",
};
const ROLE_BADGE: Record<string, string> = {
  system_owner: "bg-red-100 text-red-700",
  admin: "bg-orange-100 text-orange-700",
  project_manager: "bg-blue-100 text-blue-700",
  document_controller: "bg-purple-100 text-purple-700",
  reviewer: "bg-cyan-100 text-cyan-700",
  viewer: "bg-gray-100 text-gray-700",
};

const PROJECT_ROLES = ["project_manager", "document_controller", "reviewer", "viewer", "project_admin"];

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOwner = user?.role === "system_owner" || user?.role === "admin";

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["config"],
    queryFn: async () => { const r = await fetch("/api/config"); return r.json(); },
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });

  const { data: orgsData } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => { const r = await fetch("/api/organizations"); return r.json(); },
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });

  const [form, setForm] = useState<any>(null);
  const [newCorrType, setNewCorrType] = useState({ name: "", prefix: "", slaDays: 7, color: "#3B82F6" });
  const [newMetaField, setNewMetaField] = useState({ name: "", label: "", type: "text", required: false, scope: "global" });

  // User management state
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userForm, setUserForm] = useState({ email: "", firstName: "", lastName: "", role: "reviewer", password: "", organizationId: "" });
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", role: "reviewer", organizationId: "" });
  const [newPassword, setNewPassword] = useState("");
  const [userSearch, setUserSearch] = useState("");

  // Project assignment state
  const [assignUser, setAssignUser] = useState<any>(null);

  if (config && !form) setForm({ ...config });

  const save = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["config"] }); toast({ title: "System configuration saved" }); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const createUser = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, organizationId: data.organizationId ? parseInt(data.organizationId) : undefined }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setCreateUserOpen(false);
      setUserForm({ email: "", firstName: "", lastName: "", role: "reviewer", password: "", organizationId: "" });
      toast({ title: "User created successfully" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed to create user", variant: "destructive" }),
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const r = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, organizationId: data.organizationId ? parseInt(data.organizationId) : undefined }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditUserOpen(false);
      toast({ title: "User updated" });
    },
    onError: () => toast({ title: "Failed to update user", variant: "destructive" }),
  });

  const toggleUserActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const r = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: vars.isActive ? "User enabled" : "User disabled" });
    },
    onError: () => toast({ title: "Failed to update user", variant: "destructive" }),
  });

  const resetPassword = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      const r = await fetch(`/api/users/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      setResetPwOpen(false);
      setNewPassword("");
      setSelectedUser(null);
      toast({ title: "Password reset successfully" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed to reset password", variant: "destructive" }),
  });

  const addToProject = useMutation({
    mutationFn: async ({ projectId, userId, role }: { projectId: number; userId: number; role: string }) => {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members"] });
      toast({ title: "User added to project" });
    },
    onError: () => toast({ title: "Failed to add user to project", variant: "destructive" }),
  });

  const removeFromProject = useMutation({
    mutationFn: async ({ projectId, userId }: { projectId: number; userId: number }) => {
      await fetch(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members"] });
      toast({ title: "User removed from project" });
    },
  });

  const addCorrType = () => {
    if (!newCorrType.name.trim()) return;
    const entry = { ...newCorrType, id: newCorrType.name.toLowerCase().replace(/\s+/g, "_") };
    setForm((f: any) => ({ ...f, correspondenceTypes: [...(f.correspondenceTypes || []), entry] }));
    setNewCorrType({ name: "", prefix: "", slaDays: 7, color: "#3B82F6" });
  };

  const removeCorrType = (id: string) => {
    setForm((f: any) => ({ ...f, correspondenceTypes: (f.correspondenceTypes || []).filter((t: any) => t.id !== id) }));
  };

  const addMetaField = () => {
    if (!newMetaField.name.trim()) return;
    setForm((f: any) => ({ ...f, metadataFields: [...(f.metadataFields || []), { ...newMetaField, id: Date.now() }] }));
    setNewMetaField({ name: "", label: "", type: "text", required: false, scope: "global" });
  };

  const removeMetaField = (id: any) => {
    setForm((f: any) => ({ ...f, metadataFields: (f.metadataFields || []).filter((m: any) => m.id !== id) }));
  };

  const users = usersData?.users ?? [];
  const orgs = orgsData?.organizations ?? [];
  const projects = projectsData?.projects ?? [];

  const filteredUsers = users.filter((u: any) =>
    !userSearch || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (configLoading || !form) {
    return <div className="flex items-center justify-center py-20"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center p-8 border rounded-xl">
        <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold mb-2">Access Restricted</h2>
        <p className="text-muted-foreground">System Administration requires Administrator or System Owner access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in pb-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            System Administration
          </h1>
          <p className="text-muted-foreground mt-1">Manage all system-wide settings, roles, metadata, and integrations</p>
        </div>
        <Button onClick={() => save.mutate(form)} disabled={save.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving..." : "Save All Changes"}
        </Button>
      </div>

      <Tabs defaultValue="organization">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-muted p-1 rounded-lg w-full">
          {[
            { value: "organization", label: "Organization", icon: Building2 },
            { value: "users", label: "Users", icon: Users },
            { value: "project-assign", label: "Project Assignment", icon: FolderKanban },
            { value: "metadata", label: "Metadata", icon: Layers },
            { value: "corrtypes", label: "Corr. Types", icon: FileType },
            { value: "numbering", label: "Numbering", icon: Hash },
            { value: "workflows", label: "Workflows", icon: GitBranch },
            { value: "ai", label: "AI Config", icon: Brain },
            { value: "email", label: "Email", icon: Mail },
            { value: "storage", label: "Storage", icon: HardDrive },
            { value: "security", label: "Security", icon: Key },
            { value: "audit", label: "Audit Log", icon: Activity },
            { value: "system", label: "System", icon: Server },
            { value: "branding", label: "Branding", icon: Globe },
          ].map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5 text-xs px-3">
              <Icon className="h-3.5 w-3.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Organization Settings */}
        <TabsContent value="organization" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Organization Details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {orgs.slice(0, 3).map((org: any) => (
                  <div key={org.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.code} · {org.type || "Organization"}</p>
                      </div>
                      <Badge variant="outline" className="capitalize">{org.industry || "Engineering"}</Badge>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1 w-full" onClick={() => window.location.href = "/organizations"}>
                  <Building2 className="h-3.5 w-3.5" /> Manage Organizations
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />System Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>System Name</Label>
                  <Input className="mt-1" defaultValue="ArcScale EDMS" />
                </div>
                <div>
                  <Label>Default Timezone</Label>
                  <Select defaultValue="utc">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utc">UTC</SelectItem>
                      <SelectItem value="gmt">GMT+0</SelectItem>
                      <SelectItem value="est">EST (GMT-5)</SelectItem>
                      <SelectItem value="pst">PST (GMT-8)</SelectItem>
                      <SelectItem value="gst">GST (GMT+4)</SelectItem>
                      <SelectItem value="ist">IST (GMT+5:30)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date Format</Label>
                  <Select defaultValue="dd-mmm-yyyy">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd-mmm-yyyy">DD-MMM-YYYY</SelectItem>
                      <SelectItem value="dd/mm/yyyy">DD/MM/YYYY</SelectItem>
                      <SelectItem value="mm/dd/yyyy">MM/DD/YYYY</SelectItem>
                      <SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Allow Self Registration</Label>
                  <Switch defaultChecked={false} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Multi-Organization Mode</Label>
                  <Switch defaultChecked={true} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Full User Management */}
        <TabsContent value="users" className="mt-4 space-y-4">
          {/* Create User Dialog */}
          <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />Create New User</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>First Name *</Label>
                    <Input value={userForm.firstName} onChange={e => setUserForm(f => ({ ...f, firstName: e.target.value }))} placeholder="First name" className="mt-1" />
                  </div>
                  <div>
                    <Label>Last Name *</Label>
                    <Input value={userForm.lastName} onChange={e => setUserForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Last name" className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label>Email Address *</Label>
                  <Input type="email" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} placeholder="user@company.com" className="mt-1" />
                </div>
                <div>
                  <Label>Temporary Password *</Label>
                  <Input type="password" value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>System Role *</Label>
                    <Select value={userForm.role} onValueChange={v => setUserForm(f => ({ ...f, role: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map(r => <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Organization</Label>
                    <Select value={userForm.organizationId} onValueChange={v => setUserForm(f => ({ ...f, organizationId: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        {orgs.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateUserOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => createUser.mutate({ ...userForm, organizationId: userForm.organizationId === "_none" ? "" : userForm.organizationId })}
                  disabled={createUser.isPending || !userForm.email || !userForm.firstName || !userForm.lastName || !userForm.password}
                >
                  {createUser.isPending ? "Creating..." : "Create User"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Edit User Dialog */}
          <Dialog open={editUserOpen} onOpenChange={setEditUserOpen}>
            <DialogContent className="sm:max-w-[480px]">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5" />Edit User</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>First Name</Label>
                    <Input value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label>Last Name</Label>
                    <Input value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>System Role</Label>
                    <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map(r => <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Organization</Label>
                    <Select value={editForm.organizationId} onValueChange={v => setEditForm(f => ({ ...f, organizationId: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        {orgs.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditUserOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => selectedUser && updateUser.mutate({ id: selectedUser.id, data: { ...editForm, organizationId: editForm.organizationId === "_none" ? null : editForm.organizationId } })}
                  disabled={updateUser.isPending}
                >
                  {updateUser.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Reset Password Dialog */}
          <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />Reset Password</DialogTitle>
              </DialogHeader>
              <div className="py-2 space-y-3">
                <p className="text-sm text-muted-foreground">Setting new password for: <strong>{selectedUser?.firstName} {selectedUser?.lastName}</strong></p>
                <div>
                  <Label>New Password</Label>
                  <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min. 6 characters" className="mt-1" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setResetPwOpen(false); setNewPassword(""); }}>Cancel</Button>
                <Button
                  onClick={() => selectedUser && resetPassword.mutate({ id: selectedUser.id, password: newPassword })}
                  disabled={resetPassword.isPending || newPassword.length < 6}
                >
                  {resetPassword.isPending ? "Resetting..." : "Reset Password"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* User List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />User Management</CardTitle>
                  <CardDescription>Create, edit, disable users and manage system roles</CardDescription>
                </div>
                <Button className="gap-2" onClick={() => setCreateUserOpen(true)}>
                  <UserPlus className="h-4 w-4" /> Add User
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Search users..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="max-w-xs h-9"
                />
                <Badge variant="outline" className="h-9 px-3 flex items-center">{users.length} users</Badge>
              </div>

              {usersLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>System Role</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((u: any) => (
                        <TableRow key={u.id} className={!u.isActive ? "opacity-50" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                                {u.firstName?.[0]}{u.lastName?.[0]}
                              </div>
                              <span className="font-medium text-sm">{u.firstName} {u.lastName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                          <TableCell>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE[u.role] ?? "bg-muted text-muted-foreground"}`}>
                              {u.role?.replace(/_/g, " ")}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{u.organizationName || "—"}</TableCell>
                          <TableCell>
                            {u.isActive ? (
                              <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Active
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                                <AlertCircle className="h-3.5 w-3.5" /> Disabled
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                title="Edit user"
                                onClick={() => {
                                  setSelectedUser(u);
                                  setEditForm({ firstName: u.firstName, lastName: u.lastName, role: u.role, organizationId: u.organizationId ? String(u.organizationId) : "_none" });
                                  setEditUserOpen(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                title="Reset password"
                                onClick={() => { setSelectedUser(u); setResetPwOpen(true); }}
                              >
                                <Lock className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className={`h-7 w-7 ${u.isActive ? "text-amber-500 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"}`}
                                title={u.isActive ? "Disable user" : "Enable user"}
                                onClick={() => toggleUserActive.mutate({ id: u.id, isActive: !u.isActive })}
                              >
                                {u.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredUsers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            {userSearch ? "No users match your search." : "No users found."}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Role Definitions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Role Definitions</CardTitle>
              <CardDescription>Understanding access levels in the system</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-2">
                {ROLES.map(role => (
                  <div key={role} className="flex items-start gap-3 p-2 rounded border">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize mt-0.5 shrink-0 ${ROLE_BADGE[role]}`}>{role.replace(/_/g, " ")}</span>
                    <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Project Assignment */}
        <TabsContent value="project-assign" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-5 gap-4">
            {/* User selector */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Select User</CardTitle>
                <CardDescription>Choose a user to manage their project access</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[480px] overflow-y-auto">
                {users.map((u: any) => (
                  <button
                    key={u.id}
                    onClick={() => setAssignUser(u)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${assignUser?.id === u.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  >
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                      {u.firstName?.[0]}{u.lastName?.[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    {!u.isActive && <Badge variant="outline" className="text-xs ml-auto shrink-0">Disabled</Badge>}
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Project assignment */}
            <Card className="md:col-span-3">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderKanban className="h-4 w-4" />
                  {assignUser ? `Projects — ${assignUser.firstName} ${assignUser.lastName}` : "Project Access"}
                </CardTitle>
                <CardDescription>
                  {assignUser ? "Toggle projects to add or remove access. Set the role for each project." : "Select a user from the left to manage their project assignments."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!assignUser ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Users className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm">Select a user to manage project access</p>
                  </div>
                ) : (
                  <ProjectAssignmentPanel
                    userId={assignUser.id}
                    projects={projects}
                    addToProject={addToProject.mutate}
                    removeFromProject={removeFromProject.mutate}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Metadata Management */}
        <TabsContent value="metadata" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" />Custom Metadata Fields</CardTitle>
              <CardDescription>Define custom fields applied to documents globally or per project</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(form.metadataFields || []).length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">No custom metadata fields defined yet</p>
              )}
              <div className="space-y-2">
                {(form.metadataFields || []).map((field: any) => (
                  <div key={field.id} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="flex-1 grid grid-cols-4 gap-3 text-sm">
                      <div><span className="text-muted-foreground text-xs block">Field Name</span><span className="font-mono">{field.name}</span></div>
                      <div><span className="text-muted-foreground text-xs block">Label</span>{field.label || field.name}</div>
                      <div><span className="text-muted-foreground text-xs block">Type</span><Badge variant="outline" className="text-xs capitalize">{field.type}</Badge></div>
                      <div className="flex gap-2">
                        {field.required && <Badge className="text-xs">Required</Badge>}
                        <Badge variant="secondary" className="text-xs capitalize">{field.scope}</Badge>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeMetaField(field.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="space-y-3">
                <p className="text-sm font-medium">Add New Field</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Field Name (key)</Label>
                    <Input placeholder="e.g. contract_number" value={newMetaField.name} onChange={e => setNewMetaField(f => ({ ...f, name: e.target.value }))} className="mt-1 font-mono text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Display Label</Label>
                    <Input placeholder="e.g. Contract Number" value={newMetaField.label} onChange={e => setNewMetaField(f => ({ ...f, label: e.target.value }))} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Field Type</Label>
                    <Select value={newMetaField.type} onValueChange={v => setNewMetaField(f => ({ ...f, type: v }))}>
                      <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="dropdown">Dropdown</SelectItem>
                        <SelectItem value="boolean">Yes/No</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Scope</Label>
                    <Select value={newMetaField.scope} onValueChange={v => setNewMetaField(f => ({ ...f, scope: v }))}>
                      <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">Global (all projects)</SelectItem>
                        <SelectItem value="project">Per Project</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 mt-5">
                    <Switch checked={newMetaField.required} onCheckedChange={v => setNewMetaField(f => ({ ...f, required: v }))} />
                    <Label className="text-xs">Required</Label>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addMetaField} className="gap-1 w-full mt-1" size="sm">
                      <Plus className="h-4 w-4" /> Add Field
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Correspondence Types */}
        <TabsContent value="corrtypes" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><FileType className="h-4 w-4" />Correspondence Types</CardTitle>
              <CardDescription>Define custom correspondence types with prefixes, SLA days, and workflows</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">System Types (built-in)</p>
                <div className="flex flex-wrap gap-2">
                  {["RFI", "Submittal", "NCR", "Technical Query", "Transmittal", "Letter", "Memo", "Email", "Notice"].map(t => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Custom Types</p>
                {(form.correspondenceTypes || []).length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">No custom types defined</p>
                )}
                <div className="space-y-2">
                  {(form.correspondenceTypes || []).map((t: any) => (
                    <div key={t.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ background: t.color }} />
                      <div className="flex-1 grid grid-cols-4 gap-2 text-sm">
                        <span className="font-medium">{t.name}</span>
                        <span className="font-mono text-muted-foreground">{t.prefix}-0001</span>
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{t.slaDays}d SLA</span>
                        <span></span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeCorrType(t.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Add Custom Type</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Type Name</Label>
                    <Input placeholder="e.g. Shop Drawing" value={newCorrType.name} onChange={e => setNewCorrType(f => ({ ...f, name: e.target.value }))} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Prefix</Label>
                    <Input placeholder="SD" value={newCorrType.prefix} onChange={e => setNewCorrType(f => ({ ...f, prefix: e.target.value.toUpperCase() }))} className="mt-1 font-mono text-sm uppercase" maxLength={6} />
                  </div>
                  <div>
                    <Label className="text-xs">SLA (days)</Label>
                    <Input type="number" min={1} value={newCorrType.slaDays} onChange={e => setNewCorrType(f => ({ ...f, slaDays: parseInt(e.target.value) || 7 }))} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Color</Label>
                    <div className="flex gap-2 mt-1">
                      <input type="color" value={newCorrType.color} onChange={e => setNewCorrType(f => ({ ...f, color: e.target.value }))} className="h-9 w-12 rounded border cursor-pointer" />
                      <Button onClick={addCorrType} className="gap-1 flex-1" size="sm">
                        <Plus className="h-4 w-4" /> Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numbering */}
        <TabsContent value="numbering" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Hash className="h-4 w-4" />Document Numbering</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Format Template</Label>
                  <Input value={form.documentNumberingFormat || ""} onChange={e => setForm((f: any) => ({ ...f, documentNumberingFormat: e.target.value }))} className="mt-1 font-mono" />
                  <p className="text-xs text-muted-foreground mt-1">Tokens: {"{PROJECT}"} {"{DISCIPLINE}"} {"{TYPE}"} {"{SEQ}"}</p>
                </div>
                <div>
                  <Label>Revision Format</Label>
                  <Select value={form.revisionFormat || "numeric"} onValueChange={v => setForm((f: any) => ({ ...f, revisionFormat: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="numeric">Numeric (0, 1, 2...)</SelectItem>
                      <SelectItem value="alpha">Alphabetic (A, B, C...)</SelectItem>
                      <SelectItem value="revision">Rev 0, Rev 1...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Reference Prefixes</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: "transmittalPrefix", label: "Transmittal" },
                  { key: "rfiPrefix", label: "RFI" },
                  { key: "submittalPrefix", label: "Submittal" },
                  { key: "ncrPrefix", label: "NCR" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="w-28 shrink-0">{label}</Label>
                    <Input value={form[key] || ""} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value.toUpperCase() }))} className="font-mono uppercase" maxLength={5} />
                    <span className="text-muted-foreground text-sm font-mono">-0001</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />SLA Defaults</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: "rfi", label: "RFI Response" },
                  { key: "submittal", label: "Submittal Review" },
                  { key: "transmittal", label: "Transmittal Ack." },
                  { key: "ncr", label: "NCR Resolution" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="w-36 shrink-0">{label}</Label>
                    <Input type="number" value={form.slaDefaults?.[key] || ""} onChange={e => setForm((f: any) => ({ ...f, slaDefaults: { ...(f.slaDefaults || {}), [key]: parseInt(e.target.value) } }))} className="w-20" min={1} />
                    <span className="text-muted-foreground text-sm">days</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Workflows */}
        <TabsContent value="workflows" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4" />Workflow Templates</CardTitle>
              <CardDescription>Reusable document approval workflows available to all projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(form.workflowTemplates || []).map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{t.name}</p>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {t.steps?.map((step: string, i: number) => (
                        <span key={i} className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">{step}</Badge>
                          {i < t.steps.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setForm((f: any) => ({ ...f, workflowTemplates: f.workflowTemplates.filter((x: any) => x.id !== t.id) }))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="gap-1 w-full" onClick={() => window.location.href = "/config"}>
                <GitBranch className="h-4 w-4" /> Manage in Configuration Panel
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Config */}
        <TabsContent value="ai" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Brain className="h-4 w-4" />AI Module Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { key: "documentAnalysis", label: "Document Analysis", desc: "Auto-classify and summarize uploaded documents" },
                  { key: "correspondenceAnalysis", label: "Correspondence Analysis", desc: "Categorize and score incoming correspondence" },
                  { key: "taskPrioritization", label: "Task Prioritization", desc: "AI-driven priority scores and bottleneck detection" },
                  { key: "naturalLanguageSearch", label: "Natural Language Search", desc: "Parse plain English queries into EDMS filters" },
                  { key: "documentProcedure", label: "Document Numbering", desc: "AI-assisted document classification during upload" },
                  { key: "docControlValidation", label: "Document Control Validation", desc: "AI checks for numbering compliance, missing metadata, and duplicates" },
                ].map(({ key, label, desc }) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch defaultChecked={true} />
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1 w-full" onClick={() => window.location.href = "/ai-settings"}>
                  <Brain className="h-4 w-4" /> Advanced AI Settings
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">AI Model Configuration</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Fast Model (document/corr. analysis)</Label>
                  <Select defaultValue="gpt-5-mini">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5-mini">gpt-5-mini (fast)</SelectItem>
                      <SelectItem value="gpt-5">gpt-5 (balanced)</SelectItem>
                      <SelectItem value="gpt-5.2">gpt-5.2 (smart)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Smart Model (reasoning tasks)</Label>
                  <Select defaultValue="gpt-5.2">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5">gpt-5 (balanced)</SelectItem>
                      <SelectItem value="gpt-5.2">gpt-5.2 (smart)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cache Duration (minutes)</Label>
                  <Input type="number" defaultValue={60} min={0} className="mt-1" />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Email */}
        <TabsContent value="email" className="mt-4 space-y-4">
          <EmailConfigTab />
        </TabsContent>

        {/* Storage */}
        <StorageTab />

        {/* Security */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Key className="h-4 w-4" />Security Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Session Timeout (minutes)</Label><Input type="number" defaultValue={60} className="mt-1" /></div>
              <div><Label>Password Minimum Length</Label><Input type="number" defaultValue={8} className="mt-1" /></div>
              <div className="flex items-center justify-between"><Label>Require Strong Passwords</Label><Switch defaultChecked={true} /></div>
              <div className="flex items-center justify-between"><Label>Enable 2FA</Label><Switch defaultChecked={false} /></div>
              <div className="flex items-center justify-between"><Label>Audit All Actions</Label><Switch defaultChecked={true} /></div>
              <div>
                <Label>Allowed IP Ranges (CIDR, one per line)</Label>
                <textarea className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-mono min-h-[80px]" placeholder="0.0.0.0/0 (allow all)" />
              </div>
              <div>
                <Label>JWT Expiry</Label>
                <Select defaultValue="24h">
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1h">1 hour</SelectItem>
                    <SelectItem value="8h">8 hours</SelectItem>
                    <SelectItem value="24h">24 hours</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit Log */}
        <AuditLogTab />

        {/* System & Backup */}
        <SystemTab />

        {/* Branding */}
        <BrandingTab />
      </Tabs>
    </div>
  );
}

// ─── Email Config Tab ─────────────────────────────────────────────────────────
function EmailConfigTab() {
  const { toast } = useToast();
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpResult, setSmtpResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: sysInfo } = useQuery({
    queryKey: ["admin-system-info"],
    queryFn: async () => { const r = await fetch("/api/admin/system-info"); return r.json(); },
  });

  const handleSmtpTest = async () => {
    setSmtpTesting(true);
    setSmtpResult(null);
    try {
      const r = await fetch("/api/admin/smtp/test", { method: "POST" });
      const d = await r.json();
      setSmtpResult(d);
    } catch {
      setSmtpResult({ success: false, message: "Request failed — check API server logs" });
    } finally {
      setSmtpTesting(false);
    }
  };

  const configured = sysInfo?.emailConfigured ?? false;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Email Configuration</CardTitle>
          <CardDescription>Outbound SMTP for review notifications, transmittals, and alerts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${configured ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            {configured
              ? <><CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" /><div><p className="text-sm font-medium text-green-800">SMTP Configured</p><p className="text-xs text-green-700">Host: {sysInfo?.smtpHost ?? "set"} · From: {sysInfo?.smtpFrom ?? "set"}</p></div></>
              : <><AlertCircle className="h-5 w-5 text-amber-600 shrink-0" /><div><p className="text-sm font-medium text-amber-800">SMTP Not Configured</p><p className="text-xs text-amber-700">Set environment variables to enable email notifications</p></div></>
            }
          </div>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Required Environment Variables</h4>
            {[
              { name: "SMTP_HOST", example: "smtp.gmail.com", desc: "SMTP server hostname" },
              { name: "SMTP_PORT", example: "587", desc: "SMTP port (587 for TLS, 465 for SSL)" },
              { name: "SMTP_USER", example: "user@company.com", desc: "Authentication username" },
              { name: "SMTP_PASS", example: "••••••••", desc: "Authentication password / app password" },
              { name: "SMTP_FROM", example: "edms@company.com", desc: "From address for outgoing emails" },
              { name: "SMTP_SECURE", example: "false", desc: "Set to 'true' for SSL (port 465)" },
              { name: "APP_URL", example: "https://your-edms.replit.app", desc: "Base URL used in email links" },
            ].map(({ name, example, desc }) => (
              <div key={name} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded w-28 shrink-0">{name}</span>
                <span className="text-muted-foreground text-xs flex-1">{desc}</span>
                <span className="font-mono text-xs text-muted-foreground">{example}</span>
              </div>
            ))}
          </div>
          <Separator />
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Email Triggers</h4>
            {[
              { event: "Document submitted for review", desc: "Sent to assigned reviewers" },
              { event: "Document approved", desc: "Sent to document creator" },
              { event: "Document rejected", desc: "Sent to document creator with reason" },
              { event: "Transmittal sent", desc: "Sent to external recipients with access link" },
              { event: "Task assigned", desc: "Sent to task assignee" },
            ].map(({ event, desc }) => (
              <div key={event} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-sm">{event}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
            ))}
          </div>
          <Separator />
          <div className="space-y-2">
            <Button onClick={handleSmtpTest} disabled={smtpTesting} variant="outline" className="gap-2 w-full">
              {smtpTesting ? <><Loader2 className="h-4 w-4 animate-spin" /> Testing Connection…</> : <><Mail className="h-4 w-4" /> Test SMTP Connection</>}
            </Button>
            {smtpResult && (
              <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${smtpResult.success ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                {smtpResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>{smtpResult.message}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────
function AuditLogTab() {
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilters, setAuditFilters] = useState({ action: "_all", entityType: "_all", search: "", dateFrom: "", dateTo: "" });
  const { toast } = useToast();

  const params = new URLSearchParams();
  params.set("page", String(auditPage));
  params.set("limit", "50");
  if (auditFilters.action !== "_all") params.set("action", auditFilters.action);
  if (auditFilters.entityType !== "_all") params.set("entityType", auditFilters.entityType);
  if (auditFilters.search) params.set("search", auditFilters.search);
  if (auditFilters.dateFrom) params.set("dateFrom", auditFilters.dateFrom);
  if (auditFilters.dateTo) params.set("dateTo", auditFilters.dateTo);

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["admin-audit-logs", auditPage, auditFilters],
    queryFn: async () => {
      const r = await fetch(`/api/audit-logs?${params}`);
      return r.json();
    },
  });

  const logs: any[] = auditData?.logs ?? [];
  const hasMore: boolean = auditData?.hasMore ?? false;

  const handleExport = () => {
    const ep = new URLSearchParams();
    if (auditFilters.action !== "_all") ep.set("action", auditFilters.action);
    if (auditFilters.entityType !== "_all") ep.set("entityType", auditFilters.entityType);
    if (auditFilters.dateFrom) ep.set("dateFrom", auditFilters.dateFrom);
    if (auditFilters.dateTo) ep.set("dateTo", auditFilters.dateTo);
    window.open(`/api/audit-logs/export?${ep}`, "_blank");
  };

  const ACTION_COLORS: Record<string, string> = {
    create: "bg-green-100 text-green-700",
    update: "bg-blue-100 text-blue-700",
    delete: "bg-red-100 text-red-700",
    approve: "bg-emerald-100 text-emerald-700",
    reject: "bg-orange-100 text-orange-700",
    submit_review: "bg-purple-100 text-purple-700",
    login: "bg-gray-100 text-gray-700",
    send: "bg-cyan-100 text-cyan-700",
  };

  return (
    <TabsContent value="audit" className="mt-4 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Audit Log</CardTitle>
              <CardDescription>Full history of all system actions across all projects</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search…"
                value={auditFilters.search}
                onChange={e => { setAuditFilters(f => ({ ...f, search: e.target.value })); setAuditPage(1); }}
                className="pl-7 h-8 w-44 text-sm"
              />
            </div>
            <Select value={auditFilters.action} onValueChange={v => { setAuditFilters(f => ({ ...f, action: v })); setAuditPage(1); }}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Actions</SelectItem>
                {["create","update","delete","approve","reject","submit_review","login","send","acknowledge"].map(a =>
                  <SelectItem key={a} value={a} className="text-xs capitalize">{a.replace(/_/g, " ")}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select value={auditFilters.entityType} onValueChange={v => { setAuditFilters(f => ({ ...f, entityType: v })); setAuditPage(1); }}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Entity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Types</SelectItem>
                {["document","correspondence","transmittal","project","user","workflow","task"].map(t =>
                  <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Input type="date" value={auditFilters.dateFrom} onChange={e => { setAuditFilters(f => ({ ...f, dateFrom: e.target.value })); setAuditPage(1); }} className="h-8 w-36 text-xs" />
            <Input type="date" value={auditFilters.dateTo} onChange={e => { setAuditFilters(f => ({ ...f, dateTo: e.target.value })); setAuditPage(1); }} className="h-8 w-36 text-xs" />
            {(auditFilters.action !== "_all" || auditFilters.entityType !== "_all" || auditFilters.search || auditFilters.dateFrom || auditFilters.dateTo) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => { setAuditFilters({ action: "_all", entityType: "_all", search: "", dateFrom: "", dateTo: "" }); setAuditPage(1); }}>
                <X className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>

          {/* Table */}
          {auditLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No audit log entries found.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36 text-xs">Date / Time</TableHead>
                    <TableHead className="text-xs">User</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">Entity</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs w-20">Project</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: any) => (
                    <TableRow key={log.id} className="text-xs">
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{log.userName ?? "System"}</TableCell>
                      <TableCell>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700"}`}>
                          {log.action?.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{log.entityType}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{log.entityTitle}</TableCell>
                      <TableCell className="text-muted-foreground">{log.projectId ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">Page {auditPage}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={!hasMore} onClick={() => setAuditPage(p => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

// ─── Storage Tab ──────────────────────────────────────────────────────────────
function StorageTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === "system_owner" || user?.role === "admin";

  const { data: storageData, isLoading, refetch } = useQuery({
    queryKey: ["admin-storage-usage"],
    queryFn: async () => { const r = await fetch("/api/admin/storage-usage"); return r.json(); },
  });
  const usage = storageData?.usage ?? [];

  const [editQuota, setEditQuota] = useState<{ orgId: number; quotaMb: number; storagePath: string } | null>(null);

  const saveQuota = async () => {
    if (!editQuota) return;
    await fetch(`/api/admin/storage-config/${editQuota.orgId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageQuotaMb: editQuota.quotaMb, storagePath: editQuota.storagePath }),
    });
    toast({ title: "Storage config saved" });
    setEditQuota(null);
    refetch();
  };

  const fmtMb = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;

  return (
    <TabsContent value="storage" className="mt-4 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><HardDrive className="h-4 w-4" />Storage Usage by Organisation</CardTitle>
            <CardDescription>Per-organisation document storage consumption and quotas</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 gap-1 text-xs"><RefreshCw className="h-3 w-3" /> Refresh</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No storage data available.</p>
          ) : usage.map((org: any) => (
            <div key={org.orgId} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{org.orgName}</p>
                  <p className="text-xs text-muted-foreground">{org.docCount} documents · {fmtMb(org.usedMb)} used of {fmtMb(org.quotaMb)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={org.percentUsed >= 90 ? "destructive" : org.percentUsed >= 70 ? "secondary" : "outline"} className="text-xs">
                    {org.percentUsed}%
                  </Badge>
                  {isOwner && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditQuota({ orgId: org.orgId, quotaMb: org.quotaMb, storagePath: org.storagePath ?? "" })}>
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  )}
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${org.percentUsed >= 90 ? "bg-red-500" : org.percentUsed >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                  style={{ width: `${org.percentUsed}%` }}
                />
              </div>
              {org.storagePath && (
                <p className="text-xs text-muted-foreground font-mono">Path: {org.storagePath}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editQuota} onOpenChange={v => { if (!v) setEditQuota(null); }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader><DialogTitle>Edit Storage Config</DialogTitle></DialogHeader>
          {editQuota && (
            <div className="space-y-4 py-2">
              <div>
                <Label>Storage Quota (MB)</Label>
                <Input type="number" value={editQuota.quotaMb} onChange={e => setEditQuota(q => q ? { ...q, quotaMb: parseInt(e.target.value) || 0 } : null)} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">1024 MB = 1 GB. Default is 10240 MB (10 GB).</p>
              </div>
              <div>
                <Label>Storage Path Prefix (optional)</Label>
                <Input value={editQuota.storagePath} onChange={e => setEditQuota(q => q ? { ...q, storagePath: e.target.value } : null)} placeholder="org-name/documents" className="mt-1 font-mono text-sm" />
                <p className="text-xs text-muted-foreground mt-1">Prefix used for this org's files in object storage.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditQuota(null)}>Cancel</Button>
            <Button onClick={saveQuota}><Save className="h-4 w-4 mr-2" />Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}

// ─── System & Backup Tab ──────────────────────────────────────────────────────
function SystemTab() {
  const { toast } = useToast();
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpResult, setSmtpResult] = useState<{ success: boolean; message: string } | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreParsed, setRestoreParsed] = useState<any>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const { data: sysInfo, isLoading: sysLoading, refetch: refetchSys } = useQuery({
    queryKey: ["admin-system-info"],
    queryFn: async () => { const r = await fetch("/api/admin/system-info"); return r.json(); },
  });

  const handleSmtpTest = async () => {
    setSmtpTesting(true);
    setSmtpResult(null);
    try {
      const r = await fetch("/api/admin/smtp/test", { method: "POST" });
      const d = await r.json();
      setSmtpResult(d);
    } catch {
      setSmtpResult({ success: false, message: "Request failed" });
    } finally {
      setSmtpTesting(false);
    }
  };

  const handleBackupDownload = () => {
    window.open("/api/admin/backup", "_blank");
  };

  const handleRestoreValidate = async () => {
    if (!restoreFile) return;
    setRestoreLoading(true);
    setRestoreResult(null);
    setRestoreParsed(null);
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);
      setRestoreParsed(backup);
      const r = await fetch("/api/admin/restore/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup }),
      });
      const d = await r.json();
      setRestoreResult(d);
    } catch (e: any) {
      setRestoreResult({ valid: false, error: e.message });
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleRestoreConfirmed = async () => {
    if (!restoreParsed) return;
    setRestoring(true);
    try {
      const r = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: restoreParsed, confirmed: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Restore failed");
      toast({ title: "Restore completed", description: Object.entries(d.restored ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") });
      setConfirmRestoreOpen(false);
      setRestoreFile(null);
      setRestoreResult(null);
      setRestoreParsed(null);
    } catch (e: any) {
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  };

  const fmtBytes = (b: number) => b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`;
  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <TabsContent value="system" className="mt-4 space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        {/* System Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" />System Info</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => refetchSys()} className="h-7 gap-1 text-xs">
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {sysLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : sysInfo ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Users", value: sysInfo.counts?.users ?? 0 },
                    { label: "Projects", value: sysInfo.counts?.projects ?? 0 },
                    { label: "Documents", value: sysInfo.counts?.documents ?? 0 },
                    { label: "Organizations", value: sysInfo.counts?.organizations ?? 0 },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-muted rounded-lg p-3 text-center">
                      <p className="text-xl font-bold">{value}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Node Version</span><span className="font-mono text-xs">{sysInfo.nodeVersion}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Uptime</span><span>{fmtUptime(sysInfo.uptime)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Memory (RSS)</span><span>{fmtBytes(sysInfo.memory?.rss ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Environment</span><span className="capitalize">{sysInfo.env}</span></div>
                </div>
                <Separator />
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Email (SMTP)</span>
                    {sysInfo.emailConfigured
                      ? <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><Wifi className="h-3 w-3" /> Configured</span>
                      : <span className="flex items-center gap-1 text-amber-600 text-xs font-medium"><WifiOff className="h-3 w-3" /> Not Set</span>}
                  </div>
                  {sysInfo.smtpHost && <div className="flex justify-between"><span className="text-muted-foreground">SMTP Host</span><span className="text-xs font-mono">{sysInfo.smtpHost}</span></div>}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Object Storage</span>
                    {sysInfo.storageConfigured
                      ? <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><Wifi className="h-3 w-3" /> Connected</span>
                      : <span className="flex items-center gap-1 text-amber-600 text-xs font-medium"><WifiOff className="h-3 w-3" /> Not Set</span>}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Failed to load system info.</p>
            )}
          </CardContent>
        </Card>

        {/* SMTP Test */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />SMTP Connection Test</CardTitle>
            <CardDescription>Verify your SMTP configuration is working correctly</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure SMTP by setting the <span className="font-mono text-xs bg-muted px-1 rounded">SMTP_HOST</span>, <span className="font-mono text-xs bg-muted px-1 rounded">SMTP_USER</span>, and <span className="font-mono text-xs bg-muted px-1 rounded">SMTP_PASS</span> environment variables.
            </p>
            <Button onClick={handleSmtpTest} disabled={smtpTesting} className="gap-2 w-full" variant="outline">
              {smtpTesting ? <><Loader2 className="h-4 w-4 animate-spin" /> Testing…</> : <><Mail className="h-4 w-4" /> Test SMTP Connection</>}
            </Button>
            {smtpResult && (
              <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${smtpResult.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                {smtpResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>{smtpResult.message}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Backup & Restore */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" />Backup &amp; Restore</CardTitle>
          <CardDescription>Export all system data as JSON, or validate a backup file before restoring</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Backup */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Download className="h-4 w-4" /> Export Backup</h4>
              <p className="text-sm text-muted-foreground">
                Downloads a complete JSON export of all data (users, projects, documents, correspondence, transmittals, tasks). Passwords are excluded for security.
              </p>
              <Button onClick={handleBackupDownload} className="gap-2 w-full" variant="outline">
                <Download className="h-4 w-4" /> Download Backup JSON
              </Button>
            </div>
            {/* Restore */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Upload className="h-4 w-4" /> Restore from Backup</h4>
              <p className="text-sm text-muted-foreground">
                Upload a backup JSON file to validate it, then restore. Existing records are updated using upsert — no data is deleted.
              </p>
              <Input
                type="file"
                accept=".json"
                onChange={e => { setRestoreFile(e.target.files?.[0] ?? null); setRestoreResult(null); setRestoreParsed(null); }}
                className="text-sm"
              />
              <Button onClick={handleRestoreValidate} disabled={!restoreFile || restoreLoading} className="gap-2 w-full" variant="outline">
                {restoreLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Validating…</> : <><CheckCircle2 className="h-4 w-4" /> Validate File</>}
              </Button>
              {restoreResult && (
                <div className={`p-3 rounded-lg text-sm border space-y-2 ${restoreResult.valid ? "bg-green-50 border-green-200 text-green-900" : "bg-red-50 border-red-200 text-red-900"}`}>
                  <div className="flex items-center gap-2 font-semibold">
                    {restoreResult.valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    {restoreResult.valid ? "Valid backup — ready to restore" : "Invalid backup file"}
                  </div>
                  {restoreResult.valid && (
                    <>
                      <p className="text-xs">Exported: {restoreResult.exportedAt ? new Date(restoreResult.exportedAt).toLocaleString() : "Unknown"}</p>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        {Object.entries(restoreResult.counts ?? {}).map(([t, c]) => (
                          <div key={t} className="flex justify-between"><span className="capitalize">{t}:</span><span className="font-mono">{String(c)}</span></div>
                        ))}
                      </div>
                      <Button size="sm" className="w-full gap-1.5 mt-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setConfirmRestoreOpen(true)}>
                        <Upload className="h-3.5 w-3.5" /> Restore Now
                      </Button>
                    </>
                  )}
                  {restoreResult.error && <p className="text-xs">{restoreResult.error}</p>}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmRestoreOpen} onOpenChange={setConfirmRestoreOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700"><AlertCircle className="h-5 w-5" /> Confirm Restore</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3 text-sm text-muted-foreground">
            <p>This will restore all records from the backup file using upsert. Existing records will be updated; new records will be inserted.</p>
            <p className="font-medium text-foreground">This action cannot be undone. Are you sure you want to proceed?</p>
            {restoreResult?.counts && (
              <div className="bg-muted rounded p-3 text-xs space-y-1">
                {Object.entries(restoreResult.counts).map(([t, c]) => (
                  <div key={t} className="flex justify-between"><span className="capitalize">{t}</span><span className="font-mono">{String(c)} records</span></div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRestoreOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRestoreConfirmed} disabled={restoring}>
              {restoring ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Restoring…</> : "Yes, Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}

// ─── Branding Tab ─────────────────────────────────────────────────────────────
function BrandingTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: async () => { const r = await fetch("/api/config"); return r.json(); },
  });

  const [systemName, setSystemName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [logoUrl, setLogoUrl] = useState("");

  // Sync from config when loaded
  useEffect(() => {
    if (config) {
      setSystemName(config.systemName ?? "ArcScale EDMS");
      setPrimaryColor(config.primaryColor ?? "#2563eb");
      setLogoUrl(config.logoUrl ?? "");
    }
  }, [config]);

  const saveBranding = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemName, primaryColor, logoUrl: logoUrl || null }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.message ?? "Failed to save");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      toast({ title: "Branding saved" });
    },
    onError: (e: any) => toast({ title: e.message || "Failed to save branding", variant: "destructive" }),
  });

  return (
    <TabsContent value="branding" className="mt-4 space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        {/* System Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />System Identity</CardTitle>
            <CardDescription>Customize the name and colors that appear throughout the platform</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>System Name</Label>
              <Input
                value={systemName}
                onChange={e => setSystemName(e.target.value)}
                placeholder="ArcScale EDMS"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Displayed on the login page, header, and browser tab</p>
            </div>
            <div>
              <Label>Primary Color</Label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={e => setPrimaryColor(e.target.value)}
                  className="h-9 w-14 rounded border cursor-pointer"
                />
                <Input
                  value={primaryColor}
                  onChange={e => setPrimaryColor(e.target.value)}
                  placeholder="#2563eb"
                  className="font-mono text-sm max-w-[140px]"
                />
                <div
                  className="h-9 w-9 rounded-md border shadow-sm"
                  style={{ backgroundColor: primaryColor }}
                />
              </div>
            </div>
            <div>
              <Label>Logo URL</Label>
              <Input
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Direct URL to your company logo (PNG or SVG recommended)</p>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4" />Live Preview</CardTitle>
            <CardDescription>How your branding will appear to users</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Login preview */}
            <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Login Page</p>
              <div className="flex flex-col items-center gap-2 py-2">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-10 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center text-white text-lg font-bold" style={{ backgroundColor: primaryColor }}>
                    {systemName?.[0] ?? "A"}
                  </div>
                )}
                <p className="font-bold text-sm">{systemName || "ArcScale EDMS"}</p>
                <p className="text-xs text-muted-foreground">Engineering Document Management</p>
                <div className="w-full max-w-[180px] h-8 rounded-md flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: primaryColor }}>
                  Sign In
                </div>
              </div>
            </div>

            {/* Color swatch */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Color Variants</p>
              <div className="flex gap-2">
                {[100, 50, 20, 10].map(opacity => (
                  <div
                    key={opacity}
                    className="h-8 flex-1 rounded"
                    style={{ backgroundColor: primaryColor, opacity: opacity / 100 }}
                    title={`${opacity}%`}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => saveBranding.mutate()} disabled={saveBranding.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {saveBranding.isPending ? "Saving..." : "Save Branding"}
        </Button>
      </div>
    </TabsContent>
  );
}

// ─── Project Assignment Panel ─────────────────────────────────────────────────
function ProjectAssignmentPanel({
  userId,
  projects,
  addToProject,
  removeFromProject,
}: {
  userId: number;
  projects: any[];
  addToProject: (args: { projectId: number; userId: number; role: string }) => void;
  removeFromProject: (args: { projectId: number; userId: number }) => void;
}) {
  const { data: membershipsData } = useQuery({
    queryKey: ["user-project-memberships", userId],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map(async (p: any) => {
          const r = await fetch(`/api/projects/${p.id}/members`);
          const d = await r.json();
          const member = (d.members ?? []).find((m: any) => m.userId === userId);
          return { projectId: p.id, member: member ?? null };
        })
      );
      return results;
    },
    enabled: projects.length > 0,
  });

  const membershipMap = new Map((membershipsData ?? []).map((m: any) => [m.projectId, m.member]));
  const [projectRoles, setProjectRoles] = useState<Record<number, string>>({});

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {projects.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No projects found.</p>
      )}
      {projects.map((p: any) => {
        const member = membershipMap.get(p.id);
        const isMember = !!member;
        const role = projectRoles[p.id] ?? member?.role ?? "reviewer";
        return (
          <div key={p.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isMember ? "border-primary/30 bg-primary/5" : ""}`}>
            <Checkbox
              checked={isMember}
              onCheckedChange={(checked) => {
                if (checked) {
                  addToProject({ projectId: p.id, userId, role });
                } else {
                  removeFromProject({ projectId: p.id, userId });
                }
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">{p.code}</span>
                <span className="font-medium text-sm truncate">{p.name}</span>
              </div>
              {isMember && <span className="text-xs text-primary">Member</span>}
            </div>
            <Select value={role} onValueChange={v => setProjectRoles(r => ({ ...r, [p.id]: v }))}>
              <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_ROLES.map(r => <SelectItem key={r} value={r} className="text-xs capitalize">{r.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, MoreHorizontal, Loader2, Trash2, Pencil, Users, FolderKanban, Mail, Phone, MapPin, X, UserPlus, UserMinus } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";

type OrgType = "client" | "consultant" | "contractor" | "subcontractor";

interface OrgForm {
  name: string;
  type: OrgType;
  contactEmail: string;
  contactPhone: string;
  address: string;
}

const EMPTY_FORM: OrgForm = {
  name: "",
  type: "contractor",
  contactEmail: "",
  contactPhone: "",
  address: "",
};

const TYPE_COLORS: Record<OrgType, string> = {
  client: "bg-blue-100 text-blue-700 border-blue-200",
  consultant: "bg-purple-100 text-purple-700 border-purple-200",
  contractor: "bg-orange-100 text-orange-700 border-orange-200",
  subcontractor: "bg-gray-100 text-gray-700 border-gray-200",
};

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("edms_token") || sessionStorage.getItem("edms_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface OrgFormFieldsProps {
  form: OrgForm;
  setForm: React.Dispatch<React.SetStateAction<OrgForm>>;
}

function OrgFormFields({ form, setForm }: OrgFormFieldsProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-4 pt-2">
      <div>
        <Label className="text-xs font-medium">{t("orgName")} *</Label>
        <Input
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Acme Corp"
          className="mt-1"
          autoFocus
        />
      </div>
      <div>
        <Label className="text-xs font-medium">{t("orgType")} *</Label>
        <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as OrgType }))}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="client">{t("orgTypeClient")}</SelectItem>
            <SelectItem value="consultant">{t("orgTypeConsultant")}</SelectItem>
            <SelectItem value="contractor">{t("orgTypeContractor")}</SelectItem>
            <SelectItem value="subcontractor">{t("orgTypeSubcontractor")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs font-medium">{t("orgContactEmail")}</Label>
        <Input
          type="email"
          value={form.contactEmail}
          onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
          placeholder="info@company.com"
          className="mt-1"
        />
      </div>
      <div>
        <Label className="text-xs font-medium">{t("orgContactPhone")}</Label>
        <Input
          value={form.contactPhone}
          onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
          placeholder="+1 555 000 0000"
          className="mt-1"
        />
      </div>
      <div>
        <Label className="text-xs font-medium">{t("orgAddress")}</Label>
        <Textarea
          value={form.address}
          onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          placeholder="123 Main St, City, Country"
          rows={2}
          className="mt-1 text-sm resize-none"
        />
      </div>
    </div>
  );
}

export default function Organizations() {
  const { toast } = useToast();
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();

  const isSysAdmin = user?.role === "system_owner" || user?.role === "admin";

  const [createOpen, setCreateOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<any | null>(null);
  const [deleteOrg, setDeleteOrg] = useState<any | null>(null);
  const [membersOrg, setMembersOrg] = useState<any | null>(null);
  const [form, setForm] = useState<OrgForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [addUserSearch, setAddUserSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const r = await fetch("/api/organizations", { headers: getAuthHeader() });
      if (!r.ok) throw new Error("Failed to load organizations");
      return r.json();
    },
  });
  const orgs: any[] = data?.organizations ?? [];

  const { data: allUsersData } = useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const r = await fetch("/api/users", { headers: getAuthHeader() });
      if (!r.ok) throw new Error("Failed to load users");
      return r.json();
    },
    enabled: !!membersOrg,
  });
  const allUsers: any[] = allUsersData?.users ?? allUsersData ?? [];

  const orgMembers = allUsers.filter((u: any) => u.organizationId === membersOrg?.id);
  const nonOrgUsers = allUsers.filter((u: any) => u.organizationId !== membersOrg?.id);

  const filteredMembers = orgMembers.filter((u: any) =>
    !memberSearch || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(memberSearch.toLowerCase())
  );
  const filteredNonOrg = nonOrgUsers.filter((u: any) =>
    !addUserSearch || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(addUserSearch.toLowerCase())
  );

  const assignUserMutation = useMutation({
    mutationFn: async ({ userId, orgId }: { userId: number; orgId: number | null }) => {
      const r = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ organizationId: orgId }),
      });
      if (!r.ok) throw new Error("Failed to update user");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-users"] });
      qc.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: () => toast({ variant: "destructive", title: "Failed to update user organization" }),
  });

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(org: any) {
    setForm({
      name: org.name ?? "",
      type: org.type ?? "contractor",
      contactEmail: org.contactEmail ?? "",
      contactPhone: org.contactPhone ?? "",
      address: org.address ?? "",
    });
    setEditOrg(org);
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.type) return;
    setSaving(true);
    try {
      const r = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      toast({ title: t("orgCreated") });
      qc.invalidateQueries({ queryKey: ["organizations"] });
      setCreateOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: t("orgCreateFailed"), description: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!editOrg || !form.name.trim()) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/organizations/${editOrg.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      toast({ title: t("orgUpdated") });
      qc.invalidateQueries({ queryKey: ["organizations"] });
      setEditOrg(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: t("orgUpdateFailed"), description: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteOrg) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/organizations/${deleteOrg.id}`, {
        method: "DELETE",
        headers: getAuthHeader(),
      });
      if (!r.ok && r.status !== 204) throw new Error("Failed");
      toast({ title: t("orgDeleted") });
      qc.invalidateQueries({ queryKey: ["organizations"] });
      setDeleteOrg(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: t("orgDeleteFailed"), description: e.message });
    } finally {
      setSaving(false);
    }
  }

  const typeLabel: Record<OrgType, string> = {
    client: t("orgTypeClient"),
    consultant: t("orgTypeConsultant"),
    contractor: t("orgTypeContractor"),
    subcontractor: t("orgTypeSubcontractor"),
  };

  return (
    <div className={`space-y-6 animate-in fade-in ${isRtl ? "font-[Tahoma,Arial,sans-serif]" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("organizations")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("organizationsDesc")}</p>
        </div>
        {isSysAdmin && (
          <Button onClick={openCreate} className="shadow-sm gap-1.5">
            <Plus className="h-4 w-4" /> {t("addOrganization")}
          </Button>
        )}
      </div>

      {/* Summary cards */}
      {orgs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["client", "consultant", "contractor", "subcontractor"] as OrgType[]).map(type => {
            const count = orgs.filter(o => o.type === type).length;
            return (
              <Card key={type} className="border-border/50">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold ${TYPE_COLORS[type]}`}>
                    {typeLabel[type].slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{typeLabel[type]}</p>
                    <p className="text-xl font-bold leading-tight">{count}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border/50 rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[260px]">{t("organizations")}</TableHead>
              <TableHead>{t("orgType")}</TableHead>
              <TableHead>{t("orgMembers")}</TableHead>
              <TableHead>{t("orgProjects")}</TableHead>
              <TableHead>{t("orgContactEmail")}</TableHead>
              <TableHead>{t("orgAddedOn")}</TableHead>
              {isSysAdmin && <TableHead className="text-right">{t("orgActions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                </TableCell>
              </TableRow>
            ) : orgs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                  {t("orgNoData")}
                </TableCell>
              </TableRow>
            ) : (
              orgs.map((org: any) => (
                <TableRow key={org.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{org.name}</p>
                        {org.address && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3 shrink-0" />{org.address}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize text-xs ${TYPE_COLORS[org.type as OrgType] ?? ""}`}>
                      {typeLabel[org.type as OrgType] ?? org.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      className="flex items-center gap-1.5 text-sm hover:text-primary transition-colors"
                      onClick={() => { setMembersOrg(org); setMemberSearch(""); setAddUserSearch(""); }}
                    >
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="underline-offset-2 hover:underline">{org.userCount ?? 0}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{org.projectCount ?? 0}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {org.contactEmail ? (
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" />{org.contactEmail}</span>
                    ) : org.contactPhone ? (
                      <span className="flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" />{org.contactPhone}</span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(org.createdAt), "dd MMM yyyy")}
                  </TableCell>
                  {isSysAdmin && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">{t("orgActions")}</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel className="text-xs">{t("orgActions")}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => { setMembersOrg(org); setMemberSearch(""); setAddUserSearch(""); }} className="cursor-pointer gap-2">
                            <Users className="h-4 w-4" /> Manage Members
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(org)} className="cursor-pointer gap-2">
                            <Pencil className="h-4 w-4" /> {t("editOrganization")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteOrg(org)}
                            className="text-destructive focus:text-destructive cursor-pointer gap-2"
                          >
                            <Trash2 className="h-4 w-4" /> {t("deleteOrganization")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={v => { if (!saving) setCreateOpen(v); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("addOrganization")}</DialogTitle>
            <DialogDescription>{t("organizationsDesc")}</DialogDescription>
          </DialogHeader>
          <OrgFormFields form={form} setForm={setForm} />
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>{t("cancel")}</Button>
            <Button onClick={handleCreate} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editOrg} onOpenChange={v => { if (!saving && !v) setEditOrg(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("editOrganization")}</DialogTitle>
            <DialogDescription>{editOrg?.name}</DialogDescription>
          </DialogHeader>
          <OrgFormFields form={form} setForm={setForm} />
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setEditOrg(null)} disabled={saving}>{t("cancel")}</Button>
            <Button onClick={handleUpdate} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members dialog */}
      <Dialog open={!!membersOrg} onOpenChange={v => { if (!v) setMembersOrg(null); }}>
        <DialogContent className="sm:max-w-[560px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Members — {membersOrg?.name}
            </DialogTitle>
            <DialogDescription>
              {orgMembers.length} member{orgMembers.length !== 1 ? "s" : ""} in this organization
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-1">
            {/* Current members */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Members</Label>
              <div className="mt-2 space-y-1">
                <Input
                  placeholder="Search members..."
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  className="h-8 text-sm mb-2"
                />
                {filteredMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">No members found</p>
                ) : (
                  <div className="border rounded-lg divide-y max-h-44 overflow-y-auto">
                    {filteredMembers.map((u: any) => (
                      <div key={u.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">{u.firstName} {u.lastName}</p>
                          <p className="text-xs text-muted-foreground">{u.email} · <span className="capitalize">{u.role?.replace(/_/g, " ")}</span></p>
                        </div>
                        {isSysAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => assignUserMutation.mutate({ userId: u.id, orgId: null })}
                            disabled={assignUserMutation.isPending}
                            title="Remove from organization"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Add user section */}
            {isSysAdmin && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add User to Organization</Label>
                <div className="mt-2">
                  <Input
                    placeholder="Search users not in this org..."
                    value={addUserSearch}
                    onChange={e => setAddUserSearch(e.target.value)}
                    className="h-8 text-sm mb-2"
                  />
                  {addUserSearch && (
                    <div className="border rounded-lg divide-y max-h-44 overflow-y-auto">
                      {filteredNonOrg.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-3">No users found</p>
                      ) : (
                        filteredNonOrg.map((u: any) => (
                          <div key={u.id} className="flex items-center justify-between px-3 py-2">
                            <div>
                              <p className="text-sm font-medium">{u.firstName} {u.lastName}</p>
                              <p className="text-xs text-muted-foreground">
                                {u.email} · <span className="capitalize">{u.role?.replace(/_/g, " ")}</span>
                                {u.organizationId && <span className="text-orange-600"> (currently in another org)</span>}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={() => assignUserMutation.mutate({ userId: u.id, orgId: membersOrg.id })}
                              disabled={assignUserMutation.isPending}
                            >
                              <UserPlus className="h-3 w-3" /> Add
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersOrg(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteOrg} onOpenChange={v => { if (!saving && !v) setDeleteOrg(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> {t("deleteOrganization")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("orgDeleteConfirm")}</p>
          <p className="text-sm font-medium">{deleteOrg?.name}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOrg(null)} disabled={saving}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("deleteOrganization")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

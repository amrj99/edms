import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Plus, Trash2, Loader2, ShieldCheck, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Override = {
  id: number;
  userId: number;
  projectId: number;
  roleOverride: string;
  reason: string;
  expiresAt: string;
  isActive: boolean;
  isEffectivelyActive: boolean;
  isExpired: boolean;
  grantedAt: string;
  revokedAt: string | null;
  user: { id: number; firstName: string; lastName: string; email: string; role: string } | null;
  grantedBy: { id: number; firstName: string; lastName: string } | null;
};

const ROLE_LABELS: Record<string, string> = {
  system_owner: "System Owner",
  admin: "Admin",
  project_manager: "Project Manager",
  document_controller: "Document Controller",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  project_manager: "bg-blue-100 text-blue-700",
  admin: "bg-purple-100 text-purple-700",
  document_controller: "bg-cyan-100 text-cyan-700",
  reviewer: "bg-green-100 text-green-700",
  viewer: "bg-gray-100 text-gray-600",
  system_owner: "bg-amber-100 text-amber-700",
};

function OverrideBadge({ o }: { o: Override }) {
  if (!o.isActive) return <Badge variant="secondary" className="text-xs">Revoked</Badge>;
  if (o.isExpired) return <Badge variant="outline" className="text-xs text-muted-foreground">Expired</Badge>;
  return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">Active</Badge>;
}

export function ProjectRoleOverridesTab({ projectId }: { projectId: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  const [form, setForm] = useState({
    userId: "",
    roleOverride: "",
    reason: "",
    expiresAt: "",
  });

  const { data, isLoading } = useQuery<{ overrides: Override[] }>({
    queryKey: ["project-role-overrides", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/role-overrides`);
      if (!r.ok) throw new Error("Failed to load role overrides");
      return r.json();
    },
  });

  const { data: membersData } = useQuery<{ members: any[] }>({
    queryKey: ["project-members", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/members`);
      if (!r.ok) throw new Error("Failed to load members");
      return r.json();
    },
    enabled: showCreate,
  });

  const canManage = user?.role && ["system_owner", "admin", "project_manager"].includes(user.role);

  async function handleCreate() {
    if (!form.userId || !form.roleOverride || !form.reason.trim() || !form.expiresAt) return;
    setPending(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/role-overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: parseInt(form.userId),
          roleOverride: form.roleOverride,
          reason: form.reason.trim(),
          expiresAt: form.expiresAt,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create role override");
      }
      toast({ title: "Role override created", description: "The user will have the elevated role until it expires." });
      queryClient.invalidateQueries({ queryKey: ["project-role-overrides", projectId] });
      setShowCreate(false);
      setForm({ userId: "", roleOverride: "", reason: "", expiresAt: "" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  async function handleRevoke(id: number) {
    setPending(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/role-overrides/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to revoke role override");
      toast({ title: "Role override revoked" });
      queryClient.invalidateQueries({ queryKey: ["project-role-overrides", projectId] });
      setRevokeId(null);
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  const overrides = data?.overrides ?? [];
  const members = membersData?.members ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm">Project Role Overrides</h3>
          <p className="text-muted-foreground text-xs mt-0.5">
            Temporarily elevate a team member's role within this project. Overrides expire automatically.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Add override
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : overrides.length === 0 ? (
        <div className="border rounded-xl py-12 text-center text-muted-foreground">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">No role overrides</p>
          <p className="text-xs mt-1">All members are using their default org roles on this project.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {overrides.map((o) => (
            <div key={o.id} className={cn(
              "border rounded-xl px-4 py-4 bg-card flex items-start justify-between gap-4",
              !o.isEffectivelyActive && "opacity-60",
            )}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <OverrideBadge o={o} />
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", ROLE_COLORS[o.roleOverride] ?? "bg-muted text-muted-foreground")}>
                    {ROLE_LABELS[o.roleOverride] ?? o.roleOverride}
                  </span>
                </div>
                <p className="text-sm font-medium">
                  {o.user ? `${o.user.firstName} ${o.user.lastName}` : `User #${o.userId}`}
                  <span className="text-muted-foreground text-xs ml-1">
                    ({ROLE_LABELS[o.user?.role ?? ""] ?? o.user?.role ?? "—"} → {ROLE_LABELS[o.roleOverride]})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground italic mt-0.5">"{o.reason}"</p>
                <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Expires {format(parseISO(o.expiresAt), "dd MMM yyyy, HH:mm")}
                  </span>
                  {o.grantedBy && (
                    <span>by {o.grantedBy.firstName} {o.grantedBy.lastName}</span>
                  )}
                  {o.revokedAt && (
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      Revoked {format(parseISO(o.revokedAt), "dd MMM yyyy")}
                    </span>
                  )}
                </div>
              </div>
              {o.isEffectivelyActive && canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => setRevokeId(o.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add role override</DialogTitle>
            <DialogDescription>
              Temporarily elevate a member's project role. Their org-level role is unchanged. The override expires automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Member <span className="text-red-500">*</span></Label>
              <Select value={form.userId} onValueChange={(v) => setForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m: any) => (
                    <SelectItem key={m.userId ?? m.id} value={String(m.userId ?? m.id)}>
                      {m.firstName} {m.lastName}
                      <span className="text-muted-foreground ml-1 capitalize text-xs">({(m.role ?? "").replace(/_/g, " ")})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Elevated role <span className="text-red-500">*</span></Label>
              <Select value={form.roleOverride} onValueChange={(v) => setForm(f => ({ ...f, roleOverride: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS)
                    .filter(([k]) => k !== "system_owner")
                    .map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Expires at <span className="text-red-500">*</span></Label>
              <Input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>
            <div className="space-y-2">
              <Label>Reason <span className="text-red-500">*</span></Label>
              <Textarea
                placeholder="e.g. Temporary PM coverage during John's absence, 14–21 April 2026"
                value={form.reason}
                onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={pending}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!form.userId || !form.roleOverride || !form.reason.trim() || !form.expiresAt || pending}
            >
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <Dialog open={revokeId !== null} onOpenChange={(open) => { if (!open) setRevokeId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke role override?</DialogTitle>
            <DialogDescription>
              The member will revert to their default org role on this project immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeId(null)} disabled={pending}>Cancel</Button>
            <Button variant="destructive" onClick={() => revokeId && handleRevoke(revokeId)} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

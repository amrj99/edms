import { useState } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, isAfter } from "date-fns";
import { Users, Plus, Trash2, Loader2, UserCheck, Clock, AlertCircle, CalendarDays, CheckCircle2, XCircle } from "lucide-react";
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

type Delegation = {
  id: number;
  fromUserId: number;
  toUserId: number;
  projectId: number | null;
  projectName: string | null;
  reason: string;
  expiresAt: string;
  isActive: boolean;
  isEffectivelyActive: boolean;
  isExpired: boolean;
  grantedAt: string;
  revokedAt: string | null;
  fromUser: { id: number; firstName: string; lastName: string; email: string; role: string } | null;
  toUser: { id: number; firstName: string; lastName: string; email: string; role: string } | null;
};

function DelegationBadge({ d }: { d: Delegation }) {
  if (!d.isActive) return <Badge variant="secondary" className="text-xs">Revoked</Badge>;
  if (d.isExpired) return <Badge variant="outline" className="text-xs text-muted-foreground">Expired</Badge>;
  return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">Active</Badge>;
}

export default function DelegationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"active" | "all">("active");
  const [showCreate, setShowCreate] = useState(false);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  const [form, setForm] = useState({
    toUserId: "",
    projectId: "",
    reason: "",
    expiresAt: "",
  });

  const { data, isLoading } = useQuery<{ delegations: Delegation[] }>({
    queryKey: ["delegations", scope],
    queryFn: async () => {
      const r = await fetch(`/api/delegations?scope=${scope}`);
      if (!r.ok) throw new Error("Failed to load delegations");
      return r.json();
    },
  });

  const { data: usersData } = useQuery<{ users: any[] }>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const r = await fetch("/api/users?limit=200");
      if (!r.ok) throw new Error("Failed to load users");
      return r.json();
    },
  });

  const { data: projectsData } = useQuery<{ projects: any[] }>({
    queryKey: ["projects-list"],
    queryFn: async () => {
      const r = await fetch("/api/projects?limit=200");
      if (!r.ok) throw new Error("Failed to load projects");
      return r.json();
    },
  });

  const canCreate = user?.role && ["system_owner", "admin", "project_manager"].includes(user.role);

  async function handleCreate() {
    if (!form.toUserId || !form.reason.trim() || !form.expiresAt) return;
    setPending(true);
    try {
      const r = await fetch("/api/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId: parseInt(form.toUserId),
          projectId: form.projectId ? parseInt(form.projectId) : null,
          reason: form.reason.trim(),
          expiresAt: form.expiresAt,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create delegation");
      }
      toast({ title: "Delegation created", description: "The delegate can now act on your behalf." });
      queryClient.invalidateQueries({ queryKey: ["delegations"] });
      setShowCreate(false);
      setForm({ toUserId: "", projectId: "", reason: "", expiresAt: "" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  async function handleRevoke(id: number) {
    setPending(true);
    try {
      const r = await fetch(`/api/delegations/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to revoke delegation");
      toast({ title: "Delegation revoked" });
      queryClient.invalidateQueries({ queryKey: ["delegations"] });
      setRevokeId(null);
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  const delegations = data?.delegations ?? [];
  const otherUsers = (unwrapList<any>(usersData, "users")).filter((u: any) => u.id !== user?.id);

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Delegations</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Grant another user the authority to act on your behalf for a defined period.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" /> New delegation
          </Button>
        )}
      </div>

      {/* Scope toggle */}
      <div className="flex gap-2">
        <Button
          variant={scope === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => setScope("active")}
        >Active only</Button>
        <Button
          variant={scope === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setScope("all")}
        >All</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : delegations.length === 0 ? (
        <div className="border rounded-xl py-16 text-center text-muted-foreground">
          <UserCheck className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No delegations</p>
          <p className="text-sm mt-1">
            {scope === "active" ? "You have no active delegations." : "No delegation records found."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {delegations.map((d) => (
            <div key={d.id} className={cn(
              "border rounded-xl p-5 bg-card shadow-sm",
              !d.isEffectivelyActive && "opacity-60",
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <DelegationBadge d={d} />
                    {d.projectName ? (
                      <Badge variant="outline" className="text-xs">{d.projectName}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Org-wide</Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">
                    <span className="text-muted-foreground">From</span>{" "}
                    {d.fromUser ? `${d.fromUser.firstName} ${d.fromUser.lastName}` : `User #${d.fromUserId}`}
                    <span className="text-muted-foreground"> → </span>
                    {d.toUser ? `${d.toUser.firstName} ${d.toUser.lastName}` : `User #${d.toUserId}`}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 italic">"{d.reason}"</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Granted {format(parseISO(d.grantedAt), "dd MMM yyyy")}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      Expires {format(parseISO(d.expiresAt), "dd MMM yyyy, HH:mm")}
                    </span>
                    {d.revokedAt && (
                      <span className="flex items-center gap-1">
                        <XCircle className="h-3.5 w-3.5" />
                        Revoked {format(parseISO(d.revokedAt), "dd MMM yyyy")}
                      </span>
                    )}
                  </div>
                </div>
                {d.isEffectivelyActive && (d.fromUserId === user?.id || ["system_owner", "admin"].includes(user?.role ?? "")) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => setRevokeId(d.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New delegation</DialogTitle>
            <DialogDescription>
              Grant another user the authority to act on your behalf. All actions they take will be logged as delegated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Delegate to <span className="text-red-500">*</span></Label>
              <Select value={form.toUserId} onValueChange={(v) => setForm(f => ({ ...f, toUserId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {otherUsers.map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.firstName} {u.lastName} — <span className="text-muted-foreground capitalize">{u.role?.replace(/_/g, " ")}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={form.projectId || "__org"} onValueChange={(v) => setForm(f => ({ ...f, projectId: v === "__org" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Org-wide (all projects)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__org">Org-wide (all projects)</SelectItem>
                  {(unwrapList<any>(projectsData, "projects")).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
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
                placeholder="e.g. Covering during annual leave 14–21 April 2026"
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
              disabled={!form.toUserId || !form.reason.trim() || !form.expiresAt || pending}
            >
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create delegation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm dialog */}
      <Dialog open={revokeId !== null} onOpenChange={(open) => { if (!open) setRevokeId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke delegation?</DialogTitle>
            <DialogDescription>
              This will immediately end the delegation. The delegate will no longer be able to act on your behalf.
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

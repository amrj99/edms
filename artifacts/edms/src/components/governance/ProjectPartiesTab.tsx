import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Trash2, Loader2, Building2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type CollaborationMode = "org_only" | "parties";

type Party = {
  id: number;
  partyRole: "observer" | "contributor";
  addedAt: string;
  organization: { id: number; name: string };
  addedBy: { id: number; firstName: string; lastName: string };
};

type Org = { id: number; name: string; code: string; type: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: "observer" | "contributor" }) {
  const cls =
    role === "contributor"
      ? "bg-blue-100 text-blue-700 hover:bg-blue-100"
      : "bg-gray-100 text-gray-600 hover:bg-gray-100";
  return (
    <Badge className={`text-xs capitalize ${cls}`}>
      {role}
    </Badge>
  );
}

function ModeBadge({ mode }: { mode: CollaborationMode }) {
  if (mode === "parties") {
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Parties enabled</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Org-only</Badge>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProjectPartiesTab({
  projectId,
  collaborationMode,
  onModeChange,
}: {
  projectId: number;
  collaborationMode: CollaborationMode;
  onModeChange: (mode: CollaborationMode) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isAdmin = ["admin", "system_owner"].includes(user?.role ?? "");

  // ── State ──────────────────────────────────────────────────────────────────

  const [addOpen, setAddOpen]               = useState(false);
  const [addOrgId, setAddOrgId]             = useState<string>("");
  const [addRole, setAddRole]               = useState<"observer" | "contributor">("observer");
  const [removeParty, setRemoveParty]       = useState<Party | null>(null);
  const [modeWarningOpen, setModeWarningOpen] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: partiesData, isLoading: partiesLoading } = useQuery({
    queryKey: ["project-parties", projectId],
    queryFn: async () => {
      const r = await apiFetch(`/api/projects/${projectId}/parties`);
      if (!r.ok) throw new Error("Failed to load parties");
      return r.json() as Promise<Party[]>;
    },
  });

  const { data: orgsData } = useQuery({
    queryKey: ["project-available-orgs", projectId],
    queryFn: async () => {
      const r = await apiFetch(`/api/projects/${projectId}/available-organizations`);
      if (!r.ok) throw new Error("Failed to load organizations");
      return r.json() as Promise<Org[]>;
    },
    enabled: addOpen,
  });

  const parties = partiesData ?? [];
  const existingOrgIds = new Set(parties.map(p => p.organization.id));
  const availableOrgs = (orgsData ?? []).filter(
    o => !existingOrgIds.has(o.id) && o.id !== user?.organizationId,
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  const addParty = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/api/projects/${projectId}/parties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: parseInt(addOrgId), partyRole: addRole }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to add party");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-parties", projectId] });
      setAddOpen(false);
      setAddOrgId("");
      setAddRole("observer");
      toast({ title: "Party organization added" });
    },
    onError: (err: any) =>
      toast({ title: "Failed to add party", description: err?.message, variant: "destructive" }),
  });

  const removePartyMutation = useMutation({
    mutationFn: async (orgId: number) => {
      const r = await apiFetch(`/api/projects/${projectId}/parties/${orgId}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error("Failed to remove party");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-parties", projectId] });
      setRemoveParty(null);
      toast({ title: "Party organization removed" });
    },
    onError: () =>
      toast({ title: "Failed to remove party", variant: "destructive" }),
  });

  const toggleMode = useMutation({
    mutationFn: async (mode: CollaborationMode) => {
      const r = await apiFetch(`/api/projects/${projectId}/collaboration-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collaborationMode: mode }),
      });
      if (!r.ok) throw new Error("Failed to update collaboration mode");
      return r.json();
    },
    onSuccess: (data) => {
      onModeChange(data.collaborationMode);
      setModeWarningOpen(false);
      toast({
        title:
          data.collaborationMode === "parties"
            ? "Collaboration mode enabled — parties can now access this project"
            : "Collaboration mode disabled — party access suspended",
      });
    },
    onError: () =>
      toast({ title: "Failed to update collaboration mode", variant: "destructive" }),
  });

  function handleToggleMode() {
    if (collaborationMode === "parties") {
      // Switching off → show warning first
      setModeWarningOpen(true);
    } else {
      toggleMode.mutate("parties");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Collaboration Mode ────────────────────────────────────────────── */}
      <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Collaboration Mode</span>
            <ModeBadge mode={collaborationMode} />
          </div>
          <p className="text-xs text-muted-foreground max-w-lg">
            {collaborationMode === "parties"
              ? "External organizations listed below can access this project according to their assigned role ceiling."
              : "Only members of your organization can access this project. Party records are preserved but access is suspended."}
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleMode}
            disabled={toggleMode.isPending}
            className="shrink-0"
          >
            {toggleMode.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {collaborationMode === "parties" ? "Disable parties" : "Enable parties"}
          </Button>
        )}
      </div>

      {/* ── Party list ────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Party Organizations</h3>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Add Party
            </Button>
          )}
        </div>

        {partiesLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : parties.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Building2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No party organizations added yet.</p>
            {isAdmin && (
              <p className="text-xs text-muted-foreground mt-1">
                Use <span className="font-medium">Add Party</span> to invite an external organization.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-semibold">Organization</TableHead>
                  <TableHead className="text-xs font-semibold">Role</TableHead>
                  <TableHead className="text-xs font-semibold">Added By</TableHead>
                  <TableHead className="text-xs font-semibold">Added</TableHead>
                  {isAdmin && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {parties.map(party => (
                  <TableRow key={party.id} className="text-sm">
                    <TableCell className="font-medium">{party.organization.name}</TableCell>
                    <TableCell><RoleBadge role={party.partyRole} /></TableCell>
                    <TableCell className="text-muted-foreground">
                      {party.addedBy.firstName} {party.addedBy.lastName}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {format(new Date(party.addedAt), "dd MMM yyyy")}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setRemoveParty(party)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Role Ceiling Info ─────────────────────────────────────────────── */}
      <div className="rounded-lg bg-muted/40 border p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground text-xs mb-1">Party role permissions (Phase 5 ceiling):</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
          <span>Observer → Read documents &amp; transmittals</span>
          <span>Contributor → Upload documents, create transmittals</span>
          <span>Observer → Cannot upload or create transmittals</span>
          <span>Contributor → Cannot access correspondence or submit reviews</span>
        </div>
      </div>

      {/* ── Add Party Dialog ──────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={v => { if (!v) { setAddOpen(false); setAddOrgId(""); setAddRole("observer"); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Party Organization</DialogTitle>
            <DialogDescription>
              Select an external organization and assign a role ceiling.
              The party must already exist in the system as an organization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="party-org">Organization</Label>
              <Select value={addOrgId} onValueChange={setAddOrgId}>
                <SelectTrigger id="party-org">
                  <SelectValue placeholder={availableOrgs.length === 0 ? "No organizations available" : "Select organization…"} />
                </SelectTrigger>
                <SelectContent>
                  {availableOrgs.map(org => (
                    <SelectItem key={org.id} value={String(org.id)}>
                      <span className="font-medium">{org.name}</span>
                      <span className="ml-2 text-muted-foreground text-xs">{org.code}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="party-role">Role</Label>
              <Select value={addRole} onValueChange={v => setAddRole(v as typeof addRole)}>
                <SelectTrigger id="party-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="observer">
                    <div>
                      <span className="font-medium">Observer</span>
                      <span className="ml-2 text-muted-foreground text-xs">Read-only access to documents &amp; transmittals</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="contributor">
                    <div>
                      <span className="font-medium">Contributor</span>
                      <span className="ml-2 text-muted-foreground text-xs">Can upload documents and create transmittals</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addParty.mutate()}
              disabled={!addOrgId || addParty.isPending}
            >
              {addParty.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Add Party
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove Party Confirmation ─────────────────────────────────────── */}
      <AlertDialog open={!!removeParty} onOpenChange={v => { if (!v) setRemoveParty(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove party organization?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeParty?.organization.name}</strong> will immediately lose access to this project.
              The record is soft-deleted — you can re-add them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeParty && removePartyMutation.mutate(removeParty.organization.id)}
            >
              {removePartyMutation.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Disable Mode Warning ──────────────────────────────────────────── */}
      <AlertDialog open={modeWarningOpen} onOpenChange={setModeWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Disable collaboration mode?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                All party organizations will <strong>immediately lose access</strong> to this project.
              </span>
              <span className="block text-muted-foreground">
                Party records are preserved — re-enabling parties will restore their access without
                needing to re-add them.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep parties enabled</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => toggleMode.mutate("org_only")}
            >
              {toggleMode.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Disable party access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

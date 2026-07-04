import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { Plus, X, Loader2 } from "lucide-react";

interface ProjectParticipant {
  id: number;
  role: string;
  entity: { id: number; name: string };
}

interface PartyEntry {
  participantId: number;
  entityName: string;
  role: string;
  assignmentStrategy: "role_based" | "named";
  stepOrder: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
}

export function CreateSubmittalDialog({ open, onClose, projectId }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("submittal");

  // Step 2 fields
  const [parties, setParties] = useState<PartyEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState<"role_based" | "named">("role_based");

  const { data: participants = [], isLoading: participantsLoading } = useQuery<ProjectParticipant[]>({
    queryKey: ["participants", projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${projectId}/participants`);
      return res.json();
    },
    enabled: open && step === 2,
  });

  const available = participants.filter((p) => !parties.some((pp) => pp.participantId === p.id));

  function addParty() {
    const participant = participants.find((p) => p.id === Number(selectedId));
    if (!participant) return;
    setParties((prev) => [
      ...prev,
      {
        participantId: participant.id,
        entityName: participant.entity.name,
        role: participant.role,
        assignmentStrategy: selectedStrategy,
        stepOrder: prev.length + 1,
      },
    ]);
    setSelectedId("");
  }

  function removeParty(idx: number) {
    setParties((prev) =>
      prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, stepOrder: i + 1 })),
    );
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const createRes = await apiFetch(
        `/api/projects/${projectId}/submission-chains`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || undefined,
            type,
          }),
        },
      );
      if (!createRes.ok) {
        const body = await createRes.json();
        throw new Error(body.message ?? body.error ?? "Failed to create submittal");
      }
      const chain = await createRes.json();

      if (parties.length > 0) {
        const partiesRes = await apiFetch(
          `/api/projects/${projectId}/submission-chains/${chain.id}/setup-parties`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              parties: parties.map((p) => ({
                participantId: p.participantId,
                stepOrder: p.stepOrder,
                assignmentStrategy: p.assignmentStrategy,
              })),
            }),
          },
        );
        if (!partiesRes.ok) {
          const body = await partiesRes.json();
          throw new Error(body.message ?? body.error ?? "Failed to setup parties");
        }
      }

      return chain;
    },
    onSuccess: (chain) => {
      qc.invalidateQueries({ queryKey: ["submission-chains", projectId] });
      toast({ title: "Submittal created" });
      handleClose();
      navigate(`/projects/${projectId}/submittals/${chain.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create submittal", description: err.message, variant: "destructive" });
    },
  });

  function handleClose() {
    setStep(1);
    setTitle("");
    setDescription("");
    setType("submittal");
    setParties([]);
    setSelectedId("");
    setSelectedStrategy("role_based");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New Submittal</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Step {step} of 2 — {step === 1 ? "Basic Information" : "Party Sequence"}
          </p>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Shop Drawings — Structural Steel"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="submittal">Submittal</SelectItem>
                  <SelectItem value="rfi">RFI</SelectItem>
                  <SelectItem value="ncr">NCR</SelectItem>
                  <SelectItem value="mir">MIR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Description{" "}
                <span className="text-muted-foreground font-normal text-xs">(optional)</span>
              </Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Brief description of what this submittal covers"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Define who participates in this chain and in what order. The first party is the
              originator (stepOrder 1).
            </p>

            {/* Add party row */}
            {participantsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select participant..." />
                  </SelectTrigger>
                  <SelectContent>
                    {available.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        All participants added
                      </SelectItem>
                    ) : (
                      available.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.entity.name}{" "}
                          <span className="text-muted-foreground text-xs">
                            ({p.role.replace(/_/g, " ")})
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedStrategy}
                  onValueChange={(v) => setSelectedStrategy(v as "role_based" | "named")}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="role_based">Role Based</SelectItem>
                    <SelectItem value="named">Named</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={addParty} disabled={!selectedId}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Party sequence */}
            {parties.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
                Add at least 2 parties — originator (step 1) + reviewer (step 2).
              </div>
            ) : (
              <div className="space-y-2 max-h-[220px] overflow-y-auto">
                {parties.map((party, idx) => (
                  <div
                    key={party.participantId}
                    className="flex items-center gap-3 border rounded-lg p-3"
                  >
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">
                      {party.stepOrder}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{party.entityName}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {party.role.replace(/_/g, " ")} ·{" "}
                        {party.assignmentStrategy.replace(/_/g, " ")}
                      </p>
                    </div>
                    {idx === 0 && (
                      <span className="text-xs text-muted-foreground shrink-0">Originator</span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeParty(idx)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button disabled={!title.trim()} onClick={() => setStep(2)}>
                Next →
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={createMut.isPending}>
                ← Back
              </Button>
              <Button
                disabled={parties.length < 2 || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? "Creating..." : "Create Submittal"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { ArrowRight } from "lucide-react";

interface ChainParty {
  id: number;
  participantId: number | null;
  stepOrder: number;
  label: string | null;
}

interface ProjectParticipant {
  id: number;
  role: string;
  entity: { id: number; name: string };
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  chainId: number;
  parties: ChainParty[];
  currentParticipantId: number | null;
  participants: ProjectParticipant[];
}

export function ForwardDialog({
  open,
  onClose,
  projectId,
  chainId,
  parties,
  currentParticipantId,
  participants,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const currentParty = parties.find((p) => p.participantId === currentParticipantId);
  const nextParty = parties.find(
    (p) => p.stepOrder === (currentParty?.stepOrder ?? 0) + 1,
  );
  const nextParticipant = nextParty?.participantId
    ? participants.find((p) => p.id === nextParty.participantId)
    : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!nextParty?.participantId) throw new Error("No next participant configured");
      const res = await apiFetch(
        `/api/projects/${projectId}/submission-chains/${chainId}/forward`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toParticipantId: nextParty.participantId }),
        },
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? body.error ?? "Forward failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["submission-chain", chainId] });
      toast({ title: "Chain forwarded" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to forward", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Forward Chain</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {nextParticipant ? (
            <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3">
              <ArrowRight className="h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Forwarding to</p>
                <p className="font-medium">{nextParticipant.entity.name}</p>
                <p className="text-xs text-muted-foreground capitalize mt-0.5">
                  {nextParticipant.role.replace(/_/g, " ")} · Step {nextParty!.stepOrder}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              No next participant is configured in the party sequence. There is no one to forward to.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!nextParty?.participantId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Forwarding..." : "Confirm Forward"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { RotateCcw } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  chainId: number;
  nextRevisionCycle: number;
}

export function ResubmitDialog({ open, onClose, projectId, chainId, nextRevisionCycle }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/api/projects/${projectId}/submission-chains/${chainId}/resubmit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? body.error ?? "Resubmit failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["submission-chain", chainId] });
      toast({ title: `Resubmitted — Revision Cycle ${nextRevisionCycle} started` });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to resubmit", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Resubmit for Review</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
            <RotateCcw className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-sm">Starting Revision Cycle {nextRevisionCycle}</p>
              <p className="text-sm text-muted-foreground mt-1">
                The chain will return to <span className="font-medium">active</span> and move
                to the next reviewer in the sequence.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Resubmitting..." : "Confirm Resubmit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

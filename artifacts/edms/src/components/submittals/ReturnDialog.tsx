import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

// Code A is excluded — backend rejects it on return.
const RETURN_CODES = [
  { value: "B", label: "B — Approved with Comments" },
  { value: "C", label: "C — Revise and Resubmit" },
  { value: "D", label: "D — Rejected" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  chainId: number;
}

export function ReturnDialog({ open, onClose, projectId, chainId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reviewCode, setReviewCode] = useState("");
  const [comments, setComments] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/api/projects/${projectId}/submission-chains/${chainId}/return`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewCode, comments: comments.trim() || undefined }),
        },
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? body.error ?? "Return failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["submission-chain", chainId] });
      toast({ title: "Chain returned to originator" });
      setReviewCode("");
      setComments("");
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to return chain", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Return Chain</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Returning the chain sends it back to the previous party and sets the status to{" "}
            <span className="font-medium">Returned</span>.
          </p>
          <div className="space-y-1.5">
            <Label>Review Code <span className="text-destructive">*</span></Label>
            <Select value={reviewCode} onValueChange={setReviewCode}>
              <SelectTrigger>
                <SelectValue placeholder="Select return code" />
              </SelectTrigger>
              <SelectContent>
                {RETURN_CODES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              Comments{" "}
              <span className="text-muted-foreground font-normal text-xs">(optional)</span>
            </Label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              placeholder="Explain what needs to be revised..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reviewCode || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Returning..." : "Return Chain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

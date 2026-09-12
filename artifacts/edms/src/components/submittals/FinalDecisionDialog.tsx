import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

// Final decision is taken by the LAST party in the chain. Only positive outcomes:
// A = Approved, B = Approved with Comments (comment mandatory). C/D go through Return.
const DECISION_CODES = [
  { value: "A", label: "A — Approved" },
  { value: "B", label: "B — Approved with Comments" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  chainId: number;
}

export function FinalDecisionDialog({ open, onClose, projectId, chainId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reviewCode, setReviewCode] = useState("");
  const [comments, setComments] = useState("");

  const commentRequired = reviewCode === "B";
  const commentMissing = commentRequired && !comments.trim();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/api/projects/${projectId}/submission-chains/${chainId}/final-decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewCode, comments: comments.trim() || undefined }),
        },
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? body.error ?? "Final decision failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["submission-chain", chainId] });
      toast({ title: reviewCode === "A" ? "Submittal approved" : "Submittal approved with comments" });
      setReviewCode("");
      setComments("");
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to record final decision", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Final Decision</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            As the final party you close this submittal. Approval propagates to the
            submitted document(s) of the active revision cycle. To send it back for
            revision, use <span className="font-medium">Return</span> (code C or D) instead.
          </p>
          <div className="space-y-1.5">
            <Label>Decision <span className="text-destructive">*</span></Label>
            <Select value={reviewCode} onValueChange={setReviewCode}>
              <SelectTrigger>
                <SelectValue placeholder="Select decision" />
              </SelectTrigger>
              <SelectContent>
                {DECISION_CODES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              Final Approval Comment{" "}
              {commentRequired
                ? <span className="text-destructive">*</span>
                : <span className="text-muted-foreground font-normal text-xs">(optional)</span>}
            </Label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              placeholder={commentRequired ? "Required for 'Approved with Comments'…" : "Optional note recorded with the approval…"}
            />
            {commentMissing && (
              <p className="text-xs text-destructive">A final approval comment is required for “Approved with Comments”.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!reviewCode || commentMissing || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Recording…" : "Record Decision"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

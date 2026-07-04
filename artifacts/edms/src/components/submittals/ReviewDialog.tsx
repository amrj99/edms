import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

const REVIEW_CODES = [
  { value: "A", label: "A — Approved" },
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

export function ReviewDialog({ open, onClose, projectId, chainId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reviewCode, setReviewCode] = useState("");
  const [comments, setComments] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/api/projects/${projectId}/submission-chains/${chainId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewCode, comments: comments.trim() || undefined }),
        },
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? body.error ?? "Review failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["submission-chain", chainId] });
      toast({ title: "Review recorded" });
      setReviewCode("");
      setComments("");
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to record review", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Record Review</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Review Code</Label>
            <Select value={reviewCode} onValueChange={setReviewCode}>
              <SelectTrigger>
                <SelectValue placeholder="Select review code" />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_CODES.map((c) => (
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
              placeholder="Add review comments..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!reviewCode || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving..." : "Submit Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

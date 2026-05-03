import { useEffect, useState } from "react";
import { Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type PlanRestrictionDetail } from "@/lib/api";
import { useLocation } from "wouter";

interface ModalState {
  open: boolean;
  code: string;
  message: string;
}

const MESSAGES: Record<string, { title: string; body: string; Icon: React.ElementType }> = {
  READ_ONLY_ACCOUNT: {
    title: "Account restricted to read-only",
    body: "Your organisation is on the Free plan. Creating, editing, and deleting records is not available. Upgrade to restore full access.",
    Icon: Lock,
  },
  UPLOAD_BLOCKED: {
    title: "File uploads not available",
    body: "Your organisation is on the Free plan and file uploads are disabled. Upgrade your plan to continue uploading documents.",
    Icon: Upload,
  },
};

const FALLBACK = {
  title: "Action restricted",
  body: "Your organisation is on the Free plan and this action is restricted. Upgrade your plan to continue.",
  Icon: Lock,
};

export function PlanRestrictionModal() {
  const [state, setState] = useState<ModalState>({ open: false, code: "", message: "" });
  const [, navigate] = useLocation();

  useEffect(() => {
    function handleEvent(e: Event) {
      const detail = (e as CustomEvent<PlanRestrictionDetail>).detail;
      setState({ open: true, code: detail.code, message: detail.message });
    }
    window.addEventListener("plan-restriction", handleEvent);
    return () => window.removeEventListener("plan-restriction", handleEvent);
  }, []);

  const { title, body, Icon } = MESSAGES[state.code] ?? FALLBACK;

  function handleUpgrade() {
    setState(s => ({ ...s, open: false }));
    navigate("/billing");
  }

  return (
    <Dialog open={state.open} onOpenChange={(open) => setState(s => ({ ...s, open }))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 shrink-0">
              <Icon className="h-5 w-5" />
            </div>
            <DialogTitle className="text-base leading-snug">{title}</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            {body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setState(s => ({ ...s, open: false }))}>
            Dismiss
          </Button>
          <Button onClick={handleUpgrade} className="bg-amber-600 hover:bg-amber-700 text-white">
            Upgrade plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

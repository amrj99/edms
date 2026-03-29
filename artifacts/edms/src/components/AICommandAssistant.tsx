import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Loader2, Sparkles, CheckCircle, AlertCircle, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const EXAMPLES = [
  "Schedule a progress review meeting for next Tuesday at 10am in Conference Room A",
  "Create an RFI about anchor bolt specifications for foundation design",
  "Draft a memo informing the team about revised drawing submission dates",
  "Create a high priority notice about a non-conformance in concrete pour CE-042",
];

type CommandResult = {
  action: "create" | "unknown";
  type?: "correspondence" | "meeting" | "document" | "task";
  data?: Record<string, any>;
  summary: string;
};

export function AICommandAssistant() {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const analyzeCmd = useMutation({
    mutationFn: async (cmd: string) => {
      const r = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      if (!r.ok) throw new Error("AI service unavailable");
      return r.json() as Promise<CommandResult>;
    },
    onSuccess: (data) => setResult(data),
    onError: () => toast({ title: "AI unavailable", description: "Could not process your command", variant: "destructive" }),
  });

  const handleCreate = async () => {
    if (!result?.data || result.action !== "create") return;
    setCreating(true);
    try {
      let endpoint = "";
      let body = { ...result.data };

      if (result.type === "meeting") {
        endpoint = "/api/meetings";
      } else if (result.type === "correspondence") {
        endpoint = "/api/projects/0/correspondence";
        body.sendNow = true;
      } else if (result.type === "task") {
        endpoint = "/api/tasks";
      } else if (result.type === "document") {
        endpoint = "/api/documents";
      } else {
        toast({ title: "Unsupported record type" });
        setCreating(false);
        return;
      }

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message || "Failed to create record");
      }

      toast({ title: `${result.type?.charAt(0).toUpperCase()}${result.type?.slice(1)} created!`, description: result.summary });
      qc.invalidateQueries({ queryKey: [result.type + "s"] });
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["correspondence"] });

      setOpen(false);
      setCommand("");
      setResult(null);

      if (result.type === "meeting") navigate("/meetings");
      else if (result.type === "correspondence") navigate("/correspondence");
    } catch (err: any) {
      toast({ title: "Creation failed", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setCommand("");
  };

  const handleClose = () => {
    setOpen(false);
    handleReset();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs px-2.5 border-primary/30 hover:border-primary/60 hover:bg-primary/5"
        onClick={() => setOpen(true)}
        title="AI Command Assistant"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="hidden md:block">AI</span>
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              AI Command Assistant
            </DialogTitle>
          </DialogHeader>

          {!result ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Describe what you want to create in plain language. The AI will parse your intent and pre-fill a new record.
              </p>
              <Textarea
                placeholder="e.g. Create an RFI about anchor bolt specifications for foundation design..."
                value={command}
                onChange={e => setCommand(e.target.value)}
                rows={4}
                className="resize-none"
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && command.trim()) {
                    analyzeCmd.mutate(command.trim());
                  }
                }}
              />
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground font-medium">Examples:</p>
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    className="w-full text-left text-xs text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-3 py-2 rounded-md transition-colors"
                    onClick={() => setCommand(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button
                  onClick={() => analyzeCmd.mutate(command.trim())}
                  disabled={!command.trim() || analyzeCmd.isPending}
                  className="gap-1.5"
                >
                  {analyzeCmd.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {analyzeCmd.isPending ? "Analyzing..." : "Analyze ⌘↵"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {result.action === "unknown" ? (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Could not parse command</p>
                    <p className="text-sm text-amber-700 mt-0.5">{result.summary}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="capitalize">{result.type}</Badge>
                        <p className="text-sm font-medium text-green-800">Ready to create</p>
                      </div>
                      <p className="text-sm text-green-700">{result.summary}</p>
                    </div>
                  </div>

                  {result.data && (
                    <div className="border rounded-lg divide-y text-sm">
                      {Object.entries(result.data).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                        <div key={k} className="flex gap-3 px-3 py-2">
                          <span className="text-muted-foreground capitalize w-28 shrink-0">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                          <span className="font-medium text-foreground truncate">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={handleReset} className="gap-1.5">
                  <X className="h-3.5 w-3.5" /> Try Again
                </Button>
                {result.action === "create" && (
                  <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                    {creating ? "Creating..." : `Create ${result.type}`}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

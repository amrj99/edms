import { useState, useEffect } from "react";
import {
  Mail, Plus, Send, Inbox, Archive, Loader2, ArrowRight, Brain,
  FolderKanban, ChevronDown, RefreshCw, Clock, User, X,
} from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";

interface CorrespondenceItem {
  id: number;
  subject: string;
  type: string;
  folder: string;
  body?: string;
  fromUserName?: string;
  status: string;
  createdAt: string;
  referenceNumber?: string;
}

interface Project {
  id: number;
  name: string;
  code: string;
}

const FOLDERS = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "archive", label: "Archive", icon: Archive },
];

const TYPE_COLORS: Record<string, string> = {
  internal: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  email: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  notice: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  memo: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  letter: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
  rfi: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  transmittal: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
};

export default function General() {
  const { toast } = useToast();
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [items, setItems] = useState<CorrespondenceItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<CorrespondenceItem | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [isMoving, setIsMoving] = useState(false);

  // Compose state
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeType, setComposeType] = useState("internal");
  const [isSending, setIsSending] = useState(false);

  const loadItems = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/general/correspondence?folder=${activeFolder}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setItems(Array.isArray(data) ? data : (data?.items ?? []));
    } catch {
      toast({ variant: "destructive", title: "Could not load inbox" });
    } finally {
      setIsLoading(false);
    }
  };

  const loadProjects = async () => {
    try {
      const res = await fetch("/api/general/my-projects");
      const data = await res.json();
      setMyProjects(data ?? []);
    } catch {}
  };

  useEffect(() => { loadItems(); }, [activeFolder]);
  useEffect(() => { loadProjects(); }, []);

  const handleCompose = async () => {
    if (!composeSubject.trim()) {
      toast({ variant: "destructive", title: "Subject is required" });
      return;
    }
    setIsSending(true);
    try {
      const res = await fetch("/api/general/correspondence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: composeSubject,
          body: composeBody,
          type: composeType,
          status: "sent",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Message sent", description: "It's now in your General sent folder." });
      setShowCompose(false);
      setComposeSubject("");
      setComposeBody("");
      loadItems();
    } catch {
      toast({ variant: "destructive", title: "Failed to send message" });
    } finally {
      setIsSending(false);
    }
  };

  const handleMove = async () => {
    if (!selected || !moveTarget) return;
    setIsMoving(true);
    try {
      const res = await fetch(`/api/general/correspondence/${selected.id}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: parseInt(moveTarget) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to move");
      }
      const project = myProjects.find(p => p.id === parseInt(moveTarget));
      toast({
        title: "Moved to project",
        description: `The item was moved to "${project?.name}".`,
      });
      setShowMove(false);
      setSelected(null);
      loadItems();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Move failed", description: err.message });
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="flex h-full gap-0 -m-6 animate-in fade-in">
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 border-r bg-muted/30 p-4 space-y-1">
        <div className="flex items-center gap-2 mb-4 px-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold text-sm">General</span>
        </div>

        <Button
          size="sm"
          className="w-full gap-2 mb-3"
          onClick={() => setShowCompose(true)}
        >
          <Plus className="h-4 w-4" />
          Compose
        </Button>

        {FOLDERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveFolder(key)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              activeFolder === key
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}

        <div className="pt-4 mt-4 border-t">
          <p className="text-xs font-medium text-muted-foreground px-2 mb-2 uppercase tracking-wide">My Projects</p>
          {myProjects.slice(0, 5).map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{p.name}</span>
            </div>
          ))}
          {myProjects.length === 0 && (
            <p className="text-xs text-muted-foreground px-2">No projects yet</p>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h1 className="text-xl font-bold capitalize">{activeFolder}</h1>
            <p className="text-xs text-muted-foreground">
              Cross-department communications — not tied to any project
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={loadItems}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-16 text-center">
              <Mail className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-medium text-muted-foreground">No messages here</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {activeFolder === "inbox"
                  ? "You have no general correspondence in your inbox."
                  : `Nothing in ${activeFolder}.`}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setSelected(item); setShowAI(false); }}
                  className={`w-full text-left px-6 py-4 hover:bg-muted/50 transition-colors ${
                    selected?.id === item.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`text-[10px] capitalize flex-shrink-0 ${TYPE_COLORS[item.type] ?? ""}`}>
                          {item.type}
                        </Badge>
                        {item.referenceNumber && (
                          <span className="text-xs font-mono text-muted-foreground">{item.referenceNumber}</span>
                        )}
                      </div>
                      <h3 className="font-medium text-sm truncate">{item.subject}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {item.fromUserName}
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(item.createdAt), "MMM d")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-96 border-l flex flex-col flex-shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold text-sm truncate flex-1 mr-2">{selected.subject}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelected(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Meta */}
            <div className="space-y-2 pb-3 border-b">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">From:</span>
                <span className="font-medium">{selected.fromUserName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Type:</span>
                <Badge className={`text-[10px] capitalize ${TYPE_COLORS[selected.type] ?? ""}`}>{selected.type}</Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Status:</span>
                <Badge variant="outline" className="text-[10px] capitalize">{selected.status}</Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Date:</span>
                <span>{format(new Date(selected.createdAt), "MMM d, yyyy HH:mm")}</span>
              </div>
            </div>

            {/* Body */}
            {selected.body && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Message</h4>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.body}</p>
              </div>
            )}

          </div>

          {/* Actions */}
          <div className="p-4 border-t space-y-2">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                setShowMove(true);
                setMoveTarget("");
              }}
            >
              <FolderKanban className="h-4 w-4" />
              Move to Project
            </Button>
          </div>
        </div>
      )}

      {/* Compose dialog */}
      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Message — General Section</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Subject *</label>
                <Input
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Message subject..."
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
                <Select value={composeType} onValueChange={setComposeType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="notice">Notice</SelectItem>
                    <SelectItem value="memo">Memo</SelectItem>
                    <SelectItem value="letter">Letter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Message</label>
              <Textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                placeholder="Write your message..."
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompose(false)}>Cancel</Button>
            <Button onClick={handleCompose} disabled={isSending} className="gap-2">
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to project dialog */}
      <Dialog open={showMove} onOpenChange={setShowMove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Project</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Move "<span className="font-medium text-foreground">{selected?.subject}</span>" to one of your projects.
              The item will appear in that project's correspondence tab.
            </p>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {myProjects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{p.code}</span>
                      {p.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {myProjects.length === 0 && (
              <p className="text-xs text-orange-600">You are not a member of any project yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMove(false)}>Cancel</Button>
            <Button
              onClick={handleMove}
              disabled={isMoving || !moveTarget}
              className="gap-2"
            >
              {isMoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

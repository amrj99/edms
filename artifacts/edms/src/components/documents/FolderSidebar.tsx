import { useState, useRef } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Folder, FolderOpen, Plus, Pencil, Trash2, ChevronRight, ChevronDown,
  MoreHorizontal, Copy, FolderPlus, X, Check, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface FolderNode {
  id: number;
  name: string;
  projectId: number;
  parentId: number | null;
  documentCount: number;
  children?: FolderNode[];
}

interface FolderSidebarProps {
  projectId: number;
  selectedFolderId: number | null | "root";
  onSelectFolder: (id: number | null) => void;
  canEdit?: boolean;
}

function buildTree(folders: FolderNode[]): FolderNode[] {
  const map = new Map<number, FolderNode>();
  folders.forEach(f => map.set(f.id, { ...f, children: [] }));
  const roots: FolderNode[] = [];
  map.forEach(node => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function FolderItem({
  node, depth, selected, onSelect, onRename, onDelete, onAddChild, canEdit,
}: {
  node: FolderNode;
  depth: number;
  selected: boolean;
  onSelect: (id: number) => void;
  onRename: (folder: FolderNode) => void;
  onDelete: (folder: FolderNode) => void;
  onAddChild: (parentId: number) => void;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = (node.children?.length ?? 0) > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer group text-sm",
          "hover:bg-accent/60",
          selected && "bg-primary/10 text-primary font-medium",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          className="p-0.5 shrink-0"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
        >
          {hasChildren
            ? expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
            : <span className="h-3 w-3 block" />}
        </button>
        {expanded && hasChildren
          ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        <span className="flex-1 truncate">{node.name}</span>
        {node.documentCount > 0 && (
          <Badge variant="secondary" className="h-4 text-[10px] px-1 ml-auto shrink-0">
            {node.documentCount}
          </Badge>
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
              <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent">
                <MoreHorizontal className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={e => { e.stopPropagation(); onAddChild(node.id); }}>
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> Add subfolder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={e => { e.stopPropagation(); onRename(node); }}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={e => { e.stopPropagation(); onDelete(node); }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map(child => (
            <FolderItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected && false}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              onAddChild={onAddChild}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderSidebar({ projectId, selectedFolderId, onSelectFolder, canEdit = false }: FolderSidebarProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newFolderParent, setNewFolderParent] = useState<number | null | "root">(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FolderNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FolderNode | null>(null);
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["project-folders", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/folders`);
      return r.json();
    },
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
    enabled: copyFromOpen,
  });

  const folders: FolderNode[] = unwrapList<FolderNode>(data, "folders");
  const tree = buildTree(folders);

  const createMut = useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId: number | null }) => {
      const r = await fetch(`/api/projects/${projectId}/documents/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-folders", projectId] });
      setNewFolderParent(null);
      setNewFolderName("");
      toast({ title: "Folder created" });
    },
  });

  const renameMut = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const r = await fetch(`/api/projects/${projectId}/documents/folders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-folders", projectId] });
      setRenameTarget(null);
      toast({ title: "Folder renamed" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/projects/${projectId}/documents/folders/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-folders", projectId] });
      if (selectedFolderId === deleteTarget?.id) onSelectFolder(null);
      setDeleteTarget(null);
      toast({ title: "Folder deleted" });
    },
  });

  const copyMut = useMutation({
    mutationFn: async (sourceProjectId: number) => {
      const r = await fetch(`/api/projects/${projectId}/documents/folders/copy-from`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceProjectId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["project-folders", projectId] });
      setCopyFromOpen(false);
      toast({ title: `Copied ${d.copiedCount} folders` });
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Folders</span>
        {canEdit && (
          <div className="flex gap-1">
            <button
              className="h-6 w-6 rounded hover:bg-accent flex items-center justify-center"
              title="New root folder"
              onClick={() => { setNewFolderParent("root"); setNewFolderName(""); }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              className="h-6 w-6 rounded hover:bg-accent flex items-center justify-center"
              title="Copy folder structure from another project"
              onClick={() => setCopyFromOpen(true)}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* All Documents */}
      <button
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-sm w-full text-left hover:bg-accent/60 rounded-md mx-1 my-0.5",
          selectedFolderId === null && "bg-primary/10 text-primary font-medium",
        )}
        onClick={() => onSelectFolder(null)}
      >
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
        All Documents
        <Badge variant="secondary" className="ml-auto h-4 text-[10px] px-1">
          {folders.reduce((s, f) => s + f.documentCount, 0)}
        </Badge>
      </button>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && tree.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No folders yet.{canEdit ? " Click + to create one." : ""}
          </p>
        )}
        {tree.map(node => (
          <FolderItem
            key={node.id}
            node={node}
            depth={0}
            selected={selectedFolderId === node.id}
            onSelect={onSelectFolder}
            onRename={f => { setRenameTarget(f); setRenameValue(f.name); }}
            onDelete={setDeleteTarget}
            onAddChild={pid => { setNewFolderParent(pid); setNewFolderName(""); }}
            canEdit={canEdit}
          />
        ))}

        {/* Inline new folder input */}
        {newFolderParent !== null && (
          <div className="flex items-center gap-1 px-2 py-1 mx-1">
            <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <Input
              autoFocus
              className="h-6 text-xs"
              placeholder="Folder name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newFolderName.trim()) {
                  createMut.mutate({ name: newFolderName.trim(), parentId: newFolderParent === "root" ? null : newFolderParent });
                }
                if (e.key === "Escape") { setNewFolderParent(null); setNewFolderName(""); }
              }}
            />
            <button
              className="p-1 hover:bg-accent rounded"
              onClick={() => {
                if (newFolderName.trim()) createMut.mutate({ name: newFolderName.trim(), parentId: newFolderParent === "root" ? null : newFolderParent });
              }}
            >
              <Check className="h-3.5 w-3.5 text-green-600" />
            </button>
            <button className="p-1 hover:bg-accent rounded" onClick={() => { setNewFolderParent(null); setNewFolderName(""); }}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename Folder</DialogTitle></DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && renameValue.trim()) renameMut.mutate({ id: renameTarget!.id, name: renameValue.trim() }); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button
              disabled={!renameValue.trim() || renameMut.isPending}
              onClick={() => renameMut.mutate({ id: renameTarget!.id, name: renameValue.trim() })}
            >
              {renameMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Folder</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <strong>{deleteTarget?.name}</strong>? Documents and subfolders will be moved to the parent folder.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleteTarget!.id)}
            >
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy from project dialog */}
      <Dialog open={copyFromOpen} onOpenChange={setCopyFromOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Copy Folder Structure</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Import the folder tree from another project in your organization.
          </p>
          <Select value={copySourceId} onValueChange={setCopySourceId}>
            <SelectTrigger>
              <SelectValue placeholder="Select source project" />
            </SelectTrigger>
            <SelectContent>
              {(unwrapList<any>(projectsData, "projects"))
                .filter((p: any) => p.id !== projectId)
                .map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyFromOpen(false)}>Cancel</Button>
            <Button
              disabled={!copySourceId || copyMut.isPending}
              onClick={() => copyMut.mutate(parseInt(copySourceId))}
            >
              {copyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Copy Structure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

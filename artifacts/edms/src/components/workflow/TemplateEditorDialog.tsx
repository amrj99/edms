/**
 * TemplateEditorDialog
 *
 * Full CRUD editor for a workflow template. Supports:
 * - Create from scratch
 * - Edit existing (name, documentType, description, isActive)
 * - Add / remove / edit stages (name, role, user, isTerminal)
 * - Drag-and-drop stage reordering (@dnd-kit/sortable)
 * - Stage user assignment (org users dropdown)
 */

import { useState, useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/lib/auth";
import { useOrgContext } from "@/lib/org-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  GripVertical, Trash2, Plus, Loader2, Check, ChevronRight, Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WfTemplate {
  id: number;
  name: string;
  documentType: string;
  documentTypeId?: number | null;
  description?: string;
  isActive: boolean;
  stages: WfStage[];
}

interface DocumentType {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

export interface WfStage {
  id: number;
  templateId: number;
  stageOrder: number;
  name: string;
  description?: string;
  responsibleRole?: string;
  responsibleUserId?: number | null;
  isTerminal: boolean;
  slaDays?: number | null;
  reminderDays?: number | null;
}

interface LocalStage {
  localId: string;
  dbId: number | null;
  name: string;
  description: string;
  responsibleRole: string;
  responsibleUserId: number | null;
  isTerminal: boolean;
  slaDays: number | null;
  reminderDays: number | null;
}

interface OrgUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`/api${path}`, { credentials: "include", ...opts }).then(async r => {
    const j = await r.json();
    if (!r.ok) {
      const base = j.error ?? "Request failed";
      const detail = j.detail ? ` — ${j.detail}` : "";
      const code = j.code ? ` [${j.code}]` : "";
      throw new Error(`${base}${detail}${code}`);
    }
    return j;
  });

const apiPost = (path: string, body: object) =>
  apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const apiPut = (path: string, body: object) =>
  apiFetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const apiDel = (path: string) =>
  apiFetch(path, { method: "DELETE" });

function makeLocalId() {
  return Math.random().toString(36).slice(2);
}

function stageToLocal(s: WfStage): LocalStage {
  return {
    localId: makeLocalId(),
    dbId: s.id,
    name: s.name,
    description: s.description ?? "",
    responsibleRole: s.responsibleRole ?? "",
    responsibleUserId: s.responsibleUserId ?? null,
    isTerminal: s.isTerminal,
    slaDays: s.slaDays ?? null,
    reminderDays: s.reminderDays ?? null,
  };
}

function emptyStage(): LocalStage {
  return {
    localId: makeLocalId(),
    dbId: null,
    name: "",
    description: "",
    responsibleRole: "",
    responsibleUserId: null,
    isTerminal: false,
    slaDays: null,
    reminderDays: null,
  };
}

// ─── Sortable Stage Row ───────────────────────────────────────────────────────

function SortableStageRow({
  stage,
  index,
  total,
  users,
  onChange,
  onDelete,
}: {
  stage: LocalStage;
  index: number;
  total: number;
  users: OrgUser[];
  onChange: (localId: string, patch: Partial<LocalStage>) => void;
  onDelete: (localId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.localId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-lg border bg-card p-3 space-y-2",
        isDragging && "opacity-50 shadow-lg z-50 ring-2 ring-primary",
      )}
    >
      {/* Stage header row */}
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 rounded shrink-0"
          type="button"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Stage number */}
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0 mt-0.5">
          {index + 1}
        </div>

        {/* Name */}
        <Input
          className="flex-1 h-8 text-sm"
          placeholder="Stage name*"
          value={stage.name}
          onChange={e => onChange(stage.localId, { name: e.target.value })}
        />

        {/* Terminal toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch
            checked={stage.isTerminal}
            onCheckedChange={v => onChange(stage.localId, { isTerminal: v })}
            className="data-[state=checked]:bg-green-500"
          />
          <span className="text-xs text-muted-foreground hidden sm:block">
            {stage.isTerminal ? "Terminal" : ""}
          </span>
        </div>

        {/* Delete */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(stage.localId)}
          type="button"
          disabled={total <= 1}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Stage detail row */}
      <div className="flex gap-2 pl-9">
        {/* Role */}
        <Input
          className="flex-1 h-7 text-xs"
          placeholder="Responsible role (e.g. Reviewer)"
          value={stage.responsibleRole}
          onChange={e => onChange(stage.localId, { responsibleRole: e.target.value })}
        />

        {/* User assignment */}
        <Select
          value={String(stage.responsibleUserId ?? "none")}
          onValueChange={v => onChange(stage.localId, { responsibleUserId: v === "none" ? null : Number(v) })}
        >
          <SelectTrigger className="h-7 text-xs w-44">
            <SelectValue placeholder="No specific user" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No specific user</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.firstName} {u.lastName}
                <span className="text-muted-foreground ml-1 capitalize text-xs">({u.role.replace(/_/g, " ")})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* SLA row */}
      <div className="flex gap-2 pl-9 items-center">
        <div className="flex items-center gap-1.5 flex-1">
          <label className="text-xs text-muted-foreground whitespace-nowrap">SLA days</label>
          <Input
            type="number"
            min={1}
            className="h-7 text-xs w-20"
            placeholder="None"
            value={stage.slaDays ?? ""}
            onChange={e => {
              const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
              onChange(stage.localId, { slaDays: v && v > 0 ? v : null });
            }}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-1">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Remind days before</label>
          <Input
            type="number"
            min={1}
            className="h-7 text-xs w-20"
            placeholder="None"
            value={stage.reminderDays ?? ""}
            onChange={e => {
              const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
              onChange(stage.localId, { reminderDays: v && v > 0 ? v : null });
            }}
          />
        </div>
        {stage.slaDays !== null && (
          <span className="text-xs text-muted-foreground">
            ≈ {stage.slaDays} calendar day{stage.slaDays !== 1 ? "s" : ""} allowed
          </span>
        )}
      </div>

      {/* Terminal badge */}
      {stage.isTerminal && (
        <div className="pl-9">
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" /> This is the terminal/final stage — completing it closes the workflow
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Dialog ──────────────────────────────────────────────────────────────

interface TemplateEditorDialogProps {
  template: WfTemplate | null;
  open: boolean;
  onClose: () => void;
  onSaved: (template: WfTemplate) => void;
}

export function TemplateEditorDialog({
  template,
  open,
  onClose,
  onSaved,
}: TemplateEditorDialogProps) {
  const { toast } = useToast();
  const { activeOrgId } = useOrgContext();
  const isNew = template === null;

  // ── Local state ────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [documentTypeId, setDocumentTypeId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [stages, setStages] = useState<LocalStage[]>([]);
  const [deletedDbIds, setDeletedDbIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset whenever dialog opens or template changes
  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setDocumentTypeId(template.documentTypeId ?? null);
      setDescription(template.description ?? "");
      setIsActive(template.isActive);
      setStages(
        [...template.stages]
          .sort((a, b) => a.stageOrder - b.stageOrder)
          .map(stageToLocal),
      );
    } else {
      setName("");
      setDocumentTypeId(null);
      setDescription("");
      setIsActive(true);
      setStages([emptyStage()]);
    }
    setDeletedDbIds([]);
  }, [open, template]);

  // ── Org users for assignment dropdown ─────────────────────────────────────
  const { data: usersData } = useQuery({
    queryKey: ["org-users", activeOrgId],
    queryFn: () => apiFetch(activeOrgId ? `/users?organizationId=${activeOrgId}` : "/users"),
    staleTime: 120_000,
  });
  const users: OrgUser[] = usersData?.users ?? usersData ?? [];

  // ── Document types for the document type dropdown ─────────────────────────
  // queryKey includes activeOrgId so the cache is org-specific.
  // window.fetch is patched by OrgContextProvider to inject ?orgOverride= when
  // activeOrgId is set, which requireAuth uses to scope the backend query.
  const { data: documentTypesData } = useQuery({
    queryKey: ["document-types", activeOrgId],
    queryFn: () => apiFetch("/document-types"),
    staleTime: 120_000,
  });
  const documentTypes: DocumentType[] = Array.isArray(documentTypesData) ? documentTypesData : [];
  const selectableDocumentTypes = documentTypes.filter(dt => dt.isActive || dt.id === documentTypeId);

  // ── DnD setup ─────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setStages(prev => {
      const oldIdx = prev.findIndex(s => s.localId === active.id);
      const newIdx = prev.findIndex(s => s.localId === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  // ── Stage mutations ────────────────────────────────────────────────────────
  const changeStage = (localId: string, patch: Partial<LocalStage>) => {
    setStages(prev => prev.map(s => s.localId === localId ? { ...s, ...patch } : s));
  };

  const deleteStage = (localId: string) => {
    const stage = stages.find(s => s.localId === localId);
    if (stage?.dbId) setDeletedDbIds(prev => [...prev, stage.dbId!]);
    setStages(prev => prev.filter(s => s.localId !== localId));
  };

  const addStage = () => {
    setStages(prev => [...prev, emptyStage()]);
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const isValid = name.trim().length > 0 && documentTypeId !== null && stages.every(s => s.name.trim().length > 0);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      let tplId: number;
      let savedTemplate: WfTemplate;

      if (isNew) {
        // Create template
        const created = await apiPost("/workflow-engine/templates", {
          name: name.trim(),
          documentTypeId,
          description: description.trim() || undefined,
          isActive,
        });
        tplId = created.id;

        // Create all stages
        for (let i = 0; i < stages.length; i++) {
          const s = stages[i];
          await apiPost(`/workflow-engine/templates/${tplId}/stages`, {
            name: s.name.trim(),
            description: s.description.trim() || undefined,
            responsibleRole: s.responsibleRole.trim() || undefined,
            responsibleUserId: s.responsibleUserId ?? undefined,
            isTerminal: s.isTerminal,
            stageOrder: i + 1,
            slaDays: s.slaDays ?? undefined,
            reminderDays: s.reminderDays ?? undefined,
          });
        }
      } else {
        tplId = template!.id;

        // Update template metadata
        await apiPut(`/workflow-engine/templates/${tplId}`, {
          name: name.trim(),
          documentTypeId,
          description: description.trim() || undefined,
          isActive,
        });

        // Delete removed stages
        for (const dbId of deletedDbIds) {
          await apiDel(`/workflow-engine/templates/${tplId}/stages/${dbId}`);
        }

        // Create new + update existing stages (in order)
        for (let i = 0; i < stages.length; i++) {
          const s = stages[i];
          const payload = {
            name: s.name.trim(),
            description: s.description.trim() || undefined,
            responsibleRole: s.responsibleRole.trim() || undefined,
            responsibleUserId: s.responsibleUserId ?? undefined,
            isTerminal: s.isTerminal,
            stageOrder: i + 1,
            slaDays: s.slaDays ?? null,
            reminderDays: s.reminderDays ?? null,
          };
          if (s.dbId) {
            await apiPut(`/workflow-engine/templates/${tplId}/stages/${s.dbId}`, payload);
          } else {
            await apiPost(`/workflow-engine/templates/${tplId}/stages`, payload);
          }
        }
      }

      // Fetch full updated template
      savedTemplate = await apiFetch(`/workflow-engine/templates/${tplId}`);
      toast({ title: isNew ? "Template created" : "Template saved" });
      onSaved(savedTemplate);
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to save", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Create New Workflow Template" : "Edit Workflow Template"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── Template metadata ── */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template Details</div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-sm">Template name *</Label>
                <Input
                  className="mt-1"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Drawing Approval Workflow"
                />
              </div>

              {/* Document type */}
              <div>
                <Label className="text-sm">Document type *</Label>
                <Select
                  value={documentTypeId !== null ? String(documentTypeId) : undefined}
                  onValueChange={v => setDocumentTypeId(Number(v))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select document type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableDocumentTypes.map(dt => (
                      <SelectItem key={dt.id} value={String(dt.id)}>
                        {dt.name}{!dt.isActive ? " (inactive)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {documentTypes.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {activeOrgId === null
                      ? "Select a specific organization first to see available document types."
                      : "No document types defined yet — add one in Admin → Document Types."}
                  </p>
                )}
              </div>

              {/* Active toggle */}
              <div>
                <Label className="text-sm">Status</Label>
                <div className="flex items-center gap-2 mt-2.5">
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-sm text-muted-foreground">{isActive ? "Active" : "Inactive"}</span>
                </div>
              </div>

              {/* Description */}
              <div className="col-span-2">
                <Label className="text-sm">Description (optional)</Label>
                <Textarea
                  className="mt-1 h-16 resize-none text-sm"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Briefly describe when this workflow should be used"
                />
              </div>
            </div>
          </div>

          {/* ── Stages ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-semibold">Stages</div>
                <div className="text-xs text-muted-foreground">Drag to reorder. Toggle the green switch to mark the last stage as terminal.</div>
              </div>
              <Badge variant="outline">{stages.length} stage{stages.length !== 1 ? "s" : ""}</Badge>
            </div>

            {/* Flow preview */}
            {stages.length > 0 && (
              <div className="flex items-center gap-1 mb-3 flex-wrap bg-muted/40 rounded-lg px-3 py-2">
                {stages.map((s, i) => (
                  <span key={s.localId} className="flex items-center gap-1 text-xs">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                    <span className={cn(
                      "px-1.5 py-0.5 rounded",
                      !s.name.trim() ? "bg-muted text-muted-foreground italic" : s.isTerminal
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
                    )}>
                      {s.name.trim() || "Unnamed"}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={stages.map(s => s.localId)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {stages.map((s, i) => (
                    <SortableStageRow
                      key={s.localId}
                      stage={s}
                      index={i}
                      total={stages.length}
                      users={Array.isArray(users) ? users : []}
                      onChange={changeStage}
                      onDelete={deleteStage}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <Button
              variant="outline"
              size="sm"
              className="w-full mt-3 border-dashed"
              onClick={addStage}
              type="button"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Stage
            </Button>

            {stages.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 text-center">
                At least one stage is required.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isNew ? "Create Template" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

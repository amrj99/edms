/**
 * RulesTab — Admin panel for managing automation rules.
 * Shows a priority-ordered list of rules with enable/disable toggle.
 * Provides a dialog for creating and editing rules with a condition
 * builder and action builder.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Loader2, GripVertical, ToggleLeft, ToggleRight,
  Zap, AlertTriangle, X, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RuleCondition {
  field: string;
  value: string;
}

const CONDITION_FIELDS = [
  { value: "documentType", label: "Document Type" },
  { value: "discipline", label: "Discipline" },
  { value: "projectId", label: "Project ID" },
  { value: "subjectContains", label: "Subject Contains" },
  { value: "senderUserId", label: "Sender User ID" },
];

interface RuleAction {
  type: string;
  userId?: string;
  teamId?: string;
  message?: string;
}

const ACTION_TYPES = [
  { value: "assign_user", label: "Assign to User" },
  { value: "assign_team", label: "Assign to Team" },
  { value: "send_notification", label: "Send Notification" },
];

interface Rule {
  id: number;
  name: string;
  description: string | null;
  priority: number;
  isEnabled: boolean;
  appliesTo: "document" | "correspondence" | "both";
  conditions: Record<string, string>;
  actions: RuleAction[];
  createdAt: string;
}

const EMPTY_FORM = (): Omit<Rule, "id" | "createdAt"> => ({
  name: "",
  description: "",
  priority: 10,
  isEnabled: true,
  appliesTo: "both",
  conditions: {},
  actions: [],
});

// ─── Condition Row ────────────────────────────────────────────────────────────

function ConditionRow({
  cond,
  onChange,
  onRemove,
}: {
  cond: RuleCondition;
  onChange: (c: RuleCondition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-2 items-center">
      <Select value={cond.field} onValueChange={v => onChange({ ...cond, field: v })}>
        <SelectTrigger className="h-8 text-xs w-44">
          <SelectValue placeholder="Field" />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_FIELDS.map(f => (
            <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground shrink-0">equals</span>
      <Input
        value={cond.value}
        onChange={e => onChange({ ...cond, value: e.target.value })}
        placeholder="Value"
        className="h-8 text-xs flex-1"
      />
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={onRemove}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Action Row ───────────────────────────────────────────────────────────────

function ActionRow({
  action,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  onChange: (a: RuleAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-3 border rounded-md bg-muted/20">
      <div className="flex items-center gap-2">
        <Select value={action.type} onValueChange={v => onChange({ ...action, type: v })}>
          <SelectTrigger className="h-8 text-xs w-48">
            <SelectValue placeholder="Action type" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive ml-auto" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {action.type === "assign_user" && (
        <Input
          value={action.userId ?? ""}
          onChange={e => onChange({ ...action, userId: e.target.value })}
          placeholder="User ID"
          className="h-8 text-xs"
        />
      )}
      {action.type === "assign_team" && (
        <Input
          value={action.teamId ?? ""}
          onChange={e => onChange({ ...action, teamId: e.target.value })}
          placeholder="Team name"
          className="h-8 text-xs"
        />
      )}
      {(action.type === "send_notification" || action.type === "assign_user") && (
        <Input
          value={action.message ?? ""}
          onChange={e => onChange({ ...action, message: e.target.value })}
          placeholder="Notification message (optional)"
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}

// ─── Rule Dialog ──────────────────────────────────────────────────────────────

function RuleDialog({
  open,
  rule,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Omit<Rule, "id" | "createdAt">>(
    rule ? { ...rule } : EMPTY_FORM()
  );
  const [saving, setSaving] = useState(false);

  // Convert conditions object to array for editing
  const [condRows, setCondRows] = useState<RuleCondition[]>(() =>
    Object.entries(rule?.conditions ?? {}).map(([field, value]) => ({
      field,
      value: String(value),
    }))
  );
  const [actionRows, setActionRows] = useState<RuleAction[]>(() =>
    rule?.actions ?? []
  );

  const addCondition = () =>
    setCondRows(r => [...r, { field: CONDITION_FIELDS[0].value, value: "" }]);

  const addAction = () =>
    setActionRows(r => [...r, { type: ACTION_TYPES[0].value }]);

  async function handleSave() {
    if (!form.name.trim()) {
      toast({ title: "Rule name is required", variant: "destructive" });
      return;
    }
    const conditions: Record<string, string> = {};
    condRows.forEach(c => { if (c.field && c.value) conditions[c.field] = c.value; });

    const payload = { ...form, conditions, actions: actionRows };
    setSaving(true);
    try {
      const url = rule ? `/api/rules/${rule.id}` : "/api/rules";
      const method = rule ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: rule ? "Rule updated" : "Rule created" });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Failed to save rule", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            {rule ? "Edit Rule" : "New Rule"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Name + Priority */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Rule Name *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Notify on structural documents"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Priority</Label>
              <Input
                type="number"
                min={1}
                max={999}
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={form.description ?? ""}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Optional description…"
              className="text-xs resize-none"
            />
          </div>

          {/* Applies To + Enabled */}
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Applies To</Label>
              <Select
                value={form.appliesTo}
                onValueChange={(v: any) => setForm(f => ({ ...f, appliesTo: v }))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="document" className="text-xs">Documents only</SelectItem>
                  <SelectItem value="correspondence" className="text-xs">Correspondence only</SelectItem>
                  <SelectItem value="both" className="text-xs">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch
                checked={form.isEnabled}
                onCheckedChange={v => setForm(f => ({ ...f, isEnabled: v }))}
              />
              <Label className="text-xs">{form.isEnabled ? "Enabled" : "Disabled"}</Label>
            </div>
          </div>

          {/* Conditions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Conditions (AND)</Label>
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={addCondition}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {condRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No conditions — rule matches everything.</p>
            ) : (
              <div className="space-y-2">
                {condRows.map((c, i) => (
                  <ConditionRow
                    key={i}
                    cond={c}
                    onChange={nc => setCondRows(r => r.map((x, j) => j === i ? nc : x))}
                    onRemove={() => setCondRows(r => r.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Actions</Label>
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={addAction}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {actionRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No actions defined yet.</p>
            ) : (
              <div className="space-y-2">
                {actionRows.map((a, i) => (
                  <ActionRow
                    key={i}
                    action={a}
                    onChange={na => setActionRows(r => r.map((x, j) => j === i ? na : x))}
                    onRemove={() => setActionRows(r => r.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {rule ? "Save changes" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main RulesTab ────────────────────────────────────────────────────────────

export function RulesTab({ orgId }: { orgId?: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);

  // Show informational message when user has no org
  if (orgId === null || orgId === undefined) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
        <Zap className="h-8 w-8 mx-auto text-muted-foreground/40" />
        <p className="text-sm font-medium">Organization required</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Automation rules are organization-specific. Your account is not linked to an organization.
          Rules created by org members will appear here.
        </p>
      </div>
    );
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-rules"],
    queryFn: async () => {
      const r = await fetch("/api/rules", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load rules");
      return r.json() as Promise<{ rules: Rule[] }>;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (rule: Rule) => {
      const r = await fetch(`/api/rules/${rule.id}/toggle`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Toggle failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-rules"] }),
    onError: () => toast({ title: "Failed to toggle rule", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/rules/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-rules"] });
      toast({ title: "Rule deleted" });
    },
    onError: () => toast({ title: "Failed to delete rule", variant: "destructive" }),
  });

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Automation Rules</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Rules run in priority order on new documents and correspondence.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => { setEditRule(null); setDialogOpen(true); }}
        >
          <Plus className="h-3.5 w-3.5" />
          New rule
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
          <Zap className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm font-medium">No rules yet</p>
          <p className="text-xs text-muted-foreground">
            Create your first rule to automatically assign, notify, or route items.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 gap-1.5"
            onClick={() => { setEditRule(null); setDialogOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" /> Create rule
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rules
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map(rule => (
              <div
                key={rule.id}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  rule.isEnabled ? "bg-card" : "bg-muted/30 opacity-70"
                }`}
              >
                {/* Priority badge */}
                <span className="text-[10px] font-mono text-muted-foreground w-6 text-center shrink-0">
                  {rule.priority}
                </span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{rule.name}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] capitalize shrink-0"
                    >
                      {rule.appliesTo}
                    </Badge>
                    {!rule.isEnabled && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {rule.description}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {Object.keys(rule.conditions).length} condition(s) · {rule.actions.length} action(s)
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Switch
                    checked={rule.isEnabled}
                    onCheckedChange={() => toggleMutation.mutate(rule)}
                    className="scale-90"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Edit"
                    onClick={() => { setEditRule(rule); setDialogOpen(true); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    title="Delete"
                    onClick={() => {
                      if (confirm(`Delete rule "${rule.name}"?`)) deleteMutation.mutate(rule.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}

      <RuleDialog
        open={dialogOpen}
        rule={editRule}
        onClose={() => setDialogOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["admin-rules"] })}
      />
    </div>
  );
}

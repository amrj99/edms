import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, FileType, Plus, Pencil, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TemplateEditorDialog, type WfTemplate } from "@/components/workflow/TemplateEditorDialog";

const FIELD_TYPES = ["text", "number", "date", "select", "multiselect", "boolean"] as const;

interface MetadataFieldRow {
  id: number;
  name: string;
  label: string;
  fieldType: typeof FIELD_TYPES[number];
  options: string[] | null;
  required: boolean;
  isActive: boolean;
  documentTypeId: number | null;
}

export default function DocumentTypeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const documentTypeId = parseInt(id!);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [nameInput, setNameInput] = useState<string | null>(null);
  const [newField, setNewField] = useState({ name: "", label: "", fieldType: "text" as MetadataFieldRow["fieldType"], options: "", required: false });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTemplate, setEditorTemplate] = useState<WfTemplate | null>(null);

  const { data: documentTypesData, isLoading: typeLoading } = useQuery({
    queryKey: ["document-types"],
    queryFn: async () => { const r = await fetch("/api/document-types"); return r.ok ? r.json() : []; },
  });
  const docType = (documentTypesData || []).find((dt: any) => dt.id === documentTypeId);

  const { data: metadataFieldsData, isLoading: fieldsLoading } = useQuery({
    queryKey: ["metadata-fields", documentTypeId],
    queryFn: async () => {
      const r = await fetch(`/api/metadata-fields?documentTypeId=${documentTypeId}`, { credentials: "include" });
      return r.ok ? r.json() : { fields: [] };
    },
    enabled: !!documentTypeId,
  });
  const typeSpecificFields: MetadataFieldRow[] = (metadataFieldsData?.fields || []).filter((f: MetadataFieldRow) => f.documentTypeId === documentTypeId);

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: async () => {
      const r = await fetch("/api/workflow-engine/templates", { credentials: "include" });
      return r.ok ? r.json() : { templates: [] };
    },
  });
  const linkedTemplates: WfTemplate[] = (templatesData?.templates || []).filter((t: WfTemplate) => t.documentTypeId === documentTypeId);

  const updateDocumentType = useMutation({
    mutationFn: async (data: { name?: string; isActive?: boolean }) => {
      const r = await fetch(`/api/document-types/${documentTypeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update document type");
      }
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-types"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createField = useMutation({
    mutationFn: async (data: { name: string; label: string; fieldType: string; options: string[]; required: boolean }) => {
      const r = await fetch("/api/metadata-fields", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, documentTypeId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create metadata field");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["metadata-fields"] });
      qc.invalidateQueries({ queryKey: ["metadata-fields", documentTypeId] });
      setNewField({ name: "", label: "", fieldType: "text", options: "", required: false });
      toast({ title: "Metadata field created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateField = useMutation({
    mutationFn: async ({ id: fieldId, data }: { id: number; data: Partial<{ label: string; options: string[]; required: boolean; isActive: boolean }> }) => {
      const r = await fetch(`/api/metadata-fields/${fieldId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update metadata field");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["metadata-fields"] });
      qc.invalidateQueries({ queryKey: ["metadata-fields", documentTypeId] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (typeLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!docType) {
    return (
      <div className="max-w-lg mx-auto py-24 text-center">
        <FileType className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">Document type not found</h2>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/admin"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Admin</Link>
        </Button>
      </div>
    );
  }

  const needsOptions = (ft: string) => ft === "select" || ft === "multiselect";

  return (
    <div className="space-y-6 animate-in fade-in max-w-4xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Link href="/admin"><ArrowLeft className="h-4 w-4" /> Document Types</Link>
        </Button>
      </div>

      {/* Type info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileType className="h-4 w-4" /> {docType.name}</CardTitle>
          <CardDescription>The code cannot be changed after creation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <Label className="text-xs">Code</Label>
              <Input value={docType.code} disabled className="mt-1 font-mono text-sm" />
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={nameInput ?? docType.name}
                onChange={e => setNameInput(e.target.value)}
                onBlur={e => {
                  const v = e.target.value.trim();
                  if (v && v !== docType.name) updateDocumentType.mutate({ name: v });
                  setNameInput(null);
                }}
                className="mt-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={docType.isActive} onCheckedChange={v => updateDocumentType.mutate({ isActive: v })} />
              <Label className="text-xs">{docType.isActive ? "Active" : "Inactive"}</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metadata Fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Metadata Fields</CardTitle>
          <CardDescription>Fields specific to {docType.name} documents. Global fields apply automatically and are managed separately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fieldsLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}
          {!fieldsLoading && typeSpecificFields.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">No fields defined for this document type yet</p>
          )}
          <div className="space-y-2">
            {typeSpecificFields.map(field => (
              <div key={field.id} className="flex items-center gap-3 p-3 border rounded-lg">
                <div className="flex-1 grid grid-cols-4 gap-3 text-sm items-center">
                  <div>
                    <span className="text-muted-foreground text-xs block">Name</span>
                    <span className="font-mono">{field.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Label</span>
                    <Input
                      defaultValue={field.label}
                      className="h-8 text-sm"
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== field.label) updateField.mutate({ id: field.id, data: { label: v } }); }}
                    />
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Type</span>
                    <span className="capitalize">{field.fieldType}</span>
                    {needsOptions(field.fieldType) && (
                      <Input
                        defaultValue={(field.options || []).join(", ")}
                        placeholder="option1, option2"
                        className="h-8 text-sm mt-1"
                        onBlur={e => {
                          const opts = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                          updateField.mutate({ id: field.id, data: { options: opts } });
                        }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs">
                      <Checkbox checked={field.required} onCheckedChange={v => updateField.mutate({ id: field.id, data: { required: v === true } })} />
                      Required
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Switch checked={field.isActive} onCheckedChange={v => updateField.mutate({ id: field.id, data: { isActive: v } })} />
                      <Label className="text-xs">{field.isActive ? "Active" : "Disabled"}</Label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Add Field</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Name (key)</Label>
                <Input placeholder="e.g. root_cause" value={newField.name} onChange={e => setNewField(f => ({ ...f, name: e.target.value }))} className="mt-1 font-mono text-sm" />
              </div>
              <div>
                <Label className="text-xs">Label</Label>
                <Input placeholder="e.g. Root Cause" value={newField.label} onChange={e => setNewField(f => ({ ...f, label: e.target.value }))} className="mt-1 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={newField.fieldType} onValueChange={v => setNewField(f => ({ ...f, fieldType: v as MetadataFieldRow["fieldType"] }))}>
                  <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {needsOptions(newField.fieldType) && (
                <div>
                  <Label className="text-xs">Options (comma-separated)</Label>
                  <Input placeholder="option1, option2" value={newField.options} onChange={e => setNewField(f => ({ ...f, options: e.target.value }))} className="mt-1 text-sm" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox checked={newField.required} onCheckedChange={v => setNewField(f => ({ ...f, required: v === true }))} />
                <Label className="text-xs">Required</Label>
              </div>
              <div className="flex items-end">
                <Button
                  size="sm"
                  className="gap-1.5 w-full"
                  disabled={!newField.name.trim() || !newField.label.trim() || createField.isPending}
                  onClick={() => createField.mutate({
                    name: newField.name.trim(),
                    label: newField.label.trim(),
                    fieldType: newField.fieldType,
                    options: needsOptions(newField.fieldType) ? newField.options.split(",").map(s => s.trim()).filter(Boolean) : [],
                    required: newField.required,
                  })}
                >
                  <Plus className="h-4 w-4" /> Add Field
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Workflow Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Linked Workflow Templates</CardTitle>
          <CardDescription>Workflow templates configured for {docType.name} documents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {templatesLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}
          {!templatesLoading && linkedTemplates.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">No workflow templates linked to this document type</p>
          )}
          {linkedTemplates.map(tpl => (
            <div key={tpl.id} className="flex items-center gap-3 p-3 border rounded-lg">
              <div className="flex-1">
                <p className="text-sm font-medium">{tpl.name}</p>
                {tpl.description && <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">{tpl.stages?.length ?? 0} stage{(tpl.stages?.length ?? 0) === 1 ? "" : "s"} · {tpl.isActive ? "Active" : "Inactive"}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { setEditorTemplate(tpl); setEditorOpen(true); }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <TemplateEditorDialog
        template={editorTemplate}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          qc.invalidateQueries({ queryKey: ["workflow-templates"] });
        }}
      />
    </div>
  );
}

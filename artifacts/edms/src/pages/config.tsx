import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  SlidersHorizontal, Plus, X, Save, RefreshCw, FileText, GitBranch, Hash, Clock,
} from "lucide-react";

export default function Config() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin" || user?.role === "system_owner";

  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const r = await fetch("/api/config");
      return r.json();
    },
  });

  const [form, setForm] = useState<any>(null);
  const [newDiscipline, setNewDiscipline] = useState("");
  const [newDocType, setNewDocType] = useState("");
  const [newTemplate, setNewTemplate] = useState({ name: "", steps: "", type: "sequential" });

  // Initialize form when config loads
  if (config && !form) setForm({ ...config });

  const save = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      toast({ title: "Configuration saved successfully" });
    },
    onError: () => toast({ title: "Failed to save configuration", variant: "destructive" }),
  });

  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const addDiscipline = () => {
    if (!newDiscipline.trim()) return;
    setForm((f: any) => ({ ...f, disciplines: [...(f.disciplines || []), newDiscipline.trim()] }));
    setNewDiscipline("");
  };

  const removeDiscipline = (d: string) => {
    setForm((f: any) => ({ ...f, disciplines: f.disciplines.filter((x: string) => x !== d) }));
  };

  const addDocType = () => {
    if (!newDocType.trim()) return;
    setForm((f: any) => ({ ...f, documentTypes: [...(f.documentTypes || []), newDocType.trim()] }));
    setNewDocType("");
  };

  const removeDocType = (d: string) => {
    setForm((f: any) => ({ ...f, documentTypes: f.documentTypes.filter((x: string) => x !== d) }));
  };

  const addTemplate = () => {
    if (!newTemplate.name.trim()) return;
    const steps = newTemplate.steps.split(",").map((s: string) => s.trim()).filter(Boolean);
    const tmpl = { id: newTemplate.name.toLowerCase().replace(/\s+/g, "_"), name: newTemplate.name, steps, type: newTemplate.type };
    setForm((f: any) => ({ ...f, workflowTemplates: [...(f.workflowTemplates || []), tmpl] }));
    setNewTemplate({ name: "", steps: "", type: "sequential" });
  };

  const removeTemplate = (id: string) => {
    setForm((f: any) => ({ ...f, workflowTemplates: f.workflowTemplates.filter((t: any) => t.id !== id) }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6" />
            System Configuration
          </h1>
          <p className="text-muted-foreground mt-1">Configure numbering, disciplines, document types, and workflow templates</p>
        </div>
        {isAdmin && (
          <Button onClick={() => save.mutate(form)} disabled={save.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>

      {!isAdmin && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-200">
          You have read-only access to the configuration. Contact an administrator to make changes.
        </div>
      )}

      <Tabs defaultValue="numbering">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="numbering">Numbering</TabsTrigger>
          <TabsTrigger value="disciplines">Disciplines</TabsTrigger>
          <TabsTrigger value="doctypes">Doc Types</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
        </TabsList>

        {/* Numbering & Prefixes */}
        <TabsContent value="numbering" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Document Numbering Format
                </CardTitle>
                <CardDescription>
                  Use tokens: {"{PROJECT}"}, {"{DISCIPLINE}"}, {"{TYPE}"}, {"{SEQ}"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Format Template</Label>
                  <Input
                    value={form.documentNumberingFormat}
                    onChange={e => setForm((f: any) => ({ ...f, documentNumberingFormat: e.target.value }))}
                    disabled={!isAdmin}
                    className="mt-1 font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Preview: <span className="font-mono text-primary">PRJ001-CIV-DWG-0001</span>
                  </p>
                </div>
                <div>
                  <Label>Revision Format</Label>
                  <Select
                    value={form.revisionFormat}
                    onValueChange={v => setForm((f: any) => ({ ...f, revisionFormat: v }))}
                    disabled={!isAdmin}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="numeric">Numeric (0, 1, 2...)</SelectItem>
                      <SelectItem value="alpha">Alphabetic (A, B, C...)</SelectItem>
                      <SelectItem value="revision">Rev 0, Rev 1...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Reference Prefixes
                </CardTitle>
                <CardDescription>Auto-generated reference number prefixes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: "transmittalPrefix", label: "Transmittal" },
                  { key: "rfiPrefix", label: "RFI" },
                  { key: "submittalPrefix", label: "Submittal" },
                  { key: "ncrPrefix", label: "NCR" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="w-28 shrink-0">{label}</Label>
                    <Input
                      value={form[key] || ""}
                      onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value.toUpperCase() }))}
                      disabled={!isAdmin}
                      className="font-mono uppercase"
                      maxLength={5}
                    />
                    <span className="text-muted-foreground text-sm font-mono">-0001</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  SLA Defaults (days)
                </CardTitle>
                <CardDescription>Default response time requirements</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: "rfi", label: "RFI Response" },
                  { key: "submittal", label: "Submittal Review" },
                  { key: "transmittal", label: "Transmittal Ack." },
                  { key: "ncr", label: "NCR Resolution" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="w-36 shrink-0">{label}</Label>
                    <Input
                      type="number"
                      value={form.slaDefaults?.[key] || ""}
                      onChange={e => setForm((f: any) => ({
                        ...f,
                        slaDefaults: { ...(f.slaDefaults || {}), [key]: parseInt(e.target.value) }
                      }))}
                      disabled={!isAdmin}
                      className="w-20"
                      min={1}
                    />
                    <span className="text-muted-foreground text-sm">days</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Disciplines */}
        <TabsContent value="disciplines" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Engineering Disciplines</CardTitle>
              <CardDescription>Configure the disciplines available for document classification</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(form.disciplines || []).map((d: string) => (
                  <Badge key={d} variant="secondary" className="gap-1 pr-1">
                    {d}
                    {isAdmin && (
                      <button onClick={() => removeDiscipline(d)} className="ml-1 rounded hover:bg-destructive/20">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {isAdmin && (
                <>
                  <Separator />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add discipline..."
                      value={newDiscipline}
                      onChange={e => setNewDiscipline(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addDiscipline()}
                    />
                    <Button onClick={addDiscipline} className="gap-1" size="sm">
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Document Types */}
        <TabsContent value="doctypes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Document Types</CardTitle>
              <CardDescription>Configure available document types for classification</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(form.documentTypes || []).map((d: string) => (
                  <Badge key={d} variant="secondary" className="gap-1 pr-1">
                    {d}
                    {isAdmin && (
                      <button onClick={() => removeDocType(d)} className="ml-1 rounded hover:bg-destructive/20">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {isAdmin && (
                <>
                  <Separator />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add document type..."
                      value={newDocType}
                      onChange={e => setNewDocType(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addDocType()}
                    />
                    <Button onClick={addDocType} className="gap-1" size="sm">
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Workflow Templates */}
        <TabsContent value="workflows" className="mt-4 space-y-4">
          <div className="grid gap-4">
            {(form.workflowTemplates || []).map((t: any) => (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between pt-4">
                  <div className="flex items-center gap-4">
                    <GitBranch className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {t.steps?.map((step: string, i: number) => (
                          <span key={i} className="flex items-center gap-1">
                            <Badge variant="outline" className="text-xs">{step}</Badge>
                            {i < t.steps.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">{t.type} workflow</p>
                    </div>
                  </div>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={() => removeTemplate(t.id)} className="text-destructive">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add Workflow Template</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>Template Name</Label>
                    <Input
                      placeholder="e.g. Fast Track"
                      value={newTemplate.name}
                      onChange={e => setNewTemplate(t => ({ ...t, name: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Steps (comma-separated)</Label>
                    <Input
                      placeholder="Review, Check, Approve"
                      value={newTemplate.steps}
                      onChange={e => setNewTemplate(t => ({ ...t, steps: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <Select value={newTemplate.type} onValueChange={v => setNewTemplate(t => ({ ...t, type: v }))}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sequential">Sequential</SelectItem>
                        <SelectItem value="parallel">Parallel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={addTemplate} className="gap-2">
                  <Plus className="h-4 w-4" /> Add Template
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

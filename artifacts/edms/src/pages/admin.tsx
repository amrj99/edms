import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  ShieldCheck, Building2, Users, Database, Settings, Brain,
  Mail, HardDrive, Plus, X, Save, RefreshCw, Key, Globe, Server,
  FileType, Hash, GitBranch, Clock, Layers,
} from "lucide-react";

const ROLES = ["system_owner", "admin", "project_manager", "document_controller", "reviewer", "viewer"];
const ROLE_DESCRIPTIONS: Record<string, string> = {
  system_owner: "Full system access including global settings and configuration",
  admin: "Manage organization data, users, and most settings",
  project_manager: "Manage projects, documents, and team members",
  document_controller: "Upload, revise, and control document workflow",
  reviewer: "Review and comment on documents",
  viewer: "Read-only access to assigned documents",
};

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOwner = user?.role === "system_owner" || user?.role === "admin";

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["config"],
    queryFn: async () => { const r = await fetch("/api/config"); return r.json(); },
  });

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => { const r = await fetch("/api/users"); return r.json(); },
  });

  const { data: orgsData } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => { const r = await fetch("/api/organizations"); return r.json(); },
  });

  const [form, setForm] = useState<any>(null);
  const [newCorrType, setNewCorrType] = useState({ name: "", prefix: "", slaDays: 7, color: "#3B82F6" });
  const [newMetaField, setNewMetaField] = useState({ name: "", label: "", type: "text", required: false, scope: "global" });

  if (config && !form) setForm({ ...config });

  const save = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["config"] }); toast({ title: "System configuration saved" }); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const updateUserRole = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const r = await fetch(`/api/users/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); toast({ title: "User role updated" }); },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const addCorrType = () => {
    if (!newCorrType.name.trim()) return;
    const entry = { ...newCorrType, id: newCorrType.name.toLowerCase().replace(/\s+/g, "_") };
    setForm((f: any) => ({ ...f, correspondenceTypes: [...(f.correspondenceTypes || []), entry] }));
    setNewCorrType({ name: "", prefix: "", slaDays: 7, color: "#3B82F6" });
  };

  const removeCorrType = (id: string) => {
    setForm((f: any) => ({ ...f, correspondenceTypes: (f.correspondenceTypes || []).filter((t: any) => t.id !== id) }));
  };

  const addMetaField = () => {
    if (!newMetaField.name.trim()) return;
    setForm((f: any) => ({ ...f, metadataFields: [...(f.metadataFields || []), { ...newMetaField, id: Date.now() }] }));
    setNewMetaField({ name: "", label: "", type: "text", required: false, scope: "global" });
  };

  const removeMetaField = (id: any) => {
    setForm((f: any) => ({ ...f, metadataFields: (f.metadataFields || []).filter((m: any) => m.id !== id) }));
  };

  const users = usersData?.users ?? [];
  const orgs = orgsData?.organizations ?? [];

  if (configLoading || !form) {
    return <div className="flex items-center justify-center py-20"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center p-8 border rounded-xl">
        <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold mb-2">Access Restricted</h2>
        <p className="text-muted-foreground">System Administration requires Administrator or System Owner access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in pb-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            System Administration
          </h1>
          <p className="text-muted-foreground mt-1">Manage all system-wide settings, roles, metadata, and integrations</p>
        </div>
        <Button onClick={() => save.mutate(form)} disabled={save.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving..." : "Save All Changes"}
        </Button>
      </div>

      <Tabs defaultValue="organization">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-muted p-1 rounded-lg w-full">
          {[
            { value: "organization", label: "Organization", icon: Building2 },
            { value: "users", label: "User Roles", icon: Users },
            { value: "metadata", label: "Metadata", icon: Layers },
            { value: "corrtypes", label: "Corr. Types", icon: FileType },
            { value: "numbering", label: "Numbering", icon: Hash },
            { value: "workflows", label: "Workflows", icon: GitBranch },
            { value: "ai", label: "AI Config", icon: Brain },
            { value: "email", label: "Email", icon: Mail },
            { value: "storage", label: "Storage", icon: HardDrive },
            { value: "security", label: "Security", icon: Key },
          ].map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5 text-xs px-3">
              <Icon className="h-3.5 w-3.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Organization Settings */}
        <TabsContent value="organization" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Organization Details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {orgs.slice(0, 3).map((org: any) => (
                  <div key={org.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.code} · {org.type || "Organization"}</p>
                      </div>
                      <Badge variant="outline" className="capitalize">{org.industry || "Engineering"}</Badge>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1 w-full" onClick={() => window.location.href = "/organizations"}>
                  <Building2 className="h-3.5 w-3.5" /> Manage Organizations
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />System Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>System Name</Label>
                  <Input className="mt-1" defaultValue="ArcScale EDMS" />
                </div>
                <div>
                  <Label>Default Timezone</Label>
                  <Select defaultValue="utc">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utc">UTC</SelectItem>
                      <SelectItem value="gmt">GMT+0</SelectItem>
                      <SelectItem value="est">EST (GMT-5)</SelectItem>
                      <SelectItem value="pst">PST (GMT-8)</SelectItem>
                      <SelectItem value="gst">GST (GMT+4)</SelectItem>
                      <SelectItem value="ist">IST (GMT+5:30)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date Format</Label>
                  <Select defaultValue="dd-mmm-yyyy">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd-mmm-yyyy">DD-MMM-YYYY</SelectItem>
                      <SelectItem value="dd/mm/yyyy">DD/MM/YYYY</SelectItem>
                      <SelectItem value="mm/dd/yyyy">MM/DD/YYYY</SelectItem>
                      <SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Allow Self Registration</Label>
                  <Switch defaultChecked={false} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Multi-Organization Mode</Label>
                  <Switch defaultChecked={true} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* User Roles Management */}
        <TabsContent value="users" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Role Definitions</CardTitle>
                <CardDescription>Understanding access levels in the system</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {ROLES.map(role => (
                  <div key={role} className="flex items-start gap-3 p-2 rounded border">
                    <Badge variant={role === "system_owner" ? "default" : "outline"} className="capitalize mt-0.5 shrink-0">{role.replace(/_/g, " ")}</Badge>
                    <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">User Role Management</CardTitle>
                <CardDescription>Change roles for existing users</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                {users.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <Select
                      value={u.role}
                      onValueChange={(role) => updateUserRole.mutate({ id: u.id, role })}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map(r => (
                          <SelectItem key={r} value={r} className="text-xs capitalize">{r.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Metadata Management */}
        <TabsContent value="metadata" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" />Custom Metadata Fields</CardTitle>
              <CardDescription>Define custom fields applied to documents globally or per project</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(form.metadataFields || []).length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">No custom metadata fields defined yet</p>
              )}
              <div className="space-y-2">
                {(form.metadataFields || []).map((field: any) => (
                  <div key={field.id} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="flex-1 grid grid-cols-4 gap-3 text-sm">
                      <div><span className="text-muted-foreground text-xs block">Field Name</span><span className="font-mono">{field.name}</span></div>
                      <div><span className="text-muted-foreground text-xs block">Label</span>{field.label || field.name}</div>
                      <div><span className="text-muted-foreground text-xs block">Type</span><Badge variant="outline" className="text-xs capitalize">{field.type}</Badge></div>
                      <div className="flex gap-2">
                        {field.required && <Badge className="text-xs">Required</Badge>}
                        <Badge variant="secondary" className="text-xs capitalize">{field.scope}</Badge>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeMetaField(field.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="space-y-3">
                <p className="text-sm font-medium">Add New Field</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Field Name (key)</Label>
                    <Input placeholder="e.g. contract_number" value={newMetaField.name} onChange={e => setNewMetaField(f => ({ ...f, name: e.target.value }))} className="mt-1 font-mono text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Display Label</Label>
                    <Input placeholder="e.g. Contract Number" value={newMetaField.label} onChange={e => setNewMetaField(f => ({ ...f, label: e.target.value }))} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Field Type</Label>
                    <Select value={newMetaField.type} onValueChange={v => setNewMetaField(f => ({ ...f, type: v }))}>
                      <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="dropdown">Dropdown</SelectItem>
                        <SelectItem value="boolean">Yes/No</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Scope</Label>
                    <Select value={newMetaField.scope} onValueChange={v => setNewMetaField(f => ({ ...f, scope: v }))}>
                      <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">Global (all projects)</SelectItem>
                        <SelectItem value="project">Per Project</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 mt-5">
                    <Switch checked={newMetaField.required} onCheckedChange={v => setNewMetaField(f => ({ ...f, required: v }))} />
                    <Label className="text-xs">Required</Label>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addMetaField} className="gap-1 w-full mt-1" size="sm">
                      <Plus className="h-4 w-4" /> Add Field
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Correspondence Types */}
        <TabsContent value="corrtypes" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><FileType className="h-4 w-4" />Correspondence Types</CardTitle>
              <CardDescription>Define custom correspondence types with prefixes, SLA days, and workflows</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Built-in types */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">System Types (built-in)</p>
                <div className="flex flex-wrap gap-2">
                  {["RFI", "Submittal", "NCR", "Technical Query", "Transmittal", "Letter", "Memo", "Email", "Notice"].map(t => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                </div>
              </div>
              <Separator />
              {/* Custom types */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Custom Types</p>
                {(form.correspondenceTypes || []).length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">No custom types defined</p>
                )}
                <div className="space-y-2">
                  {(form.correspondenceTypes || []).map((t: any) => (
                    <div key={t.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ background: t.color }} />
                      <div className="flex-1 grid grid-cols-4 gap-2 text-sm">
                        <span className="font-medium">{t.name}</span>
                        <span className="font-mono text-muted-foreground">{t.prefix}-0001</span>
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{t.slaDays}d SLA</span>
                        <span></span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeCorrType(t.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Add Custom Type</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Type Name</Label>
                    <Input placeholder="e.g. Shop Drawing" value={newCorrType.name} onChange={e => setNewCorrType(f => ({ ...f, name: e.target.value }))} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Prefix</Label>
                    <Input placeholder="SD" value={newCorrType.prefix} onChange={e => setNewCorrType(f => ({ ...f, prefix: e.target.value.toUpperCase() }))} className="mt-1 font-mono text-sm uppercase" maxLength={6} />
                  </div>
                  <div>
                    <Label className="text-xs">SLA (days)</Label>
                    <Input type="number" min={1} value={newCorrType.slaDays} onChange={e => setNewCorrType(f => ({ ...f, slaDays: parseInt(e.target.value) || 7 }))} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Color</Label>
                    <div className="flex gap-2 mt-1">
                      <input type="color" value={newCorrType.color} onChange={e => setNewCorrType(f => ({ ...f, color: e.target.value }))} className="h-9 w-12 rounded border cursor-pointer" />
                      <Button onClick={addCorrType} className="gap-1 flex-1" size="sm">
                        <Plus className="h-4 w-4" /> Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numbering */}
        <TabsContent value="numbering" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Hash className="h-4 w-4" />Document Numbering</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Format Template</Label>
                  <Input value={form.documentNumberingFormat || ""} onChange={e => setForm((f: any) => ({ ...f, documentNumberingFormat: e.target.value }))} className="mt-1 font-mono" />
                  <p className="text-xs text-muted-foreground mt-1">Tokens: {"{PROJECT}"} {"{DISCIPLINE}"} {"{TYPE}"} {"{SEQ}"}</p>
                </div>
                <div>
                  <Label>Revision Format</Label>
                  <Select value={form.revisionFormat || "numeric"} onValueChange={v => setForm((f: any) => ({ ...f, revisionFormat: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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
              <CardHeader><CardTitle className="text-base">Reference Prefixes</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: "transmittalPrefix", label: "Transmittal" },
                  { key: "rfiPrefix", label: "RFI" },
                  { key: "submittalPrefix", label: "Submittal" },
                  { key: "ncrPrefix", label: "NCR" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="w-28 shrink-0">{label}</Label>
                    <Input value={form[key] || ""} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value.toUpperCase() }))} className="font-mono uppercase" maxLength={5} />
                    <span className="text-muted-foreground text-sm font-mono">-0001</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />SLA Defaults</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: "rfi", label: "RFI Response" },
                  { key: "submittal", label: "Submittal Review" },
                  { key: "transmittal", label: "Transmittal Ack." },
                  { key: "ncr", label: "NCR Resolution" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="w-36 shrink-0">{label}</Label>
                    <Input type="number" value={form.slaDefaults?.[key] || ""} onChange={e => setForm((f: any) => ({ ...f, slaDefaults: { ...(f.slaDefaults || {}), [key]: parseInt(e.target.value) } }))} className="w-20" min={1} />
                    <span className="text-muted-foreground text-sm">days</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Workflows */}
        <TabsContent value="workflows" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4" />Workflow Templates</CardTitle>
              <CardDescription>Reusable document approval workflows available to all projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(form.workflowTemplates || []).map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{t.name}</p>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {t.steps?.map((step: string, i: number) => (
                        <span key={i} className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">{step}</Badge>
                          {i < t.steps.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setForm((f: any) => ({ ...f, workflowTemplates: f.workflowTemplates.filter((x: any) => x.id !== t.id) }))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="gap-1 w-full" onClick={() => window.location.href = "/config"}>
                <Settings className="h-4 w-4" /> Manage in Configuration Panel
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Config */}
        <TabsContent value="ai" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Brain className="h-4 w-4" />AI Module Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { key: "documentAnalysis", label: "Document Analysis", desc: "Auto-classify and summarize uploaded documents" },
                  { key: "correspondenceAnalysis", label: "Correspondence Analysis", desc: "Categorize and score incoming correspondence" },
                  { key: "taskPrioritization", label: "Task Prioritization", desc: "AI-driven priority scores and bottleneck detection" },
                  { key: "naturalLanguageSearch", label: "Natural Language Search", desc: "Parse plain English queries into EDMS filters" },
                  { key: "documentProcedure", label: "Document Numbering", desc: "AI-assisted document classification during upload" },
                ].map(({ key, label, desc }) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch defaultChecked={true} />
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1 w-full" onClick={() => window.location.href = "/ai-settings"}>
                  <Brain className="h-4 w-4" /> Advanced AI Settings
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">AI Model Configuration</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Fast Model (document/corr. analysis)</Label>
                  <Select defaultValue="gpt-5-mini">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5-mini">gpt-5-mini (fast)</SelectItem>
                      <SelectItem value="gpt-5">gpt-5 (balanced)</SelectItem>
                      <SelectItem value="gpt-5.2">gpt-5.2 (smart)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Smart Model (reasoning tasks)</Label>
                  <Select defaultValue="gpt-5.2">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5">gpt-5 (balanced)</SelectItem>
                      <SelectItem value="gpt-5.2">gpt-5.2 (smart)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cache Duration (minutes)</Label>
                  <Input type="number" defaultValue={60} min={0} className="mt-1" />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Email */}
        <TabsContent value="email" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" />Email Configuration</CardTitle>
              <CardDescription>Configure SMTP settings for outbound notifications and transmittals</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Enable Email Notifications</Label>
                <Switch defaultChecked={false} />
              </div>
              <Separator />
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>SMTP Host</Label>
                  <Input placeholder="smtp.company.com" className="mt-1" />
                </div>
                <div>
                  <Label>SMTP Port</Label>
                  <Input type="number" defaultValue={587} className="mt-1" />
                </div>
                <div>
                  <Label>Username</Label>
                  <Input placeholder="noreply@company.com" className="mt-1" />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input type="password" placeholder="••••••••" className="mt-1" />
                </div>
                <div>
                  <Label>From Name</Label>
                  <Input defaultValue="ArcScale EDMS" className="mt-1" />
                </div>
                <div>
                  <Label>From Email</Label>
                  <Input placeholder="edms@company.com" className="mt-1" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Use TLS/SSL</Label>
                <Switch defaultChecked={true} />
              </div>
              <Button variant="outline" size="sm" className="gap-1"><Mail className="h-4 w-4" /> Send Test Email</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Storage */}
        <TabsContent value="storage" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><HardDrive className="h-4 w-4" />Document Storage</CardTitle>
              <CardDescription>Configure storage backend for document files</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Storage Provider</Label>
                <Select defaultValue="local">
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local Filesystem</SelectItem>
                    <SelectItem value="s3">Amazon S3</SelectItem>
                    <SelectItem value="azure">Azure Blob Storage</SelectItem>
                    <SelectItem value="gcs">Google Cloud Storage</SelectItem>
                    <SelectItem value="replit">Replit Object Storage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Max File Size (MB)</Label>
                <Input type="number" defaultValue={50} className="mt-1" />
              </div>
              <div>
                <Label>Allowed File Types</Label>
                <Input defaultValue="pdf,docx,dwg,xlsx,png,jpg,zip" className="mt-1 font-mono text-sm" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Enable Version Control</Label>
                <Switch defaultChecked={true} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Auto-backup Enabled</Label>
                <Switch defaultChecked={false} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Key className="h-4 w-4" />Security Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Session Timeout (minutes)</Label>
                <Input type="number" defaultValue={60} className="mt-1" />
              </div>
              <div>
                <Label>Password Minimum Length</Label>
                <Input type="number" defaultValue={8} className="mt-1" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Require Strong Passwords</Label>
                <Switch defaultChecked={true} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Enable 2FA</Label>
                <Switch defaultChecked={false} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Audit All Actions</Label>
                <Switch defaultChecked={true} />
              </div>
              <div>
                <Label>Allowed IP Ranges (CIDR, one per line)</Label>
                <textarea className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-mono min-h-[80px]" placeholder="0.0.0.0/0 (allow all)" />
              </div>
              <div>
                <Label>JWT Expiry</Label>
                <Select defaultValue="24h">
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1h">1 hour</SelectItem>
                    <SelectItem value="8h">8 hours</SelectItem>
                    <SelectItem value="24h">24 hours</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

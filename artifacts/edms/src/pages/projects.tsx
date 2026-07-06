import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { FolderKanban, Plus, Users, FileText, Calendar, Loader2, Building2, Filter, AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

// ─── Validation schema (limits match DB schema) ───────────────────────────────
// DB: name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, description TEXT (nullable)
// DB enum: project_status — active | on_hold | completed | cancelled
const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

const projectSchema = z.object({
  name: z
    .string()
    .min(1, "Project name is required")
    .min(2, "Name must be at least 2 characters")
    .transform(v => v.trim()),
  code: z
    .string()
    .min(1, "Project code is required")
    .regex(CODE_PATTERN, "Code may only contain letters, numbers, hyphens, and underscores")
    .transform(v => v.trim()),
  description: z
    .string()
    .optional()
    .transform(v => v?.trim() || undefined),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]),
  organizationId: z.coerce.number().min(1, "Organization is required"),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

export default function Projects() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useListProjects();
  const createMutation = useCreateProject();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [orgFilter, setOrgFilter] = useState<string>("_all");
  const [formError, setFormError] = useState<string | null>(null);

  const isSysAdmin = user?.role === "system_owner" || user?.role === "admin";
  const canCreateProject = isSysAdmin || user?.role === "project_manager";

  const { data: orgsData } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const r = await fetch("/api/organizations");
      if (!r.ok) throw new Error("Failed to fetch orgs");
      return r.json();
    },
    enabled: !!user,
  });
  const organizations: any[] = orgsData?.organizations ?? [];

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      code: "",
      description: "",
      status: "active",
      organizationId: user?.organizationId ?? 1,
    },
  });

  const refreshProjects = () => {
    // Invalidate both the Orval-generated query and the AppLayout sidebar query
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const onSubmit = async (values: ProjectFormValues) => {
    setFormError(null);
    try {
      await createMutation.mutateAsync({ data: values as any });
      toast({ title: "Project created successfully" });
      setIsCreateOpen(false);
      form.reset({ name: "", code: "", description: "", status: "active", organizationId: user?.organizationId ?? 1 });
      refreshProjects();
    } catch (error: any) {
      // Extract structured field errors from the API response
      const apiData = error?.data ?? {};
      const fieldErrors: Record<string, string> = apiData.fields ?? {};

      if (Object.keys(fieldErrors).length > 0) {
        // Set errors on individual fields so they appear inline
        for (const [field, msg] of Object.entries(fieldErrors)) {
          form.setError(field as keyof ProjectFormValues, { message: String(msg) });
        }
        setFormError(apiData.message ?? "Please fix the errors below and try again.");
      } else {
        // Generic error — show in form banner and toast
        const msg = apiData.message ?? error?.message ?? "Failed to create project";
        setFormError(msg);
        toast({ variant: "destructive", title: "Failed to create project", description: msg });
      }
    }
  };

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      setFormError(null);
      form.reset({ name: "", code: "", description: "", status: "active", organizationId: user?.organizationId ?? 1 });
    }
    setIsCreateOpen(open);
  };

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
    on_hold: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
    completed: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/20",
    cancelled: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400 border-slate-200 dark:border-slate-500/20",
  };

  const filteredProjects = useMemo(() => {
    const projects = data?.projects ?? [];
    if (orgFilter === "_all") return projects;
    return projects.filter((p: any) => String(p.organizationId) === orgFilter);
  }, [data?.projects, orgFilter]);

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">Manage all engineering projects in your workspace.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={refreshProjects}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {isSysAdmin && organizations.length > 1 && (
            <Select value={orgFilter} onValueChange={setOrgFilter}>
              <SelectTrigger className="h-9 w-[200px] text-sm">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Filter by organization" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Organizations</SelectItem>
                {organizations.map((org: any) => (
                  <SelectItem key={org.id} value={String(org.id)}>{org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {canCreateProject && (
            <Dialog open={isCreateOpen} onOpenChange={handleDialogChange}>
              <DialogTrigger asChild>
                <Button className="shadow-sm">
                  <Plus className="mr-2 h-4 w-4" /> New Project
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                  <DialogTitle>Create Project</DialogTitle>
                </DialogHeader>

                {formError && (
                  <Alert variant="destructive" className="py-2.5">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{formError}</AlertDescription>
                  </Alert>
                )}

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">

                      {/* Project Name */}
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Project Name <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input placeholder="E.g. Terminal 5 Expansion" {...field} />
                            </FormControl>
                            <FormDescription>A descriptive name for the project.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Project Code */}
                      <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Project Code <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input
                                placeholder="T5-EXP"
                                className="font-mono uppercase"
                                {...field}
                                onChange={e => field.onChange(e.target.value.toUpperCase())}
                              />
                            </FormControl>
                            <FormDescription>
                              Unique code — letters, numbers, <code className="text-xs bg-muted px-1 rounded">-</code> or <code className="text-xs bg-muted px-1 rounded">_</code> only.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Status */}
                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="on_hold">On Hold</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormDescription>Current project status.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Organization (admins only) */}
                      {isSysAdmin && organizations.length > 0 && (
                        <FormField
                          control={form.control}
                          name="organizationId"
                          render={({ field }) => (
                            <FormItem className="col-span-2">
                              <FormLabel>Organization <span className="text-destructive">*</span></FormLabel>
                              <Select
                                onValueChange={(v) => field.onChange(parseInt(v))}
                                value={String(field.value)}
                              >
                                <FormControl>
                                  <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {organizations.map((org: any) => (
                                    <SelectItem key={org.id} value={String(org.id)}>{org.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormDescription>The organization this project belongs to.</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {/* Description */}
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>
                              Description <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Brief description of the project scope and objectives"
                                rows={2}
                                className="resize-none text-sm"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>Nullable — leave blank if not applicable.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <DialogFooter className="pt-2">
                      <Button type="button" variant="outline" onClick={() => handleDialogChange(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createMutation.isPending || !form.formState.isValid}
                      >
                        {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Project
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !data || filteredProjects.length === 0 ? (
        <div className="text-center py-24 bg-card border rounded-xl border-dashed">
          <FolderKanban className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">No projects found</h3>
          <p className="mt-1 text-muted-foreground">
            {orgFilter !== "_all" ? "No projects match the selected organization filter." : "Get started by creating a new project."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project: any) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full hover:shadow-md hover:border-primary/40 transition-all cursor-pointer group flex flex-col">
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-bold tracking-wider mb-2 inline-block">
                      {project.code}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className={`${statusColors[project.status]} uppercase text-[10px]`}>
                        {project.status.replace('_', ' ')}
                      </Badge>
                      {project.accessMode === "party" && (
                        <Badge variant="outline" className="uppercase text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                          Partner — {project.partyRole}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold font-display group-hover:text-primary transition-colors">{project.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 min-h-[40px]">
                    {project.description || "No description provided."}
                  </p>
                </CardHeader>
                <CardContent className="mt-auto">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium text-foreground truncate">{project.organizationName || "Unknown Org"}</span>
                  </div>
                </CardContent>
                <CardFooter className="border-t bg-muted/20 px-6 py-4 flex justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {project.memberCount} member{project.memberCount !== 1 ? "s" : ""}
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {project.documentCount} doc{project.documentCount !== 1 ? "s" : ""}
                  </span>
                  {project.startDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(project.startDate), "MMM yyyy")}
                    </span>
                  )}
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

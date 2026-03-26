import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useCreateProject } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { FolderKanban, Plus, Users, FileText, Calendar, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const projectSchema = z.object({
  name: z.string().min(2, "Name is required"),
  code: z.string().min(2, "Code is required").max(10),
  description: z.string().optional(),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]),
  organizationId: z.coerce.number().min(1, "Organization is required"),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

export default function Projects() {
  const { data, isLoading, refetch } = useListProjects();
  const createMutation = useCreateProject();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      status: "active",
      organizationId: 1, // Hardcoded for mockup purposes unless we fetch orgs
    },
  });

  const onSubmit = async (values: ProjectFormValues) => {
    try {
      await createMutation.mutateAsync({ data: values });
      toast({ title: "Project created" });
      setIsCreateOpen(false);
      form.reset();
      refetch();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Failed", description: error.message });
    }
  };

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
    on_hold: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
    completed: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/20",
    cancelled: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400 border-slate-200 dark:border-slate-500/20",
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">Manage all engineering projects in your workspace.</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-sm">
              <Plus className="mr-2 h-4 w-4" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Project</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Project Name</FormLabel>
                        <FormControl><Input placeholder="E.g. Terminal 5 Expansion" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Code</FormLabel>
                        <FormControl><Input placeholder="T5-EXP" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="organizationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization ID</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Project
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !data || data.projects.length === 0 ? (
        <div className="text-center py-24 bg-card border rounded-xl border-dashed">
          <FolderKanban className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">No projects found</h3>
          <p className="mt-1 text-muted-foreground">Get started by creating a new project.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full hover:shadow-md hover:border-primary/40 transition-all cursor-pointer group flex flex-col">
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-bold tracking-wider mb-2 inline-block">
                      {project.code}
                    </div>
                    <Badge variant="outline" className={`${statusColors[project.status]} uppercase text-[10px]`}>
                      {project.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <h3 className="text-xl font-bold font-display group-hover:text-primary transition-colors">{project.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 min-h-[40px]">
                    {project.description || "No description provided."}
                  </p>
                </CardHeader>
                <CardContent className="mt-auto">
                  <div className="flex items-center text-sm text-muted-foreground mb-4">
                    <span className="font-medium text-foreground">{project.organizationName || "Unknown Org"}</span>
                  </div>
                </CardContent>
                <CardFooter className="border-t bg-muted/20 px-6 py-4 flex justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5" title="Team Members">
                    <Users className="h-4 w-4" />
                    <span>{project.memberCount || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Documents">
                    <FileText className="h-4 w-4" />
                    <span>{project.documentCount || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Started On">
                    <Calendar className="h-4 w-4" />
                    <span>{format(new Date(project.createdAt), 'MMM yyyy')}</span>
                  </div>
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

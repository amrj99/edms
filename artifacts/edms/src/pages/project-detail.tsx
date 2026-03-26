import { useParams, Link, useLocation } from "wouter";
import { useGetProject, useListDocuments, useCreateDocument } from "@workspace/api-client-react";
import { FileText, Mail, CheckSquare, GitBranch, Users, ArrowLeft, Loader2, Plus, Download, Upload, Eye, Sparkles } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { AIInsightsPanel } from "@/components/ai/AIInsightsPanel";
import { AIProcedurePanel } from "@/components/ai/AIProcedurePanel";

export default function ProjectDetail() {
  const params = useParams();
  const projectId = parseInt(params.id || "0");
  const { data: project, isLoading: projLoading } = useGetProject(projectId);
  const [activeTab, setActiveTab] = useState("documents");

  if (projLoading) return <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!project) return <div>Project not found</div>;

  return (
    <div className="space-y-6 animate-in fade-in pb-12">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2 text-muted-foreground">
          <Link href="/projects"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Projects</Link>
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-bold">{project.code}</span>
              <Badge variant="outline" className="uppercase text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                {project.status.replace('_', ' ')}
              </Badge>
            </div>
            <h1 className="text-3xl font-bold font-display tracking-tight">{project.name}</h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">{project.description}</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent p-0">
          <TabsTrigger value="documents" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
            <FileText className="mr-2 h-4 w-4" /> Documents
          </TabsTrigger>
          <TabsTrigger value="correspondence" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
            <Mail className="mr-2 h-4 w-4" /> Correspondence
          </TabsTrigger>
          <TabsTrigger value="tasks" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
            <CheckSquare className="mr-2 h-4 w-4" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="workflows" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
            <GitBranch className="mr-2 h-4 w-4" /> Workflows
          </TabsTrigger>
          <TabsTrigger value="members" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 font-medium">
            <Users className="mr-2 h-4 w-4" /> Members
          </TabsTrigger>
        </TabsList>
        
        <div className="mt-6">
          <TabsContent value="documents">
            <DocumentTab projectId={projectId} projectCode={project.code} projectName={project.name} />
          </TabsContent>
          <TabsContent value="correspondence">
            <div className="bg-card p-12 text-center rounded-xl border border-dashed">
              <Mail className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Correspondence Module</h3>
              <p className="text-muted-foreground">Select the Documents tab to see active components.</p>
            </div>
          </TabsContent>
          {/* Other tabs omitted for brevity, showing empty state patterns */}
          <TabsContent value="tasks">
            <div className="bg-card p-12 text-center rounded-xl border border-dashed">
              <CheckSquare className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Task Management</h3>
            </div>
          </TabsContent>
          <TabsContent value="workflows">
            <div className="bg-card p-12 text-center rounded-xl border border-dashed">
              <GitBranch className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Workflow Engine</h3>
            </div>
          </TabsContent>
          <TabsContent value="members">
            <div className="bg-card p-12 text-center rounded-xl border border-dashed">
              <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Project Team</h3>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

interface DocForAI {
  id: number;
  title: string;
  documentNumber: string;
  documentType: string;
  discipline?: string | null;
  revision?: string | null;
  status: string;
  description?: string | null;
  fileName?: string | null;
}

function DocumentTab({ projectId, projectCode, projectName }: { projectId: number; projectCode?: string; projectName?: string }) {
  const { data, isLoading } = useListDocuments(projectId);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const createDoc = useCreateDocument();
  const [docNumber, setDocNumber] = useState("");
  const [title, setTitle] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [revision, setRevision] = useState("01");
  const [docType, setDocType] = useState("general");
  const [aiDoc, setAiDoc] = useState<DocForAI | null>(null);

  const handleUpload = async () => {
    await createDoc.mutateAsync({
      projectId,
      data: {
        documentNumber: docNumber || `DOC-${Date.now()}`,
        title: title || "New Document",
        revision: revision || "01",
        status: "draft",
        discipline: discipline || undefined,
        documentType: docType || "general",
      }
    });
    setIsUploadOpen(false);
    setDocNumber("");
    setTitle("");
    setDiscipline("");
    setRevision("01");
    setDocType("general");
  };

  const handleAIProcedureApply = (suggestion: Partial<{
    documentNumber: string;
    discipline: string;
    documentType: string;
    revision: string;
    title: string;
  }>) => {
    if (suggestion.documentNumber) setDocNumber(suggestion.documentNumber);
    if (suggestion.discipline) setDiscipline(suggestion.discipline);
    if (suggestion.documentType) setDocType(suggestion.documentType);
    if (suggestion.revision) setRevision(suggestion.revision);
    if (suggestion.title && !title) setTitle(suggestion.title);
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'approved': return <Badge className="bg-emerald-500">Approved</Badge>;
      case 'under_review': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-700">In Review</Badge>;
      case 'draft': return <Badge variant="outline">Draft</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-card p-2 rounded-lg border shadow-sm">
        <div className="flex gap-2">
          <Input placeholder="Search documents..." className="w-[300px] h-9" />
          <Button variant="outline" size="sm" className="h-9">Filters</Button>
        </div>
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-9"><Upload className="mr-2 h-4 w-4" /> Upload Document</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload Document</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* AI Procedure Panel */}
              <AIProcedurePanel
                projectCode={projectCode}
                projectName={projectName}
                discipline={discipline}
                documentType={docType}
                partialTitle={title}
                onApply={handleAIProcedureApply}
              />

              {/* File drop */}
              <div className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center text-center hover:bg-muted/50 transition-colors cursor-pointer">
                <Upload className="h-6 w-6 text-muted-foreground mb-2" />
                <p className="font-medium text-sm">Click to browse or drag file here</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, DWG, XLSX up to 50MB</p>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">Document Number</label>
                  <Input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Auto-generated or from AI suggestion" className="font-mono" />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">Title *</label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="E.g. Ground Floor Plan" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Discipline</label>
                  <Input value={discipline} onChange={e => setDiscipline(e.target.value)} placeholder="E.g. Electrical" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Revision</label>
                  <Input value={revision} onChange={e => setRevision(e.target.value)} placeholder="01" className="font-mono" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
              <Button onClick={handleUpload} disabled={createDoc.isPending}>
                {createDoc.isPending ? "Saving..." : "Save Document"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Document No.</TableHead>
              <TableHead className="w-1/3">Title</TableHead>
              <TableHead>Rev</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
            ) : !data?.documents?.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No documents uploaded yet.</TableCell></TableRow>
            ) : (
              data.documents.map(doc => (
                <TableRow key={doc.id} className="hover:bg-muted/30 group">
                  <TableCell className="font-mono text-xs font-medium">{doc.documentNumber}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary/70" />
                      {doc.title}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{doc.revision}</span>
                  </TableCell>
                  <TableCell>{getStatusBadge(doc.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(doc.updatedAt), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-primary hover:bg-primary/10"
                        title="AI Analyze"
                        onClick={() => setAiDoc({
                          id: doc.id,
                          title: doc.title,
                          documentNumber: doc.documentNumber,
                          documentType: (doc as any).documentType ?? "general",
                          discipline: (doc as any).discipline,
                          revision: doc.revision,
                          status: doc.status,
                          description: (doc as any).description,
                          fileName: (doc as any).fileName,
                        })}
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Download className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* AI Insights Sheet */}
      <Sheet open={!!aiDoc} onOpenChange={(open) => !open && setAiDoc(null)}>
        <SheetContent className="w-[420px] sm:max-w-[420px] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base">Document AI Analysis</SheetTitle>
          </SheetHeader>
          {aiDoc && (
            <AIInsightsPanel
              entityId={aiDoc.id}
              entityType="document"
              entityTitle={`${aiDoc.documentNumber} — ${aiDoc.title}`}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

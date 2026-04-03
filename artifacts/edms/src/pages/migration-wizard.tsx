import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload, FolderOpen, FileText, CheckCircle2, AlertCircle, Loader2,
  ChevronRight, AlertTriangle, Pencil, Check, X, SkipForward,
  Server, HardDrive, ArrowLeft, Sparkles, Info,
  FileX, FileCheck, FolderTree, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

type Step = 1 | 2 | 3 | 4 | 5;

interface StagedFile {
  filePath: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  file?: File;
}

interface MigrationItem {
  id: number;
  jobId: number;
  filePath: string;
  fileName: string;
  fileSize: number | null;
  fileType: string | null;
  extractedTitle: string | null;
  extractedCode: string | null;
  extractedDiscipline: string | null;
  extractedDocType: string | null;
  extractedRevision: string | null;
  extractedDate: string | null;
  extractedIssuer: string | null;
  extractedIsReply: number;
  extractedReplyTo: string | null;
  confidence: number;
  confidenceLabel: string | null;
  title: string | null;
  code: string | null;
  discipline: string | null;
  docType: string | null;
  revision: string | null;
  issuer: string | null;
  status: string;
  skip: number;
  importedDocumentId: number | null;
  errorMessage: string | null;
}

interface MigrationJob {
  id: number;
  organizationId: number;
  projectId: number;
  status: string;
  plan: string;
  maxFiles: number;
  storageMode: string | null;
  baseUrl: string | null;
  importedCount: number | null;
  skippedCount: number | null;
  failedCount: number | null;
  generatedRegisters: string[];
}

function ConfidenceBadge({ label, confidence }: { label: string | null; confidence: number }) {
  if (label === "high") return <Badge className="bg-green-100 text-green-800 border-green-200">High ({confidence}%)</Badge>;
  if (label === "medium") return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Medium ({confidence}%)</Badge>;
  if (label === "unreadable") return <Badge className="bg-gray-100 text-gray-600 border-gray-200">Unreadable</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200">Low ({confidence}%)</Badge>;
}

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: "Upload" },
    { n: 2, label: "Analyze" },
    { n: 3, label: "Review" },
    { n: 4, label: "Storage" },
    { n: 5, label: "Import" },
  ];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map(({ n, label }, i) => (
        <div key={n} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors",
              current === n ? "border-primary bg-primary text-primary-foreground" :
              current > n ? "border-green-500 bg-green-500 text-white" :
              "border-muted-foreground/30 bg-background text-muted-foreground",
            )}>
              {current > n ? <Check className="h-4 w-4" /> : n}
            </div>
            <span className={cn(
              "text-[10px] mt-1 font-medium",
              current === n ? "text-primary" : current > n ? "text-green-600" : "text-muted-foreground",
            )}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={cn("w-16 h-0.5 mx-1 mb-3", current > n ? "bg-green-500" : "bg-muted-foreground/20")} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function MigrationWizard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>(1);
  const [projectId, setProjectId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("projectId") ?? "";
  });
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [storageMode, setStorageMode] = useState<"system" | "reference">("system");
  const [baseUrl, setBaseUrl] = useState("");
  const [editItem, setEditItem] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); return r.json(); },
  });

  const { data: jobData, refetch: refetchJob } = useQuery({
    queryKey: ["migration-job", jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const r = await fetch(`/api/migrations/${jobId}`);
      if (!r.ok) throw new Error("Failed to load job");
      return r.json() as Promise<{ job: MigrationJob; items: MigrationItem[] }>;
    },
    enabled: !!jobId,
    staleTime: 0,
    // TanStack Query v5: refetchInterval receives a Query object, not raw data
    refetchInterval: (query) => {
      const status = (query as any)?.state?.data?.job?.status;
      if (!status || status === "analyzing" || status === "executing") return 2000;
      return false;
    },
  });

  const job = jobData?.job;
  const items = jobData?.items ?? [];

  // Step 1: collect files from input
  const handleFilesSelected = (files: FileList) => {
    const staged: StagedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const relPath = (f as any).webkitRelativePath || f.name;
      staged.push({
        filePath: relPath,
        fileName: f.name,
        fileSize: f.size,
        fileType: f.type || f.name.split(".").pop() || "",
        file: f,
      });
    }
    setStagedFiles(staged);
  };

  // Group files by folder for tree display
  const fileTree = stagedFiles.reduce<Record<string, StagedFile[]>>((acc, f) => {
    const parts = f.filePath.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(f);
    return acc;
  }, {});

  // Create job
  const createJobMut = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Select a project first");
      const r = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: parseInt(projectId),
          files: stagedFiles.map(f => ({
            filePath: f.filePath,
            fileName: f.fileName,
            fileSize: f.fileSize,
            fileType: f.fileType,
          })),
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error ?? "Failed to create job");
      }
      return r.json() as Promise<{ job: MigrationJob; items: MigrationItem[] }>;
    },
    onSuccess: (data) => {
      setJobId(data.job.id);
      setStep(2);
      // Kick off analysis
      fetch(`/api/migrations/${data.job.id}/analyze`, { method: "POST" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const updateItemMut = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: Record<string, string> }) => {
      const r = await fetch(`/api/migrations/${jobId}/items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!r.ok) throw new Error("Failed to update");
      return r.json();
    },
    onSuccess: () => {
      refetchJob();
      setEditItem(null);
    },
  });

  const bulkActionMut = useMutation({
    mutationFn: async ({ action, filter }: { action: "confirm" | "skip"; filter: string }) => {
      const r = await fetch(`/api/migrations/${jobId}/bulk-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, filter }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (d) => {
      refetchJob();
      toast({ title: `${d.updated} items updated` });
    },
  });

  const setStorageMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/migrations/${jobId}/storage`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageMode, baseUrl: storageMode === "reference" ? baseUrl : undefined }),
      });
      if (!r.ok) throw new Error("Failed to save storage choice");
      return r.json();
    },
    onSuccess: () => setStep(5),
  });

  const executeMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/migrations/${jobId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (r.status === 409) {
        // Already executing or completed — just refetch to show current state
        return { alreadyRunning: true };
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Import failed to start");
      }
      return r.json();
    },
    onSuccess: () => {
      refetchJob();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  // ── Step renders ─────────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Select Project & Files</h2>
        <p className="text-sm text-muted-foreground">
          Choose the project to import into, then upload your existing document folder.
        </p>
      </div>

      <div>
        <Label className="mb-2 block">Target Project *</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a project" />
          </SelectTrigger>
          <SelectContent>
            {(projectsData?.projects ?? []).map((p: any) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name} <span className="text-muted-foreground ml-1">({p.code})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* File pickers */}
      <div className="grid grid-cols-2 gap-4">
        <button
          className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl hover:border-primary hover:bg-primary/5 transition-colors text-center cursor-pointer"
          onClick={() => folderInputRef.current?.click()}
        >
          <FolderOpen className="h-8 w-8 mb-2 text-amber-500" />
          <span className="font-medium">Upload Folder</span>
          <span className="text-xs text-muted-foreground mt-1">Preserves folder structure</span>
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            multiple
            {...({ webkitdirectory: "true" } as any)}
            onChange={e => e.target.files && handleFilesSelected(e.target.files)}
          />
        </button>

        <button
          className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl hover:border-primary hover:bg-primary/5 transition-colors text-center cursor-pointer"
          onClick={() => filesInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 mb-2 text-primary" />
          <span className="font-medium">Select Files</span>
          <span className="text-xs text-muted-foreground mt-1">Multiple file selection</span>
          <input
            ref={filesInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={e => e.target.files && handleFilesSelected(e.target.files)}
          />
        </button>
      </div>

      {stagedFiles.length > 0 && (
        <div className="bg-muted/30 border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">{stagedFiles.length} files staged</span>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => setStagedFiles([])}
            >Clear</button>
          </div>
          <ScrollArea className="h-48">
            {Object.entries(fileTree).map(([folder, files]) => (
              <div key={folder} className="mb-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                  <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                  {folder}
                </div>
                {files.map(f => (
                  <div key={f.filePath} className="flex items-center gap-1.5 pl-5 py-0.5 text-xs">
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{f.fileName}</span>
                    <span className="text-muted-foreground shrink-0">
                      {f.fileSize > 1024 * 1024
                        ? `${(f.fileSize / 1024 / 1024).toFixed(1)} MB`
                        : `${Math.round(f.fileSize / 1024)} KB`}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </ScrollArea>

          <div className="flex items-center gap-2 pt-2 border-t text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              AI will analyze filenames and paths to extract document metadata. PDF/DOCX files may be read for higher accuracy.
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          disabled={!projectId || stagedFiles.length === 0 || createJobMut.isPending}
          onClick={() => createJobMut.mutate()}
          className="gap-2"
        >
          {createJobMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Start AI Analysis
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );

  const renderStep2 = () => {
    const isDone = job?.status === "awaiting_review" || job?.status === "completed";
    const isAnalyzing = !isDone && (job?.status === "analyzing" || job?.status === "pending" || !job?.status);
    const analyzed = items.filter(i => i.status !== "pending").length;
    const total = items.length;
    const progress = isDone ? 100 : total > 0 ? Math.round((analyzed / total) * 100) : 0;

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-1">AI Analysis</h2>
          <p className="text-sm text-muted-foreground">
            Extracting document metadata from filenames and folder paths.
          </p>
        </div>

        <div className="bg-card border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            {isAnalyzing
              ? <Loader2 className="h-8 w-8 text-primary animate-spin" />
              : <CheckCircle2 className="h-8 w-8 text-green-500" />}
            <div>
              <p className="font-medium">
                {isAnalyzing ? "Analyzing files..." : "Analysis complete"}
              </p>
              <p className="text-sm text-muted-foreground">
                {isDone ? `${total} files analyzed` : `${analyzed} of ${total} files processed`}
              </p>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-700">
                {items.filter(i => i.confidenceLabel === "high").length}
              </div>
              <div className="text-xs text-green-600 mt-0.5">High confidence</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-amber-700">
                {items.filter(i => i.confidenceLabel === "medium").length}
              </div>
              <div className="text-xs text-amber-600 mt-0.5">Need review</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-red-700">
                {items.filter(i => i.confidenceLabel === "low" || i.confidenceLabel === "unreadable").length}
              </div>
              <div className="text-xs text-red-600 mt-0.5">Low / unreadable</div>
            </div>
          </div>
        </div>

        {isAnalyzing && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => refetchJob()} className="gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refresh
            </Button>
          </div>
        )}
        {isDone && (
          <div className="flex justify-end">
            <Button onClick={() => setStep(3)} className="gap-2">
              Review Results <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderStep3 = () => {
    const highCount = items.filter(i => i.confidenceLabel === "high" && !i.skip).length;
    const needReview = items.filter(i => (i.confidenceLabel === "medium" || i.confidenceLabel === "low") && !i.skip).length;
    const unreadable = items.filter(i => i.confidenceLabel === "unreadable" && !i.skip).length;
    const confirmed = items.filter(i => i.status === "confirmed" || (i.confidenceLabel === "high" && i.status === "analyzed")).length;

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-1">Review & Confirm</h2>
            <p className="text-sm text-muted-foreground">
              Verify extracted metadata. High-confidence rows are pre-selected.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => bulkActionMut.mutate({ action: "confirm", filter: "high" })}
              disabled={highCount === 0 || bulkActionMut.isPending}
            >
              <FileCheck className="h-3.5 w-3.5 text-green-600" />
              Accept all high ({highCount})
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => bulkActionMut.mutate({ action: "skip", filter: "unreadable" })}
              disabled={unreadable === 0 || bulkActionMut.isPending}
            >
              <FileX className="h-3.5 w-3.5 text-gray-400" />
              Skip unreadable ({unreadable})
            </Button>
          </div>
        </div>

        <div className="border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[180px]">File</TableHead>
                <TableHead className="w-[200px]">Title</TableHead>
                <TableHead className="w-[110px]">Code</TableHead>
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead className="w-[100px]">Discipline</TableHead>
                <TableHead className="w-[55px]">Rev</TableHead>
                <TableHead className="w-[100px]">Confidence</TableHead>
                <TableHead className="w-[70px]">Status</TableHead>
                <TableHead className="w-[60px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => {
                const isEditing = editItem === item.id;
                const rowClass = item.skip
                  ? "opacity-40 bg-muted/20"
                  : item.confidenceLabel === "high" ? "bg-green-50/30"
                  : item.confidenceLabel === "medium" ? "bg-amber-50/30"
                  : item.confidenceLabel === "unreadable" ? "bg-gray-50"
                  : "bg-red-50/30";

                return (
                  <TableRow key={item.id} className={rowClass}>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate max-w-[150px]" title={item.filePath}>{item.fileName}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[160px] pl-5">{item.filePath}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {isEditing ? (
                        <Input
                          className="h-6 text-xs"
                          value={editValues.title ?? item.title ?? item.extractedTitle ?? ""}
                          onChange={e => setEditValues(v => ({ ...v, title: e.target.value }))}
                        />
                      ) : (
                        <span className={cn("truncate block max-w-[190px]", !item.title && !item.extractedTitle && "text-muted-foreground italic")}>
                          {item.title || item.extractedTitle || "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {isEditing ? (
                        <Input
                          className="h-6 text-xs"
                          value={editValues.code ?? item.code ?? item.extractedCode ?? ""}
                          onChange={e => setEditValues(v => ({ ...v, code: e.target.value }))}
                        />
                      ) : item.code || item.extractedCode || "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isEditing ? (
                        <Input
                          className="h-6 text-xs"
                          value={editValues.docType ?? item.docType ?? item.extractedDocType ?? ""}
                          onChange={e => setEditValues(v => ({ ...v, docType: e.target.value }))}
                        />
                      ) : item.docType || item.extractedDocType || "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.discipline || item.extractedDiscipline || "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {item.revision || item.extractedRevision || "A"}
                    </TableCell>
                    <TableCell>
                      <ConfidenceBadge label={item.confidenceLabel} confidence={item.confidence} />
                    </TableCell>
                    <TableCell>
                      {item.skip
                        ? <Badge variant="outline" className="text-xs text-muted-foreground">Skipped</Badge>
                        : item.status === "confirmed"
                        ? <Badge className="bg-green-100 text-green-700 text-xs">Confirmed</Badge>
                        : <Badge variant="outline" className="text-xs">Pending</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button
                              className="p-1 hover:bg-green-100 rounded"
                              onClick={() => updateItemMut.mutate({ id: item.id, values: { ...editValues, status: "confirmed" } })}
                            >
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </button>
                            <button className="p-1 hover:bg-muted rounded" onClick={() => setEditItem(null)}>
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="p-1 hover:bg-muted rounded"
                              title="Edit"
                              onClick={() => {
                                setEditItem(item.id);
                                setEditValues({
                                  title: item.title ?? item.extractedTitle ?? "",
                                  code: item.code ?? item.extractedCode ?? "",
                                  docType: item.docType ?? item.extractedDocType ?? "",
                                });
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            <button
                              className="p-1 hover:bg-muted rounded"
                              title={item.skip ? "Undo skip" : "Skip"}
                              onClick={() => updateItemMut.mutate({ id: item.id, values: { skip: item.skip ? "false" : "true" } })}
                            >
                              <SkipForward className={cn("h-3.5 w-3.5", item.skip ? "text-primary" : "text-muted-foreground")} />
                            </button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {confirmed} confirmed · {items.filter(i => i.skip).length} skipped · {items.length - confirmed - items.filter(i => i.skip).length} pending
          </p>
          <Button onClick={() => setStep(4)} className="gap-2">
            Choose Storage <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const renderStep4 = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Storage Configuration</h2>
        <p className="text-sm text-muted-foreground">
          Choose how the imported documents will be stored.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button
          className={cn(
            "flex flex-col items-start p-5 border-2 rounded-xl text-left transition-colors",
            storageMode === "system" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40",
          )}
          onClick={() => setStorageMode("system")}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("p-2 rounded-lg", storageMode === "system" ? "bg-primary/10" : "bg-muted")}>
              <Server className={cn("h-5 w-5", storageMode === "system" ? "text-primary" : "text-muted-foreground")} />
            </div>
            <span className="font-semibold">Transfer to System Storage</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Files are uploaded to the configured cloud/object storage. Full integration with the document management system.
          </p>
          <Badge className="mt-3 bg-green-100 text-green-700">Recommended</Badge>
        </button>

        <button
          className={cn(
            "flex flex-col items-start p-5 border-2 rounded-xl text-left transition-colors",
            storageMode === "reference" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40",
          )}
          onClick={() => setStorageMode("reference")}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("p-2 rounded-lg", storageMode === "reference" ? "bg-primary/10" : "bg-muted")}>
              <HardDrive className={cn("h-5 w-5", storageMode === "reference" ? "text-primary" : "text-muted-foreground")} />
            </div>
            <span className="font-semibold">Keep on Your Server</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Files stay in place. The system stores metadata with a URL/path reference only.
          </p>
        </button>
      </div>

      {storageMode === "reference" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Configure File Base URL
          </div>
          <p className="text-xs text-amber-700">
            Enter the base URL or UNC network path where your files are hosted. This will be prepended to each file's relative path.
          </p>
          <div>
            <Label className="text-sm">Base URL / Network Path</Label>
            <Input
              className="mt-1"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://storage.company.com/projects/ or \\server\share\projects\"
            />
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(3)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Button
          onClick={() => setStorageMut.mutate()}
          disabled={setStorageMut.isPending || (storageMode === "reference" && !baseUrl.trim())}
          className="gap-2"
        >
          {setStorageMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Confirm & Continue <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const renderStep5 = () => {
    const isExecuting = job?.status === "executing" || executeMut.isPending;
    const isComplete = job?.status === "completed";
    const isFailed = job?.status === "failed";
    const hasStarted = isExecuting || isComplete || isFailed;

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-1">Import & Generate Registers</h2>
          <p className="text-sm text-muted-foreground">
            Documents will be imported and registers auto-generated from the data.
          </p>
        </div>

        {!hasStarted && (
          <div className="bg-card border rounded-xl p-6 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-3xl font-bold text-primary">{items.filter(i => !i.skip && i.status !== "skipped").length}</div>
                <div className="text-xs text-muted-foreground mt-1">Documents to import</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-muted-foreground">{items.filter(i => i.skip || i.status === "skipped").length}</div>
                <div className="text-xs text-muted-foreground mt-1">Skipped</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-amber-500">
                  {storageMode === "system" ? "Cloud" : "Reference"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Storage mode</div>
              </div>
            </div>
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={() => executeMut.mutate()}
              disabled={executeMut.isPending}
            >
              {executeMut.isPending
                ? <><Loader2 className="h-5 w-5 animate-spin" /> Starting import...</>
                : <><Zap className="h-5 w-5" /> Start Import</>
              }
            </Button>
          </div>
        )}

        {(isExecuting) && (
          <div className="bg-card border rounded-xl p-8 text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div>
              <p className="font-semibold">Import in progress…</p>
              <p className="text-sm text-muted-foreground mt-1">
                You can navigate away and come back — the import continues in the background.
              </p>
            </div>
          </div>
        )}

        {isComplete && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-10 w-10 text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-green-800 text-lg">Import Complete!</p>
                <p className="text-sm text-green-700">Your project documents have been migrated successfully.</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <div className="text-2xl font-bold text-green-700">{job?.importedCount ?? 0}</div>
                <div className="text-xs text-green-600 mt-0.5">Imported</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <div className="text-2xl font-bold text-gray-500">{job?.skippedCount ?? 0}</div>
                <div className="text-xs text-gray-500 mt-0.5">Skipped</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <div className="text-2xl font-bold text-red-500">{job?.failedCount ?? 0}</div>
                <div className="text-xs text-red-500 mt-0.5">Failed</div>
              </div>
            </div>
            {(job?.generatedRegisters as string[] ?? []).length > 0 && (
              <div>
                <p className="text-sm font-medium text-green-800 mb-2">Auto-generated registers:</p>
                <div className="flex flex-wrap gap-2">
                  {(job?.generatedRegisters as string[] ?? []).map((r: string) => (
                    <Badge key={r} className="bg-green-100 text-green-800">{r}</Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => navigate(`/projects/${job?.projectId}`)}
              >
                <FileText className="h-4 w-4" /> View Project Documents
              </Button>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <div>
                <p className="font-semibold text-red-800">Import failed</p>
                <p className="text-sm text-red-700 mt-1">An error occurred during import. Please try again or contact support.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4 text-muted-foreground">
          <Link href="/projects"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Projects</Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Migration Wizard</h1>
        <p className="text-muted-foreground mt-1">Import existing project documents from your file system.</p>
      </div>

      <StepIndicator current={step} />

      <div className="bg-card border rounded-2xl p-6 shadow-sm">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
      </div>
    </div>
  );
}

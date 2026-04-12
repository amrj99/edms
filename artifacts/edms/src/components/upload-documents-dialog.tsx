import { useRef, useState, useCallback, useEffect, type DragEvent, type ChangeEvent } from "react";
import {
  FileText, Upload, X, Check, AlertCircle, Copy, Loader2,
  ChevronDown, ChevronUp, ClipboardCopy, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AIProcedurePanel } from "@/components/ai/AIProcedurePanel";

const DOC_TYPES = ["general","drawing","specification","report","certificate","calculation","procedure","manual","datasheet","schedule","correspondence","other"];
const SOURCES = ["internal","external","client","contractor","consultant","supplier"];
const STATUSES = ["draft","under_review","approved","issued","superseded","void"];

export interface DocMeta {
  title: string;
  docNumber: string;
  discipline: string;
  revision: string;
  docType: string;
  status: string;
  source: string;
  issuedBy: string;
  direction?: string;
}

interface StagedFile {
  id: string;
  file: File;
  meta: DocMeta;
  progress: number;
  uploadStatus: "pending" | "uploading" | "done" | "error";
  uploadedUrl?: string;
  error?: string;
  expanded: boolean;
}

interface UploadDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectCode?: string;
  projectName?: string;
  onSuccess: (docs: { meta: DocMeta; fileUrl: string; fileName: string; fileSize: number }[]) => void;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*,.dwg,.dxf";
const MAX_MB = 100;

function defaultMeta(file: File): DocMeta {
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    docNumber: "",
    discipline: "",
    revision: "01",
    docType: "general",
    status: "draft",
    source: "",
    issuedBy: "",
  };
}

async function requestUploadUrl(file: File, projectId: number): Promise<{ uploadURL: string; objectPath: string }> {
  const r = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      fileType: "document",
      projectId,
    }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Failed to get upload URL");
  }
  return r.json();
}

function uploadWithProgress(file: File, uploadUrl: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    // For on-premise uploads to our own API, attach the auth token
    if (uploadUrl.startsWith("/") || uploadUrl.includes(window.location.host)) {
      const token = localStorage.getItem("edms_token");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

interface DocNumberCheck {
  checking: boolean;
  available: boolean | null;
  existingDocumentId?: number;
  existingTitle?: string;
}

export function UploadDocumentsDialog({ open, onOpenChange, projectId, projectCode, projectName, onSuccess }: UploadDocumentsDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [docNumberChecks, setDocNumberChecks] = useState<Record<string, DocNumberCheck>>({});
  const [aiPanelOpen, setAiPanelOpen] = useState<Record<string, boolean>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const anyUploading = isUploading || files.some(f => f.uploadStatus === "uploading");

  const checkDocNumber = useCallback((fileId: string, docNumber: string) => {
    if (!docNumber.trim()) {
      setDocNumberChecks(prev => ({ ...prev, [fileId]: { checking: false, available: null } }));
      return;
    }
    // Show spinner immediately
    setDocNumberChecks(prev => ({ ...prev, [fileId]: { checking: true, available: null } }));
    // Clear any existing timer for this file
    if (debounceTimers.current[fileId]) clearTimeout(debounceTimers.current[fileId]);
    debounceTimers.current[fileId] = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/documents/check-number?number=${encodeURIComponent(docNumber.trim())}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          setDocNumberChecks(prev => ({
            ...prev,
            [fileId]: {
              checking: false,
              available: data.available,
              existingDocumentId: data.existingDocumentId,
              existingTitle: data.existingTitle,
            },
          }));
        } else {
          setDocNumberChecks(prev => ({ ...prev, [fileId]: { checking: false, available: null } }));
        }
      } catch {
        setDocNumberChecks(prev => ({ ...prev, [fileId]: { checking: false, available: null } }));
      }
    }, 400);
  }, [projectId]);

  // Clear checks when dialog closes
  useEffect(() => {
    if (!open) {
      setDocNumberChecks({});
      Object.values(debounceTimers.current).forEach(clearTimeout);
      debounceTimers.current = {};
    }
  }, [open]);

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(f => f.size <= MAX_MB * 1024 * 1024);
    const oversized = incoming.filter(f => f.size > MAX_MB * 1024 * 1024);
    if (oversized.length) {
      setGlobalError(`${oversized.map(f => f.name).join(", ")} — File exceeds the ${MAX_MB}MB limit. Please compress the file or contact your administrator.`);
    }
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.file.name));
      const newEntries: StagedFile[] = valid
        .filter(f => !existingNames.has(f.name))
        .map((f, i) => ({
          id: `${f.name}-${Date.now()}-${i}`,
          file: f,
          meta: defaultMeta(f),
          progress: 0,
          uploadStatus: "pending",
          expanded: true,
        }));
      if (newEntries.length === 0 && valid.length > 0) {
        setGlobalError("All selected files are already in the list.");
      }
      return [...prev, ...newEntries];
    });
  }, []);

  const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const updateMeta = (id: string, patch: Partial<DocMeta>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, meta: { ...f.meta, ...patch } } : f));
    if ("docNumber" in patch) {
      checkDocNumber(id, patch.docNumber ?? "");
    }
  };

  const toggleExpand = (id: string) =>
    setFiles(prev => prev.map(f => f.id === id ? { ...f, expanded: !f.expanded } : f));

  const copyToAll = (sourceId: string) => {
    const source = files.find(f => f.id === sourceId);
    if (!source) return;
    const { title, docNumber: _dn, ...sharedMeta } = source.meta;
    setFiles(prev => prev.map(f =>
      f.id === sourceId ? f : { ...f, meta: { ...f.meta, ...sharedMeta } }
    ));
  };

  const handleUploadAll = async () => {
    const pending = files.filter(f => f.uploadStatus === "pending" || f.uploadStatus === "error");
    if (pending.length === 0) return;
    setGlobalError(null);
    setIsUploading(true);

    const results: { meta: DocMeta; fileUrl: string; fileName: string; fileSize: number }[] = [];

    for (const entry of pending) {
      setFiles(prev => prev.map(f => f.id === entry.id
        ? { ...f, uploadStatus: "uploading", progress: 0, error: undefined }
        : f
      ));
      try {
        const { uploadURL, objectPath } = await requestUploadUrl(entry.file, projectId);
        await uploadWithProgress(entry.file, uploadURL, (pct) => {
          setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, progress: pct } : f));
        });
        setFiles(prev => prev.map(f => f.id === entry.id
          ? { ...f, uploadStatus: "done", progress: 100, uploadedUrl: objectPath }
          : f
        ));
        results.push({
          meta: entry.meta,
          fileUrl: objectPath,
          fileName: entry.file.name,
          fileSize: entry.file.size,
        });
      } catch (err: any) {
        setFiles(prev => prev.map(f => f.id === entry.id
          ? { ...f, uploadStatus: "error", error: err?.message ?? "Upload failed" }
          : f
        ));
      }
    }

    setIsUploading(false);
    if (results.length > 0) {
      onSuccess(results);
    }
  };

  const handleClose = () => {
    if (anyUploading) return;
    setFiles([]);
    setGlobalError(null);
    onOpenChange(false);
  };

  const allDone = files.length > 0 && files.every(f => f.uploadStatus === "done");
  const hasPending = files.some(f => f.uploadStatus === "pending" || f.uploadStatus === "error");
  const pendingCount = files.filter(f => f.uploadStatus === "pending" || f.uploadStatus === "error").length;

  const readyCount = files.filter(f => f.uploadStatus === "pending" && f.meta.title.trim()).length;
  const needsDetailsCount = files.filter(f => f.uploadStatus === "pending" && !f.meta.title.trim()).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[860px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            Upload Documents
          </DialogTitle>
          {/* Summary bar */}
          {files.length > 0 && (
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="font-medium text-foreground">{files.length} file{files.length !== 1 ? "s" : ""} staged</span>
              <span className="text-muted-foreground">—</span>
              <span className={readyCount > 0 ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
                {readyCount} ready
              </span>
              {needsDetailsCount > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-amber-600 font-medium">{needsDetailsCount} need title</span>
                </>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-4 space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => !anyUploading && inputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center transition-all cursor-pointer select-none min-h-[150px] px-6 py-6 gap-2",
                isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-muted/20",
                anyUploading && "opacity-50 cursor-not-allowed pointer-events-none",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={onChange}
                disabled={anyUploading}
              />
              <div className={cn("rounded-full p-3 transition-colors", isDragging ? "bg-primary/15" : "bg-muted")}>
                <Upload className={cn("h-6 w-6", isDragging ? "text-primary" : "text-muted-foreground")} />
              </div>
              <p className="text-sm font-semibold">{files.length === 0 ? "Click to browse or drag files here" : "Add more files"}</p>
              <p className="text-xs text-muted-foreground">PDF, DOCX, DWG, XLSX, images · max {MAX_MB}MB per file · multiple files OK</p>
            </div>

            {globalError && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {globalError}
              </p>
            )}

            {/* Copy-to-all hint */}
            {files.length > 1 && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 px-3 py-2">
                <ClipboardCopy className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Use <span className="font-semibold">Copy to all</span> on any file card to apply its discipline, revision, type, status, source, and issuer to all other files at once.
                </p>
              </div>
            )}

            {/* Staged file cards */}
            {files.map((entry, idx) => (
              <div
                key={entry.id}
                className={cn(
                  "border rounded-xl overflow-hidden transition-all",
                  entry.uploadStatus === "done" && "border-emerald-200 dark:border-emerald-900",
                  entry.uploadStatus === "error" && "border-destructive/40",
                  entry.expanded && entry.uploadStatus !== "done" && "border-primary/60 ring-1 ring-primary/20",
                )}
              >
                {/* Card header */}
                <div className={cn(
                  "flex items-center gap-2 px-3 py-2.5 transition-colors",
                  entry.expanded && entry.uploadStatus !== "done" ? "bg-primary/5" : "bg-muted/30",
                )}>
                  {entry.uploadStatus === "uploading" ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
                  ) : entry.uploadStatus === "done" ? (
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : entry.uploadStatus === "error" ? (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate leading-none">{entry.file.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatSize(entry.file.size)}
                      {entry.uploadStatus === "uploading" && ` · ${entry.progress}%`}
                      {entry.uploadStatus === "done" && " · uploaded"}
                      {entry.uploadStatus === "error" && ` · ${entry.error}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {entry.uploadStatus === "pending" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-7 px-2.5 text-xs gap-1.5 font-medium",
                          aiPanelOpen[entry.id]
                            ? "border-primary/60 text-primary bg-primary/5"
                            : "border-primary/30 text-primary hover:bg-primary/5 hover:border-primary/60"
                        )}
                        onClick={() => setAiPanelOpen(prev => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                        title="Get AI suggestions for document number, discipline and revision"
                      >
                        <Sparkles className="h-3 w-3" />
                        {aiPanelOpen[entry.id] ? "Hide AI" : "AI Suggest"}
                      </Button>
                    )}
                    {files.length > 1 && entry.uploadStatus === "pending" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5 hover:text-primary hover:border-primary/60 font-medium"
                        onClick={() => copyToAll(entry.id)}
                        title="Apply this file's discipline, revision, type, status, source and issuer to all other files in this upload"
                      >
                        <Copy className="h-3 w-3" /> Copy to all
                      </Button>
                    )}
                    {entry.uploadStatus !== "uploading" && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(entry.id)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded"
                        title={entry.expanded ? "Collapse" : "Expand metadata"}
                      >
                        {entry.expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    {entry.uploadStatus !== "uploading" && entry.uploadStatus !== "done" && (
                      <button
                        type="button"
                        onClick={() => removeFile(entry.id)}
                        className="text-muted-foreground hover:text-destructive p-1 rounded"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Upload progress bar */}
                {entry.uploadStatus === "uploading" && (
                  <div className="h-1 bg-muted/50 w-full">
                    <div
                      className="h-full bg-primary transition-all duration-150 ease-out"
                      style={{ width: `${entry.progress}%` }}
                    />
                  </div>
                )}

                {/* Metadata form */}
                {entry.expanded && entry.uploadStatus !== "done" && (
                  <div className="px-3 pb-3 pt-2 space-y-2.5 border-t bg-background/60">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="col-span-2">
                        <Label className="text-xs font-medium">Title *</Label>
                        <Input
                          value={entry.meta.title}
                          onChange={e => updateMeta(entry.id, { title: e.target.value })}
                          placeholder="Document title"
                          className="mt-1 h-8 text-sm"
                          disabled={entry.uploadStatus === "uploading"}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Document Number</Label>
                        <div className="relative mt-1">
                          <Input
                            value={entry.meta.docNumber}
                            onChange={e => updateMeta(entry.id, { docNumber: e.target.value })}
                            placeholder="Auto-generated if blank"
                            className={cn(
                              "h-8 text-sm font-mono pr-7",
                              docNumberChecks[entry.id]?.available === false && "border-amber-400 focus-visible:ring-amber-400/30"
                            )}
                            disabled={entry.uploadStatus === "uploading"}
                          />
                          {entry.meta.docNumber && docNumberChecks[entry.id]?.checking && (
                            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
                          )}
                          {entry.meta.docNumber && docNumberChecks[entry.id]?.available === true && (
                            <Check className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-500" />
                          )}
                          {entry.meta.docNumber && docNumberChecks[entry.id]?.available === false && (
                            <AlertCircle className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-500" />
                          )}
                        </div>
                        {docNumberChecks[entry.id]?.available === false && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                            <span>
                              Number already exists
                              {docNumberChecks[entry.id]?.existingTitle && (
                                <> — &ldquo;{docNumberChecks[entry.id]!.existingTitle}&rdquo;</>
                              )}
                              . Upload will be blocked. Change the number or leave blank for auto-generation.
                            </span>
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Revision</Label>
                        <Input
                          value={entry.meta.revision}
                          onChange={e => updateMeta(entry.id, { revision: e.target.value })}
                          placeholder="01"
                          className="mt-1 h-8 text-sm font-mono"
                          disabled={entry.uploadStatus === "uploading"}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Discipline</Label>
                        <Input
                          value={entry.meta.discipline}
                          onChange={e => updateMeta(entry.id, { discipline: e.target.value })}
                          placeholder="E.g. Structural"
                          className="mt-1 h-8 text-sm"
                          disabled={entry.uploadStatus === "uploading"}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Document Type</Label>
                        <Select
                          value={entry.meta.docType}
                          onValueChange={v => updateMeta(entry.id, { docType: v })}
                          disabled={entry.uploadStatus === "uploading"}
                        >
                          <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DOC_TYPES.map(t => (
                              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Status</Label>
                        <Select
                          value={entry.meta.status}
                          onValueChange={v => updateMeta(entry.id, { status: v })}
                          disabled={entry.uploadStatus === "uploading"}
                        >
                          <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STATUSES.map(s => (
                              <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Source</Label>
                        <Select
                          value={entry.meta.source || "_none"}
                          onValueChange={v => updateMeta(entry.id, { source: v === "_none" ? "" : v })}
                          disabled={entry.uploadStatus === "uploading"}
                        >
                          <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">— None —</SelectItem>
                            {SOURCES.map(s => (
                              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Issued By</Label>
                        <Input
                          value={entry.meta.issuedBy}
                          onChange={e => updateMeta(entry.id, { issuedBy: e.target.value })}
                          placeholder="E.g. ABC Engineering"
                          className="mt-1 h-8 text-sm"
                          disabled={entry.uploadStatus === "uploading"}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Direction</Label>
                        <Select
                          value={entry.meta.direction || "_none"}
                          onValueChange={v => updateMeta(entry.id, { direction: v === "_none" ? undefined : v })}
                          disabled={entry.uploadStatus === "uploading"}
                        >
                          <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">— None —</SelectItem>
                            <SelectItem value="incoming">↓ Incoming</SelectItem>
                            <SelectItem value="outgoing">↑ Outgoing</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {aiPanelOpen[entry.id] && (
                      <AIProcedurePanel
                        projectCode={projectCode}
                        projectName={projectName}
                        discipline={entry.meta.discipline}
                        documentType={entry.meta.docType}
                        partialTitle={entry.meta.title}
                        onApply={(suggestion) => {
                          updateMeta(entry.id, {
                            ...(suggestion.documentNumber ? { docNumber: suggestion.documentNumber } : {}),
                            ...(suggestion.discipline ? { discipline: suggestion.discipline } : {}),
                            ...(suggestion.documentType ? { docType: suggestion.documentType } : {}),
                            ...(suggestion.revision ? { revision: suggestion.revision } : {}),
                            ...(suggestion.title ? { title: suggestion.title } : {}),
                          });
                        }}
                      />
                    )}
                    {!entry.meta.title.trim() && (
                      <p className="text-xs text-destructive">Title is required.</p>
                    )}
                  </div>
                )}

                {entry.uploadStatus === "done" && (
                  <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 border-t border-emerald-100 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-400">
                    Saved as: {entry.meta.title || entry.file.name}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <div className="flex items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-2 min-w-0">
              {allDone ? (
                <span className="text-sm text-emerald-600 flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> All {files.length} file{files.length !== 1 ? "s" : ""} uploaded successfully
                </span>
              ) : needsDetailsCount > 0 && !anyUploading ? (
                <span className="text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {needsDetailsCount} file{needsDetailsCount !== 1 ? "s" : ""} still need{needsDetailsCount === 1 ? "s" : ""} a title — expand to fill in
                </span>
              ) : null}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" onClick={handleClose} disabled={anyUploading}>
                {allDone ? "Close" : "Cancel"}
              </Button>
              {!allDone && (
                <Button
                  onClick={handleUploadAll}
                  disabled={files.length === 0 || !hasPending || anyUploading || needsDetailsCount > 0}
                >
                  {anyUploading ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Uploading…</>
                  ) : (
                    <><Upload className="h-3.5 w-3.5 mr-1.5" />
                      Upload{pendingCount > 0 ? ` ${pendingCount} File${pendingCount !== 1 ? "s" : ""}` : ""}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useRef, useState, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Upload, X, FileText, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  url: string;
  name: string;
  size: number;
}

interface FileEntry {
  file: File;
  progress: number;
  status: "uploading" | "done" | "error";
  uploaded?: UploadedFile;
  error?: string;
}

interface FileDropZoneProps {
  onUpload: (file: UploadedFile) => void;
  accept?: string;
  maxSizeMb?: number;
  label?: string;
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  onMultiUpload?: (files: UploadedFile[]) => void;
}

async function requestUploadUrl(file: File, projectId?: number): Promise<{ uploadURL: string; objectPath: string }> {
  const r = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      fileType: "document",
      ...(projectId ? { projectId } : {}),
    }),
  });
  if (!r.ok) throw new Error("Failed to get upload URL");
  return r.json();
}

/** Public helper for uploading a single file to storage (used by other modules). */
export async function uploadFileToStorage(file: File, projectId?: number): Promise<UploadedFile> {
  const { uploadURL, objectPath } = await requestUploadUrl(file, projectId);
  await uploadWithProgress(file, uploadURL, () => {});
  return { url: objectPath, name: file.name, size: file.size };
}

function uploadWithProgress(
  file: File,
  uploadUrl: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    // Attach Bearer token for on-premise uploads to our own API
    if (uploadUrl.startsWith("/") || uploadUrl.includes(window.location.host)) {
      const token = localStorage.getItem("edms_token");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export async function uploadToStorage(file: File): Promise<UploadedFile> {
  const { uploadURL, objectPath } = await requestUploadUrl(file);
  await uploadWithProgress(file, uploadURL, () => {});
  return { url: objectPath, name: file.name, size: file.size };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileDropZone({
  onUpload,
  accept = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*,.dwg,.dxf",
  maxSizeMb = 100,
  label = "Click to browse or drag file here",
  className,
  disabled,
  multiple = false,
  onMultiUpload,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);

  const isUploading = entries.some(e => e.status === "uploading");

  const updateEntry = (name: string, patch: Partial<FileEntry>) => {
    setEntries(prev => prev.map(e => e.file.name === name ? { ...e, ...patch } : e));
  };

  const processFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const valid = files.filter(f => {
      if (f.size > maxSizeMb * 1024 * 1024) {
        setEntries(prev => [...prev, { file: f, progress: 0, status: "error", error: `File exceeds the ${maxSizeMb}MB limit. Please compress the file or contact your administrator.` }]);
        return false;
      }
      return true;
    });
    if (!valid.length) return;

    const newEntries: FileEntry[] = valid.map(f => ({ file: f, progress: 0, status: "uploading" as const }));
    setEntries(prev => [...prev, ...newEntries]);

    const results: UploadedFile[] = [];
    for (const file of valid) {
      try {
        const { uploadURL, objectPath } = await requestUploadUrl(file);
        await uploadWithProgress(file, uploadURL, pct => updateEntry(file.name, { progress: pct }));
        const uploaded: UploadedFile = {
          url: objectPath,
          name: file.name,
          size: file.size,
        };
        updateEntry(file.name, { status: "done", progress: 100, uploaded });
        results.push(uploaded);
      } catch (err: any) {
        updateEntry(file.name, { status: "error", error: err?.message ?? "Upload failed" });
      }
    }

    const succeeded = results.filter(Boolean);
    if (multiple && onMultiUpload && succeeded.length) {
      onMultiUpload(succeeded);
    } else if (succeeded[0]) {
      onUpload(succeeded[0]);
    }
  }, [onUpload, onMultiUpload, multiple, maxSizeMb]);

  const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!disabled) setIsDragging(true); };
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    processFiles(multiple ? files : [files[0]]);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    processFiles(multiple ? files : [files[0]]);
    e.target.value = "";
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center transition-all cursor-pointer select-none min-h-[180px] px-6 py-8 gap-2",
          isDragging ? "border-primary bg-primary/8 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-muted/30",
          (disabled || isUploading) && "opacity-50 cursor-not-allowed pointer-events-none",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={onChange}
          disabled={disabled || isUploading}
        />
        <div className={cn(
          "rounded-full p-4 transition-colors",
          isDragging ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}>
          <Upload className={cn("h-8 w-8 transition-colors", isDragging ? "text-primary" : "text-muted-foreground")} />
        </div>
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">PDF, DOCX, DWG, XLSX, images{multiple ? " · multiple files OK" : ""}</p>
        <p className="text-xs text-muted-foreground/70">max {maxSizeMb}MB per file</p>
      </div>

      {entries.length > 0 && (
        <div className="space-y-1.5">
          {entries.map((entry, i) => (
            <div key={i} className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-3 py-2">
                {entry.status === "uploading" ? (
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-primary">{entry.progress}%</span>
                  </div>
                ) : entry.status === "done" ? (
                  <div className="h-7 w-7 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                ) : (
                  <div className="h-7 w-7 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center shrink-0">
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate leading-none">{entry.file.name}</p>
                  {entry.status === "error"
                    ? <p className="text-[11px] text-destructive mt-0.5">{entry.error}</p>
                    : <p className="text-[11px] text-muted-foreground mt-0.5">{formatSize(entry.file.size)}{entry.status === "done" ? " · uploaded" : ""}</p>
                  }
                </div>
                {(entry.status === "done" || entry.status === "error") && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setEntries(prev => prev.filter((_, j) => j !== i)); }}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {entry.status === "uploading" && (
                <div className="h-1 bg-muted/50 w-full">
                  <div
                    className="h-full bg-primary transition-all duration-200 ease-out rounded-full"
                    style={{ width: `${entry.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { FileDropZone };

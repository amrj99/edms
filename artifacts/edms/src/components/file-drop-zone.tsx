import { useRef, useState, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface UploadedFile {
  url: string;
  name: string;
  size: number;
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

async function uploadToStorage(file: File): Promise<UploadedFile> {
  const reqRes = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, folder: "uploads" }),
  });
  if (!reqRes.ok) throw new Error("Failed to get upload URL");
  const { uploadUrl, objectKey } = await reqRes.json();

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!putRes.ok) throw new Error("Failed to upload file");

  const fileUrl = objectKey ?? `/api/storage/objects/${encodeURIComponent(file.name)}`;
  return { url: fileUrl, name: file.name, size: file.size };
}

export function FileDropZone({
  onUpload,
  accept = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*,.dwg,.dxf",
  maxSizeMb = 50,
  label = "Click to browse or drag file here",
  className,
  disabled,
  multiple = false,
  onMultiUpload,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    const valid = files.filter(f => {
      if (f.size > maxSizeMb * 1024 * 1024) {
        setError(`${f.name} exceeds ${maxSizeMb}MB limit`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;
    setUploading(true);
    try {
      const results: UploadedFile[] = [];
      for (const file of valid) {
        const uploaded = await uploadToStorage(file);
        results.push(uploaded);
        setUploadedFiles(prev => [...prev, uploaded]);
      }
      if (multiple && onMultiUpload) {
        onMultiUpload(results);
      } else if (results[0]) {
        onUpload(results[0]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [onUpload, onMultiUpload, multiple, maxSizeMb]);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    processFiles(multiple ? files : [files[0]]);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    processFiles(multiple ? files : [files[0]]);
    e.target.value = "";
  };
  const removeFile = (idx: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center text-center transition-colors cursor-pointer select-none",
          isDragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
          (disabled || uploading) && "opacity-50 cursor-not-allowed pointer-events-none",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={onChange}
          disabled={disabled || uploading}
        />
        {uploading ? (
          <>
            <Loader2 className="h-6 w-6 text-primary animate-spin mb-2" />
            <p className="text-sm font-medium text-muted-foreground">Uploading…</p>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, DWG, XLSX, images up to {maxSizeMb}MB</p>
          </>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {uploadedFiles.length > 0 && (
        <div className="space-y-1">
          {uploadedFiles.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs">
              <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="flex-1 truncate font-medium">{f.name}</span>
              <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); removeFile(i); }}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { uploadToStorage };

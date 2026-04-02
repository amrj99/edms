/**
 * DocumentFilesPanel
 * Shows all files attached to a document in a list.
 * Supports add, remove, download, and (where browser allows) preview.
 */
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  File, FileText, Trash2, Download, Eye, Plus, Loader2,
  Image, FileCode, FileSpreadsheet,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface DocumentFile {
  id: number;
  documentId: number;
  fileUrl: string;
  fileName: string;
  fileSize: number | null;
  fileType: string | null;
  uploadedById: number;
  uploadedByName?: string;
  createdAt: string;
}

interface DocumentFilesPanelProps {
  documentId: number;
  projectId: number;
  canEdit?: boolean;
}

function FileIcon({ fileType, fileName }: { fileType?: string | null; fileName: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const type = fileType ?? "";
  if (type.includes("pdf") || ext === "pdf") return <FileText className="h-4 w-4 text-red-500" />;
  if (type.includes("image") || ["png","jpg","jpeg","gif","svg","webp"].includes(ext))
    return <Image className="h-4 w-4 text-blue-500" />;
  if (["xls","xlsx","csv"].includes(ext)) return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  if (["doc","docx"].includes(ext)) return <FileText className="h-4 w-4 text-blue-600" />;
  if (["js","ts","py","json","xml","html","css"].includes(ext)) return <FileCode className="h-4 w-4 text-yellow-600" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreviewable(file: DocumentFile): boolean {
  const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  const type = file.fileType ?? "";
  return type.includes("pdf") || ext === "pdf" ||
    type.includes("image") || ["png","jpg","jpeg","gif","svg","webp"].includes(ext);
}

export function DocumentFilesPanel({ documentId, projectId, canEdit = true }: DocumentFilesPanelProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["document-files", documentId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/documents/${documentId}/files`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to fetch files");
      return r.json() as Promise<{ files: DocumentFile[] }>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: number) => {
      const r = await fetch(
        `/api/projects/${projectId}/documents/${documentId}/files/${fileId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-files", documentId] });
      toast({ title: "File removed" });
    },
    onError: () => toast({ title: "Failed to remove file", variant: "destructive" }),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("documentId", String(documentId));
      for (const file of Array.from(selected)) {
        formData.append("files", file);
      }

      // POST multipart/form-data — browser sets Content-Type + boundary automatically
      const res = await fetch(
        `/api/projects/${projectId}/documents/${documentId}/files`,
        { method: "POST", credentials: "include", body: formData },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      qc.invalidateQueries({ queryKey: ["document-files", documentId] });
      const count = selected.length;
      toast({ title: count === 1 ? "File added successfully" : `${count} files added successfully` });
    } catch (err: any) {
      toast({ title: err.message ?? "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const files = data?.files ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Attachments ({files.length})
        </p>
        {canEdit && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {uploading ? "Uploading…" : "Add file"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading files…
        </div>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No files attached yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map(file => (
            <li
              key={file.id}
              className="flex items-center gap-2.5 p-2 rounded-md border bg-card hover:bg-muted/40 transition-colors group"
            >
              <FileIcon fileType={file.fileType} fileName={file.fileName} />

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" title={file.fileName}>
                  {file.fileName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatBytes(file.fileSize)}
                  {file.uploadedByName && ` · ${file.uploadedByName}`}
                  {file.createdAt && ` · ${format(new Date(file.createdAt), "dd MMM yyyy")}`}
                </p>
              </div>

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {isPreviewable(file) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Preview"
                    onClick={() => window.open(file.fileUrl, "_blank")}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Download"
                  asChild
                >
                  <a href={file.fileUrl} download={file.fileName} target="_blank" rel="noopener noreferrer">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    title="Remove"
                    onClick={() => {
                      if (confirm(`Remove "${file.fileName}"?`)) {
                        deleteMutation.mutate(file.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

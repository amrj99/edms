import { usePreviewUrl } from "@/hooks/use-preview-url";
import { FileText, Loader2, ExternalLink, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OverrideFile {
  fileUrl: string;
  fileName: string;
  /** MIME type stored in document_files.file_type — used for renderer selection and Content-Type hint. */
  fileType?: string | null;
}

interface PreviewProps {
  doc: any;
  /**
   * When set, the middle pane previews this file instead of doc.fileUrl.
   * Used by the quick-preview dialog when the user clicks Eye on an attachment.
   */
  overrideFile?: OverrideFile | null;
}

// Fallback MIME map for when file_type is not stored in the database.
// Ensures the correct Content-Type is still sent to the server for UUID-named files.
const EXT_MIME: Record<string, string> = {
  pdf:  "application/pdf",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  webp: "image/webp",
  svg:  "image/svg+xml",
  bmp:  "image/bmp",
  mp4:  "video/mp4",
  txt:  "text/plain",
  csv:  "text/csv",
};

function isPdfMime(mimeType: string | null | undefined, ext: string): boolean {
  if (mimeType) return mimeType.includes("pdf");
  return ext === "pdf";
}

function isImageMime(mimeType: string | null | undefined, ext: string): boolean {
  if (mimeType) return mimeType.startsWith("image/");
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext);
}

export function DocumentPreviewContent({ doc, overrideFile }: PreviewProps) {
  const activeUrl   = overrideFile ? overrideFile.fileUrl  : doc.fileUrl;
  const activeName  = overrideFile ? overrideFile.fileName : (doc.fileName || doc.title || "");

  const ext     = (activeName as string).split(".").pop()?.toLowerCase() ?? "";
  // Use DB file_type if available; otherwise infer MIME from filename extension.
  // This ensures ?ct= is always forwarded to the server so UUID-named files get the
  // correct Content-Type (not application/octet-stream which causes blank iframes).
  const rawMime = overrideFile ? (overrideFile.fileType ?? null) : (doc.fileType ?? null);
  const activeMime = rawMime ?? EXT_MIME[ext] ?? null;

  const isPdf   = isPdfMime(activeMime, ext);
  const isImage = isImageMime(activeMime, ext);

  // Pass activeMime so the server sets the correct Content-Type on UUID-named files
  const previewState = usePreviewUrl(activeUrl, activeMime);

  if (!activeUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <FileText className="h-16 w-16 opacity-20" />
        <div className="text-center">
          <p className="text-sm font-medium">{doc.title}</p>
          <p className="text-xs mt-1">No file attached to this document.</p>
        </div>
        <div className="bg-muted rounded-lg p-4 text-xs space-y-1 text-left w-64">
          <p><span className="font-medium">Number:</span> {doc.documentNumber}</p>
          <p><span className="font-medium">Revision:</span> {doc.revision ?? "01"}</p>
          <p><span className="font-medium">Discipline:</span> {doc.discipline || "—"}</p>
          <p><span className="font-medium">Status:</span> {doc.status || "—"}</p>
          <p><span className="font-medium">Issued by:</span> {doc.issuedBy || "—"}</p>
        </div>
      </div>
    );
  }

  if (previewState.status === "loading") {
    return (
      <div className="w-full h-full flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Loading preview…</span>
      </div>
    );
  }

  if (previewState.status === "error" || previewState.status === "not-previewable") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <FileText className="h-16 w-16 opacity-20" />
        <div className="text-center">
          <p className="text-sm font-medium">{overrideFile ? overrideFile.fileName : doc.title}</p>
          <p className="text-xs mt-1 max-w-xs text-center">{previewState.message}</p>
        </div>
        {!overrideFile && (
          <div className="bg-muted rounded-lg p-4 text-xs space-y-1 text-left w-64">
            <p><span className="font-medium">Number:</span> {doc.documentNumber}</p>
            <p><span className="font-medium">Revision:</span> {doc.revision ?? "01"}</p>
            <p><span className="font-medium">Discipline:</span> {doc.discipline || "—"}</p>
            <p><span className="font-medium">Status:</span> {doc.status || "—"}</p>
            {doc.fileName && <p><span className="font-medium">File:</span> {doc.fileName}</p>}
          </div>
        )}
      </div>
    );
  }

  const authenticatedUrl = previewState.url;

  if (isPdf) {
    return (
      <iframe
        key={authenticatedUrl}
        src={authenticatedUrl}
        className="w-full h-full border-0"
        title={activeName}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      />
    );
  }

  if (isImage) {
    return (
      <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
        <img
          src={authenticatedUrl}
          alt={activeName}
          className="max-w-full max-h-full object-contain rounded shadow"
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <FileText className="h-16 w-16 opacity-20" />
      <p className="text-sm">No in-browser preview for this file type.</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={authenticatedUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />Open File
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const filename = activeName || "download";
            try {
              const tok = localStorage.getItem("edms_token");
              const r = await fetch(authenticatedUrl, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
              if (!r.ok) throw new Error();
              const blob = await r.blob();
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = filename;
              a.click();
              setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            } catch {
              window.open(authenticatedUrl, "_blank");
            }
          }}
        >
          <FileDown className="h-4 w-4 mr-2" />Download
        </Button>
      </div>
    </div>
  );
}

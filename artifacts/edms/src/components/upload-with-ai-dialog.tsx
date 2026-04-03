import { useState } from "react";
import { Upload, Sparkles, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FileDropZone, type UploadedFile } from "@/components/file-drop-zone";
import { AIProcedurePanel } from "@/components/ai/AIProcedurePanel";

const DOC_TYPES = [
  "general","drawing","specification","report","certificate",
  "calculation","procedure","manual","datasheet","schedule",
  "correspondence","other",
];
const SOURCES = ["internal","external","client","contractor","consultant","supplier"];
const STATUSES = ["draft","under_review","approved","issued","superseded","void"];

export interface AIUploadResult {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  title: string;
  docNumber: string;
  discipline: string;
  revision: string;
  docType: string;
  status: string;
  source: string;
  issuedBy: string;
}

interface UploadWithAIDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectCode?: string;
  projectName?: string;
  onSuccess: (result: AIUploadResult) => void;
}

export function UploadWithAIDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
  projectName,
  onSuccess,
}: UploadWithAIDialogProps) {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [title, setTitle] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [revision, setRevision] = useState("01");
  const [docType, setDocType] = useState("general");
  const [status, setStatus] = useState("draft");
  const [source, setSource] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

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

  const handleFileUploaded = (f: UploadedFile) => {
    setUploadedFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const handleSave = async () => {
    const resolvedTitle = title.trim() || (uploadedFile ? uploadedFile.name.replace(/\.[^.]+$/, "") : "");
    if (!resolvedTitle) { setTitleError("Title is required."); return; }
    if (!uploadedFile) { setTitleError("Please upload a file first."); return; }
    setTitleError(null);
    setIsSaving(true);
    try {
      onSuccess({
        fileUrl: uploadedFile.url,
        fileName: uploadedFile.name,
        fileSize: uploadedFile.size,
        title: resolvedTitle,
        docNumber,
        discipline,
        revision: revision || "01",
        docType: docType || "general",
        status: status || "draft",
        source,
        issuedBy,
      });
      handleClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setUploadedFile(null);
    setTitle(""); setDocNumber(""); setDiscipline(""); setRevision("01");
    setDocType("general"); setStatus("draft"); setSource(""); setIssuedBy("");
    setTitleError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[720px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Upload with AI
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-4 space-y-5">
            {/* AI Procedure Panel */}
            <AIProcedurePanel
              projectCode={projectCode}
              projectName={projectName}
              discipline={discipline}
              documentType={docType}
              partialTitle={title}
              onApply={handleAIProcedureApply}
            />

            {/* ── Section 1: File Upload ───────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">1</div>
                <p className="text-sm font-semibold">File Upload</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              <FileDropZone
                onUpload={handleFileUploaded}
                label="Click to browse or drag a single file here"
                multiple={false}
              />
              {uploadedFile && (
                <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2.5 mt-3">
                  <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{uploadedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {uploadedFile.size < 1024 * 1024
                        ? `${(uploadedFile.size / 1024).toFixed(0)} KB`
                        : `${(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB`}
                      {" · ready to save"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Section 2: Document Identity ────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">2</div>
                <p className="text-sm font-semibold">Document Identity</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-sm font-medium">Title *</Label>
                  <Input
                    value={title}
                    onChange={e => { setTitle(e.target.value); if (e.target.value) setTitleError(null); }}
                    placeholder="E.g. Ground Floor Plan"
                    className="mt-1"
                  />
                  {titleError && <p className="text-xs text-destructive mt-1">{titleError}</p>}
                </div>
                <div>
                  <Label className="text-sm font-medium">Document Number</Label>
                  <Input
                    value={docNumber}
                    onChange={e => setDocNumber(e.target.value)}
                    placeholder="Auto-generated or from AI"
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Issued By</Label>
                  <Input
                    value={issuedBy}
                    onChange={e => setIssuedBy(e.target.value)}
                    placeholder="E.g. ABC Engineering"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* ── Section 3: Classification ────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">3</div>
                <p className="text-sm font-semibold">Classification</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">Discipline</Label>
                  <Input
                    value={discipline}
                    onChange={e => setDiscipline(e.target.value)}
                    placeholder="E.g. Structural"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Document Type</Label>
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOC_TYPES.map(t => (
                        <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Revision</Label>
                  <Input
                    value={revision}
                    onChange={e => setRevision(e.target.value)}
                    placeholder="01"
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Source</Label>
                  <Select value={source || "_none"} onValueChange={v => setSource(v === "_none" ? "" : v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— None —</SelectItem>
                      {SOURCES.map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !uploadedFile}>
            {isSaving ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</>
            ) : (
              <><Upload className="h-3.5 w-3.5 mr-1.5" /> Save Document</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

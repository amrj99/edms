import { useState, useRef, useCallback } from "react";
import { Upload, Sparkles, Loader2, FileText, Check, AlertCircle, ExternalLink, FilePlus2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDropZone, type UploadedFile } from "@/components/file-drop-zone";
import { MetadataFieldsForm } from "@/components/metadata-fields-form";
import { AIProcedurePanel, type AIProcedureSuggestion } from "@/components/ai/AIProcedurePanel";
import { cn } from "@/lib/utils";
import type { DocMeta } from "@/components/upload-documents-dialog";

// Set VITE_AI_ENABLED=true in .env to show the AI Procedure panel
const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === "true";

const DOC_TYPES = ["general","drawing","specification","report","certificate","calculation","procedure","manual","datasheet","schedule","correspondence","other"];
const SOURCES = ["internal","external","client","contractor","consultant","supplier"];
const STATUSES = ["draft","under_review","approved","issued","superseded","void"];

interface DocNumberCheck {
  checking: boolean;
  available: boolean | null;
  existingDocumentId?: number;
  existingTitle?: string;
  existingRevision?: string;
  existingStatus?: string;
}

interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectCode?: string;
  projectName?: string;
  onSuccess: (result: { meta: DocMeta; fileUrl: string; fileName: string; fileSize: number }) => void;
  onOpenDocument?: (docId: number) => void;
  onUploadRevision?: (doc: { id: number; documentNumber: string; title: string; revision?: string }) => void;
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
  projectName,
  onSuccess,
  onOpenDocument,
  onUploadRevision,
}: UploadDocumentDialogProps) {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [title, setTitle] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [revision, setRevision] = useState("01");
  const [docType, setDocType] = useState("general");
  const [status, setStatus] = useState("draft");
  const [source, setSource] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [docCheck, setDocCheck] = useState<DocNumberCheck>({ checking: false, available: null });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: documentTypesRaw } = useQuery({
    queryKey: ["document-types"],
    queryFn: async () => {
      const r = await fetch("/api/document-types");
      return r.ok ? r.json() : [];
    },
    enabled: open,
  });
  const activeDocumentTypes: { id: number; code: string; name: string }[] = Array.isArray(documentTypesRaw)
    ? documentTypesRaw.filter((dt: any) => dt.isActive).map((dt: any) => ({ id: dt.id, code: dt.code, name: dt.name }))
    : [];
  const docTypeOptions = activeDocumentTypes.length > 0
    ? activeDocumentTypes
    : DOC_TYPES.map(t => ({ id: 0, code: t, name: t.charAt(0).toUpperCase() + t.slice(1) }));
  const resolvedDocTypeId = activeDocumentTypes.find(t => t.code === docType)?.id ?? null;

  const checkDocNumber = useCallback((number: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!number.trim()) { setDocCheck({ checking: false, available: null }); return; }
    setDocCheck({ checking: true, available: null });
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/documents/check-number?number=${encodeURIComponent(number.trim())}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          setDocCheck({ checking: false, available: data.available, existingDocumentId: data.existingDocumentId, existingTitle: data.existingTitle, existingRevision: data.existingRevision, existingStatus: data.existingStatus });
        } else {
          setDocCheck({ checking: false, available: null });
        }
      } catch {
        setDocCheck({ checking: false, available: null });
      }
    }, 400);
  }, [projectId]);

  const handleDocNumberChange = (val: string) => {
    setDocNumber(val);
    checkDocNumber(val);
  };

  const handleAIApply = (suggestion: AIProcedureSuggestion) => {
    if (suggestion.documentNumber) { setDocNumber(suggestion.documentNumber); checkDocNumber(suggestion.documentNumber); }
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
    if (docCheck.available === false) return;
    setTitleError(null);
    setIsSaving(true);
    try {
      onSuccess({
        meta: {
          title: resolvedTitle,
          docNumber,
          discipline,
          revision: revision || "01",
          docType: docType || "general",
          status: status || "draft",
          source,
          issuedBy,
          customFields,
        },
        fileUrl: uploadedFile.url,
        fileName: uploadedFile.name,
        fileSize: uploadedFile.size,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isSaving) return;
    setUploadedFile(null);
    setTitle(""); setDocNumber(""); setDiscipline(""); setRevision("01");
    setDocType("general"); setStatus("draft"); setSource(""); setIssuedBy("");
    setCustomFields({}); setTitleError(null);
    setDocCheck({ checking: false, available: null });
    onOpenChange(false);
  };

  const isDuplicate = docCheck.available === false;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[720px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            {AI_ENABLED
              ? <><Sparkles className="h-4 w-4 text-primary" /> Upload with AI</>
              : <><Upload className="h-4 w-4" /> Upload Document</>
            }
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-4 space-y-5">

            {/* AI Procedure Panel — hidden until VITE_AI_ENABLED=true */}
            {AI_ENABLED && (
              <AIProcedurePanel
                projectId={projectId}
                projectCode={projectCode}
                projectName={projectName}
                discipline={discipline}
                documentType={docType}
                partialTitle={title}
                onApply={handleAIApply}
              />
            )}

            {/* ── Section 1: File Upload ─────────────────────────── */}
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
                disabled={isSaving}
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

            {/* ── Section 2: Document Identity ──────────────────── */}
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
                    disabled={isSaving}
                  />
                  {titleError && <p className="text-xs text-destructive mt-1">{titleError}</p>}
                </div>
                <div>
                  <Label className="text-sm font-medium">Document Number</Label>
                  <div className="relative mt-1">
                    <Input
                      value={docNumber}
                      onChange={e => handleDocNumberChange(e.target.value)}
                      placeholder="Auto-generated or from AI"
                      className={cn(
                        "font-mono pr-7",
                        isDuplicate && "border-amber-500 focus-visible:ring-amber-400/30",
                        docCheck.available === true && "border-emerald-400 focus-visible:ring-emerald-400/30",
                      )}
                      disabled={isSaving}
                    />
                    {docNumber && docCheck.checking && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />}
                    {docNumber && docCheck.available === true && <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />}
                    {docNumber && isDuplicate && <AlertCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-500" />}
                  </div>
                  {isDuplicate && (
                    <div className="mt-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 space-y-1.5">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> This document number already exists
                      </p>
                      {docCheck.existingTitle && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          <span className="font-medium">{docCheck.existingTitle}</span>
                          {(docCheck.existingRevision || docCheck.existingStatus) && (
                            <span className="text-amber-600/80 dark:text-amber-500">
                              {" · "}Rev {docCheck.existingRevision ?? "01"}
                              {docCheck.existingStatus && <> · {docCheck.existingStatus.replace(/_/g, " ")}</>}
                            </span>
                          )}
                        </p>
                      )}
                      <div className="flex gap-3 pt-0.5">
                        {onOpenDocument && docCheck.existingDocumentId && (
                          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                            onClick={() => { onOpenDocument(docCheck.existingDocumentId!); handleClose(); }}>
                            <ExternalLink className="h-3.5 w-3.5" /> Open Document
                          </button>
                        )}
                        {onUploadRevision && docCheck.existingDocumentId && (
                          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                            onClick={() => {
                              onUploadRevision({ id: docCheck.existingDocumentId!, documentNumber: docNumber, title: docCheck.existingTitle ?? "", revision: docCheck.existingRevision });
                              handleClose();
                            }}>
                            <FilePlus2 className="h-3.5 w-3.5" /> Upload New Revision
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {docNumber && docCheck.available === true && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                      <Check className="h-3.5 w-3.5 shrink-0" /> No document found — a new document will be created
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium">Issued By</Label>
                  <Input value={issuedBy} onChange={e => setIssuedBy(e.target.value)} placeholder="E.g. ABC Engineering" className="mt-1" disabled={isSaving} />
                </div>
              </div>
            </div>

            {/* ── Section 3: Classification ─────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">3</div>
                <p className="text-sm font-semibold">Classification</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">Discipline</Label>
                  <Input value={discipline} onChange={e => setDiscipline(e.target.value)} placeholder="E.g. Structural" className="mt-1" disabled={isSaving} />
                </div>
                <div>
                  <Label className="text-sm font-medium">Document Type</Label>
                  <Select value={docType} onValueChange={v => { setDocType(v); setCustomFields({}); }} disabled={isSaving}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {docTypeOptions.map(t => (
                        <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>
                      ))}
                      {docType && !docTypeOptions.some(t => t.code === docType) && (
                        <SelectItem value={docType}>{docType}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Status</Label>
                  <Select value={status} onValueChange={setStatus} disabled={isSaving}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Revision</Label>
                  <Input value={revision} onChange={e => setRevision(e.target.value)} placeholder="01" className="mt-1 font-mono" disabled={isSaving} />
                </div>
                <div>
                  <Label className="text-sm font-medium">Source</Label>
                  <Select value={source || "_none"} onValueChange={v => setSource(v === "_none" ? "" : v)} disabled={isSaving}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— None —</SelectItem>
                      {SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Metadata fields for the selected document type */}
              {resolvedDocTypeId != null && (
                <div className="mt-4">
                  <MetadataFieldsForm
                    documentTypeId={resolvedDocTypeId}
                    value={customFields}
                    onChange={setCustomFields}
                    disabled={isSaving}
                    className="pt-3 border-t"
                  />
                </div>
              )}
            </div>

          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || !uploadedFile || isDuplicate}>
            {isSaving
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</>
              : isDuplicate
                ? <><AlertCircle className="h-3.5 w-3.5 mr-1.5" /> Document number already exists</>
                : <><Upload className="h-3.5 w-3.5 mr-1.5" /> Save Document</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

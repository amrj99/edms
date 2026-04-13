import { useState } from "react";
import {
  Brain, Sparkles, Loader2, CheckCircle2, BookOpen, Tag, ChevronRight, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DocumentProcedureSuggestion {
  suggestedDocumentNumber: string;
  numberingReason: string;
  suggestedClassification: string;
  suggestedDiscipline: string;
  suggestedTitle?: string;
  suggestedRevision: string;
  requiredMetadata: Array<{ field: string; description: string; required: boolean }>;
  namingConvention: string;
  procedureNotes: string;
  confidence: number;
}

interface AIProcedurePanelProps {
  projectId?: number;
  projectCode?: string;
  projectName?: string;
  discipline?: string;
  documentType?: string;
  partialTitle?: string;
  onApply: (suggestion: Partial<{
    documentNumber: string;
    discipline: string;
    documentType: string;
    revision: string;
    title: string;
  }>) => void;
  className?: string;
}

export function AIProcedurePanel({
  projectId,
  projectCode,
  projectName,
  discipline,
  documentType,
  partialTitle,
  onApply,
  className,
}: AIProcedurePanelProps) {
  const [suggestion, setSuggestion] = useState<DocumentProcedureSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [applied, setApplied] = useState(false);
  const { toast } = useToast();

  const getSuggestion = async () => {
    setIsLoading(true);
    setApplied(false);
    try {
      const res = await fetch("/api/ai/documents/suggest-procedure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, projectCode, projectName, discipline, documentType, partialTitle }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "AI suggestion failed");
      }
      const data: DocumentProcedureSuggestion = await res.json();
      setSuggestion(data);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "AI Procedure Failed",
        description: err.message || "Could not generate document procedure suggestion",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const apply = () => {
    if (!suggestion) return;
    onApply({
      documentNumber: suggestion.suggestedDocumentNumber,
      discipline: suggestion.suggestedDiscipline,
      documentType: suggestion.suggestedClassification,
      revision: suggestion.suggestedRevision,
      title: suggestion.suggestedTitle,
    });
    setApplied(true);
    toast({
      title: "AI Procedure Applied",
      description: "Document number, discipline, and revision have been pre-filled.",
    });
  };

  return (
    <div className={cn("rounded-xl border border-dashed border-primary/40 bg-primary/[0.02] overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-primary">AI Document Procedure</span>
          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Optional</Badge>
        </div>
        {!suggestion && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs border-primary/30 text-primary hover:bg-primary/5"
            onClick={getSuggestion}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {isLoading ? "Generating..." : "Suggest Procedure"}
          </Button>
        )}
        {suggestion && !applied && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={getSuggestion} disabled={isLoading}>
              Refresh
            </Button>
            <Button size="sm" className="gap-1.5 h-7 text-xs" onClick={apply}>
              <CheckCircle2 className="h-3 w-3" />
              Apply AI Procedure
            </Button>
          </div>
        )}
        {applied && (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Applied
          </Badge>
        )}
      </div>

      {!suggestion && !isLoading && (
        <div className="px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-primary/60" />
          <span>
            Click "Suggest Procedure" to get AI-powered document numbering, classification, and
            naming convention recommendations based on your project and discipline.
          </span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Analyzing project context and generating suggestions...</span>
        </div>
      )}

      {suggestion && (
        <div className="p-4 space-y-3">
          {/* Primary suggestion */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-primary/5 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Suggested Number</p>
              <p className="font-mono font-bold text-primary">{suggestion.suggestedDocumentNumber}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Revision</p>
              <p className="font-mono font-semibold">{suggestion.suggestedRevision}</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Type:</span>
              <Badge variant="secondary" className="text-xs">{suggestion.suggestedClassification}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Discipline:</span>
              <Badge variant="outline" className="text-xs">{suggestion.suggestedDiscipline}</Badge>
            </div>
            {suggestion.confidence && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Confidence:</span>
                <span className="text-xs font-semibold">{Math.round(suggestion.confidence * 100)}%</span>
              </div>
            )}
          </div>

          {/* Naming convention */}
          <div className="flex items-start gap-2 text-xs bg-muted/30 rounded-lg p-2.5">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-foreground mb-0.5">Naming Convention</p>
              <p className="text-muted-foreground">{suggestion.namingConvention}</p>
            </div>
          </div>

          {/* Required metadata */}
          {suggestion.requiredMetadata?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <Tag className="h-3 w-3" /> Required Metadata Fields
              </p>
              <div className="space-y-1">
                {suggestion.requiredMetadata.slice(0, 4).map((m, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <ChevronRight className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">{m.field}</span>
                      {m.required && <span className="text-red-500 ml-0.5">*</span>}
                      <span className="text-muted-foreground ml-1">— {m.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Procedure notes */}
          {suggestion.procedureNotes && (
            <div className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">
              {suggestion.procedureNotes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

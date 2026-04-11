import { useState, useRef } from "react";
import { Sparkles, Loader2, Search, ArrowRight, Lightbulb, X, Calendar, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface NLSearchResult {
  query: string;
  interpretation: string;
  type: "document" | "correspondence" | "task" | "all";
  discipline?: string;
  status?: string;
  documentType?: string;
  keywords: string[];
  suggestions: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  projectName?: string | null;
}

interface AISearchBarProps {
  onSearch: (params: {
    q: string;
    type?: string;
    discipline?: string;
    status?: string;
    documentType?: string;
    aiInterpretation?: string;
    dateFrom?: string;
    dateTo?: string;
    projectName?: string;
  }) => void;
  className?: string;
}

const EXAMPLE_QUERIES = [
  "Show me all approved electrical drawings",
  "Find overdue RFIs from last month",
  "High priority structural reports under review",
  "All transmittals from the Riyadh project this week",
];

export function AISearchBar({ onSearch, className }: AISearchBarProps) {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<NLSearchResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/ai/search/natural", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        onSearch({ q: query, aiInterpretation: undefined });
        return;
      }

      const data: NLSearchResult = await res.json();
      setResult(data);
      setIsExpanded(true);

      onSearch({
        q: data.query || query,
        type: data.type !== "all" ? data.type : undefined,
        discipline: data.discipline ?? undefined,
        status: data.status ?? undefined,
        documentType: data.documentType ?? undefined,
        aiInterpretation: data.interpretation,
        dateFrom: data.dateFrom ?? undefined,
        dateTo: data.dateTo ?? undefined,
        projectName: data.projectName ?? undefined,
      });
    } catch {
      onSearch({ q: query });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const applySuggestion = (suggestion: string) => {
    setQuery(suggestion);
    inputRef.current?.focus();
  };

  const clear = () => {
    setQuery("");
    setResult(null);
    setIsExpanded(false);
    onSearch({ q: "" });
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return iso;
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Search bar */}
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask in plain English — e.g., 'Find approved electrical drawings from last month'"
            className="pl-9 pr-9 h-11 bg-primary/5 border-primary/20 focus:border-primary placeholder:text-muted-foreground/60"
          />
          {query && (
            <button
              onClick={clear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          onClick={handleSearch}
          disabled={isLoading || !query.trim()}
          className="h-11 gap-2"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </Button>
      </div>

      {/* AI interpretation result */}
      {result && isExpanded && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground font-medium">
                {result.interpretation}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {result.type && result.type !== "all" && (
                  <Badge variant="secondary" className="text-xs capitalize">{result.type}s</Badge>
                )}
                {result.discipline && (
                  <Badge variant="outline" className="text-xs">{result.discipline}</Badge>
                )}
                {result.status && (
                  <Badge variant="outline" className="text-xs capitalize">{result.status.replace(/_/g, " ")}</Badge>
                )}
                {result.projectName && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <FolderOpen className="h-3 w-3" />
                    {result.projectName}
                  </Badge>
                )}
                {(result.dateFrom || result.dateTo) && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Calendar className="h-3 w-3" />
                    {result.dateFrom && result.dateTo
                      ? `${formatDate(result.dateFrom)} – ${formatDate(result.dateTo)}`
                      : result.dateFrom
                        ? `From ${formatDate(result.dateFrom)}`
                        : `Until ${formatDate(result.dateTo!)}`}
                  </Badge>
                )}
                {result.keywords?.map((kw) => (
                  <Badge key={kw} variant="ghost" className="text-xs text-muted-foreground">{kw}</Badge>
                ))}
              </div>
            </div>
            <button onClick={() => setIsExpanded(false)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {result.suggestions?.length > 0 && (
            <div className="pt-1 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <Lightbulb className="h-3 w-3" /> Related searches:
              </p>
              <div className="flex flex-wrap gap-2">
                {result.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => applySuggestion(s)}
                    className="text-xs text-primary hover:underline flex items-center gap-0.5"
                  >
                    <ArrowRight className="h-3 w-3" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Example queries (shown when no query) */}
      {!query && !result && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => { setQuery(q); inputRef.current?.focus(); }}
              className="text-xs text-muted-foreground border border-border/50 rounded-full px-2.5 py-1 hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

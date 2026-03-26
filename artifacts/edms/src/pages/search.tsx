import { useState } from "react";
import { useSearch } from "@workspace/api-client-react";
import { FileText, Mail, Loader2, Sparkles, Search as SearchIcon } from "lucide-react";
import { Link } from "wouter";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AISearchBar } from "@/components/ai/AISearchBar";

interface SearchParams {
  q: string;
  type?: string;
  discipline?: string;
  status?: string;
  documentType?: string;
  aiInterpretation?: string;
}

export default function Search() {
  const [searchParams, setSearchParams] = useState<SearchParams>({ q: "" });
  const [mode, setMode] = useState<"ai" | "keyword">("ai");

  const { data, isLoading } = useSearch(
    {
      q: searchParams.q,
      type: (searchParams.type as any) || "all",
      discipline: searchParams.discipline,
      status: searchParams.status,
    },
    { query: { enabled: searchParams.q.length > 0 } }
  );

  const handleAISearch = (params: SearchParams) => {
    setSearchParams(params);
  };

  const handleKeywordSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const q = fd.get("q") as string;
    if (q?.trim()) setSearchParams({ q: q.trim() });
  };

  return (
    <div className="space-y-6 animate-in fade-in max-w-4xl mx-auto">
      <div className="text-center py-8">
        <h1 className="text-4xl font-display font-bold tracking-tight mb-2">Search</h1>
        <p className="text-muted-foreground mb-6">Search across all documents, correspondence, and metadata.</p>

        {/* Mode toggle */}
        <div className="flex justify-center mb-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "ai" | "keyword")}>
            <TabsList>
              <TabsTrigger value="ai" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                AI Search
              </TabsTrigger>
              <TabsTrigger value="keyword" className="gap-1.5">
                <SearchIcon className="h-3.5 w-3.5" />
                Keyword
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* AI Search */}
        {mode === "ai" ? (
          <div className="max-w-2xl mx-auto">
            <AISearchBar onSearch={handleAISearch} />
          </div>
        ) : (
          <form onSubmit={handleKeywordSearch} className="flex max-w-2xl mx-auto gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                name="q"
                defaultValue={searchParams.q}
                placeholder="Search by document number, title, or keywords..."
                className="h-14 w-full pl-12 text-lg rounded-xl border border-input bg-background px-3 py-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              type="submit"
              className="h-14 px-8 rounded-xl text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Search
            </button>
          </form>
        )}
      </div>

      {/* AI interpretation notice */}
      {searchParams.aiInterpretation && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-primary/5 border border-primary/20 rounded-lg px-4 py-2">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <span>AI interpreted: <span className="font-medium text-foreground">{searchParams.aiInterpretation}</span></span>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <p className="text-sm font-medium text-muted-foreground">
            Found {data.total} results
            {searchParams.q && <> for "<span className="text-foreground font-semibold">{searchParams.q}</span>"</>}
          </p>

          {data.documents.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Documents
                <Badge variant="secondary">{data.documents.length}</Badge>
              </h2>
              <div className="grid gap-3">
                {data.documents.map(doc => (
                  <Link key={doc.id} href={`/projects/${doc.projectId}/documents/${doc.id}`}>
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono font-bold bg-muted px-2 py-0.5 rounded">{doc.documentNumber}</span>
                            <Badge variant="outline" className="text-[10px] uppercase">{doc.status}</Badge>
                            {doc.discipline && (
                              <Badge variant="ghost" className="text-[10px]">{doc.discipline}</Badge>
                            )}
                          </div>
                          <h3 className="font-medium text-foreground">{doc.title}</h3>
                        </div>
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.correspondence.length > 0 && (
            <div className="space-y-4 mt-8">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" /> Correspondence
                <Badge variant="secondary">{data.correspondence.length}</Badge>
              </h2>
              <div className="grid gap-3">
                {data.correspondence.map(msg => (
                  <Link key={msg.id} href={`/projects/${msg.projectId}/correspondence/${msg.id}`}>
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="secondary" className="text-[10px] uppercase">{msg.type}</Badge>
                            <span className="text-xs text-muted-foreground">From: {msg.fromUserName}</span>
                          </div>
                          <h3 className="font-medium text-foreground">{msg.subject}</h3>
                        </div>
                        <Mail className="h-5 w-5 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.total === 0 && searchParams.q && (
            <div className="text-center py-24 bg-card border rounded-xl border-dashed">
              <SearchIcon className="mx-auto h-12 w-12 text-muted-foreground opacity-30 mb-4" />
              <h3 className="text-lg font-medium">No results found</h3>
              <p className="text-muted-foreground mt-1">
                {mode === "ai"
                  ? "Try rephrasing your question or switch to keyword search."
                  : "Try adjusting your search terms or switch to AI Search."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

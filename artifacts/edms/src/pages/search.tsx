import { useState } from "react";
import { useSearch } from "@workspace/api-client-react";
import { Search as SearchIcon, FileText, Mail, Loader2 } from "lucide-react";
import { Link } from "wouter";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Search() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const { data, isLoading } = useSearch(
    { q: submittedQuery, type: "all" },
    { query: { enabled: submittedQuery.length > 0 } }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setSubmittedQuery(query.trim());
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in max-w-4xl mx-auto">
      <div className="text-center py-12">
        <h1 className="text-4xl font-display font-bold tracking-tight mb-4">Global Search</h1>
        <p className="text-muted-foreground mb-8">Search across all documents, correspondence, and metadata.</p>
        
        <form onSubmit={handleSearch} className="flex max-w-2xl mx-auto gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by document number, title, or keywords..." 
              className="h-14 pl-12 text-lg rounded-xl shadow-sm focus-visible:ring-primary/20"
            />
          </div>
          <Button type="submit" className="h-14 px-8 rounded-xl text-base font-semibold">
            Search
          </Button>
        </form>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <p className="text-sm font-medium text-muted-foreground">
            Found {data.total} results for "{data.query}"
          </p>

          {data.documents.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Documents
              </h2>
              <div className="grid gap-3">
                {data.documents.map(doc => (
                  <Link key={doc.id} href={`/projects/${doc.projectId}/documents/${doc.id}`}>
                    <Card className="hover:border-primary/50 transition-colors">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono font-bold bg-muted px-2 py-0.5 rounded">{doc.documentNumber}</span>
                            <Badge variant="outline" className="text-[10px] uppercase">{doc.status}</Badge>
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
              </h2>
              <div className="grid gap-3">
                {data.correspondence.map(msg => (
                  <Link key={msg.id} href={`/projects/${msg.projectId}/correspondence/${msg.id}`}>
                    <Card className="hover:border-primary/50 transition-colors">
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
          
          {data.total === 0 && (
            <div className="text-center py-24 bg-card border rounded-xl border-dashed">
              <div className="flex justify-center mb-4">
                <img src={`${import.meta.env.BASE_URL}images/empty-state.png`} alt="Empty results" className="h-32 w-32 opacity-50 mix-blend-multiply" />
              </div>
              <h3 className="text-lg font-medium">No results found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search terms or filters.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

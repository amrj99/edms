import { useListMetadataFields } from "@workspace/api-client-react";
import { Settings as SettingsIcon, Database, Link as LinkIcon, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Settings() {
  const { data, isLoading } = useListMetadataFields();

  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
        <p className="text-muted-foreground mt-1">Configure workspace preferences and custom metadata.</p>
      </div>

      <Tabs defaultValue="metadata" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-[400px]">
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>
        
        <TabsContent value="metadata" className="mt-6">
          <Card className="shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5 text-primary" /> Custom Metadata Fields</CardTitle>
              <CardDescription>Define custom properties required across documents and correspondence.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : !data?.fields?.length ? (
                <div className="text-center py-8 text-muted-foreground">No custom metadata fields defined.</div>
              ) : (
                <div className="space-y-4">
                  {data.fields.map(field => (
                    <div key={field.id} className="flex items-center justify-between p-4 border rounded-lg hover:border-primary/30 transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{field.label}</span>
                          {field.required && <Badge variant="destructive" className="text-[10px] h-4 px-1">Required</Badge>}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                          <span className="font-mono text-xs bg-muted px-1 rounded">{field.name}</span>
                          <span>•</span>
                          <span className="capitalize">{field.fieldType}</span>
                          <span>•</span>
                          <span>Applies to: <span className="capitalize">{field.appliesTo}</span></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="mt-6">
          <Card className="shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><SettingsIcon className="h-5 w-5 text-primary" /> Workspace Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">General configuration options will appear here.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-6">
          <Card className="shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><LinkIcon className="h-5 w-5 text-primary" /> Integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Connect EDMS to external tools and ERPs.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

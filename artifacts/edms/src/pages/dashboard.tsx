import { useGetDashboard } from "@workspace/api-client-react";
import { Link } from "wouter";
import { 
  FileText, 
  ClipboardCheck, 
  Mail, 
  CheckSquare, 
  ArrowRight,
  Loader2,
  Clock,
  AlertCircle
} from "lucide-react";
import { format } from "date-fns";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data, isLoading, error } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-bold">Failed to load dashboard</h2>
        <p className="text-muted-foreground mt-2">There was a problem loading your overview.</p>
      </div>
    );
  }

  const { stats, recentDocuments, pendingApprovals, myTasks, unreadCorrespondence } = data;

  const statCards = [
    { title: "Total Documents", value: stats.totalDocuments, icon: FileText, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10" },
    { title: "Pending Approvals", value: stats.pendingApprovals, icon: ClipboardCheck, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-500/10" },
    { title: "Open Tasks", value: stats.openTasks, icon: CheckSquare, color: "text-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-500/10" },
    { title: "Unread Mail", value: stats.unreadCorrespondence, icon: Mail, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-500/10" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Overview</h1>
        <p className="text-muted-foreground mt-1">Here's what's happening across your projects today.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat, i) => (
          <Card key={i} className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
              </div>
              <div className={`h-12 w-12 rounded-xl ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Documents */}
        <Card className="lg:col-span-4 border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Recent Documents</CardTitle>
              <CardDescription>Latest documents uploaded to your projects.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/search?type=document">View all <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentDocuments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No recent documents.</div>
              ) : (
                recentDocuments.map(doc => (
                  <Link key={doc.id} href={`/projects/${doc.projectId}/documents/${doc.id}`} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center text-primary font-medium text-xs">
                        {doc.documentType || 'DOC'}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground line-clamp-1">{doc.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <span>{doc.documentNumber}</span>
                          <span>•</span>
                          <span>Rev {doc.revision}</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant={doc.status === 'approved' ? 'default' : 'secondary'} className="capitalize">
                      {doc.status.replace('_', ' ')}
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tasks & Approvals Column */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">My Pending Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {myTasks.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">All caught up!</div>
                ) : (
                  myTasks.slice(0, 5).map(task => (
                    <div key={task.id} className="flex items-start gap-3 group">
                      <div className="mt-0.5">
                        <CheckSquare className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Link href={`/tasks`} className="font-medium text-sm hover:underline">{task.title}</Link>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {task.dueDate && (
                            <span className="flex items-center gap-1 text-orange-500">
                              <Clock className="h-3 w-3" />
                              {format(new Date(task.dueDate), 'MMM d')}
                            </span>
                          )}
                          <span>{task.projectName}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Unread Correspondence</CardTitle>
              <Badge variant="destructive">{unreadCorrespondence.length}</Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {unreadCorrespondence.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">Inbox is empty.</div>
                ) : (
                  unreadCorrespondence.slice(0, 4).map(msg => (
                    <Link key={msg.id} href={`/projects/${msg.projectId}/correspondence/${msg.id}`} className="block border-b border-border/50 last:border-0 pb-3 last:pb-0 group">
                      <p className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-1">{msg.subject}</p>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-muted-foreground">{msg.fromUserName}</span>
                        <span className="text-xs text-muted-foreground uppercase">{msg.type}</span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

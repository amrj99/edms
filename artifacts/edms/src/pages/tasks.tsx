import { useListTasks } from "@workspace/api-client-react";
import { CheckSquare, Clock, AlertCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Tasks() {
  const { data, isLoading } = useListTasks({ assignedToMe: true });

  const getPriorityColor = (priority: string) => {
    switch(priority) {
      case 'urgent': return 'text-red-500 bg-red-50 dark:bg-red-500/10';
      case 'high': return 'text-orange-500 bg-orange-50 dark:bg-orange-500/10';
      case 'medium': return 'text-blue-500 bg-blue-50 dark:bg-blue-500/10';
      default: return 'text-slate-500 bg-slate-50 dark:bg-slate-500/10';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Tasks</h1>
        <p className="text-muted-foreground mt-1">Manage your assigned workflows, reviews, and actions.</p>
      </div>

      <div className="flex gap-4 border-b pb-4">
        <Badge variant="secondary" className="px-4 py-1 text-sm bg-primary text-primary-foreground hover:bg-primary">All Active</Badge>
        <Badge variant="outline" className="px-4 py-1 text-sm">Pending Review</Badge>
        <Badge variant="outline" className="px-4 py-1 text-sm">Action Required</Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !data?.tasks?.length ? (
        <div className="text-center py-24 bg-card border rounded-xl">
          <CheckSquare className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">You're all caught up!</h3>
          <p className="text-muted-foreground">No pending tasks assigned to you.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {data.tasks.map(task => (
            <Card key={task.id} className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-5 flex items-center gap-4">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${getPriorityColor(task.priority)}`}>
                  {task.priority === 'urgent' ? <AlertCircle className="h-5 w-5" /> : <CheckSquare className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{task.projectName}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground capitalize">{task.sourceType}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground truncate">{task.title}</h3>
                  {task.description && <p className="text-sm text-muted-foreground truncate mt-1">{task.description}</p>}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Badge variant="outline" className="capitalize">{task.status.replace('_', ' ')}</Badge>
                  {task.dueDate && (
                    <div className="flex items-center text-xs font-medium text-orange-600 dark:text-orange-400">
                      <Clock className="mr-1 h-3 w-3" />
                      Due {format(new Date(task.dueDate), 'MMM d, yyyy')}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { AppLayout } from "@/components/layout/AppLayout";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { OrgContextProvider } from "@/lib/org-context";
import { useModules, type OrgModules } from "@/hooks/use-modules";
import { ShieldOff } from "lucide-react";

// Pages
import Login from "@/pages/login";
import Register from "@/pages/register";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Dashboard from "@/pages/dashboard";
import Organizations from "@/pages/organizations";
import Projects from "@/pages/projects";
import ProjectDetail from "@/pages/project-detail";
import Tasks from "@/pages/tasks";
import Search from "@/pages/search";
import Users from "@/pages/users";
import Settings from "@/pages/settings";
import AISettings from "@/pages/ai-settings";
import General from "@/pages/general";
import Config from "@/pages/config";
import Reports from "@/pages/reports";
import Admin from "@/pages/admin";
import CorrespondencePage from "@/pages/correspondence";
import DocumentsPage from "@/pages/documents";
import DocumentDetailPage from "@/pages/document-detail";
import DeliverablesPage from "@/pages/deliverables";
import ActivityLogPage from "@/pages/activity-log";
import ProfilePage from "@/pages/profile";
import MeetingsPage from "@/pages/meetings";
import ActionItemsPage from "@/pages/action-items";
import ReportsDashboard from "@/pages/reports-dashboard";
import ChatPage from "@/pages/chat";
import CalendarPage from "@/pages/calendar";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ModuleDisabledPlaceholder() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <div className="rounded-full bg-muted p-6">
        <ShieldOff className="h-10 w-10 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">{t("moduleNotAvailable")}</h2>
      <p className="text-sm text-muted-foreground max-w-sm">{t("moduleNotAvailableDesc")}</p>
      <button
        onClick={() => navigate("/")}
        className="mt-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        {t("goHome")}
      </button>
    </div>
  );
}

function ModuleGuard({ moduleKey, component: Component }: { moduleKey: keyof OrgModules; component: React.ComponentType }) {
  const { modules, isLoading } = useModules();
  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }
  if (!modules[moduleKey]) {
    return (
      <AppLayout>
        <ModuleDisabledPlaceholder />
      </AppLayout>
    );
  }
  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />

      {/* Protected Routes wrapped in AppLayout */}
      <Route path="/">
        <ModuleGuard moduleKey="dashboard" component={Dashboard} />
      </Route>
      <Route path="/organizations">
        <ProtectedRoute component={Organizations} />
      </Route>
      <Route path="/projects">
        <ProtectedRoute component={Projects} />
      </Route>
      <Route path="/projects/:id">
        <ProtectedRoute component={ProjectDetail} />
      </Route>
      <Route path="/tasks">
        <ProtectedRoute component={Tasks} />
      </Route>
      <Route path="/search">
        <ProtectedRoute component={Search} />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={Users} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} />
      </Route>
      <Route path="/ai-settings">
        <ProtectedRoute component={AISettings} />
      </Route>
      <Route path="/general">
        <ProtectedRoute component={General} />
      </Route>
      <Route path="/config">
        <ProtectedRoute component={Config} />
      </Route>
      <Route path="/reports">
        <ModuleGuard moduleKey="registers" component={Reports} />
      </Route>
      <Route path="/admin">
        <ProtectedRoute component={Admin} />
      </Route>
      <Route path="/correspondence">
        <ProtectedRoute component={CorrespondencePage} />
      </Route>
      <Route path="/documents">
        <ProtectedRoute component={DocumentsPage} />
      </Route>
      <Route path="/documents/:id">
        <ProtectedRoute component={DocumentDetailPage} />
      </Route>
      <Route path="/deliverables">
        <ModuleGuard moduleKey="deliverables" component={DeliverablesPage} />
      </Route>
      <Route path="/activity-log">
        <ProtectedRoute component={ActivityLogPage} />
      </Route>
      <Route path="/profile">
        <ProtectedRoute component={ProfilePage} />
      </Route>
      <Route path="/meetings">
        <ProtectedRoute component={MeetingsPage} />
      </Route>
      <Route path="/action-items">
        <ProtectedRoute component={ActionItemsPage} />
      </Route>
      <Route path="/reports-dashboard">
        <ProtectedRoute component={ReportsDashboard} />
      </Route>
      <Route path="/chat">
        <ProtectedRoute component={ChatPage} />
      </Route>
      <Route path="/calendar">
        <ProtectedRoute component={CalendarPage} />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <I18nProvider>
      <ThemeProvider defaultTheme="system" storageKey="edms-theme">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <OrgContextProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AuthProvider>
                  <Router />
                </AuthProvider>
              </WouterRouter>
            </OrgContextProvider>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

export default App;

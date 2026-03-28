import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { AppLayout } from "@/components/layout/AppLayout";
import { I18nProvider } from "@/lib/i18n";

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

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
        <ProtectedRoute component={Dashboard} />
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
        <ProtectedRoute component={Reports} />
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
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthProvider>
                <Router />
              </AuthProvider>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

export default App;

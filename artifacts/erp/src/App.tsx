import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { AppShell, RoleGate } from '@/components/layout';
import LoginRequired from '@/pages/login-required';
import DashboardPage from '@/pages/dashboard';
import UsersPage from '@/pages/system/users';
import DepartmentsPage from '@/pages/system/departments';
import MenuPermissionsPage from '@/pages/system/menu-permissions';
import AuditLogsPage from '@/pages/system/audit-logs';
import { useErpAuth } from '@/hooks/use-erp-auth';
import { Loader2 } from 'lucide-react';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center space-y-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">此頁面不存在</p>
    </div>
  );
}

function RouterContent() {
  const { isLoading, isBlocked } = useErpAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login-required" component={LoginRequired} />
      
      {/* Shell routes */}
      <Route>
        {isBlocked ? (
          <LoginRequired />
        ) : (
          <AppShell>
            <RoleGate>
              <Switch>
                <Route path="/" component={DashboardPage} />
                <Route path="/system/users" component={UsersPage} />
                <Route path="/system/departments" component={DepartmentsPage} />
                <Route path="/system/menu-permissions" component={MenuPermissionsPage} />
                <Route path="/system/audit-logs" component={AuditLogsPage} />
                <Route component={NotFound} />
              </Switch>
            </RoleGate>
          </AppShell>
        )}
      </Route>
    </Switch>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <RouterContent />
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

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
import ItemsPage from '@/pages/inventory/items';
import WarehousesPage from '@/pages/inventory/warehouses';
import MovementsPage from '@/pages/inventory/movements';
import TransfersPage from '@/pages/inventory/transfers';
import QuotationsPage from '@/pages/sales/quotations';
import SalesOrdersPage from '@/pages/sales/orders';
import SalesReturnsPage from '@/pages/sales/returns';
import PriceListsPage from '@/pages/sales/price-lists';
import PurchaseOrdersPage from '@/pages/purchasing/orders';
import ReceivingPage from '@/pages/purchasing/receiving';
import PurchaseReturnsPage from '@/pages/purchasing/returns';
import CustomersPage from '@/pages/partners/customers';
import SuppliersPage from '@/pages/partners/suppliers';
import DepartmentsPage from '@/pages/system/departments';
import MenuPermissionsPage from '@/pages/system/menu-permissions';
import AuditLogsPage from '@/pages/system/audit-logs';
import AccountsPage from '@/pages/accounting/accounts';
import JournalPage from '@/pages/accounting/journal';
import InvoicesPage from '@/pages/accounting/invoices';
import VouchersPage from '@/pages/accounting/vouchers';
import PaymentRequestsPage from '@/pages/accounting/payment-requests';
import BankReconciliationPage from '@/pages/accounting/bank-reconciliation';
import VatReportPage from '@/pages/accounting/vat-report';
import FinancialReportsPage from '@/pages/reports/financial';
import AgingReportPage from '@/pages/reports/aging';
import AnalysisReportPage from '@/pages/reports/analysis';
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
                <Route path="/inventory/items" component={ItemsPage} />
                <Route path="/inventory/warehouses" component={WarehousesPage} />
                <Route path="/inventory/movements" component={MovementsPage} />
                <Route path="/inventory/transfers" component={TransfersPage} />
                <Route path="/sales/quotations" component={QuotationsPage} />
                <Route path="/sales/orders" component={SalesOrdersPage} />
                <Route path="/sales/returns" component={SalesReturnsPage} />
                <Route path="/sales/price-lists" component={PriceListsPage} />
                <Route path="/purchasing/orders" component={PurchaseOrdersPage} />
                <Route path="/purchasing/receiving" component={ReceivingPage} />
                <Route path="/purchasing/returns" component={PurchaseReturnsPage} />
                <Route path="/partners/customers" component={CustomersPage} />
                <Route path="/partners/suppliers" component={SuppliersPage} />
                <Route path="/accounting/accounts" component={AccountsPage} />
                <Route path="/accounting/journal" component={JournalPage} />
                <Route path="/accounting/invoices" component={InvoicesPage} />
                <Route path="/accounting/vouchers" component={VouchersPage} />
                <Route path="/accounting/payment-requests" component={PaymentRequestsPage} />
                <Route path="/accounting/bank-reconciliation" component={BankReconciliationPage} />
                <Route path="/accounting/vat-report" component={VatReportPage} />
                <Route path="/reports/financial" component={FinancialReportsPage} />
                <Route path="/reports/aging" component={AgingReportPage} />
                <Route path="/reports/analysis" component={AnalysisReportPage} />
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

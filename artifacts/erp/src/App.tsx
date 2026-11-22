import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/error-boundary";
import { installAutoRefresh } from "@/lib/auto-refresh";
import { ChangeReasonHost, installChangeApprovalFetch } from "@/components/accounting/change-reason-host";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import { lazy, Suspense, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { RoleGate } from "@/components/auth/role-gate";
import { HR_ROLES, PAYROLL_ROLES, FINANCE_ROLES, SYSTEM_ADMIN_ROLES, ROLE_EMPLOYEE, EMPLOYEE_ALLOWED_PATHS } from "@/lib/roles";
import { Loader2, Ban } from "lucide-react";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";

const LoginPage = lazy(() => import("@/pages/auth/login"));
const SignupPage = lazy(() => import("@/pages/auth/signup"));
const ForgotPasswordPage = lazy(() => import("@/pages/auth/forgot-password"));
const ResetPasswordPage = lazy(() => import("@/pages/auth/reset-password"));
const VerifyRecoveryEmailPage = lazy(() => import("@/pages/auth/verify-recovery-email"));
const AccountSecurityPage = lazy(() => import("@/pages/account/security"));
const PlatformTenants = lazy(() => import("@/pages/system/platform-tenants"));
const EmailSettings = lazy(() => import("@/pages/system/email-settings"));
const IntegrationKeys = lazy(() => import("@/pages/system/integration-keys"));

const ExecutiveCockpit = lazy(() => import("@/pages/bi/executive"));
const SalesBI = lazy(() => import("@/pages/bi/sales"));
const InventoryBI = lazy(() => import("@/pages/bi/inventory"));
const HrBI = lazy(() => import("@/pages/bi/hr"));
const ObservabilityBI = lazy(() => import("@/pages/bi/observability"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

// 任何寫入操作（新增/編輯/停用/刪除）成功後，自動讓所有畫面重新載入資料
installAutoRefresh(queryClient);
installChangeApprovalFetch();

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Employees = lazy(() => import("@/pages/hr/employees"));
const Teachers = lazy(() => import("@/pages/hr/teachers"));
const Departments = lazy(() => import("@/pages/hr/departments"));
const DeptFinancials = lazy(() => import("@/pages/hr/dept-financials"));
const Attendance = lazy(() => import("@/pages/hr/attendance"));
const Leaves = lazy(() => import("@/pages/hr/leaves"));
const Customers = lazy(() => import("@/pages/sales/customers"));
const SalesOrders = lazy(() => import("@/pages/sales/orders"));
const SalesOrderDetail = lazy(() => import("@/pages/sales/order-detail"));
const SalesInvoices = lazy(() => import("@/pages/sales/invoices"));
const Quotations = lazy(() => import("@/pages/sales/quotations"));
const QuickEntry = lazy(() => import("@/pages/sales/quick-entry"));
const OrderTemplates = lazy(() => import("@/pages/sales/order-templates"));
const QuotationTemplates = lazy(() => import("@/pages/sales/quotation-templates"));
const Suppliers = lazy(() => import("@/pages/purchasing/suppliers"));
const PurchaseOrders = lazy(() => import("@/pages/purchasing/orders"));
const PurchaseOrderDetail = lazy(() => import("@/pages/purchasing/order-detail"));
const PurchaseInvoices = lazy(() => import("@/pages/purchasing/invoices"));
const Items = lazy(() => import("@/pages/inventory/items"));
const InventoryLookup = lazy(() => import("@/pages/inventory/lookup"));
const ItemCategories = lazy(() => import("@/pages/inventory/categories"));
const ItemTypes = lazy(() => import("@/pages/inventory/types"));
const Warehouses = lazy(() => import("@/pages/inventory/warehouses"));
const StockEntries = lazy(() => import("@/pages/inventory/stock-entries"));
const Projects = lazy(() => import("@/pages/projects/projects"));
const Tasks = lazy(() => import("@/pages/projects/tasks"));
const ProjectFinancials = lazy(() => import("@/pages/projects/financials"));
const Accounts = lazy(() => import("@/pages/accounting/accounts"));
const JournalEntries = lazy(() => import("@/pages/accounting/journal"));
const AllInvoices = lazy(() => import("@/pages/accounting/invoices"));
const VatReport = lazy(() => import("@/pages/accounting/vat-report"));
const ClockIn = lazy(() => import("@/pages/hr/clock-in"));

const MySpace = lazy(() => import("@/pages/hr/my-space"));
const MyRequests = lazy(() => import("@/pages/hr/my-requests"));
const HrContracts = lazy(() => import("@/pages/hr/hr-contracts"));
const SalaryCalc = lazy(() => import("@/pages/hr/salary-calc"));
const SalarySlips = lazy(() => import("@/pages/hr/salary-slips"));
const ServiceFees = lazy(() => import("@/pages/hr/service-fees"));
const SalaryComponents = lazy(() => import("@/pages/hr/salary-components"));
const PaymentTerms = lazy(() => import("@/pages/accounting/payment-terms"));
const StockCounts = lazy(() => import("@/pages/inventory/stock-counts"));
const Timesheets = lazy(() => import("@/pages/hr/timesheets"));
const Dunning = lazy(() => import("@/pages/accounting/dunning"));
const Advances = lazy(() => import("@/pages/accounting/advances"));
const Receivables = lazy(() => import("@/pages/accounting/receivables"));
const Rfqs = lazy(() => import("@/pages/purchasing/rfqs"));
const RecurringInvoices = lazy(() => import("@/pages/accounting/recurring-invoices"));
const Budgets = lazy(() => import("@/pages/accounting/budgets"));
const MaterialRequests = lazy(() => import("@/pages/purchasing/material-requests"));
const InsuranceBrackets = lazy(() => import("@/pages/hr/insurance-brackets"));
const ShiftTypes = lazy(() => import("@/pages/hr/shift-types"));

const ClockInLocations = lazy(() => import("@/pages/hr/clock-in-locations"));
const AcctCustomers = lazy(() => import("@/pages/accounting/acct-customers"));
const CustomerStatement = lazy(() => import("@/pages/accounting/customer-statement"));
const Reimbursement = lazy(() => import("@/pages/accounting/reimbursement"));
const Receipts = lazy(() => import("@/pages/accounting/receipts"));
const AiDrafts = lazy(() => import("@/pages/accounting/ai-drafts"));
const Payments = lazy(() => import("@/pages/accounting/payments"));
const VoucherTemplates = lazy(() => import("@/pages/accounting/voucher-templates"));
const IncomeStatement = lazy(() => import("@/pages/accounting/income-statement"));
const BalanceSheet = lazy(() => import("@/pages/accounting/balance-sheet"));
const AdminDesignations = lazy(() => import("@/pages/admin/designations"));
const AdminGrades = lazy(() => import("@/pages/admin/grades"));
const AdminPermissions = lazy(() => import("@/pages/admin/permissions"));
const AdminRoles = lazy(() => import("@/pages/admin/roles"));
const AdminMenuPermissions = lazy(() => import("@/pages/admin/menu-permissions"));
const AdminApiKeys = lazy(() => import("@/pages/admin/api-keys"));
const AdminIntegrations = lazy(() => import("@/pages/admin/integrations"));
const LegacyDocuments = lazy(() => import("@/pages/system/legacy-documents"));
const AdminApiDocs = lazy(() => import("@/pages/admin/api-docs"));
const AdminBackup = lazy(() => import("@/pages/admin/backup"));
const AiAssistant = lazy(() => import("@/pages/ai/assistant"));
const AiHub = lazy(() => import("@/pages/ai/hub"));
const AiChat = lazy(() => import("@/pages/ai/chat"));
const AiAnomalies = lazy(() => import("@/pages/ai/anomalies"));
const AiMonthlyReport = lazy(() => import("@/pages/ai/monthly-report"));
const AiDocumentOcr = lazy(() => import("@/pages/ai/document-ocr"));
const AiComplaintClassify = lazy(() => import("@/pages/ai/complaint-classify"));
const AiProductDescription = lazy(() => import("@/pages/ai/product-description"));
const CashFlow = lazy(() => import("@/pages/reports/cash-flow"));
const TrialBalance = lazy(() => import("@/pages/reports/trial-balance"));
const GeneralLedger = lazy(() => import("@/pages/reports/general-ledger"));
const ArAging = lazy(() => import("@/pages/reports/ar-aging"));
const ApAging = lazy(() => import("@/pages/reports/ap-aging"));
const BudgetVsActual = lazy(() => import("@/pages/reports/budget-vs-actual"));
const SalesAnalysis = lazy(() => import("@/pages/reports/sales-analysis"));
const GrossMargin = lazy(() => import("@/pages/reports/gross-margin"));
const MonthlyDigest = lazy(() => import("@/pages/reports/monthly-digest"));
const PurchaseAnalysis = lazy(() => import("@/pages/reports/purchase-analysis"));
const InventoryStatus = lazy(() => import("@/pages/reports/inventory-status"));
const AttendanceSummary = lazy(() => import("@/pages/reports/attendance-summary"));
const SalarySummary = lazy(() => import("@/pages/reports/salary-summary"));
const BuReport = lazy(() => import("@/pages/reports/bu-report"));
const AccountBooks = lazy(() => import("@/pages/reports/account-books"));
const BusinessReports = lazy(() => import("@/pages/reports/business-reports"));
const ReportCenter = lazy(() => import("@/pages/reports/index"));
const DeliveryNotes = lazy(() => import("@/pages/sales/delivery-notes"));
const SalesReturns = lazy(() => import("@/pages/sales/sales-returns"));
const PriceLists = lazy(() => import("@/pages/sales/price-lists"));
const PurchaseReceipts = lazy(() => import("@/pages/purchasing/purchase-receipts"));
const PurchaseReturns = lazy(() => import("@/pages/purchasing/purchase-returns"));
const PaymentRequests = lazy(() => import("@/pages/accounting/payment-requests"));
const AssetCategories = lazy(() => import("@/pages/assets/categories"));
const AssetRegister = lazy(() => import("@/pages/assets/register"));
const AssetDepreciation = lazy(() => import("@/pages/assets/depreciation"));
const AssetMaintenance = lazy(() => import("@/pages/assets/maintenance"));
const Workstations = lazy(() => import("@/pages/manufacturing/workstations"));
const Bom = lazy(() => import("@/pages/manufacturing/bom"));
const WorkOrders = lazy(() => import("@/pages/manufacturing/work-orders"));
const SubcontractOrders = lazy(() => import("@/pages/manufacturing/subcontract-orders"));
const JobCards = lazy(() => import("@/pages/manufacturing/job-cards"));
const ProductionPlanning = lazy(() => import("@/pages/manufacturing/production-planning"));
const QualityTemplates = lazy(() => import("@/pages/quality/templates"));
const QualityInspections = lazy(() => import("@/pages/quality/inspections"));
const NonConformance = lazy(() => import("@/pages/quality/non-conformance"));
const Capa = lazy(() => import("@/pages/quality/capa"));
const SupportTickets = lazy(() => import("@/pages/helpdesk/tickets"));
const KnowledgeBase = lazy(() => import("@/pages/helpdesk/knowledge-base"));
const SlaSettings = lazy(() => import("@/pages/helpdesk/sla"));
const Contracts = lazy(() => import("@/pages/contracts/contracts"));
const BankReconciliation = lazy(() => import("@/pages/accounting/bank-reconciliation"));
const ApprovalWorkflows = lazy(() => import("@/pages/system/approval-workflows"));
const ApprovalRequests = lazy(() => import("@/pages/system/approval-requests"));
const SystemNotifications = lazy(() => import("@/pages/system/notifications"));
const HelpCenter = lazy(() => import("@/pages/help"));
const AuditLogs = lazy(() => import("@/pages/system/audit-logs"));
const MyPage = lazy(() => import("@/pages/my-page"));
const PrintTemplates = lazy(() => import("@/pages/system/print-templates"));
const Brands = lazy(() => import("@/pages/system/brands"));
const SystemCalendar = lazy(() => import("@/pages/system/calendar"));
const SystemCurrencies = lazy(() => import("@/pages/system/currencies"));
const ImportExport = lazy(() => import("@/pages/system/import-export"));
const ScheduledJobs = lazy(() => import("@/pages/system/scheduled-jobs"));
const FileManagement = lazy(() => import("@/pages/system/file-management"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !user && location !== "/login") {
      navigate("/login");
    }
  }, [loading, user, location, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}

function EmployeeGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  if (user?.role === ROLE_EMPLOYEE && location !== "/account/security" && !EMPLOYEE_ALLOWED_PATHS.some(p => location === p || location.startsWith(p + "/"))) {
    return <Redirect to="/hr/clock-in" />;
  }
  return <>{children}</>;
}
/** 平台方停用的模組：直接輸入網址也顯示未開放頁（以最長符合的覆寫 path 為準） */
function ModuleGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { overrides } = useMenuAllowed();
  let match: string | null = null;
  for (const p of Object.keys(overrides)) {
    if (location === p || location.startsWith(p + "/")) {
      if (!match || p.length > match.length) match = p;
    }
  }
  if (match && (overrides[match] || []).includes("__disabled__")) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center" data-testid="module-disabled">
        <Ban className="h-10 w-10 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-1">此模組未開放</h2>
        <p className="text-sm text-muted-foreground">此模組未開放使用，如需開通請聯絡平台管理員。</p>
      </div>
    );
  }
  return <>{children}</>;
}

function Router() {
  const [location] = useLocation();
  const publicPaths = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-recovery-email"];
  if (publicPaths.includes(location)) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/login" component={LoginPage} />
          <Route path="/signup" component={SignupPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/verify-recovery-email" component={VerifyRecoveryEmailPage} />
        </Switch>
      </Suspense>
    );
  }
  return (
    <AuthGuard>
      <EmployeeGuard>
      <AppLayout>
        <ModuleGuard>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/bi"><Redirect to="/bi/executive" /></Route>
            <Route path="/bi/executive" component={ExecutiveCockpit} />
            <Route path="/bi/sales" component={SalesBI} />
            <Route path="/bi/inventory" component={InventoryBI} />
            <Route path="/bi/hr" component={HrBI} />
            <Route path="/bi/observability" component={ObservabilityBI} />
            <Route path="/account/security" component={AccountSecurityPage} />
            <Route path="/my-page" component={MyPage} />
            <Route path="/platform/tenants"><RoleGate roles={["super_admin"]}><PlatformTenants /></RoleGate></Route>
            <Route path="/system/email-settings"><RoleGate roles={SYSTEM_ADMIN_ROLES}><EmailSettings /></RoleGate></Route>
            <Route path="/system/integration-keys"><RoleGate roles={SYSTEM_ADMIN_ROLES}><IntegrationKeys /></RoleGate></Route>
            <Route path="/hr/employees"><RoleGate roles={HR_ROLES}><Employees /></RoleGate></Route>
          <Route path="/hr/teachers"><RoleGate roles={HR_ROLES}><Teachers /></RoleGate></Route>
          <Route path="/hr/contracts"><RoleGate roles={HR_ROLES}><HrContracts /></RoleGate></Route>
          <Route path="/hr/departments"><RoleGate roles={HR_ROLES}><Departments /></RoleGate></Route>
          <Route path="/hr/dept-financials"><RoleGate roles={FINANCE_ROLES}><DeptFinancials /></RoleGate></Route>
          <Route path="/hr/attendance"><RoleGate roles={HR_ROLES}><Attendance /></RoleGate></Route>
          <Route path="/hr/leaves" component={Leaves} />
          <Route path="/hr/clock-in" component={ClockIn} />
          <Route path="/hr/me" component={MySpace} />
          <Route path="/hr/my-requests" component={MyRequests} />
          <Route path="/hr/salary-calc"><RoleGate roles={PAYROLL_ROLES}><SalaryCalc /></RoleGate></Route>
          <Route path="/hr/salary-slips"><RoleGate roles={PAYROLL_ROLES}><SalarySlips /></RoleGate></Route>
          <Route path="/accounting/dunning"><RoleGate roles={FINANCE_ROLES}><Dunning /></RoleGate></Route>
          <Route path="/accounting/advances"><RoleGate roles={FINANCE_ROLES}><Advances /></RoleGate></Route>
          <Route path="/accounting/receivables"><RoleGate roles={FINANCE_ROLES}><Receivables /></RoleGate></Route>
          <Route path="/purchasing/rfqs"><Rfqs /></Route>
          <Route path="/accounting/recurring-invoices"><RoleGate roles={FINANCE_ROLES}><RecurringInvoices /></RoleGate></Route>
          <Route path="/accounting/budgets"><RoleGate roles={FINANCE_ROLES}><Budgets /></RoleGate></Route>
          <Route path="/purchasing/material-requests"><MaterialRequests /></Route>
          <Route path="/hr/timesheets"><Timesheets /></Route>
          <Route path="/inventory/stock-counts"><StockCounts /></Route>
          <Route path="/accounting/payment-terms"><RoleGate roles={FINANCE_ROLES}><PaymentTerms /></RoleGate></Route>
          <Route path="/hr/salary-components"><RoleGate roles={PAYROLL_ROLES}><SalaryComponents /></RoleGate></Route>
          <Route path="/hr/service-fees"><RoleGate roles={[...PAYROLL_ROLES, "accountant"]}><ServiceFees /></RoleGate></Route>
          <Route path="/hr/insurance-brackets"><RoleGate roles={PAYROLL_ROLES}><InsuranceBrackets /></RoleGate></Route>
          <Route path="/hr/shift-types"><RoleGate roles={HR_ROLES}><ShiftTypes /></RoleGate></Route>
          <Route path="/hr/clock-in-locations"><RoleGate roles={HR_ROLES}><ClockInLocations /></RoleGate></Route>
          <Route path="/sales/customers" component={Customers} />
          <Route path="/sales/orders/:id" component={SalesOrderDetail} />
          <Route path="/sales/orders" component={SalesOrders} />
          <Route path="/sales/quotations" component={Quotations} />
          <Route path="/sales/quick-entry" component={QuickEntry} />
          <Route path="/sales/order-templates" component={OrderTemplates} />
          <Route path="/sales/quotation-templates" component={QuotationTemplates} />
          <Route path="/sales/invoices" component={SalesInvoices} />
          <Route path="/sales/delivery-notes" component={DeliveryNotes} />
          <Route path="/sales/returns" component={SalesReturns} />
          <Route path="/sales/price-lists" component={PriceLists} />
          <Route path="/purchasing/suppliers" component={Suppliers} />
          <Route path="/purchasing/orders/:id" component={PurchaseOrderDetail} />
          <Route path="/purchasing/orders" component={PurchaseOrders} />
          <Route path="/purchasing/invoices" component={PurchaseInvoices} />
          <Route path="/purchasing/receipts" component={PurchaseReceipts} />
          <Route path="/purchasing/returns" component={PurchaseReturns} />
          <Route path="/inventory/lookup" component={InventoryLookup} />
          <Route path="/inventory/items" component={Items} />
          <Route path="/inventory/categories" component={ItemCategories} />
          <Route path="/inventory/types" component={ItemTypes} />
          <Route path="/inventory/warehouses" component={Warehouses} />
          <Route path="/inventory/stock" component={StockEntries} />
          <Route path="/projects" component={Projects} />
          <Route path="/projects/tasks" component={Tasks} />
          <Route path="/projects/financials"><RoleGate roles={FINANCE_ROLES}><ProjectFinancials /></RoleGate></Route>
          <Route path="/accounting/accounts"><RoleGate roles={FINANCE_ROLES}><Accounts /></RoleGate></Route>
          <Route path="/accounting/journal"><RoleGate roles={FINANCE_ROLES}><JournalEntries /></RoleGate></Route>
          <Route path="/accounting/invoices"><RoleGate roles={FINANCE_ROLES}><AllInvoices /></RoleGate></Route>
           <Route path="/accounting/vat-report"><RoleGate roles={FINANCE_ROLES}><VatReport /></RoleGate></Route>
          <Route path="/accounting/customers"><RoleGate roles={FINANCE_ROLES}><AcctCustomers /></RoleGate></Route>
          <Route path="/accounting/customer-statement/:id?"><RoleGate roles={FINANCE_ROLES}><CustomerStatement /></RoleGate></Route>
          <Route path="/accounting/reimbursement"><RoleGate roles={FINANCE_ROLES}><Reimbursement /></RoleGate></Route>
          <Route path="/accounting/receipts"><RoleGate roles={FINANCE_ROLES}><Receipts /></RoleGate></Route>
          <Route path="/accounting/ai-drafts"><RoleGate roles={FINANCE_ROLES}><AiDrafts /></RoleGate></Route>
          <Route path="/accounting/payments"><RoleGate roles={FINANCE_ROLES}><Payments /></RoleGate></Route>
          <Route path="/accounting/voucher-templates"><RoleGate roles={FINANCE_ROLES}><VoucherTemplates /></RoleGate></Route>
          <Route path="/accounting/payment-requests"><RoleGate roles={FINANCE_ROLES}><PaymentRequests /></RoleGate></Route>
          <Route path="/accounting/income-statement"><RoleGate roles={FINANCE_ROLES}><IncomeStatement /></RoleGate></Route>
          <Route path="/accounting/balance-sheet"><RoleGate roles={FINANCE_ROLES}><BalanceSheet /></RoleGate></Route>
          <Route path="/admin/designations"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AdminDesignations /></RoleGate></Route>
          <Route path="/admin/grades"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AdminGrades /></RoleGate></Route>
          <Route path="/admin/permissions"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AdminPermissions /></RoleGate></Route>
          <Route path="/admin/roles"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AdminRoles /></RoleGate></Route>
          <Route path="/admin/menu-permissions"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AdminMenuPermissions /></RoleGate></Route>
          <Route path="/admin/api-keys"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AdminApiKeys /></RoleGate></Route>
          <Route path="/admin/integrations"><RoleGate roles={FINANCE_ROLES}><AdminIntegrations /></RoleGate></Route>
          <Route path="/system/legacy-documents"><RoleGate roles={FINANCE_ROLES}><LegacyDocuments /></RoleGate></Route>
          <Route path="/admin/api-docs"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AdminApiDocs /></RoleGate></Route>
          <Route path="/admin/backup"><RoleGate roles={["super_admin"]}><AdminBackup /></RoleGate></Route>
          <Route path="/ai/chat"><AiHub><AiChat /></AiHub></Route>
          <Route path="/ai/assistant"><AiHub><AiAssistant /></AiHub></Route>
          <Route path="/ai/anomalies"><AiHub><AiAnomalies /></AiHub></Route>
          <Route path="/ai/monthly-report"><AiHub><AiMonthlyReport /></AiHub></Route>
          <Route path="/ai/document-ocr"><AiHub><AiDocumentOcr /></AiHub></Route>
          <Route path="/ai/complaint-classify"><AiHub><AiComplaintClassify /></AiHub></Route>
          <Route path="/ai/product-description"><AiHub><AiProductDescription /></AiHub></Route>
          <Route path="/assets/register" component={AssetRegister} />
          <Route path="/assets/categories" component={AssetCategories} />
          <Route path="/assets/depreciation" component={AssetDepreciation} />
          <Route path="/assets/maintenance" component={AssetMaintenance} />
          <Route path="/manufacturing/workstations" component={Workstations} />
          <Route path="/manufacturing/bom" component={Bom} />
          <Route path="/manufacturing/work-orders" component={WorkOrders} />
          <Route path="/manufacturing/subcontract-orders" component={SubcontractOrders} />
          <Route path="/manufacturing/job-cards" component={JobCards} />
          <Route path="/manufacturing/production-planning" component={ProductionPlanning} />
          <Route path="/quality/templates" component={QualityTemplates} />
          <Route path="/quality/inspections" component={QualityInspections} />
          <Route path="/quality/non-conformance" component={NonConformance} />
          <Route path="/quality/capa" component={Capa} />
          <Route path="/helpdesk/tickets" component={SupportTickets} />
          <Route path="/helpdesk/knowledge-base" component={KnowledgeBase} />
          <Route path="/helpdesk/sla" component={SlaSettings} />
          <Route path="/contracts" component={Contracts} />
          <Route path="/accounting/bank-reconciliation"><RoleGate roles={FINANCE_ROLES}><BankReconciliation /></RoleGate></Route>
          <Route path="/system/approval-workflows" component={ApprovalWorkflows} />
          <Route path="/system/approval-requests" component={ApprovalRequests} />
          <Route path="/system/notifications" component={SystemNotifications} />
          <Route path="/help" component={HelpCenter} />
          <Route path="/system/audit-logs"><RoleGate roles={SYSTEM_ADMIN_ROLES}><AuditLogs /></RoleGate></Route>
          <Route path="/system/print-templates" component={PrintTemplates} />
          <Route path="/system/brands" component={Brands} />
          <Route path="/system/calendar" component={SystemCalendar} />
          <Route path="/system/currencies" component={SystemCurrencies} />
          <Route path="/system/import-export"><RoleGate roles={SYSTEM_ADMIN_ROLES}><ImportExport /></RoleGate></Route>
          <Route path="/system/scheduled-jobs"><RoleGate roles={SYSTEM_ADMIN_ROLES}><ScheduledJobs /></RoleGate></Route>
          <Route path="/system/file-management" component={FileManagement} />
          <Route path="/reports" component={ReportCenter} />
          <Route path="/reports/cash-flow"><RoleGate roles={FINANCE_ROLES}><CashFlow /></RoleGate></Route>
          <Route path="/reports/trial-balance"><RoleGate roles={FINANCE_ROLES}><TrialBalance /></RoleGate></Route>
          <Route path="/reports/general-ledger"><RoleGate roles={FINANCE_ROLES}><GeneralLedger /></RoleGate></Route>
          <Route path="/reports/books/:kind?"><RoleGate roles={FINANCE_ROLES}><AccountBooks /></RoleGate></Route>
          <Route path="/reports/business/:kind?"><RoleGate roles={FINANCE_ROLES}><BusinessReports /></RoleGate></Route>
          <Route path="/reports/ar-aging"><RoleGate roles={FINANCE_ROLES}><ArAging /></RoleGate></Route>
          <Route path="/reports/ap-aging"><RoleGate roles={FINANCE_ROLES}><ApAging /></RoleGate></Route>
          <Route path="/reports/budget-vs-actual"><RoleGate roles={FINANCE_ROLES}><BudgetVsActual /></RoleGate></Route>
          <Route path="/reports/sales-analysis" component={SalesAnalysis} />
           <Route path="/reports/gross-margin" component={GrossMargin} />
          <Route path="/reports/monthly-digest"><RoleGate roles={FINANCE_ROLES}><MonthlyDigest /></RoleGate></Route>
          <Route path="/reports/purchase-analysis" component={PurchaseAnalysis} />
          <Route path="/reports/inventory-status" component={InventoryStatus} />
          <Route path="/reports/attendance-summary"><RoleGate roles={HR_ROLES}><AttendanceSummary /></RoleGate></Route>
          <Route path="/reports/salary-summary"><RoleGate roles={PAYROLL_ROLES}><SalarySummary /></RoleGate></Route>
          <Route path="/reports/bu"><RoleGate roles={FINANCE_ROLES}><BuReport /></RoleGate></Route>
            <Route component={NotFound} />
          </Switch>
        </Suspense>
        </ModuleGuard>
      </AppLayout>
      </EmployeeGuard>
    </AuthGuard>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
        </ErrorBoundary>
        <Toaster />
        <ChangeReasonHost />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

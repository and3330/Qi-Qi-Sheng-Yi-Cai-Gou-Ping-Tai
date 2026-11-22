export interface CashFlowData {
  startDate: string | null;
  endDate: string | null;
  operating: CashFlowItem[];
  investing: CashFlowItem[];
  financing: CashFlowItem[];
  totalOperating: number;
  totalInvesting: number;
  totalFinancing: number;
  netCashChange: number;
  openingCash: number;
  closingCash: number;
}

export interface CashFlowItem {
  accountId?: number;
  accountName: string;
  accountNumber: string;
  amount: number;
}

export interface TrialBalanceData {
  startDate: string | null;
  endDate: string | null;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  totalDebitBalance: number;
  totalCreditBalance: number;
  isBalanced: boolean;
}

export interface TrialBalanceRow {
  accountId: number;
  accountNumber: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  debitBalance: number;
  creditBalance: number;
}

export interface GeneralLedgerData {
  account: { id: number; accountNumber: string; accountName: string; accountType: string } | null;
  startDate: string | null;
  endDate: string | null;
  openingBalance: number;
  rows: GeneralLedgerRow[];
  closingBalance: number;
}

export interface GeneralLedgerRow {
  date: string;
  entryId: number;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface AgingData {
  asOfDate: string;
  rows: AgingRow[];
  summary: AgingSummary;
}

export interface AgingRow {
  /** 客戶編號（0＝未指定），應收帳齡才有 */
  customerId?: number;
  /** 供應商編號（0＝未指定），應付帳齡才有 */
  supplierId?: number;
  customerName?: string;
  customerCode?: string | null;
  supplierName?: string;
  supplierCode?: string | null;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  total: number;
}

export interface AgingSummary {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  total: number;
}

export interface BudgetVsActualData {
  startDate: string | null;
  endDate: string | null;
  dimension: string;
  rows: BudgetVsActualRow[];
  totals: { budgetIncome: number; budgetExpense: number; actualIncome: number; actualExpense: number };
}

export interface BudgetVsActualRow {
  id: number;
  name: string;
  budgetIncome: number;
  budgetExpense: number;
  actualIncome: number;
  actualExpense: number;
  varianceIncome: number;
  varianceExpense: number;
}

export interface SalesAnalysisData {
  dimension: string;
  startDate: string | null;
  endDate: string | null;
  rows: Array<{ name?: string; month?: string; itemName?: string; orderCount?: number; quantity?: number; totalAmount: number; id?: number }>;
  totalOrders: number;
  totalAmount: number;
}

export interface PurchaseAnalysisData {
  dimension: string;
  startDate: string | null;
  endDate: string | null;
  rows: Array<{ name?: string; month?: string; itemName?: string; orderCount?: number; quantity?: number; totalAmount: number; id?: number }>;
  totalOrders: number;
  totalAmount: number;
}

export interface WarehouseBreakdown {
  warehouseId: number;
  warehouseName: string;
  qty: number;
}

export interface InventoryStatusData {
  rows: InventoryRow[];
  summary: { totalItems: number; totalStockValue: number; lowStockCount: number };
  groups: string[];
  warehouses: Array<{ id: number; name: string }>;
  pagination: { page: number; pageSize: number; totalPages: number };
}

export interface InventoryRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  itemGroup: string | null;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  sellingPrice: number;
  buyingPrice: number;
  movingAvgCost: number;
  stockValue: number;
  belowReorder: boolean;
  warehouseBreakdown: WarehouseBreakdown[];
}

export interface WarehouseInventorySummary {
  warehouseId: number;
  warehouseName: string;
  totalQuantity: number;
  totalValue: number;
}

export interface AttendanceSummaryData {
  year: number;
  month: number;
  workingDays: number;
  rows: AttendanceRow[];
  summary: { totalEmployees: number; avgAttendanceRate: number; totalLate: number; totalEarlyLeave: number; totalLateMinutes: number; totalOvertimeHours: number };
}

export interface AttendanceRow {
  employeeId: string;
  employeeName: string;
  department: number | null;
  present: number;
  absent: number;
  late: number;
  totalLateMinutes: number;
  earlyLeave: number;
  totalHours: number;
  totalOvertimeHours: number;
  attendanceRate: number;
}

export interface SalarySummaryData {
  year: number | null;
  month: number | null;
  monthlyRows: MonthlyRow[];
  detailRows: SalaryDetailRow[];
  totals: {
    slipCount: number;
    grossTotal: number;
    netTotal: number;
    deductionsTotal: number;
    laborInsEmployer: number;
    healthInsEmployer: number;
    pensionEmployer: number;
  };
}

export interface MonthlyRow {
  period: string;
  count: number;
  grossTotal: number;
  netTotal: number;
  laborInsEmp: number;
  laborInsEmpr: number;
  healthInsEmp: number;
  healthInsEmpr: number;
  pensionEmpr: number;
  deductions: number;
}

export interface SalaryDetailRow {
  employeeName: string;
  period: string;
  grossSalary: number;
  netSalary: number;
  totalDeductions: number;
  status: string;
}

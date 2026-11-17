const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

function apiErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  for (const key of ["error", "message", "detail"]) {
    const candidate = data[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      for (const nestedKey of ["message", "error", "detail"]) {
        const text = nested[nestedKey];
        if (typeof text === "string" && text.trim()) return text;
      }
    }
  }
  return undefined;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type") && options?.body != null && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`/erp-api${path}`, {
    credentials: "include",
    ...options,
    headers,
  });
  if (res.status === 401 && !path.startsWith("/admin/login") && !path.startsWith("/admin/me")) {
    if (!window.location.pathname.endsWith("/login")) {
      window.location.href = `${BASE}login`;
    }
  }
  if (res.status === 402) {
    const err: any = await res.json().catch(() => ({}));
    if (err.code === "subscription_required" && !window.location.pathname.endsWith("/billing")) {
      window.location.href = `${BASE}billing`;
    }
    throw new Error(apiErrorMessage(err) || "訂閱已到期");
  }
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({ error: "請求失敗" }));
    throw new Error(apiErrorMessage(err) || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface Designation {
  id: number;
  title: string;
  departmentId: number | null;
  departmentName: string | null;
  description: string | null;
  isActive: boolean;
}

export interface Grade {
  id: number;
  name: string;
  level: number;
  minSalary: number | null;
  maxSalary: number | null;
  description: string | null;
  isActive: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  employeeId?: number | null;
  employeeCode?: string | null;
  employeeName?: string | null;
}

export interface BracketRowInput {
  minSalary: number;
  maxSalary: number | null;
  insuredAmount: number;
}

export interface InsuranceBracket {
  id: number;
  type: string;
  level: number;
  minSalary: number;
  maxSalary: number | null;
  insuredAmount: number;
}

export interface ShiftType {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  workingHours: string;
  status: string;
}

export interface AttendanceSummaryInfo {
  presentDays: number;
  lateCount: number;
  totalLateMinutes: number;
  earlyLeaveCount: number;
  totalWorkingHours: number;
  totalOvertimeHours: number;
  leaveDays: number;
  absentDays: number;
  workingDays: number;
}
export interface SalarySlip {
  id: number;
  employeeId: number;
  employeeName?: string;
  employeeCode?: string;
  year: number;
  month: number;
  baseSalary: number;
  overtimePay: number;
  otherAllowances: number;
  /** 薪資項目明細：加項已含在 otherAllowances，減項已含在 otherDeductions */
  components?: Array<{ componentId: number | null; name: string; kind: string; amount: number }> | null;
  otherDeductions?: number;
  attendanceDeduction: number;
  attendanceSummary?: AttendanceSummaryInfo | null;
  grossSalary: number;
  laborInsuranceBracket: number;
  laborInsuranceEmployee: number;
  laborInsuranceEmployer: number;
  healthInsuranceBracket: number;
  healthInsuranceDependents: number;
  healthInsuranceEmployee: number;
  healthInsuranceEmployer: number;
  pensionBracket: number;
  pensionEmployer: number;
  pensionEmployeeSelfRate: number;
  pensionEmployeeSelf: number;
  totalDeductions: number;
  netSalary: number;
  status: string;
  note: string | null;
}

export interface SalaryCalcResult extends Omit<SalarySlip, 'id' | 'status' | 'note'> {
  employeeName: string;
}

export const adminApi = {
  login: (companyCode: string, username: string, password: string) =>
    apiFetch<AdminUser>("/admin/login", { method: "POST", body: JSON.stringify({ companyCode, username, password }) }),

  listDesignations: () => apiFetch<Designation[]>("/designations"),
  createDesignation: (data: Partial<Designation>) =>
    apiFetch<Designation>("/designations", { method: "POST", body: JSON.stringify(data) }),
  updateDesignation: (id: number, data: Partial<Designation>) =>
    apiFetch<Designation>(`/designations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteDesignation: (id: number) =>
    apiFetch<void>(`/designations/${id}`, { method: "DELETE" }),

  listGrades: () => apiFetch<Grade[]>("/grades"),
  createGrade: (data: Partial<Grade>) =>
    apiFetch<Grade>("/grades", { method: "POST", body: JSON.stringify(data) }),
  updateGrade: (id: number, data: Partial<Grade>) =>
    apiFetch<Grade>(`/grades/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteGrade: (id: number) =>
    apiFetch<void>(`/grades/${id}`, { method: "DELETE" }),

  listUsers: () => apiFetch<AdminUser[]>("/admin/users"),
  createUser: (data: { username: string; password: string; displayName: string; role: string; employeeId?: number | null }) =>
    apiFetch<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: number, data: Partial<AdminUser & { password?: string; employeeId?: number | null }>) =>
    apiFetch<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteUser: (id: number) =>
    apiFetch<void>(`/admin/users/${id}`, { method: "DELETE" }),

  createEmployeeAccount: (employeeId: number, data: { username?: string; password: string; role?: string }) =>
    apiFetch<AdminUser>(`/employees/${employeeId}/account`, { method: "POST", body: JSON.stringify(data) }),
  deleteEmployeeAccount: (employeeId: number) =>
    apiFetch<void>(`/employees/${employeeId}/account`, { method: "DELETE" }),
};

export const payrollApi = {
  listBrackets: (type?: string) =>
    apiFetch<InsuranceBracket[]>(`/insurance-brackets${type ? `?type=${type}` : ""}`),
  lookupBracket: (type: string, salary: number) =>
    apiFetch<InsuranceBracket>(`/insurance-brackets/lookup?type=${type}&salary=${salary}`),
  bracketPermissions: () =>
    apiFetch<{ canManage: boolean }>(`/insurance-brackets/permissions`),
  bulkReplaceBrackets: (type: string, rows: BracketRowInput[]) =>
    apiFetch<{ type: string; count: number }>(`/insurance-brackets/bulk-replace`, { method: "POST", body: JSON.stringify({ type, rows }) }),
  deleteBracket: (id: number) =>
    apiFetch<void>(`/insurance-brackets/${id}`, { method: "DELETE" }),

  listShiftTypes: () => apiFetch<ShiftType[]>("/shift-types"),
  createShiftType: (data: Partial<ShiftType>) =>
    apiFetch<ShiftType>("/shift-types", { method: "POST", body: JSON.stringify(data) }),
  updateShiftType: (id: number, data: Partial<ShiftType>) =>
    apiFetch<ShiftType>(`/shift-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteShiftType: (id: number) =>
    apiFetch<void>(`/shift-types/${id}`, { method: "DELETE" }),

  listSalarySlips: (params?: { employeeId?: number; year?: number; month?: number }) => {
    const qs = new URLSearchParams();
    if (params?.employeeId) qs.set("employeeId", String(params.employeeId));
    if (params?.year) qs.set("year", String(params.year));
    if (params?.month) qs.set("month", String(params.month));
    const q = qs.toString();
    return apiFetch<SalarySlip[]>(`/salary-slips${q ? `?${q}` : ""}`);
  },
  calculateSalary: (data: { employeeId: number; year: number; month: number; overtimePay?: number; otherAllowances?: number; attendanceDeduction?: number }) =>
    apiFetch<SalaryCalcResult>("/salary-slips/calculate", { method: "POST", body: JSON.stringify(data) }),
  batchGenerate: (data: { year: number; month: number; dryRun?: boolean; projectId?: number }) =>
    apiFetch<BatchGenerateResult>("/salary-slips/batch-generate", { method: "POST", body: JSON.stringify(data) }),
  attendanceBasis: (employeeId: number, year: number, month: number) =>
    apiFetch<AttendanceBasis>(`/salary-slips/attendance-basis?employeeId=${employeeId}&year=${year}&month=${month}`),
  getPayrollSettings: () => apiFetch<PayrollSettings>("/payroll-settings"),
  updatePayrollSettings: (data: Partial<Omit<PayrollSettings, "id">>) =>
    apiFetch<PayrollSettings>("/payroll-settings", { method: "PUT", body: JSON.stringify(data) }),
  saveSalarySlip: (data: Omit<SalarySlip, 'id'>) =>
    apiFetch<SalarySlip>("/salary-slips", { method: "POST", body: JSON.stringify(data) }),
  updateSlipStatus: (id: number, status: string, cashAccountId?: number) =>
    apiFetch<SalarySlip>(`/salary-slips/${id}/status`, { method: "PUT", body: JSON.stringify({ status, ...(cashAccountId ? { cashAccountId } : {}) }) }),
  deleteSlip: (id: number) =>
    apiFetch<void>(`/salary-slips/${id}`, { method: "DELETE" }),
};

export interface ApiKeyRecord {
  id: number;
  keyName: string;
  apiKey: string;
  apiSecret?: string;
  projectId: number | null;
  projectName?: string;
  permissions: string;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  maskedKey?: string;
  _notice?: string;
}

export const apiKeyApi = {
  list: () => apiFetch<ApiKeyRecord[]>("/api-keys"),
  create: (data: { keyName: string; projectId?: number | null; permissions?: string; expiresAt?: string | null }) =>
    apiFetch<ApiKeyRecord>("/api-keys", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<ApiKeyRecord>) =>
    apiFetch<ApiKeyRecord>(`/api-keys/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  regenerate: (id: number) =>
    apiFetch<ApiKeyRecord>(`/api-keys/${id}/regenerate`, { method: "POST" }),
  delete: (id: number) =>
    apiFetch<void>(`/api-keys/${id}`, { method: "DELETE" }),
};

export interface ClockInLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

export const salarySlipsApi = {
  list: (params?: { employeeId?: number; year?: number; month?: number }) => {
    const search = new URLSearchParams();
    if (params?.employeeId) search.set("employeeId", String(params.employeeId));
    if (params?.year) search.set("year", String(params.year));
    if (params?.month) search.set("month", String(params.month));
    const qs = search.toString();
    return apiFetch<any[]>(`/salary-slips${qs ? `?${qs}` : ""}`);
  },
};
export const attendanceApi = {
  todayState: (employeeId: number, date: string) =>
    apiFetch<any>(`/attendance/today-state?employeeId=${employeeId}&date=${date}`),
  clockIn: (employeeId: number, location?: string, note?: string) =>
    apiFetch<any>("/attendance", { method: "POST", body: JSON.stringify({ employeeId, location, note }) }),
  clockOut: (id: number, location?: string, note?: string) =>
    apiFetch<any>(`/attendance/${id}`, { method: "PATCH", body: JSON.stringify({ location, note }) }),
  monthlySummary: (year: number, month: number, employeeId?: number) =>
    apiFetch<any>(`/attendance/monthly-summary?year=${year}&month=${month}${employeeId ? `&employeeId=${employeeId}` : ""}`),
};

export interface BatchGenerateItem {
  employeeId: number;
  employeeName: string;
  status: "preview" | "created" | "skipped" | "failed";
  reason?: string;
  overtimePay?: number;
  attendanceDeduction?: number;
  grossSalary?: number;
  netSalary?: number;
  slipId?: number;
}

export interface BatchGenerateResult {
  year: number;
  month: number;
  dryRun: boolean;
  counts: { total: number; success: number; skipped: number; failed: number };
  results: BatchGenerateItem[];
}

export interface AttendanceBasis {
  employeeId: number;
  year: number;
  month: number;
  summary: AttendanceSummaryInfo;
  hourlyRate: number;
  settings: {
    monthlyDivisor: number;
    otRate1: number;
    otRate2: number;
    otThresholdHours: number;
    lateDeductionEnabled: boolean;
    absenceDeductionEnabled: boolean;
  };
  overtime: { hoursAtRate1: number; hoursAtRate2: number; suggestedOvertimePay: number };
  deductions: { lateDeduction: number; absenceDeduction: number; leaveDeduction?: number; suggestedAttendanceDeduction: number };
}

export const clockInLocationsApi = {
  list: () => apiFetch<ClockInLocation[]>("/clock-in-locations"),
  create: (data: Omit<ClockInLocation, "id">) =>
    apiFetch<ClockInLocation>("/clock-in-locations", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Omit<ClockInLocation, "id">>) =>
    apiFetch<ClockInLocation>(`/clock-in-locations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: number) =>
    apiFetch<void>(`/clock-in-locations/${id}`, { method: "DELETE" }),
  listExemptions: () => apiFetch<GeofenceExemption[]>("/clock-in-locations/exemptions"),
  setExemption: (employeeId: number, geofenceExempt: boolean) =>
    apiFetch<{ id: number; geofenceExempt: boolean }>(`/clock-in-locations/exemptions/${employeeId}`, {
      method: "PATCH",
      body: JSON.stringify({ geofenceExempt }),
    }),
};

export interface GeofenceExemption {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  geofenceExempt: boolean;
}

export interface PayrollSettings {
  id: number;
  monthlyDivisor: number;
  otRate1: string;
  otRate2: string;
  otThresholdHours: string;
  lateDeductionEnabled: boolean;
  absenceDeductionEnabled: boolean;
}

export type AiDraftStatus = "pending" | "confirmed" | "rejected";
export interface AiDraft {
  id: number;
  docType: string;
  payload: unknown;
  status: AiDraftStatus;
  summary: string | null;
  createdAt: string;
  confirmedBy: string | number | null;
  confirmedAt: string | null;
  resultDocumentId: number | string | null;
}
export const aiDraftsApi = {
  list: (status: AiDraftStatus) => apiFetch<AiDraft[]>(`/ai-drafts?status=${encodeURIComponent(status)}`),
  // Server performs the real document creation atomically; never create vouchers client-side.
  confirm: (id: number) => apiFetch<AiDraft>(`/ai-drafts/${id}/confirm`, { method: "POST" }),
  reject: (id: number) => apiFetch<AiDraft>(`/ai-drafts/${id}/reject`, { method: "POST" }),
};

export interface AiCustomerDraft {
  id: number;
  payload: unknown;
  status: AiDraftStatus;
  summary: string | null;
  createdAt: string;
  confirmedBy: string | number | null;
  confirmedAt: string | null;
  resultCustomerId: number | string | null;
}
export const aiCustomerDraftsApi = {
  list: (status: AiDraftStatus) => apiFetch<AiCustomerDraft[]>(`/ai-drafts/customers?status=${encodeURIComponent(status)}`),
  // Server re-validates (統編 + duplicates) and creates the customer via the existing POST /customers flow.
  confirm: (id: number) => apiFetch<AiCustomerDraft>(`/ai-drafts/customers/${id}/confirm`, { method: "POST" }),
  reject: (id: number) => apiFetch<AiCustomerDraft>(`/ai-drafts/customers/${id}/reject`, { method: "POST" }),
};

// ---- 人事：請假、特休、打卡補登 ----
export interface LeaveTypeRule {
  code: string; label: string; pay: "full" | "half" | "none";
  yearlyLimit: number | null; monthlyLimit?: number; calendarDays?: boolean; note: string;
}
export interface AnnualBalance {
  period: { periodStart: string; periodEnd: string; days: number; label: string } | null;
  entitled: number; used: number; pending: number; remaining: number;
  daysToExpiry: number | null;
  next: { date: string; days: number; label: string } | null;
  seniority: string;
}
export interface LeaveBalance {
  employeeId: number; employeeName: string; dateOfJoining: string; year: number;
  annual: AnnualBalance;
  usage: { code: string; label: string; yearlyLimit: number | null; used: number; pending: number }[];
}
export interface AnnualOverviewRow extends AnnualBalance {
  id?: number; employeeId: number; employeeCode: string; employeeName: string; dateOfJoining: string;
}
export interface UnsettledGrant {
  id?: number; grantId: number; employeeId: number; employeeCode: string; employeeName: string;
  periodStart: string; periodEnd: string; reason: "expired" | "resigned";
  entitled: number; used: number; unusedDays: number; dailyWage: number; amount: number;
}
export interface LeaveRecord {
  id: number; employeeId: number; employeeName: string; employeeCode?: string;
  leaveType: string; fromDate: string; toDate: string; totalDays: number;
  reason: string | null; status: string;
}

export const leavesApi = {
  types: () => apiFetch<LeaveTypeRule[]>("/leaves/types"),
  list: (params: { employeeId?: number; from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.employeeId) q.set("employeeId", String(params.employeeId));
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    const qs = q.toString();
    return apiFetch<LeaveRecord[]>(`/leaves${qs ? `?${qs}` : ""}`);
  },
  create: (data: { employeeId: number; leaveType: string; fromDate: string; toDate: string; dayPart?: string; reason?: string }) =>
    apiFetch<LeaveRecord>("/leaves", { method: "POST", body: JSON.stringify(data) }),
  decide: (id: number, status: "Approved" | "Rejected") =>
    apiFetch<LeaveRecord>(`/leaves/${id}/approve`, { method: "PATCH", body: JSON.stringify({ status }) }),
  cancel: (id: number) => apiFetch<LeaveRecord>(`/leaves/${id}/cancel`, { method: "PATCH", body: "{}" }),
  balance: (employeeId?: number) => apiFetch<LeaveBalance>(`/leaves/balance${employeeId ? `?employeeId=${employeeId}` : ""}`),
  annualOverview: () => apiFetch<{ today: string; rows: AnnualOverviewRow[]; unsettled: UnsettledGrant[] }>("/leaves/annual-overview"),
  runGrants: () => apiFetch<{ created: { name: string; days: number; label: string }[] }>("/leaves/annual-grants/run", { method: "POST", body: "{}" }),
  adjust: (data: { employeeId: number; days: number; note: string }) =>
    apiFetch<unknown>("/leaves/annual-grants", { method: "POST", body: JSON.stringify(data) }),
  settle: (grantId: number, note?: string) =>
    apiFetch<unknown>(`/leaves/annual-grants/${grantId}/settle`, { method: "POST", body: JSON.stringify({ note }) }),
};

export interface AttendanceRecord {
  id: number; employeeId: number; employeeName: string; employeeCode: string;
  date: string; status: string; checkIn: string | null; checkOut: string | null;
  workingHours: number | null; lateMinutes: number; earlyLeaveMinutes: number; overtimeHours: number;
  checkInLocation: string | null; checkOutLocation: string | null;
  checkInLocationName: string | null; checkOutLocationName: string | null; note: string | null;
}

export const attendanceRecordsApi = {
  list: (params: { from: string; to: string; employeeId?: number }) =>
    apiFetch<AttendanceRecord[]>(`/attendance?from=${params.from}&to=${params.to}${params.employeeId ? `&employeeId=${params.employeeId}` : ""}`),
  manual: (data: { employeeId: number; date: string; checkIn: string; checkOut?: string; reason: string }) =>
    apiFetch<AttendanceRecord>("/attendance/manual", { method: "POST", body: JSON.stringify(data) }),
  correct: (id: number, data: { checkIn: string; checkOut?: string; reason: string }) =>
    apiFetch<AttendanceRecord>(`/attendance/${id}`, { method: "PUT", body: JSON.stringify(data) }),
};

/** 出勤狀態的中文名稱 */
export const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  Present: "出勤", Late: "遲到", Absent: "缺勤", "Half Day": "半天", "On Leave": "請假", "Early Leave": "早退",
};
export const LEAVE_STATUS_LABEL: Record<string, string> = { Pending: "待審核", Approved: "已核准", Rejected: "已駁回", Cancelled: "已取消" };

/** 某個月的第一天與最後一天（YYYY-MM-DD） */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** 台北時間的今天（YYYY-MM-DD） */
export function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

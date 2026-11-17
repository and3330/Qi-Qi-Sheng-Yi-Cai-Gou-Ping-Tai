/**
 * 付款條件的純計算：檢查分期設定、依發票金額排出各期到期日與金額、算出每一期收到多少、有沒有逾期。
 */

export interface Installment { label: string; percent: number; days: number }
export interface ScheduleRow { label: string; percent: number; dueDate: string; amount: number }
export interface ScheduleStatusRow extends ScheduleRow { paid: number; remaining: number; overdue: boolean }

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 整理輸入的分期設定；格式不對就回傳 null */
export function normalizeInstallments(input: unknown): Installment[] | null {
  if (!Array.isArray(input)) return null;
  const rows: Installment[] = [];
  for (const raw of input) {
    const label = typeof raw?.label === "string" ? raw.label.trim().slice(0, 20) : "";
    const percent = Number(raw?.percent);
    const days = Number(raw?.days);
    if (!Number.isFinite(percent) || !Number.isFinite(days)) return null;
    rows.push({ label, percent: round2(percent), days: Math.round(days) });
  }
  return rows;
}

export function termProblem(name: unknown, installments: Installment[] | null): string | null {
  if (typeof name !== "string" || !name.trim()) return "請填寫付款條件名稱";
  if (name.trim().length > 40) return "名稱最多 40 個字";
  if (!installments || installments.length === 0) return "至少要有一期";
  if (installments.length > 12) return "最多 12 期";
  for (const [index, row] of installments.entries()) {
    if (!row.label) return `第 ${index + 1} 期請填寫名稱（例如：訂金、尾款）`;
    if (row.percent <= 0 || row.percent > 100) return `第 ${index + 1} 期的比例必須介於 0 到 100`;
    if (row.days < 0 || row.days > 3650) return `第 ${index + 1} 期的天數必須是 0 以上`;
    if (index > 0 && row.days < installments[index - 1].days) return "各期的天數要由小到大排列";
  }
  const total = round2(installments.reduce((s, r) => s + r.percent, 0));
  if (Math.abs(total - 100) > 0.001) return `各期比例加起來要等於 100%，目前是 ${total}%`;
  return null;
}

/** 依發票總額排出各期金額與到期日；最後一期吸收四捨五入的尾差，各期加總一定等於發票總額 */
export function buildSchedule(total: number, baseDate: string, installments: Installment[]): ScheduleRow[] {
  const amount = round2(total);
  let allocated = 0;
  return installments.map((row, index) => {
    const isLast = index === installments.length - 1;
    const part = isLast ? round2(amount - allocated) : round2(amount * row.percent / 100);
    allocated = round2(allocated + part);
    return { label: row.label, percent: row.percent, dueDate: addDays(baseDate, row.days), amount: part };
  });
}

/**
 * 已收（付）金額由第一期開始往後沖；回傳每一期的狀況，以及下一個到期日與已逾期的金額。
 */
export function scheduleStatus(schedule: ScheduleRow[] | null | undefined, paidAmount: number, today: string) {
  const rows: ScheduleStatusRow[] = [];
  let left = round2(paidAmount);
  for (const row of schedule || []) {
    const paid = Math.max(0, Math.min(row.amount, left));
    left = round2(left - paid);
    const remaining = round2(row.amount - paid);
    rows.push({ ...row, paid: round2(paid), remaining, overdue: remaining > 0.005 && row.dueDate < today });
  }
  const open = rows.filter(r => r.remaining > 0.005);
  return {
    rows,
    nextDueDate: open[0]?.dueDate ?? null,
    nextDueAmount: open[0]?.remaining ?? 0,
    overdueAmount: round2(rows.filter(r => r.overdue).reduce((s, r) => s + r.remaining, 0)),
  };
}

/**
 * 帳齡用：把一張發票還沒收（付）的金額拆成幾筆「到期日＋金額」。
 * 沒有分期排程的發票就是一筆，到期日用發票的到期日（沒填就用發票日）。
 */
export function agingParts(
  invoice: { dueDate?: string | null; invoiceDate: string; paidAmount?: string | number | null; paymentSchedule?: ScheduleRow[] | null },
  outstanding: number,
  today: string,
): Array<{ dueDate: string; amount: number }> {
  const fallback = [{ dueDate: invoice.dueDate || invoice.invoiceDate, amount: outstanding }];
  const schedule = invoice.paymentSchedule;
  if (!Array.isArray(schedule) || schedule.length === 0) return fallback;
  const open = scheduleStatus(schedule, Number(invoice.paidAmount) || 0, today).rows.filter(r => r.remaining > 0.005);
  const total = round2(open.reduce((s, r) => s + r.remaining, 0));
  // 排程與未收金額對不起來（例如折讓、呆帳後金額變了）就不拆，避免帳齡合計跑掉
  if (open.length === 0 || Math.abs(total - round2(outstanding)) > 0.01) return fallback;
  return open.map(r => ({ dueDate: r.dueDate, amount: r.remaining }));
}

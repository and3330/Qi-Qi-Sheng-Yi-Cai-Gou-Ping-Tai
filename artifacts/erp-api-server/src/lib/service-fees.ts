/**
 * 講師與服務費的扣繳試算與年度彙總（純計算）。
 *
 * 這裡的門檻與費率是「系統試算用的預設值」，稅法每年可能調整，
 * 而且非居住者、同一給付日多筆合併等情況算法不同，所以每一筆的代扣金額都可以手動改；
 * 正式申報前請以會計師或國稅局、健保署當年度的公告為準。
 */
export const WITHHOLDING_DEFAULTS = {
  /** 非固定薪資（兼職、授課鐘點費）單次給付達到這個金額才扣繳 5% */
  salaryThreshold: 88501,
  salaryRate: 0.05,
  /** 執行業務所得、稿費與講演鐘點費：扣繳 10%，稅額不超過 2,000 元免扣（即單次超過 20,000 才扣） */
  professionalRate: 0.10,
  professionalTaxFloor: 2000,
  /** 二代健保補充保費費率 */
  nhiRate: 0.0211,
  /** 兼職薪資單次給付達基本工資才扣補充保費 */
  nhiSalaryThreshold: 29500,
  /** 執行業務所得單次給付達 20,000 才扣補充保費 */
  nhiProfessionalThreshold: 20000,
} as const;

export const INCOME_TYPES: Record<string, { label: string; note: string }> = {
  "50": { label: "薪資（授課鐘點費、兼職）", note: "授課鐘點費、兼職人員的報酬屬於薪資所得" },
  "9A": { label: "執行業務所得", note: "律師、會計師、設計師等專業人士以自己名義執行業務的報酬" },
  "9B": { label: "稿費及講演鐘點費", note: "演講、專題講座的鐘點費，以及稿費、版稅" },
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface WithholdingSuggestion { withholdingTax: number; nhiSupplement: number; netAmount: number; notes: string[] }

/** 依所得類別與金額試算代扣稅款與補充保費 */
export function suggestWithholding(input: { incomeType: string; amount: number; payeeType: "teacher" | "employee" }): WithholdingSuggestion {
  const amount = round2(input.amount);
  const d = WITHHOLDING_DEFAULTS;
  const notes: string[] = [];
  let tax = 0, nhi = 0;
  if (input.incomeType === "50") {
    if (amount >= d.salaryThreshold) { tax = Math.floor(amount * d.salaryRate); notes.push(`單次給付達 ${d.salaryThreshold.toLocaleString()} 元，扣繳 5%`); }
    else notes.push(`單次給付未達 ${d.salaryThreshold.toLocaleString()} 元，免扣繳`);
    if (input.payeeType === "employee") notes.push("本公司投保的員工，薪資不另扣補充保費");
    else if (amount >= d.nhiSalaryThreshold) { nhi = Math.round(amount * d.nhiRate); notes.push("兼職薪資單次達基本工資，扣補充保費 2.11%"); }
  } else {
    const rawTax = Math.floor(amount * d.professionalRate);
    if (rawTax > d.professionalTaxFloor) { tax = rawTax; notes.push("扣繳 10%"); }
    else notes.push("應扣稅額不超過 2,000 元，免扣繳");
    if (amount >= d.nhiProfessionalThreshold) { nhi = Math.round(amount * d.nhiRate); notes.push("單次達 20,000 元，扣補充保費 2.11%"); }
  }
  return { withholdingTax: tax, nhiSupplement: nhi, netAmount: round2(amount - tax - nhi), notes };
}

/** 檢查一筆服務費的金額是否合理，回傳錯誤說明 */
export function serviceFeeProblem(fee: { amount: number; withholdingTax: number; nhiSupplement: number; hours?: number | null; rate?: number | null }): string | null {
  if (!Number.isFinite(fee.amount) || fee.amount <= 0) return "金額必須大於 0";
  if (!Number.isFinite(fee.withholdingTax) || fee.withholdingTax < 0) return "代扣稅款不可為負數";
  if (!Number.isFinite(fee.nhiSupplement) || fee.nhiSupplement < 0) return "補充保費不可為負數";
  if (fee.withholdingTax + fee.nhiSupplement >= fee.amount) return "代扣金額不可大於或等於給付金額";
  if (fee.hours != null && fee.rate != null && fee.hours > 0 && fee.rate > 0 && Math.abs(round2(fee.hours * fee.rate) - round2(fee.amount)) > 1) {
    return "金額與「時數 × 鐘點費」不一致";
  }
  return null;
}

export interface FeeRow {
  payeeType: string; teacherId: number | null; employeeId: number | null; payeeName: string;
  incomeType: string; amount: number; withholdingTax: number; nhiSupplement: number; netAmount: number;
  status: string;
}

export interface AnnualPayeeSummary {
  key: string; payeeType: string; payeeId: number | null; payeeName: string; incomeType: string;
  count: number; gross: number; withholdingTax: number; nhiSupplement: number; net: number;
  /** 已登錄但年底前還沒付的金額（所得以實際給付年度為準，這些不算在今年） */
  unpaid: number;
}

/**
 * 年度所得彙總：同一個人、同一種所得類別合成一列。
 * paid 是這一年實際付出去的；unpaid 是已登錄還沒付的，只列出來提醒，不計入所得。
 */
export function summarizeAnnualFees(paid: FeeRow[], unpaid: FeeRow[]): AnnualPayeeSummary[] {
  const map = new Map<string, AnnualPayeeSummary>();
  const entry = (row: FeeRow): AnnualPayeeSummary => {
    const payeeId = row.payeeType === "teacher" ? row.teacherId : row.employeeId;
    const key = `${row.payeeType}:${payeeId ?? row.payeeName}:${row.incomeType}`;
    let item = map.get(key);
    if (!item) {
      item = { key, payeeType: row.payeeType, payeeId, payeeName: row.payeeName, incomeType: row.incomeType, count: 0, gross: 0, withholdingTax: 0, nhiSupplement: 0, net: 0, unpaid: 0 };
      map.set(key, item);
    }
    return item;
  };
  for (const row of paid) {
    const item = entry(row);
    item.count += 1;
    item.gross = round2(item.gross + row.amount);
    item.withholdingTax = round2(item.withholdingTax + row.withholdingTax);
    item.nhiSupplement = round2(item.nhiSupplement + row.nhiSupplement);
    item.net = round2(item.net + row.netAmount);
  }
  for (const row of unpaid) {
    const item = entry(row);
    item.unpaid = round2(item.unpaid + row.amount);
  }
  return [...map.values()].sort((a, b) => a.payeeName.localeCompare(b.payeeName, "zh-Hant") || a.incomeType.localeCompare(b.incomeType));
}

import { sql } from "drizzle-orm";

/**
 * 收付款帳戶：公司實際放錢的地方（庫存現金、零用金、各家銀行存款、電子支付）。
 * 收款單、付款單、付款申請、薪資發放都要指定錢進出哪一個帳戶，
 * 否則全部記到「庫存現金」，銀行存款的帳面餘額永遠對不上存摺。
 */
export interface CashAccount { id: number; accountNumber: string; accountName: string }

/** 判斷一個科目是不是現金或銀行存款（純計算，方便測試） */
export function isCashAccount(a: { accountType: string; isGroup: boolean; accountNumber: string; accountName: string; cashFlowCategory?: string | null; parentName?: string | null }): boolean {
  if (a.isGroup || a.accountType !== "Asset") return false;
  if (a.cashFlowCategory === "cash") return true;
  // 明確被分到營業／投資／籌資活動的科目就不是現金
  if (a.cashFlowCategory) return false;
  if (/現金及約當現金|現金與約當現金/.test(a.parentName || "")) return true;
  if (/解約價值|短期投資/.test(a.accountName)) return false;
  return /^(庫存現金|零用金|現金|銀行存款|銀行存摺|活期存款|支票存款|在途現金)/.test(a.accountName);
}

export async function listCashAccounts(tx: any): Promise<CashAccount[]> {
  const result = await tx.execute(sql`
    SELECT a.id, a.account_number AS "accountNumber", a.account_name AS "accountName", a.account_type AS "accountType",
           a.is_group AS "isGroup", a.cash_flow_category AS "cashFlowCategory", p.account_name AS "parentName"
    FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_account_id
    WHERE a.is_group = false AND a.account_type = 'Asset'
    ORDER BY a.account_number
  `);
  const rows: any[] = result?.rows ?? result ?? [];
  return rows.filter(isCashAccount).map(r => ({ id: Number(r.id), accountNumber: r.accountNumber, accountName: r.accountName }));
}

type LineAccount = { accountId?: number; accountNumber?: string; accountName: string };

/**
 * 把使用者選的收付款帳戶換成分錄用的科目。
 * 沒選時沿用舊行為（「現金/銀行」→ 科目表的庫存現金），讓 API 串接與舊畫面不會壞。
 */
export async function cashLineAccount(tx: any, cashAccountId: unknown): Promise<LineAccount> {
  if (cashAccountId === undefined || cashAccountId === null || cashAccountId === "") return { accountName: "現金/銀行" };
  const id = Number(cashAccountId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("收付款帳戶格式不正確");
  const account = (await listCashAccounts(tx)).find(a => a.id === id);
  if (!account) throw new Error("收付款帳戶必須是現金或銀行存款的明細科目");
  return { accountId: account.id, accountNumber: account.accountNumber, accountName: account.accountName };
}

/** 讀一個可以過帳的明細科目，並檢查類型（例如付款申請的費用科目） */
export async function leafAccount(tx: any, accountId: unknown, label: string, allowedTypes?: string[]): Promise<LineAccount & { accountType: string }> {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`請選擇${label}`);
  const result = await tx.execute(sql`
    SELECT id, account_number AS "accountNumber", account_name AS "accountName", account_type AS "accountType", is_group AS "isGroup"
    FROM accounts WHERE id = ${id}
  `);
  const row = (result?.rows ?? result ?? [])[0];
  if (!row) throw new Error(`${label}不存在`);
  if (row.isGroup) throw new Error(`${label}「${row.accountName}」是彙總科目，請選明細科目`);
  if (allowedTypes && !allowedTypes.includes(row.accountType)) throw new Error(`${label}「${row.accountName}」的類型不對`);
  return { accountId: Number(row.id), accountNumber: row.accountNumber, accountName: row.accountName, accountType: row.accountType };
}

/** 檢查日期是真的存在的 YYYY-MM-DD */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * 薪資發放分錄的金額拆法（純計算）。
 * 出勤與請假扣款是「少發的薪資」，要從薪資費用扣掉，不能當成替員工代扣的負債。
 */
export function payrollJournalAmounts(slip: { grossSalary: number; totalDeductions: number; attendanceDeduction: number; netSalary: number; employerCost: number }) {
  const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const attendance = Math.max(0, round(slip.attendanceDeduction));
  const salaryExpense = round(slip.grossSalary - attendance);
  const withheld = round(slip.totalDeductions - attendance);
  const employerCost = round(slip.employerCost);
  const net = round(slip.netSalary);
  return { salaryExpense, withheld, employerCost, net, balanced: Math.abs(salaryExpense - withheld - net) < 0.01 };
}

/**
 * 「實際進出的新台幣」的檢查（純計算）：沒填回傳 undefined（照帳上金額，不會有兌換損益）。
 * 和帳上金額差超過三成多半是填錯（例如填成外幣金額），直接擋下來。
 */
export function parseActualCash(raw: unknown, booked: number): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const actual = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(actual) || actual <= 0) throw new Error("實際進出的台幣金額必須大於 0");
  if (!(booked > 0)) throw new Error("這筆沒有可以沖銷的帳款，不能填實際進出的台幣金額");
  if (Math.abs(actual - booked) > booked * 0.3) {
    throw new Error(`實際進出的台幣 ${actual} 和帳上金額 ${Math.round(booked * 100) / 100} 差超過三成，請確認填的是台幣金額`);
  }
  return actual;
}

export interface SettlementPart {
  /** 明細金額（發票的幣別；本幣發票就是新台幣） */
  amount: number;
  /** 發票入帳時的匯率（本幣為 1） */
  invoiceRate?: number;
  /** 實際收付當天的匯率；沒填就用發票匯率，不會有兌換損益 */
  paymentRate?: number;
  /** 訂單還沒成立就先收的訂金：記預收款項，不沖應收 */
  deposit?: boolean;
  /** 這一行自己選的對方科目（沒沖發票、沒核對訂單的行才有）：不記應收／應付，改記這個科目 */
  account?: LineAccount;
}

type SettlementLine = { accountId?: number; accountNumber?: string; accountName: string; debit: number; credit: number; description: string };

/**
 * 收款單／付款單的分錄（純計算）。
 * - 沖掉的應收（應付）用發票當時的匯率換算，和發票入帳的金額一致
 * - 實際進出的錢用收付當天的匯率換算
 * - 兩者的差額就是兌換損益
 * - 手續費（跟日記帳「一張單打多筆」同一個記法）：
 *   收款 → 借 收款帳戶（金額 − 手續費）＋ 借 手續費科目／貸 應收或對方科目（金額）
 *   付款 → 借 應付或對方科目（金額）＋ 借 手續費科目／貸 付款帳戶（金額 ＋ 手續費）
 */
export function settlementJournalLines(input: {
  kind: "receipt" | "payment"; voucherNumber: string;
  cash: { accountId?: number; accountNumber?: string; accountName: string };
  parts: SettlementPart[];
  /** 實際進出的新台幣（外幣貨款用台幣換匯去付，換到的價錢和入帳時不同）；有填就以這個數字為準 */
  actualCash?: number;
  /** 手續費合計（新台幣）；有填就一定要給手續費科目 */
  fee?: number;
  feeAccount?: LineAccount | null;
}): SettlementLine[] {
  const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  let settled = 0, deposit = 0, cash = 0, other = 0;
  // 自己選科目的行：同一個科目合成一行
  const others: Array<{ account: LineAccount; amount: number }> = [];
  for (const part of input.parts) {
    const invoiceRate = part.invoiceRate && part.invoiceRate > 0 ? part.invoiceRate : 1;
    const paymentRate = part.paymentRate && part.paymentRate > 0 ? part.paymentRate : invoiceRate;
    if (part.deposit) { deposit += part.amount; cash += part.amount; continue; }
    if (part.account) {
      const same = others.find(o => o.account.accountId !== undefined && o.account.accountId === part.account!.accountId);
      if (same) same.amount += part.amount; else others.push({ account: part.account, amount: part.amount });
      other += part.amount; cash += part.amount;
      continue;
    }
    settled += part.amount * invoiceRate;
    cash += part.amount * paymentRate;
  }
  settled = round(settled); deposit = round(deposit); cash = round(cash); other = round(other);
  const fee = round(input.fee ?? 0);
  if (fee < 0) throw new Error("手續費不可為負數");
  if (fee > 0 && !input.feeAccount) throw new Error("有填手續費時，請選擇手續費要記到哪個科目");
  const isReceipt = input.kind === "receipt";
  // 帳款金額（含匯率換算）→ 真的進出帳戶的錢：收款扣掉手續費，付款加上手續費；有填實際進出的台幣就以那個數字為準
  const booked = cash;
  cash = input.actualCash !== undefined ? round(input.actualCash) : round(isReceipt ? booked - fee : booked + fee);
  if (isReceipt && fee > 0 && cash <= 0) throw new Error("手續費不能大於或等於收到的金額");
  const fx = round((isReceipt ? cash + fee : cash - fee) - settled - deposit - other);
  const no = input.voucherNumber;
  const line = (account: { accountId?: number; accountNumber?: string; accountName: string }, debit: number, credit: number, description: string): SettlementLine =>
    ({ ...account, debit, credit, description });
  const feeLine = fee > 0 ? [line(input.feeAccount!, fee, 0, `${no} 手續費`)] : [];
  const lines = isReceipt
    ? [
      line(input.cash, cash, 0, `${no} 收款`),
      ...feeLine,
      line({ accountName: "應收帳款" }, 0, settled, `${no} 收款沖銷`),
      ...others.map(o => line(o.account, 0, round(o.amount), `${no} 收款`)),
      line({ accountName: "預收款項" }, 0, deposit, `${no} 預收訂金`),
      // 收到的新台幣比帳上應收多 → 兌換利益；比較少 → 兌換損失
      fx > 0 ? line({ accountName: "兌換利益" }, 0, fx, `${no} 兌換利益`) : line({ accountName: "兌換損失" }, -fx, 0, `${no} 兌換損失`),
    ]
    : [
      line({ accountName: "應付帳款" }, settled + deposit, 0, `${no} 付款沖銷`),
      ...others.map(o => line(o.account, round(o.amount), 0, `${no} 付款`)),
      ...feeLine,
      line(input.cash, 0, cash, `${no} 付款`),
      // 付出的新台幣比帳上應付多 → 兌換損失；比較少 → 兌換利益
      fx > 0 ? line({ accountName: "兌換損失" }, fx, 0, `${no} 兌換損失`) : line({ accountName: "兌換利益" }, 0, -fx, `${no} 兌換利益`),
    ];
  return lines.filter(l => l.debit !== 0 || l.credit !== 0);
}

/** 找開帳分錄用的對方科目金額：資產是借方餘額，負債與權益是貸方餘額（純計算） */
export function openingEntryLines(rows: Array<{ accountId: number; accountName: string; accountType: string; amount: number }>): {
  lines: Array<{ accountId: number; accountName: string; debit: number; credit: number }>; totalDebit: number; totalCredit: number; difference: number;
} {
  const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const lines = rows.filter(r => round(r.amount) !== 0).map(r => {
    const amount = round(r.amount);
    const debitNormal = r.accountType === "Asset" || r.accountType === "Expense";
    // 負數代表反方向的餘額（例如備抵呆帳是資產類但餘額在貸方）
    const onDebit = debitNormal ? amount > 0 : amount < 0;
    return { accountId: r.accountId, accountName: r.accountName, debit: onDebit ? Math.abs(amount) : 0, credit: onDebit ? 0 : Math.abs(amount) };
  });
  const totalDebit = round(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round(lines.reduce((s, l) => s + l.credit, 0));
  return { lines, totalDebit, totalCredit, difference: round(totalDebit - totalCredit) };
}

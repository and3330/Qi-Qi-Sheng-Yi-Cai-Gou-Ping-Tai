import { tenantPool } from "../tenant-db";
import { computeBu, computePnL, turnoverDays, unitCost, type AccountRow, type JournalEntryRow } from "./compute";
import { metric, monthsBetween, num, period, ratio } from "./range";
import type { ExecutiveResponse } from "./types";
import { DEAD_INVOICE_SQL, DEAD_OR_WRITTEN_OFF_SQL, PURCHASE_TYPES_SQL, SALES_TYPES_SQL, isPurchaseType, isSalesType } from "./enums";

type Range = { startDate: string; endDate: string; days: number };

export async function loadJournal(r: Range) {
  const [entries, accounts] = await Promise.all([
    tenantPool.query(
      `SELECT entry_date AS "entryDate", lines, department_id AS "departmentId", project_id AS "projectId",
              is_internal_transfer AS "isInternalTransfer", total_debit AS "totalDebit",
              transfer_from_department_id AS "transferFromDepartmentId", transfer_to_department_id AS "transferToDepartmentId"
         FROM journal_entries WHERE status <> 'Draft' AND entry_date >= $1 AND entry_date <= $2`,
      [r.startDate, r.endDate],
    ),
    tenantPool.query(`SELECT id, account_type AS "accountType", account_number AS "accountNumber" FROM accounts WHERE is_group = false`),
  ]);
  return { entries: entries.rows as JournalEntryRow[], accounts: accounts.rows as AccountRow[] };
}

/** 實際收付款：收款/付款傳票沖銷發票的金額（invoice_settlements × vouchers） */
export async function loadCashSettlements(r: Range) {
  const res = await tenantPool.query(
    `SELECT substr(v.voucher_date, 1, 7) AS month, i.invoice_type AS "invoiceType", SUM(s.amount)::float AS amount
       FROM invoice_settlements s
       JOIN vouchers v ON v.id = s.voucher_id
       JOIN invoices i ON i.id = s.invoice_id
      WHERE v.voucher_date >= $1 AND v.voucher_date <= $2 AND v.voucher_type IN ('Receipt', 'Payment')
      GROUP BY 1, 2`,
    [r.startDate, r.endDate],
  );
  return res.rows as Array<{ month: string; invoiceType: string; amount: number }>;
}

async function loadWorkingCapitalInputs(r: Range) {
  const [ar, ap, purchases, inv] = await Promise.all([
    tenantPool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(outstanding_amount),0)::float AS total FROM invoices
                       WHERE invoice_type IN ${SALES_TYPES_SQL} AND status NOT IN ${DEAD_OR_WRITTEN_OFF_SQL}`),
    tenantPool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(outstanding_amount),0)::float AS total FROM invoices
                       WHERE invoice_type IN ${PURCHASE_TYPES_SQL} AND status NOT IN ${DEAD_OR_WRITTEN_OFF_SQL}`),
    tenantPool.query(`SELECT COALESCE(SUM(COALESCE(net_amount, total_amount)),0)::float AS total FROM invoices
                       WHERE invoice_type IN ${PURCHASE_TYPES_SQL} AND status NOT IN ${DEAD_INVOICE_SQL}
                         AND invoice_date >= $1 AND invoice_date <= $2`, [r.startDate, r.endDate]),
    tenantPool.query(`SELECT current_stock AS stock, moving_avg_cost AS mac, buying_price AS bp FROM items
                       WHERE COALESCE(is_virtual,false) = false AND current_stock > 0`),
  ]);
  let invValue = 0;
  let uncosted = 0;
  for (const row of inv.rows) {
    const c = unitCost(row.mac, row.bp);
    if (c == null) uncosted += 1; else invValue += num(row.stock) * c;
  }
  return {
    ar: ar.rows[0].n > 0 ? num(ar.rows[0].total) : null,
    ap: ap.rows[0].n > 0 ? num(ap.rows[0].total) : null,
    purchases: num(purchases.rows[0].total),
    inventory: inv.rows.length > 0 ? invValue : null,
    uncosted,
  };
}

export async function buildExecutive(r: Range): Promise<ExecutiveResponse> {
  const [{ entries, accounts }, cash, wc, depts, projects] = await Promise.all([
    loadJournal(r),
    loadCashSettlements(r),
    loadWorkingCapitalInputs(r),
    tenantPool.query(`SELECT id, name FROM departments WHERE is_active = true ORDER BY name`),
    tenantPool.query(`SELECT id, department_id AS "departmentId" FROM projects`),
  ]);
  const operating = entries.filter((e) => !e.isInternalTransfer);
  const pnl = computePnL(operating, accounts);
  const hasJournal = operating.length > 0;
  const noJe = "期間內沒有已過帳的會計分錄";

  const cashByMonth = new Map<string, { in: number; out: number }>();
  let cashIn = 0;
  let cashOut = 0;
  for (const c of cash) {
    const b = cashByMonth.get(c.month) ?? { in: 0, out: 0 };
    if (isSalesType(c.invoiceType)) { b.in += c.amount; cashIn += c.amount; }
    else if (isPurchaseType(c.invoiceType)) { b.out += c.amount; cashOut += c.amount; }
    cashByMonth.set(c.month, b);
  }
  const hasCash = cash.length > 0;
  const noCash = "期間內沒有收款／付款傳票沖銷發票的紀錄";

  const monthly = monthsBetween(r.startDate, r.endDate).map((m) => {
    const p = pnl.monthly.get(m) ?? { revenue: 0, expense: 0 };
    const c = cashByMonth.get(m) ?? { in: 0, out: 0 };
    return { month: m, revenue: p.revenue, expense: p.expense, netProfit: p.revenue - p.expense, cashIn: c.in, cashOut: c.out };
  });

  const opex = pnl.expense - pnl.cogs;
  const waterfall: ExecutiveResponse["waterfall"] = hasJournal
    ? [
        { label: "營業收入", amount: pnl.revenue, kind: "start" },
        { label: "營業成本", amount: pnl.cogs, kind: "minus" },
        { label: "其他費用", amount: opex, kind: "minus" },
        { label: "本期損益", amount: pnl.revenue - pnl.expense, kind: "total" },
      ]
    : [];

  const dso = turnoverDays(wc.ar, pnl.revenue, r.days);
  const dio = turnoverDays(wc.inventory, pnl.cogs, r.days);
  const dpo = turnoverDays(wc.ap, wc.purchases, r.days);

  return {
    period: period(r),
    summary: {
      revenue: metric(hasJournal ? pnl.revenue : null, noJe),
      expense: metric(hasJournal ? pnl.expense : null, noJe),
      netProfit: metric(hasJournal ? pnl.revenue - pnl.expense : null, noJe),
      profitMargin: metric(hasJournal ? ratio(pnl.revenue - pnl.expense, pnl.revenue) : null, hasJournal ? "期間營業收入為 0，無法計算利潤率" : noJe),
      cashIn: metric(hasCash ? cashIn : null, noCash),
      cashOut: metric(hasCash ? cashOut : null, noCash),
      netCash: metric(hasCash ? cashIn - cashOut : null, noCash),
    },
    monthly,
    waterfall,
    buContributions: computeBu(entries, accounts, depts.rows, projects.rows),
    workingCapital: {
      dso: metric(dso, wc.ar == null ? "沒有未取消的銷項發票" : "期間營業收入為 0"),
      dio: metric(dio, wc.inventory == null ? "沒有有庫存且有成本的料件" : "期間沒有營業成本（5 開頭科目）分錄"),
      dpo: metric(dpo, wc.ap == null ? "沒有未取消的進項發票" : "期間沒有進項發票金額"),
      ccc: metric(dso != null && dio != null && dpo != null ? dso + dio - dpo : null, "DSO、DIO、DPO 任一無法計算"),
    },
    notes: [
      { text: "營收／費用／損益沿用損益表口徑：非草稿分錄，Income 貸減借、Expense 借減貸；內部轉撥分錄排除。" },
      { text: "現金流入／流出為收款與付款傳票實際沖銷銷項／進項發票的金額，不含未沖銷發票的其他收支。" },
      { text: "BU 貢獻沿用 BU 報表歸屬規則（表頭部門優先，其次專案所屬部門；adjustedNet 含內部轉撥）。" },
      { text: "營運資本天數使用目前應收／應付餘額與目前存貨價值（非期末時點快照），期間流量取自所選區間。" + (wc.uncosted > 0 ? `另有 ${wc.uncosted} 項有庫存料件無成本，未計入存貨價值。` : "") },
    ],
  };
}

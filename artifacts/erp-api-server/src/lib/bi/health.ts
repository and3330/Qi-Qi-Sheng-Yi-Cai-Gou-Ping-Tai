/**
 * 數據健康檢查：每次呼叫都在目前租戶連線（RLS）上即時執行唯讀 SQL，回報實際觀察值。
 * 不是 dbt/Elementary 管線；不寫入任何資料。
 */
import { selectAccountingBaseline } from "../accounting-baseline";
import { tenantPool } from "../tenant-db";
import type { HealthCheck, HealthResponse } from "./types";
import { DEAD_INVOICE_SQL, PURCHASE_TYPES_SQL, SALES_TYPES_SQL } from "./enums";

interface CheckDef {
  id: string;
  title: string;
  domain: HealthCheck["domain"];
  severity: HealthCheck["severity"];
  /** 母體數量 SQL（回傳 n） */
  scanSql: string;
  /** 違規列 SQL（回傳 label，最多取 5 筆樣本；另以 COUNT 計數） */
  failSql: string;
  detail: string;
}

const NUM = `'^-?[0-9]+([.][0-9]+)?$'`;

export const HEALTH_CHECKS: CheckDef[] = [
  {
    id: "je_unbalanced", title: "已過帳分錄借貸不平", domain: "會計", severity: "error",
    scanSql: `SELECT COUNT(*)::int AS n FROM journal_entries WHERE status <> 'Draft'`,
    failSql: `SELECT entry_number AS label FROM journal_entries WHERE status <> 'Draft' AND ABS(total_debit - total_credit) > 0.005`,
    detail: "表頭借方合計與貸方合計差異超過 0.005。",
  },
  {
    id: "je_lines_mismatch", title: "分錄明細合計與表頭不符", domain: "會計", severity: "error",
    scanSql: `SELECT COUNT(*)::int AS n FROM journal_entries WHERE status <> 'Draft'`,
    failSql: `SELECT je.entry_number AS label FROM journal_entries je
                CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN l->>'debit' ~ ${NUM} THEN (l->>'debit')::numeric ELSE 0 END),0) AS d
                                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(je.lines)='array' THEN je.lines ELSE '[]'::jsonb END) l) x
               WHERE je.status <> 'Draft' AND ABS(x.d - je.total_debit) > 0.005`,
    detail: "明細借方加總與表頭 total_debit 不一致。",
  },
  {
    id: "je_orphan_account", title: "分錄明細引用不存在的科目", domain: "會計", severity: "error",
    scanSql: `SELECT COUNT(*)::int AS n FROM journal_entries WHERE status <> 'Draft'`,
    failSql: `SELECT DISTINCT je.entry_number AS label FROM journal_entries je,
                jsonb_array_elements(CASE WHEN jsonb_typeof(je.lines)='array' THEN je.lines ELSE '[]'::jsonb END) l
               WHERE je.status <> 'Draft' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id::text = l->>'accountId')`,
    detail: "明細 accountId 在本公司科目表中找不到，報表會漏計。",
  },
  {
    id: "inv_outstanding", title: "發票未收付餘額與金額不一致", domain: "應收應付", severity: "warning",
    scanSql: `SELECT COUNT(*)::int AS n FROM invoices WHERE status NOT IN ${DEAD_INVOICE_SQL}`,
    failSql: `SELECT invoice_number AS label FROM invoices WHERE status NOT IN ${DEAD_INVOICE_SQL}
               AND ABS(total_amount - paid_amount - COALESCE(write_off_amount,0) - outstanding_amount) > 0.5`,
    detail: "總額 − 已收付 − 呆帳沖銷 ≠ 未收付餘額（容許 0.5 元）。",
  },
  {
    id: "inv_no_party", title: "發票缺少客戶或供應商", domain: "應收應付", severity: "warning",
    scanSql: `SELECT COUNT(*)::int AS n FROM invoices WHERE status NOT IN ${DEAD_INVOICE_SQL}`,
    failSql: `SELECT invoice_number AS label FROM invoices WHERE status NOT IN ${DEAD_INVOICE_SQL}
               AND ((invoice_type IN ${SALES_TYPES_SQL} AND customer_id IS NULL) OR (invoice_type IN ${PURCHASE_TYPES_SQL} AND supplier_id IS NULL))`,
    detail: "銷項發票無客戶、進項發票無供應商，客戶／供應商分析會漏計。",
  },
  {
    id: "inv_no_je", title: "已開立發票未產生會計分錄", domain: "會計", severity: "warning",
    scanSql: `SELECT COUNT(*)::int AS n FROM invoices WHERE status NOT IN ${DEAD_INVOICE_SQL}`,
    failSql: `SELECT invoice_number AS label FROM invoices WHERE status NOT IN ${DEAD_INVOICE_SQL} AND journal_entry_id IS NULL`,
    detail: "發票與帳務報表不一致，營收以分錄為準時會少計。",
  },
  {
    id: "item_negative", title: "實體料件庫存為負數", domain: "庫存", severity: "error",
    scanSql: `SELECT COUNT(*)::int AS n FROM items WHERE COALESCE(is_virtual,false) = false`,
    failSql: `SELECT item_code || ' ' || item_name AS label FROM items WHERE COALESCE(is_virtual,false) = false AND current_stock < 0`,
    detail: "負庫存會使存貨價值與週轉天數失真。",
  },
  {
    id: "item_no_cost", title: "有庫存但無成本的料件", domain: "庫存", severity: "warning",
    scanSql: `SELECT COUNT(*)::int AS n FROM items WHERE COALESCE(is_virtual,false) = false AND current_stock > 0`,
    failSql: `SELECT item_code || ' ' || item_name AS label FROM items WHERE COALESCE(is_virtual,false) = false AND current_stock > 0
               AND COALESCE(moving_avg_cost,0) <= 0 AND COALESCE(buying_price,0) <= 0`,
    detail: "移動平均成本與進價皆為 0，無法計入存貨價值。",
  },
  {
    id: "so_no_customer", title: "銷售訂單缺少客戶", domain: "銷售", severity: "warning",
    scanSql: `SELECT COUNT(*)::int AS n FROM sales_orders WHERE status NOT IN ('Cancelled','Draft')`,
    failSql: `SELECT order_number AS label FROM sales_orders WHERE status NOT IN ('Cancelled','Draft') AND customer_id IS NULL`,
    detail: "無法歸屬客戶的訂單。",
  },
  {
    id: "slip_net_mismatch", title: "薪資單實發 ≠ 應發 − 扣除", domain: "人資", severity: "error",
    scanSql: `SELECT COUNT(*)::int AS n FROM salary_slips`,
    failSql: `SELECT s.year || '-' || LPAD(s.month::text, 2, '0') || ' #' || s.employee_id AS label FROM salary_slips s
               WHERE s.net_salary <> s.gross_salary - s.total_deductions`,
    detail: "薪資單金額欄位彼此不一致。",
  },
  {
    id: "att_invalid_time", title: "出勤時間格式或工時異常", domain: "人資", severity: "warning",
    scanSql: `SELECT COUNT(*)::int AS n FROM attendance`,
    failSql: `SELECT date || ' #' || employee_id AS label FROM attendance
               WHERE (COALESCE(check_in,'') <> '' AND check_in !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
                  OR (COALESCE(check_out,'') <> '' AND check_out !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
                  OR working_hours < 0 OR working_hours > 24 OR overtime_hours < 0 OR overtime_hours > 24`,
    detail: "上下班時間不是 HH:MM 格式，或記錄工時／加班時數不在 0–24 小時之間。跨日班別（下班早於上班）不視為異常。",
  },
];

const TABLES: Array<{ table: string; label: string; dateCol: string }> = [
  { table: "journal_entries", label: "會計分錄", dateCol: "entry_date" },
  { table: "invoices", label: "發票", dateCol: "invoice_date" },
  { table: "vouchers", label: "收付款傳票", dateCol: "voucher_date" },
  { table: "sales_orders", label: "銷售訂單", dateCol: "order_date" },
  { table: "quotations", label: "報價單", dateCol: "quotation_date" },
  { table: "sales_returns", label: "銷貨退回", dateCol: "return_date" },
  { table: "items", label: "料件", dateCol: "updated_at::date::text" },
  { table: "stock_entries", label: "庫存異動", dateCol: "created_at::date::text" },
  { table: "purchase_receipts", label: "進貨單", dateCol: "receipt_date" },
  { table: "salary_slips", label: "薪資單", dateCol: "(year::text || '-' || LPAD(month::text,2,'0'))" },
  { table: "attendance", label: "出勤紀錄", dateCol: "date" },
];

export async function runCheck(def: CheckDef): Promise<HealthCheck> {
  const [scan, count, sample] = await Promise.all([
    tenantPool.query(def.scanSql),
    tenantPool.query(`SELECT COUNT(*)::int AS n FROM (${def.failSql}) f`),
    tenantPool.query(`SELECT label FROM (${def.failSql}) f LIMIT 5`),
  ]);
  const scanned = scan.rows[0].n as number;
  const observed = count.rows[0].n as number;
  return {
    id: def.id, title: def.title, domain: def.domain, severity: def.severity,
    status: scanned === 0 ? "not_applicable" : observed > 0 ? "fail" : "pass",
    observed, scanned, detail: def.detail,
    samples: sample.rows.map((r: any) => String(r.label ?? "")),
  };
}

export async function buildHealth(companyCode: string | null): Promise<HealthResponse> {
  const started = Date.now();
  const checks: HealthCheck[] = [];
  for (const def of HEALTH_CHECKS) checks.push(await runCheck(def));
  const tableCounts = [];
  for (const t of TABLES) {
    const res = await tenantPool.query(`SELECT COUNT(*)::int AS n, MAX(${t.dateCol}) AS latest FROM ${t.table}`);
    tableCounts.push({ table: t.table, label: t.label, rows: res.rows[0].n as number, latest: res.rows[0].latest ?? null });
  }
  const profile = companyCode === "83483621" ? "yubang-83483621" : "generic";
  const baseline = selectAccountingBaseline(profile);
  const codes = await tenantPool.query(`SELECT account_number AS code FROM accounts`);
  const have = new Set(codes.rows.map((r: any) => r.code as string));
  const missing = baseline.filter((b) => !have.has(b.code)).map((b) => b.code);
  return {
    computedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    checks,
    tableCounts,
    accountBaseline: { profile, expected: baseline.length, present: baseline.length - missing.length, missingCodes: missing.slice(0, 20) },
  };
}

import { sql } from "drizzle-orm";

/**
 * 關聯單據：給一張單，把整條單據鏈找出來（老闆 2026-11-17：關聯單據要加強）。
 *   來源  ：這張單是從哪張來的，一路往上追（銷貨退回 → 出貨單 → 銷貨單 → 報價單）
 *   後續  ：這張單往下產生了哪些單，一路往下追（銷貨單 → 出貨單、發票 → 付款申請、收款單）
 *   分錄  ：這張單自己開出的分錄，連同沖銷分錄
 * 全系統每個單據視窗都用這一支查，不用每個頁面各自湊。
 */
export type DocType =
  | "quotation" | "sales_order" | "delivery_note" | "sales_return"
  | "rfq" | "purchase_order" | "purchase_receipt" | "purchase_return"
  | "invoice" | "payment_request" | "voucher" | "advance" | "stock_count" | "work_order"
  | "material_request" | "subcontract_order" | "service_fee" | "asset" | "stock_entry" | "salary_slip"
  | "recurring_invoice" | "legacy_document";

export interface RelatedDoc {
  group: "source" | "next" | "entry";
  type: DocType | "journal_entry";
  id: number;
  label: string;
  number: string;
  date: string | null;
  status: string | null;
  amount: number | null;
  /** 點了要去哪一頁；分錄沒有網址，前端直接開分錄視窗 */
  href: string | null;
}

interface Meta { table: string; number: string; date: string | null; amount: string | null; label: string; kind?: string; /** 狀態欄位不叫 status 的表 */ status?: string; /** kind 不在 KIND_LABEL 裡時，用它組出顯示名稱 */ kindLabel?: (kind: string) => string; href: (id: number, number: string, kind: string | null) => string | null }

const META: Record<DocType, Meta> = {
  quotation: { table: "quotations", number: "quotation_number", date: "quotation_date", amount: "grand_total", label: "報價單", href: id => `/sales/quotations?open=${id}` },
  sales_order: { table: "sales_orders", number: "order_number", date: "order_date", amount: "total_amount", label: "銷貨單", href: id => `/sales/orders/${id}` },
  delivery_note: { table: "delivery_notes", number: "note_number", date: "delivery_date", amount: "total_amount", label: "出貨單", href: id => `/sales/delivery-notes?open=${id}` },
  sales_return: { table: "sales_returns", number: "return_number", date: "return_date", amount: "total_amount", label: "銷貨退回", href: id => `/sales/returns?open=${id}` },
  rfq: { table: "rfqs", number: "rfq_number", date: "rfq_date", amount: null, label: "詢價單", href: id => `/purchasing/rfqs?open=${id}` },
  purchase_order: { table: "purchase_orders", number: "order_number", date: "order_date", amount: "total_amount", label: "採購單", href: id => `/purchasing/orders/${id}` },
  purchase_receipt: { table: "purchase_receipts", number: "receipt_number", date: "receipt_date", amount: "total_amount", label: "進貨單", href: id => `/purchasing/receipts?open=${id}` },
  purchase_return: { table: "purchase_returns", number: "return_number", date: "return_date", amount: "total_amount", label: "進貨退出", href: id => `/purchasing/returns?open=${id}` },
  invoice: {
    table: "invoices", number: "invoice_number", date: "invoice_date", amount: "total_amount", label: "發票", kind: "invoice_type",
    href: (id, _n, kind) => (kind === "Purchase" || kind === "Debit Note" ? `/purchasing/invoices?open=${id}` : `/sales/invoices?open=${id}`),
  },
  payment_request: { table: "payment_requests", number: "request_number", date: "request_date", amount: "amount", label: "付款申請", href: id => `/accounting/payment-requests?open=${id}` },
  voucher: {
    table: "vouchers", number: "voucher_number", date: "voucher_date", amount: "total_amount", label: "請款單", kind: "voucher_type",
    href: (_id, number, kind) => `${kind === "Receipt" ? "/accounting/receipts" : kind === "Payment" ? "/accounting/payments" : "/accounting/reimbursement"}?search=${encodeURIComponent(number)}`,
  },
  advance: { table: "advances", number: "advance_number", date: "entry_date", amount: "amount", label: "代墊款", kind: "kind", href: id => `/accounting/advances?open=${id}` },
  stock_count: { table: "stock_counts", number: "count_number", date: "count_date", amount: null, label: "盤點單", href: id => `/inventory/stock-counts?open=${id}` },
  work_order: { table: "work_orders", number: "work_order_number", date: "planned_start_date", amount: null, label: "工單", href: id => `/manufacturing/work-orders?open=${id}` },
  material_request: { table: "material_requests", number: "request_number", date: "request_date", amount: null, label: "請購單", href: id => `/purchasing/material-requests?open=${id}` },
  subcontract_order: { table: "subcontract_orders", number: "order_number", date: "order_date", amount: "fee_amount", label: "外包單", href: id => `/manufacturing/subcontract-orders?open=${id}` },
  service_fee: { table: "service_fees", number: "fee_number", date: "service_date", amount: "amount", label: "服務費", href: () => "/hr/service-fees" },
  asset: { table: "assets", number: "asset_number", date: "purchase_date", amount: "purchase_cost", label: "固定資產", href: id => `/assets/register?open=${id}` },
  // 庫存異動和薪資單沒有單號欄位：用編號和年月組一個看得懂的名稱
  stock_entry: { table: "stock_entries", number: "('異動 #' || id)", date: "created_at", amount: "amount", status: "entry_type", label: "庫存異動", href: () => "/inventory/stock" },
  salary_slip: { table: "salary_slips", number: "(year || ' 年 ' || month || ' 月薪資')", date: "NULL", amount: "net_salary", label: "薪資單", href: () => "/hr/salary-slips" },
  // 定期發票範本沒有單號：用名稱；狀態是「使用中／已停用」
  recurring_invoice: { table: "recurring_invoices", number: "name", date: "next_run_date", amount: null, status: "(CASE WHEN is_active THEN 'InUse' ELSE 'Disabled' END)", label: "定期發票", href: id => `/accounting/recurring-invoices?open=${id}` },
  // 歷史單據（Ecount 原始單）：沒有狀態，名稱用舊系統的單據種類（歷史銷貨單、歷史進貨單…）
  legacy_document: { table: "legacy_documents", number: "doc_number", date: "doc_date", amount: "total", status: "NULL", kind: "doc_type", kindLabel: kind => `歷史${kind}`, label: "歷史單據", href: id => `/system/legacy-documents?open=${id}` },
};

/** 只有財務角色能看的種類（歷史單據裡有薪資與出勤、定期發票頁只開給財務）：其他角色查不到，也不會出現在別張單的關聯裡 */
const FINANCE_ONLY = new Set<DocType>(["recurring_invoice", "legacy_document"]);

export const isDocType = (t: string): t is DocType => Object.prototype.hasOwnProperty.call(META, t);

const KIND_LABEL: Record<string, string> = {
  Sales: "銷售發票", Purchase: "採購發票", "Credit Note": "銷貨折讓單", "Debit Note": "進貨折讓單",
  Receipt: "收款單", Payment: "付款單", Reimbursement: "請款單", loan: "借款", advance: "代墊款",
};

type Node = { type: DocType; id: number };
/** 一條連結：從 from 這種單，照 where 條件找到 to 這種單。$ID 會換成那張單的編號 */
interface Edge { from: DocType; to: DocType; query: (id: number) => ReturnType<typeof sql> }

const idsFrom = (table: string, where: string) => (id: number) => sql`SELECT id FROM ${sql.raw(table)} WHERE ${sql.raw(where)} = ${id} ORDER BY id LIMIT 50`;
const pointer = (table: string, column: string) => (id: number) => sql`SELECT ${sql.raw(column)} AS id FROM ${sql.raw(table)} WHERE id = ${id} AND ${sql.raw(column)} IS NOT NULL`;

/**
 * 搬進來的歷史單（銷貨單、報價單、採購單、進貨單）在 extra_fields 記著舊系統的單號（legacyDocNumber）和來源（legacySource）；
 * 歷史單據表用「來源＋種類＋單號」當唯一鍵，所以種類固定之後對得到的最多就是一張，不用猜。
 */
const LEGACY_LINKS: Array<{ type: DocType; table: string; docType: string }> = [
  { type: "sales_order", table: "sales_orders", docType: "銷貨單" },
  { type: "quotation", table: "quotations", docType: "報價單" },
  { type: "purchase_order", table: "purchase_orders", docType: "採購單" },
  { type: "purchase_receipt", table: "purchase_receipts", docType: "進貨單" },
];
const LEGACY_JOIN = "s.tenant_id = d.tenant_id AND s.extra_fields->>'legacyDocNumber' = d.doc_number AND s.extra_fields->>'legacySource' = d.source";
const legacyOf = (table: string, docType: string) => (id: number) =>
  sql`SELECT d.id FROM legacy_documents d JOIN ${sql.raw(table)} s ON ${sql.raw(LEGACY_JOIN)} WHERE s.id = ${id} AND d.doc_type = ${docType} ORDER BY d.id LIMIT 5`;
const migratedFrom = (table: string, docType: string) => (id: number) =>
  sql`SELECT s.id FROM ${sql.raw(table)} s JOIN legacy_documents d ON ${sql.raw(LEGACY_JOIN)} WHERE d.id = ${id} AND d.doc_type = ${docType} ORDER BY s.id LIMIT 50`;
/** 歷史收款單沒有 extra_fields，舊單號記在每一行明細上（items[].legacyDocNumber） */
const VOUCHER_LEGACY_JOIN = "v.tenant_id = d.tenant_id AND v.voucher_type = 'Receipt' AND jsonb_typeof(v.items) = 'array' AND v.items @> jsonb_build_array(jsonb_build_object('legacy', true, 'legacyDocNumber', d.doc_number, 'legacySource', d.source))";
const LEGACY_RECEIPT = "收款單";

/** 往上：這張單的來源 */
/** 收付款單明細裡綁的訂單（欄位名稱是程式內固定的兩個常數，不是使用者輸入） */
const orderIdsOfVoucher = (id: number, key: "salesOrderId" | "purchaseOrderId") => sql`
  SELECT DISTINCT (l->>${key})::int AS id
  FROM vouchers v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.items) = 'array' THEN v.items ELSE '[]'::jsonb END) AS l
  WHERE v.id = ${id} AND l->>${key} ~ '^[0-9]+$' ORDER BY 1 LIMIT 50`;
const vouchersOfOrder = (id: number, key: "salesOrderId" | "purchaseOrderId") => sql`
  SELECT v.id FROM vouchers v
  WHERE jsonb_typeof(v.items) = 'array' AND v.items @> jsonb_build_array(jsonb_build_object(${key}::text, ${id}::int))
  ORDER BY v.id LIMIT 50`;

const UP: Edge[] = [
  { from: "sales_order", to: "quotation", query: pointer("sales_orders", "quotation_id") },
  { from: "delivery_note", to: "sales_order", query: pointer("delivery_notes", "sales_order_id") },
  { from: "sales_return", to: "delivery_note", query: pointer("sales_returns", "delivery_note_id") },
  { from: "work_order", to: "sales_order", query: pointer("work_orders", "sales_order_id") },
  { from: "purchase_order", to: "rfq", query: idsFrom("rfqs", "purchase_order_id") },
  { from: "purchase_receipt", to: "purchase_order", query: pointer("purchase_receipts", "purchase_order_id") },
  { from: "purchase_return", to: "purchase_receipt", query: pointer("purchase_returns", "purchase_receipt_id") },
  { from: "invoice", to: "sales_return", query: idsFrom("sales_returns", "credit_note_invoice_id") },
  { from: "invoice", to: "purchase_return", query: idsFrom("purchase_returns", "debit_note_invoice_id") },
  { from: "invoice", to: "delivery_note", query: pointer("invoices", "delivery_note_id") },
  { from: "invoice", to: "sales_order", query: pointer("invoices", "sales_order_id") },
  { from: "invoice", to: "purchase_receipt", query: pointer("invoices", "purchase_receipt_id") },
  { from: "invoice", to: "purchase_order", query: pointer("invoices", "purchase_order_id") },
  { from: "payment_request", to: "invoice", query: pointer("payment_requests", "invoice_id") },
  { from: "voucher", to: "invoice", query: id => sql`SELECT DISTINCT invoice_id AS id FROM invoice_settlements WHERE voucher_id = ${id} ORDER BY 1 LIMIT 50` },
  // 收款單、付款單的明細可以直接綁銷貨單、採購單（還沒開發票就先收、先付，或沖舊系統帶來的欠款）
  { from: "voucher", to: "sales_order", query: id => orderIdsOfVoucher(id, "salesOrderId") },
  { from: "voucher", to: "purchase_order", query: id => orderIdsOfVoucher(id, "purchaseOrderId") },
  { from: "purchase_order", to: "material_request", query: idsFrom("material_requests", "purchase_order_id") },
  { from: "invoice", to: "subcontract_order", query: pointer("invoices", "subcontract_order_id") },
  { from: "service_fee", to: "sales_order", query: pointer("service_fees", "sales_order_id") },
  // 定期發票只記最後開出的那一張（last_invoice_id）
  { from: "invoice", to: "recurring_invoice", query: idsFrom("recurring_invoices", "last_invoice_id") },
  ...LEGACY_LINKS.map(l => ({ from: l.type, to: "legacy_document" as const, query: legacyOf(l.table, l.docType) })),
  { from: "voucher", to: "legacy_document", query: id => sql`SELECT d.id FROM legacy_documents d JOIN vouchers v ON ${sql.raw(VOUCHER_LEGACY_JOIN)} WHERE v.id = ${id} AND d.doc_type = ${LEGACY_RECEIPT} ORDER BY d.id LIMIT 5` },
];

/** 往下：這張單產生的後續單據 */
const DOWN: Edge[] = [
  { from: "quotation", to: "sales_order", query: idsFrom("sales_orders", "quotation_id") },
  { from: "sales_order", to: "delivery_note", query: idsFrom("delivery_notes", "sales_order_id") },
  { from: "sales_order", to: "invoice", query: idsFrom("invoices", "sales_order_id") },
  { from: "sales_order", to: "work_order", query: idsFrom("work_orders", "sales_order_id") },
  { from: "delivery_note", to: "sales_return", query: idsFrom("sales_returns", "delivery_note_id") },
  { from: "delivery_note", to: "invoice", query: idsFrom("invoices", "delivery_note_id") },
  { from: "sales_return", to: "invoice", query: pointer("sales_returns", "credit_note_invoice_id") },
  { from: "rfq", to: "purchase_order", query: pointer("rfqs", "purchase_order_id") },
  { from: "purchase_order", to: "purchase_receipt", query: idsFrom("purchase_receipts", "purchase_order_id") },
  { from: "purchase_order", to: "invoice", query: idsFrom("invoices", "purchase_order_id") },
  { from: "purchase_receipt", to: "purchase_return", query: idsFrom("purchase_returns", "purchase_receipt_id") },
  { from: "purchase_receipt", to: "invoice", query: idsFrom("invoices", "purchase_receipt_id") },
  { from: "purchase_return", to: "invoice", query: pointer("purchase_returns", "debit_note_invoice_id") },
  { from: "invoice", to: "payment_request", query: idsFrom("payment_requests", "invoice_id") },
  { from: "invoice", to: "voucher", query: id => sql`SELECT DISTINCT voucher_id AS id FROM invoice_settlements WHERE invoice_id = ${id} AND voucher_id IS NOT NULL ORDER BY 1 LIMIT 50` },
  { from: "sales_order", to: "voucher", query: id => vouchersOfOrder(id, "salesOrderId") },
  { from: "purchase_order", to: "voucher", query: id => vouchersOfOrder(id, "purchaseOrderId") },
  { from: "material_request", to: "purchase_order", query: pointer("material_requests", "purchase_order_id") },
  { from: "subcontract_order", to: "invoice", query: idsFrom("invoices", "subcontract_order_id") },
  { from: "sales_order", to: "service_fee", query: idsFrom("service_fees", "sales_order_id") },
  { from: "recurring_invoice", to: "invoice", query: pointer("recurring_invoices", "last_invoice_id") },
  ...LEGACY_LINKS.map(l => ({ from: "legacy_document" as const, to: l.type, query: migratedFrom(l.table, l.docType) })),
  { from: "legacy_document", to: "voucher", query: id => sql`SELECT v.id FROM vouchers v JOIN legacy_documents d ON ${sql.raw(VOUCHER_LEGACY_JOIN)} WHERE d.id = ${id} AND d.doc_type = ${LEGACY_RECEIPT} ORDER BY v.id LIMIT 50` },
];

/** 分錄編號尾巴的來源代碼（JE-xxxxxxxx-DN12、JE-xxxxxxxx-PQV7…）；跟 auto-entry-text 的寫法一致 */
const ENTRY_KEYS: Partial<Record<DocType, string[]>> = {
  sales_order: ["SO"], delivery_note: ["DN"], sales_return: ["SR"], purchase_receipt: ["PR"], purchase_return: ["PRR"],
  invoice: ["I", "W"], payment_request: ["PQ", "PQV"], voucher: ["RB"], advance: ["ADV"], stock_count: ["SC"], work_order: ["WO"],
  subcontract_order: ["SUB"], service_fee: ["SF", "SFP", "SFV"], stock_entry: ["SE"],
};
/** 單據上直接記著分錄編號的欄位 */
const ENTRY_COLUMNS: Partial<Record<DocType, string[]>> = {
  sales_order: ["journal_entry_id"], delivery_note: ["cogs_journal_entry_id"], invoice: ["journal_entry_id", "write_off_journal_entry_id"],
  voucher: ["journal_entry_id"], advance: ["journal_entry_id"], service_fee: ["journal_entry_id", "payment_journal_entry_id"],
};

const MAX_NODES = 120;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const dateText = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

async function walk(executor: any, start: Node, edges: Edge[], seen: Set<string>): Promise<Node[]> {
  const found: Node[] = [];
  let frontier: Node[] = [start];
  for (let depth = 0; depth < 6 && frontier.length > 0 && found.length < MAX_NODES; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const edge of edges.filter(e => e.from === node.type)) {
        for (const row of rowsOf(await executor.execute(edge.query(node.id)))) {
          const id = Number(row.id);
          const key = `${edge.to}:${id}`;
          if (!Number.isInteger(id) || id <= 0 || seen.has(key) || found.length >= MAX_NODES) continue;
          seen.add(key);
          const hit = { type: edge.to, id };
          found.push(hit); next.push(hit);
        }
      }
    }
    frontier = next;
  }
  return found;
}

async function describe(executor: any, group: "source" | "next", nodes: Node[]): Promise<RelatedDoc[]> {
  const out: RelatedDoc[] = [];
  const types = [...new Set(nodes.map(n => n.type))];
  const found = new Map<string, RelatedDoc>();
  for (const type of types) {
    const m = META[type];
    const ids = nodes.filter(n => n.type === type).map(n => n.id);
    const rows = rowsOf(await executor.execute(sql`SELECT id, ${sql.raw(m.number)} AS number, ${sql.raw(m.date ?? "NULL")} AS date, ${sql.raw(m.status ?? "status")} AS status,
      ${sql.raw(m.amount ?? "NULL")} AS amount, ${sql.raw(m.kind ?? "NULL")} AS kind
      FROM ${sql.raw(m.table)} WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`));
    for (const r of rows) {
      const kind = r.kind == null ? null : String(r.kind);
      const number = String(r.number ?? "");
      found.set(`${type}:${r.id}`, {
        group, type, id: Number(r.id), label: (kind && (KIND_LABEL[kind] ?? m.kindLabel?.(kind))) || m.label, number,
        date: dateText(r.date), status: r.status == null ? null : String(r.status),
        amount: r.amount == null ? null : Number(r.amount), href: m.href(Number(r.id), number, kind),
      });
    }
  }
  // 照找到的順序排：離這張單最近的排最前面
  for (const n of nodes) { const d = found.get(`${n.type}:${n.id}`); if (d) out.push(d); }
  return out;
}

/** 分錄在清單上叫什麼：沖銷分錄（JE-R…）、作廢時開的分錄（付款申請 PQV、服務費 SFV、出貨單 DN…-V、代墊款 ADV…-V…）、其餘就是分錄 */
function entryLabel(entryNumber: string): string {
  if (/^JE-R\d+-/.test(entryNumber)) return "沖銷分錄";
  if (/-(PQV|SFV)\d+$/.test(entryNumber) || /-DN\d+-V$/.test(entryNumber) || /^JE-ADV\d+-V/.test(entryNumber)) return "作廢分錄";
  return "分錄";
}

async function entriesOf(executor: any, node: Node): Promise<RelatedDoc[]> {
  const keys = ENTRY_KEYS[node.type] ?? [];
  const columns = ENTRY_COLUMNS[node.type] ?? [];
  const ids = new Set<number>();
  if (columns.length > 0) {
    const [row] = rowsOf(await executor.execute(sql`SELECT ${sql.raw(columns.join(", "))} FROM ${sql.raw(META[node.type].table)} WHERE id = ${node.id}`));
    for (const c of columns) { const v = Number(row?.[c]); if (Number.isInteger(v) && v > 0) ids.add(v); }
  }
  // Ecount 搬來的收付款單，分錄記在每一行明細上（legacyJournalEntryId）
  if (node.type === "voucher") {
    const [row] = rowsOf(await executor.execute(sql`SELECT jsonb_path_query_array(COALESCE(items, '[]'::jsonb), '$[*].legacyJournalEntryId') AS ids FROM vouchers WHERE id = ${node.id}`));
    const list = typeof row?.ids === "string" ? JSON.parse(row.ids) : row?.ids;
    for (const v of Array.isArray(list) ? list.slice(0, 50) : []) { const n = Number(v); if (Number.isInteger(n) && n > 0) ids.add(n); }
  }
  const patterns: string[] = [];
  if (keys.length > 0) patterns.push(`-(${keys.join("|")})${node.id}(-[A-Z0-9]+)?$`);
  if (node.type === "voucher") patterns.push(`^JE-V${node.id}-`);
  if (node.type === "advance") patterns.push(`^JE-ADV${node.id}-`);
  if (node.type === "asset") {
    patterns.push(`^JE-AST${node.id}-`);
    // 折舊、價值調整的分錄記在各自的紀錄上
    for (const table of ["asset_depreciation_entries", "asset_value_adjustments"]) {
      for (const r of rowsOf(await executor.execute(sql`SELECT journal_entry_id AS id FROM ${sql.raw(table)} WHERE asset_id = ${node.id} AND journal_entry_id IS NOT NULL ORDER BY id DESC LIMIT 60`))) ids.add(Number(r.id));
    }
  }
  if (node.type === "salary_slip") patterns.push(`^JE-SAL-[0-9]{6}-${node.id}$`);
  for (const p of patterns) {
    for (const r of rowsOf(await executor.execute(sql`SELECT id FROM journal_entries WHERE entry_number ~ ${p} ORDER BY id LIMIT 50`))) ids.add(Number(r.id));
  }
  if (ids.size === 0) return [];
  const own = [...ids];
  // 這些分錄被沖銷的話，沖銷分錄（JE-R{原分錄編號}-…）一起列出來
  const reversalPattern = `^JE-R(${own.join("|")})-`;
  const rows = rowsOf(await executor.execute(sql`SELECT id, entry_number, entry_date, status, total_debit FROM journal_entries
    WHERE id IN (${sql.join(own.map(i => sql`${i}`), sql`, `)}) OR entry_number ~ ${reversalPattern} ORDER BY entry_date, id LIMIT 80`));
  return rows.map(r => ({
    group: "entry" as const, type: "journal_entry" as const, id: Number(r.id),
    label: entryLabel(String(r.entry_number)),
    number: String(r.entry_number), date: dateText(r.entry_date), status: r.status == null ? null : String(r.status),
    amount: r.total_debit == null ? null : Number(r.total_debit), href: null,
  }));
}

/** includeEntries：只有財務角色看得到分錄，以及只開給財務的種類（歷史單據、定期發票） */
export async function relatedDocuments(executor: any, type: DocType, id: number, includeEntries: boolean): Promise<RelatedDoc[]> {
  if (!includeEntries && FINANCE_ONLY.has(type)) return [];
  const start = { type, id };
  const seen = new Set<string>([`${type}:${id}`]);
  const visible = (edges: Edge[]) => (includeEntries ? edges : edges.filter(e => !FINANCE_ONLY.has(e.from) && !FINANCE_ONLY.has(e.to)));
  const up = await walk(executor, start, visible(UP), seen);
  const down = await walk(executor, start, visible(DOWN), seen);
  return [
    ...(up.length ? await describe(executor, "source", up) : []),
    ...(down.length ? await describe(executor, "next", down) : []),
    ...(includeEntries ? await entriesOf(executor, start) : []),
  ];
}

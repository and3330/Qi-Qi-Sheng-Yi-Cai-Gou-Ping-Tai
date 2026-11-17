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
  | "invoice" | "payment_request" | "voucher" | "advance" | "stock_count" | "work_order";

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

interface Meta { table: string; number: string; date: string | null; amount: string | null; label: string; kind?: string; href: (id: number, number: string, kind: string | null) => string | null }

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
  work_order: { table: "work_orders", number: "work_order_number", date: "planned_start_date", amount: null, label: "工單", href: () => null },
};

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

/** 往上：這張單的來源 */
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
];

/** 分錄編號尾巴的來源代碼（JE-xxxxxxxx-DN12、JE-xxxxxxxx-PQV7…）；跟 auto-entry-text 的寫法一致 */
const ENTRY_KEYS: Partial<Record<DocType, string[]>> = {
  sales_order: ["SO"], delivery_note: ["DN"], sales_return: ["SR"], purchase_receipt: ["PR"], purchase_return: ["PRR"],
  invoice: ["I", "W"], payment_request: ["PQ", "PQV"], voucher: ["RB"], advance: ["ADV"], stock_count: ["SC"], work_order: ["WO"],
};
/** 單據上直接記著分錄編號的欄位 */
const ENTRY_COLUMNS: Partial<Record<DocType, string[]>> = {
  sales_order: ["journal_entry_id"], delivery_note: ["cogs_journal_entry_id"], invoice: ["journal_entry_id", "write_off_journal_entry_id"],
  voucher: ["journal_entry_id"], advance: ["journal_entry_id"],
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
    const rows = rowsOf(await executor.execute(sql`SELECT id, ${sql.raw(m.number)} AS number, ${sql.raw(m.date ?? "NULL")} AS date, status,
      ${sql.raw(m.amount ?? "NULL")} AS amount, ${sql.raw(m.kind ?? "NULL")} AS kind
      FROM ${sql.raw(m.table)} WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`));
    for (const r of rows) {
      const kind = r.kind == null ? null : String(r.kind);
      const number = String(r.number ?? "");
      found.set(`${type}:${r.id}`, {
        group, type, id: Number(r.id), label: (kind && KIND_LABEL[kind]) || m.label, number,
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

/** includeEntries：只有財務角色看得到分錄 */
export async function relatedDocuments(executor: any, type: DocType, id: number, includeEntries: boolean): Promise<RelatedDoc[]> {
  const start = { type, id };
  const seen = new Set<string>([`${type}:${id}`]);
  const up = await walk(executor, start, UP, seen);
  const down = await walk(executor, start, DOWN, seen);
  return [
    ...(up.length ? await describe(executor, "source", up) : []),
    ...(down.length ? await describe(executor, "next", down) : []),
    ...(includeEntries ? await entriesOf(executor, start) : []),
  ];
}

import { sql, eq, and, ne, inArray } from "drizzle-orm";
// Schema-only import (same table objects); callers pass the tenant transaction in.
import { accountsTable, accountingSettingsTable, journalEntriesTable, invoicesTable, salesOrdersTable, purchaseOrdersTable, itemsTable } from "@workspace/erp-db/schema";
import { autoEntryText, applyAutoText } from "./auto-entry-text";

/**
 * 自動分錄輔助：
 * 1. resolveJournalLines — 將自動分錄的 accountName 對應到會計科目表的實際科目
 *    （精確名稱比對明細科目，含備援候選名稱），讓報表（以 accountId 彙總）能納入這些分錄。
 * 2. assertPeriodOpen — 關帳日鎖定檢查。
 */

// 每個自動分錄名稱的候選科目名稱（依序嘗試精確比對，取第一個存在的明細科目）
const ACCOUNT_CANDIDATES: Record<string, string[]> = {
  "現金/銀行": ["現金/銀行", "庫存現金"],
  "應收帳款": ["應收帳款"],
  "應付帳款": ["應付帳款"],
  "進項稅額": ["進項稅額"],
  "銷項稅額": ["銷項稅額"],
  "費用": ["費用", "其他費用", "雜費", "其他管理及總務費用(管)"],
  "薪資費用": ["薪資費用", "薪資支出(管)-正職"],
  "勞健保/退休金費用（雇主）": ["勞健保/退休金費用（雇主）", "勞保費"],
  "代扣款項": ["代扣款項", "勞健保代收款"],
  "應付勞健保/退休金": ["應付勞健保/退休金", "勞健保代收款"],
  "銷貨成本": ["銷貨成本", "商品業務成本", "營業成本"],
  "存貨": ["存貨", "商品存貨", "存貨-商品"],
  "銷貨收入": ["銷貨收入", "營業收入", "銷售收入", "商品收入", "勞務收入"],
  "進貨": ["進貨", "進貨成本", "銷貨成本", "商品業務成本", "其他營業成本"],
  "呆帳損失": ["呆帳損失", "呆帳損失(營)", "呆帳損失(管)", "呆帳費用"],
  "預收款項": ["預收款項", "預收貨款", "預收收入"],
  // 講師與服務費：成本、應付與代扣科目；科目表沒有專用科目時退回最接近的
  "勞務成本": ["勞務成本", "外包費", "其他營業成本", "商品業務成本", "營業成本"],
  "應付費用": ["應付費用", "應付薪資", "其他應付款", "應付帳款"],
  "代扣稅款": ["代扣稅款", "代扣所得稅", "代收款", "勞健保代收款"],
  "代扣補充保費": ["代扣補充保費", "代扣健保費", "代收款", "勞健保代收款"],
  // 課程、服務等沒有實體貨品的收入；科目表沒有勞務收入時退回一般銷貨收入
  "勞務收入": ["勞務收入", "服務收入", "銷貨收入", "營業收入", "銷售收入", "商品收入"],
  // 金流商（綠界、藍新…）撥款時先扣掉的手續費
  "金流手續費": ["金流手續費", "支付手續費(營)", "手續費(營)", "手續費", "銀行手續費", "其他費用"],
  "兌換利益": ["兌換利益", "兌換盈益", "外幣兌換利益"],
  "兌換損失": ["兌換損失", "外幣兌換損失"],
  // 製造與庫存調整：科目表沒有專用科目時退回存貨／銷貨成本，不讓單據卡住
  // 人工與製造費用轉入在製品時的對方科目：有專用科目就用，沒有就沖減薪資費用（等於把這段薪資資本化進存貨）
  "已分攤製造成本": ["已分攤製造成本", "已分攤製造費用", "已分攤人工", "製造費用", "直接人工", "薪資費用", "薪資支出(管)-正職", "費用", "其他費用"],
  "在製品": ["在製品", "在製品存貨", "存貨", "商品存貨", "存貨-商品"],
  "製成品": ["製成品", "製成品存貨", "存貨", "商品存貨", "存貨-商品"],
  "存貨盤盈": ["存貨盤盈", "盤盈", "銷貨成本", "商品業務成本", "營業成本"],
  "存貨盤損": ["存貨盤損", "盤損", "銷貨成本", "商品業務成本", "營業成本"],
};

export const VAT_ACCOUNT_DEFINITIONS = [
  { key: "output", accountName: "銷項稅額", accountType: "Liability", accountNumber: "2281" },
  { key: "input", accountName: "進項稅額", accountType: "Asset", accountNumber: "1281" },
] as const;
type JournalLine = {
  accountId?: number;
  accountNumber?: string;
  accountName: string;
  debit: number;
  credit: number;
  description?: string;
};

/** 將分錄明細的 accountName 解析為實際科目（accountId/accountNumber）。解析不到時保留原樣。 */
export async function resolveJournalLines(tx: any, lines: JournalLine[]): Promise<JournalLine[]> {
  const wanted = new Set<string>();
  for (const line of lines) {
    if (line.accountId) continue;
    for (const cand of ACCOUNT_CANDIDATES[line.accountName] || [line.accountName]) wanted.add(cand);
  }
  if (wanted.size === 0) return lines;

  const names = Array.from(wanted);
  const rows: Array<{ id: number; accountNumber: string; accountName: string }> = await tx.execute(sql`
    SELECT id, account_number AS "accountNumber", account_name AS "accountName", account_type AS "accountType"
    FROM accounts
    WHERE is_group = false AND account_name IN (${sql.join(names.map(n => sql`${n}`), sql`, `)})
    ORDER BY account_number
  `).then((r: any) => r.rows ?? r);

  const byName = new Map<string, Array<{ id: number; accountNumber: string; accountName: string; accountType?: string }>>();
  for (const row of rows) {
    const matches = byName.get(row.accountName) || [];
    matches.push(row);
    byName.set(row.accountName, matches);
  }

  return lines.map(line => {
    if (line.accountId) return line;
    for (const cand of ACCOUNT_CANDIDATES[line.accountName] || [line.accountName]) {
      const vatDefinition = VAT_ACCOUNT_DEFINITIONS.find(definition => definition.accountName === line.accountName);
      const candidates = byName.get(cand) || [];
      const acc = vatDefinition
        ? candidates.find(candidate => candidate.accountType === vatDefinition.accountType)
        : candidates[0];
      if (acc) return { ...line, accountId: acc.id, accountNumber: acc.accountNumber, accountName: acc.accountName };
    }
    return line;
  });
}

/**
 * 自動分錄專用：解析科目後，任何有金額的明細若對不到明細科目就中止整筆交易。
 * 沒有 accountId 的已過帳分錄會讓損益表、試算表等以科目彙總的報表直接報錯或漏帳，
 * 所以寧可擋下單據、請使用者先補科目，也不寫入壞分錄。
 */
export async function resolveJournalLinesStrict(tx: any, lines: JournalLine[]): Promise<JournalLine[]> {
  const resolved = await resolveJournalLines(tx, lines);
  const missing = resolved.filter(l => !l.accountId && (Number(l.debit) !== 0 || Number(l.credit) !== 0));
  if (missing.length > 0) {
    const names = Array.from(new Set(missing.map(l => l.accountName))).join("、");
    throw new Error(`會計科目表缺少科目：${names}，請先於會計科目建立後再操作`);
  }
  return resolved;
}

type InvoiceLine = { itemId?: number | null; amount?: number | string | null; quantity?: number | string | null; rate?: number | string | null; isVirtual?: boolean | null };

/** 把未稅金額依「庫存品項金額佔比」拆成存貨與非存貨兩部分（兩者相加一定等於原金額） */
export function splitInventoryAmount(net: number, lines: Array<{ amount: number; isStock: boolean }>): { stock: number; other: number } {
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const stockTotal = lines.filter(l => l.isStock).reduce((sum, l) => sum + l.amount, 0);
  if (!(total > 0) || !(stockTotal > 0)) return { stock: 0, other: net };
  const stock = stockTotal >= total ? net : Math.round(net * (stockTotal / total) * 100) / 100;
  return { stock, other: Math.round((net - stock) * 100) / 100 };
}

/**
 * 採購發票／採購折讓的未稅金額中，有多少屬於「會進庫存的品項」。
 * 出貨時是「借 銷貨成本／貸 存貨」，所以進貨也必須「借 存貨」，存貨科目才有進有出、餘額才對得上庫存。
 * - 採購折讓（採購退回）：退回的庫存品項一律沖存貨
 * - 採購發票：要連結採購單或進貨單（走採購收貨流程、庫存會增加）才列存貨；
 *   單獨輸入、沒有收貨的發票維持列「進貨」，避免帳上有存貨、倉庫卻沒有貨
 * - 虛擬服務、沒有對應品項的明細一律不列存貨
 */
/**
 * 銷貨金額拆成「商品」與「勞務」兩部分：
 * 實體品項記商品收入，虛擬品項（課程、服務）記勞務收入；沒有對應品項的明細算商品。
 */
export async function revenueSplit(tx: any, items: unknown, amount: number): Promise<{ goods: number; service: number }> {
  const rawLines: InvoiceLine[] = Array.isArray(items) ? (items as InvoiceLine[]) : [];
  if (rawLines.length === 0) return { goods: amount, service: 0 };
  const flags = await classifyLines(tx, rawLines, false);
  // isStock = 實體商品；其餘為勞務
  const split = splitInventoryAmount(amount, flags);
  const anyService = flags.some(f => !f.isStock && f.amount > 0);
  if (!anyService) return { goods: amount, service: 0 };
  return { goods: split.stock, service: split.other };
}

/** 判斷每一行明細是不是實體（庫存）品項。品項查不到時用 unknownIsVirtual 決定。 */
async function classifyLines(tx: any, rawLines: InvoiceLine[], unknownIsVirtual: boolean): Promise<Array<{ amount: number; isStock: boolean }>> {
  const unknownIds = Array.from(new Set(rawLines.filter(l => l.itemId && l.isVirtual == null).map(l => Number(l.itemId))));
  const virtualById = new Map<number, boolean>();
  if (unknownIds.length > 0) {
    const rows: Array<{ id: number; isVirtual: boolean }> = await tx
      .select({ id: itemsTable.id, isVirtual: itemsTable.isVirtual })
      .from(itemsTable).where(inArray(itemsTable.id, unknownIds));
    for (const row of rows) virtualById.set(row.id, row.isVirtual);
  }
  return rawLines.map(l => {
    const amount = Number(l.amount) || (Number(l.quantity ?? (l as any).qty) || 0) * (Number(l.rate ?? (l as any).unitPrice) || 0);
    const itemId = l.itemId ? Number(l.itemId) : null;
    const isVirtual = l.isVirtual ?? (itemId != null ? (virtualById.get(itemId) ?? unknownIsVirtual) : unknownIsVirtual);
    return { amount: Math.max(0, amount), isStock: !isVirtual };
  });
}

/** 銷貨收入的貸方（或折讓的借方）分錄行：商品與勞務各一行 */
function revenueLines(split: { goods: number; service: number }, side: "debit" | "credit", label: string): JournalLine[] {
  const line = (accountName: string, amount: number, suffix: string): JournalLine => ({
    accountName, debit: side === "debit" ? amount : 0, credit: side === "credit" ? amount : 0, description: `${label}${suffix}`,
  });
  return [
    ...(split.goods > 0 ? [line("銷貨收入", split.goods, "")] : []),
    ...(split.service > 0 ? [line("勞務收入", split.service, "（勞務）")] : []),
  ];
}

async function invoiceInventorySplit(tx: any, inv: {
  invoiceType: string; items?: unknown; purchaseReceiptId?: number | null; purchaseOrderId?: number | null;
}, net: number): Promise<{ stock: number; other: number }> {
  const linked = inv.invoiceType === "Debit Note" || !!inv.purchaseReceiptId || !!inv.purchaseOrderId;
  const rawLines: InvoiceLine[] = Array.isArray(inv.items) ? (inv.items as InvoiceLine[]) : [];
  if (!linked || rawLines.length === 0) return { stock: 0, other: net };

  const unknownIds = Array.from(new Set(rawLines.filter(l => l.itemId && l.isVirtual == null).map(l => Number(l.itemId))));
  const virtualById = new Map<number, boolean>();
  if (unknownIds.length > 0) {
    const rows: Array<{ id: number; isVirtual: boolean }> = await tx
      .select({ id: itemsTable.id, isVirtual: itemsTable.isVirtual })
      .from(itemsTable).where(inArray(itemsTable.id, unknownIds));
    for (const row of rows) virtualById.set(row.id, row.isVirtual);
  }
  return splitInventoryAmount(net, rawLines.map(l => {
    const amount = Number(l.amount) || (Number(l.quantity) || 0) * (Number(l.rate) || 0);
    const itemId = l.itemId ? Number(l.itemId) : null;
    // 品項已被刪除（查不到）時視為非庫存
    const isVirtual = l.isVirtual ?? (itemId != null ? (virtualById.get(itemId) ?? true) : true);
    return { amount: Math.max(0, amount), isStock: itemId != null && !isVirtual };
  }));
}

/**
 * 為銷貨/採購發票自動建立日記帳分錄，並回寫 invoices.journalEntryId。
 * 銷貨：借 應收帳款 / 貸 銷貨收入、銷項稅額；採購：借 存貨（庫存品項）或 進貨（其他）、進項稅額 / 貸 應付帳款。
 * 其他發票類型（折讓單等）或金額為 0 時不產生分錄。金額以 TWD 本位（totalAmount × exchangeRate）。
 */
/**
 * 發票屬於哪個專案、哪個部門：
 * 發票自己有記就用自己的；沒有的話沿用來源訂單（銷售訂單或採購訂單）的。
 */
export async function resolveInvoiceDimensions(tx: any, inv: { projectId?: number | null; salesOrderId?: number | null; purchaseOrderId?: number | null }): Promise<{ projectId: number | null; departmentId: number | null }> {
  let order: { projectId: number | null; departmentId: number | null } | undefined;
  if (inv.salesOrderId) {
    [order] = await tx.select({ projectId: salesOrdersTable.projectId, departmentId: salesOrdersTable.departmentId })
      .from(salesOrdersTable).where(eq(salesOrdersTable.id, inv.salesOrderId));
  } else if (inv.purchaseOrderId) {
    [order] = await tx.select({ projectId: purchaseOrdersTable.projectId, departmentId: purchaseOrdersTable.departmentId })
      .from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, inv.purchaseOrderId));
  }
  return { projectId: inv.projectId ?? order?.projectId ?? null, departmentId: order?.departmentId ?? null };
}

export async function createInvoiceJournalEntry(tx: any, inv: {
  id: number; invoiceNumber: string; invoiceType: string; invoiceDate: string;
  totalAmount: string | number; exchangeRate?: string | number | null; status?: string;
  taxType?: string | null; taxAmount?: string | number | null;
  items?: unknown; purchaseReceiptId?: number | null; purchaseOrderId?: number | null; salesOrderId?: number | null;
}, opts?: { bypassLockDate?: boolean }): Promise<number | null> {
  if (inv.status === "Cancelled") return null;
  // 老闆 2026-11-18：舊系統（Ecount）搬來、當時沒開發票的歷史銷貨單，現在可以補開發票。
  // 這張單的營收與應收已經由舊系統的傳票入過帳，補開的發票只是稅務憑證，不再做一次分錄（否則營收重複）
  if (inv.salesOrderId && (inv.invoiceType === "Sales" || inv.invoiceType === "Sales Invoice")) {
    const [order] = await tx.select({ orderSource: salesOrdersTable.orderSource }).from(salesOrdersTable).where(eq(salesOrdersTable.id, inv.salesOrderId));
    if (order?.orderSource === "ecount") return null;
  }
  // This central guard applies to every invoice creation path and makes the
  // enclosing invoice transaction roll back when its accounting period is locked.
  // bypassLockDate is reserved for the admin historical backfill (includeLocked),
  // which explicitly opts in to posting into locked periods.
  if (!opts?.bypassLockDate) await assertPeriodOpen(tx, inv.invoiceDate, "建立發票自動分錄");
  const rate = Number(inv.exchangeRate) || 1;
  const amt = Math.round(Number(inv.totalAmount) * rate * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) return null;
  const tax = inv.taxType === "taxable"
    ? Math.max(0, Math.round(Number(inv.taxAmount || 0) * 100) / 100)
    : 0;
  const net = Math.round((amt - tax) * 100) / 100;
  if (tax > amt) throw new Error(`發票 ${inv.invoiceNumber} 的稅額不可大於含稅總額`);
  if (tax > 0) {
    const vatStatuses = await ensureVatAccounts(tx);
    const missing = vatStatuses.filter(status => !status.account);
    if (missing.length > 0) {
      throw new Error(`缺少營業稅專用科目：${missing.map(status => status.issue || status.accountName).join("；")}`);
    }
  }

  let lines: JournalLine[];
  let typeLabel: string;
  if (inv.invoiceType === "Sales") {
    typeLabel = "銷貨發票";
    lines = [
      { accountName: "應收帳款", debit: amt, credit: 0, description: `${inv.invoiceNumber} 銷貨` },
      ...revenueLines(await revenueSplit(tx, inv.items, net), "credit", `${inv.invoiceNumber} 銷貨收入（未稅）`),
      ...(tax > 0 ? [{ accountName: "銷項稅額", debit: 0, credit: tax, description: `${inv.invoiceNumber} 銷項稅額` }] : []),
    ];
  } else if (inv.invoiceType === "Purchase") {
    typeLabel = "採購發票";
    const split = await invoiceInventorySplit(tx, inv, net);
    lines = [
      ...(split.stock > 0 ? [{ accountName: "存貨", debit: split.stock, credit: 0, description: `${inv.invoiceNumber} 進貨入庫（未稅）` }] : []),
      ...(split.other > 0 ? [{ accountName: "進貨", debit: split.other, credit: 0, description: `${inv.invoiceNumber} 進貨/費用（未稅）` }] : []),
      ...(tax > 0 ? [{ accountName: "進項稅額", debit: tax, credit: 0, description: `${inv.invoiceNumber} 進項稅額` }] : []),
      { accountName: "應付帳款", debit: 0, credit: amt, description: `${inv.invoiceNumber} 進貨應付` },
    ];
  } else if (inv.invoiceType === "Credit Note") {
    // 銷貨折讓：沖回營收（借 銷貨收入 / 貸 應收帳款）
    typeLabel = "銷貨折讓單";
    lines = [
      ...revenueLines(await revenueSplit(tx, inv.items, net), "debit", `${inv.invoiceNumber} 銷貨退回沖回營收（未稅）`),
      ...(tax > 0 ? [{ accountName: "銷項稅額", debit: tax, credit: 0, description: `${inv.invoiceNumber} 銷貨退回沖回銷項稅額` }] : []),
      { accountName: "應收帳款", debit: 0, credit: amt, description: `${inv.invoiceNumber} 銷貨退回沖回應收` },
    ];
  } else if (inv.invoiceType === "Debit Note") {
    // 採購折讓：沖回進貨（借 應付帳款 / 貸 進貨）
    typeLabel = "採購折讓單";
    const split = await invoiceInventorySplit(tx, inv, net);
    lines = [
      { accountName: "應付帳款", debit: amt, credit: 0, description: `${inv.invoiceNumber} 採購退回沖回應付` },
      ...(split.stock > 0 ? [{ accountName: "存貨", debit: 0, credit: split.stock, description: `${inv.invoiceNumber} 採購退回存貨減少（未稅）` }] : []),
      ...(split.other > 0 ? [{ accountName: "進貨", debit: 0, credit: split.other, description: `${inv.invoiceNumber} 採購退回沖回進貨/成本（未稅）` }] : []),
      ...(tax > 0 ? [{ accountName: "進項稅額", debit: 0, credit: tax, description: `${inv.invoiceNumber} 採購退回沖回進項稅額` }] : []),
    ];
  } else {
    return null;
  }

  const resolvedLines = await resolveJournalLinesStrict(tx, lines);
  const dimensions = await resolveInvoiceDimensions(tx, inv as any);
  const entryNumber = `JE-${Date.now().toString().slice(-8)}-I${inv.id}`;
  const text = applyAutoText(await autoEntryText(tx, entryNumber), `自動分錄 - ${typeLabel} ${inv.invoiceNumber}`, resolvedLines);
  const [je] = await tx.insert(journalEntriesTable).values({
    entryNumber,
    entryDate: inv.invoiceDate,
    description: text.description,
    totalDebit: String(amt),
    totalCredit: String(amt),
    status: "Posted",
    lines: text.lines,
    projectId: dimensions.projectId,
    departmentId: dimensions.departmentId,
  }).returning();
  // 發票本身沒記專案時，順便把沿用自訂單的專案寫回發票，之後查詢不用再回頭找訂單
  await tx.update(invoicesTable).set({
    journalEntryId: je.id,
    ...((inv as any).projectId == null && dimensions.projectId != null ? { projectId: dimensions.projectId } : {}),
  }).where(eq(invoicesTable.id, inv.id));
  return je.id;
}
/** 視為「訂單成立、應認列營收」的銷貨單狀態 */
export const REVENUE_ORDER_STATUSES = ["Confirmed", "To Deliver", "Completed"];

/**
 * 未開發票訂單的營收認列：銷貨單狀態為 Confirmed/To Deliver/Completed 且沒有任何未取消的銷項發票時，
 * 自動建立分錄（借 應收帳款 / 貸 銷貨收入，全額、不含稅拆分），並回寫 sales_orders.journal_entry_id。
 * 之後補開發票（或訂單取消/退回草稿）時再呼叫本函式，會刪除訂單分錄改以發票分錄為準。
 * 必須在交易中呼叫；本函式會自行以 FOR UPDATE 鎖定訂單列，序列化並發的同步。
 */
export async function syncSalesOrderJournalEntry(tx: any, orderId: number, opts?: { bypassLockDate?: boolean }): Promise<number | null> {
  const entryId = await syncSalesOrderRevenueEntry(tx, orderId, opts);
  // 訂單成立後，之前收的訂金要從預收款轉去沖應收；訂單取消或退回草稿則轉回來
  const { syncSalesOrderDepositTransfer } = await import("./order-deposits");
  await syncSalesOrderDepositTransfer(tx, orderId);
  return entryId;
}

async function syncSalesOrderRevenueEntry(tx: any, orderId: number, opts?: { bypassLockDate?: boolean }): Promise<number | null> {
  const [order] = await tx.select({
    id: salesOrdersTable.id,
    orderNumber: salesOrdersTable.orderNumber,
    orderDate: salesOrdersTable.orderDate,
    status: salesOrdersTable.status,
    totalAmount: salesOrdersTable.totalAmount,
    journalEntryId: salesOrdersTable.journalEntryId,
    departmentId: salesOrdersTable.departmentId,
    projectId: salesOrdersTable.projectId,
    items: salesOrdersTable.items,
    orderSource: salesOrdersTable.orderSource,
  }).from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId)).for("update");
  if (!order) return null;
  // 舊系統搬來的歷史單：營收已經由舊系統的傳票入帳，這裡不再認列一次
  if (order.orderSource === "ecount") return order.journalEntryId ?? null;

  const amt = Math.round(Number(order.totalAmount) * 100) / 100;
  // 訂單成立（已確認/等待出貨/已完成）即認列營收
  const revenueRecognized = REVENUE_ORDER_STATUSES.includes(order.status) && Number.isFinite(amt) && amt > 0;

  // 已開發票的部分以發票分錄為準；訂單分錄只認列「還沒開發票」的金額，
  // 部分開票時剩餘的應收才不會從帳上消失
  const linkedInvoices: Array<{ totalAmount: string | number; exchangeRate: string | number | null }> = await tx
    .select({ totalAmount: invoicesTable.totalAmount, exchangeRate: invoicesTable.exchangeRate })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.salesOrderId, order.id),
      eq(invoicesTable.invoiceType, "Sales"),
      ne(invoicesTable.status, "Cancelled"),
    ));
  const invoiced = Math.round(linkedInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount) * (Number(inv.exchangeRate) || 1), 0) * 100) / 100;
  const uninvoiced = Math.round((amt - invoiced) * 100) / 100;

  const shouldHave = revenueRecognized && uninvoiced > 0;

  if (order.journalEntryId) {
    const [je] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, order.journalEntryId));
    if (je && shouldHave && Number(je.totalCredit) === uninvoiced && je.entryDate === order.orderDate) {
      return order.journalEntryId; // 分錄仍正確，不動
    }
    if (!opts?.bypassLockDate) await assertPeriodOpen(tx, je?.entryDate ?? order.orderDate, "調整銷貨單自動分錄");
    if (je) await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, je.id));
    await tx.update(salesOrdersTable).set({ journalEntryId: null }).where(eq(salesOrdersTable.id, order.id));
  }

  if (!shouldHave) return null;

  if (!opts?.bypassLockDate) await assertPeriodOpen(tx, order.orderDate, "建立銷貨單自動分錄");
  // 訂單金額是含稅價：收入只認未稅的部分，稅額記到銷項稅額。
  // 原本整筆含稅金額都記成收入，要等開了發票才拆稅，同一張訂單的收入在開票前後會差 5%。
  const orderNet = Math.round((uninvoiced / 1.05) * 100) / 100;
  const orderTax = Math.round((uninvoiced - orderNet) * 100) / 100;
  const lines = await resolveJournalLinesStrict(tx, [
    { accountName: "應收帳款", debit: uninvoiced, credit: 0, description: `${order.orderNumber} 銷貨（未開發票）` },
    ...revenueLines(await revenueSplit(tx, order.items, orderNet), "credit", `${order.orderNumber} 銷貨收入（未開發票，未稅）`),
    ...(orderTax > 0 ? [{ accountName: "銷項稅額", debit: 0, credit: orderTax, description: `${order.orderNumber} 銷項稅額（未開發票）` }] : []),
  ]);
  const entryNumber = `JE-${Date.now().toString().slice(-8)}-SO${order.id}`;
  const text = applyAutoText(await autoEntryText(tx, entryNumber), `自動分錄 - 銷貨單 ${order.orderNumber}（未開發票營收）`, lines);
  const [je] = await tx.insert(journalEntriesTable).values({
    entryNumber,
    entryDate: order.orderDate,
    description: text.description,
    totalDebit: String(uninvoiced),
    totalCredit: String(uninvoiced),
    status: "Posted",
    lines: text.lines,
    departmentId: order.departmentId ?? null,
    projectId: order.projectId ?? null,
  }).returning();
  await tx.update(salesOrdersTable).set({ journalEntryId: je.id }).where(eq(salesOrdersTable.id, order.id));
  return je.id;
}

/** 取得關帳日（無設定回傳 null） */
export async function getLockDate(dbOrTx: any): Promise<string | null> {
  const [row] = await dbOrTx.select().from(accountingSettingsTable).limit(1);
  return row?.lockDate || null;
}

/** 若日期落在關帳日（含）之前則拋出錯誤 */
export async function assertPeriodOpen(dbOrTx: any, date: string | null | undefined, action: string): Promise<void> {
  if (!date) return;
  const lockDate = await getLockDate(dbOrTx);
  if (lockDate && date <= lockDate) {
    throw new Error(`${lockDate}（含）以前已關帳，無法${action}。如需調整請先修改關帳日。`);
  }
}

/** 刪除發票的自動分錄（取消/作廢/刪除發票時同步沖回），並清空 invoices.journalEntryId。 */
export async function deleteInvoiceJournalEntry(tx: any, inv: { id: number; journalEntryId?: number | null }, opts?: { skipUnlink?: boolean }): Promise<void> {
  if (!inv.journalEntryId) return;
  await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, inv.journalEntryId));
  if (!opts?.skipUnlink) {
    await tx.update(invoicesTable).set({ journalEntryId: null }).where(eq(invoicesTable.id, inv.id));
  }
}

export type VatAccountStatus = {
  key: typeof VAT_ACCOUNT_DEFINITIONS[number]["key"];
  accountName: string;
  accountType: string;
  accountNumber: string;
  account: {
    id: number;
    accountNumber: string;
    accountName: string;
    accountType: string;
    isGroup: boolean;
  } | null;
  availableAccounts: Array<{
    id: number;
    accountNumber: string;
    accountName: string;
    accountType: string;
    isGroup: boolean;
  }>;
  issue: string | null;
};

/**
 * 建立缺少的標準營業稅科目。若預設科目編號已被其他科目使用，保留現況並
 * 回傳缺少狀態，讓使用者改用科目表選擇或先處理編號衝突。
 */
export async function ensureVatAccounts(tx: any): Promise<VatAccountStatus[]> {
  for (const definition of VAT_ACCOUNT_DEFINITIONS) {
    const statuses = await getVatAccountStatuses(tx);
    const current = statuses.find(status => status.key === definition.key);
    if (current?.account) continue;
    if (current?.issue && !current.issue.startsWith("找不到")) continue;

    const [numberConflict] = await tx
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.accountNumber, definition.accountNumber))
      .limit(1);
    if (numberConflict) continue;

    await tx.insert(accountsTable).values({
      accountNumber: definition.accountNumber,
      accountName: definition.accountName,
      accountType: definition.accountType,
      parentAccountId: null,
      balance: "0",
      isGroup: false,
    }).onConflictDoNothing();
  }
  return getVatAccountStatuses(tx);
}

/** Ensure the dedicated input/output VAT accounts can be used before an irreversible operation. */
export async function assertVatAccountsReady(tx: any): Promise<void> {
  const statuses = await ensureVatAccounts(tx);
  const missing = statuses.filter(status => !status.account);
  if (missing.length > 0) {
    throw new Error(`缺少營業稅專用科目：${missing.map(status => status.issue || status.accountName).join("；")}`);
  }
}

/**
 * 取得營業稅專用科目狀態。報表用這個結果告知使用者科目是否可供自動分錄使用，
 * 而不是在讀取報表時偷偷建立科目。
 */
export async function getVatAccountStatuses(tx: any): Promise<VatAccountStatus[]> {
  const definitions = VAT_ACCOUNT_DEFINITIONS;
  const accounts: Array<{
    id: number;
    accountNumber: string;
    accountName: string;
    accountType: string;
    isGroup: boolean;
  }> = await tx
    .select({
      id: accountsTable.id,
      accountNumber: accountsTable.accountNumber,
      accountName: accountsTable.accountName,
      accountType: accountsTable.accountType,
      isGroup: accountsTable.isGroup,
    })
    .from(accountsTable)
    .orderBy(accountsTable.accountNumber);

  const availableByType = new Map<string, VatAccountStatus["availableAccounts"]>();
  for (const account of accounts) {
    if (!account.isGroup) {
      const available = availableByType.get(account.accountType) || [];
      available.push(account);
      availableByType.set(account.accountType, available);
    }
  }

  return definitions.map(definition => {
    const matches = accounts.filter(account =>
      account.accountName === definition.accountName && account.accountType === definition.accountType && !account.isGroup
    );
    const account = matches[0] || null;
    const wrongType = accounts.find(existing =>
      existing.accountName === definition.accountName && existing.accountType !== definition.accountType && !existing.isGroup
    );
    const numberConflict = accounts.find(existing =>
      existing.accountNumber === definition.accountNumber && existing.accountName !== definition.accountName
    );
    return {
      ...definition,
      account,
      availableAccounts: availableByType.get(definition.accountType) || [],
      issue: account
        ? null
        : wrongType
          ? `「${definition.accountName}」目前是${wrongType.accountType}科目，應為${definition.accountType}科目`
          : numberConflict
            ? `預設科目編號 ${definition.accountNumber} 已由「${numberConflict.accountName}」使用，請至科目表選擇或調整科目`
          : `找不到「${definition.accountName}」科目`,
    };
  });
}

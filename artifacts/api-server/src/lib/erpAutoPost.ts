import { eq, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  erpInvoicesTable,
  salesOrdersTable,
  salesOrderItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  suppliersTable,
  type ErpJournalLine,
} from "@workspace/db";
import { createAutoJournalEntry, todayISO } from "./erpAutoJournal";
import { logger } from "./logger";

/**
 * 商城金流 / ERP 單據 → 會計自動立帳。
 *
 * 設計原則：
 * - 各函式獨立交易、冪等（erp_journal_entries 的 (source_type, source_id) 部分唯一索引
 *   與 erp_invoices 的 sales_order_id / purchase_order_id 部分唯一索引防重複入帳）。
 * - 呼叫端以 fire-and-forget（.catch 記 log）掛在業務流程之後：
 *   自動立帳失敗不阻斷訂單/單據流程，可透過重跑補帳。
 * - 傳票日期使用當日（業務發生日），關帳日僅約束人工會計寫入路徑。
 */

/** 商城訂單收款（pending→paid 或錢包結帳即付）：借 現金/銀行或錢包負債、貸 銷貨收入 */
export async function postShopOrderPaid(orderId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));
    if (!order || order.totalAmount <= 0) return;
    const isWallet = order.paymentMethod === "wallet";
    const lines: ErpJournalLine[] = [
      {
        accountName: isWallet ? "錢包儲值負債" : "銀行存款",
        debit: order.totalAmount,
        credit: 0,
      },
      { accountName: "銷貨收入", debit: 0, credit: order.totalAmount },
    ];
    await createAutoJournalEntry(tx, {
      entryDate: todayISO(),
      description: `商城訂單 ${order.orderNo} 收款自動立帳`,
      reference: order.orderNo,
      lines,
      sourceType: "shop_order_paid",
      sourceId: String(order.id),
    });
  });
}

/** 商城訂單退款（cancelled/returned 且已付款）：沖回收款分錄 */
export async function postShopOrderRefund(orderId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // 僅在原收款傳票存在時沖回
    const existing = await tx.execute(
      sql`SELECT id FROM erp_journal_entries WHERE source_type = 'shop_order_paid' AND source_id = ${String(orderId)} LIMIT 1`,
    );
    if ((existing.rows ?? existing).length === 0) return;
    const [order] = await tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));
    if (!order || order.totalAmount <= 0) return;
    const isWallet = order.paymentMethod === "wallet";
    await createAutoJournalEntry(tx, {
      entryDate: todayISO(),
      description: `商城訂單 ${order.orderNo} 退款沖回自動立帳`,
      reference: order.orderNo,
      lines: [
        { accountName: "銷貨退回", debit: order.totalAmount, credit: 0 },
        {
          accountName: isWallet ? "錢包儲值負債" : "銀行存款",
          debit: 0,
          credit: order.totalAmount,
        },
      ],
      sourceType: "shop_order_refund",
      sourceId: String(order.id),
    });
  });
}

/** 分潤入帳（訂單完成）：借 分潤費用、貸 錢包儲值負債 */
export async function postProfitShare(
  recordId: number,
  orderNo: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await db.transaction(async (tx) => {
    await createAutoJournalEntry(tx, {
      entryDate: todayISO(),
      description: `訂單 ${orderNo} 分潤入帳自動立帳`,
      reference: orderNo,
      lines: [
        { accountName: "分潤費用", debit: amount, credit: 0 },
        { accountName: "錢包儲值負債", debit: 0, credit: amount },
      ],
      sourceType: "profit_share",
      sourceId: String(recordId),
    });
  });
}

/**
 * ERP 原生銷貨單確認 → 產生 AR 發票 + 自動傳票（借應收/貸銷貨收入+銷項稅額）。
 * 連動商城的銷貨單（source=shop/quotation）不在此立帳（由商城收款路徑立帳）。
 */
export async function postErpSalesOrderInvoice(salesOrderId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [so] = await tx
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, salesOrderId));
    if (!so || so.source !== "erp" || so.totalAmount <= 0) return;
    // 冪等：已有對應發票則跳過
    const [dup] = await tx
      .select({ id: erpInvoicesTable.id })
      .from(erpInvoicesTable)
      .where(eq(erpInvoicesTable.salesOrderId, salesOrderId))
      .limit(1);
    if (dup) return;
    const items = await tx
      .select()
      .from(salesOrderItemsTable)
      .where(eq(salesOrderItemsTable.salesOrderId, salesOrderId));
    const total = so.totalAmount;
    const net = Math.round(total / 1.05);
    const tax = total - net;
    const result = await tx.execute(
      sql`SELECT COUNT(*)::int AS n FROM erp_invoices WHERE invoice_type = 'Sales'`,
    );
    const n = Number((result.rows ?? result)[0]?.n || 0);
    const invoiceNumber = `SINV-${String(n + 1).padStart(6, "0")}`;
    const [inv] = await tx
      .insert(erpInvoicesTable)
      .values({
        invoiceNumber,
        invoiceType: "Sales",
        customerId: so.customerId,
        salesOrderId: so.id,
        invoiceDate: todayISO(),
        totalAmount: total,
        paidAmount: 0,
        outstandingAmount: total,
        taxType: "taxable",
        taxRate: 5,
        netAmount: net,
        taxAmount: tax,
        status: "Unpaid",
        items: items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.unitPrice * it.quantity,
        })),
        remarks: `銷貨單 ${so.soNo} 自動開立`,
      })
      .returning();
    const jeId = await createAutoJournalEntry(tx, {
      entryDate: todayISO(),
      description: `銷貨單 ${so.soNo} 發票 ${invoiceNumber} 自動立帳`,
      reference: invoiceNumber,
      lines: [
        { accountName: "應收帳款", debit: total, credit: 0 },
        { accountName: "銷貨收入", debit: 0, credit: net },
        ...(tax > 0 ? [{ accountName: "銷項稅額", debit: 0, credit: tax }] : []),
      ],
      sourceType: "invoice",
      sourceId: String(inv.id),
    });
    await tx
      .update(erpInvoicesTable)
      .set({ journalEntryId: jeId })
      .where(eq(erpInvoicesTable.id, inv.id));
  });
}

/** 採購單收貨 → 產生 AP 發票 + 自動傳票（借存貨+進項稅額/貸應付帳款） */
export async function postPurchaseOrderInvoice(purchaseOrderId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [po] = await tx
      .select()
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, purchaseOrderId));
    if (!po || po.totalAmount <= 0) return;
    const [dup] = await tx
      .select({ id: erpInvoicesTable.id })
      .from(erpInvoicesTable)
      .where(eq(erpInvoicesTable.purchaseOrderId, purchaseOrderId))
      .limit(1);
    if (dup) return;
    const [supplier] = await tx
      .select()
      .from(suppliersTable)
      .where(eq(suppliersTable.id, po.supplierId));
    const items = await tx
      .select()
      .from(purchaseOrderItemsTable)
      .where(eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrderId));
    const total = po.totalAmount;
    const net = Math.round(total / 1.05);
    const tax = total - net;
    const result = await tx.execute(
      sql`SELECT COUNT(*)::int AS n FROM erp_invoices WHERE invoice_type = 'Purchase'`,
    );
    const n = Number((result.rows ?? result)[0]?.n || 0);
    const invoiceNumber = `PINV-${String(n + 1).padStart(6, "0")}`;
    const [inv] = await tx
      .insert(erpInvoicesTable)
      .values({
        invoiceNumber,
        invoiceType: "Purchase",
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        invoiceDate: todayISO(),
        totalAmount: total,
        paidAmount: 0,
        outstandingAmount: total,
        taxType: "taxable",
        taxRate: 5,
        netAmount: net,
        taxAmount: tax,
        status: "Unpaid",
        items: items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity,
          unitCost: it.unitCost,
          amount: it.unitCost * it.quantity,
        })),
        remarks: `採購單 ${po.poNo} 收貨自動開立（${supplier?.name ?? ""}）`,
      })
      .returning();
    const jeId = await createAutoJournalEntry(tx, {
      entryDate: todayISO(),
      description: `採購單 ${po.poNo} 發票 ${invoiceNumber} 自動立帳`,
      reference: invoiceNumber,
      lines: [
        { accountName: "存貨", debit: net, credit: 0 },
        ...(tax > 0 ? [{ accountName: "進項稅額", debit: tax, credit: 0 }] : []),
        { accountName: "應付帳款", debit: 0, credit: total },
      ],
      sourceType: "invoice",
      sourceId: String(inv.id),
    });
    await tx
      .update(erpInvoicesTable)
      .set({ journalEntryId: jeId })
      .where(eq(erpInvoicesTable.id, inv.id));
  });
}

/** fire-and-forget 包裝：自動立帳失敗記 log、不阻斷業務流程 */
export function autoPost(label: string, fn: () => Promise<void>): void {
  fn().catch((err) => {
    logger.error({ err, label }, "ERP 自動立帳失敗");
  });
}

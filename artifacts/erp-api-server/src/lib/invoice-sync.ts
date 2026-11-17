import { sql, eq, and, inArray } from "drizzle-orm";
import { invoicesTable, invoiceSettlementsTable, salesOrdersTable, activitiesTable, itemsTable, deliveryNotesTable } from "@workspace/erp-db";
import { syncSalesOrderJournalEntry } from "./auto-journal";
import { advanceAllocationForInvoices } from "./order-payments";

/**
 * 依 invoice_settlements 重算發票的已收付/未收付金額與狀態。
 * 必須在交易 (tx) 內呼叫，且呼叫前應已鎖定相關發票列。
 */
export async function recomputeInvoices(tx: any, invoiceIds: number[]) {
  if (invoiceIds.length === 0) return;
  let ids = Array.from(new Set(invoiceIds));
  let invoices = await tx.select().from(invoicesTable).where(inArray(invoicesTable.id, ids));
  // 直接對訂單收（付）的錢要依發票先後分配，所以同一張訂單的發票必須一起重算
  let advanceAllocation = new Map<number, number>();
  if (invoices.some((inv: any) => inv.salesOrderId != null || inv.purchaseOrderId != null)) {
    const advance = await advanceAllocationForInvoices(tx, invoices);
    advanceAllocation = advance.allocation;
    const extra = advance.siblingIds.filter(id => !ids.includes(id));
    if (extra.length > 0) {
      ids = [...ids, ...extra];
      invoices = await tx.select().from(invoicesTable).where(inArray(invoicesTable.id, ids));
    }
  }
  const sums = await tx
    .select({ invoiceId: invoiceSettlementsTable.invoiceId, total: sql<string>`COALESCE(SUM(${invoiceSettlementsTable.amount}), 0)` })
    .from(invoiceSettlementsTable)
    .where(inArray(invoiceSettlementsTable.invoiceId, ids))
    .groupBy(invoiceSettlementsTable.invoiceId);
  const sumMap = new Map<number, number>(sums.map((s: any) => [s.invoiceId, Number(s.total)]));
  const paidToUnpaid = new Set<number>();
  for (const inv of invoices) {
    if (inv.status === "Cancelled") continue;
    // 已轉呆帳的發票不參與收款重算：餘額已透過呆帳分錄沖銷，
    // 如需再收款請先取消呆帳（cancel-write-off）恢復為未付款。
    if (inv.status === "WrittenOff") continue;
    const total = Number(inv.totalAmount);
    const paid = (sumMap.get(inv.id) || 0) + (advanceAllocation.get(inv.id) || 0);
    const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
    let status = inv.status;
    if (outstanding <= 0.001 && total > 0) status = "Paid";
    else if (status === "Paid") { status = "Unpaid"; paidToUnpaid.add(inv.id); }
    else if (status === "Draft" && paid > 0) status = "Unpaid";
    await tx.update(invoicesTable).set({
      paidAmount: String(Math.round(paid * 100) / 100),
      outstandingAmount: String(outstanding),
      status,
    }).where(eq(invoicesTable.id, inv.id));
  }

  // 發票收款狀態變動後，同步檢查關聯銷貨單是否可標示完成
  const orderIds: number[] = Array.from(new Set<number>(
    invoices
      .filter((inv: any) => inv.salesOrderId != null && (inv.invoiceType === "Sales" || inv.invoiceType === "Sales Invoice"))
      .map((inv: any) => Number(inv.salesOrderId)),
  ));
  // settlement 路徑僅針對「全部品項皆為虛擬服務」的訂單自動完成，
  // 實體商品訂單的完成狀態仍由出貨流程驅動，避免付清但未出貨就被標完成。
  await syncSalesOrderCompletion(tx, orderIds, { requireAllVirtual: true });

  // 收款被刪除或沖回（發票由 Paid 退回）時，因收款而完成的訂單狀態需自動退回
  const revertOrderIds: number[] = Array.from(new Set<number>(
    invoices
      .filter((inv: any) => inv.salesOrderId != null && (inv.invoiceType === "Sales" || inv.invoiceType === "Sales Invoice") && inv.status === "Paid" && paidToUnpaid.has(inv.id))
      .map((inv: any) => Number(inv.salesOrderId)),
  ));
  await revertSalesOrderCompletion(tx, revertOrderIds);
}

/** 判斷銷貨單品項是否全部為虛擬服務（優先採用單據快照 isVirtual，缺快照時查目前品項設定；自由輸入品項視為非虛擬） */
async function orderItemsAllVirtual(tx: any, items: any[]): Promise<boolean> {
  if (!Array.isArray(items) || items.length === 0) return false;
  const needLookup: number[] = [];
  for (const it of items) {
    if (it?.isVirtual === true) continue;
    if (it?.isVirtual === false) return false;
    const itemId = Number(it?.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) return false; // 無品項連結，無法確認為虛擬服務
    needLookup.push(itemId);
  }
  if (needLookup.length === 0) return true;
  const rows = await tx
    .select({ id: itemsTable.id, isVirtual: itemsTable.isVirtual })
    .from(itemsTable)
    .where(inArray(itemsTable.id, Array.from(new Set(needLookup))));
  const map = new Map<number, boolean>(rows.map((r: any) => [r.id, r.isVirtual === true]));
  return needLookup.every((id) => map.get(id) === true);
}

/**
 * 若銷貨單的所有銷貨發票皆已收款（Paid），自動將銷貨單標示為已完成。
 * 純虛擬服務訂單不經出貨流程，完成狀態由此收款路徑驅動。
 * requireAllVirtual: true 時，僅當訂單所有品項皆為虛擬服務才標完成
 * （settlement 路徑使用；直接將發票標記 Paid 的既有行為則不受此限制）。
 * 必須在交易 (tx) 內呼叫。
 */
export async function syncSalesOrderCompletion(
  tx: any,
  salesOrderIds: number[],
  opts: { requireAllVirtual?: boolean } = {},
) {
  const ids = Array.from(new Set(salesOrderIds)).filter((id) => Number.isFinite(id));
  if (ids.length === 0) return;
  const orders = await tx
    .select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, status: salesOrdersTable.status, items: salesOrdersTable.items })
    .from(salesOrdersTable)
    .where(inArray(salesOrdersTable.id, ids));
  for (const order of orders) {
    if (order.status === "Cancelled" || order.status === "Completed") continue;
    if (opts.requireAllVirtual) {
      const isAllVirtual = await orderItemsAllVirtual(tx, order.items as any[]);
      if (!isAllVirtual) continue;
    }
    const linked = await tx
      .select({ status: invoicesTable.status })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.salesOrderId, order.id), inArray(invoicesTable.invoiceType, ["Sales", "Sales Invoice"])));
    const active = linked.filter((l: any) => l.status !== "Cancelled");
    const allPaid = active.length > 0 && active.every((l: any) => l.status === "Paid");
    if (!allPaid) continue;
    await tx.update(salesOrdersTable).set({ status: "Completed" }).where(eq(salesOrdersTable.id, order.id));
    await tx.insert(activitiesTable).values({
      type: "update",
      title: "訂單收款完成",
      description: `${order.orderNumber} 所有發票已收款，訂單狀態更新為已完成`,
      module: "Sales",
    });
  }
}

/**
 * 收款被刪除或沖回導致發票由 Paid 退回時，將「因收款而完成」的銷貨單狀態退回。
 * 由出貨覆蓋率完成的訂單（所有實體品項皆已出貨）不受收款回沖影響。
 * 必須在交易 (tx) 內呼叫。
 */
export async function revertSalesOrderCompletion(tx: any, salesOrderIds: number[]) {
  const ids = Array.from(new Set(salesOrderIds)).filter((id) => Number.isFinite(id));
  if (ids.length === 0) return;
  const orders = await tx
    .select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, status: salesOrdersTable.status, items: salesOrdersTable.items })
    .from(salesOrdersTable)
    .where(inArray(salesOrdersTable.id, ids));
  for (const order of orders) {
    if (order.status !== "Completed") continue;

    // 若所有銷貨發票仍為 Paid（例如其他發票的收款未被影響），不需退回
    const linked = await tx
      .select({ status: invoicesTable.status })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.salesOrderId, order.id), inArray(invoicesTable.invoiceType, ["Sales", "Sales Invoice"])));
    const active = linked.filter((l: any) => l.status !== "Cancelled");
    if (active.length > 0 && active.every((l: any) => l.status === "Paid")) continue;

    // 計算出貨覆蓋率：實體品項全部出貨完成的訂單屬「出貨完成」，不因收款回沖而退回
    const orderItems = Array.isArray(order.items) ? (order.items as any[]) : [];
    const physicalItems: any[] = [];
    for (const it of orderItems) {
      if (it?.isVirtual === true) continue;
      if (it?.isVirtual === false) { physicalItems.push(it); continue; }
      const itemId = Number(it?.itemId);
      if (!Number.isInteger(itemId) || itemId <= 0) { physicalItems.push(it); continue; }
      const [row] = await tx.select({ isVirtual: itemsTable.isVirtual }).from(itemsTable).where(eq(itemsTable.id, itemId));
      if (row?.isVirtual !== true) physicalItems.push(it);
    }

    let revertTo = "To Deliver";
    if (physicalItems.length > 0) {
      const dns = await tx
        .select({ items: deliveryNotesTable.items })
        .from(deliveryNotesTable)
        .where(and(eq(deliveryNotesTable.salesOrderId, order.id), sql`${deliveryNotesTable.status} IN ('Submitted','Completed')`));
      const delivered: Record<number, number> = {};
      for (const dn of dns) {
        for (const it of (dn.items as any[]) || []) {
          delivered[it.itemId] = (delivered[it.itemId] || 0) + Number(it.quantity || 0);
        }
      }
      let allFulfilled = true;
      let anyFulfilled = false;
      for (const oi of physicalItems) {
        const qty = delivered[Number(oi.itemId)] || 0;
        if (qty >= Number(oi.quantity || 0)) anyFulfilled = true;
        else allFulfilled = false;
        if (qty > 0) anyFulfilled = true;
      }
      if (allFulfilled) continue; // 出貨覆蓋完成的訂單維持 Completed
      revertTo = anyFulfilled ? "To Deliver" : "Draft";
    }

    await tx.update(salesOrdersTable).set({ status: revertTo }).where(eq(salesOrdersTable.id, order.id));
    // 退回 Draft 時移除未開發票營收分錄；退回 To Deliver 仍屬成立狀態，分錄不變
    await syncSalesOrderJournalEntry(tx, order.id);
    await tx.insert(activitiesTable).values({
      type: "update",
      title: "訂單收款回沖",
      description: `${order.orderNumber} 發票收款被刪除或沖回，訂單狀態由已完成退回為「${revertTo}」`,
      module: "Sales",
    });
  }
}

import { eq, sql } from "drizzle-orm";
import { journalEntriesTable, salesOrdersTable } from "@workspace/erp-db/schema";
import { assertPeriodOpen, REVENUE_ORDER_STATUSES } from "./auto-journal";
import { postAutoJournal, round2, todayTaipei } from "./inventory-journal";

/**
 * 預收款（訂金）的轉列。
 *
 * 銷貨單還在草稿、還沒成立時先收的錢，帳上沒有應收帳款可以沖，收款單會記成「預收款項」（負債）。
 * 等訂單成立、系統認列應收與營收之後，這筆預收要轉去沖應收：借 預收款項／貸 應收帳款。
 * 訂單取消或退回草稿時再轉回來。每張訂單最多一張轉列分錄（編號尾碼 -SOD訂單編號），金額變了就重開。
 */
export async function syncSalesOrderDepositTransfer(tx: any, orderId: number): Promise<void> {
  const [order] = await tx.select({
    id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, status: salesOrdersTable.status,
    projectId: salesOrdersTable.projectId, departmentId: salesOrdersTable.departmentId,
  }).from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId));
  if (!order) return;

  const depositResult = await tx.execute(sql`
    SELECT COALESCE(SUM((item->>'amount')::numeric), 0) AS total
    FROM vouchers v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.items) = 'array' THEN v.items ELSE '[]'::jsonb END) item
    WHERE v.voucher_type = 'Receipt' AND v.status <> '已作廢'
      AND item->>'salesOrderId' = ${String(orderId)} AND item->>'asDeposit' = 'true'
  `);
  const deposits = round2(Number((depositResult?.rows ?? depositResult ?? [])[0]?.total ?? 0));
  const desired = REVENUE_ORDER_STATUSES.includes(order.status) ? deposits : 0;

  const key = `SOD${orderId}`;
  const existingResult = await tx.execute(sql`
    SELECT id, entry_date AS "entryDate", total_debit AS "totalDebit" FROM journal_entries
    WHERE entry_number LIKE ${"%-" + key} AND status <> 'Draft'
  `);
  const existing: Array<{ id: number; entryDate: string; totalDebit: string }> = existingResult?.rows ?? existingResult ?? [];
  const current = round2(existing.reduce((sum, row) => sum + Number(row.totalDebit), 0));
  if (current === desired) return;

  for (const row of existing) {
    await assertPeriodOpen(tx, row.entryDate, "調整預收款轉列分錄");
    await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, row.id));
  }
  if (desired <= 0) return;
  await postAutoJournal(tx, {
    key,
    entryDate: todayTaipei(),
    description: `自動分錄 - 銷貨單 ${order.orderNumber} 預收款轉列應收`,
    action: "預收款轉列",
    projectId: order.projectId ?? null,
    departmentId: order.departmentId ?? null,
    lines: [
      { accountName: "預收款項", debit: desired, credit: 0, description: `${order.orderNumber} 預收款轉出` },
      { accountName: "應收帳款", debit: 0, credit: desired, description: `${order.orderNumber} 以預收款沖銷應收` },
    ],
  });
}

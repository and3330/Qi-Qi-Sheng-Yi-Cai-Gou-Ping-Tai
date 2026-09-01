import { eq, sql } from "drizzle-orm";
import {
  db,
  erpCustomersTable,
  salesOrdersTable,
  salesOrderItemsTable,
  type Member,
  type Order,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 會員自動對應 ERP 客戶（member_id 部分唯一索引防重複）。
 * 回傳 erp_customers.id。
 */
export async function ensureErpCustomerForMember(
  tx: Tx,
  member: Pick<
    Member,
    | "id"
    | "name"
    | "username"
    | "phone"
    | "email"
    | "shippingAddress"
    | "boundInstitutionId"
    | "institutionVerified"
  >,
): Promise<number> {
  const inserted = await tx
    .insert(erpCustomersTable)
    .values({
      code: `C${String(member.id).padStart(6, "0")}`,
      name: member.name || member.username,
      memberId: member.id,
      institutionId: member.institutionVerified
        ? member.boundInstitutionId
        : null,
      phone: member.phone ?? null,
      email: member.email ?? null,
      address: member.shippingAddress ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: erpCustomersTable.id });
  if (inserted.length > 0) return inserted[0].id;
  const [existing] = await tx
    .select({ id: erpCustomersTable.id })
    .from(erpCustomersTable)
    .where(eq(erpCustomersTable.memberId, member.id))
    .limit(1);
  return existing.id;
}

export interface SalesOrderLine {
  productId: number;
  variantId: number | null;
  variantName: string | null;
  productName: string;
  productCode: string;
  unitPrice: number;
  quantity: number;
  unitCost: number;
  isVirtual: boolean;
}

/**
 * 商城訂單 → ERP 銷貨單（同一交易內，庫存已由商城路徑扣除，這裡只建單據）。
 * sales_orders.order_id 有部分唯一索引，重複建立會直接失敗（防重複單據）。
 */
export async function createSalesOrderForShopOrder(
  tx: Tx,
  order: Order,
  customerId: number,
  customerName: string,
  lines: SalesOrderLine[],
  source: "shop" | "quotation" = "shop",
): Promise<number> {
  const [so] = await tx
    .insert(salesOrdersTable)
    .values({
      soNo: `SO-${order.orderNo}`,
      source,
      customerId,
      customerName,
      orderId: order.id,
      orderNo: order.orderNo,
      status: "confirmed",
      totalAmount: order.totalAmount,
      note: order.note ?? null,
      confirmedAt: new Date(),
    })
    .returning({ id: salesOrdersTable.id });
  await tx.insert(salesOrderItemsTable).values(
    lines.map((l) => ({
      salesOrderId: so.id,
      productId: l.productId,
      variantId: l.variantId,
      variantName: l.variantName,
      productName: l.productName,
      productCode: l.productCode,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      unitCost: l.unitCost,
      isVirtual: l.isVirtual,
    })),
  );
  return so.id;
}

/** 商城訂單狀態變更 → 同步對應銷貨單狀態（同一交易內呼叫） */
export async function syncSalesOrderStatusForOrder(
  tx: Tx,
  orderId: number,
  target: string,
) {
  const map: Record<string, Partial<typeof salesOrdersTable.$inferInsert>> = {
    paid: { status: "confirmed", confirmedAt: sql`now()` as unknown as Date },
    shipped: { status: "shipped", shippedAt: sql`now()` as unknown as Date },
    completed: {
      status: "completed",
      completedAt: sql`now()` as unknown as Date,
    },
    cancelled: { status: "cancelled" },
    returned: { status: "returned" },
  };
  const set = map[target];
  if (!set) return;
  await tx
    .update(salesOrdersTable)
    .set(set)
    .where(eq(salesOrdersTable.orderId, orderId));
}

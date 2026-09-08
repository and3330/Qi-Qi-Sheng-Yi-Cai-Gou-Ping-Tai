import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { membersTable } from "./members";
import { institutionsTable } from "./institutions";
import { erpEmployeesTable } from "./erpHr";

/**
 * 報價單：後台建立、綁定機構／會員客戶，可轉為正式訂單
 */
export const quotationsTable = pgTable(
  "quotations",
  {
    id: serial("id").primaryKey(),
    quoteNo: text("quote_no").notNull().unique(),
    // 客戶：會員（轉訂單必填）與／或機構
    memberId: integer("member_id").references(() => membersTable.id),
    institutionId: integer("institution_id").references(() => institutionsTable.id),
    customerName: text("customer_name").notNull(),
    // draft | sent | accepted | converted | cancelled
    status: text("status").notNull().default("draft"),
    totalAmount: integer("total_amount").notNull().default(0),
    validUntil: timestamp("valid_until"),
    note: text("note"),
    // 轉出的訂單
    convertedOrderId: integer("converted_order_id"),
    createdBy: integer("created_by").notNull(),
    // 製單人：可與建立帳號（createdBy）不同
    creatorEmployeeId: integer("creator_employee_id").references(() => erpEmployeesTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_quotations_status").on(t.status, t.createdAt)],
);

export const quotationItemsTable = pgTable("quotation_items", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id")
    .notNull()
    .references(() => quotationsTable.id),
  productId: integer("product_id").notNull(),
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  // 報價單價（可與牌價不同）
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
});

export type Quotation = typeof quotationsTable.$inferSelect;
export type QuotationItem = typeof quotationItemsTable.$inferSelect;

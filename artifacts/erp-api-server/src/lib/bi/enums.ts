/**
 * 實際單據列舉值（依 routes/invoices.ts、vouchers.ts、salary-slips.ts）。
 * 發票類型：現行寫入為 "Sales"/"Purchase"；舊資料可能為 "Sales Invoice"/"Purchase Invoice"，兩者皆有效。
 */
export const SALES_TYPES_SQL = `('Sales','Sales Invoice')`;
export const PURCHASE_TYPES_SQL = `('Purchase','Purchase Invoice')`;
/** 不計入營收／採購的發票狀態（作廢流程中的狀態也排除） */
export const DEAD_INVOICE_SQL = `('Cancelled','Draft','Voided','VoidPending','VoidReconcileRequired')`;
/** 計算未收付餘額時另排除已轉呆帳 */
export const DEAD_OR_WRITTEN_OFF_SQL = `('Cancelled','Draft','Voided','VoidPending','VoidReconcileRequired','WrittenOff')`;

export const isSalesType = (t: string | null | undefined) => t === "Sales" || t === "Sales Invoice";
export const isPurchaseType = (t: string | null | undefined) => t === "Purchase" || t === "Purchase Invoice";

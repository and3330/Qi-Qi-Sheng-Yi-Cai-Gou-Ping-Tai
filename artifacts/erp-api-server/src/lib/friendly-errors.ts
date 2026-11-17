const FIELD_LABELS: Record<string, string> = {
  id: "編號",
  customerId: "客戶",
  supplierId: "供應商",
  itemId: "品項",
  items: "品項明細",
  quantity: "數量",
  rate: "單價",
  orderDate: "訂單日期",
  deliveryDate: "交貨日期",
  expectedDate: "預計到貨日",
  status: "狀態",
  amount: "金額",
  accountId: "會計科目",
  debit: "借方金額",
  credit: "貸方金額",
};

type ValidationError = {
  issues?: readonly { path?: readonly (string | number | symbol)[] }[];
};

export function friendlyValidationError(error: ValidationError): string {
  const fields = [...new Set((error.issues || []).map(issue => {
    const path = issue.path || [];
    const field = [...path].reverse().find(part => typeof part === "string");
    return typeof field === "string" ? (FIELD_LABELS[field] || field) : "資料";
  }))];
  return `資料格式有誤：${fields.join("、") || "資料"} 為必填或格式不正確`;
}

export function friendlyCaughtError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /[\u3400-\u9fff]/.test(message) ? message : fallback;
}
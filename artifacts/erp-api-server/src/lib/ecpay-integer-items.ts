/** 只檢查新開票，舊的結果未明請求仍沿用快照對帳，不能換內容重開。 */
export function assertIntegerInvoiceItems(items: { count: number; unitPrice: number; amount: number }[]) {
  if (items.some(it => !Number.isSafeInteger(it.count) || it.count <= 0 ||
    !Number.isSafeInteger(it.unitPrice) || it.unitPrice < 0 ||
    !Number.isSafeInteger(it.amount) || it.amount <= 0 ||
    it.count * it.unitPrice !== it.amount)) {
    throw Object.assign(new Error("請使用整數含稅單價 × 數量，且與小計一致；無法整除時請先核對，系統不會自動更改總額"), { statusCode: 400 });
  }
}

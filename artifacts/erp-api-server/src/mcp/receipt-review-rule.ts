/** 誰用 AI 開收款單可以直接入帳；其他人一律送財務確認款項有沒有收到（老闆 2026-11-18） */
export const RECEIPT_DIRECT_ROLES = ["super_admin", "owner", "admin", "finance_admin", "accountant"];

export const needsReceiptReview = (method: string, path: string, body: Record<string, unknown> | undefined, role: string | null | undefined): boolean =>
  method === "POST" && path === "/vouchers" && body?.voucherType === "收款單" && !RECEIPT_DIRECT_ROLES.includes(role || "");

import type { Request, Response, NextFunction } from "express";

/**
 * 專案是收支統計的單位：每一筆收入與支出單據都必須歸屬到專案。
 * 這個守門在路由之前檢查「新增單據一定要帶 projectId」「修改時不可把專案清空」。
 *
 * 不在這裡處理的：
 * - 由其他單據轉出的單據（例如訂單轉出貨單）沿用來源單據的專案，不經過這些路徑。
 * - 日記帳分錄：只有動到收入／費用科目時才要求專案，在 journal-entries 路由內判斷。
 */
export const PROJECT_REQUIRED_MESSAGE = "請選擇專案：每一筆收入與支出都必須歸屬到專案";

const DOCUMENTS = [
  "quotations",
  "sales-orders",
  "delivery-notes",
  "sales-returns",
  "purchase-orders",
  "purchase-receipts",
  "purchase-returns",
  "payment-requests",
  "vouchers",
];

const CREATE_PATHS = new Set([...DOCUMENTS.map((d) => `/${d}`), "/create-sales-order"]);
const UPDATE_PATH = new RegExp(`^/(${DOCUMENTS.join("|")})/\\d+$`);

export function isMissingProject(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  const id = Number(value);
  return !Number.isInteger(id) || id <= 0;
}

export function projectRequiredGuard(req: Request, res: Response, next: NextFunction): void {
  const body = (req.body ?? {}) as Record<string, any>;
  let missing = false;

  if (req.method === "POST") {
    if (req.path === "/quotations/with-customer") missing = isMissingProject(body["quotation"]?.projectId);
    else if (CREATE_PATHS.has(req.path)) missing = isMissingProject(body["projectId"]);
  } else if ((req.method === "PATCH" || req.method === "PUT") && UPDATE_PATH.test(req.path)) {
    // 修改時沒帶 projectId 代表不動它；有帶就不能是空的
    missing = Object.prototype.hasOwnProperty.call(body, "projectId") && isMissingProject(body["projectId"]);
  }

  if (missing) {
    res.status(400).json({ error: PROJECT_REQUIRED_MESSAGE });
    return;
  }
  next();
}

/**
 * 批次操作的管制規則。批次端點直接改資料表，不會經過各單據自己的流程，
 * 所以凡是「狀態會連動庫存或帳務」「已經入帳」的資料，都不能用批次繞過：
 *
 * 1. 角色：批次操作的角色要求與該模組的單筆操作一致
 * 2. 狀態：會連動庫存／分錄／沖銷的單據，狀態只能逐筆在單據頁變更
 * 3. 刪除：交易單據只能刪草稿；已入帳的流水紀錄一律不能刪
 */

const FINANCE = ["owner", "admin", "finance_admin", "accountant"];
const HR = ["owner", "admin", "hr_admin"];
const PAYROLL = ["owner", "admin", "hr_admin", "finance_admin"];
const LEAVE_APPROVERS = ["owner", "admin", "hr_admin", "manager"];

/** 批次操作需要的角色（沒列的維持「登入即可」，與單筆操作一致） */
export const BATCH_ENTITY_ROLES: Record<string, string[]> = {
  "journal-entries": FINANCE,
  vouchers: FINANCE,
  invoices: FINANCE,
  accounts: FINANCE,
  "payment-requests": FINANCE,
  "asset-depreciation": FINANCE,
  currencies: FINANCE,
  employees: HR,
  "salary-slips": PAYROLL,
  leaves: LEAVE_APPROVERS,
};

/** 狀態變更會連動庫存、分錄、沖銷或營收認列的單據：不開放批次改狀態 */
export const STATUS_LOCKED_ENTITIES = new Set([
  "sales-orders", "purchase-orders", "delivery-notes", "purchase-receipts",
  "sales-returns", "purchase-returns", "journal-entries", "invoices", "vouchers",
  "salary-slips", "payment-requests", "work-orders", "assets", "stock-entries",
]);

/** 已入帳或有下游連動的流水紀錄：不開放批次刪除，必須逐筆走單據自己的作廢／刪除流程 */
export const DELETE_FORBIDDEN_ENTITIES: Record<string, string> = {
  "stock-entries": "庫存異動是已入帳的流水紀錄，不能刪除；數量有誤請另建一筆反向異動沖回",
  invoices: "發票不支援批次刪除，請逐筆處理，以確保分錄、收款與綠界稅務狀態一致",
  vouchers: "傳票會連動分錄與發票沖銷，不支援批次刪除，請逐筆處理",
  "asset-depreciation": "折舊已入帳，不能批次刪除",
};

/** 交易單據：只有草稿可以刪，已確認的單據要先走作廢流程 */
export const DRAFT_ONLY_DELETE_ENTITIES = new Set([
  "sales-orders", "purchase-orders", "delivery-notes", "purchase-receipts",
  "sales-returns", "purchase-returns", "journal-entries", "salary-slips",
  "payment-requests", "work-orders", "assets", "quotations",
]);

const DRAFT_STATUSES = new Set(["draft", "草稿"]);
export const isDraftStatus = (status: unknown): boolean => DRAFT_STATUSES.has(String(status ?? "").trim().toLowerCase());

interface Actor { role?: string | null; apiKey?: boolean; apiKeyPermissions?: string | null }

/** 回傳錯誤訊息；有權限時回傳 null。API key 只有 admin 權限可通過角色管制（與 requireRole 一致） */
export function batchRoleError(entity: string, actor: Actor): string | null {
  const roles = BATCH_ENTITY_ROLES[entity];
  if (!roles) return null;
  if (actor.apiKey) return actor.apiKeyPermissions === "admin" ? null : "此 API Key 權限不足以執行角色保護的操作";
  if (actor.role === "super_admin" || (actor.role && roles.includes(actor.role))) return null;
  return "權限不足：這類資料的批次操作僅限有權限的角色";
}

/** 批次更新的欄位是否違反管制；通過回傳 null */
export function batchUpdateError(entity: string, label: string, fields: string[]): string | null {
  if (fields.includes("status") && STATUS_LOCKED_ENTITIES.has(entity)) {
    return `${label}的狀態會連動庫存或帳務，不能批次變更，請逐筆在單據頁操作`;
  }
  return null;
}

export type BatchDeleteRule = { kind: "forbidden"; message: string } | { kind: "draft-only" } | { kind: "open" };

export function batchDeleteRule(entity: string): BatchDeleteRule {
  const message = DELETE_FORBIDDEN_ENTITIES[entity];
  if (message) return { kind: "forbidden", message };
  if (DRAFT_ONLY_DELETE_ENTITIES.has(entity)) return { kind: "draft-only" };
  return { kind: "open" };
}

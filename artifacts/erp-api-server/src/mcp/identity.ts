import { createHash, timingSafeEqual } from "node:crypto";

/**
 * MCP 身分與權限。
 *
 * 每個機器人用自己的金鑰，金鑰綁定一種職務；金鑰只放在部署環境的 Secrets，不進資料庫也不進程式碼：
 * - ERP_AI_KEY_SALES     業務：客戶、報價單
 * - ERP_AI_KEY_FINANCE   財務：發票草稿、收款草稿、寄送預覽、對帳
 * - ERP_AI_KEY_READONLY  唯讀：只能查詢
 * - ERP_AI_KEY_ADMIN     全權：可以操作所有模組（付款、發薪、作廢、刪除與系統設定仍留給人）
 * - ERP_AI_KEY           原有共用金鑰：維持原本的 10 個工具，不會因為這次擴充而多出權限
 *
 * 動作分兩級：
 * - 直接生效：建客戶、開報價單、對帳配對（可在 ERP 裡修改或取消）
 * - 草稿待人確認：開發票、收款、付款（牽涉稅務與金錢）。寄發票給客戶一律由人在 ERP 按下寄出。
 */
export type McpRole = "sales" | "finance" | "readonly" | "admin" | "legacy";

export const ROLE_ENV: Record<McpRole, string> = {
  sales: "ERP_AI_KEY_SALES",
  finance: "ERP_AI_KEY_FINANCE",
  readonly: "ERP_AI_KEY_READONLY",
  admin: "ERP_AI_KEY_ADMIN",
  legacy: "ERP_AI_KEY",
};

export const ROLE_LABEL: Record<McpRole, string> = { sales: "業務", finance: "財務", readonly: "唯讀", admin: "全權", legacy: "共用（舊）" };

const READ_TOOLS = ["search_customers", "search_documents", "get_document"] as const;
const FINANCE_READ_TOOLS = ["get_finance_summary", "list_receivables", "list_overdue_customers"] as const;
const LEGACY_TOOLS = [
  ...READ_TOOLS, ...FINANCE_READ_TOOLS,
  "create_receipt_draft", "create_document_draft", "list_my_drafts", "create_customer_draft",
] as const;

/** 只有全權身分才有的工具 */
export const ADMIN_ONLY_TOOLS = ["erp_list_endpoints", "erp_request", "get_quotation_pdf", "send_quotation_pdf"] as const;

export const ROLE_TOOLS: Record<McpRole, readonly string[]> = {
  readonly: [...READ_TOOLS, ...FINANCE_READ_TOOLS, "list_unmatched_bank_entries", "preview_invoice_email"],
  sales: [...READ_TOOLS, "create_customer", "create_customer_draft", "create_quotation", "list_my_drafts", "request_quotation_email"],
  finance: [
    ...READ_TOOLS, ...FINANCE_READ_TOOLS,
    "create_document_draft", "create_receipt_draft", "list_my_drafts",
    "list_unmatched_bank_entries", "match_bank_entry", "preview_invoice_email", "request_invoice_email",
  ],
  legacy: LEGACY_TOOLS,
  // 全權：原本所有工具，加上通用操作與報價單 PDF
  admin: [
    ...READ_TOOLS, ...FINANCE_READ_TOOLS,
    "create_customer", "create_customer_draft", "create_quotation", "create_document_draft", "create_receipt_draft", "list_my_drafts",
    "list_unmatched_bank_entries", "match_bank_entry", "preview_invoice_email", "request_quotation_email", "request_invoice_email",
    ...ADMIN_ONLY_TOOLS,
  ],
};

/** 這些工具會直接改動正式資料（其餘 create_* 只建立待確認草稿） */
export const DIRECT_WRITE_TOOLS = new Set(["create_customer", "create_quotation", "match_bank_entry", "erp_request", "send_quotation_pdf"]);

export function roleAllows(role: McpRole, tool: string): boolean {
  return ROLE_TOOLS[role].includes(tool);
}

/** 業務身分只能用草稿工具開報價單，不能藉由通用草稿工具建立發票或付款草稿 */
export function roleAllowsDraftType(role: McpRole, docType: string): boolean {
  if (role === "finance" || role === "legacy" || role === "admin") return true;
  return false;
}

const digest = (value: string) => createHash("sha256").update(value).digest();
const sameKey = (supplied: string, key: string) => supplied.length > 0 && key.length > 0 && timingSafeEqual(digest(supplied), digest(key));

export type IdentityResult =
  | { ok: true; role: McpRole }
  | { ok: false; reason: "unconfigured" | "misconfigured" | "unauthorized" };

/**
 * 由 Authorization 標頭判斷身分。
 * - 沒有設定任何金鑰 → unconfigured
 * - 兩種職務設成同一把金鑰 → misconfigured（無法分辨身分，寧可整個停用）
 * - 金鑰過短（少於 24 個字元）→ 視為未設定，避免弱金鑰
 */
export function resolveIdentity(header: string | undefined, env: Record<string, string | undefined>): IdentityResult {
  const configured = (Object.keys(ROLE_ENV) as McpRole[])
    .map(role => ({ role, key: (env[ROLE_ENV[role]] || "").trim() }))
    .filter(entry => entry.key.length >= 24 || (entry.role === "legacy" && entry.key.length > 0));
  if (configured.length === 0) return { ok: false, reason: "unconfigured" };
  const distinct = new Set(configured.map(entry => entry.key));
  if (distinct.size !== configured.length) return { ok: false, reason: "misconfigured" };

  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  let matched: McpRole | null = null;
  // 每一把都比對，不因為先比中就提早結束
  for (const entry of configured) if (sameKey(supplied, entry.key)) matched = entry.role;
  return matched ? { ok: true, role: matched } : { ok: false, reason: "unauthorized" };
}

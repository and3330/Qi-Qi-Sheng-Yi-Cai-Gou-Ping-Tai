import { describe, expect, it } from "vitest";
import { DIRECT_WRITE_TOOLS, ROLE_TOOLS, resolveIdentity, roleAllows, roleAllowsDraftType } from "./identity";

const SALES = "sales-key-0123456789abcdefghij";
const FINANCE = "finance-key-0123456789abcdefgh";
const READONLY = "readonly-key-0123456789abcdefg";
const env = { ERP_AI_KEY_SALES: SALES, ERP_AI_KEY_FINANCE: FINANCE, ERP_AI_KEY_READONLY: READONLY, ERP_AI_KEY: "legacy" };

describe("MCP 身分辨識", () => {
  it("每把金鑰對應自己的職務", () => {
    expect(resolveIdentity(`Bearer ${SALES}`, env)).toEqual({ ok: true, role: "sales" });
    expect(resolveIdentity(`Bearer ${FINANCE}`, env)).toEqual({ ok: true, role: "finance" });
    expect(resolveIdentity(`Bearer ${READONLY}`, env)).toEqual({ ok: true, role: "readonly" });
    expect(resolveIdentity("Bearer legacy", env)).toEqual({ ok: true, role: "legacy" });
  });

  it("錯誤、空白或格式不對的金鑰一律拒絕", () => {
    for (const header of [undefined, "", "Bearer ", "Bearer wrong", SALES, `Basic ${SALES}`, `Bearer ${SALES}x`]) {
      expect(resolveIdentity(header, env)).toEqual({ ok: false, reason: "unauthorized" });
    }
  });

  it("完全沒設定金鑰時停用；過短的職務金鑰視為沒設定", () => {
    expect(resolveIdentity(`Bearer ${SALES}`, {})).toEqual({ ok: false, reason: "unconfigured" });
    expect(resolveIdentity("Bearer short", { ERP_AI_KEY_SALES: "short" })).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("兩種職務設成同一把金鑰時整個停用，不猜身分", () => {
    expect(resolveIdentity(`Bearer ${SALES}`, { ERP_AI_KEY_SALES: SALES, ERP_AI_KEY_FINANCE: SALES })).toEqual({ ok: false, reason: "misconfigured" });
  });
});

describe("MCP 職務權限", () => {
  it("業務只能碰客戶與報價單，碰不到發票、收款、對帳與財務報表", () => {
    expect(roleAllows("sales", "create_customer")).toBe(true);
    expect(roleAllows("sales", "create_quotation")).toBe(true);
    for (const tool of ["create_receipt_draft", "create_document_draft", "match_bank_entry", "get_finance_summary", "list_receivables", "preview_invoice_email"]) {
      expect(roleAllows("sales", tool)).toBe(false);
    }
    expect(roleAllowsDraftType("sales", "sales_invoice")).toBe(false);
    // 寄信只能提出請求：業務寄報價單、財務寄發票，互不越界
    expect(roleAllows("sales", "request_quotation_email")).toBe(true);
    expect(roleAllows("sales", "request_invoice_email")).toBe(false);
    expect(roleAllows("finance", "request_invoice_email")).toBe(true);
    expect(roleAllows("readonly", "request_quotation_email")).toBe(false);
    expect(roleAllows("readonly", "request_invoice_email")).toBe(false);
  });

  it("財務可以開發票與收款草稿、對帳，但不能建客戶或直接開報價單", () => {
    for (const tool of ["create_document_draft", "create_receipt_draft", "match_bank_entry", "list_unmatched_bank_entries", "preview_invoice_email"]) {
      expect(roleAllows("finance", tool)).toBe(true);
    }
    expect(roleAllows("finance", "create_customer")).toBe(false);
    expect(roleAllows("finance", "create_quotation")).toBe(false);
  });

  it("唯讀身分沒有任何會寫入的工具", () => {
    for (const tool of ROLE_TOOLS.readonly) {
      expect(tool.startsWith("create_")).toBe(false);
      expect(DIRECT_WRITE_TOOLS.has(tool)).toBe(false);
    }
  });

  it("原有共用金鑰維持原本的 10 個工具，不會多出直接生效的權限", () => {
    expect(ROLE_TOOLS.legacy).toHaveLength(10);
    for (const tool of DIRECT_WRITE_TOOLS) expect(roleAllows("legacy", tool)).toBe(false);
  });

  it("全權以外的身分不能直接開發票、收款或寄信：這些只有草稿或預覽", () => {
    const all = new Set(Object.entries(ROLE_TOOLS).filter(([role]) => role !== "admin").flatMap(([, tools]) => tools));
    for (const forbidden of ["create_invoice", "issue_invoice", "send_invoice_email", "create_receipt", "create_payment"]) {
      expect(all.has(forbidden)).toBe(false);
    }
    // 會直接生效的工具：前三個依職務開放；通用操作與直接寄報價單只有全權身分有
    expect([...DIRECT_WRITE_TOOLS].sort()).toEqual(["create_customer", "create_quotation", "erp_request", "match_bank_entry", "send_quotation_pdf"]);
    for (const tool of ["erp_request", "send_quotation_pdf"]) expect(all.has(tool)).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({ db: {}, journalEntriesTable: {}, invoicesTable: {}, salesOrdersTable: {}, accountsTable: {}, accountingSettingsTable: {}, insuranceBracketsTable: {} }));
vi.mock("@workspace/erp-db/schema", () => ({ journalEntriesTable: {}, invoicesTable: {}, salesOrdersTable: {}, accountsTable: {}, accountingSettingsTable: {}, warehousesTable: {}, insuranceBracketsTable: {} }));
vi.mock("../../middleware/require-auth", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  sessionOnly: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { selectAccountingBaseline } from "../accounting-baseline";
import { resolveJournalLines } from "../auto-journal";
import { KEY_AUTO_JOURNAL_ACCOUNTS } from "../foundation";
import { isPlatformAdmin, parseBracket } from "../../routes/insurance-brackets";

describe("通用會計科目基線", () => {
  it("涵蓋所有自動分錄需要的科目（新開戶或一鍵補齊後，單據都能入帳）", async () => {
    const leafRows = selectAccountingBaseline("generic")
      .filter(a => !a.isGroup)
      .map((a, i) => ({ id: i + 1, accountNumber: a.code, accountName: a.displayName, accountType: a.accountType }));
    const tx = { execute: async () => ({ rows: leafRows }) };
    const resolved = await resolveJournalLines(
      tx,
      KEY_AUTO_JOURNAL_ACCOUNTS.map(accountName => ({ accountName, debit: 0, credit: 0 })),
    );
    expect(resolved.filter(l => !l.accountId).map(l => l.accountName)).toEqual([]);
  });
});

describe("投保級距驗證", () => {
  it("接受正常級距，最高薪資可留空", () => {
    expect(parseBracket({ minSalary: 0, maxSalary: 29500, insuredAmount: 29500 })).toEqual({ minSalary: 0, maxSalary: 29500, insuredAmount: 29500 });
    expect(parseBracket({ minSalary: 45801, maxSalary: "", insuredAmount: 45800 })).toEqual({ minSalary: 45801, maxSalary: null, insuredAmount: 45800 });
  });

  it("拒絕負數、小數、上限小於下限", () => {
    expect(typeof parseBracket({ minSalary: -1, insuredAmount: 100 })).toBe("string");
    expect(typeof parseBracket({ minSalary: 0, insuredAmount: 100.5 })).toBe("string");
    expect(typeof parseBracket({ minSalary: 500, maxSalary: 100, insuredAmount: 500 })).toBe("string");
    expect(typeof parseBracket(null)).toBe("string");
  });
});

describe("投保級距維護權限", () => {
  const req = (user: unknown, apiKeyAuth = false) => ({ session: { user }, apiKeyAuth }) as any;

  it("只有平台方的 owner/admin 與 super_admin 可以維護", () => {
    expect(isPlatformAdmin(req({ id: 1, role: "owner", tenantId: 1 }))).toBe(true);
    expect(isPlatformAdmin(req({ id: 1, role: "admin", tenantId: 1 }))).toBe(true);
    expect(isPlatformAdmin(req({ id: 9, role: "super_admin", tenantId: 5 }))).toBe(true);
  });

  it("其他公司的管理員、平台方的一般角色、API Key 都不行", () => {
    expect(isPlatformAdmin(req({ id: 2, role: "owner", tenantId: 2 }))).toBe(false);
    expect(isPlatformAdmin(req({ id: 3, role: "hr_admin", tenantId: 1 }))).toBe(false);
    expect(isPlatformAdmin(req({ id: 1, role: "owner", tenantId: 1 }, true))).toBe(false);
    expect(isPlatformAdmin(req(undefined))).toBe(false);
  });
});

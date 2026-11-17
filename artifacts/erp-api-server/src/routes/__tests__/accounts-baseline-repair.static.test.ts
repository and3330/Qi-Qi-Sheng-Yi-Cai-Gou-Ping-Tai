import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../accounts.ts", import.meta.url), "utf8");

describe("baseline repair route safety invariants", () => {
  it("registers fixed repair paths before parameterized account paths", () => {
    expect(source.indexOf('"/accounts/baseline-repair/preview"')).toBeGreaterThan(-1);
    expect(source.indexOf('"/accounts/baseline-repair/apply"')).toBeGreaterThan(-1);
    expect(source.indexOf('"/accounts/baseline-repair/apply"')).toBeLessThan(source.indexOf('"/accounts/:id"'));
  });

  it("is session-only, fixed to tenant/company/profile, and rechecks active database identity", () => {
    expect(source).toContain("sessionOnly, requireAuth");
    expect(source).toContain('REPAIR_TENANT_ID = 1');
    expect(source).toContain('REPAIR_COMPANY_CODE = "83483621"');
    expect(source).toContain('selectAccountingBaseline("yubang-83483621")');
    expect(source).toContain("adminUsersTable.isActive, true");
    expect(source).toContain('user.role !== "owner" && user.role !== "super_admin"');
  });

  it("locks, re-previews, explicitly scopes ensure and writes audit in one transaction", () => {
    const transaction = source.slice(source.indexOf("db.transaction(async (tx)"));
    expect(transaction).toContain("LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE");
    expect(transaction).toContain("repairIdentity(tx, req)");
    expect(transaction).toContain("repairPreview(tx, identity.tenant)");
    expect(transaction).toContain("{ tenantId: REPAIR_TENANT_ID }");
    expect(transaction).toContain("tx.insert(auditLogsTable)");
  });
});
import { describe, expect, it } from "vitest";
import { selectAccountingBaseline } from "../accounting-baseline";
import {
  buildBaselineRepairPreview,
  type BaselineRepairAccountState,
  type BaselineRepairTenantState,
} from "../accounting-baseline-repair";

const tenant: BaselineRepairTenantState = {
  id: 1,
  name: "主公司",
  companyCode: "83483621",
  status: "active",
  isExempt: true,
  trialEndsAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  aiCredits: 10,
  contactEmail: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function row(code: string, overrides: Partial<BaselineRepairAccountState> = {}): BaselineRepairAccountState {
  const definition = selectAccountingBaseline("yubang-83483621").find(item => item.code === code);
  if (!definition) throw new Error(`missing fixture definition ${code}`);
  return {
    tenantId: 1,
    id: Number(code.replace(/\D/g, "")) || 1,
    accountNumber: code,
    accountName: definition.displayName,
    accountType: definition.accountType,
    parentAccountId: null,
    balance: "0.00",
    isGroup: definition.isGroup,
    cashFlowCategory: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("accounting baseline repair preview", () => {
  const baseline = selectAccountingBaseline("yubang-83483621");

  it("returns the exact API shape and all missing source labels without changing them", () => {
    const preview = buildBaselineRepairPreview(tenant, [], baseline);
    expect(preview).toMatchObject({
      tenantId: 1,
      companyCode: "83483621",
      total: 476,
      existing: 0,
      conflicts: [],
    });
    expect(preview.missing).toHaveLength(476);
    expect(preview.missing.find(item => item.code === "1113")).toEqual({
      code: "1113",
      name: "銀行存款-國泰板橋",
      parentCode: "111",
    });
    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic across account order and becomes stale for every account field or tenant change", () => {
    const a = row("1", { id: 10 });
    const b = row("2", { id: 20 });
    const original = buildBaselineRepairPreview(tenant, [a, b], baseline).fingerprint;
    expect(buildBaselineRepairPreview(tenant, [b, a], baseline).fingerprint).toBe(original);
    for (const changed of [
      { ...a, accountName: "自訂名稱" },
      { ...a, balance: "1.00" },
      { ...a, cashFlowCategory: "cash" },
      { ...a, updatedAt: "2025-01-02T00:00:00.000Z" },
    ]) {
      expect(buildBaselineRepairPreview(tenant, [changed, b], baseline).fingerprint).not.toBe(original);
    }
    expect(buildBaselineRepairPreview({ ...tenant, name: "changed" }, [a, b], baseline).fingerprint).not.toBe(original);
  });

  it("reports structural conflicts but permits custom names, balances and metadata", () => {
    const root = row("1", {
      id: 1,
      accountName: "保留自訂名稱",
      balance: "999.00",
      cashFlowCategory: "cash",
    });
    expect(buildBaselineRepairPreview(tenant, [root], baseline).conflicts).toEqual([]);
    const conflict = buildBaselineRepairPreview(
      tenant,
      [{ ...root, accountType: "Liability" }],
      baseline,
    );
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts[0]).toContain("1: existing(type=Liability");
  });

  it("counts a complete compatible baseline as idempotently existing", () => {
    const idByCode = new Map(baseline.map((definition, index) => [definition.code, index + 1]));
    const rows = baseline.map((definition, index) => row(definition.code, {
      id: index + 1,
      parentAccountId: definition.parentCode ? idByCode.get(definition.parentCode)! : null,
    }));
    const preview = buildBaselineRepairPreview(tenant, rows, baseline);
    expect(preview).toMatchObject({ total: 476, existing: 476, missing: [], conflicts: [] });
  });
});
import { createHash } from "node:crypto";
import type { AccountingBaselineAccount } from "./accounting-baseline";

export interface BaselineRepairAccountState {
  tenantId: number;
  id: number;
  accountNumber: string;
  accountName: string;
  accountType: string;
  parentAccountId: number | null;
  balance: string;
  isGroup: boolean;
  cashFlowCategory: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BaselineRepairTenantState {
  id: number;
  name: string;
  companyCode: string | null;
  status: string;
  isExempt: boolean;
  trialEndsAt: Date | string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  aiCredits: number;
  contactEmail: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BaselineRepairPreview {
  tenantId: number;
  companyCode: string;
  total: number;
  existing: number;
  missing: Array<{ code: string; name: string; parentCode: string | null }>;
  conflicts: string[];
  fingerprint: string;
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Pure, deterministic snapshot used by preview and by the locked apply transaction. */
export function buildBaselineRepairPreview(
  tenant: BaselineRepairTenantState,
  accounts: readonly BaselineRepairAccountState[],
  baseline: readonly AccountingBaselineAccount[],
): BaselineRepairPreview {
  if (!tenant.companyCode) throw new Error("Repair tenant has no company code");
  const orderedAccounts = [...accounts].sort((a, b) =>
    (a.accountNumber < b.accountNumber ? -1 : a.accountNumber > b.accountNumber ? 1 : 0) || a.id - b.id);
  const byCode = new Map(orderedAccounts.map((account) => [account.accountNumber, account]));
  const codeById = new Map(orderedAccounts.map((account) => [account.id, account.accountNumber]));
  const missing = baseline
    .filter((definition) => !byCode.has(definition.code))
    .map((definition) => ({
      code: definition.code,
      name: definition.displayName,
      parentCode: definition.parentCode,
    }));
  const conflicts: string[] = [];
  for (const definition of baseline) {
    const current = byCode.get(definition.code);
    if (!current) continue;
    const currentParent = current.parentAccountId === null
      ? null
      : codeById.get(current.parentAccountId) ?? `#missing:${current.parentAccountId}`;
    if (
      current.accountType !== definition.accountType ||
      current.isGroup !== definition.isGroup ||
      currentParent !== definition.parentCode
    ) {
      conflicts.push(
        `${definition.code}: existing(type=${current.accountType}, group=${current.isGroup}, parent=${currentParent ?? "null"}) ` +
        `!= baseline(type=${definition.accountType}, group=${definition.isGroup}, parent=${definition.parentCode ?? "null"})`,
      );
    }
  }

  const fingerprintPayload = {
    tenant: {
      ...tenant,
      trialEndsAt: timestamp(tenant.trialEndsAt),
      createdAt: timestamp(tenant.createdAt),
      updatedAt: timestamp(tenant.updatedAt),
    },
    accounts: orderedAccounts.map((account) => ({
      ...account,
      createdAt: timestamp(account.createdAt),
      updatedAt: timestamp(account.updatedAt),
    })),
    baseline,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(fingerprintPayload))
    .digest("hex");

  return {
    tenantId: tenant.id,
    companyCode: tenant.companyCode,
    total: baseline.length,
    existing: baseline.length - missing.length,
    missing,
    conflicts,
    fingerprint,
  };
}
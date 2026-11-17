import { and, or, sql, type SQL } from "drizzle-orm";
import { customersTable } from "@workspace/erp-db";
import { isValidTaiwanTaxId } from "./tax-id-tw";

/** Fields accepted by POST /customers (camelCase, matching the customers table). */
export const CUSTOMER_TEXT_FIELDS = [
  "name", "customerCode", "shortName", "email", "phone", "mobile", "contactPerson",
  "salesPerson", "address", "city", "country", "taxId", "category",
] as const;
export type CustomerTextField = typeof CUSTOMER_TEXT_FIELDS[number];
export type CustomerInput = { name: string } & Partial<Record<Exclude<CustomerTextField, "name">, string | null>>;
export type CustomerConflictField = "taxId" | "customerCode" | "name";

export class CustomerInputError extends Error {
  constructor(public status: 400 | 409, public body: { error: string; field?: string; index?: number }) {
    super(body.error);
  }
}

export const CUSTOMER_CONFLICT_MESSAGE: Record<CustomerConflictField, string> = {
  taxId: "同租戶已有相同統一編號的客戶",
  customerCode: "同租戶已有相同客戶代碼的客戶",
  name: "同租戶已有相同名稱的客戶",
};

/**
 * Trim every string field; name is required after trim; blank optional fields become null
 * (blank category keeps the database default). A non-blank taxId must be a valid 統編.
 */
export function normalizeCustomerInput(body: unknown): CustomerInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CustomerInputError(400, { error: "名稱為必填" });
  }
  const raw = body as Record<string, unknown>;
  const result: Record<string, string | null | undefined> = {};
  for (const field of CUSTOMER_TEXT_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number") {
      throw new CustomerInputError(400, { error: "欄位格式錯誤", field });
    }
    const trimmed = String(value).trim();
    if (trimmed === "") {
      if (field !== "category") result[field] = null;
    } else result[field] = trimmed;
  }
  if (!result.name) throw new CustomerInputError(400, { error: "名稱為必填", field: "name" });
  if (result.taxId && !isValidTaiwanTaxId(result.taxId)) {
    throw new CustomerInputError(400, { error: "統一編號格式或檢查碼錯誤", field: "taxId" });
  }
  return result as CustomerInput;
}

type Executor = { execute: (query: SQL) => Promise<unknown>; select: (...args: any[]) => any };

/**
 * Serialize customer-master creation per tenant until the surrounding transaction ends
 * (POST /customers, batch, MCP customer drafts and their human confirmation share it).
 * Fails closed when no tenant is configured on the connection.
 */
export async function lockCustomerMaster(tx: Executor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(826318, current_setting('app.tenant_id')::integer)`);
}

/** Same-tenant duplicate check against formal customers (exact match after trim). */
export async function findCustomerConflict(
  tx: Executor,
  input: Pick<CustomerInput, "name" | "taxId" | "customerCode">,
): Promise<CustomerConflictField | null> {
  const checks: SQL[] = [sql`btrim(${customersTable.name}) = ${input.name}`];
  if (input.taxId) checks.push(sql`btrim(${customersTable.taxId}) = ${input.taxId}`);
  if (input.customerCode) checks.push(sql`btrim(${customersTable.customerCode}) = ${input.customerCode}`);
  const rows: Array<{ name: string; taxId: string | null; customerCode: string | null }> = await tx
    .select({ name: customersTable.name, taxId: customersTable.taxId, customerCode: customersTable.customerCode })
    .from(customersTable)
    .where(and(sql`${customersTable.tenantId} = current_setting('app.tenant_id')::integer`, or(...checks)))
    .limit(20);
  return conflictField(rows, input);
}

export function conflictField(
  rows: Array<{ name?: string | null; taxId?: string | null; customerCode?: string | null }>,
  input: Pick<CustomerInput, "name" | "taxId" | "customerCode">,
): CustomerConflictField | null {
  const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim() === b.trim();
  if (rows.some(r => same(r.taxId, input.taxId))) return "taxId";
  if (rows.some(r => same(r.customerCode, input.customerCode))) return "customerCode";
  if (rows.some(r => same(r.name, input.name))) return "name";
  return null;
}

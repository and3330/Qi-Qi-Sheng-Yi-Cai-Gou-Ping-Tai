import { z } from "zod/v4";
import { and, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { db, currentTenantId, aiCustomerDraftsTable } from "@workspace/erp-db";
import { isValidTaiwanTaxId } from "../lib/tax-id-tw";
import { conflictField, findCustomerConflict, lockCustomerMaster, type CustomerConflictField } from "../lib/customer-master";

const optional = (max: number) => z.string().trim().max(max).optional();
const taxId = z.string().trim().refine(isValidTaiwanTaxId, "Invalid Taiwan unified business number");

/** MCP tool arguments (snake_case like the other tools). Never accepts a tenant. */
export const createCustomerDraftArgs = z.object({
  name: z.string().trim().min(1).max(200),
  customer_code: z.string().trim().min(1).max(50).optional(),
  tax_id: taxId.optional(),
  short_name: optional(100),
  email: optional(200),
  phone: optional(50),
  mobile: optional(50),
  contact_person: optional(100),
  sales_person: optional(100),
  address: optional(300),
  city: optional(100),
  country: optional(100),
  category: optional(50),
}).strict();

/** Canonical stored payload: the POST /customers body (camelCase customers columns). */
export const customerDraftPayloadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  customerCode: z.string().trim().min(1).max(50).optional(),
  taxId: taxId.optional(),
  shortName: optional(100),
  email: optional(200),
  phone: optional(50),
  mobile: optional(50),
  contactPerson: optional(100),
  salesPerson: optional(100),
  address: optional(300),
  city: optional(100),
  country: optional(100),
  category: optional(50),
}).strict();
export type CustomerDraftPayload = z.infer<typeof customerDraftPayloadSchema>;

const FIELD_MAP = {
  name: "name", customer_code: "customerCode", tax_id: "taxId", short_name: "shortName",
  email: "email", phone: "phone", mobile: "mobile", contact_person: "contactPerson",
  sales_person: "salesPerson", address: "address", city: "city", country: "country", category: "category",
} as const satisfies Record<keyof z.infer<typeof createCustomerDraftArgs>, keyof CustomerDraftPayload>;

/** Map parsed tool args to the canonical payload; blank optional values are dropped. */
export function toCustomerDraftPayload(args: z.infer<typeof createCustomerDraftArgs>): CustomerDraftPayload {
  const payload: Record<string, string> = {};
  for (const [from, to] of Object.entries(FIELD_MAP)) {
    const value = (args as Record<string, string | undefined>)[from];
    if (typeof value === "string" && value.trim() !== "") payload[to] = value.trim();
  }
  return customerDraftPayloadSchema.parse(payload);
}

/** A validation failure whose fixed message is safe to return to the MCP caller. */
export class CustomerDraftConflictError extends Error {
  constructor(public field: CustomerConflictField, public source: "customer" | "pending_draft") {
    super(`Duplicate ${field === "taxId" ? "tax_id" : field === "customerCode" ? "customer_code" : "name"} in this tenant (${source === "customer" ? "existing customer" : "pending customer draft"})`);
  }
}

/**
 * Validates a stored/new customer draft under the trusted tenant context:
 * strict schema + 統編 checksum + same-tenant duplicates against `customers` and other
 * pending `ai_customer_drafts` (exact match after trim on tax_id, customer_code, name).
 * Takes the per-tenant customer-master advisory lock for the rest of the transaction.
 * Returns the POST /customers body. Never writes business data.
 */
export async function validateCustomerDraft(input: unknown, excludeDraftId?: number): Promise<CustomerDraftPayload> {
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Tenant context required");
  const payload = customerDraftPayloadSchema.parse(input);
  await lockCustomerMaster(db);
  const existing = await findCustomerConflict(db, payload);
  if (existing) throw new CustomerDraftConflictError(existing, "customer");
  const field = (key: string) => sql`btrim(${aiCustomerDraftsTable.payload}->>${key})`;
  const checks: SQL[] = [sql`${field("name")} = ${payload.name}`];
  if (payload.taxId) checks.push(sql`${field("taxId")} = ${payload.taxId}`);
  if (payload.customerCode) checks.push(sql`${field("customerCode")} = ${payload.customerCode}`);
  const pending = await db.select({ payload: aiCustomerDraftsTable.payload }).from(aiCustomerDraftsTable).where(and(
    eq(aiCustomerDraftsTable.tenantId, tenantId),
    eq(aiCustomerDraftsTable.status, "pending"),
    excludeDraftId === undefined ? undefined : ne(aiCustomerDraftsTable.id, excludeDraftId),
    or(...checks),
  )).limit(20);
  const draftConflict = conflictField(pending.map(row => (row.payload ?? {}) as Record<string, string>), payload);
  if (draftConflict) throw new CustomerDraftConflictError(draftConflict, "pending_draft");
  return payload;
}

export interface EcpayBuyerInput {
  invoiceType: "personal" | "company" | "donation";
  customerEmail?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  customerAddr?: unknown;
  taxId?: unknown;
  companyTitle?: unknown;
  loveCode?: unknown;
  carrierNum?: unknown;
}

export interface SavedEcpayCustomer {
  id: number;
  name?: unknown;
  shortName?: unknown;
  taxId?: unknown;
  country?: unknown;
  city?: unknown;
  address?: unknown;
  email?: unknown;
  phone?: unknown;
  mobile?: unknown;
  contactPerson?: unknown;
}

const text = (value: unknown): string => String(value ?? "").trim();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ERP buyer-data policy for newly prepared ECPay issues.
 * This intentionally does not belong in the low-level ECPay client: persisted
 * historical requests must remain retryable with their immutable payload.
 */
export function missingIssues(input: EcpayBuyerInput): string[] {
  const issues: string[] = [];
  const email = text(input.customerEmail);
  const rawFields: Array<[unknown, string]> = [
    [input.customerName, "買方姓名"],
    [input.companyTitle, "公司抬頭"],
    [input.customerAddr, "買方地址"],
    [input.customerPhone, "買方電話"],
    [input.customerEmail, "買方 Email"],
    [input.taxId, "統一編號"],
    [input.loveCode, "愛心碼"],
    [input.carrierNum, "載具號碼"],
  ];

  if (input.invoiceType === "company") {
    if (!text(input.companyTitle)) issues.push("公司抬頭");
    if (!/^\d{8}$/.test(text(input.taxId))) issues.push("統一編號（須為 8 碼數字）");
  } else if (!text(input.customerName)) {
    issues.push("買方姓名");
  }

  if (!text(input.customerAddr)) issues.push("買方地址");
  if (!text(input.customerPhone)) issues.push("買方電話");
  if (!email) issues.push("買方 Email");
  else if (!EMAIL_PATTERN.test(email)) issues.push("買方 Email（格式不正確）");
  if (input.invoiceType === "donation" && !text(input.loveCode)) issues.push("愛心碼");

  for (const [value, label] of rawFields) {
    const raw = String(value ?? "");
    if (raw.trim() && raw !== raw.trim()) issues.push(`${label}（請移除前後空白）`);
  }

  return issues;
}

/**
 * Shapes saved customer master data for the ECPay preview without allowing
 * whitespace-only primary fields or country-only addresses to appear complete.
 */
export function normalizeSavedEcpayCustomer(customer: SavedEcpayCustomer) {
  const streetAddress = text(customer.address);
  return {
    id: customer.id,
    name: text(customer.name),
    shortName: text(customer.shortName),
    taxId: text(customer.taxId),
    address: streetAddress
      ? [text(customer.country), text(customer.city), streetAddress].filter(Boolean).join("")
      : "",
    email: text(customer.email),
    phone: text(customer.phone) || text(customer.mobile),
    contactPerson: text(customer.contactPerson),
  };
}
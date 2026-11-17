/** Company identifiers are strings: never coerce numbers or drop leading zeroes. */
export function companyCode(value: unknown): string | null {
  return typeof value === "string" && /^[0-9]{8}$/.test(value.trim()) ? value.trim() : null;
}
export function accountName(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200 ? value.trim() : null;
}
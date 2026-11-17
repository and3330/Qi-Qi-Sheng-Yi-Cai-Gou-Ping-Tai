export const COMPANY_CODE_ERROR = "公司編碼（統編）須為 8 位半形數字";

export function normalizeCompanyCode(value: string): string {
  return value.trim();
}

export function isValidCompanyCode(value: string): boolean {
  return /^[0-9]{8}$/.test(normalizeCompanyCode(value));
}

export function companyCodeValidationMessage(value: string): string | null {
  return isValidCompanyCode(value) ? null : COMPANY_CODE_ERROR;
}
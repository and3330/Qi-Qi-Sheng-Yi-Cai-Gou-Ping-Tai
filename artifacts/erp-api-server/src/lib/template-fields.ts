/** 回傳模板裡標示必填、但沒有填值的欄位名稱（給人看的名稱） */
export function missingRequiredFields(fieldSchema: unknown, extraFields: unknown): string[] {
  if (!Array.isArray(fieldSchema)) return [];
  const values = extraFields && typeof extraFields === "object" ? (extraFields as Record<string, unknown>) : {};
  return fieldSchema
    .filter((f: any) => f && f.required === true && typeof f.name === "string")
    .filter((f: any) => {
      const v = values[f.name];
      return v === undefined || v === null || String(v).trim() === "";
    })
    .map((f: any) => String(f.label || f.name));
}

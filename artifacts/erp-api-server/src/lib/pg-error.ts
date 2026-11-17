// drizzle-orm 0.44+ 會把底層 pg 錯誤包成 DrizzleQueryError,原始錯誤碼在 cause 上。
// 沿著 cause 鏈尋找 Postgres 錯誤碼 (如 23503 外鍵、23505 唯一鍵)。
export function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

// 同樣沿 cause 鏈找出違反的 constraint 名稱。
export function pgErrorConstraint(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const c = (cur as { constraint?: unknown }).constraint;
    if (typeof c === "string") return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

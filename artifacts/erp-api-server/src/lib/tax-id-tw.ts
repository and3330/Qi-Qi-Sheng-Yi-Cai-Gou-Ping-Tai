/**
 * 台灣營利事業統一編號（統編）檢查碼驗證。
 *
 * 規則（財政部公告演算法）：
 * - 先 trim；必須恰好 8 位阿拉伯數字（中間空白、字母、全形數字一律拒絕）。
 * - 邏輯乘數 [1,2,1,2,1,2,4,1]；每位乘積的十位數與個位數相加後加總為 sum。
 * - sum 可被 DIVISOR 整除即有效；第 7 位（0-based index 6）為 7 時，
 *   另允許 (sum + 1) 可被 DIVISOR 整除（乘積 28 → 2+8=10 → 可取 1 或 0）。
 * - DIVISOR：財政部自 2023 年起將檢查邏輯由「被 10 整除」放寬為「被 5 整除」
 *   以擴充號碼容量；被 10 整除者必被 5 整除，因此既有統編全部仍有效。
 *
 * 注意：派工單原寫權重 [1,2,1,2,1,2,1,2]，該權重會把真實有效統編（例如 22099131）
 * 判為無效，故採財政部正式權重，並於 CONTRACT.md／報告中註明此差異。
 */
export const TW_TAX_ID_WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1] as const;
export const TW_TAX_ID_DIVISOR = 5;

export function normalizeTaiwanTaxId(value: string): string {
  return value.trim();
}

export function isValidTaiwanTaxId(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const id = normalizeTaiwanTaxId(value);
  if (!/^[0-9]{8}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const product = Number(id[i]) * TW_TAX_ID_WEIGHTS[i];
    sum += Math.floor(product / 10) + (product % 10);
  }
  if (sum % TW_TAX_ID_DIVISOR === 0) return true;
  return id[6] === "7" && (sum + 1) % TW_TAX_ID_DIVISOR === 0;
}

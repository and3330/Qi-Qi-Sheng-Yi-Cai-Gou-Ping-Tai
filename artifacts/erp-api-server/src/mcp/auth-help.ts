const AUTH_HELP = "請在 MCP 連線設定加上標頭 Authorization: Bearer <API Key>:<API Secret>（API Key 和 Secret 中間用冒號接起來，不要有空白）。這個連線不支援 OAuth 登入。";
/**
 * 連線被拒時給人看的原因（老闆 2026-11-19：只回 Unauthorized 看不出哪裡錯）。
 * 只看標頭長相，不透露金鑰存不存在：API Key 錯和 Secret 錯回同一句。
 */
export function bearerProblem(header: string | undefined): string {
  if (!header) return `沒有收到驗證標頭。${AUTH_HELP}`;
  if (!/^Bearer\s+\S/.test(header)) return `驗證標頭要用 Bearer 開頭。${AUTH_HELP}`;
  const token = header.replace(/^Bearer\s+/, "");
  if (/\s/.test(token)) return `金鑰裡有空白或換行，請重新複製。${AUTH_HELP}`;
  const colons = token.split(":").length - 1;
  if (colons === 0) return `只收到一段金鑰，少了 Secret。${AUTH_HELP} Secret 只在建立金鑰時顯示一次，沒有存到的話，請在 ERP「API 金鑰」頁按「重新產生」。`;
  if (colons > 1) return `金鑰格式不對（冒號太多）。${AUTH_HELP}`;
  return "API Key 或 Secret 不正確，或這把金鑰已停用。請到 ERP「API 金鑰」頁確認；Secret 忘了可以按「重新產生」。";
}
/** 驗證標頭；沒有 Authorization 但有 X-API-Key／X-API-Secret（ERP 一般 API 的第二種寫法）也接受 */
export function mcpAuthHeader(headers: Record<string, unknown>): string | undefined {
  if (typeof headers.authorization === "string" && headers.authorization.trim()) return headers.authorization.trim();
  const key = headers["x-api-key"], secret = headers["x-api-secret"];
  return typeof key === "string" && typeof secret === "string" && key.trim() && secret.trim() ? `Bearer ${key.trim()}:${secret.trim()}` : undefined;
}

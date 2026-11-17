export class EmailResultUnknownError extends Error {}

/** Session/edge errors can be HTML; do not mistake JSON parsing for a Resend error. */
export async function readEmailResponse(response: Response, phase: "preview" | "send") {
  const unknownResult = () => new EmailResultUnknownError(
    "無法確認寄送結果，請先查看寄信紀錄或 Resend 狀態，確認後再重試，避免重複寄送。",
  );
  let data: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch { /* Handle non-JSON errors by HTTP status below. */ }
  if (response.status === 401) throw new Error("登入已失效，請重新登入後再操作。");
  if (response.status === 403) throw new Error("沒有寄信權限，請聯絡管理員。");
  if (!response.ok) {
    if (phase === "send" && response.status >= 500) throw unknownResult();
    throw new Error(typeof data?.error === "string" ? data.error
      : phase === "preview" ? "暫時無法載入寄信預覽，尚未送出郵件，請稍後再試。"
      : "寄信請求失敗，請確認資料後再試。");
  }
  if (phase === "preview") {
    if (typeof data?.html !== "string" || typeof data.subject !== "string" || typeof data.to !== "string") {
      throw new Error("寄信預覽回應不完整，尚未送出郵件，請重新開啟預覽。");
    }
    return { to: data.to, subject: data.subject, html: data.html };
  }
  if (data?.ok !== true) throw unknownResult();
  return { ok: true };
}

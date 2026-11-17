/**
 * 收款單、付款單寫進日記帳的文字（老闆 2026-11-15）：
 * 單上可以一行一行加的「摘要」，就是日記帳那一行的摘要；前面放客戶／供應商，用「｜」隔開，
 * 跟總分類帳「客戶/供應商名稱、摘要」兩欄對得起來。不再寫「自動分錄 - 收款單 RC-…」這種單號。
 */
const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").replace(/｜/g, "／").trim() : "");

/** 一行的文字：「客戶/供應商｜摘要」；沒有對象就只有摘要 */
export function partyLineText(party: unknown, summary: unknown, fallback: string): string {
  const who = clean(party);
  const what = clean(summary) || fallback;
  return (who ? `${who}｜${what}` : what).slice(0, 200);
}

/** 作廢沖銷那一行：「對象｜作廢 原摘要」；舊式寫單號的行一樣在前面加「作廢」 */
export function voidLineText(original: unknown): string {
  const text = typeof original === "string" ? original.trim() : "";
  if (!text) return "作廢";
  if (text.startsWith("作廢") || text.includes("｜作廢")) return text.slice(0, 200);
  const cut = text.indexOf("｜");
  return (cut >= 0 ? `${text.slice(0, cut)}｜作廢 ${text.slice(cut + 1)}` : `作廢 ${text}`).slice(0, 200);
}

/** 品名摘要：第一個品名，多項時加「等 N 項」；沒有品名回空字串 */
export function itemsSummary(names: unknown[]): string {
  const list = names.map(clean).filter(Boolean);
  if (list.length === 0) return "";
  return list.length > 1 ? `${list[0]} 等 ${list.length} 項` : list[0];
}

/**
 * 「我的申請」存在付款申請 metadata.lines 的每一行（付給誰、摘要、金額）。
 * 只在各行加起來剛好等於申請金額時才拆行入帳；對不上（例如金額被改過）就回空陣列，照整張單入帳
 */
export function requestLines(metadata: unknown, total: number): Array<{ payee: string; summary: string; amount: number }> {
  const raw = (metadata as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const lines = raw.map((l: any) => ({ payee: clean(l?.payee), summary: clean(l?.summary), amount: Math.round(Number(l?.amount) * 100) / 100 }));
  if (lines.some(l => !(l.amount > 0))) return [];
  const sum = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  return Math.abs(sum - Math.round(total * 100) / 100) < 0.005 ? lines : [];
}

/** 整張分錄的說明：各行摘要（去重）用頓號接起來；都沒填就用備註，再沒有就用「收款單 RC-…」 */
export function entrySummary(summaries: unknown[], memo: unknown, fallback: string): string {
  const list = [...new Set(summaries.map(clean).filter(Boolean))];
  return (list.join("、") || clean(memo) || fallback).slice(0, 300);
}

/** 收款單、付款單的「H」（跟 Ecount「查詢憑證紀錄」一樣）：稽核紀錄整理成「誰、什麼時候、做了什麼」 */
export function voucherHistoryRows(voucher: { createdAt: Date | string | null; legacy?: boolean }, logs: Array<{ action: string; userName: string | null; createdAt: Date | string; oldValues: unknown; newValues: unknown }>) {
  const rows = logs.map(log => {
    const before = (log.oldValues ?? {}) as Record<string, unknown>;
    const after = (log.newValues ?? {}) as Record<string, unknown>;
    let action = log.action === "delete" ? "刪除" : log.action === "update" ? "修改" : "新增";
    let detail = "";
    if (log.action === "create" && after.status === "已作廢") action = "作廢";
    if (after.changeRequest) { action = after.kind === "delete" ? "刪除（經審核）" : "修改（經審核）"; detail = String(after.summary ?? ""); }
    if (!after.changeRequest && log.action === "update" && before.description !== after.description && after.description !== undefined) {
      detail = `備註：${String(before.description ?? "") || "（空白）"} → ${String(after.description ?? "") || "（空白）"}`;
    }
    return { at: new Date(log.createdAt).toISOString(), user: log.userName || "系統", action, detail };
  });
  // 從 Ecount 搬過來、或稽核紀錄上線前建立的單，沒有「新增」那一筆：用單據的建立時間補一行
  if (!rows.some(r => r.action === "新增") && voucher.createdAt) {
    rows.unshift({ at: new Date(voucher.createdAt).toISOString(), user: voucher.legacy ? "Ecount 匯入" : "（未記錄）", action: "新增", detail: "" });
  }
  return rows;
}

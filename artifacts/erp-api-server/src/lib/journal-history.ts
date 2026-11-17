/** 日記帳分錄的 H：誰、什麼時候、做了什麼。資料來自稽核紀錄（audit_logs, document_type = journal_entries） */

export interface HistoryLog { action: string; userName: string | null; createdAt: Date | string; oldValues: unknown; newValues: unknown }
export interface HistoryRow { at: string; user: string; action: string; detail: string }

/** 沖銷分錄的編號是 JE-R{原分錄 id}-xxxxxx，從這裡找回原分錄 */
export function reversalOriginalId(entryNumber: string): number | null {
  const m = /^JE-R(\d+)-/.exec(entryNumber || "");
  return m ? Number(m[1]) : null;
}

const STATUS: Record<string, string> = { Posted: "已入帳", Reversed: "已沖銷", Draft: "草稿" };

/**
 * logs：這張分錄自己的紀錄（新增、修改、沖銷它）。
 * reversedBy：如果這張是沖銷分錄，原分錄那邊「沖銷」那一筆紀錄，用來寫「誰開的這張沖銷」。
 */
export function journalHistoryRows(
  entry: { id: number; entryNumber: string; createdAt: Date | string | null; sourceNumber?: string | null },
  logs: HistoryLog[],
  reversedBy?: { log: HistoryLog; originalNumber: string } | null,
): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const log of logs) {
    const before = (log.oldValues ?? {}) as Record<string, unknown>;
    const after = (log.newValues ?? {}) as Record<string, unknown>;
    const at = new Date(log.createdAt).toISOString();
    const user = log.userName || "系統";
    if (after.changeRequest) {
      // 經過異動申請核准的修改、刪除
      rows.push({ at, user, action: after.kind === "delete" ? "刪除（經審核）" : "修改（經審核）", detail: String(after.summary ?? "") });
    } else if (log.action === "create") {
      // POST /journal-entries/:id/reverse 也記在原分錄底下，回傳的是新開的沖銷分錄
      if (Number(after.id) && Number(after.id) !== entry.id) {
        rows.push({ at, user, action: "沖銷", detail: `開了沖銷分錄 ${String(after.entryNumber ?? "")}`.trim() });
      } else {
        rows.push({ at, user, action: "新增", detail: "" });
      }
    } else if (log.action === "delete") {
      rows.push({ at, user, action: "刪除", detail: "" });
    } else if (log.action === "update") {
      const changes: string[] = [];
      if (after.description !== undefined && before.description !== after.description) changes.push(`說明：${String(before.description ?? "") || "（空白）"} → ${String(after.description ?? "") || "（空白）"}`);
      if (after.entryDate !== undefined && before.entry_date !== undefined && before.entry_date !== after.entryDate) changes.push(`日期：${String(before.entry_date)} → ${String(after.entryDate)}`);
      if (after.status !== undefined && before.status !== after.status) changes.push(`狀態：${STATUS[String(before.status)] ?? String(before.status ?? "")} → ${STATUS[String(after.status)] ?? String(after.status)}`);
      if (after.totalDebit !== undefined && before.total_debit !== undefined && Number(before.total_debit) !== Number(after.totalDebit)) changes.push(`金額：${Number(before.total_debit).toLocaleString()} → ${Number(after.totalDebit).toLocaleString()}`);
      rows.push({ at, user, action: "修改", detail: changes.join("；") });
    }
  }
  if (reversedBy && !rows.some(r => r.action === "新增")) {
    rows.unshift({ at: new Date(reversedBy.log.createdAt).toISOString(), user: reversedBy.log.userName || "系統", action: "新增", detail: `沖銷 ${reversedBy.originalNumber}` });
  }
  // 系統自動產生、Ecount 搬來、或稽核上線前建立的分錄沒有「新增」紀錄：用建立時間補一行
  if (!rows.some(r => r.action === "新增") && entry.createdAt) {
    rows.unshift({ at: new Date(entry.createdAt).toISOString(), user: entry.sourceNumber ? "Ecount 匯入" : "系統自動產生", action: "新增", detail: "" });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

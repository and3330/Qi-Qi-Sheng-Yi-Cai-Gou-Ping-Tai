import { useEffect, useState } from "react";
import { History, Pencil, Trash2 } from "lucide-react";
import { ChangeRequestDialog } from "@/components/accounting/change-request-dialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocWindow, DocStatus, statusTone, DocFields, DocLines, DocSection, DocRelated, type DocColumn } from "@/components/shared/doc-window";

interface EntryLine { accountId: number; accountName: string; debit: number; credit: number; party: string | null; summary: string }
interface RelatedEntry { id: number; entryNumber: string; entryDate: string }
interface Entry {
  id: number; entryNumber: string; entryDate: string; status: string; summary: string; sourceNumber: string | null; party: string | null;
  totalDebit: number; totalCredit: number; lines: EntryLine[]; projectName: string | null; departmentName: string | null;
  isInternalTransfer?: boolean;
  source: { label: string; number: string; url: string | null } | null;
  reversalOf?: RelatedEntry | null; reversedBy?: RelatedEntry[];
}
interface HistoryRow { at: string; user: string; action: string; detail: string }
/** 明細表格的一列：一般分錄行，或最下面的借貸合計列（借、貸各一個合計，共用外框的合計列只放得下一個數字） */
type LineRow = { kind: "line"; line: EntryLine } | { kind: "total" };

const fmt = (n: number) => (n ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "");
const STATUS: Record<string, string> = { Posted: "已入帳", Reversed: "已沖銷", Draft: "草稿" };
const when = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
const relatedText = (r: RelatedEntry) => `${r.entryDate.replace(/-/g, "/")} ${r.entryNumber}`;

/**
 * 點「日期／號碼」開的分錄明細，跟 Ecount 點日期連到單據一樣。
 * 系統產生的分錄有「開啟原單」：要改要刪，到原單去做，分錄會跟著一起處理。
 * 「H」看這張分錄的操作紀錄；原分錄和沖銷分錄互相點得到。
 * 畫面用全系統共用的單據視窗外框（DocWindow），排法跟其他單據一樣。
 */
export function JournalEntryDialog({ entryId, onClose, onEdit }: { entryId: number | null; onClose: () => void; onEdit?: (entry: any) => void }) {
  const [currentId, setCurrentId] = useState<number | null>(entryId);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const { toast } = useToast();

  useEffect(() => { setCurrentId(entryId); }, [entryId]);

  useEffect(() => {
    if (!currentId) return;
    setEntry(null); setError(""); setHistory(null); setShowHistory(false);
    fetch(`/erp-api/journal-entries/${currentId}`, { credentials: "include" })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "讀取失敗"); setEntry(j); })
      .catch(e => setError(e.message));
  }, [currentId]);

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null && currentId) {
      fetch(`/erp-api/journal-entries/${currentId}/history`, { credentials: "include" })
        .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "讀取失敗"); setHistory(j.rows || []); })
        .catch(() => setHistory([]));
    }
  };

  // 草稿直接刪；已入帳的送刪除申請（原分錄和沖銷分錄一起）
  const deleteDraft = async () => {
    if (!entry || !window.confirm(`刪除草稿 ${entry.entryNumber}？`)) return;
    const r = await fetch(`/erp-api/journal-entries/${entry.id}`, { method: "DELETE", credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ title: "刪除失敗", description: j.error, variant: "destructive" }); return; }
    toast({ title: "草稿已刪除" }); onClose();
  };
  const pairNumbers = entry ? [entry.reversalOf?.entryNumber, entry.entryNumber, ...(entry.reversedBy ?? []).map(r => r.entryNumber)].filter(Boolean).join("、") : "";

  // 原分錄、沖銷分錄：點了直接在這個視窗裡換成那一張
  const relatedLink = (r: RelatedEntry) => (
    <button key={r.id} type="button" className="text-primary hover:underline" onClick={() => setCurrentId(r.id)}>{relatedText(r)}</button>
  );

  const lineColumns: DocColumn<LineRow>[] = entry ? [
    { header: "科目", className: "min-w-[9rem]", cell: r => r.kind === "line" ? r.line.accountName : <span className="font-semibold">合計</span> },
    { header: "摘要", className: "min-w-[9rem]", cell: r => r.kind === "line" ? (r.line.summary || entry.summary) : "" },
    { header: "客戶/供應商名稱", className: "min-w-[8rem]", cell: r => r.kind === "line" ? (r.line.party || "") : "" },
    { header: "借方", align: "right", className: "w-28", cell: r => r.kind === "line" ? fmt(r.line.debit) : <span className="font-semibold">{fmt(entry.totalDebit)}</span> },
    { header: "貸方", align: "right", className: "w-28", cell: r => r.kind === "line" ? fmt(r.line.credit) : <span className="font-semibold">{fmt(entry.totalCredit)}</span> },
  ] : [];
  const lineRows: LineRow[] = entry ? [...entry.lines.map(line => ({ kind: "line" as const, line })), { kind: "total" as const }] : [];

  return (
    <>
      <DocWindow
        open={entryId !== null}
        onClose={onClose}
        wide
        name="分錄"
        number={entry ? (entry.sourceNumber ? `Ecount ${entry.sourceNumber}` : entry.entryNumber) : null}
        status={entry && (
          <>
            <DocStatus label={STATUS[entry.status] ?? entry.status} tone={statusTone(entry.status)} />
            {entry.isInternalTransfer && <Badge variant="outline">內部轉撥</Badge>}
          </>
        )}
        footer={
          <>
            {/* 左邊：刪除、操作紀錄；右邊：修改、關閉 */}
            {entry && (
              <div className="mr-auto flex flex-wrap items-center gap-2">
                {!entry.source && (entry.status === "Draft"
                  ? <Button variant="outline" onClick={deleteDraft} data-testid="button-delete-entry"><Trash2 className="mr-1 h-4 w-4 text-destructive" />刪除草稿</Button>
                  : <Button variant="outline" onClick={() => setAskDelete(true)} data-testid="button-delete-entry" title="已入帳的分錄要送審，核准後才刪除"><Trash2 className="mr-1 h-4 w-4 text-destructive" />申請刪除</Button>)}
                <Button variant="outline" onClick={toggleHistory} data-testid="button-entry-history" title="H：這張分錄的操作紀錄（誰、什麼時候新增、修改、沖銷）">
                  <History className="mr-1 h-4 w-4" />H 操作紀錄
                </Button>
              </div>
            )}
            {entry && onEdit && !entry.source && entry.status !== "Reversed" && !entry.reversalOf && (
              <Button onClick={() => onEdit(entry)} data-testid="button-edit-entry" title={entry.status === "Draft" ? "修改草稿" : "已入帳的分錄要送審，核准後才改"}><Pencil className="mr-1 h-4 w-4" />{entry.status === "Draft" ? "修改" : "申請修改"}</Button>
            )}
            <Button variant="outline" onClick={onClose}>關閉</Button>
          </>
        }
      >
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!entry && !error && <p className="py-8 text-center text-sm text-muted-foreground">讀取中...</p>}
        {entry && (
          <>
            <DocFields items={[
              ["日期", entry.entryDate.replace(/-/g, "/")],
              ["號碼", entry.sourceNumber ? `Ecount ${entry.sourceNumber}` : entry.entryNumber],
              ["部門", entry.departmentName || "-"],
              ["專案", entry.projectName || "-"],
              ["摘要", entry.summary || "-"],
            ]} />

            <DocLines columns={lineColumns} rows={lineRows} />

            {/* 這張分錄是哪張單產生的、跟哪張分錄互相沖銷：說明放上面，單號列在「關聯單據」 */}
            {entry.source && (
              <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                這筆是 <b>{entry.source.label} {entry.source.number}</b> 產生的，要修改或刪除請到原單操作，分錄會一起處理。{entry.source.url && "在下面「關聯單據」點單號就能開啟原單。"}
              </p>
            )}
            {entry.reversalOf && (
              <p className="rounded-md border bg-muted/30 px-3 py-2"><span className="text-muted-foreground">這筆是沖銷：</span>原分錄 {relatedLink(entry.reversalOf)}（點一下直接看那張）</p>
            )}
            {(entry.reversedBy?.length ?? 0) > 0 && (
              <p className="flex flex-wrap gap-x-2 rounded-md border bg-muted/30 px-3 py-2"><span className="text-muted-foreground">已被沖銷：</span>沖銷分錄 {entry.reversedBy!.map(relatedLink)}（點一下直接看那張）</p>
            )}
            <div data-testid="link-entry-source">
              <DocRelated onNavigate={onClose} items={[
                entry.source && { label: `原單（${entry.source.label}）`, number: entry.source.number, href: entry.source.url },
                entry.reversalOf && { label: "原分錄", number: relatedText(entry.reversalOf) },
                ...(entry.reversedBy ?? []).map(r => ({ label: "沖銷分錄", number: relatedText(r) })),
              ]} />
            </div>

            {showHistory && (
              <DocSection title="操作紀錄">
                <div className="overflow-x-auto rounded-md border">
                  {history === null ? <p className="p-3 text-muted-foreground">讀取中...</p> : history.length === 0 ? <p className="p-3 text-muted-foreground">沒有紀錄</p> : (
                    <table className="w-full">
                      <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">時間</th><th className="px-3 py-1.5 text-left">誰</th><th className="px-3 py-1.5 text-left">做了什麼</th><th className="px-3 py-1.5 text-left">內容</th></tr></thead>
                      <tbody>{history.map((h, i) => <tr key={i} className="border-t"><td className="whitespace-nowrap px-3 py-1.5">{when(h.at)}</td><td className="px-3 py-1.5">{h.user}</td><td className="px-3 py-1.5">{h.action}</td><td className="px-3 py-1.5">{h.detail}</td></tr>)}</tbody>
                    </table>
                  )}
                </div>
              </DocSection>
            )}
          </>
        )}
      </DocWindow>
      {entry && (
        <ChangeRequestDialog open={askDelete} onClose={() => setAskDelete(false)} title="申請刪除分錄"
          endpoint={`/erp-api/journal-entries/${entry.id}/delete-request`}
          description={<>要刪除 <b>{pairNumbers}</b>。{(entry.reversalOf || (entry.reversedBy?.length ?? 0) > 0) && "原分錄和沖銷分錄是一組，會一起刪，帳才會平。"}</>} />
      )}
    </>
  );
}

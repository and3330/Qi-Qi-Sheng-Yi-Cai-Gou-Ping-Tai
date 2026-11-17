import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Row { at: string; user: string; action: string; detail: string }

const when = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** 收款單、付款單的「H」：跟 Ecount「查詢憑證紀錄」一樣，列出每一次操作的人員、日期時間和做了什麼 */
export function VoucherHistoryDialog({ voucher, onClose }: { voucher: { id: number; number: string } | null; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!voucher) return;
    setRows(null); setError("");
    fetch(`/erp-api/vouchers/${voucher.id}/history`, { credentials: "include" })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "讀取失敗"); setRows(j.rows ?? []); })
      .catch(e => setError(e.message));
  }, [voucher]);

  return (
    <Dialog open={voucher !== null} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader><DialogTitle>操作紀錄（H）</DialogTitle></DialogHeader>
        <p className="text-sm">單號：<span className="font-mono">{voucher?.number}</span></p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!rows && !error && <p className="py-6 text-center text-sm text-muted-foreground">讀取中...</p>}
        {rows && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">#</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">操作人員</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">日期時間</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">動作</th>
                  <th className="px-3 py-2 text-left">內容</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">沒有紀錄</td></tr>}
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.user}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{when(r.at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.action}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>關閉</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

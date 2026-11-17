import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

/**
 * 已入帳單據的修改、作廢要先送審（老闆 2026-11-16）。
 * 每一頁都一樣：伺服器回 428「要寫原因」→ 這裡跳出視窗問原因 → 帶著原因重送 → 伺服器回 202「已送審」→ 顯示通知，
 * 並把回覆改成「還沒完成」（409），頁面才不會顯示已儲存、已作廢。
 * 不用每一頁各自處理。
 */
interface Ask { label: string; number: string; action: string; resolve: (reason: string | null) => void }
let openAsk: ((a: Ask) => void) | null = null;

function askChangeReason(info: Omit<Ask, "resolve">): Promise<string | null> {
  return new Promise(resolve => {
    if (!openAsk) { resolve(window.prompt(`${info.label} ${info.number} 已經入帳，${info.action}要先送審。請寫原因：`)?.trim() || null); return; }
    openAsk({ ...info, resolve });
  });
}

let installed = false;
export function installChangeApprovalFetch() {
  if (installed) return;
  installed = true;
  const inner = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await inner(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/erp-api/")) return res;
    try {
      if (res.status === 428) {
        const j = await res.clone().json().catch(() => null);
        if (!j?.needsChangeReason || input instanceof Request) return res;
        const reason = await askChangeReason({ label: j.label, number: j.number, action: j.action });
        if (!reason) return new Response(JSON.stringify({ error: "已取消，沒有送出", message: "已取消，沒有送出" }), { status: 400, headers: { "content-type": "application/json" } });
        const headers = new Headers(init?.headers);
        headers.set("X-Change-Reason", encodeURIComponent(reason));
        return window.fetch(input, { ...init, headers });
      }
      if (res.status === 202) {
        const j = await res.clone().json().catch(() => null);
        // 已送審＝還沒生效。各頁面看到「成功」會顯示已儲存、已作廢，所以這裡改回「沒有完成」並說清楚，
        // 頁面就不會誤報，也不會拿送審回覆當成單據內容去更新畫面。
        if (j?.changeGate && j?.requestNumber) {
          const text = `${j.message || `已送審 ${j.requestNumber}`}（還沒生效，可以到審批中心看進度）`;
          toast({ title: `已送審 ${j.requestNumber}`, description: "還沒生效，財務或超級管理員核准後系統才會執行" });
          return new Response(JSON.stringify({ error: text, message: text, pending: true, requestNumber: j.requestNumber }), { status: 409, headers: { "content-type": "application/json" } });
        }
      }
    } catch { /* 送審提示失敗不影響原本的請求 */ }
    return res;
  };
}

export function ChangeReasonHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    openAsk = a => { setReason(""); setAsk(a); };
    return () => { openAsk = null; };
  }, []);
  const finish = (value: string | null) => { ask?.resolve(value); setAsk(null); };
  return (
    <Dialog open={!!ask} onOpenChange={v => { if (!v) finish(null); }}>
      <DialogContent className="md:max-w-md">
        <DialogHeader><DialogTitle>{ask ? `${ask.action}${ask.label}要先送審` : ""}</DialogTitle></DialogHeader>
        <p className="text-sm">{ask?.label} <b>{ask?.number}</b> 已經入帳，{ask?.action}要財務或超級管理員其中一位核准；財務提出的由超級管理員核准。核准後系統才會執行，H 紀錄會留下誰申請、誰核准。</p>
        <div className="space-y-1">
          <Label htmlFor="global-change-reason">原因 *</Label>
          <textarea id="global-change-reason" className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：客戶抬頭打錯" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(null)}>取消</Button>
          <Button disabled={!reason.trim()} onClick={() => finish(reason.trim())} data-testid="button-submit-change-reason">送出申請</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

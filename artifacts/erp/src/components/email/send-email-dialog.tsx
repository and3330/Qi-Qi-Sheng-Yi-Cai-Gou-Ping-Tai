import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";
import { EmailResultUnknownError, readEmailResponse } from "@/lib/email-response";

/** 寄信前預覽對話框：載入草稿 → 可改收件人/主旨 → 確認寄出 */
export function SendEmailDialog({ docType, docId, open, onOpenChange }: {
  docType: "quotation" | "sales_order" | "invoice";
  docId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loadedDocument, setLoadedDocument] = useState<string | null>(null);
  const [unknownResult, setUnknownResult] = useState(false);
  const documentKey = `${docType}:${docId}`;
  const inputId = useId();

  useEffect(() => {
    if (!open || docId == null) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setErr(null); setDone(false); setUnknownResult(false);
    setLoadedDocument(null); setTo(""); setSubject(""); setHtml("");
    fetch(`/erp-api/email/preview?docType=${docType}&docId=${docId}`, { credentials: "include", signal: controller.signal })
      .then(async (r) => {
        const d = await readEmailResponse(r, "preview");
        if (!active) return;
        setTo(d.to || ""); setSubject(d.subject || ""); setHtml(d.html || "");
        setLoadedDocument(`${docType}:${docId}`);
      })
      .catch((e) => { if (active) setErr(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, docType, docId]);

  const send = async () => {
    if (docId == null || loadedDocument !== documentKey || sending || done || unknownResult) return;
    setSending(true); setErr(null);
    try {
      const r = await fetch(`/erp-api/email/send`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, docId, to, subject }),
      });
      await readEmailResponse(r, "send");
      setDone(true);
    } catch (e: any) {
      if (e instanceof EmailResultUnknownError || e instanceof TypeError) setUnknownResult(true);
      setErr(e instanceof TypeError
        ? "連線中斷，無法確認寄送結果，請先查看寄信紀錄或 Resend 狀態，避免重複寄送。"
        : e.message);
    }
    finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!sending) onOpenChange(value); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail size={18} />寄送 Email 預覽</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div role="status" className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
            <Loader2 className="animate-spin" size={16} />產生郵件預覽中…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`${inputId}-to`}>收件人</Label>
                <Input id={`${inputId}-to`} type="email" value={to} disabled={sending || done} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" data-testid="input-email-to" aria-invalid={!!err} aria-describedby={err ? `${inputId}-error` : undefined} />
                {!to && <p className="text-xs text-amber-600 mt-1">此客戶未設定 Email，請手動輸入</p>}
              </div>
              <div>
                <Label htmlFor={`${inputId}-subject`}>主旨</Label>
                <Input id={`${inputId}-subject`} value={subject} disabled={sending || done} onChange={(e) => setSubject(e.target.value)} data-testid="input-email-subject" />
              </div>
            </div>
            <div>
              <Label>信件內容預覽</Label>
              <div className="border rounded-md bg-white overflow-hidden">
                <iframe title="email-preview" srcDoc={html} className="w-full" style={{ height: 420, border: 0 }} sandbox="" />
              </div>
            </div>
            {err && <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600">{err}</p>}
            {done && <p role="status" className="text-sm text-green-700">郵件服務已接受寄送；實際送達仍以收件方及退信狀態為準。</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>{done ? "關閉" : "取消"}</Button>
          <Button onClick={send} disabled={loading || sending || done || unknownResult || loadedDocument !== documentKey || !to.trim()} data-testid="button-confirm-send-email">
            {sending && <Loader2 className="animate-spin mr-1" size={14} />}確認寄出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

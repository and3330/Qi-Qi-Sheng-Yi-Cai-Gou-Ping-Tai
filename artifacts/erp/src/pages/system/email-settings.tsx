import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail } from "lucide-react";

interface Settings { senderName: string; replyTo: string | null; bankInfo: string; autoSendInvoice: boolean; }
interface LogRow { id: number; docType: string; docId: number; recipient: string; subject: string; status: string; error: string | null; trigger: string; createdAt: string; }

const DOC_LABEL: Record<string, string> = { quotation: "報價單", sales_order: "訂單", invoice: "發票" };

export default function EmailSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/erp-api/email-settings`, { credentials: "include" }).then((r) => r.json()).then(setS);
    fetch(`/erp-api/email/logs`, { credentials: "include" }).then((r) => r.json()).then((d) => Array.isArray(d) && setLogs(d));
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true); setMsg(null);
    const r = await fetch(`/erp-api/email-settings`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    setSaving(false);
    setMsg(r.ok ? "已儲存" : "儲存失敗");
  };

  if (!s) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" size={16} />載入中…</div>;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Mail size={22} />寄信設定</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">基本設定</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>寄件顯示名稱</Label>
              <Input value={s.senderName} onChange={(e) => setS({ ...s, senderName: e.target.value })} placeholder="例如：七期生醫" data-testid="input-sender-name" />
            </div>
            <div>
              <Label>回覆信箱（客戶按回覆時寄到這裡）</Label>
              <Input value={s.replyTo || ""} onChange={(e) => setS({ ...s, replyTo: e.target.value || null })} placeholder="service@example.com" data-testid="input-reply-to" />
            </div>
          </div>
          <div>
            <Label>匯款帳戶資訊（附在發票通知信中）</Label>
            <Textarea rows={4} value={s.bankInfo} onChange={(e) => setS({ ...s, bankInfo: e.target.value })}
              placeholder={"銀行：OO銀行 OO分行（代碼 000）\n戶名：OOOO有限公司\n帳號：0000-0000-0000"} data-testid="input-bank-info" />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={s.autoSendInvoice} onCheckedChange={(v) => setS({ ...s, autoSendInvoice: v === true })} data-testid="checkbox-auto-send-invoice" />
            開立發票後自動寄通知信給客戶（含發票號碼與匯款帳戶）
          </label>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving} data-testid="button-save-email-settings">
              {saving && <Loader2 className="animate-spin mr-1" size={14} />}儲存設定
            </Button>
            {msg && <span className="text-sm text-green-700">{msg}</span>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">寄信紀錄（最近 200 筆）</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? <p className="text-sm text-muted-foreground">尚無寄信紀錄</p> : (
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm border-b pb-1 gap-2">
                  <span className="truncate">
                    <Badge variant="outline" className="mr-1">{DOC_LABEL[l.docType] || l.docType}</Badge>
                    {l.subject} → {l.recipient || "（無收件人）"}
                  </span>
                  <span className="shrink-0 flex items-center gap-2">
                    {l.trigger === "auto" && <Badge variant="secondary">自動</Badge>}
                    <Badge className={l.status === "sent" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                      {l.status === "sent" ? "已寄出" : "失敗"}
                    </Badge>
                    <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString("zh-TW")}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

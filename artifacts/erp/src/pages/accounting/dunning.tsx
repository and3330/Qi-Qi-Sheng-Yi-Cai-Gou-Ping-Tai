import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Copy, PhoneCall } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

interface OverdueInvoice { invoiceId: number; invoiceNumber: string; invoiceDate: string; dueDate: string; overdueAmount: number; daysOverdue: number; suggested: { level: number; label: string }; dunCount: number; lastDunnedDate: string | null; lastNote: string | null }
interface CustomerGroup { customerId: number; customerName: string; contactPerson: string | null; phone: string | null; email: string | null; totalOverdue: number; maxDaysOverdue: number; invoices: OverdueInvoice[] }
interface Dunning { asOfDate: string; customers: CustomerGroup[]; totalOverdue: number }

const CHANNELS: Record<string, string> = { phone: "電話", email: "電子郵件", line: "通訊軟體", letter: "書面" };

function messageFor(group: CustomerGroup): string {
  const lines = group.invoices.map(i => `・${i.invoiceNumber}（到期日 ${i.dueDate}，已逾期 ${i.daysOverdue} 天）${money(i.overdueAmount)}`);
  return [
    `${group.contactPerson || group.customerName} 您好：`,
    "",
    "提醒您，下列款項已超過付款期限，尚未收到款項：",
    ...lines,
    `合計 ${money(group.totalOverdue)}`,
    "",
    "若您已安排付款，請忽略這則訊息；如有任何問題，歡迎與我們聯絡。謝謝。",
  ].join("\n");
}

export default function DunningPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["/dunning"], queryFn: () => call<Dunning>("dunning") });
  const [recording, setRecording] = useState<CustomerGroup | null>(null);
  const [form, setForm] = useState({ channel: "phone", dunnedDate: todayText(), note: "" });
  const [saving, setSaving] = useState(false);

  const copy = async (group: CustomerGroup) => {
    try { await navigator.clipboard.writeText(messageFor(group)); toast({ title: "已複製催款訊息", description: "可以貼到電子郵件或通訊軟體" }); }
    catch { toast({ title: "複製失敗", description: "瀏覽器不允許存取剪貼簿", variant: "destructive" }); }
  };
  const record = async () => {
    if (!recording) return;
    setSaving(true);
    try {
      await post("dunning", { invoiceIds: recording.invoices.map(i => i.invoiceId), ...form });
      toast({ title: "已記錄催款" });
      setRecording(null);
      setForm({ channel: "phone", dunnedDate: todayText(), note: "" });
      queryClient.invalidateQueries({ queryKey: ["/dunning"] });
    } catch (error) {
      toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="催款" description="已經超過付款期限的應收款，依客戶整理。分期的發票只列已經到期的那幾期" />
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">逾期應收合計{data ? `（${data.asOfDate}）` : ""}</div><div className="text-2xl font-bold mt-1">{money(data?.totalOverdue)}</div><div className="text-xs text-muted-foreground mt-1">{data ? `${data.customers.length} 個客戶` : ""}</div></CardContent></Card>

      {isLoading && <Card><CardContent className="p-6 text-center text-muted-foreground">載入中…</CardContent></Card>}
      {data && data.customers.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">目前沒有逾期的應收款</CardContent></Card>}

      {data?.customers.map(group => (
        <Card key={group.customerId}>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{group.customerName}</div>
                <div className="text-xs text-muted-foreground">{[group.contactPerson, group.phone, group.email].filter(Boolean).join("・") || "沒有聯絡資料"}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-red-600 dark:text-red-400">{money(group.totalOverdue)}</div>
                <div className="text-xs text-muted-foreground">最久逾期 {group.maxDaysOverdue} 天</div>
              </div>
            </div>
            <ul className="divide-y rounded-lg border text-sm">
              {group.invoices.map(inv => (
                <li key={inv.invoiceId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="font-medium">{inv.invoiceNumber}</span>
                    <span className="ml-2 text-xs text-muted-foreground">到期 {inv.dueDate}・逾期 {inv.daysOverdue} 天</span>
                    <span className="block text-xs text-muted-foreground">{inv.dunCount > 0 ? `已催 ${inv.dunCount} 次，最近 ${inv.lastDunnedDate}${inv.lastNote ? `：${inv.lastNote}` : ""}` : "還沒催過"}</span>
                  </span>
                  <span className="flex items-center gap-2"><Badge variant={inv.suggested.level >= 3 ? "destructive" : "secondary"}>{inv.suggested.label}</Badge><span className="font-mono">{money(inv.overdueAmount)}</span></span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(group)}><Copy className="h-3.5 w-3.5 mr-1" />複製催款訊息</Button>
              <Button size="sm" onClick={() => setRecording(group)}><PhoneCall className="h-3.5 w-3.5 mr-1" />記錄已催款</Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!recording} onOpenChange={(o) => { if (!o) setRecording(null); }}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>記錄催款：{recording?.customerName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">會記在這個客戶的 {recording?.invoices.length} 張逾期發票上。</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dun-channel">方式</Label>
                <select id="dun-channel" className={selectClass} value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>
                  {Object.entries(CHANNELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="dun-date">日期</Label><Input id="dun-date" type="date" value={form.dunnedDate} onChange={e => setForm({ ...form, dunnedDate: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="dun-note">對方回覆</Label><Input id="dun-note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="例如：答應月底前付款" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecording(null)}>取消</Button>
            <Button onClick={record} disabled={saving}>{saving ? "處理中…" : "記錄"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

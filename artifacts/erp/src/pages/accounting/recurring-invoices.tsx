import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { MasterLookup } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";
import { ItemLines, emptyLine, type ItemLine } from "@/components/shared/item-lines";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FilePlus2, Pencil, Plus, SkipForward, Trash2 } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

interface Template {
  id: number; name: string; invoiceType: "Sales" | "Purchase"; customerId: number | null; supplierId: number | null; projectId: number;
  items: Array<{ itemId: number; itemName: string; quantity: number; rate: number }>; taxType: string; frequency: string; frequencyLabel: string;
  nextRunDate: string; endDate: string | null; isActive: boolean; lastRunDate: string | null; runCount: number; note: string | null;
  partyName: string; projectName: string | null; amount: number; due: boolean;
}
const emptyForm = { id: 0, name: "", invoiceType: "Sales", partyId: "", projectId: "", frequency: "monthly", nextRunDate: todayText(), endDate: "", isActive: true, note: "", lines: [{ ...emptyLine }] as ItemLine[] };

export default function RecurringInvoicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: templates, isLoading } = useQuery({ queryKey: ["/recurring-invoices"], queryFn: () => call<Template[]>("recurring-invoices") });
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/recurring-invoices"] });
  const fail = (error: unknown) => toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
  const dueCount = (templates || []).filter(t => t.due).length;

  const edit = (t: Template) => setForm({
    id: t.id, name: t.name, invoiceType: t.invoiceType, partyId: String(t.invoiceType === "Sales" ? t.customerId : t.supplierId), projectId: String(t.projectId),
    frequency: t.frequency, nextRunDate: t.nextRunDate, endDate: t.endDate || "", isActive: t.isActive, note: t.note || "",
    lines: t.items.map(i => ({ itemId: String(i.itemId), quantity: String(i.quantity), rate: String(i.rate), note: "" })),
  });
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = {
        name: form.name, invoiceType: form.invoiceType,
        customerId: form.invoiceType === "Sales" ? Number(form.partyId) : undefined, supplierId: form.invoiceType === "Purchase" ? Number(form.partyId) : undefined,
        projectId: Number(form.projectId), frequency: form.frequency, nextRunDate: form.nextRunDate, endDate: form.endDate || null, isActive: form.isActive, note: form.note,
        items: form.lines.filter(l => l.itemId).map(l => ({ itemId: Number(l.itemId), quantity: Number(l.quantity), rate: Number(l.rate) || 0 })),
      };
      await (form.id ? post(`recurring-invoices/${form.id}`, body, "PUT") : post("recurring-invoices", body));
      toast({ title: form.id ? "已更新" : "已新增定期發票" });
      setForm(null);
      refresh();
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  // 開立這一期：走一般的開發票流程（會入帳、套付款條件），成功後把下次開立日往後推
  const issue = async (t: Template) => {
    if (!confirm(`開立「${t.name}」這一期的發票？\n對象：${t.partyName}\n發票日：${t.nextRunDate}\n金額：${money(t.amount)}`)) return;
    setBusy(true);
    try {
      const invoice = await post<{ id: number; invoiceNumber: string }>("invoices", {
        invoiceType: t.invoiceType, customerId: t.customerId ?? undefined, supplierId: t.supplierId ?? undefined, projectId: t.projectId,
        invoiceDate: t.nextRunDate, items: t.items.map(i => ({ itemId: i.itemId, quantity: i.quantity, rate: i.rate })),
        taxType: t.taxType, taxRate: 5, taxIncluded: true,
      });
      await post(`recurring-invoices/${t.id}/mark-run`, { invoiceId: invoice.id });
      toast({ title: "已開立發票", description: invoice.invoiceNumber });
      refresh();
    } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const skip = async (t: Template) => {
    if (!confirm(`跳過「${t.name}」${t.nextRunDate} 這一期，不開發票？`)) return;
    try { await post(`recurring-invoices/${t.id}/skip`); toast({ title: "已跳過這一期" }); refresh(); } catch (error) { fail(error); }
  };
  const remove = async (t: Template) => {
    if (!confirm(`確定刪除「${t.name}」？已經開出去的發票不受影響。`)) return;
    try { await call(`recurring-invoices/${t.id}`, { method: "DELETE" }); toast({ title: "已刪除" }); refresh(); } catch (error) { fail(error); }
  };

  const valid = !!form && !!form.name.trim() && !!form.partyId && !!form.projectId && !!form.nextRunDate && form.lines.some(l => l.itemId && Number(l.quantity) > 0);

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="定期發票" description="每月、每季或每年固定要開的發票（月費、租金、顧問費）。到期時通知財務，按一下就開立"
        action={<Button onClick={() => setForm(emptyForm)}><Plus className="h-4 w-4 mr-1" />新增定期發票</Button>} />
      {dueCount > 0 && <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"><CardContent className="p-4 text-sm">有 {dueCount} 張已經到期，請按「開立」。</CardContent></Card>}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={templates}
            emptyMessage="還沒有定期發票"
            columns={[
              { header: "名稱", accessor: (t: Template) => <div><span className="font-medium">{t.name}</span><span className="block text-xs text-muted-foreground">{t.invoiceType === "Sales" ? "銷項" : "進項"}・{t.partyName}</span></div> },
              { header: "金額", accessor: (t: Template) => money(t.amount) },
              { header: "週期", accessor: "frequencyLabel" as const },
              { header: "下次開立", accessor: (t: Template) => <span className={t.due ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>{t.nextRunDate}{t.due ? "（已到期）" : ""}</span> },
              { header: "已開", accessor: (t: Template) => `${t.runCount} 次`, className: "hidden md:table-cell" },
              { header: "狀態", accessor: (t: Template) => <Badge variant={t.isActive ? "default" : "outline"}>{t.isActive ? "使用中" : "已停用"}</Badge> },
              {
                header: "操作",
                accessor: (t: Template) => (
                  <div className="flex gap-1">
                    {t.isActive && <Button size="sm" className="h-8" variant={t.due ? "default" : "outline"} disabled={busy} onClick={() => issue(t)}><FilePlus2 className="h-3.5 w-3.5 mr-1" />開立</Button>}
                    {t.isActive && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`跳過 ${t.name} 這一期`} onClick={() => skip(t)}><SkipForward className="h-4 w-4" /></Button>}
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`編輯 ${t.name}`} onClick={() => edit(t)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" aria-label={`刪除 ${t.name}`} onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        <DialogContent className="md:max-w-xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form?.id ? "編輯定期發票" : "新增定期發票"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="ri-name">名稱 *</Label><Input id="ri-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：○○公司系統月費" /></div>
              <div className="grid grid-cols-2 gap-2">
                {[["Sales", "銷項（開給客戶）"], ["Purchase", "進項（固定支出）"]].map(([value, label]) => (
                  <Button key={value} type="button" variant={form.invoiceType === value ? "default" : "outline"} onClick={() => setForm({ ...form, invoiceType: value, partyId: "", lines: [{ ...emptyLine }] })}>{label}</Button>
                ))}
              </div>
              <div>
                <Label>{form.invoiceType === "Sales" ? "客戶" : "供應商"} *</Label>
                <MasterLookup key={form.invoiceType} source={form.invoiceType === "Sales" ? "customers" : "suppliers"} value={form.partyId} onValueChange={v => setForm({ ...form, partyId: v })} clearable={false} placeholder="請選擇" />
              </div>
              <ProjectField value={form.projectId} onChange={v => setForm({ ...form, projectId: v })} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ri-frequency">週期</Label>
                  <select id="ri-frequency" className={selectClass} value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}>
                    <option value="monthly">每月</option><option value="quarterly">每季</option><option value="yearly">每年</option>
                  </select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="ri-next">下次開立日 *</Label><Input id="ri-next" type="date" value={form.nextRunDate} onChange={e => setForm({ ...form, nextRunDate: e.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="ri-end">結束日期（選填）</Label><Input id="ri-end" type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5">
                <Label>品項（單價含稅）</Label>
                <ItemLines lines={form.lines} onChange={lines => setForm({ ...form, lines })} withRate priceField={form.invoiceType === "Sales" ? "sellingPrice" : "buyingPrice"} />
              </div>
              <label className="flex items-center gap-3 text-sm"><Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />使用中</label>
              <p className="text-xs text-muted-foreground">系統不會自己開發票：到期時通知財務，確認後按「開立」才會產生發票並入帳。付款條件會套用客戶或供應商的預設值。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
            <Button onClick={save} disabled={busy || !valid}>{busy ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { call, post } from "@/lib/call";
import { usePaymentTerms, type PaymentTerm } from "@/components/shared/payment-term";

interface Row { label: string; percent: string; days: string }
const emptyForm = { id: 0, name: "", isActive: true, note: "", rows: [{ label: "全額", percent: "100", days: "30" }] as Row[] };
const PRESETS: Array<{ name: string; rows: Row[] }> = [
  { name: "月結 30 天", rows: [{ label: "全額", percent: "100", days: "30" }] },
  { name: "訂金 30%／尾款 70%", rows: [{ label: "訂金", percent: "30", days: "0" }, { label: "尾款", percent: "70", days: "30" }] },
  { name: "三期（30／40／30）", rows: [{ label: "第一期", percent: "30", days: "0" }, { label: "第二期", percent: "40", days: "30" }, { label: "第三期", percent: "30", days: "60" }] },
];

export default function PaymentTermsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: terms, isLoading } = usePaymentTerms();
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [saving, setSaving] = useState(false);

  const total = form ? Math.round(form.rows.reduce((s, r) => s + (Number(r.percent) || 0), 0) * 100) / 100 : 0;
  const setRow = (index: number, patch: Partial<Row>) => form && setForm({ ...form, rows: form.rows.map((r, i) => i === index ? { ...r, ...patch } : r) });

  const run = async (action: () => Promise<unknown>, done: string) => {
    setSaving(true);
    try { await action(); toast({ title: done }); queryClient.invalidateQueries({ queryKey: ["/payment-terms"] }); return true; }
    catch (error) { toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" }); return false; }
    finally { setSaving(false); }
  };
  const save = async () => {
    if (!form) return;
    const body = { name: form.name, isActive: form.isActive, note: form.note, installments: form.rows.map(r => ({ label: r.label, percent: Number(r.percent), days: Number(r.days) })) };
    if (await run(() => form.id ? post(`payment-terms/${form.id}`, body, "PUT") : post("payment-terms", body), form.id ? "已更新" : "已新增付款條件")) setForm(null);
  };
  const remove = (term: PaymentTerm) => {
    if (!confirm(`確定刪除「${term.name}」？`)) return;
    run(() => call(`payment-terms/${term.id}`, { method: "DELETE" }), "已刪除");
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="付款條件" description="設定發票分幾期、各佔幾成、幾天後到期。客戶與供應商設好預設條件後，開發票會自動排出各期到期日"
        action={<Button onClick={() => setForm(emptyForm)}><Plus className="h-4 w-4 mr-1" />新增付款條件</Button>} />
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={terms}
            emptyMessage="還沒有付款條件。可以先新增「月結 30 天」或「訂金 30%／尾款 70%」"
            columns={[
              { header: "名稱", accessor: (t: PaymentTerm) => <div><span className="font-medium">{t.name}</span>{t.note && <span className="block text-xs text-muted-foreground">{t.note}</span>}</div> },
              { header: "分期內容", accessor: (t: PaymentTerm) => <span className="text-sm">{t.summary}</span> },
              { header: "使用中", accessor: (t: PaymentTerm) => `客戶 ${t.customerCount}・供應商 ${t.supplierCount}`, className: "hidden md:table-cell" },
              { header: "狀態", accessor: (t: PaymentTerm) => t.isActive ? "使用中" : <span className="text-muted-foreground">已停用</span> },
              {
                header: "操作",
                accessor: (t: PaymentTerm) => (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`編輯 ${t.name}`} onClick={() => setForm({ id: t.id, name: t.name, isActive: t.isActive, note: t.note || "", rows: t.installments.map(i => ({ label: i.label, percent: String(i.percent), days: String(i.days) })) })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" aria-label={`刪除 ${t.name}`} onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        <DialogContent className="md:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form?.id ? "編輯付款條件" : "新增付款條件"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-4">
              {!form.id && (
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map(p => <Button key={p.name} type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, name: form.name || p.name, rows: p.rows })}>{p.name}</Button>)}
                </div>
              )}
              <div className="space-y-1.5"><Label htmlFor="pt-name">名稱 *</Label><Input id="pt-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：月結 30 天" /></div>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_5rem_5rem_2.5rem] gap-2 text-xs text-muted-foreground"><span>這一期的名稱</span><span>比例 %</span><span>幾天後到期</span><span /></div>
                {form.rows.map((row, index) => (
                  <div key={index} className="grid grid-cols-[1fr_5rem_5rem_2.5rem] gap-2">
                    <Input aria-label={`第 ${index + 1} 期名稱`} value={row.label} onChange={e => setRow(index, { label: e.target.value })} />
                    <Input aria-label={`第 ${index + 1} 期比例`} type="number" inputMode="decimal" value={row.percent} onChange={e => setRow(index, { percent: e.target.value })} />
                    <Input aria-label={`第 ${index + 1} 期天數`} type="number" inputMode="numeric" value={row.days} onChange={e => setRow(index, { days: e.target.value })} />
                    <Button type="button" size="icon" variant="ghost" className="h-10 w-10 text-red-500" aria-label={`刪除第 ${index + 1} 期`} disabled={form.rows.length <= 1} onClick={() => setForm({ ...form, rows: form.rows.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, rows: [...form.rows, { label: "", percent: String(Math.max(0, 100 - total)), days: form.rows[form.rows.length - 1]?.days || "0" }] })}><Plus className="h-3.5 w-3.5 mr-1" />加一期</Button>
                  <span className={`text-sm ${Math.abs(total - 100) > 0.001 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>合計 {total}%{Math.abs(total - 100) > 0.001 ? "（要等於 100%）" : ""}</span>
                </div>
                <p className="text-xs text-muted-foreground">天數從發票日起算，0 表示發票當天。修改條件只影響之後開的發票。</p>
              </div>
              <label className="flex items-center gap-3 text-sm"><Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />使用中</label>
              <div className="space-y-1.5"><Label htmlFor="pt-note">說明</Label><Input id="pt-note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
            <Button onClick={save} disabled={saving || !form?.name.trim() || Math.abs(total - 100) > 0.001}>{saving ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

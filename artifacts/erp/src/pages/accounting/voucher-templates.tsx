import { useState } from "react";
import { selectableDepartments, selectableProjects, departmentLabel, projectPickerLabel } from "@/lib/select-options";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListDepartments, useListProjects } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { CashAccountSelect } from "@/components/shared/ledger-account-select";
import { DocWindow, DocSection, DocStatus } from "@/components/shared/doc-window";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { call, money, post, selectClass } from "@/lib/call";
import { Copy, Plus, Trash2 } from "lucide-react";

/**
 * 收付款單模板製作工具（老闆 2026-11-17）：依項目類型（房租、講師費、平台撥款…）先把收款單、付款單
 * 常用的內容做成模板——預設的帳戶、專案、部門、備註、摘要行，還有這類單據才需要的自訂欄位。
 * 新增收款單、付款單時在最上面選模板，內容就會帶出來。
 */
export interface VoucherTemplateField { name: string; label: string; type: "text" | "number" | "date" | "select"; options?: string[]; required?: boolean }
export interface VoucherTemplate {
  id: number; name: string; voucherType: "Receipt" | "Payment"; description: string | null; isActive: boolean; sortOrder: number;
  config: { description?: string; projectId?: number | null; departmentId?: number | null; cashAccountId?: number | null; lines?: Array<{ description: string; amount?: number | null }>; fields?: VoucherTemplateField[] };
}
const TYPE_LABEL: Record<string, string> = { Receipt: "收款單", Payment: "付款單" };
const FIELD_TYPE_LABEL: Record<string, string> = { text: "文字", number: "數字", date: "日期", select: "下拉選單" };

interface FormLine { description: string; amount: string }
interface FormField { label: string; type: VoucherTemplateField["type"]; options: string; required: boolean }
const emptyForm = () => ({
  id: null as number | null, name: "", voucherType: "Payment" as "Receipt" | "Payment", description: "", isActive: true,
  memo: "", projectId: "", departmentId: "", cashAccountId: "",
  lines: [{ description: "", amount: "" }] as FormLine[], fields: [] as FormField[],
});
type Form = ReturnType<typeof emptyForm>;

function toForm(t: VoucherTemplate, copy = false): Form {
  return {
    id: copy ? null : t.id, name: copy ? `${t.name}（複製）` : t.name, voucherType: t.voucherType, description: t.description ?? "", isActive: copy ? true : t.isActive,
    memo: t.config.description ?? "", projectId: t.config.projectId ? String(t.config.projectId) : "", departmentId: t.config.departmentId ? String(t.config.departmentId) : "",
    cashAccountId: t.config.cashAccountId ? String(t.config.cashAccountId) : "",
    lines: t.config.lines?.length ? t.config.lines.map(l => ({ description: l.description, amount: l.amount ? String(l.amount) : "" })) : [{ description: "", amount: "" }],
    fields: (t.config.fields ?? []).map(f => ({ label: f.label, type: f.type, options: (f.options ?? []).join("、"), required: !!f.required })),
  };
}

export default function VoucherTemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: templates, isLoading } = useQuery({ queryKey: ["/voucher-templates", "all"], queryFn: () => call<VoucherTemplate[]>("voucher-templates?all=1") });
  const { data: projects } = useListProjects();
  const { data: departments } = useListDepartments();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/voucher-templates"] });

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { toast({ title: "請填模板名稱", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name, voucherType: form.voucherType, description: form.description, isActive: form.isActive,
        config: {
          description: form.memo, projectId: form.projectId ? Number(form.projectId) : null, departmentId: form.departmentId ? Number(form.departmentId) : null,
          cashAccountId: form.cashAccountId ? Number(form.cashAccountId) : null,
          lines: form.lines.filter(l => l.description.trim()).map(l => ({ description: l.description, amount: Number(l.amount) > 0 ? Number(l.amount) : null })),
          fields: form.fields.filter(f => f.label.trim()).map(f => ({ name: f.label.trim(), label: f.label.trim(), type: f.type, required: f.required, options: f.type === "select" ? f.options.split(/[、,，\n]/).map(o => o.trim()).filter(Boolean) : undefined })),
        },
      };
      if (form.id) await post(`voucher-templates/${form.id}`, body, "PUT"); else await post("voucher-templates", body);
      toast({ title: form.id ? "模板已更新" : "模板已建立", description: `新增${TYPE_LABEL[form.voucherType]}時就可以選「${form.name}」` });
      setForm(null);
      await refresh();
    } catch (e) {
      toast({ title: "沒有存成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const remove = async (t: VoucherTemplate) => {
    if (!window.confirm(`確定刪除模板「${t.name}」？已經用這個模板開過的單不受影響。`)) return;
    try {
      const result = await call<{ deactivated?: boolean; message?: string }>(`voucher-templates/${t.id}`, { method: "DELETE" });
      toast({ title: result.deactivated ? "已改成停用" : "已刪除", description: result.message });
      setForm(null);
      await refresh();
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    }
  };

  const setLine = (i: number, patch: Partial<FormLine>) => setForm(f => f && ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
  const setField = (i: number, patch: Partial<FormField>) => setForm(f => f && ({ ...f, fields: f.fields.map((x, idx) => idx === i ? { ...x, ...patch } : x) }));
  const editing = form?.id ? templates?.find(t => t.id === form.id) ?? null : null;
  const total = form ? form.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) : 0;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="收付款單模板" description="常開的收款單、付款單先做成模板：預設帳戶、專案、摘要行和自訂欄位。新增單據時選模板就會帶出來。"
        action={<Button onClick={() => setForm(emptyForm())} data-testid="button-new-voucher-template"><Plus className="mr-1 h-4 w-4" />新增模板</Button>} />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={templates ?? []}
            emptyMessage="還沒有模板。按右上角「新增模板」，例如做一個「每月房租」的付款單模板。"
            onRowClick={(t: VoucherTemplate) => setForm(toForm(t))}
            columns={[
              { header: "模板名稱", accessor: (t: VoucherTemplate) => <span className="font-medium">{t.name}</span> },
              { header: "單據", accessor: (t: VoucherTemplate) => TYPE_LABEL[t.voucherType] },
              { header: "說明", accessor: (t: VoucherTemplate) => t.description || "—", className: "hidden md:table-cell" },
              { header: "摘要行", accessor: (t: VoucherTemplate) => `${t.config.lines?.length ?? 0} 行`, className: "hidden sm:table-cell" },
              { header: "自訂欄位", accessor: (t: VoucherTemplate) => (t.config.fields?.length ? t.config.fields.map(f => f.label).join("、") : "—"), className: "hidden md:table-cell" },
              { header: "狀態", accessor: (t: VoucherTemplate) => <DocStatus label={t.isActive ? "使用中" : "已停用"} tone={t.isActive ? "default" : "outline"} /> },
            ]}
          />
        </CardContent>
      </Card>

      <DocWindow open={form !== null} onClose={() => setForm(null)} name={form?.id ? "收付款單模板" : "新增收付款單模板"} number={form?.id ? form.name : undefined} wide
        status={editing ? <DocStatus label={editing.isActive ? "使用中" : "已停用"} tone={editing.isActive ? "default" : "outline"} /> : undefined}
        description="這裡設定的都是「預設值」：用模板開單時會先帶出來，開單的人還是可以改。"
        footer={<>
          {editing && <Button variant="outline" className="mr-auto text-destructive" onClick={() => remove(editing)}><Trash2 className="mr-1 h-4 w-4" />刪除</Button>}
          {editing && <Button variant="outline" onClick={() => setForm(toForm(editing, true))}><Copy className="mr-1 h-4 w-4" />複製成新模板</Button>}
          <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
          <Button onClick={save} disabled={saving} data-testid="button-save-voucher-template">{saving ? "儲存中…" : form?.id ? "更新" : "建立"}</Button>
        </>}>
        {form && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="vt-name">模板名稱 *</Label><Input id="vt-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：每月房租、講師費、平台撥款" data-testid="input-voucher-template-name" /></div>
              <div className="space-y-1.5">
                <Label htmlFor="vt-type">用在哪種單 *</Label>
                <select id="vt-type" className={selectClass} value={form.voucherType} disabled={!!form.id} onChange={e => setForm({ ...form, voucherType: e.target.value as "Receipt" | "Payment" })}>
                  <option value="Payment">付款單</option>
                  <option value="Receipt">收款單</option>
                </select>
              </div>
              <div className="space-y-1.5 md:col-span-2"><Label htmlFor="vt-desc">說明</Label><Input id="vt-desc" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="給選模板的人看：這個模板什麼時候用" /></div>
              {form.id && (
                <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" className="h-4 w-4" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />使用中（取消勾選＝停用，新增單據時不會出現）</label>
              )}
            </div>

            <DocSection title="預設內容">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2"><Label>{form.voucherType === "Receipt" ? "收款帳戶" : "付款帳戶"}</Label><CashAccountSelect value={form.cashAccountId} onChange={v => setForm({ ...form, cashAccountId: v })} placeholder="不預設（開單時再選）" /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="vt-project">專案</Label>
                  <select id="vt-project" className={selectClass} value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })}>
                    <option value="">不預設</option>
                    {selectableProjects(projects, form.projectId).map((p: any) => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vt-dept">部門</Label>
                  <select id="vt-dept" className={selectClass} value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">不預設</option>
                    {selectableDepartments(departments, form.departmentId).map((d: any) => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 md:col-span-2"><Label htmlFor="vt-memo">備註</Label><Input id="vt-memo" value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} placeholder="整張單的備註（選填）" /></div>
              </div>
            </DocSection>

            <DocSection title="摘要行" action={<Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, lines: [...form.lines, { description: "", amount: "" }] })}><Plus className="mr-1 h-3 w-3" />加一行</Button>}>
              <p className="text-xs text-muted-foreground">每一行的摘要會原樣顯示在日記帳。金額可以留空白，開單時再填。</p>
              {form.lines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2">
                  <Input value={line.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="摘要，例如 11 月辦公室租金" aria-label={`第 ${i + 1} 行摘要`} data-testid={`input-voucher-template-line-${i}`} />
                  <Input className="text-right" type="number" inputMode="decimal" min="0" value={line.amount} onChange={e => setLine(i, { amount: e.target.value })} placeholder="金額" aria-label={`第 ${i + 1} 行金額`} />
                  <Button type="button" variant="ghost" size="icon" disabled={form.lines.length === 1} onClick={() => setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) })} aria-label={`刪除第 ${i + 1} 行`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
              {total > 0 && <p className="text-right text-sm">預設合計 <span className="font-semibold tabular-nums">{money(total)}</span></p>}
            </DocSection>

            <DocSection title="自訂欄位" action={<Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, fields: [...form.fields, { label: "", type: "text", options: "", required: false }] })} data-testid="button-add-voucher-template-field"><Plus className="mr-1 h-3 w-3" />加一個欄位</Button>}>
              <p className="text-xs text-muted-foreground">這類單據才需要多填的資料（例如：租期、課程名稱、撥款批號）。用這個模板開單時會多出這些欄位，填的內容會存在單上。</p>
              {form.fields.length === 0 && <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">目前沒有自訂欄位。</p>}
              {form.fields.map((field, i) => (
                <div key={i} className="space-y-2 rounded-md border p-2">
                  <div className="grid grid-cols-[1fr_8rem_auto] gap-2">
                    <Input value={field.label} onChange={e => setField(i, { label: e.target.value })} placeholder="欄位名稱，例如：租期" aria-label={`第 ${i + 1} 個欄位的名稱`} data-testid={`input-voucher-template-field-${i}`} />
                    <select className={selectClass} value={field.type} onChange={e => setField(i, { type: e.target.value as FormField["type"] })} aria-label={`第 ${i + 1} 個欄位的類型`}>
                      {Object.entries(FIELD_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setForm({ ...form, fields: form.fields.filter((_, idx) => idx !== i) })} aria-label={`刪除第 ${i + 1} 個欄位`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                  {field.type === "select" && <Input value={field.options} onChange={e => setField(i, { options: e.target.value })} placeholder="選項，用頓號或逗號分開，例如：月繳、季繳、年繳" aria-label={`第 ${i + 1} 個欄位的選項`} />}
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4" checked={field.required} onChange={e => setField(i, { required: e.target.checked })} />必填</label>
                </div>
              ))}
            </DocSection>
          </div>
        )}
      </DocWindow>
    </div>
  );
}

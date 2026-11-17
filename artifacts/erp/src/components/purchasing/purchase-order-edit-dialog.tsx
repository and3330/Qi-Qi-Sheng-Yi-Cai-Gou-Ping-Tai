import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocWindow, DocStatus, statusTone } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import { missingTemplateFields, templateDefaults, templateAppliesTo, suggestTemplateForGroups } from "@/lib/template-fields";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { LookupSelect } from "@/components/shared/lookup-select";

/**
 * 採購單的「同一個畫面」（老闆 2026-11-16：一種單據只有一個表單，全系統共用）。
 * 採購訂單清單的新增、清單上的編輯、採購單明細頁的編輯，開的都是這個視窗，欄位位置一樣。
 * 哪些欄位可以改，看這張單的狀態：
 *   - 新增、草稿：全部可以改（供應商、日期、幣別匯率、部門、專案、模板、品項）
 *   - 已下單／已完成／已取消：只能改預計到貨日，其他欄位鎖住只供查看
 *   - 從 Ecount 搬來的歷史單：只能改標題、專案、部門、預計到貨日、備註
 */
interface FieldDef {
  name: string; label: string; type: "text" | "number" | "date" | "select" | "textarea";
  required: boolean; options?: string[];
}
interface OrderTemplate {
  id: number; name: string; projectId: number | null; fieldSchema: FieldDef[]; isActive: boolean;
}
interface Line {
  itemId: string; quantity: string; rate: string; deliveryDate?: string; note?: string;
  /** 以下只在鎖住的單上用來顯示（歷史單的品項不一定對得到品項主檔） */
  itemName?: string; itemCode?: string; specification?: string; amount?: number;
}

const STATUS_TEXT: Record<string, string> = { Draft: "草稿", "To Receive": "待收貨", Completed: "已完成", Cancelled: "已取消" };
const CURRENCIES = ["TWD", "USD", "EUR", "JPY", "CNY"];
const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  supplierId: "", orderDate: today(),
  expectedDate: "", currency: "TWD", exchangeRate: "1",
  departmentId: "", projectId: "",
  templateId: "", extraFields: {} as Record<string, any>,
  legacyTitle: "", legacyRemarks: "",
});

export function PurchaseOrderFormDialog({ open, onOpenChange, order, initialSupplierId, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 要編輯的採購單；沒給就是新增 */
  order?: any | null;
  /** 新增時先帶入的供應商（從供應商頁按「建立採購單」過來） */
  initialSupplierId?: string;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [projs, setProjs] = useState<any[]>([]);
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [lineItems, setLineItems] = useState<Line[]>([]);
  const [lineWarnings, setLineWarnings] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const editing = order ?? null;
  const isLegacy = editing?.extraFields?.legacy === true;
  /** 內容（供應商、品項、金額…）能不能改：新增或草稿才行，歷史單一律不行 */
  const canEditContent = !editing || (editing.status === "Draft" && !isLegacy);
  /** 專案、部門能不能改：內容可改時，或歷史單補資料時 */
  const canEditOwner = canEditContent || isLegacy;

  // 打開時載入下拉選單要用的主檔
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const list = (path: string) => fetch(`/erp-api/${path}`).then(r => (r.ok ? r.json() : [])).then(d => (Array.isArray(d) ? d : [])).catch(() => []);
    Promise.all([list("suppliers"), list("items"), list("departments"), list("projects"), list("order-templates")]).then(([sup, itm, dep, prj, tpl]) => {
      if (!alive) return;
      setSuppliers(sup); setItems(itm); setDepts(dep); setProjs(prj); setTemplates(tpl);
    });
    return () => { alive = false; };
  }, [open]);

  // 每次打開：編輯就帶入這張單的內容，新增就是一張空白單
  useEffect(() => {
    if (!open) return;
    setSaving(false);
    if (!editing) {
      setForm({ ...emptyForm(), supplierId: initialSupplierId || "" });
      setLineItems([]);
      return;
    }
    const o = editing;
    const locked = !(o.status === "Draft" && o.extraFields?.legacy !== true);
    setForm({
      supplierId: String(o.supplierId ?? ""),
      orderDate: o.orderDate || today(),
      expectedDate: o.expectedDate || "",
      currency: o.currency || "TWD",
      exchangeRate: String(o.exchangeRate ?? "1"),
      departmentId: o.departmentId != null ? String(o.departmentId) : "",
      projectId: o.projectId != null ? String(o.projectId) : "",
      templateId: o.templateId != null ? String(o.templateId) : "",
      extraFields: o.extraFields || {},
      legacyTitle: o.extraFields?.legacyTitle || "",
      legacyRemarks: o.extraFields?.legacyRemarks || "",
    });
    setLineItems((Array.isArray(o.items) ? o.items : []).map((it: any) => ({
      itemId: it.itemId != null ? String(it.itemId) : "",
      quantity: String(it.quantity ?? ""),
      rate: String(it.rate ?? it.unitPrice ?? "0"),
      deliveryDate: it.deliveryDate || "",
      note: it.note || (locked ? it.summary : "") || "",
      itemName: it.itemName || it.name, itemCode: it.itemCode, specification: it.specification,
      amount: it.amount != null ? Number(it.amount) : undefined,
    })));
  }, [open, editing, initialSupplierId]);

  // 價格、數量異常提醒（只在品項可以改的時候檢查）
  useEffect(() => {
    if (!open || !canEditContent) {
      setLineWarnings({});
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/erp-api/anomaly-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: "purchase_order",
            items: lineItems.map(line => ({
              itemId: Number(line.itemId),
              rate: Number(line.rate),
              quantity: Number(line.quantity),
            })),
          }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json() as { warnings?: { index: number; message: string }[] };
        setLineWarnings(Object.fromEntries((data.warnings || []).map(warning => [warning.index, warning.message])));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLineWarnings({});
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, canEditContent, lineItems]);

  const availableTemplates = useMemo(() => templates.filter(t =>
    t.isActive && templateAppliesTo(t as any, "purchase") && (t.projectId == null || (form.projectId && String(t.projectId) === form.projectId))
  ), [templates, form.projectId]);

  // 新增採購單時，品項的分類對得上某個模板就自動帶出（編輯舊單不動）
  const lineGroupKey = useMemo(() => [...new Set(lineItems.map(l => items.find((it: any) => String(it.id) === String(l.itemId))?.itemGroup).filter(Boolean))].sort().join("|"), [lineItems, items]);
  useEffect(() => {
    if (!open || editing || form.templateId || !lineGroupKey) return;
    const tpl = suggestTemplateForGroups(availableTemplates as any[], lineGroupKey.split("|"));
    if (!tpl) return;
    setForm(p => ({ ...p, templateId: String(tpl.id), extraFields: templateDefaults(tpl.fieldSchema as any) }));
    toast({ title: `已依品項帶入模板「${tpl.name}」` });
  }, [lineGroupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedTemplate = useMemo(() =>
    templates.find(t => t.id === Number(form.templateId)) || null
  , [templates, form.templateId]);

  const addLine = () => setLineItems(prev => [...prev, { itemId: "", quantity: "1", rate: "0", deliveryDate: form.expectedDate || "", note: "" }]);
  // 採購單價含稅（與進貨入帳一致）；外幣採購不含營業稅
  const splitTax = (amount: number) => {
    if (form.currency !== "TWD") return { net: amount, tax: 0 };
    const net = Math.round(amount / 1.05);
    return { net, tax: Math.round(amount) - net };
  };
  const itemOptions = useMemo(() => items.map((it: any) => ({ value: String(it.id), label: it.itemCode ? `${it.itemCode}　${it.itemName}` : it.itemName })), [items]);
  const pickItem = (i: number, v: string) => {
    const item = items.find((it: any) => it.id === Number(v));
    setLineItems(prev => prev.map((l, idx) => idx === i ? { ...l, itemId: v, ...(item ? { rate: String(item.buyingPrice ?? item.sellingPrice ?? "0") } : {}) } : l));
  };
  const removeLine = (i: number) => setLineItems(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: string) =>
    setLineItems(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));

  /** 一列的小計：鎖住的單用單上存的金額，可以改的單照數量 × 單價算 */
  const lineAmount = (line: Line) => (!canEditContent && line.amount != null ? line.amount : Number(line.quantity) * Number(line.rate) || 0);
  const lineTotal = !canEditContent && editing?.totalAmount != null ? Number(editing.totalAmount) : lineItems.reduce((s, l) => s + lineAmount(l), 0);
  /** 一列的品項名稱（鎖住時用文字顯示） */
  const lineItemText = (line: Line) => {
    const item = items.find((it: any) => String(it.id) === String(line.itemId));
    const code = item?.itemCode ?? line.itemCode;
    const name = item?.itemName ?? line.itemName ?? "-";
    return code ? `${code}　${name}` : name;
  };
  // 歷史單的金額是搬過來的，不用現在的稅率回推稅前與營業稅
  const taxText = (amount: number) => {
    if (isLegacy) return { net: "—", tax: "—" };
    const { net, tax } = splitTax(amount);
    return { net: net.toLocaleString(), tax: tax.toLocaleString() };
  };

  const close = () => onOpenChange(false);

  const save = async () => {
    let method: "POST" | "PATCH" = "PATCH";
    let payload: Record<string, unknown>;

    if (isLegacy) {
      // 歷史採購單：只送可以改的五個欄位
      if (!form.projectId) { toast({ title: "請選擇專案", description: "每一筆收入與支出都必須歸屬到專案", variant: "destructive" }); return; }
      payload = {
        expectedDate: form.expectedDate,
        projectId: Number(form.projectId),
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        legacyTitle: form.legacyTitle,
        legacyRemarks: form.legacyRemarks,
      };
    } else if (!canEditContent) {
      // 已下單之後：只能改預計到貨日（後端不接受空白日期，沒填就先擋下來）
      if (!form.expectedDate) { toast({ title: "請填預計到貨日", variant: "destructive" }); return; }
      payload ={ expectedDate: form.expectedDate };
    } else {
      if (!form.supplierId) { toast({ title: "請選擇供應商", variant: "destructive" }); return; }
      if (!form.departmentId || !form.projectId) { toast({ title: "請選擇部門與專案", description: "部門與專案為必填欄位", variant: "destructive" }); return; }
      const validLines = lineItems.filter(l => l.itemId && Number(l.quantity) > 0);
      if (validLines.length === 0) { toast({ title: "請新增至少一個品項", variant: "destructive" }); return; }
      const missingFields = missingTemplateFields(selectedTemplate?.fieldSchema as any, form.extraFields);
      if (missingFields.length > 0) { toast({ title: "模板必填欄位尚未填寫", description: missingFields.join("、"), variant: "destructive" }); return; }
      if (form.currency !== "TWD" && !(Number(form.exchangeRate) > 0)) { toast({ title: "請輸入匯率", description: `用 ${form.currency} 採購每次都要輸入匯率，或填實際花的台幣金額`, variant: "destructive" }); return; }
      method = editing ? "PATCH" : "POST";
      payload = {
        supplierId: Number(form.supplierId), orderDate: form.orderDate,
        expectedDate: form.expectedDate || undefined, currency: form.currency,
        exchangeRate: form.currency === "TWD" ? 1 : Number(form.exchangeRate),
        departmentId: Number(form.departmentId), projectId: Number(form.projectId),
        templateId: form.templateId ? Number(form.templateId) : null,
        extraFields: form.extraFields || {},
        items: validLines.map(l => ({ itemId: Number(l.itemId), quantity: Number(l.quantity), rate: Number(l.rate), deliveryDate: l.deliveryDate || undefined, note: l.note || undefined })),
      };
    }

    setSaving(true);
    try {
      const res = await fetch(editing ? `/erp-api/purchase-orders/${editing.id}` : `/erp-api/purchase-orders`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) {
        toast({ title: editing ? "採購訂單已更新" : "採購訂單已建立" });
        onOpenChange(false);
        onSaved?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.error || (editing ? "更新失敗" : "建立失敗"), variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: editing ? "更新失敗" : "建立失敗", description: error?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // 鎖住的單，選單裡要看得到原本的值（供應商主檔還沒載完、幣別不在常用清單時也一樣）
  const supplierOptions = useMemo(() => {
    const list = suppliers.map(s => ({ value: String(s.id), label: s.name }));
    if (editing?.supplierName && form.supplierId && !list.some(o => o.value === form.supplierId)) list.push({ value: form.supplierId, label: editing.supplierName });
    return list;
  }, [suppliers, editing, form.supplierId]);
  const currencyOptions = CURRENCIES.includes(form.currency) ? CURRENCIES : [...CURRENCIES, form.currency];
  const deptOptions = [
    // 歷史單的部門可以不指定
    ...(isLegacy ? [{ value: "", label: "（不指定）" }] : []),
    ...depts.filter(d => d.isActive !== false || String(d.id) === String(form.departmentId)).map(d => ({ value: String(d.id), label: `${d.name}${d.isActive === false ? "（已停用）" : ""}` })),
  ];
  const projOptions = projs.filter(p => p.isActive !== false || String(p.id) === String(form.projectId)).map(p => ({ value: String(p.id), label: `${p.name}${p.isActive === false ? "（已停用）" : ""}` }));
  const colCount = canEditContent ? 11 : 10;

  return (
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name={editing ? "編輯採購訂單" : "新增採購訂單"}
      number={editing?.orderNumber}
      status={editing?.status ? <DocStatus label={STATUS_TEXT[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
      extraWide
      footer={<>
        <Button variant="outline" onClick={close}>取消</Button>
        <Button onClick={save} disabled={saving} data-testid={editing ? "button-save-purchase-order-edit" : "button-create-purchase-order"}>
          {saving ? "儲存中…" : editing ? "儲存變更" : "建立採購訂單"}
        </Button>
      </>}
    >
        <div className="min-w-0 space-y-4">
          {editing && !canEditContent && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {isLegacy
                ? "這是從舊系統 Ecount 搬過來的歷史採購單，可以補標題、專案、部門、預計到貨日與備註。供應商、品項、金額不能改。"
                : `這張採購單目前是「${STATUS_TEXT[editing.status] || editing.status}」，只能改預計到貨日。供應商、品項、金額不能再改。`}
            </p>
          )}
          {isLegacy && (
            <div className="space-y-1.5"><Label htmlFor="po-edit-title">標題</Label><Input id="po-edit-title" value={form.legacyTitle} onChange={e => setForm(p => ({ ...p, legacyTitle: e.target.value }))} /></div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">供應商 <span className="text-red-500">*</span></label>
              <SearchableSelect
                value={form.supplierId}
                onValueChange={v => setForm(p => ({ ...p, supplierId: v }))}
                options={supplierOptions}
                placeholder="請選擇供應商"
                searchPlaceholder="輸入供應商名稱搜尋..."
                emptyText="找不到符合的供應商"
                disabled={!canEditContent}
              />
            </div>
            <div>
              <label className="text-sm font-medium">訂單日期 <span className="text-red-500">*</span></label>
              <Input type="date" value={form.orderDate} disabled={!canEditContent} onChange={e => setForm(p => ({ ...p, orderDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium" htmlFor="po-edit-date">預計到貨日</label>
              <Input id="po-edit-date" type="date" value={form.expectedDate} onChange={e => setForm(p => ({ ...p, expectedDate: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">幣別</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm disabled:opacity-60" value={form.currency} disabled={!canEditContent} onChange={e => setForm(p => ({ ...p, currency: e.target.value, exchangeRate: e.target.value === "TWD" ? "1" : "" }))}>
                  {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {form.currency !== "TWD" && (
                <div>
                  <label className="text-sm font-medium">匯率 <span className="text-red-500">*</span></label>
                  <Input type="number" step="0.0001" min="0" value={form.exchangeRate} disabled={!canEditContent} placeholder="1 外幣 = 幾台幣" onChange={e => setForm(p => ({ ...p, exchangeRate: e.target.value }))} />
                </div>
              )}
            </div>
          </div>
          {canEditContent && form.currency !== "TWD" && (() => {
            // 外幣合計與換算：可以直接填「實際花了多少台幣」，系統反推匯率
            const foreignTotal = lineItems.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
            const twd = foreignTotal * (Number(form.exchangeRate) || 0);
            return (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm">外幣採購每次都要輸入匯率。不知道匯率的話，直接填你換這筆 {form.currency} 實際花了多少台幣：</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="text-sm font-medium" htmlFor="po-twd-total">實際花的台幣金額</label>
                    <Input id="po-twd-total" type="number" inputMode="decimal" min="0" disabled={foreignTotal <= 0} placeholder={foreignTotal > 0 ? "例如 4500" : "先填品項與單價"}
                      value={twd > 0 ? String(Math.round(twd * 100) / 100) : ""}
                      onChange={e => { const v = Number(e.target.value); setForm(p => ({ ...p, exchangeRate: v > 0 && foreignTotal > 0 ? String(Math.round((v / foreignTotal) * 1_000_000) / 1_000_000) : "" })); }} />
                  </div>
                  <p className="text-sm text-muted-foreground">{form.currency} {foreignTotal.toLocaleString()} × 匯率 {form.exchangeRate || "？"} ＝ NT$ {twd > 0 ? (Math.round(twd * 100) / 100).toLocaleString() : "？"}</p>
                </div>
              </div>
            );
          })()}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">部門 {!isLegacy && <span className="text-red-500">*</span>}</label>
              <SearchableSelect
                value={form.departmentId}
                onValueChange={v => setForm(p => ({ ...p, departmentId: v }))}
                options={deptOptions}
                placeholder={isLegacy ? "（不指定）" : "請選擇部門"}
                searchPlaceholder="輸入部門名稱搜尋..."
                emptyText="找不到符合的部門"
                triggerClassName={canEditContent && !form.departmentId ? "border-red-300 bg-red-50" : undefined}
                disabled={!canEditOwner}
              />
            </div>
            <div>
              <label className="text-sm font-medium">專案 <span className="text-red-500">*</span></label>
              <SearchableSelect
                value={form.projectId}
                onValueChange={projectId => {
                  setForm(p => {
                    // 歷史單沒有模板，換專案不用動模板欄位
                    if (isLegacy) return { ...p, projectId };
                    const templateAvailable = !p.templateId || templates.some(t =>
                      t.id === Number(p.templateId) && t.isActive && (t.projectId == null || String(t.projectId) === projectId)
                    );
                    return { ...p, projectId, templateId: templateAvailable ? p.templateId : "", extraFields: templateAvailable ? p.extraFields : {} };
                  });
                }}
                options={projOptions}
                placeholder="請選擇專案"
                searchPlaceholder="輸入專案名稱搜尋..."
                emptyText="找不到符合的專案"
                triggerClassName={canEditOwner && !form.projectId ? "border-red-300 bg-red-50" : undefined}
                disabled={!canEditOwner}
                data-testid="select-project"
              />
            </div>
          </div>
          {!isLegacy && (
            <div>
              <label className="text-sm font-medium">訂單模板</label>
              <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.templateId} disabled={!canEditContent} onChange={e => {
                const tpl = templates.find(t => t.id === Number(e.target.value));
                setForm(p => ({ ...p, templateId: e.target.value, extraFields: templateDefaults(tpl?.fieldSchema as any) }));
              }}>
                <option value="">不使用模板</option>
                {availableTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                {/* 鎖住的單：原本用的模板就算已停用或不適用，也要看得到名稱 */}
                {!canEditContent && selectedTemplate && !availableTemplates.some(t => t.id === selectedTemplate.id) && <option value={selectedTemplate.id}>{selectedTemplate.name}</option>}
              </LookupSelect>
            </div>
          )}
          {!isLegacy && selectedTemplate && selectedTemplate.fieldSchema.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold text-blue-600 mb-3">模板欄位：{selectedTemplate.name}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedTemplate.fieldSchema.map(f => (
                  <div key={f.name}>
                    <Label>{f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}</Label>
                    {f.type === "select" ? (
                      <select className="w-full border rounded-md px-3 py-2 text-sm disabled:opacity-60" disabled={!canEditContent} value={form.extraFields[f.name] || ""} onChange={e => setForm(p => ({ ...p, extraFields: { ...p.extraFields, [f.name]: e.target.value } }))}>
                        <option value="">請選擇</option>
                        {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] disabled:opacity-60" disabled={!canEditContent} value={form.extraFields[f.name] || ""} onChange={e => setForm(p => ({ ...p, extraFields: { ...p.extraFields, [f.name]: e.target.value } }))} />
                    ) : (
                      <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} disabled={!canEditContent} value={form.extraFields[f.name] || ""} onChange={e => setForm(p => ({ ...p, extraFields: { ...p.extraFields, [f.name]: e.target.value } }))} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">訂單品項 <span className="text-red-500">*</span></label>
              {canEditContent && <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="h-3 w-3 mr-1" />新增品項</Button>}
            </div>
            {/* 手機版：卡片式品項編輯 */}
            <div className="md:hidden space-y-3">
              {lineItems.map((line, i) => {
                const item = items.find((it: any) => String(it.id) === String(line.itemId));
                const amount = lineAmount(line);
                const { net, tax } = taxText(amount);
                const spec = item?.specification ?? line.specification;
                return (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">項目 {i + 1}</span>
                      {canEditContent && <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeLine(i)} aria-label={`刪除第 ${i + 1} 列`}><Trash2 size={14} /></Button>}
                    </div>
                    {canEditContent ? (
                      <SearchableSelect value={String(line.itemId || "")} onValueChange={v => pickItem(i, v)} options={itemOptions}
                        placeholder="選擇品項" searchPlaceholder="輸入品項編碼或名稱搜尋..." emptyText="找不到符合的品項" />
                    ) : <div className="text-sm font-medium">{lineItemText(line)}</div>}
                    {spec && <div className="text-xs text-muted-foreground">規格：{spec}</div>}
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="text-xs text-muted-foreground">數量</Label><Input type="number" inputMode="decimal" disabled={!canEditContent} value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} /></div>
                      <div><Label className="text-xs text-muted-foreground">單價（含稅）</Label><Input type="number" inputMode="decimal" disabled={!canEditContent} value={line.rate} onChange={e => updateLine(i, "rate", e.target.value)} /></div>
                      <div><Label className="text-xs text-muted-foreground">交付日期</Label><Input type="date" disabled={!canEditContent} value={line.deliveryDate || ""} onChange={e => updateLine(i, "deliveryDate", e.target.value)} /></div>
                      <div><Label className="text-xs text-muted-foreground">摘要</Label><Input disabled={!canEditContent} value={line.note || ""} onChange={e => updateLine(i, "note", e.target.value)} /></div>
                    </div>
                    {lineWarnings[i] && <div className="text-xs font-medium text-amber-700">{lineWarnings[i]}</div>}
                    <div className="text-right text-sm"><span className="text-muted-foreground">稅前 {net}・稅 {tax}　</span><span className="font-medium">小計 {amount.toLocaleString()}</span></div>
                  </div>
                );
              })}
            </div>
            {/* 桌面版：明細表（參考 Ecount 採購單） */}
            <div className="hidden md:block overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2 text-center font-medium">#</th>
                    <th className="w-[280px] px-2 py-2 text-left font-medium">品項編碼／名稱</th>
                    <th className="w-28 px-2 py-2 text-left font-medium">規格</th>
                    <th className="px-2 py-2 text-right font-medium">數量</th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">單價（含稅）</th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">稅前價格</th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">營業稅</th>
                    <th className="w-24 px-2 py-2 text-right font-medium">小計</th>
                    <th className="px-2 py-2 text-left font-medium">交付日期</th>
                    <th className="px-2 py-2 text-left font-medium">摘要</th>
                    {canEditContent && <th className="w-10" aria-label="刪除" />}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 && (
                    <tr><td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">{canEditContent ? "還沒有品項，按右上「新增品項」開始" : "這張單沒有品項資料"}</td></tr>
                  )}
                  {lineItems.map((line, i) => {
                    const item = items.find((it: any) => String(it.id) === String(line.itemId));
                    const amount = lineAmount(line);
                    const { net, tax } = taxText(amount);
                    return (
                      <Fragment key={i}>
                        <tr className="border-t align-middle">
                          <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-1.5">
                            {canEditContent ? (
                              <SearchableSelect value={String(line.itemId || "")} onValueChange={v => pickItem(i, v)} options={itemOptions}
                                placeholder="選擇品項" searchPlaceholder="輸入品項編碼或名稱搜尋..." emptyText="找不到符合的品項" />
                            ) : lineItemText(line)}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-muted-foreground">{item?.specification || line.specification || "-"}</td>
                          <td className="px-2 py-1.5"><Input type="number" inputMode="decimal" aria-label={`第 ${i + 1} 列數量`} className="h-9 w-24 text-right" disabled={!canEditContent} value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} /></td>
                          <td className="px-2 py-1.5"><Input type="number" inputMode="decimal" aria-label={`第 ${i + 1} 列單價`} className="h-9 w-28 text-right" disabled={!canEditContent} value={line.rate} onChange={e => updateLine(i, "rate", e.target.value)} /></td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{net}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{tax}</td>
                          <td className="px-2 py-1.5 text-right font-medium tabular-nums">{amount.toLocaleString()}</td>
                          <td className="px-2 py-1.5"><Input type="date" aria-label={`第 ${i + 1} 列交付日期`} className="h-9 w-40" disabled={!canEditContent} value={line.deliveryDate || ""} onChange={e => updateLine(i, "deliveryDate", e.target.value)} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`第 ${i + 1} 列摘要`} className="h-9 w-40" disabled={!canEditContent} value={line.note || ""} onChange={e => updateLine(i, "note", e.target.value)} /></td>
                          {canEditContent && <td className="px-1 py-1.5"><Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} aria-label={`刪除第 ${i + 1} 列`}><Trash2 className="h-4 w-4 text-red-500" /></Button></td>}
                        </tr>
                        {lineWarnings[i] && <tr><td /><td colSpan={colCount - 1} className="px-2 pb-1.5 text-xs font-medium text-amber-700">{lineWarnings[i]}</td></tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
                {lineItems.length > 0 && (() => {
                  const { net, tax } = taxText(lineTotal);
                  return (
                    <tfoot className="border-t bg-muted/30 font-medium">
                      <tr>
                        <td colSpan={5} className="px-2 py-2 text-right">合計</td>
                        <td className="px-2 py-2 text-right tabular-nums">{net}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{tax}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{lineTotal.toLocaleString()}</td>
                        <td colSpan={colCount - 8} />
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
            <div className="md:hidden">
              {lineItems.length > 0 && <div className="text-right text-sm font-medium">合計：{lineTotal.toLocaleString()}</div>}
            </div>
          </div>
          {isLegacy && (
            <div className="space-y-1.5"><Label htmlFor="po-edit-remarks">備註</Label><Textarea id="po-edit-remarks" rows={3} value={form.legacyRemarks} onChange={e => setForm(p => ({ ...p, legacyRemarks: e.target.value }))} /></div>
          )}
        </div>
    </DocWindow>
  );
}

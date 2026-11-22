import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCreateInvoice, useUpdateInvoice, useListCustomers, useListItems } from "@workspace/erp-api-client-react";
import { PaymentTermField, InvoiceSchedulePanel, paymentTermPayload } from "@/components/shared/payment-term";
import { ProjectField } from "@/components/shared/project-field";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { selectClass, todayText } from "@/lib/call";
import { DocWindow, DocSection, DocStatus, statusTone } from "@/components/shared/doc-window";
import { RelatedDocs } from "@/components/shared/related-docs";
import { Plus, Trash2 } from "lucide-react";

/**
 * 發票的「同一個畫面」（老闆 2026-11-16：一種單據只有一個表單，全系統共用）。
 * 會計的發票總表、銷售的發票、採購的發票，新增和編輯開的都是這裡的視窗，欄位位置一樣。
 * 從銷售頁進來類型固定是「銷售」、從採購頁進來固定是「採購」，其他都相同。
 */
export type InvoiceKind = "Sales" | "Purchase";
type LineItem = { itemId: number; quantity: number; rate: number };
type TaxType = "taxable" | "zero_rated" | "exempt" | "unclassified";

export const INVOICE_STATUS: Record<string, string> = { Draft: "草稿", Submitted: "已提交", Unpaid: "未付款", Overdue: "逾期", Paid: "已付款", Cancelled: "已取消", WrittenOff: "呆帳" };
export const INVOICE_TYPE: Record<string, string> = { Sales: "銷售", Purchase: "採購", "Credit Note": "銷貨折讓", "Debit Note": "採購扣項" };
/** 目前狀態可以改成哪些狀態（已收付、呆帳由沖帳紀錄和呆帳功能決定，不能直接改） */
const STATUS_NEXT: Record<string, string[]> = {
  Draft: ["Draft", "Submitted", "Unpaid", "Cancelled"],
  Submitted: ["Submitted", "Unpaid", "Overdue", "Cancelled"],
  Unpaid: ["Unpaid", "Overdue", "Cancelled"],
  Overdue: ["Overdue", "Unpaid", "Cancelled"],
  Paid: ["Paid"],
  Cancelled: ["Cancelled"],
  WrittenOff: ["WrittenOff"],
};
const TAX_OPTIONS = [{ value: "taxable", label: "應稅 5%" }, { value: "zero_rated", label: "零稅率" }, { value: "exempt", label: "免稅" }];
const emptyLine = (): LineItem => ({ itemId: 0, quantity: 1, rate: 0 });
// 用台灣時間的今天（直接取 UTC 日期，早上八點前會變成昨天）
const today = todayText;

/** 新增發票。fixedKind：從銷售頁、採購頁進來時類型固定；發票總表可以自己選 */
export function InvoiceCreateDialog({ open, onOpenChange, fixedKind, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; fixedKind?: InvoiceKind; onCreated?: () => void }) {
  const { toast } = useToast();
  const createMut = useCreateInvoice();
  const { data: customers } = useListCustomers();
  const { data: suppliers = [] } = useQuery({ queryKey: ["/erp-api/suppliers"], queryFn: () => fetch("/erp-api/suppliers").then(r => r.json()) });
  const { data: items } = useListItems();

  const [kind, setKind] = useState<InvoiceKind>(fixedKind ?? "Sales");
  const [partyId, setPartyId] = useState<number | undefined>();
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [taxType, setTaxType] = useState<TaxType>("taxable");
  const [govInvoiceNumber, setGovInvoiceNumber] = useState("");

  // 每次打開都是一張空白的新發票
  useEffect(() => {
    if (!open) return;
    setKind(fixedKind ?? "Sales"); setPartyId(undefined); setInvoiceDate(today()); setDueDate(""); setPaymentTerm("");
    setLines([emptyLine()]); setTaxType("taxable"); setGovInvoiceNumber("");
  }, [open, fixedKind]);

  const sales = kind === "Sales";
  const partyLabel = sales ? "客戶" : "供應商";
  const partyList = ((sales ? customers : suppliers) || []) as Array<{ id: number; name: string }>;
  const itemOptions = ((items || []) as Array<{ id: number; itemName: string }>).map(it => ({ value: String(it.id), label: it.itemName }));
  const totalAmount = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const netAmount = taxType === "taxable" ? Math.round(totalAmount / 1.05) : totalAmount;
  const taxAmount = taxType === "taxable" ? totalAmount - netAmount : 0;
  const termFixesDueDate = paymentTerm !== "" && paymentTerm !== "none";
  const updateLine = <K extends keyof LineItem>(idx: number, field: K, value: LineItem[K]) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const submit = async () => {
    if (!partyId || !invoiceDate) { toast({ title: `請選擇${partyLabel}與日期`, variant: "destructive" }); return; }
    if (!projectId) { toast({ title: "請選擇歸屬專案", description: "每一筆收入與支出都必須歸屬到專案", variant: "destructive" }); return; }
    const validLines = lines.filter(l => l.itemId > 0 && l.quantity > 0 && l.rate > 0);
    if (validLines.length === 0) { toast({ title: "請至少新增一個有效的明細項目", variant: "destructive" }); return; }
    try {
      await createMut.mutateAsync({
        data: {
          ...({ projectId: Number(projectId), ...paymentTermPayload(paymentTerm) } as {}),
          invoiceType: kind,
          customerId: sales ? partyId : undefined,
          supplierId: sales ? undefined : partyId,
          invoiceDate,
          dueDate: dueDate || undefined,
          items: validLines,
          taxType, taxRate: 5, taxIncluded: true,
          govInvoiceNumber: sales ? undefined : govInvoiceNumber || undefined,
        },
      });
      toast({ title: `${INVOICE_TYPE[kind]}發票已登記`, description: sales ? "僅建立 ERP 帳務紀錄，未送至綠界開立電子發票。" : undefined });
      onOpenChange(false);
      onCreated?.();
    } catch (err: any) {
      toast({ title: "建立失敗", description: err.message, variant: "destructive" });
    }
  };

  return (
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name={`登記${INVOICE_TYPE[kind]}發票（不送綠界）`}
      wide
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button onClick={submit} disabled={createMut.isPending} data-testid="button-create-invoice">{createMut.isPending ? "處理中..." : "建立"}</Button>
      </>}
    >
        <div className="grid gap-4 py-2">
          {sales && <p role="note" className="text-sm text-muted-foreground">
            此操作僅建立內部發票及既有帳務紀錄，不會向綠界開票。要開立電子發票，請至銷貨單使用「開立綠界電子發票」。
          </p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="inv-kind">類型</Label>
              <select id="inv-kind" className={selectClass} value={kind} disabled={!!fixedKind} onChange={e => { setKind(e.target.value as InvoiceKind); setPartyId(undefined); }} data-testid="select-invoice-kind">
                <option value="Sales">{INVOICE_TYPE.Sales}</option>
                <option value="Purchase">{INVOICE_TYPE.Purchase}</option>
              </select>
            </div>
            <div>
              <Label>{partyLabel} *</Label>
              <SearchableSelect
                value={partyId ? String(partyId) : ""}
                onValueChange={v => setPartyId(Number(v) || undefined)}
                options={partyList.map(p => ({ value: String(p.id), label: p.name }))}
                placeholder={`選擇${partyLabel}`}
                searchPlaceholder={`輸入${partyLabel}名稱搜尋...`}
                emptyText={`找不到符合的${partyLabel}`}
                data-testid="select-invoice-party"
              />
            </div>
            <div><Label htmlFor="inv-date">發票日期 *</Label><Input id="inv-date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
            <ProjectField value={projectId} onChange={setProjectId} />
            <div>
              <Label htmlFor="inv-due">到期日</Label>
              <Input id="inv-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={termFixesDueDate} />
              {termFixesDueDate && <p className="mt-1 text-xs text-muted-foreground">到期日會照付款條件自動算。</p>}
            </div>
            <PaymentTermField value={paymentTerm} onChange={setPaymentTerm} allowDefault id="invoice-term" />
            <div>
              <Label htmlFor="inv-tax">稅別</Label>
              <select id="inv-tax" className={selectClass} value={taxType} onChange={e => setTaxType(e.target.value as TaxType)}>
                {TAX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* 進項發票是對方開的，要登記對方的發票號碼；銷項發票的號碼由系統或電子發票產生 */}
            {!sales && <div><Label htmlFor="inv-gov">發票號碼</Label><Input id="inv-gov" value={govInvoiceNumber} onChange={e => setGovInvoiceNumber(e.target.value)} placeholder="對方開的發票號碼" /></div>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>發票明細</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines(p => [...p, emptyLine()])}><Plus size={14} className="mr-1" />新增項目</Button>
            </div>
            {/* 手機：一項一張卡片 */}
            <div className="md:hidden space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">項目 {idx + 1}</span>
                    {lines.length > 1 && <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => setLines(lines.filter((_, i) => i !== idx))} aria-label={`刪除項目 ${idx + 1}`}><Trash2 size={14} /></Button>}
                  </div>
                  <SearchableSelect value={line.itemId ? String(line.itemId) : ""} onValueChange={v => updateLine(idx, "itemId", Number(v) || 0)} options={itemOptions} placeholder="選擇品項" searchPlaceholder="輸入品項名稱搜尋..." emptyText="找不到符合的品項" />
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs text-muted-foreground">數量</Label><Input type="number" inputMode="decimal" value={line.quantity} onChange={e => updateLine(idx, "quantity", Number(e.target.value))} /></div>
                    <div><Label className="text-xs text-muted-foreground">單價（含稅）</Label><Input type="number" inputMode="decimal" value={line.rate} onChange={e => updateLine(idx, "rate", Number(e.target.value))} /></div>
                  </div>
                  <div className="text-right text-sm font-medium">小計：${(line.quantity * line.rate).toLocaleString()}</div>
                </div>
              ))}
            </div>
            {/* 電腦：一項一列 */}
            <div className="hidden md:block space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground"><span className="col-span-5">品項</span><span className="col-span-2">數量</span><span className="col-span-2">單價（含稅）</span><span className="col-span-2 text-right">小計</span></div>
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <SearchableSelect value={line.itemId ? String(line.itemId) : ""} onValueChange={v => updateLine(idx, "itemId", Number(v) || 0)} options={itemOptions} placeholder="選擇品項" searchPlaceholder="輸入品項名稱搜尋..." emptyText="找不到符合的品項" />
                  </div>
                  <Input className="col-span-2" type="number" aria-label={`項目 ${idx + 1} 數量`} value={line.quantity} onChange={e => updateLine(idx, "quantity", Number(e.target.value))} />
                  <Input className="col-span-2" type="number" aria-label={`項目 ${idx + 1} 單價`} value={line.rate} onChange={e => updateLine(idx, "rate", Number(e.target.value))} />
                  <div className="col-span-2 text-sm text-right font-medium">${(line.quantity * line.rate).toLocaleString()}</div>
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => setLines(lines.filter((_, i) => i !== idx))} disabled={lines.length <= 1} aria-label={`刪除項目 ${idx + 1}`}><Trash2 size={14} className="text-destructive" /></Button>
                </div>
              ))}
            </div>
            <div className="text-right mt-2 text-sm">未稅金額：NT$ {netAmount.toLocaleString()} ｜ 稅額：NT$ {taxAmount.toLocaleString()}</div>
            <div className="text-right font-bold">含稅合計：NT$ {totalAmount.toLocaleString()}</div>
          </div>
        </div>
    </DocWindow>
  );
}

/** 編輯發票：狀態、到期日、分期、稅別、發票號碼，下面是金額和沖帳紀錄 */
export function InvoiceEditDialog({ invoice, onClose, onSaved }: { invoice: any | null; onClose: () => void; onSaved?: () => void }) {
  const { toast } = useToast();
  const updateMut = useUpdateInvoice();
  const [status, setStatus] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taxType, setTaxType] = useState<TaxType>("unclassified");
  const [govInvoiceNumber, setGovInvoiceNumber] = useState("");
  const [settlements, setSettlements] = useState<any[]>([]);

  useEffect(() => {
    if (!invoice) return;
    setStatus(invoice.status || "Draft"); setDueDate(invoice.dueDate || ""); setTaxType(invoice.taxType || "unclassified");
    setGovInvoiceNumber(invoice.govInvoiceNumber || ""); setSettlements([]);
    let alive = true;
    fetch(`/erp-api/invoices/${invoice.id}/settlements`).then(r => (r.ok ? r.json() : [])).then(list => { if (alive) setSettlements(Array.isArray(list) ? list : []); }).catch(() => {});
    return () => { alive = false; };
  }, [invoice]);

  const purchase = invoice?.invoiceType === "Purchase";
  const note = invoice?.invoiceType === "Credit Note" || invoice?.invoiceType === "Debit Note";
  const statusChoices = (STATUS_NEXT[invoice?.status] || [invoice?.status]).filter((s: string) => !(note && s === "Cancelled"));

  const save = async () => {
    if (!invoice) return;
    try {
      const data: Record<string, unknown> = {
        dueDate: dueDate || undefined,
        taxType, taxRate: 5, taxIncluded: true,
        govInvoiceNumber: purchase ? govInvoiceNumber || undefined : undefined,
      };
      // 狀態沒改就不送，免得被當成要改狀態
      if (status !== invoice.status) data.status = status;
      await updateMut.mutateAsync({ id: invoice.id, data: data as any });
      toast({ title: "發票已更新" });
      onClose();
      onSaved?.();
    } catch (err: any) {
      toast({ title: "沒有更新", description: err.message, variant: "destructive" });
    }
  };

  return (
    <DocWindow open={!!invoice} onClose={onClose} name={`${INVOICE_TYPE[invoice?.invoiceType] || ""}發票`} number={invoice?.invoiceNumber}
      status={invoice && <DocStatus label={INVOICE_STATUS[invoice.status] || invoice.status} tone={statusTone(invoice.status)} />}
      footer={<>
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button onClick={save} disabled={updateMut.isPending} data-testid="button-save-invoice">{updateMut.isPending ? "處理中..." : "更新"}</Button>
      </>}>
        {invoice && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="inv-edit-status">狀態</Label>
                <select id="inv-edit-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}>
                  {statusChoices.map((s: string) => <option key={s} value={s}>{INVOICE_STATUS[s] || s}</option>)}
                </select>
                {invoice.status === "Paid" && <p className="mt-1 text-xs text-muted-foreground">已收付狀態由收款單／付款單的沖帳紀錄自動計算，不能在此直接修改。</p>}
                {note && <p className="mt-1 text-xs text-muted-foreground">退貨自動建立的折讓／扣項單如需取消，請至原退貨單執行取消。</p>}
              </div>
              <div><Label htmlFor="inv-edit-due">到期日</Label><Input id="inv-edit-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              <div>
                <Label htmlFor="inv-edit-tax">稅別</Label>
                <select id="inv-edit-tax" className={selectClass} value={taxType} onChange={e => setTaxType(e.target.value as TaxType)}>
                  <option value="unclassified">未分類</option>
                  {TAX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {purchase && <div><Label htmlFor="inv-edit-gov">發票號碼</Label><Input id="inv-edit-gov" value={govInvoiceNumber} onChange={e => setGovInvoiceNumber(e.target.value)} /></div>}
            </div>
            <InvoiceSchedulePanel invoiceId={invoice.id} onChanged={() => { onClose(); onSaved?.(); }} />
            <div className="text-sm text-muted-foreground">總額：NT$ {Number(invoice.totalAmount || 0).toLocaleString()} ｜ 已付：NT$ {Number(invoice.paidAmount || 0).toLocaleString()}</div>
            <DocSection title="沖帳紀錄">
              {settlements.length === 0 ? <div className="text-sm text-muted-foreground">尚無沖帳紀錄</div> : (
                <div className="border rounded-md divide-y">
                  {settlements.map((s: any) => (
                    <div key={s.id} className="flex justify-between items-center px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{s.voucherNumber || s.requestNumber || "—"}</span>
                        <span className="text-muted-foreground ml-2">{s.remarks || (s.voucherId ? "傳票沖帳" : "付款申請")}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-mono">NT$ {Number(s.amount).toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">{String(s.createdAt || "").slice(0, 10)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DocSection>
            <RelatedDocs type="invoice" id={invoice.id} onNavigate={onClose} />
          </>
        )}
    </DocWindow>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { MasterLookup, useMasterRows } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DocWindow, DocStatus, statusTone, DocFields, DocLines, DocNote } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";
import { Plus, Trash2, Trophy } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

interface RfqItem { itemId: number; itemName: string; quantity: number; unit: string | null }
interface QuoteSummary {
  supplierId: number; supplierName: string; currency: string; exchangeRate: number; leadDays: number | null; validUntil: string | null; note: string | null;
  unitPricesTwd: Array<number | null>; totalTwd: number; quotedCount: number; complete: boolean; expired: boolean;
}
interface RawQuote { supplierId: number; currency: string; exchangeRate: number; leadDays: number | null; validUntil: string | null; note: string | null; prices: Array<number | null> }
interface Rfq {
  id: number; rfqNumber: string; rfqDate: string; dueDate: string | null; title: string | null; status: string; notes: string | null;
  projectId: number | null; items: RfqItem[]; quotes: RawQuote[];
  comparison: { quotes: QuoteSummary[]; lowestByItem: Array<number | null>; cheapestSupplierId: number | null; spreadTwd: number };
  awardedSupplierId: number | null; purchaseOrderId: number | null; purchaseOrderNumber?: string | null;
}
interface ListRow {
  id: number; rfqNumber: string; rfqDate: string; dueDate: string | null; title: string | null; status: string;
  itemCount: number; quoteCount: number; itemSummary: string; cheapestSupplierName: string | null; cheapestTotalTwd: number | null; purchaseOrderId: number | null;
}

const STATUS: Record<string, string> = { Open: "詢價中", Awarded: "已轉採購單", Cancelled: "已取消" };
const emptyForm = { title: "", rfqDate: "", dueDate: "", projectId: "", notes: "", items: [{ itemId: "", quantity: "1" }] };
const emptyQuote = { supplierId: "", currency: "TWD", exchangeRate: "", leadDays: "", validUntil: "", note: "", prices: [] as string[] };

export default function RfqsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("Open");
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [quote, setQuote] = useState<typeof emptyQuote | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: list, isLoading } = useQuery({ queryKey: ["/rfqs"], queryFn: () => call<ListRow[]>("rfqs") });
  useOpenFromUrl(list, row => setViewingId(row.id));
  const { data: rfq } = useQuery({ queryKey: ["/rfqs", viewingId], enabled: viewingId !== null, queryFn: () => call<Rfq>(`rfqs/${viewingId}`) });
  const { data: itemRows } = useMasterRows("items");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/rfqs"] });
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); await refresh(); }
    catch (error) { toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const rows = (list || []).filter(row => !status || row.status === status);
  const formItems = form?.items.filter(item => item.itemId && Number(item.quantity) > 0) || [];
  const formValid = !!form && !!form.projectId && formItems.length > 0 && new Set(formItems.map(item => item.itemId)).size === formItems.length;

  const create = () => run(async () => {
    if (!form) return;
    const created = await post<Rfq>("rfqs", {
      title: form.title, rfqDate: form.rfqDate || undefined, dueDate: form.dueDate || undefined, notes: form.notes,
      projectId: Number(form.projectId), items: formItems.map(item => ({ itemId: Number(item.itemId), quantity: Number(item.quantity) })),
    });
    toast({ title: "詢價單已建立", description: `${created.rfqNumber}，接著登錄各家供應商的報價` });
    setForm(null);
    setViewingId(created.id);
  });

  const openQuote = (existing?: RawQuote) => {
    if (!rfq) return;
    setQuote(existing
      ? { supplierId: String(existing.supplierId), currency: existing.currency, exchangeRate: existing.currency === "TWD" ? "" : String(existing.exchangeRate), leadDays: existing.leadDays == null ? "" : String(existing.leadDays), validUntil: existing.validUntil || "", note: existing.note || "", prices: rfq.items.map((_, index) => existing.prices[index] == null ? "" : String(existing.prices[index])) }
      : { ...emptyQuote, prices: rfq.items.map(() => "") });
  };
  const quoteTotal = quote && rfq ? rfq.items.reduce((sum, item, index) => sum + (Number(quote.prices[index]) || 0) * item.quantity, 0) : 0;
  const quoteValid = !!quote && !!quote.supplierId && quote.prices.some(price => price !== "" && Number(price) >= 0) && (quote.currency === "TWD" || Number(quote.exchangeRate) > 0);
  const saveQuote = () => run(async () => {
    if (!quote || !rfq) return;
    await post(`rfqs/${rfq.id}/quotes`, {
      supplierId: Number(quote.supplierId), currency: quote.currency, exchangeRate: quote.currency === "TWD" ? undefined : Number(quote.exchangeRate),
      leadDays: quote.leadDays === "" ? null : Number(quote.leadDays), validUntil: quote.validUntil || null, note: quote.note,
      prices: quote.prices.map(price => price === "" ? null : Number(price)),
    }, "PUT");
    toast({ title: "報價已登錄" });
    setQuote(null);
  });
  const removeQuote = (supplierId: number, name: string) => {
    if (!rfq || !confirm(`刪除 ${name} 的報價？`)) return;
    run(async () => { await post(`rfqs/${rfq.id}/quotes/${supplierId}`, undefined, "DELETE"); });
  };
  const award = (summary: QuoteSummary) => {
    if (!rfq) return;
    const partial = summary.complete ? "" : `\n\n注意：這家只報了 ${summary.quotedCount}/${rfq.items.length} 個品項，採購單只會有它有報價的品項。`;
    if (!confirm(`向「${summary.supplierName}」下單，金額約 ${money(summary.totalTwd)}？\n會建立一張採購單草稿，之後照一般採購流程走。${partial}`)) return;
    run(async () => {
      const result = await post<Rfq & { purchaseOrderNumber: string }>(`rfqs/${rfq.id}/award`, { supplierId: summary.supplierId });
      toast({ title: "已轉成採購單", description: `${result.purchaseOrderNumber}（草稿）` });
    });
  };
  const cancel = () => {
    if (!rfq || !confirm(`取消詢價單 ${rfq.rfqNumber}？`)) return;
    run(async () => { await post(`rfqs/${rfq.id}/cancel`); toast({ title: "已取消" }); setViewingId(null); });
  };

  const comparison = rfq?.comparison;
  const cheapest = comparison?.quotes.find(q => q.supplierId === comparison.cheapestSupplierId);

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="詢價單" description="同一批東西問幾家供應商，報價放在一起比，選定後直接轉成採購單"
        action={<Button onClick={() => setForm({ ...emptyForm, rfqDate: todayText(), items: [{ itemId: "", quantity: "1" }] })} data-testid="button-new-rfq"><Plus className="h-4 w-4 mr-1" />新增詢價單</Button>} />

      <div className="w-40">
        <Label htmlFor="rfq-status" className="text-xs">狀態</Label>
        <select id="rfq-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部</option>
          {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        <DataTable
          isLoading={isLoading} data={rows} emptyMessage="沒有詢價單"
          onRowClick={(row: ListRow) => setViewingId(row.id)}
          columns={[
            { header: "單號", accessor: (row: ListRow) => <div><span className="font-medium">{row.rfqNumber}</span><span className="block text-xs text-muted-foreground">{row.rfqDate}{row.dueDate ? `・${row.dueDate} 前回覆` : ""}</span></div> },
            { header: "詢價內容", accessor: (row: ListRow) => <div className="text-sm">{row.title || row.itemSummary}<span className="block text-xs text-muted-foreground">{row.title ? row.itemSummary : `${row.itemCount} 個品項`}</span></div> },
            { header: "報價", accessor: (row: ListRow) => `${row.quoteCount} 家`, className: "text-right" },
            { header: "目前最低", accessor: (row: ListRow) => row.cheapestTotalTwd == null ? <span className="text-muted-foreground">—</span> : <div className="tabular-nums">{money(row.cheapestTotalTwd)}<span className="block text-xs text-muted-foreground">{row.cheapestSupplierName}</span></div>, className: "text-right hidden md:table-cell" },
            { header: "狀態", accessor: (row: ListRow) => <Badge variant={row.status === "Open" ? "default" : "outline"}>{STATUS[row.status] || row.status}</Badge> },
          ]}
        />
      </CardContent></Card>

      {/* 新增詢價單 */}
      <DocWindow open={form !== null} onClose={() => setForm(null)} name="新增詢價單" description={<>先列出要問價的品項與數量，建立後再登錄各家的報價。</>}
        footer={<>
          <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
            <Button onClick={create} disabled={busy || !formValid}>{busy ? "處理中…" : "建立"}</Button>
        </>}>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="rfq-title">標題</Label><Input id="rfq-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例如：暑期教具補貨" /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="rfq-date">詢價日期</Label><Input id="rfq-date" type="date" value={form.rfqDate} onChange={e => setForm({ ...form, rfqDate: e.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="rfq-due">請供應商幾號前回覆</Label><Input id="rfq-due" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></div>
              </div>
              <ProjectField value={form.projectId} onChange={v => setForm({ ...form, projectId: v })} />
              <div className="space-y-2">
                <Label>要詢價的品項 *</Label>
                {form.items.map((item, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <div className="flex-1 min-w-0"><MasterLookup source="items" value={item.itemId} onValueChange={v => setForm({ ...form, items: form.items.map((row, i) => i === index ? { ...row, itemId: v } : row) })} clearable={false} placeholder="選擇品項" /></div>
                    <Input className="w-24" type="number" inputMode="decimal" min="0" aria-label="數量" value={item.quantity} onChange={e => setForm({ ...form, items: form.items.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row) })} />
                    <Button variant="ghost" size="icon" aria-label="移除這個品項" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, items: [...form.items, { itemId: "", quantity: "1" }] })}><Plus className="h-3 w-3 mr-1" />再加一個品項</Button>
                {formItems.length > 0 && new Set(formItems.map(item => item.itemId)).size !== formItems.length && <p className="text-xs text-red-600 dark:text-red-400">同一個品項重複了，請把數量合在一起。</p>}
                {(itemRows || []).length === 0 && <p className="text-xs text-muted-foreground">還沒有品項，請先到「庫存 → 品項」建立。</p>}
              </div>
              <div className="space-y-1.5"><Label htmlFor="rfq-notes">備註</Label><Input id="rfq-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="規格、包裝、交貨地點等" /></div>
            </div>
          )}
      </DocWindow>

      {/* 詢價單明細與比價 */}
      <DocWindow
        open={viewingId !== null && quote === null}
        onClose={() => setViewingId(null)}
        name="詢價單"
        number={rfq?.rfqNumber}
        status={rfq && <DocStatus label={STATUS[rfq.status] || rfq.status} tone={rfq.status === "Awarded" ? "default" : statusTone(rfq.status)} />}
        description={rfq ? undefined : "載入中…"}
        wide
        footer={
          <>
            {rfq?.status === "Open" && <Button variant="ghost" className="mr-auto text-red-600 dark:text-red-400" onClick={cancel} disabled={busy}>取消詢價單</Button>}
            <Button variant="outline" onClick={() => setViewingId(null)}>關閉</Button>
            {rfq?.status === "Open" && <Button onClick={() => openQuote()} disabled={busy} data-testid="button-add-quote"><Plus className="h-4 w-4 mr-1" />登錄報價</Button>}
          </>
        }
      >
        {rfq && comparison && (
          <>
            <DocFields items={[
              ["標題", rfq.title],
              ["詢價日期", rfq.rfqDate],
              ["回覆期限", rfq.dueDate ? `${rfq.dueDate} 前回覆` : null],
            ]} />
            {comparison.quotes.length === 0 ? (
              <>
                <p className="rounded-md border border-dashed p-4 text-center text-muted-foreground">還沒有報價。問到價錢後，按下面的「登錄報價」把各家的單價填進來。</p>
                <DocLines
                  rows={rfq.items}
                  columns={[
                    { header: "品項", cell: item => item.itemName },
                    { header: "數量", align: "right", cell: item => `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` },
                  ]}
                />
              </>
            ) : (
              <>
                {cheapest && <p className="flex items-start gap-1.5"><Trophy className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" /><span>總價最低：<span className="font-medium">{cheapest.supplierName}</span>（{money(cheapest.totalTwd)}）{comparison.spreadTwd > 0 ? `，比最貴的便宜 ${money(comparison.spreadTwd)}` : ""}</span></p>}
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-1.5 text-left font-medium">品項（台幣單價）</th>
                        {comparison.quotes.map(q => <th key={q.supplierId} scope="col" className="px-3 py-1.5 text-right font-medium whitespace-nowrap">{q.supplierName}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rfq.items.map((item, index) => (
                        <tr key={item.itemId} className="border-t">
                          <th scope="row" className="px-3 py-1.5 text-left font-normal">{item.itemName}<span className="block text-xs text-muted-foreground">× {item.quantity}{item.unit ? ` ${item.unit}` : ""}</span></th>
                          {comparison.quotes.map(q => {
                            const price = q.unitPricesTwd[index];
                            const lowest = comparison.lowestByItem[index] === q.supplierId && comparison.quotes.length > 1;
                            return <td key={q.supplierId} className={`px-3 py-1.5 text-right tabular-nums ${lowest ? "font-semibold text-emerald-700 dark:text-emerald-400" : ""}`}>{price == null ? <span className="text-muted-foreground">沒報</span> : <>{money(price)}{lowest ? <span className="block text-xs font-normal">最低</span> : null}</>}</td>;
                          })}
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/30">
                        <th scope="row" className="px-3 py-1.5 text-left font-medium">合計（台幣）</th>
                        {comparison.quotes.map(q => <td key={q.supplierId} className={`px-3 py-1.5 text-right tabular-nums font-medium ${q.supplierId === comparison.cheapestSupplierId ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{money(q.totalTwd)}{!q.complete ? <span className="block text-xs font-normal text-muted-foreground">只報 {q.quotedCount}/{rfq.items.length} 項</span> : null}</td>)}
                      </tr>
                      <tr className="border-t">
                        <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">交期／幣別</th>
                        {comparison.quotes.map(q => <td key={q.supplierId} className="px-3 py-1.5 text-right text-xs text-muted-foreground">{q.leadDays == null ? "交期未填" : `${q.leadDays} 天`}<span className="block">{q.currency === "TWD" ? "台幣" : `${q.currency}（匯率 ${q.exchangeRate}）`}</span>{q.expired ? <span className="block text-red-600 dark:text-red-400">報價已過期</span> : q.validUntil ? <span className="block">有效到 {q.validUntil}</span> : null}{q.note ? <span className="block">{q.note}</span> : null}</td>)}
                      </tr>
                      {rfq.status === "Open" && (
                        <tr className="border-t">
                          <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">動作</th>
                          {comparison.quotes.map(q => (
                            <td key={q.supplierId} className="px-3 py-1.5 text-right">
                              <div className="flex flex-col items-end gap-1">
                                <Button size="sm" onClick={() => award(q)} disabled={busy} data-testid={`button-award-${q.supplierId}`}>向這家下單</Button>
                                <Button size="sm" variant="ghost" onClick={() => openQuote(rfq.quotes.find(raw => raw.supplierId === q.supplierId))} disabled={busy}>修改報價</Button>
                                <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => removeQuote(q.supplierId, q.supplierName)} disabled={busy}>刪除</Button>
                              </div>
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <DocNote>{rfq.notes}</DocNote>
            <RelatedDocs type="rfq" id={rfq.id} onNavigate={() => setViewingId(null)} />
          </>
        )}
      </DocWindow>

      {/* 登錄一家供應商的報價 */}
      <DocWindow open={quote !== null} onClose={() => setQuote(null)} name="登錄報價" description={<>填這家供應商報的單價；沒報的品項留空白。同一家再登一次會蓋掉舊的。</>}
        footer={<>
          <Button variant="outline" onClick={() => setQuote(null)}>取消</Button>
            <Button onClick={saveQuote} disabled={busy || !quoteValid}>{busy ? "處理中…" : "儲存報價"}</Button>
        </>}>
          {quote && rfq && (
            <div className="space-y-4">
              <div><Label>供應商 *</Label><MasterLookup source="suppliers" value={quote.supplierId} onValueChange={v => setQuote({ ...quote, supplierId: v })} clearable={false} placeholder="選擇供應商" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="q-currency">幣別</Label>
                  <select id="q-currency" className={selectClass} value={quote.currency} onChange={e => setQuote({ ...quote, currency: e.target.value })}>
                    <option value="TWD">台幣 TWD</option><option value="CNY">人民幣 CNY</option><option value="USD">美金 USD</option><option value="JPY">日圓 JPY</option><option value="EUR">歐元 EUR</option><option value="HKD">港幣 HKD</option>
                  </select>
                </div>
                {quote.currency !== "TWD" && <div className="space-y-1.5"><Label htmlFor="q-rate">匯率 *</Label><Input id="q-rate" type="number" inputMode="decimal" step="0.0001" min="0" value={quote.exchangeRate} onChange={e => setQuote({ ...quote, exchangeRate: e.target.value })} placeholder={`1 ${quote.currency} = 多少台幣`} /></div>}
              </div>
              <div className="space-y-2">
                <Label>各品項單價（{quote.currency}）</Label>
                {rfq.items.map((item, index) => (
                  <div key={item.itemId} className="flex items-center gap-2">
                    <label htmlFor={`q-price-${index}`} className="flex-1 min-w-0 text-sm">{item.itemName}<span className="text-xs text-muted-foreground"> × {item.quantity}</span></label>
                    <Input id={`q-price-${index}`} className="w-32" type="number" inputMode="decimal" min="0" value={quote.prices[index] ?? ""} onChange={e => setQuote({ ...quote, prices: rfq.items.map((_, i) => i === index ? e.target.value : (quote.prices[i] ?? "")) })} placeholder="沒報留空" />
                  </div>
                ))}
                <p className="text-sm text-right tabular-nums">合計 {quote.currency} {quoteTotal.toLocaleString()}{quote.currency !== "TWD" && Number(quote.exchangeRate) > 0 ? `（約 ${money(quoteTotal * Number(quote.exchangeRate))}）` : ""}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="q-lead">交期（天）</Label><Input id="q-lead" type="number" inputMode="numeric" min="0" value={quote.leadDays} onChange={e => setQuote({ ...quote, leadDays: e.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="q-valid">報價有效到</Label><Input id="q-valid" type="date" value={quote.validUntil} onChange={e => setQuote({ ...quote, validUntil: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="q-note">備註</Label><Input id="q-note" value={quote.note} onChange={e => setQuote({ ...quote, note: e.target.value })} placeholder="付款條件、最低訂購量、含不含運" /></div>
            </div>
          )}
      </DocWindow>
    </div>
  );
}

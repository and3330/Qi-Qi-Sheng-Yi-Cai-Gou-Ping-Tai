import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocStatus, DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { call, money, post, selectClass, todayText } from "@/lib/call";
import { CashAccountSelect, LedgerAccountSelect } from "@/components/shared/ledger-account-select";
import { DocListDrillDialog, type DocListTarget } from "@/components/shared/doc-list-drill";

interface Row {
  id?: number;
  customerId: number; customerName: string; customerCode: string | null; contactPerson: string | null; phone: string | null;
  outstanding: number; fromOrders: number; fromInvoices: number;
  overdueAmount: number; overdueCount: number; oldestOverdueDays: number;
  creditLimit: number | null; creditUsedPct: number | null; overLimit: boolean; available: number | null;
  lastReceiptDate: string | null;
  legacyOutstanding: number; legacyCount: number; legacyOldestDate: string | null;
}
interface OpenOrder { id: number; orderNumber: string; orderDate: string; label: string | null; legacy: boolean; projectId: number | null; totalAmount: number; paidAmount: number; outstanding: number; days: number }
interface OpenItem { id: number; orderNumber: string; orderDate: string; label: string | null; legacy: boolean; projectId: number | null; customerId: number; customerCode: string | null; customerName: string; outstanding: number; days: number }
interface Overview {
  asOfDate: string;
  summary: { outstanding: number; overdue: number; customers: number; overdueCustomers: number; overLimitCustomers: number; legacyOutstanding: number; legacyCount: number; legacyCustomers: number };
  rows: Row[];
}

const FILTERS: Record<string, string> = { owing: "還有欠款的", overdue: "有逾期的", over: "超過信用額度的", all: "全部（含只設了額度的）" };

export default function ReceivablesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("owing");
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<Row | null>(null);
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<DocListTarget | null>(null);
  // 應收沖帳：勾選要收的銷貨單（值是這次要收多少），按一下建立收款單
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [payDate, setPayDate] = useState(todayText());
  const [cashAccountId, setCashAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [settling, setSettling] = useState(false);
  // 手續費：客戶欠 100、銀行只進 70，另外 30 是手續費時，整張 100 一樣沖掉，30 記成手續費
  const [fees, setFees] = useState<Record<number, string>>({});
  const [feeAccountId, setFeeAccountId] = useState("");
  // 兩種看法：依客戶彙總，或像舊系統的「應收沖帳」一張單一列
  const [mode, setMode] = useState<"customers" | "items">("customers");
  const [ticked, setTicked] = useState<Record<number, true>>({});

  const { data, isLoading } = useQuery({ queryKey: ["/receivables/overview"], queryFn: () => call<Overview>("receivables/overview") });
  // 點開某個客戶時，把還沒收清的銷貨單一張一張列出來
  const { data: openOrders, isLoading: loadingOrders } = useQuery({
    queryKey: ["/receivables/open-orders", viewing?.customerId], enabled: viewing !== null,
    queryFn: () => call<OpenOrder[]>(`receivables/customers/${viewing!.customerId}/open-orders`),
  });
  const { data: ledgerAccounts = [] } = useQuery({ queryKey: ["/accounts"], queryFn: () => call<Array<{ id: number; accountName: string; accountType: string; isGroup: boolean }>>("accounts"), staleTime: 60_000, enabled: viewing !== null });
  const { data: openItems, isLoading: loadingItems } = useQuery({
    queryKey: ["/receivables/open-items"], enabled: mode === "items",
    queryFn: () => call<{ count: number; total: number; rows: OpenItem[] }>("receivables/open-items"),
  });
  const keyword = search.trim().toLowerCase();
  const items = (openItems?.rows || []).filter(item => !keyword || item.customerName.toLowerCase().includes(keyword) || (item.customerCode || "").toLowerCase().includes(keyword) || item.orderNumber.toLowerCase().includes(keyword));
  const tickedItems = (openItems?.rows || []).filter(item => ticked[item.id]);
  const tickedTotal = tickedItems.reduce((sum, item) => sum + item.outstanding, 0);
  const tick = (item: OpenItem, on: boolean) => {
    if (on && tickedItems.length > 0 && tickedItems[0].customerId !== item.customerId) {
      toast({ title: "一張收款單只能收一個客戶", description: `已經勾了「${tickedItems[0].customerName}」的單。要收別的客戶，請先取消勾選或先把這張收款單建好。`, variant: "destructive" });
      return;
    }
    setTicked(prev => { const next = { ...prev }; if (on) next[item.id] = true; else delete next[item.id]; return next; });
  };
  /** 勾好之後按「輸入收款單」：開那個客戶的視窗，剛剛勾的單已經選好、金額帶好 */
  const startReceipt = () => {
    if (tickedItems.length === 0) return;
    const first = tickedItems[0];
    const row = (data?.rows || []).find(r => r.customerId === first.customerId)
      ?? { customerId: first.customerId, customerName: first.customerName, customerCode: first.customerCode, contactPerson: null, phone: null, outstanding: tickedTotal, fromOrders: tickedTotal, fromInvoices: 0, overdueAmount: 0, overdueCount: 0, oldestOverdueDays: 0, creditLimit: null, creditUsedPct: null, overLimit: false, available: null, lastReceiptDate: null, legacyOutstanding: 0, legacyCount: 0, legacyOldestDate: null };
    open(row);
    setPicked(Object.fromEntries(tickedItems.map(item => [item.id, String(item.outstanding)])));
  };
  const rows = (data?.rows || []).filter(row =>
    (filter === "all" || (filter === "owing" && row.outstanding > 0) || (filter === "overdue" && row.overdueAmount > 0) || (filter === "over" && row.overLimit))
    && (!keyword || row.customerName.toLowerCase().includes(keyword) || (row.customerCode || "").toLowerCase().includes(keyword)));

  const open = (row: Row) => { setLimit(row.creditLimit ? String(row.creditLimit) : ""); setPicked({}); setFees({}); setMemo(""); setPayDate(todayText()); setViewing(row); };
  const pickedOrders = (openOrders || []).filter(order => picked[order.id] !== undefined);
  const pickedTotal = pickedOrders.reduce((sum, order) => sum + (Number(picked[order.id]) || 0), 0);
  const feeOf = (id: number) => Number(fees[id]) || 0;
  const feeTotal = pickedOrders.reduce((sum, order) => sum + feeOf(order.id), 0);
  const feeProblem = pickedOrders.find(order => feeOf(order.id) < 0 || (feeOf(order.id) > 0 && feeOf(order.id) >= (Number(picked[order.id]) || 0)));
  const feeAccountValue = feeAccountId || String(ledgerAccounts.find(a => !a.isGroup && a.accountType === "Expense" && /手續費/.test(a.accountName))?.id ?? "");
  const pickedProblem = pickedOrders.find(order => !(Number(picked[order.id]) > 0) || Number(picked[order.id]) > order.outstanding + 0.005);
  const togglePick = (order: OpenOrder, on: boolean) => setPicked(prev => {
    const next = { ...prev };
    if (on) next[order.id] = String(order.outstanding); else delete next[order.id];
    return next;
  });
  const settle = async () => {
    if (!viewing || pickedOrders.length === 0) return;
    if (pickedProblem) { toast({ title: `${pickedProblem.orderNumber} 的金額不對`, description: `這次收的金額要大於 0，而且不能超過還欠的 ${money(pickedProblem.outstanding)}`, variant: "destructive" }); return; }
    if (feeProblem) { toast({ title: `${feeProblem.orderNumber} 的手續費不對`, description: "手續費要小於這次沖的金額，而且不能是負數", variant: "destructive" }); return; }
    if (feeTotal > 0 && !feeAccountValue) { toast({ title: "請選擇手續費科目", description: "手續費要記到哪個費用科目", variant: "destructive" }); return; }
    if (!cashAccountId) { toast({ title: "請選擇收款帳戶", description: "要知道錢進了哪個帳戶，銀行存款的帳才會對", variant: "destructive" }); return; }
    const projectId = pickedOrders.find(order => order.projectId)?.projectId;
    setSettling(true);
    try {
      const voucher = await post<{ voucherNumber: string }>("vouchers", {
        voucherType: "收款單", voucherDate: payDate, customerId: viewing.customerId, cashAccountId: Number(cashAccountId),
        ...(feeTotal > 0 ? { feeAccountId: Number(feeAccountValue) } : {}),
        description: memo.trim() || `${viewing.customerName} 收款（${pickedOrders.map(order => order.orderNumber).join("、")}）`.slice(0, 300),
        ...(projectId ? { projectId } : {}),
        items: pickedOrders.map(order => ({ description: `收款 ${order.orderNumber}${order.label ? ` ${order.label}` : ""}`.slice(0, 200), amount: Number(picked[order.id]), ...(feeOf(order.id) > 0 ? { fee: feeOf(order.id) } : {}), salesOrderId: order.id })),
      });
      toast({ title: `已建立收款單 ${voucher.voucherNumber}`, description: `沖掉 ${pickedOrders.length} 張銷貨單，共 ${money(pickedTotal)}${feeTotal > 0 ? `（帳戶實收 ${money(pickedTotal - feeTotal)}、手續費 ${money(feeTotal)}）` : ""}` });
      setPicked({}); setFees({}); setMemo("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/receivables/overview"] }),
        queryClient.invalidateQueries({ queryKey: ["/receivables/open-orders", viewing.customerId] }),
        queryClient.invalidateQueries({ queryKey: ["/receivables/open-items"] }),
      ]);
      setTicked({});
      setViewing(prev => prev ? { ...prev, outstanding: Math.max(0, prev.outstanding - pickedTotal), fromOrders: Math.max(0, prev.fromOrders - pickedTotal), lastReceiptDate: payDate } : prev);
    } catch (err) {
      toast({ title: "收款單建立失敗", description: err instanceof Error ? err.message : "請再試一次", variant: "destructive" });
    } finally { setSettling(false); }
  };
  const saveLimit = async () => {
    if (!viewing) return;
    setSaving(true);
    try {
      await post(`customers/${viewing.customerId}`, { creditLimit: limit === "" ? null : Number(limit) }, "PATCH");
      toast({ title: "信用額度已更新", description: Number(limit) > 0 ? `${viewing.customerName}：${money(limit)}` : `${viewing.customerName}：不限額度` });
      await queryClient.invalidateQueries({ queryKey: ["/receivables/overview"] });
      setViewing(null);
    } catch (error) {
      toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const summary = data?.summary;
  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="應收帳款總覽" description="每個客戶還欠多少、逾期多少、信用額度用了多少，一頁看完" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">還沒收的錢</p><p className="text-2xl font-semibold tabular-nums">{money(summary?.outstanding)}</p><p className="text-xs text-muted-foreground">{summary?.customers ?? 0} 個客戶</p>{(summary?.legacyOutstanding ?? 0) > 0 && <p className="mt-1 text-xs text-amber-700" data-testid="text-legacy-outstanding">其中舊系統（Ecount）帶過來 {money(summary?.legacyOutstanding)}・{summary?.legacyCount} 張・{summary?.legacyCustomers} 個客戶</p>}</CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">其中已逾期</p><p className={`text-2xl font-semibold tabular-nums ${summary?.overdue ? "text-red-600 dark:text-red-400" : ""}`}>{money(summary?.overdue)}</p><p className="text-xs text-muted-foreground">{summary?.overdueCustomers ?? 0} 個客戶</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">超過信用額度</p><p className={`text-2xl font-semibold tabular-nums ${summary?.overLimitCustomers ? "text-red-600 dark:text-red-400" : ""}`}>{summary?.overLimitCustomers ?? 0}</p><p className="text-xs text-muted-foreground">個客戶</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">資料日期</p><p className="text-2xl font-semibold tabular-nums">{data?.asOfDate || "—"}</p><p className="text-xs text-muted-foreground">即時計算</p></CardContent></Card>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="md:w-56">
          <Label htmlFor="ar-filter" className="text-xs">顯示</Label>
          <select id="ar-filter" className={selectClass} value={filter} onChange={e => setFilter(e.target.value)}>
            {Object.entries(FILTERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="md:w-64">
          <Label htmlFor="ar-search" className="text-xs">找客戶</Label>
          <Input id="ar-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="客戶名稱或代號" />
        </div>
        <div className="flex items-end gap-2 md:ml-auto">
          <div className="flex rounded-md border p-0.5" role="tablist" aria-label="檢視方式">
            <button type="button" role="tab" aria-selected={mode === "customers"} onClick={() => setMode("customers")} className={`min-h-9 rounded px-3 text-sm ${mode === "customers" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} data-testid="tab-ar-customers">依客戶</button>
            <button type="button" role="tab" aria-selected={mode === "items"} onClick={() => setMode("items")} className={`min-h-9 rounded px-3 text-sm ${mode === "items" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} data-testid="tab-ar-items">應收沖帳</button>
          </div>
          <Button variant="outline" asChild><Link href="/reports/ar-aging">帳齡分析</Link></Button>
          <Button variant="outline" asChild><Link href="/accounting/dunning">催款</Link></Button>
          <Button asChild><Link href="/accounting/receipts">收款</Link></Button>
        </div>
      </div>

      {mode === "items" && (
        <Card><CardContent className="p-0" data-testid="ar-settle-list">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <p className="text-sm text-muted-foreground">還沒收清的銷貨單一張一列（含舊系統帶過來的）。勾選同一個客戶的單，按「輸入收款單」沖帳。</p>
            <Button onClick={startReceipt} disabled={tickedItems.length === 0} data-testid="button-start-receipt">輸入收款單{tickedItems.length > 0 ? `（${tickedItems.length} 張・${money(tickedTotal)}）` : ""}</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2"><span className="sr-only">勾選</span></th>
                  <th className="px-3 py-2 text-left font-medium">單號</th>
                  <th className="px-3 py-2 text-left font-medium">發生日期</th>
                  <th className="hidden px-3 py-2 text-left font-medium md:table-cell">客戶編碼</th>
                  <th className="px-3 py-2 text-left font-medium">客戶名稱</th>
                  <th className="px-3 py-2 text-right font-medium">餘額</th>
                </tr>
              </thead>
              <tbody>
                {loadingItems ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">讀取中…</td></tr>
                  : items.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">沒有還沒收清的單</td></tr>
                  : items.slice(0, 300).map(item => (
                    <tr key={item.id} className={`border-t ${ticked[item.id] ? "bg-primary/5" : ""}`}>
                      <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4" checked={!!ticked[item.id]} onChange={e => tick(item, e.target.checked)} aria-label={`勾選 ${item.orderNumber}`} data-testid={`ar-tick-${item.id}`} /></td>
                      <td className="px-3 py-2">
                        <Link href={`/sales/orders/${item.id}`} className="font-mono text-primary hover:underline">{item.orderNumber}</Link>
                        {item.legacy && <span className="ml-1.5 inline-block rounded border px-1 align-middle text-[10px] text-muted-foreground" title="從舊系統 Ecount 帶過來的">歷史</span>}
                        {item.label && <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">{item.label}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{item.orderDate}<span className="block text-xs text-muted-foreground">{item.days} 天前</span></td>
                      <td className="hidden px-3 py-2 md:table-cell">{item.customerCode || "—"}</td>
                      <td className="px-3 py-2">{item.customerName}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(item.outstanding)}</td>
                    </tr>
                  ))}
              </tbody>
              {items.length > 0 && (
                <tfoot><tr className="border-t bg-muted/40 font-medium">
                  <td colSpan={5} className="px-3 py-2 text-right text-xs text-muted-foreground">{items.length} 張合計{items.length > 300 ? "（只列出前 300 張，請用上面的搜尋縮小範圍）" : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(items.reduce((sum, item) => sum + item.outstanding, 0))}</td>
                </tr></tfoot>
              )}
            </table>
          </div>
        </CardContent></Card>
      )}

      {mode === "customers" && <Card><CardContent className="p-0 overflow-x-auto">
        <DataTable
          isLoading={isLoading} data={rows.map((row): Row => ({ ...row, id: row.customerId }))} emptyMessage="沒有符合的客戶"
          onRowClick={(row: Row) => open(row)}
          columns={[
            { header: "客戶", accessor: (row: Row) => <div><span className="font-medium">{row.customerName}</span><span className="block text-xs text-muted-foreground">{[row.customerCode, row.contactPerson, row.phone].filter(Boolean).join("・") || "—"}</span></div> },
            { header: "還欠", accessor: (row: Row) => <div><span className="font-medium tabular-nums">{money(row.outstanding)}</span>{row.legacyOutstanding > 0 && <span className="block text-xs text-amber-700">舊系統 {money(row.legacyOutstanding)}・{row.legacyCount} 張・最早 {row.legacyOldestDate}</span>}</div>, className: "text-right" },
            { header: "逾期", accessor: (row: Row) => row.overdueAmount > 0
              ? <div className="text-red-600 dark:text-red-400 tabular-nums">{money(row.overdueAmount)}<span className="block text-xs">最久 {row.oldestOverdueDays} 天</span></div>
              : <span className="text-muted-foreground">—</span>, className: "text-right" },
            { header: "信用額度", accessor: (row: Row) => row.creditLimit == null
              ? <span className="text-muted-foreground">不限</span>
              : <div className="tabular-nums">{money(row.creditLimit)}<span className={`block text-xs ${row.overLimit ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>已用 {row.creditUsedPct}%</span></div>, className: "text-right hidden md:table-cell" },
            { header: "上次收款", accessor: (row: Row) => row.lastReceiptDate || "—", className: "hidden xl:table-cell" },
            { header: "狀況", accessor: (row: Row) => row.overLimit ? <Badge variant="destructive">超過額度</Badge> : row.overdueAmount > 0 ? <Badge variant="secondary">有逾期</Badge> : row.outstanding > 0 ? <Badge variant="outline">正常</Badge> : <Badge variant="outline">沒有欠款</Badge> },
          ]}
        />
      </CardContent></Card>}

      <DocWindow
        open={viewing !== null}
        onClose={() => setViewing(null)}
        name={viewing?.customerName ?? "客戶應收"} layoutKey="客戶應收"
        number={viewing?.customerCode}
        status={viewing ? (viewing.overLimit ? <DocStatus label="超過額度" tone="destructive" /> : viewing.overdueAmount > 0 ? <DocStatus label="有逾期" tone="secondary" /> : viewing.outstanding > 0 ? <DocStatus label="正常" tone="outline" /> : <DocStatus label="沒有欠款" tone="outline" />) : undefined}
        description={viewing ? [viewing.contactPerson, viewing.phone].filter(Boolean).join("・") || "應收帳款明細" : ""}
        footer={<>
          {viewing && <Button variant="outline" asChild className="mr-auto"><Link href={`/accounting/customer-statement/${viewing.customerId}`}>看對帳單</Link></Button>}
          {viewing && <Button variant="outline" onClick={() => setDocs({ kind: "open-invoices", type: "Sales", partyId: viewing.customerId, title: `${viewing.customerName} 未收發票` })} data-testid="button-open-invoices">看未收發票</Button>}
          <Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>
          <Button onClick={saveLimit} disabled={saving || (limit !== "" && !(Number(limit) >= 0))}>{saving ? "處理中…" : "儲存額度"}</Button>
        </>}
      >
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">還欠（合計）</p><p className="font-medium tabular-nums">{money(viewing.outstanding)}</p></div>
                <div><p className="text-xs text-muted-foreground">其中已逾期</p><p className="font-medium tabular-nums">{money(viewing.overdueAmount)}{viewing.overdueCount > 0 ? `（${viewing.overdueCount} 張）` : ""}</p></div>
                <div><p className="text-xs text-muted-foreground">已成立訂單還沒收的</p><p className="font-medium tabular-nums">{money(viewing.fromOrders)}</p></div>
                <div><p className="text-xs text-muted-foreground">直接開的發票還沒收的</p><p className="font-medium tabular-nums">{money(viewing.fromInvoices)}</p></div>
                <div><p className="text-xs text-muted-foreground">上次收款</p><p className="font-medium">{viewing.lastReceiptDate || "還沒有收款紀錄"}</p></div>
                <div><p className="text-xs text-muted-foreground">還可以再賒</p><p className="font-medium tabular-nums">{viewing.available == null ? "不限" : money(viewing.available)}</p></div>
              </div>
              <div className="rounded-md border">
                <p className="border-b px-3 py-2 font-medium">還沒收清的銷貨單{openOrders ? `（${openOrders.length} 張）` : ""}</p>
                {loadingOrders ? <p className="px-3 py-3 text-muted-foreground">讀取中…</p> : !openOrders || openOrders.length === 0 ? <p className="px-3 py-3 text-muted-foreground">沒有還沒收清的銷貨單{viewing.fromInvoices > 0 ? "（欠款來自直接開的發票，請看對帳單）" : ""}</p> : (
                  <>
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                    <label className="flex min-h-8 items-center gap-2">
                      <input type="checkbox" className="h-4 w-4" checked={pickedOrders.length === openOrders.length} onChange={e => setPicked(e.target.checked ? Object.fromEntries(openOrders.map(order => [order.id, String(order.outstanding)])) : {})} data-testid="settle-pick-all" />
                      全選
                    </label>
                    <span>勾選要收的單，下面按「建立收款單」</span>
                  </div>
                  <ul className="divide-y">
                    {openOrders.map(order => {
                      const on = picked[order.id] !== undefined;
                      return (
                      <li key={order.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${on ? "bg-primary/5" : ""}`}>
                        <input type="checkbox" className="h-4 w-4 shrink-0" checked={on} onChange={e => togglePick(order, e.target.checked)} aria-label={`收 ${order.orderNumber}`} data-testid={`settle-pick-${order.id}`} />
                        <div className="min-w-0 flex-1">
                          <Link href={`/sales/orders/${order.id}`} className="font-mono text-primary hover:underline">{order.orderNumber}</Link>
                          {order.legacy && <span className="ml-1.5 inline-block rounded border px-1 text-[10px] text-muted-foreground align-middle" title="從舊系統 Ecount 帶過來的">歷史</span>}
                          <span className="ml-2 text-xs text-muted-foreground">{order.orderDate}・{order.days} 天前</span>
                          {order.label && <div className="truncate text-xs text-muted-foreground">{order.label}</div>}
                        </div>
                        <div className="text-right tabular-nums">
                          <span className="font-medium">{money(order.outstanding)}</span>
                          {order.paidAmount > 0 && <span className="block text-xs text-muted-foreground">總額 {money(order.totalAmount)}・已收 {money(order.paidAmount)}</span>}
                        </div>
                        {on && (
                          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                            <span className="text-xs text-muted-foreground">這次沖</span>
                            <Input type="number" inputMode="decimal" min="0" max={order.outstanding} className="h-9 w-32 text-right" value={picked[order.id]} onChange={e => setPicked(prev => ({ ...prev, [order.id]: e.target.value }))} aria-label={`${order.orderNumber} 這次沖多少`} data-testid={`settle-amount-${order.id}`} />
                            <span className="text-xs text-muted-foreground">其中手續費</span>
                            <Input type="number" inputMode="decimal" min="0" className="h-9 w-24 text-right" value={fees[order.id] ?? ""} placeholder="0" onChange={e => setFees(prev => ({ ...prev, [order.id]: e.target.value }))} aria-label={`${order.orderNumber} 手續費`} data-testid={`settle-fee-${order.id}`} />
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                  {pickedOrders.length > 0 && (
                    <div className="space-y-3 border-t bg-muted/30 p-3" data-testid="settle-form">
                      <p className="font-medium">應收沖帳：{pickedOrders.length} 張，沖掉 {money(pickedTotal)}{feeTotal > 0 ? `，其中手續費 ${money(feeTotal)}，帳戶實收 ${money(pickedTotal - feeTotal)}` : ""}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5"><Label htmlFor="settle-date">收款日期</Label><Input id="settle-date" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label htmlFor="settle-account">收款帳戶</Label><CashAccountSelect id="settle-account" value={cashAccountId} onChange={setCashAccountId} /></div>
                      </div>
                      {feeTotal > 0 && (
                        <div className="space-y-1.5">
                          <Label htmlFor="settle-fee-account">手續費科目</Label>
                          <LedgerAccountSelect id="settle-fee-account" value={feeAccountValue} onChange={setFeeAccountId} types={["Expense"]} placeholder="請選擇費用科目" />
                          <p className="text-xs text-muted-foreground">例如客戶欠 100、銀行只進 70：「這次沖」填 100、「其中手續費」填 30。這張單會整張沖掉，帳戶進 70，手續費 30 記到這個科目。</p>
                        </div>
                      )}
                      <div className="space-y-1.5"><Label htmlFor="settle-memo">說明（可不填）</Label><Input id="settle-memo" value={memo} onChange={e => setMemo(e.target.value)} placeholder="例如：11 月匯款" /></div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">會開一張收款單並自動入帳，收款單上每一行都綁著對應的銷貨單；沒收完的金額會繼續留在這裡。</p>
                        <Button onClick={settle} disabled={settling} data-testid="button-settle">{settling ? "處理中…" : "建立收款單"}</Button>
                      </div>
                    </div>
                  )}
                  </>
                )}
                {viewing.legacyOutstanding > 0 && <p className="border-t px-3 py-2 text-xs text-amber-700">標「歷史」的是舊系統帶過來的欠款，共 {money(viewing.legacyOutstanding)}。收到錢時，在上面勾選那張銷貨單、按「建立收款單」就可以。</p>}
              </div>
              <div className="space-y-1.5 rounded-md border p-3">
                <Label htmlFor="ar-limit">信用額度</Label>
                <Input id="ar-limit" type="number" inputMode="decimal" min="0" value={limit} onChange={e => setLimit(e.target.value)} placeholder="空白或 0 是不限" data-testid="input-credit-limit" />
                <p className="text-xs text-muted-foreground">欠款加上新訂單超過這個數字，訂單就不能成立；老闆或財務可以個別放行。</p>
              </div>
            </div>
          )}
      </DocWindow>
      <DocListDrillDialog target={docs} onClose={() => setDocs(null)} />
    </div>
  );
}

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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { call, money, post, selectClass } from "@/lib/call";

interface Row {
  id?: number;
  customerId: number; customerName: string; customerCode: string | null; contactPerson: string | null; phone: string | null;
  outstanding: number; fromOrders: number; fromInvoices: number;
  overdueAmount: number; overdueCount: number; oldestOverdueDays: number;
  creditLimit: number | null; creditUsedPct: number | null; overLimit: boolean; available: number | null;
  lastReceiptDate: string | null;
  legacyOutstanding: number; legacyCount: number; legacyOldestDate: string | null;
}
interface OpenOrder { id: number; orderNumber: string; orderDate: string; label: string | null; legacy: boolean; totalAmount: number; paidAmount: number; outstanding: number; days: number }
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

  const { data, isLoading } = useQuery({ queryKey: ["/receivables/overview"], queryFn: () => call<Overview>("receivables/overview") });
  // 點開某個客戶時，把還沒收清的銷貨單一張一張列出來
  const { data: openOrders, isLoading: loadingOrders } = useQuery({
    queryKey: ["/receivables/open-orders", viewing?.customerId], enabled: viewing !== null,
    queryFn: () => call<OpenOrder[]>(`receivables/customers/${viewing!.customerId}/open-orders`),
  });
  const keyword = search.trim().toLowerCase();
  const rows = (data?.rows || []).filter(row =>
    (filter === "all" || (filter === "owing" && row.outstanding > 0) || (filter === "overdue" && row.overdueAmount > 0) || (filter === "over" && row.overLimit))
    && (!keyword || row.customerName.toLowerCase().includes(keyword) || (row.customerCode || "").toLowerCase().includes(keyword)));

  const open = (row: Row) => { setLimit(row.creditLimit ? String(row.creditLimit) : ""); setViewing(row); };
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
          <Button variant="outline" asChild><Link href="/reports/ar-aging">帳齡分析</Link></Button>
          <Button variant="outline" asChild><Link href="/accounting/dunning">催款</Link></Button>
          <Button asChild><Link href="/accounting/receipts">收款</Link></Button>
        </div>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
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
      </CardContent></Card>

      <Dialog open={viewing !== null} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="md:max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewing?.customerName}</DialogTitle>
            <DialogDescription>{viewing ? [viewing.customerCode, viewing.contactPerson, viewing.phone].filter(Boolean).join("・") || "應收帳款明細" : ""}</DialogDescription>
          </DialogHeader>
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
                  <ul className="divide-y">
                    {openOrders.map(order => (
                      <li key={order.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                        <div className="min-w-0">
                          <Link href={`/sales/orders/${order.id}`} className="font-mono text-primary hover:underline">{order.orderNumber}</Link>
                          {order.legacy && <span className="ml-1.5 inline-block rounded border px-1 text-[10px] text-muted-foreground align-middle" title="從舊系統 Ecount 帶過來的">歷史</span>}
                          <span className="ml-2 text-xs text-muted-foreground">{order.orderDate}・{order.days} 天前</span>
                          {order.label && <div className="truncate text-xs text-muted-foreground">{order.label}</div>}
                        </div>
                        <div className="text-right tabular-nums">
                          <span className="font-medium">{money(order.outstanding)}</span>
                          {order.paidAmount > 0 && <span className="block text-xs text-muted-foreground">總額 {money(order.totalAmount)}・已收 {money(order.paidAmount)}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {viewing.legacyOutstanding > 0 && <p className="border-t px-3 py-2 text-xs text-amber-700">標「歷史」的是舊系統帶過來的欠款，共 {money(viewing.legacyOutstanding)}。收到錢時，到收款單選這張銷貨單沖帳就可以。</p>}
              </div>
              <div className="space-y-1.5 rounded-md border p-3">
                <Label htmlFor="ar-limit">信用額度</Label>
                <Input id="ar-limit" type="number" inputMode="decimal" min="0" value={limit} onChange={e => setLimit(e.target.value)} placeholder="空白或 0 是不限" data-testid="input-credit-limit" />
                <p className="text-xs text-muted-foreground">欠款加上新訂單超過這個數字，訂單就不能成立；老闆或財務可以個別放行。</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {viewing && <Button variant="outline" asChild className="md:mr-auto"><Link href={`/accounting/customer-statement/${viewing.customerId}`}>看對帳單</Link></Button>}
            <Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>
            <Button onClick={saveLimit} disabled={saving || (limit !== "" && !(Number(limit) >= 0))}>{saving ? "處理中…" : "儲存額度"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

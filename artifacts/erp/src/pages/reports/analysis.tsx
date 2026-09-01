import { useState } from 'react';
import { useGetErpPurchaseAnalysis, useGetErpSalesAnalysis } from '@workspace/api-client-react';
import { BarChart3, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';
const money = (value: number) => value.toLocaleString('zh-TW');
const dateString = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
const now = new Date();
type Dimension = 'party' | 'month' | 'product';
interface PartyRow { id: number; name: string; orderCount: number; totalAmount: number }
interface MonthRow { month: string; orderCount: number; totalAmount: number }
interface ProductRow { itemName: string; quantity: number; totalAmount: number }
interface AnalysisReport {
  dimension: 'customer' | 'supplier' | 'month' | 'product'; startDate: string | null; endDate: string | null;
  rows: Array<PartyRow | MonthRow | ProductRow>; totalOrders: number; totalAmount: number;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function AnalysisTable({ report, loading, error, partyLabel }: { report?: AnalysisReport; loading: boolean; error: unknown; partyLabel: string }) {
  if (loading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (error) return <div className="p-8 text-center text-destructive">載入失敗：{errorMessage(error)}</div>;
  if (!report?.rows.length) return <div className="p-12 text-center text-muted-foreground">此期間沒有資料</div>;
  const max = Math.max(...report.rows.map((r) => r.totalAmount), 1);
  const firstLabel = report.dimension === 'month' ? '月份' : report.dimension === 'product' ? '商品' : partyLabel;
  const secondLabel = report.dimension === 'product' ? '數量' : '單據數';
  return <Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>{firstLabel}</TableHead><TableHead className="text-right">{secondLabel}</TableHead><TableHead>金額占比</TableHead><TableHead className="text-right">金額（元）</TableHead></TableRow></TableHeader><TableBody>{report.rows.map((row, index) => {
    const label = 'month' in row ? row.month : 'itemName' in row ? row.itemName : row.name;
    const count = 'quantity' in row ? row.quantity : row.orderCount;
    return <TableRow key={`${label}-${index}`}><TableCell className="font-medium">{label}</TableCell><TableCell className="text-right tabular-nums">{money(count)}</TableCell><TableCell className="min-w-48"><div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((row.totalAmount / max) * 100, 1)}%` }} /></div></TableCell><TableCell className="text-right font-medium tabular-nums">{money(row.totalAmount)}</TableCell></TableRow>;
  })}<TableRow className="bg-primary/10 font-bold"><TableCell>合計</TableCell><TableCell className="text-right">{money(report.totalOrders)} 筆</TableCell><TableCell /><TableCell className="text-right">{money(report.totalAmount)}</TableCell></TableRow></TableBody></Table>;
}

export default function AnalysisReportsPage() {
  const [tab, setTab] = useState('sales');
  const [startDate, setStartDate] = useState(dateString(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [endDate, setEndDate] = useState(dateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [groupBy, setGroupBy] = useState<Dimension>('party');
  const salesDimension = groupBy === 'party' ? 'customer' : groupBy;
  const purchaseDimension = groupBy === 'party' ? 'supplier' : groupBy;
  const salesQuery = useGetErpSalesAnalysis({ startDate, endDate, groupBy: salesDimension });
  const purchaseQuery = useGetErpPurchaseAnalysis({ startDate, endDate, groupBy: purchaseDimension });
  const sales = salesQuery.data as unknown as AnalysisReport | undefined;
  const purchase = purchaseQuery.data as unknown as AnalysisReport | undefined;
  const current = tab === 'sales' ? sales : purchase;
  const exportCsv = () => {
    if (!current) return;
    const firstLabel = current.dimension === 'month' ? '月份' : current.dimension === 'product' ? '商品' : tab === 'sales' ? '客戶' : '供應商';
    const secondLabel = current.dimension === 'product' ? '數量' : '單據數';
    downloadCsv(`${tab === 'sales' ? '銷售' : '採購'}分析_${startDate}_${endDate}.csv`, [[firstLabel, secondLabel, '金額'], ...current.rows.map((row) => [
      'month' in row ? row.month : 'itemName' in row ? row.itemName : row.name,
      'quantity' in row ? row.quantity : row.orderCount, row.totalAmount,
    ]), ['合計', current.totalOrders, current.totalAmount]]);
  };
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><h2 className="flex items-center gap-2 text-xl font-bold"><BarChart3 className="h-5 w-5 text-primary" />銷售／採購分析</h2><p className="mt-1 text-sm text-muted-foreground">依不同維度比較交易量與金額</p></div><div className="flex flex-wrap items-end gap-3"><div className="space-y-1"><Label>起始日期</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div><div className="space-y-1"><Label>結束日期</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div><div className="w-40 space-y-1"><Label>分析維度</Label><Select value={groupBy} onValueChange={(value) => setGroupBy(value as Dimension)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="party">{tab === 'sales' ? '依客戶' : '依供應商'}</SelectItem><SelectItem value="month">依月份</SelectItem><SelectItem value="product">依商品</SelectItem></SelectContent></Select></div><Button variant="outline" onClick={exportCsv} disabled={!current}><Download className="mr-2 h-4 w-4" />匯出 CSV</Button></div></div>
    <div className="grid gap-4 sm:grid-cols-2"><Card className="p-4"><div className="text-sm text-muted-foreground">單據總數</div><div className="mt-1 text-2xl font-bold">{money(current?.totalOrders || 0)} 筆</div></Card><Card className="p-4"><div className="text-sm text-muted-foreground">交易總額</div><div className="mt-1 text-2xl font-bold">NT$ {money(current?.totalAmount || 0)}</div></Card></div>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="grid w-full grid-cols-2 sm:w-72"><TabsTrigger value="sales">銷售分析</TabsTrigger><TabsTrigger value="purchase">採購分析</TabsTrigger></TabsList><TabsContent value="sales"><Card className="overflow-x-auto border-t-2 border-t-primary"><AnalysisTable report={sales} loading={salesQuery.isLoading} error={salesQuery.error} partyLabel="客戶" /></Card></TabsContent><TabsContent value="purchase"><Card className="overflow-x-auto border-t-2 border-t-primary"><AnalysisTable report={purchase} loading={purchaseQuery.isLoading} error={purchaseQuery.error} partyLabel="供應商" /></Card></TabsContent></Tabs>
  </div>;
}
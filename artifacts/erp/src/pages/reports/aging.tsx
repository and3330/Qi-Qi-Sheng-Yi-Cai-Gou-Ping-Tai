import { useState } from 'react';
import { useGetErpApAging, useGetErpArAging } from '@workspace/api-client-react';
import { Clock3, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';
const money = (value: number) => value.toLocaleString('zh-TW');
interface AgingRow { partyId: number; partyName: string; current: number; d30: number; d60: number; d90: number; d120: number; total: number }
interface AgingReport { asOfDate: string; rows: AgingRow[]; summary: Omit<AgingRow, 'partyId' | 'partyName'> }
const columns: Array<[keyof AgingReport['summary'], string]> = [['current', '未逾期'], ['d30', '1–30 天'], ['d60', '31–60 天'], ['d90', '61–90 天'], ['d120', '90 天以上'], ['total', '總計']];

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function AgingTable({ report, loading, error, partyLabel }: { report?: AgingReport; loading: boolean; error: unknown; partyLabel: string }) {
  if (loading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (error) return <div className="p-8 text-center text-destructive">載入失敗：{errorMessage(error)}</div>;
  if (!report?.rows.length) return <div className="p-12 text-center text-muted-foreground">目前沒有未結清帳款</div>;
  return <Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>{partyLabel}</TableHead>{columns.map(([, label]) => <TableHead key={label} className="text-right">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{report.rows.map((row) => <TableRow key={row.partyId}><TableCell className="font-medium">{row.partyName}</TableCell>{columns.map(([key]) => <TableCell key={key} className={`text-right tabular-nums ${key === 'total' ? 'font-bold' : ''}`}>{money(row[key])}</TableCell>)}</TableRow>)}<TableRow className="bg-primary/10 font-bold"><TableCell>全部對象總計</TableCell>{columns.map(([key]) => <TableCell key={key} className="text-right tabular-nums">{money(report.summary[key])}</TableCell>)}</TableRow></TableBody></Table>;
}

export default function AgingReportsPage() {
  const [tab, setTab] = useState('ar');
  const arQuery = useGetErpArAging();
  const apQuery = useGetErpApAging();
  const ar = arQuery.data as unknown as AgingReport | undefined;
  const ap = apQuery.data as unknown as AgingReport | undefined;
  const current = tab === 'ar' ? ar : ap;
  const exportCsv = () => {
    if (!current) return;
    downloadCsv(`${tab === 'ar' ? '應收' : '應付'}帳齡_${current.asOfDate}.csv`, [
      [tab === 'ar' ? '客戶' : '供應商', ...columns.map(([, label]) => label)],
      ...current.rows.map((row) => [row.partyName, ...columns.map(([key]) => row[key])]),
      ['全部對象總計', ...columns.map(([key]) => current.summary[key])],
    ]);
  };
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-xl font-bold"><Clock3 className="h-5 w-5 text-primary" />帳齡分析</h2><p className="mt-1 text-sm text-muted-foreground">掌握應收與應付帳款逾期分布</p></div><div className="flex items-center gap-3">{current?.asOfDate && <Badge variant="secondary">基準日：{current.asOfDate}</Badge>}<Button variant="outline" onClick={exportCsv} disabled={!current}><Download className="mr-2 h-4 w-4" />匯出 CSV</Button></div></div>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="grid w-full grid-cols-2 sm:w-72"><TabsTrigger value="ar">應收帳齡</TabsTrigger><TabsTrigger value="ap">應付帳齡</TabsTrigger></TabsList><TabsContent value="ar"><Card className="overflow-x-auto border-t-2 border-t-primary"><AgingTable report={ar} loading={arQuery.isLoading} error={arQuery.error} partyLabel="客戶" /></Card></TabsContent><TabsContent value="ap"><Card className="overflow-x-auto border-t-2 border-t-primary"><AgingTable report={ap} loading={apQuery.isLoading} error={apQuery.error} partyLabel="供應商" /></Card></TabsContent></Tabs>
  </div>;
}
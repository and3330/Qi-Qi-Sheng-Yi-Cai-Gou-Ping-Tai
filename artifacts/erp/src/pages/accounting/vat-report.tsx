import { useState } from 'react';
import { useGetErpVatReport } from '@workspace/api-client-react';
import { AlertTriangle, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const defaultPeriod = () => {
  const now = new Date();
  const startMonth = Math.floor(now.getMonth() / 2) * 2;
  return {
    startDate: dateValue(new Date(now.getFullYear(), startMonth, 1)),
    endDate: dateValue(new Date(now.getFullYear(), startMonth + 2, 0)),
  };
};
const money = (value?: number | null) => (value ?? 0).toLocaleString('zh-TW');

export default function VatReportPage() {
  const initial = defaultPeriod();
  const [dates, setDates] = useState(initial);
  const [period, setPeriod] = useState(initial);
  const { data: report, isLoading, isFetching, error } = useGetErpVatReport(period);

  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ['營業稅 401 申報彙總', `${report.startDate} 至 ${report.endDate}`],
      ['類別', '項目', '金額（新台幣元）'],
      ['銷項', '應稅銷售淨額', report.outputNet],
      ['銷項', '銷項稅額', report.outputTax],
      ['銷項', '零稅率銷售額', report.zeroRatedSales ?? 0],
      ['銷項', '免稅銷售額', report.exemptSales ?? 0],
      ['進項', '進貨及費用淨額', report.inputNet],
      ['進項', '可扣抵進項稅額', report.inputTax],
      ['稅額計算', report.payableTax >= 0 ? '應納稅額' : '應退稅額', Math.abs(report.payableTax)],
      ['資料檢核', '未分類稅別發票筆數', report.unclassifiedCount ?? 0],
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `營業稅申報_${report.startDate}_${report.endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="flex items-center gap-2 text-xl font-bold"><FileSpreadsheet className="h-5 w-5 text-primary" />營業稅申報</h2>
      <Button variant="outline" disabled={!report || isFetching} onClick={exportCsv}><Download className="mr-2 h-4 w-4" />匯出 CSV</Button>
    </div>
    <Card className="border-t-2 border-t-primary p-4 shadow-sm">
      <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setPeriod(dates); }}>
        <div className="space-y-2"><Label>申報起始日</Label><Input type="date" value={dates.startDate} onChange={(event) => setDates((current) => ({ ...current, startDate: event.target.value }))} /></div>
        <div className="space-y-2"><Label>申報結束日</Label><Input type="date" value={dates.endDate} onChange={(event) => setDates((current) => ({ ...current, endDate: event.target.value }))} /></div>
        <Button disabled={!dates.startDate || !dates.endDate || dates.startDate > dates.endDate || isFetching}>{isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}產生報表</Button>
        <span className="pb-2 text-xs text-muted-foreground">預設期間為目前雙月申報期</span>
      </form>
    </Card>
    {isLoading ? <Card className="p-20"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" /></Card> : error ? <Card className="border-destructive p-10 text-center text-destructive">報表載入失敗，請稍後再試</Card> : report && <>
      {(report.unclassifiedCount ?? 0) > 0 && <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">發票稅別尚未分類</div><div className="text-sm">本期共有 {report.unclassifiedCount} 筆發票未分類稅別，未納入本報表計算，請先完成分類後再申報。</div></div>
      </div>}
      <Card className="overflow-hidden border-2 border-slate-700 shadow-sm">
        <div className="border-b-2 border-slate-700 bg-slate-50 p-5 text-center">
          <div className="text-2xl font-bold tracking-[0.2em]">營業人銷售額與稅額申報書</div>
          <div className="mt-1 text-sm font-medium">（401 彙總預覽）</div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm"><Badge variant="outline">申報期間</Badge><span className="font-mono">{report.startDate} ～ {report.endDate}</span></div>
        </div>
        <Table>
          <TableHeader><TableRow className="border-b-2 border-slate-700 bg-secondary/60"><TableHead className="w-24 border-r font-bold">區分</TableHead><TableHead className="border-r font-bold">申報項目</TableHead><TableHead className="w-56 text-right font-bold">金額（新台幣元）</TableHead></TableRow></TableHeader>
          <TableBody>
            <ReportRow section="銷項" label="應稅銷售淨額" value={report.outputNet} first />
            <ReportRow label="銷項稅額" value={report.outputTax} />
            <ReportRow label="零稅率銷售額" value={report.zeroRatedSales ?? 0} />
            <ReportRow label="免稅銷售額" value={report.exemptSales ?? 0} last />
            <ReportRow section="進項" label="進貨及費用淨額" value={report.inputNet} first />
            <ReportRow label="可扣抵進項稅額" value={report.inputTax} last />
          </TableBody>
        </Table>
        <div className="grid border-t-2 border-slate-700 bg-slate-50 sm:grid-cols-[1fr_320px]">
          <div className="flex items-center p-5"><div><div className="font-bold">本期應納（退）稅額</div><div className="mt-1 text-xs text-muted-foreground">銷項稅額 − 可扣抵進項稅額</div></div></div>
          <div className={`border-t-2 border-slate-700 p-5 text-right sm:border-l-2 sm:border-t-0 ${report.payableTax < 0 ? 'text-emerald-700' : 'text-primary'}`}>
            <div className="text-sm font-semibold">{report.payableTax < 0 ? '應退稅額' : '應納稅額'}</div>
            <div className="mt-1 font-mono text-3xl font-bold">NT$ {money(Math.abs(report.payableTax))}</div>
          </div>
        </div>
      </Card>
      <p className="text-center text-xs text-muted-foreground">本頁為申報資料彙總，正式申報前請依財政部規定核對憑證及稅額。</p>
    </>}
  </div>;
}

function ReportRow({ section, label, value, first, last }: { section?: string; label: string; value: number; first?: boolean; last?: boolean }) {
  return <TableRow className={last ? 'border-b-2 border-slate-700' : ''}>
    <TableCell className="border-r text-center font-bold">{first ? section : ''}</TableCell>
    <TableCell className="border-r">{label}</TableCell>
    <TableCell className="text-right font-mono text-base font-medium">{money(value)}</TableCell>
  </TableRow>;
}
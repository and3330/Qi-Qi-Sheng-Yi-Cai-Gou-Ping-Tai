import { useState } from 'react';
import {
  useGetErpBalanceSheet,
  useGetErpCashFlow,
  useGetErpIncomeStatement,
  useGetErpTrialBalance,
} from '@workspace/api-client-react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';
const money = (value: number) => value.toLocaleString('zh-TW');
const dateString = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
const now = new Date();
const initialStart = dateString(new Date(now.getFullYear(), now.getMonth(), 1));
const initialEnd = dateString(new Date(now.getFullYear(), now.getMonth() + 1, 0));

interface ReportItem { accountId?: number; accountNumber: string; accountName: string; amount: number }
interface ReportGroup { groupName: string; groupNumber: string; items: ReportItem[]; subtotal: number }
interface IncomeReport {
  income: ReportGroup[]; expense: ReportGroup[]; totalIncome: number; totalExpense: number; netProfit: number;
}
interface BalanceSection { groups: ReportGroup[]; total: number }
interface BalanceReport {
  assets: BalanceSection;
  liabilities: BalanceSection;
  equity: BalanceSection & { retainedEarnings: number; totalWithRetainedEarnings: number };
  totalAssets: number; totalLiabilitiesAndEquity: number; isBalanced: boolean;
}
interface CashReport {
  operating: ReportItem[]; investing: ReportItem[]; financing: ReportItem[];
  totalOperating: number; totalInvesting: number; totalFinancing: number;
  netCashChange: number; openingCash: number; closingCash: number;
}
interface TrialRow {
  accountNumber: string; accountName: string; debit: number; credit: number; debitBalance: number; creditBalance: number;
}
interface TrialReport {
  rows: TrialRow[]; totalDebit: number; totalCredit: number;
  totalDebitBalance: number; totalCreditBalance: number; isBalanced: boolean;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function LoadingOrError({ loading, error }: { loading: boolean; error: unknown }) {
  if (loading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (error) return <div className="p-8 text-center text-destructive">載入失敗：{errorMessage(error)}</div>;
  return null;
}

function GroupRows({ title, groups, totalLabel, total }: { title: string; groups: ReportGroup[]; totalLabel: string; total: number }) {
  return <>
    <TableRow className="bg-muted/70 font-bold"><TableCell colSpan={2}>{title}</TableCell><TableCell /></TableRow>
    {groups.map((group) => [
      <TableRow key={`${group.groupNumber}-heading`} className="font-medium"><TableCell colSpan={3}>{group.groupNumber} {group.groupName}</TableCell></TableRow>,
      ...group.items.map((item) => <TableRow key={`${group.groupNumber}-${item.accountNumber}`}><TableCell className="pl-8 font-mono text-xs">{item.accountNumber}</TableCell><TableCell>{item.accountName}</TableCell><TableCell className="text-right tabular-nums">{money(item.amount)}</TableCell></TableRow>),
      <TableRow key={`${group.groupNumber}-subtotal`} className="font-bold"><TableCell /><TableCell>{group.groupName}小計</TableCell><TableCell className="text-right tabular-nums">{money(group.subtotal)}</TableCell></TableRow>,
    ])}
    <TableRow className="bg-primary/5 font-bold"><TableCell colSpan={2}>{totalLabel}</TableCell><TableCell className="text-right tabular-nums">{money(total)}</TableCell></TableRow>
  </>;
}

export default function FinancialReportsPage() {
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [tab, setTab] = useState('income');
  const incomeQuery = useGetErpIncomeStatement({ startDate, endDate });
  const balanceQuery = useGetErpBalanceSheet({ endDate });
  const cashQuery = useGetErpCashFlow({ startDate, endDate });
  const trialQuery = useGetErpTrialBalance({ startDate, endDate });
  const income = incomeQuery.data as unknown as IncomeReport | undefined;
  const balance = balanceQuery.data as unknown as BalanceReport | undefined;
  const cash = cashQuery.data as unknown as CashReport | undefined;
  const trial = trialQuery.data as unknown as TrialReport | undefined;

  const exportCurrent = () => {
    let rows: Array<Array<string | number>> = [];
    let name = tab;
    if (tab === 'income' && income) {
      rows = [['類別', '科目編號', '科目名稱', '金額']];
      income.income.forEach((g) => { g.items.forEach((i) => rows.push(['收入', i.accountNumber, i.accountName, i.amount])); rows.push(['收入小計', g.groupNumber, g.groupName, g.subtotal]); });
      income.expense.forEach((g) => { g.items.forEach((i) => rows.push(['費用', i.accountNumber, i.accountName, i.amount])); rows.push(['費用小計', g.groupNumber, g.groupName, g.subtotal]); });
      rows.push(['合計', '', '本期損益', income.netProfit]); name = '損益表';
    } else if (tab === 'balance' && balance) {
      rows = [['類別', '科目編號', '科目名稱', '金額']];
      ([['資產', balance.assets], ['負債', balance.liabilities], ['權益', balance.equity]] as const).forEach(([label, section]) => section.groups.forEach((g) => g.items.forEach((i) => rows.push([label, i.accountNumber, i.accountName, i.amount]))));
      rows.push(['合計', '', '資產總計', balance.totalAssets], ['合計', '', '負債及權益總計', balance.totalLiabilitiesAndEquity]); name = '資產負債表';
    } else if (tab === 'cash' && cash) {
      rows = [['活動', '科目編號', '科目名稱', '金額']];
      ([['營業活動', cash.operating], ['投資活動', cash.investing], ['籌資活動', cash.financing]] as const).forEach(([label, items]) => items.forEach((i) => rows.push([label, i.accountNumber, i.accountName, i.amount])));
      rows.push(['合計', '', '期初現金', cash.openingCash], ['合計', '', '本期現金增減', cash.netCashChange], ['合計', '', '期末現金', cash.closingCash]); name = '現金流量表';
    } else if (tab === 'trial' && trial) {
      rows = [['科目編號', '科目名稱', '借方發生額', '貸方發生額', '借方餘額', '貸方餘額'], ...trial.rows.map((r) => [r.accountNumber, r.accountName, r.debit, r.credit, r.debitBalance, r.creditBalance]), ['合計', '', trial.totalDebit, trial.totalCredit, trial.totalDebitBalance, trial.totalCreditBalance]]; name = '試算表';
    }
    if (rows.length) downloadCsv(`${name}_${startDate}_${endDate}.csv`, rows);
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h2 className="flex items-center gap-2 text-xl font-bold"><FileSpreadsheet className="h-5 w-5 text-primary" />財務報表中心</h2><p className="mt-1 text-sm text-muted-foreground">檢視企業財務狀況與會計科目餘額</p></div>
      <div className="flex flex-wrap items-end gap-3"><div className="space-y-1"><Label>起始日期</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div><div className="space-y-1"><Label>結束日期</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div><Button variant="outline" onClick={exportCurrent}><Download className="mr-2 h-4 w-4" />匯出 CSV</Button></div>
    </div>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="grid w-full grid-cols-4 lg:w-[560px]"><TabsTrigger value="income">損益表</TabsTrigger><TabsTrigger value="balance">資產負債表</TabsTrigger><TabsTrigger value="cash">現金流量表</TabsTrigger><TabsTrigger value="trial">試算表</TabsTrigger></TabsList>
      <TabsContent value="income"><Card className="overflow-x-auto border-t-2 border-t-primary"><LoadingOrError loading={incomeQuery.isLoading} error={incomeQuery.error} />{income && <Table><TableHeader><TableRow><TableHead>科目編號</TableHead><TableHead>科目名稱</TableHead><TableHead className="text-right">金額（元）</TableHead></TableRow></TableHeader><TableBody><GroupRows title="收入" groups={income.income} totalLabel="收入總計" total={income.totalIncome} /><GroupRows title="費用" groups={income.expense} totalLabel="費用總計" total={income.totalExpense} /><TableRow className="bg-primary/10 text-base font-bold"><TableCell colSpan={2}>本期損益</TableCell><TableCell className="text-right">{money(income.netProfit)}</TableCell></TableRow></TableBody></Table>}</Card></TabsContent>
      <TabsContent value="balance"><Card className="overflow-x-auto border-t-2 border-t-primary"><LoadingOrError loading={balanceQuery.isLoading} error={balanceQuery.error} />{balance && <Table><TableHeader><TableRow><TableHead>科目編號</TableHead><TableHead>科目名稱</TableHead><TableHead className="text-right">金額（元）</TableHead></TableRow></TableHeader><TableBody><GroupRows title="資產" groups={balance.assets.groups} totalLabel="資產總計" total={balance.totalAssets} /><GroupRows title="負債" groups={balance.liabilities.groups} totalLabel="負債總計" total={balance.liabilities.total} /><GroupRows title="權益" groups={balance.equity.groups} totalLabel="權益小計" total={balance.equity.total} /><TableRow className="font-bold"><TableCell colSpan={2}>保留盈餘（含本期損益）</TableCell><TableCell className="text-right">{money(balance.equity.retainedEarnings)}</TableCell></TableRow><TableRow className="bg-primary/10 text-base font-bold"><TableCell colSpan={2}>負債及權益總計</TableCell><TableCell className="text-right">{money(balance.totalLiabilitiesAndEquity)}</TableCell></TableRow></TableBody></Table>}</Card></TabsContent>
      <TabsContent value="cash"><Card className="overflow-x-auto border-t-2 border-t-primary"><LoadingOrError loading={cashQuery.isLoading} error={cashQuery.error} />{cash && <Table><TableHeader><TableRow><TableHead>科目編號</TableHead><TableHead>項目</TableHead><TableHead className="text-right">金額（元）</TableHead></TableRow></TableHeader><TableBody>{([['營業活動', cash.operating, cash.totalOperating], ['投資活動', cash.investing, cash.totalInvesting], ['籌資活動', cash.financing, cash.totalFinancing]] as const).map(([label, items, total]) => <GroupRows key={label} title={label} groups={[{ groupName: label, groupNumber: '', items: [...items], subtotal: total }]} totalLabel={`${label}現金流量淨額`} total={total} />)}{[['期初現金', cash.openingCash], ['本期現金增減', cash.netCashChange], ['期末現金', cash.closingCash]].map(([label, value]) => <TableRow key={String(label)} className="bg-primary/5 font-bold"><TableCell colSpan={2}>{label}</TableCell><TableCell className="text-right">{money(Number(value))}</TableCell></TableRow>)}</TableBody></Table>}</Card></TabsContent>
      <TabsContent value="trial"><Card className="overflow-x-auto border-t-2 border-t-primary"><LoadingOrError loading={trialQuery.isLoading} error={trialQuery.error} />{trial && <Table><TableHeader><TableRow><TableHead>科目編號</TableHead><TableHead>科目名稱</TableHead>{['借方發生額', '貸方發生額', '借方餘額', '貸方餘額'].map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}</TableRow></TableHeader><TableBody>{trial.rows.map((r) => <TableRow key={r.accountNumber}><TableCell className="font-mono text-xs">{r.accountNumber}</TableCell><TableCell>{r.accountName}</TableCell>{[r.debit, r.credit, r.debitBalance, r.creditBalance].map((v, i) => <TableCell key={i} className="text-right tabular-nums">{money(v)}</TableCell>)}</TableRow>)}<TableRow className="bg-primary/10 font-bold"><TableCell colSpan={2}>合計</TableCell>{[trial.totalDebit, trial.totalCredit, trial.totalDebitBalance, trial.totalCreditBalance].map((v, i) => <TableCell key={i} className="text-right">{money(v)}</TableCell>)}</TableRow></TableBody></Table>}</Card></TabsContent>
    </Tabs>
  </div>;
}
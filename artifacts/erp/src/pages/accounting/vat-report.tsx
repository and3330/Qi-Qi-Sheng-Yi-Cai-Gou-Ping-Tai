import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { JournalEntryDialog } from "@/components/accounting/journal-entry-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BASE_URL = import.meta.env.BASE_URL;
const api = (path: string) => `/erp-api/${path}`;
const money = (value: number) => `NT$ ${Number(value || 0).toLocaleString()}`;

function initialPeriod() {
  const now = new Date();
  const firstMonth = Math.floor(now.getMonth() / 2) * 2;
  const year = now.getFullYear();
  const end = new Date(year, firstMonth + 2, 0);
  return {
    startDate: `${year}-${String(firstMonth + 1).padStart(2, "0")}-01`,
    endDate: `${year}-${String(firstMonth + 2).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
  };
}

export default function VatReportPage() {
  const [, navigate] = useLocation();
  const [entryId, setEntryId] = useState<number | null>(null);
  // 點一列就開原單：發票和折讓開發票、代墊開代墊款、進貨運費開那張分錄
  const openRow = (row: any) => {
    if (row.kind === "advance") navigate(`/accounting/advances?open=${row.id - 1_000_000_000}`);
    else if (row.kind === "landed_cost") setEntryId(row.id - 2_000_000_000);
    else navigate(`/accounting/invoices?open=${row.id}`);
  };
  const initial = useMemo(initialPeriod, []);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/erp-api/vat-report", startDate, endDate],
    queryFn: async () => {
      const response = await fetch(api(`vat-report?startDate=${startDate}&endDate=${endDate}`));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "載入營業稅報表失敗");
      return body;
    },
  });
  const ensureAccounts = useMutation({
    mutationFn: async () => {
      const response = await fetch(api("vat-report/ensure-accounts"), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "營業稅科目建立失敗");
      return body;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/erp-api/vat-report", startDate, endDate] }),
  });

  const choosePeriod = (month: number) => {
    const year = Number(startDate.slice(0, 4)) || new Date().getFullYear();
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month + 1, 0);
    setStartDate(`${year}-${String(month).padStart(2, "0")}-01`);
    setEndDate(`${year}-${String(month + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`);
  };
  const columns = [
    { header: "發票號碼", accessor: (row: any) => row.displayInvoiceNumber },
    { header: "日期", accessor: "invoiceDate" },
    { header: "對象", accessor: (row: any) => row.partyName },
    { header: "未稅金額", accessor: (row: any) => money(row.netAmount), className: "text-right" },
    { header: "稅額", accessor: (row: any) => money(row.taxAmount), className: "text-right" },
  ];

  return <div className="space-y-6">
    <PageHeader title="營業稅申報" description="銷項與進項稅額彙總" hint={<PageHint hintKey="vat-report">這裡彙總指定期間的銷項與進項發票，協助估算應繳營業稅。先選申報期間，再核對異常或缺漏發票，最後交由會計確認。小提醒：此頁是依系統資料試算，不能取代正式申報前的憑證查核。</PageHint>} />
    <Card><CardContent className="pt-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label>起始日期</Label><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
        <div><Label>結束日期</Label><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
        {[1, 3, 5, 7, 9, 11].map(month =>
          <Button key={month} variant="outline" onClick={() => choosePeriod(month)}>{month}-{month + 1}月</Button>
        )}
      </div>
    </CardContent></Card>
    {data?.unclassifiedCount > 0 && <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <AlertTriangle className="h-5 w-5" />提示有 {data.unclassifiedCount} 張發票尚未分類稅別
    </div>}
    {data?.taxAccounts && !data.taxAccounts.ready && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="font-medium">總帳缺少營業稅專用科目</div>
          <div className="text-sm">
            {data.taxAccounts.statuses.filter((status: any) => status.issue).map((status: any) => status.issue).join("；")}。
            請先建立標準科目，或至科目表選擇正確的資產／負債明細科目。
          </div>
        </div>
      </div>
      <Button variant="outline" onClick={() => ensureAccounts.mutate()} disabled={ensureAccounts.isPending}>
        {ensureAccounts.isPending ? "建立中…" : "建立預設科目"}
      </Button>
      <Button variant="outline" asChild><a href={`${BASE_URL}accounting/accounts`}>前往會計科目</a></Button>
    </div>}
    {ensureAccounts.error && <div className="rounded-md bg-destructive/10 p-4 text-destructive">{(ensureAccounts.error as Error).message}</div>}
    {error && <div className="rounded-md bg-destructive/10 p-4 text-destructive">{(error as Error).message}</div>}
    <div className="grid gap-4 md:grid-cols-3">
      {[["銷項稅額", data?.outputTax], ["進項稅額", data?.inputTax], ["應繳(退)稅額", data?.payableTax]].map(([title, value]) =>
        <Card key={String(title)}><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{money(Number(value))}</CardContent></Card>
      )}
    </div>
    {data?.taxReconciliation && <Card>
      <CardHeader><CardTitle>總帳核對</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">總帳金額取指定期間已過帳的「銷項稅額／進項稅額」科目借貸淨額；差異為發票稅額減總帳金額。折讓單會從當期扣掉；代墊款與直接付掉的運費如果有稅額，也算進進項。</p>
        {[
          ["銷項稅額", data.taxReconciliation.output],
          ["進項稅額", data.taxReconciliation.input],
        ].map(([label, item]: [string, any]) => (
          <div key={label} className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm md:grid-cols-4">
            <span className="font-medium">{label}</span>
            <span>發票：{money(item.invoiceTax)}</span>
            <span>總帳：{money(item.ledgerTax)}</span>
            <span className={Math.abs(item.difference) > 0.01 ? "font-medium text-amber-700" : "text-green-700"}>
              差異：{money(item.difference)}
            </span>
          </div>
        ))}
        <div className={data.taxReconciliation.isReconciled ? "text-sm text-green-700" : "text-sm text-amber-700"}>
          {data.taxReconciliation.isReconciled ? "發票稅額與總帳已核對相符" : "發票稅額與總帳尚有差異，請確認發票自動分錄是否已完成過帳。"}
        </div>
      </CardContent>
    </Card>}
    <Card><CardHeader><CardTitle>銷項發票與折讓（未稅銷售額 {money(data?.salesTotal)}）</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto"><DataTable data={data?.outputInvoices || []} columns={columns} isLoading={isLoading} onRowClick={openRow} /></CardContent></Card>
    <Card><CardHeader><CardTitle>進項發票、折讓與代墊（未稅進貨額 {money(data?.purchasesTotal)}）</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto"><DataTable data={data?.inputInvoices || []} columns={columns} isLoading={isLoading} onRowClick={openRow} /></CardContent></Card>
    <JournalEntryDialog entryId={entryId} onClose={() => setEntryId(null)} />
  </div>;
}
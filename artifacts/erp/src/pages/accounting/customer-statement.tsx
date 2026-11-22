import { useState, useMemo, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useListCustomers } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, ArrowLeft } from "lucide-react";
import { SearchableSelect } from "@/components/shared/searchable-select";

interface SettlementApplied {
  id: number; voucherId: number; voucherNumber: string | null; voucherDate: string | null; amount: number;
}
interface StatementInvoice {
  id: number; invoiceNumber: string; invoiceDate: string; dueDate: string | null;
  status: string; totalAmount: number; paidAmount: number; outstandingAmount: number;
  salesOrderId: number | null; applied: SettlementApplied[]; daysPast: number; isOverdue: boolean;
}
interface StatementData {
  customer: any;
  summary: {
    asOf: string; totalInvoiced: number; totalPaid: number; totalOutstanding: number;
    overdueOutstanding: number; openCount: number;
    aging: { current: number; d30: number; d60: number; d90: number; d120: number };
  };
  invoices: StatementInvoice[];
}

const fmt = (n: number) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function CustomerStatementPage() {
  const [, params] = useRoute("/accounting/customer-statement/:id?");
  const [, setLocation] = useLocation();
  const { data: customers } = useListCustomers({ includeInactive: "1" } as any);
  const [customerId, setCustomerId] = useState<string>(params?.id || "");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (params?.id) setCustomerId(params.id); }, [params?.id]);

  useEffect(() => {
    if (!customerId) { setData(null); return; }
    setLoading(true);
    setError(null);
    fetch(`/erp-api/customers/${customerId}/statement?asOf=${asOf}`)
      .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((d: StatementData) => setData(d))
      .catch((e) => setError(e?.message || "載入失敗"))
      .finally(() => setLoading(false));
  }, [customerId, asOf]);

  const sortedCustomers = useMemo(() => (customers || []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name, "zh")), [customers]);

  return (
    <div className="space-y-6">
      <PageHeader title="客戶對帳單" description="顯示單一客戶的應收帳款明細：未結發票、已收款、餘額、帳齡">
        <Button variant="outline" size="sm" onClick={() => setLocation("/accounting/customers")}>
          <ArrowLeft className="h-4 w-4 mr-1" />回客戶列表
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" />列印
        </Button>
      </PageHeader>

      <Card className="print:hidden">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="min-w-[260px]">
              <Label className="text-xs text-muted-foreground">客戶</Label>
              <SearchableSelect
                value={customerId}
                onValueChange={v => setCustomerId(v)}
                options={sortedCustomers.map((c: any) => ({ value: String(c.id), label: `${c.customerCode ? `[${c.customerCode}] ` : ""}${c.name}` }))}
                placeholder="請選擇客戶"
                data-testid="select-statement-customer"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">截止日期</Label>
              <Input type="date" className="w-44" value={asOf} onChange={e => setAsOf(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {!customerId && (
        <div className="text-center text-muted-foreground py-12">請先選擇客戶</div>
      )}

      {customerId && loading && <div className="text-center text-muted-foreground py-12">載入中…</div>}
      {customerId && error && <div className="text-center text-red-600 py-12">{error}</div>}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-4 flex-wrap">
                <span>{data.customer.name}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {data.customer.customerCode && `客戶編號 ${data.customer.customerCode}　`}
                  {data.customer.taxId && `統編 ${data.customer.taxId}　`}
                  截至 {data.summary.asOf}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="開立發票合計" value={fmt(data.summary.totalInvoiced)} />
                <Stat label="已收款合計" value={fmt(data.summary.totalPaid)} accent="green" />
                <Stat label="未收款餘額" value={fmt(data.summary.totalOutstanding)} accent="amber" />
                <Stat label="逾期未收" value={fmt(data.summary.overdueOutstanding)} accent={data.summary.overdueOutstanding > 0 ? "red" : "gray"} />
              </div>
              <div className="grid grid-cols-5 gap-2 mt-4 text-xs">
                <Bucket label="未到期" value={data.summary.aging.current} />
                <Bucket label="1–30 天" value={data.summary.aging.d30} />
                <Bucket label="31–60 天" value={data.summary.aging.d60} />
                <Bucket label="61–90 天" value={data.summary.aging.d90} />
                <Bucket label="90 天以上" value={data.summary.aging.d120} accent="red" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">發票明細與沖銷紀錄（共 {data.invoices.length} 張，未結 {data.summary.openCount} 張）</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left px-4 py-2 font-medium">發票號</th>
                      <th className="text-left px-4 py-2 font-medium">日期</th>
                      <th className="text-left px-4 py-2 font-medium">到期日</th>
                      <th className="text-right px-4 py-2 font-medium">金額</th>
                      <th className="text-right px-4 py-2 font-medium">已收</th>
                      <th className="text-right px-4 py-2 font-medium">未收</th>
                      <th className="text-center px-4 py-2 font-medium">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoices.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-gray-400">截止日期前無發票</td></tr>
                    ) : data.invoices.map(inv => (
                      <RowGroup key={inv.id} inv={inv} />
                    ))}
                  </tbody>
                  {data.invoices.length > 0 && (
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-right">合計</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(data.summary.totalInvoiced)}</td>
                        <td className="px-4 py-2 text-right font-mono text-green-700">{fmt(data.summary.totalPaid)}</td>
                        <td className="px-4 py-2 text-right font-mono text-amber-700">{fmt(data.summary.totalOutstanding)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "green" | "amber" | "red" | "gray" }) {
  const color = accent === "green" ? "text-green-700" : accent === "amber" ? "text-amber-700" : accent === "red" ? "text-red-700" : "text-gray-900";
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-mono ${color}`}>{value}</div>
    </div>
  );
}

function Bucket({ label, value, accent }: { label: string; value: number; accent?: "red" }) {
  return (
    <div className={`border rounded p-2 text-center ${accent === "red" && value > 0 ? "bg-red-50 border-red-200" : ""}`}>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold">{fmt(value)}</div>
    </div>
  );
}

function RowGroup({ inv }: { inv: StatementInvoice }) {
  const statusBadge = inv.status === "Paid"
    ? <Badge className="bg-green-100 text-green-700">已收訖</Badge>
    : inv.isOverdue
      ? <Badge className="bg-red-100 text-red-700">逾期 {inv.daysPast} 天</Badge>
      : <Badge className="bg-gray-100 text-gray-700">未收</Badge>;
  return (
    <>
      <tr className="border-b hover:bg-gray-50">
        <td className="px-4 py-2 font-mono text-xs">
          {inv.salesOrderId
            ? <Link href={`/sales/orders/${inv.salesOrderId}`} className="text-blue-600 hover:underline">{inv.invoiceNumber}</Link>
            : <Link href={`/sales/invoices?open=${inv.id}`} className="text-blue-600 hover:underline">{inv.invoiceNumber}</Link>}
        </td>
        <td className="px-4 py-2">{inv.invoiceDate}</td>
        <td className="px-4 py-2">{inv.dueDate || "-"}</td>
        <td className="px-4 py-2 text-right font-mono">{fmt(inv.totalAmount)}</td>
        <td className="px-4 py-2 text-right font-mono text-green-700">{fmt(inv.paidAmount)}</td>
        <td className="px-4 py-2 text-right font-mono text-amber-700">{fmt(inv.outstandingAmount)}</td>
        <td className="px-4 py-2 text-center">{statusBadge}</td>
      </tr>
      {inv.applied.length > 0 && (
        <tr className="border-b bg-gray-50/30">
          <td colSpan={7} className="px-8 py-2 text-xs text-muted-foreground">
            <span className="mr-2">沖銷紀錄：</span>
            {inv.applied.map(a => (
              <span key={a.id} className="inline-block mr-3">
                {a.voucherDate} {a.voucherNumber ? <Link href={`/accounting/receipts?search=${encodeURIComponent(a.voucherNumber)}`} className="font-mono text-blue-600 hover:underline">{a.voucherNumber}</Link> : <span className="font-mono">{a.voucherNumber}</span>} -{fmt(a.amount)}
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

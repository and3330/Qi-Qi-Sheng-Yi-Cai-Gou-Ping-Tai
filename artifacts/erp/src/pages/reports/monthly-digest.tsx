import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { Printer, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AccountDrillDialog, DrillAmount, type DrillTarget } from "@/components/shared/account-drill";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

interface Digest {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  revenue: number;
  grossProfit: number;
  expenses: number;
  vatEstimate: number;
  vatPeriod: { startDate: string; endDate: string; outputTax: number; inputTax: number };
  receivablesOutstanding: number;
  receivablesOverdue30: number;
  payablesOutstanding: number;
  topCustomers: { id: number | null; name: string; revenue: number }[];
  topProjects: { id: number | null; name: string; revenue: number; cost: number; net: number }[];
  counts: { orders: number; quotations: number; invoices: number };
}

function previousMonth() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const money = (value: number) => `NT$ ${Number(value || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;

/** 每張卡片的數字都要點得進去：從分錄算的開明細視窗（drill），其他的連到算出這個數字的報表（href） */
interface DigestCard { label: string; value: string; note: ReactNode; href?: string; drill?: DrillTarget }
/** 連到來源報表的數字，長相跟「點數字看明細」的數字一樣 */
const linkClass = "rounded-sm underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:text-primary hover:decoration-primary print:no-underline";

export default function MonthlyDigestPage() {
  const reloadKey = useAutoReloadKey();
  const [selectedMonth, setSelectedMonth] = useState(previousMonth);
  const [data, setData] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const load = async () => {
    const [year, month] = selectedMonth.split("-");
    if (!year || !month) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/erp-api/reports/monthly-digest?year=${year}&month=${Number(month)}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "月結摘要載入失敗");
      setData(body);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "月結摘要載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [reloadKey]);

  const cards: DigestCard[] = data ? [
    { label: "未稅營收", value: money(data.revenue), note: "依銷項發票", href: "/reports/sales-analysis" },
    { label: "銷售毛利", value: money(data.grossProfit), note: "確認／完成訂單，移動平均成本", href: "/reports/sales-analysis" },
    { label: "本月費用", value: money(data.expenses), note: "已過帳費用科目", drill: { title: "本月費用", accountTypes: ["Expense"], startDate: data.startDate, endDate: data.endDate } },
    { label: "營業稅預估", value: money(data.vatEstimate), note: `${data.vatPeriod.startDate} ～ ${data.vatPeriod.endDate}`, href: "/accounting/vat-report" },
    { label: "應收未收", value: money(data.receivablesOutstanding), note: <>逾期 30 天以上 <Link href="/reports/ar-aging" className={linkClass} title="到應收帳齡看是哪些單">{money(data.receivablesOverdue30)}</Link></>, href: "/reports/ar-aging" },
    { label: "應付未付", value: money(data.payablesOutstanding), note: `截至 ${data.endDate}`, href: "/reports/ap-aging" },
  ] : [];

  return (
    <div id="monthly-digest" className="space-y-4">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 9mm; }
          body * { visibility: hidden !important; }
          #monthly-digest, #monthly-digest * { visibility: visible !important; }
          #monthly-digest { position: absolute; inset: 0; width: 100%; padding: 0; color: #111; }
          #monthly-digest .no-print { display: none !important; }
          #monthly-digest .print-card { break-inside: avoid; box-shadow: none; border-color: #d4d4d4; }
        }
      `}</style>
      <PageHeader title="月結摘要" description={data ? `${data.year} 年 ${data.month} 月｜一頁掌握營運與帳務重點` : "一頁掌握營運與帳務重點"} hint={<PageHint hintKey="monthly-digest">這裡把單月營收、支出、毛利與待處理事項整理在同一頁。月初可先選上個月份，逐項檢查未完成單據，再列印或分享摘要。小提醒：尚未確認或補登的單據可能不會完整反映在數字中。</PageHint>}>
        <div className="no-print flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto mt-4 sm:mt-0">
          <Input className="w-full sm:w-40" type="month" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)} />
          <div className="flex gap-2 w-full sm:w-auto">
            <Button className="flex-1 sm:flex-none" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />更新
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => window.print()} disabled={!data}>
              <Printer className="mr-1 h-4 w-4" />列印
            </Button>
          </div>
        </div>
      </PageHeader>

      {error && <Card><CardContent className="py-6 text-center text-destructive">{error}</CardContent></Card>}
      {loading && !data && <Card><CardContent className="py-10 text-center text-muted-foreground">正在彙整月結資料…</CardContent></Card>}
      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:grid-cols-3">
            {cards.map(({ label, value, note, href, drill: target }) => (
              <Card className="print-card" key={label}>
                <CardContent className="p-4">
                  <div className="text-sm text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-bold tracking-tight">
                    {target ? <DrillAmount onClick={() => setDrill(target)}>{value}</DrillAmount>
                      : href ? <Link href={href} className={linkClass} title="點一下看這個數字的來源報表">{value}</Link>
                      : value}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{note}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="print-card">
              <CardHeader className="px-4 py-3"><CardTitle className="text-base">前五大客戶（未稅營收）</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3">
                <ol className="space-y-2">
                  {data.topCustomers.map((customer, index) => (
                    <li className="flex items-center justify-between border-b pb-1.5 text-sm last:border-0" key={`${customer.id}-${customer.name}`}>
                      <span><span className="mr-2 text-muted-foreground">{index + 1}.</span>{customer.name}</span>
                      <strong>{customer.id != null ? <Link href={`/accounting/customer-statement/${customer.id}`} className={linkClass} title="看這個客戶的對帳單">{money(customer.revenue)}</Link> : money(customer.revenue)}</strong>
                    </li>
                  ))}
                  {!data.topCustomers.length && <li className="py-4 text-center text-sm text-muted-foreground">本月尚無銷項發票</li>}
                </ol>
              </CardContent>
            </Card>
            <Card className="print-card">
              <CardHeader className="px-4 py-3"><CardTitle className="text-base">前五大專案（訂單毛利）</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3">
                <ol className="space-y-2">
                  {data.topProjects.map((project, index) => (
                    <li className="flex items-center justify-between border-b pb-1.5 text-sm last:border-0" key={`${project.id}-${project.name}`}>
                      <span><span className="mr-2 text-muted-foreground">{index + 1}.</span>{project.name}</span>
                      <span className="text-right"><strong>{project.id != null ? <Link href={`/projects/financials?id=${project.id}`} className={linkClass} title="看這個專案的損益">{money(project.net)}</Link> : money(project.net)}</strong><span className="ml-2 text-xs text-muted-foreground">營收 {money(project.revenue)}</span></span>
                    </li>
                  ))}
                  {!data.topProjects.length && <li className="py-4 text-center text-sm text-muted-foreground">本月尚無確認或完成訂單</li>}
                </ol>
              </CardContent>
            </Card>
          </div>

          <Card className="print-card">
            <CardContent className="grid grid-cols-1 md:grid-cols-3 divide-x p-3 text-center">
              <div><div className="text-xs text-muted-foreground">新建銷售訂單</div><div className="text-xl font-bold">{data.counts.orders}</div></div>
              <div><div className="text-xs text-muted-foreground">新建報價單</div><div className="text-xl font-bold">{data.counts.quotations}</div></div>
              <div><div className="text-xs text-muted-foreground">新建發票</div><div className="text-xl font-bold">{data.counts.invoices}</div></div>
            </CardContent>
          </Card>
        </>
      )}
      <AccountDrillDialog target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
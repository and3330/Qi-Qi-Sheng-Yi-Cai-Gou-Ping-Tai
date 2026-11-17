import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Printer, Sparkles, TrendingUp, TrendingDown, Minus, Lightbulb } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Kpi {
  period: { year: number; month: number; start: string; end: string };
  prevPeriod: { year: number; month: number };
  kpis: {
    sales: { total: number; count: number; prev: number; pctChange: number | null };
    purchase: { total: number; count: number; prev: number; pctChange: number | null };
    arOutstanding: number;
    apOutstanding: number;
    newCustomers: number;
    journalEntryCount: number;
    journalUnbalanced: number;
  };
  topCustomers: Array<{ name: string; total: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  byDepartment: Array<{ department: string; total: number }>;
}

interface Report {
  title: string;
  executive_summary: string;
  sections: Array<{ title: string; body: string; highlights?: string[] }>;
  recommendations: string[];
}

interface Resp { kpi: Kpi; report: Report }

const fmt = (n: number) => "NT$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

function PctBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">— 無比較</span>;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color = value > 0 ? "text-green-600" : value < 0 ? "text-red-600" : "text-muted-foreground";
  return (
    <span className={`text-xs flex items-center gap-1 ${color}`}>
      <Icon className="h-3 w-3" /> {value >= 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

function KpiCard({ label, value, sub, change }: { label: string; value: string; sub?: string; change?: number | null }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1" data-testid={`kpi-${label}`}>{value}</div>
        <div className="flex items-center gap-2 mt-1">
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          {change !== undefined && <PctBadge value={change} />}
        </div>
      </CardContent>
    </Card>
  );
}

const now = new Date();
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

export default function AiMonthlyReportPage() {
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());

  const q = useQuery<Resp>({
    queryKey: ["ai-monthly-report", year, month],
    queryFn: async () => {
      const res = await fetch(`/erp-api/ai/monthly-report?year=${year}&month=${month}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    enabled: false,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4 max-w-6xl print:max-w-full" data-testid="page-ai-monthly-report">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> AI 月報自動撰寫
          </h1>
          <p className="text-sm text-muted-foreground mt-1">選擇月份，AI 會彙整 KPI 並撰寫繁體中文月度經營報告。</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="border rounded px-2 py-1.5 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="select-year">
            {years.map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>
          <select className="border rounded px-2 py-1.5 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="select-month">
            {months.map((m) => <option key={m} value={m}>{m} 月</option>)}
          </select>
          <Button onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-generate">
            {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {q.data ? "重新生成" : "生成報告"}
          </Button>
          {q.data && (
            <Button variant="outline" size="icon" onClick={() => window.print()} data-testid="button-print">
              <Printer className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {q.error && (
        <Card className="border-destructive/50"><CardContent className="p-4 text-sm text-destructive">{(q.error as Error).message}</CardContent></Card>
      )}

      {q.isFetching && !q.data && (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div>正在彙整資料、產生 KPI 並由 AI 撰寫報告...</div>
          <div className="text-xs">通常需要 5-15 秒</div>
        </CardContent></Card>
      )}

      {!q.data && !q.isFetching && (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">
          請選擇年份與月份，按「生成報告」開始
        </CardContent></Card>
      )}

      {q.data && (
        <div className="space-y-4">
          {/* Title */}
          <div className="text-center py-3">
            <h2 className="text-3xl font-bold" data-testid="text-title">{q.data.report.title}</h2>
            <div className="text-sm text-muted-foreground mt-1">
              期間：{q.data.kpi.period.start} ~ {q.data.kpi.period.end} · 與 {q.data.kpi.prevPeriod.year} 年 {q.data.kpi.prevPeriod.month} 月比較
            </div>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="銷售總額" value={fmt(q.data.kpi.kpis.sales.total)} sub={`${q.data.kpi.kpis.sales.count} 筆訂單`} change={q.data.kpi.kpis.sales.pctChange} />
            <KpiCard label="採購總額" value={fmt(q.data.kpi.kpis.purchase.total)} sub={`${q.data.kpi.kpis.purchase.count} 筆訂單`} change={q.data.kpi.kpis.purchase.pctChange} />
            <KpiCard label="應收未結" value={fmt(q.data.kpi.kpis.arOutstanding)} sub="客戶端"/>
            <KpiCard label="應付未結" value={fmt(q.data.kpi.kpis.apOutstanding)} sub="供應商端"/>
            <KpiCard label="新增客戶" value={String(q.data.kpi.kpis.newCustomers)} sub="本月新建" />
            <KpiCard label="傳票筆數" value={String(q.data.kpi.kpis.journalEntryCount)} sub="已過帳/已提交" />
            <KpiCard label="不平衡傳票" value={String(q.data.kpi.kpis.journalUnbalanced)} sub={q.data.kpi.kpis.journalUnbalanced > 0 ? "需立即檢查" : "正常"} />
          </div>

          {/* Executive summary */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">執行摘要</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm leading-relaxed" data-testid="text-summary">{q.data.report.executive_summary}</p>
            </CardContent>
          </Card>

          {/* Sections */}
          {q.data.report.sections?.map((s, i) => (
            <Card key={i} data-testid={`section-${i}`}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{s.title}</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-2">
                <p className="text-sm leading-relaxed whitespace-pre-line">{s.body}</p>
                {s.highlights && s.highlights.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {s.highlights.map((h, j) => <li key={j}>{h}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Top customers + items + dept */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">前 5 大客戶</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {q.data.kpi.topCustomers.length === 0 ? <div className="text-xs text-muted-foreground">無資料</div> :
                  <ol className="text-sm space-y-1">{q.data.kpi.topCustomers.map((c, i) =>
                    <li key={i} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {c.name}</span><span className="text-muted-foreground whitespace-nowrap">{fmt(c.total)}</span></li>
                  )}</ol>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">前 5 大商品（依營收）</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {q.data.kpi.topItems.length === 0 ? <div className="text-xs text-muted-foreground">無資料</div> :
                  <ol className="text-sm space-y-1">{q.data.kpi.topItems.map((it, i) =>
                    <li key={i} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {it.name}</span><span className="text-muted-foreground whitespace-nowrap">{fmt(it.revenue)}</span></li>
                  )}</ol>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">部門銷售分布</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {q.data.kpi.byDepartment.length === 0 ? <div className="text-xs text-muted-foreground">無資料</div> :
                  <ol className="text-sm space-y-1">{q.data.kpi.byDepartment.map((d, i) =>
                    <li key={i} className="flex justify-between gap-2"><span className="truncate">{d.department}</span><span className="text-muted-foreground whitespace-nowrap">{fmt(d.total)}</span></li>
                  )}</ol>}
              </CardContent>
            </Card>
          </div>

          {/* Recommendations */}
          {q.data.report.recommendations?.length > 0 && (
            <Card className="border-yellow-200 bg-yellow-50/40">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-yellow-600" /> 行動建議
              </CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ol className="list-decimal pl-5 text-sm space-y-2">
                  {q.data.report.recommendations.map((r, i) => <li key={i} data-testid={`rec-${i}`}>{r}</li>)}
                </ol>
              </CardContent>
            </Card>
          )}

          <div className="text-xs text-muted-foreground text-center pt-4 print:pt-8">
            本報告由 AI 自動產生 · {new Date().toLocaleString("zh-TW")}
          </div>
        </div>
      )}
    </div>
  );
}

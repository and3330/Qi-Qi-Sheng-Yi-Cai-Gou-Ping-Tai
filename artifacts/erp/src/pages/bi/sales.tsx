import { TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { BiFrame } from "@/components/bi/bi-frame";
import { BI_COLORS, EmptyState, MetricCard, Panel, fmtCompact, fmtMoney, fmtNum, fmtPct, tooltipStyle } from "@/components/bi/bi-ui";
import type { RfmCustomer } from "@/lib/bi-api";

const SEG_COLOR: Record<RfmCustomer["segment"], string> = {
  核心客戶: BI_COLORS.teal, 成長客戶: BI_COLORS.primary, 沉睡風險: BI_COLORS.rose, 一般客戶: BI_COLORS.slate,
};

export default function SalesBi() {
  return (
    <BiFrame page="sales" title="銷售與獲利" subtitle="開立發票、銷退、實收、報價轉換與客戶 RFM" icon={<TrendingUp size={18} />}>
      {(d) => {
        const s = d.summary;
        const hasMonthly = d.monthly.some((m) => m.invoiced || m.returns || m.collected);
        const segments = (Object.keys(SEG_COLOR) as RfmCustomer["segment"][]).map((seg) => ({ seg, rows: d.rfm.filter((r) => r.segment === seg) }));
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="銷項發票營收（未稅）" metric={s.invoicedRevenue} format={fmtMoney} hint={s.invoiceCount.value != null ? `${fmtNum(s.invoiceCount.value)} 張發票` : undefined} />
              <MetricCard label="銷退率" metric={s.returnRate} format={fmtPct} hint={s.returnsAmount.value != null ? `退回 ${fmtMoney(s.returnsAmount.value)}` : undefined} tone="bad" />
              <MetricCard label="實際收款" metric={s.collected} format={fmtMoney} />
              <MetricCard label="報價轉訂單率" metric={s.quotationConversion} format={fmtPct} hint={s.top5Concentration.value != null ? `前五大客戶占 ${fmtPct(s.top5Concentration.value)}` : undefined} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="月度開票、銷退與收款" className="lg:col-span-2">
                {hasMonthly ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={d.monthly}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={fmtCompact} width={56} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="invoiced" name="開票" fill={BI_COLORS.primary} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="collected" name="收款" fill={BI_COLORS.teal} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="returns" name="銷退" fill={BI_COLORS.rose} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState reason={s.invoicedRevenue.reason ?? "期間內沒有銷售資料"} />}
              </Panel>
              <Panel title="報價至收款漏斗" description="金額與筆數皆取自單據">
                {d.funnel.length ? (
                  <div className="space-y-3">
                    {d.funnel.map((f) => {
                      const max = Math.max(...d.funnel.map((x) => x.amount), 1);
                      return (
                        <div key={f.step}>
                          <div className="flex justify-between text-xs"><span className="font-medium">{f.step}</span><span className="bi-figure text-muted-foreground">{fmtNum(f.count)} 筆 · {fmtMoney(f.amount)}</span></div>
                          <div className="mt-1 h-2.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (f.amount / max) * 100)}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                ) : <EmptyState reason={s.quotationConversion.reason ?? "期間內沒有報價單"} />}
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="客戶 RFM 分布" description="橫軸：距最後開票天數；縱軸：開票次數；點大小：金額。分群以實際中位數切分">
                {d.rfm.length ? (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" dataKey="recencyDays" name="最近天數" unit="天" />
                        <YAxis type="number" dataKey="frequency" name="次數" width={40} />
                        <ZAxis type="number" dataKey="monetary" range={[40, 400]} name="金額" />
                        <Tooltip cursor={{ strokeDasharray: "3 3" }} {...tooltipStyle}
                          content={({ payload }) => {
                            const r = payload?.[0]?.payload as RfmCustomer | undefined;
                            if (!r) return null;
                            return <div className="rounded-md border bg-background p-2 text-xs"><div className="font-semibold">{r.name}</div><div>最後開票 {r.lastInvoiceDate}（{r.recencyDays} 天前）</div><div>{r.frequency} 次 · {fmtMoney(r.monetary)}</div><div>{r.segment}</div></div>;
                          }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {segments.map((g) => <Scatter key={g.seg} name={g.seg} data={g.rows} fill={SEG_COLOR[g.seg]} />)}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </>
                ) : <EmptyState reason="期間內沒有可歸屬客戶的銷項發票" />}
              </Panel>
              <Panel title="熱銷品項" description="營收取自發票明細；成本以目前移動平均成本估算">
                {d.topItems.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground"><tr className="border-b text-left"><th className="py-2">品項</th><th className="text-right">數量</th><th className="text-right">營收</th><th className="text-right">估計毛利率</th></tr></thead>
                      <tbody>
                        {d.topItems.map((t) => (
                          <tr key={t.name} className="border-b last:border-0">
                            <td className="py-2 font-medium">{t.name}</td>
                            <td className="bi-figure text-right">{fmtNum(t.qty, 2)}</td>
                            <td className="bi-figure text-right">{fmtMoney(t.revenue)}</td>
                            <td className="bi-figure text-right">{t.margin == null ? <span className="text-muted-foreground">無成本</span> : fmtPct(t.margin)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState reason="期間內發票沒有品項明細" />}
              </Panel>
            </div>
          </>
        );
      }}
    </BiFrame>
  );
}

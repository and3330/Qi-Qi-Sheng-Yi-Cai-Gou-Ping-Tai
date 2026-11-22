import { useState } from "react";
import { Activity } from "lucide-react";
import { AccountDrillDialog, DrillAmount, type DrillTarget } from "@/components/shared/account-drill";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BiFrame } from "@/components/bi/bi-frame";
import { BI_COLORS, EmptyState, MetricCard, Panel, fmtCompact, fmtMoney, fmtNum, fmtPct, tooltipStyle } from "@/components/bi/bi-ui";
import type { ExecutiveResponse } from "@/lib/bi-api";

function waterfallRows(w: ExecutiveResponse["waterfall"]) {
  let running = 0;
  return w.map((s) => {
    if (s.kind === "start") { running = s.amount; return { label: s.label, base: 0, value: s.amount, kind: s.kind }; }
    if (s.kind === "minus") { running -= s.amount; return { label: s.label, base: running, value: s.amount, kind: s.kind }; }
    return { label: s.label, base: Math.min(0, s.amount), value: Math.abs(s.amount), kind: s.amount >= 0 ? "total" : "loss" };
  });
}

export default function ExecutiveCockpit() {
  // 事業部的營收、費用可以點進去看是哪些分錄
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  return (
    <>
    <BiFrame page="executive" title="營運總覽" subtitle="損益、實際收付款、事業部貢獻與營運資本週轉" icon={<Activity size={18} />}>
      {(d) => {
        const s = d.summary;
        const wc = d.workingCapital;
        const hasMonthly = d.monthly.some((m) => m.revenue || m.expense || m.cashIn || m.cashOut);
        const wf = waterfallRows(d.waterfall);
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="營業收入" metric={s.revenue} format={fmtMoney} hint={s.expense.value != null ? `費用 ${fmtMoney(s.expense.value)}` : undefined} />
              <MetricCard label="本期損益" metric={s.netProfit} format={fmtMoney} tone={(s.netProfit.value ?? 0) >= 0 ? "good" : "bad"} hint={s.profitMargin.value != null ? `利潤率 ${fmtPct(s.profitMargin.value)}` : s.profitMargin.reason} />
              <MetricCard label="實收淨現金" metric={s.netCash} format={fmtMoney} hint={s.cashIn.value != null ? `收 ${fmtMoney(s.cashIn.value)} / 付 ${fmtMoney(s.cashOut.value)}` : undefined} />
              <MetricCard label="現金循環週期 CCC" metric={wc.ccc} format={(v) => `${fmtNum(v, 1)} 天`} hint="DSO + DIO − DPO" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="營收、損益與實收現金走勢" description="柱：營收與損益（分錄）；線：收款減付款（實際沖銷）">
                {hasMonthly ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={d.monthly.map((m) => ({ ...m, netCash: m.cashIn - m.cashOut }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={fmtCompact} width={56} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="revenue" name="營業收入" fill={BI_COLORS.primary} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="netProfit" name="本期損益" fill={BI_COLORS.teal} radius={[3, 3, 0, 0]} />
                      <Line dataKey="netCash" name="實收淨現金" stroke={BI_COLORS.amber} strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyState reason={s.revenue.reason ?? s.cashIn.reason ?? "期間內沒有分錄或收付款"} />}
              </Panel>

              <Panel title="營收至損益瀑布" description="營業成本為 5 開頭費用科目；其餘費用合併為其他費用">
                {wf.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={wf}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" />
                      <YAxis tickFormatter={fmtCompact} width={56} />
                      <Tooltip formatter={(v: number, n: string) => (n === "base" ? null : fmtMoney(v))} {...tooltipStyle} />
                      <Bar dataKey="base" stackId="w" fill="transparent" />
                      <Bar dataKey="value" name="金額" stackId="w" radius={[3, 3, 0, 0]}>
                        {wf.map((r, i) => <Cell key={i} fill={r.kind === "minus" || r.kind === "loss" ? BI_COLORS.rose : r.kind === "total" ? BI_COLORS.teal : BI_COLORS.primary} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState reason={s.revenue.reason ?? "沒有分錄"} />}
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="事業部貢獻" description="依 BU 報表歸屬規則；調整後淨利含內部轉撥" className="lg:col-span-2">
                {d.buContributions.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground"><tr className="border-b text-left"><th className="py-2">事業部</th><th className="text-right">營收</th><th className="text-right">費用</th><th className="text-right">淨利</th><th className="text-right">調整後淨利</th><th className="text-right">利潤率</th></tr></thead>
                      <tbody>
                        {d.buContributions.map((b) => (
                          <tr key={String(b.departmentId)} className="border-b last:border-0">
                            <td className="py-2 font-medium">{b.name}</td>
                            <td className="bi-figure text-right">{b.departmentId ? <DrillAmount onClick={() => setDrill({ title: `${b.name} 營收`, accountTypes: ["Income"], departmentId: b.departmentId, startDate: d.period.startDate, endDate: d.period.endDate, excludeInternal: true })}>{fmtMoney(b.revenue)}</DrillAmount> : fmtMoney(b.revenue)}</td>
                            <td className="bi-figure text-right">{b.departmentId ? <DrillAmount onClick={() => setDrill({ title: `${b.name} 費用`, accountTypes: ["Expense"], departmentId: b.departmentId, startDate: d.period.startDate, endDate: d.period.endDate, excludeInternal: true })}>{fmtMoney(b.expense)}</DrillAmount> : fmtMoney(b.expense)}</td>
                            <td className={`bi-figure text-right ${b.netProfit < 0 ? "text-rose-600" : ""}`}>{fmtMoney(b.netProfit)}</td>
                            <td className={`bi-figure text-right ${b.adjustedNet < 0 ? "text-rose-600" : ""}`}>{fmtMoney(b.adjustedNet)}</td>
                            <td className="bi-figure text-right">{fmtPct(b.margin)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState reason="期間內沒有可歸屬事業部的損益分錄" />}
              </Panel>
              <Panel title="營運資本週轉" description="目前餘額 ÷ 期間流量 × 天數">
                <div className="space-y-3">
                  {([["dso", "應收天數 DSO"], ["dio", "存貨天數 DIO"], ["dpo", "應付天數 DPO"], ["ccc", "現金循環 CCC"]] as const).map(([k, label]) => (
                    <div key={k} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      {wc[k].value != null
                        ? <span className="bi-figure text-sm font-semibold">{fmtNum(wc[k].value, 1)} 天</span>
                        : <span className="max-w-[60%] text-right text-[11px] text-muted-foreground">無法計算：{wc[k].reason}</span>}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        );
      }}
    </BiFrame>
    <AccountDrillDialog target={drill} onClose={() => setDrill(null)} />
    </>
  );
}

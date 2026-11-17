import { Users } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BiFrame } from "@/components/bi/bi-frame";
import { BI_COLORS, EmptyState, MetricCard, Panel, fmtCompact, fmtMoney, fmtNum, tooltipStyle } from "@/components/bi/bi-ui";

export default function HrBi() {
  return (
    <BiFrame page="hr" title="人力成本與效能" subtitle="已確認薪資、雇主負擔、人均營收與出勤狀況" icon={<Users size={18} />}>
      {(d) => {
        const s = d.summary;
        const hasPay = d.monthly.some((m) => m.gross > 0);
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="在職人數" metric={s.activeHeadcount} format={(v) => `${fmtNum(v)} 人`} />
              <MetricCard label="應發薪資合計" metric={s.payrollGross} format={fmtMoney} />
              <MetricCard label="雇主總成本" metric={s.employerCost} format={fmtMoney} hint="含勞健保、勞退雇主負擔" />
              <MetricCard label="人均營收" metric={s.revenuePerHead} format={fmtMoney} />
              <MetricCard label="加班時數" metric={s.overtimeHours} format={(v) => `${fmtNum(v, 1)} 小時`} />
              <MetricCard label="遲到次數" metric={s.lateCount} format={(v) => `${fmtNum(v)} 次`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="月度人事成本與人均營收" description="柱：應發與雇主成本；線：當月營收 ÷ 發薪人數">
                {hasPay ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={d.monthly}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" />
                      <YAxis yAxisId="l" tickFormatter={fmtCompact} width={56} />
                      <YAxis yAxisId="r" orientation="right" tickFormatter={fmtCompact} width={56} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="l" dataKey="gross" name="應發薪資" fill={BI_COLORS.primary} radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="l" dataKey="employerCost" name="雇主總成本" fill={BI_COLORS.violet} radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" dataKey="revenuePerHead" name="人均營收" stroke={BI_COLORS.amber} strokeWidth={2.5} connectNulls={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyState reason={s.payrollGross.reason ?? "期間內沒有已確認或已發放的薪資單"} />}
              </Panel>
              <Panel title="每日出勤" description="出勤筆數、遲到與加班時數">
                {d.attendanceDaily.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={d.attendanceDaily}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} />
                      <YAxis width={40} />
                      <Tooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area dataKey="records" name="出勤" stroke={BI_COLORS.teal} fill={BI_COLORS.teal} fillOpacity={0.15} />
                      <Area dataKey="late" name="遲到" stroke={BI_COLORS.rose} fill={BI_COLORS.rose} fillOpacity={0.15} />
                      <Area dataKey="overtimeHours" name="加班時數" stroke={BI_COLORS.amber} fill={BI_COLORS.amber} fillOpacity={0.1} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <EmptyState reason={s.lateCount.reason ?? "期間內沒有出勤紀錄"} />}
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="部門人事成本">
                {d.departments.length ? (
                  <ResponsiveContainer width="100%" height={Math.max(200, d.departments.length * 36)}>
                    <BarChart data={d.departments} layout="vertical" margin={{ left: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={fmtCompact} />
                      <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} {...tooltipStyle} />
                      <Bar dataKey="employerCost" name="雇主總成本" fill={BI_COLORS.violet} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState reason="期間內沒有可歸屬部門的薪資或出勤資料" />}
              </Panel>
              <Panel title="業務人員訂單貢獻" description="訂單金額取自銷售訂單的業務員欄位；系統未設定獎金規則，不計算佣金">
                {d.salespeople.length ? (
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground"><tr className="border-b text-left"><th className="py-2">業務</th><th className="text-right">訂單金額</th><th className="text-right">雇主成本</th><th className="text-right">倍數</th></tr></thead>
                    <tbody>
                      {d.salespeople.map((p) => (
                        <tr key={p.employeeId} className="border-b last:border-0">
                          <td className="py-2 font-medium">{p.name}</td>
                          <td className="bi-figure text-right">{fmtMoney(p.orderRevenue)}</td>
                          <td className="bi-figure text-right">{fmtMoney(p.employerCost)}</td>
                          <td className="bi-figure text-right">{p.employerCost ? `${fmtNum(p.orderRevenue / p.employerCost, 1)}x` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <EmptyState reason="期間內沒有指定業務員的銷售訂單" />}
              </Panel>
            </div>
          </>
        );
      }}
    </BiFrame>
  );
}

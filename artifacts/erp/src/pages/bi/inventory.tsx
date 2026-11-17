import { Boxes } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BiFrame } from "@/components/bi/bi-frame";
import { BI_COLORS, EmptyState, MetricCard, Panel, fmtCompact, fmtMoney, fmtNum, fmtPct, tooltipStyle } from "@/components/bi/bi-ui";
import type { StockStatus } from "@/lib/bi-api";

const STATUS_CLS: Record<StockStatus, string> = {
  缺貨風險: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  低於安全量: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  滯銷: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  正常: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  無出庫紀錄: "bg-muted text-muted-foreground",
};

export default function InventoryBi() {
  return (
    <BiFrame page="inventory" title="庫存與供應鏈" subtitle="存貨價值、庫齡、可供應天數與供應商交期表現" icon={<Boxes size={18} />}>
      {(d) => {
        const s = d.summary;
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="存貨價值（移動平均成本）" metric={s.inventoryValue} format={fmtMoney} hint={s.itemCount.value != null ? `${fmtNum(s.itemCount.value)} 項有庫存` : undefined} />
              <MetricCard label="低於安全庫存" metric={s.belowReorder} format={(v) => `${fmtNum(v)} 項`} tone={(s.belowReorder.value ?? 0) > 0 ? "bad" : "default"} />
              <MetricCard label="負庫存／無成本" metric={s.negativeStock} format={(v) => `${fmtNum(v)} 項負庫存`} hint={s.zeroCostWithStock.value != null ? `${fmtNum(s.zeroCostWithStock.value)} 項有庫存無成本` : undefined} />
              <MetricCard label="供應商準時到貨率" metric={s.supplierOnTimeRate} format={fmtPct} hint="進貨日 ≤ 採購單預計日" />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="庫齡分布" description="依最後一次入庫日期分組的存貨價值">
                {d.aging.some((a) => a.items > 0) ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={d.aging}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="bucket" />
                      <YAxis tickFormatter={fmtCompact} width={56} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} {...tooltipStyle} />
                      <Bar dataKey="value" name="存貨價值" fill={BI_COLORS.primary} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState reason={s.inventoryValue.reason ?? "沒有有庫存的料件"} />}
              </Panel>
              <Panel title="料件庫存健康度" description="可供應天數 = 庫存 ÷ 期間日均出庫" className="lg:col-span-2">
                {d.health.length ? (
                  <div className="max-h-[300px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card text-muted-foreground"><tr className="border-b text-left"><th className="py-2">料件</th><th className="text-right">庫存</th><th className="text-right">價值</th><th className="text-right">期間出庫</th><th className="text-right">可供應天數</th><th className="pl-3">狀態</th></tr></thead>
                      <tbody>
                        {d.health.map((h) => (
                          <tr key={h.itemId} className="border-b last:border-0">
                            <td className="py-2"><span className="font-mono text-muted-foreground">{h.code}</span> {h.name}</td>
                            <td className="bi-figure text-right">{fmtNum(h.stock, 2)}</td>
                            <td className="bi-figure text-right">{fmtMoney(h.value)}</td>
                            <td className="bi-figure text-right">{fmtNum(h.outboundQty, 2)}</td>
                            <td className="bi-figure text-right">{h.daysOfSupply == null ? "—" : fmtNum(h.daysOfSupply, 1)}</td>
                            <td className="pl-3"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[h.status]}`}>{h.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState reason="沒有實體料件資料" />}
              </Panel>
            </div>

            <Panel title="供應商表現" description="採購金額取自進項發票；準時率比對進貨單日期與採購單預計到貨日；完整到貨率（In-Full）因缺少逐行收貨比對而不提供">
              {d.suppliers.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground"><tr className="border-b text-left"><th className="py-2">供應商</th><th className="text-right">採購金額</th><th className="text-right">進貨次數</th><th className="text-right">準時率</th><th className="text-right">退貨次數</th><th className="text-right">退貨金額</th></tr></thead>
                    <tbody>
                      {d.suppliers.map((sp) => (
                        <tr key={sp.supplierId} className="border-b last:border-0">
                          <td className="py-2 font-medium">{sp.name}</td>
                          <td className="bi-figure text-right">{fmtMoney(sp.spend)}</td>
                          <td className="bi-figure text-right">{fmtNum(sp.receipts)}</td>
                          <td className="bi-figure text-right">{sp.onTimeRate == null ? <span className="text-muted-foreground">無預計日</span> : fmtPct(sp.onTimeRate)}</td>
                          <td className="bi-figure text-right">{fmtNum(sp.returns)}</td>
                          <td className="bi-figure text-right">{fmtMoney(sp.returnAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState reason="期間內沒有進項發票、進貨或採購退回紀錄" />}
            </Panel>
          </>
        );
      }}
    </BiFrame>
  );
}

import { CheckCircle2, CircleSlash, ShieldCheck, XCircle } from "lucide-react";
import { BiError, BiHeader, BiSkeleton, Panel, fmtNum } from "@/components/bi/bi-ui";
import { useBiHealth, type HealthCheck } from "@/lib/bi-api";

function StatusIcon({ c }: { c: HealthCheck }) {
  if (c.status === "pass") return <CheckCircle2 size={16} className="text-emerald-600" />;
  if (c.status === "not_applicable") return <CircleSlash size={16} className="text-muted-foreground" />;
  return <XCircle size={16} className={c.severity === "error" ? "text-rose-600" : "text-amber-600"} />;
}

export default function ObservabilityBi() {
  const q = useBiHealth();
  const d = q.data;
  const counts = d ? {
    pass: d.checks.filter((c) => c.status === "pass").length,
    fail: d.checks.filter((c) => c.status === "fail").length,
    na: d.checks.filter((c) => c.status === "not_applicable").length,
  } : null;

  return (
    <div className="bi-root mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
      <BiHeader
        title="數據健康檢查"
        subtitle="在目前公司資料上即時執行唯讀一致性檢查，結果直接反映帳務資料品質"
        icon={<ShieldCheck size={18} />}
        computedAt={d?.computedAt}
        fetching={q.isFetching}
        onRefresh={() => q.refetch()}
      />
      {q.isLoading ? <BiSkeleton /> : q.isError || !d || !counts ? <BiError error={q.error} onRetry={() => q.refetch()} /> : (
        <div className={`space-y-5 ${q.isFetching ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="bi-panel p-4"><div className="text-xs text-muted-foreground">通過</div><div className="bi-figure text-2xl font-bold text-emerald-700">{counts.pass}</div></div>
            <div className="bi-panel p-4"><div className="text-xs text-muted-foreground">發現問題</div><div className={`bi-figure text-2xl font-bold ${counts.fail ? "text-rose-600" : ""}`}>{counts.fail}</div></div>
            <div className="bi-panel p-4"><div className="text-xs text-muted-foreground">無資料可檢查</div><div className="bi-figure text-2xl font-bold text-muted-foreground">{counts.na}</div></div>
            <div className="bi-panel p-4">
              <div className="text-xs text-muted-foreground">會計科目基準</div>
              <div className="bi-figure text-2xl font-bold">{fmtNum(d.accountBaseline.present)} / {fmtNum(d.accountBaseline.expected)}</div>
              <div className="text-[11px] text-muted-foreground">檢查耗時 {d.durationMs} ms</div>
            </div>
          </div>

          <Panel title="一致性檢查" description="每項列出檢查母體筆數、違規筆數與前 5 筆樣本">
            <div className="divide-y">
              {d.checks.map((c) => (
                <div key={c.id} className="flex flex-col gap-1 py-3 md:flex-row md:items-start md:gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <StatusIcon c={c} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {c.title}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{c.domain}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{c.detail}</div>
                      {c.samples.length > 0 && <div className="mt-1 font-mono text-[11px] text-rose-700 dark:text-rose-300">{c.samples.join("、")}</div>}
                    </div>
                  </div>
                  <div className="bi-figure pl-6 text-xs text-muted-foreground md:pl-0 md:text-right">
                    {c.status === "not_applicable" ? "無可檢查資料" : `${fmtNum(c.observed)} / ${fmtNum(c.scanned)} 筆異常`}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="資料表筆數與最新日期">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr className="border-b text-left"><th className="py-2">資料</th><th className="text-right">筆數</th><th className="text-right">最新日期</th></tr></thead>
                <tbody>
                  {d.tableCounts.map((t) => (
                    <tr key={t.table} className="border-b last:border-0">
                      <td className="py-2">{t.label} <span className="font-mono text-muted-foreground">{t.table}</span></td>
                      <td className="bi-figure text-right">{fmtNum(t.rows)}</td>
                      <td className="bi-figure text-right text-muted-foreground">{t.latest ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="會計科目基準比對" description={`基準：${d.accountBaseline.profile}；僅比對科目代碼是否存在，不做任何修改`}>
              {d.accountBaseline.missingCodes.length === 0
                ? <p className="text-sm text-emerald-700">基準科目全部存在。</p>
                : <p className="text-xs">缺少 {d.accountBaseline.expected - d.accountBaseline.present} 個代碼（前 20 個）：<span className="font-mono">{d.accountBaseline.missingCodes.join("、")}</span></p>}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

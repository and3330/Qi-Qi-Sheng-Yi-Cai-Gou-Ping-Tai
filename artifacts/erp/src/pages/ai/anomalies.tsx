import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, AlertTriangle, Loader2, RefreshCw, Lightbulb } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Candidate {
  category: string;
  rule: string;
  ref: string;
  date: string;
  amount: number;
  detail: string;
}

interface AnomalyResp {
  period: { days: number; since: string };
  totalCount: number;
  summary: string;
  topRisks: string[];
  recommendation: string;
  byCategory: Record<string, Candidate[]>;
}

const CATEGORY_COLORS: Record<string, string> = {
  "不平衡傳票": "bg-red-100 text-red-700 border-red-200",
  "疑似重複付款": "bg-orange-100 text-orange-700 border-orange-200",
  "疑似重複採購": "bg-amber-100 text-amber-700 border-amber-200",
  "異常大額傳票": "bg-purple-100 text-purple-700 border-purple-200",
  "週末建立傳票": "bg-blue-100 text-blue-700 border-blue-200",
};

const PERIODS = [
  { label: "近 7 天", value: 7 },
  { label: "近 30 天", value: 30 },
  { label: "近 90 天", value: 90 },
  { label: "近 180 天", value: 180 },
];

function fmtMoney(n: number): string {
  return "NT$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function AiAnomaliesPage() {
  const [days, setDays] = useState(30);

  const q = useQuery<AnomalyResp>({
    queryKey: ["ai-anomalies", days],
    queryFn: async () => {
      const res = await fetch(`/erp-api/ai/anomalies?days=${days}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4 max-w-6xl" data-testid="page-ai-anomalies">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-orange-500" /> AI 異常偵測
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            自動掃描傳票、發票、採購單，找出借貸不平、重複付款、異常金額、週末入帳等可疑紀錄，並由 AI 排序風險。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={days === p.value ? "default" : "outline"}
              onClick={() => setDays(p.value)}
              data-testid={`period-${p.value}`}
            >
              {p.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh">
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {q.isLoading && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> AI 正在掃描異常...
        </CardContent></Card>
      )}

      {q.error && (
        <Card className="border-destructive/50"><CardContent className="p-4 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {(q.error as Error).message}
        </CardContent></Card>
      )}

      {q.data && (
        <>
          {/* Top summary */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-3xl font-bold" data-testid="text-total">{q.data.totalCount}</div>
                <div className="text-sm text-muted-foreground">
                  筆候選異常 · 期間 {q.data.period.since} ~ 今天
                </div>
              </div>
              <p className="text-sm leading-relaxed" data-testid="text-summary">{q.data.summary}</p>
              {q.data.recommendation && (
                <div className="flex items-start gap-2 text-sm bg-muted/40 rounded p-3">
                  <Lightbulb className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                  <div>{q.data.recommendation}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top risks */}
          {q.data.topRisks?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> AI 標記的最高風險
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ol className="list-decimal pl-5 space-y-2 text-sm">
                  {q.data.topRisks.map((r, i) => <li key={i} className="leading-relaxed" data-testid={`risk-${i}`}>{r}</li>)}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* By category */}
          {Object.entries(q.data.byCategory).map(([cat, items]) => (
            <Card key={cat} data-testid={`category-${cat}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={CATEGORY_COLORS[cat] || "bg-gray-100 text-gray-700 border-gray-200"} variant="outline">{cat}</Badge>
                    <span className="text-sm font-normal text-muted-foreground">{items.length} 筆</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground border-b">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">單號</th>
                        <th className="text-left px-2 py-1.5 font-medium">日期</th>
                        <th className="text-right px-2 py-1.5 font-medium">金額</th>
                        <th className="text-left px-2 py-1.5 font-medium">原因 / 備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((c, i) => (
                        <tr key={i} className="border-b hover:bg-muted/20">
                          <td className="px-2 py-1.5 font-mono text-xs">{c.ref}</td>
                          <td className="px-2 py-1.5 text-xs whitespace-nowrap">{c.date}</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap font-medium">{fmtMoney(c.amount)}</td>
                          <td className="px-2 py-1.5 text-xs text-muted-foreground">{c.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}

          {q.data.totalCount === 0 && (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
              <ShieldAlert className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-50" />
              太棒了，期間內沒有偵測到任何異常紀錄。
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

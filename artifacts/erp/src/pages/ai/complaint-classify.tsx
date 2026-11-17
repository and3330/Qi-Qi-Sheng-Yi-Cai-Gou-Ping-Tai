import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageSquareWarning, Sparkles, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Classification {
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  sentiment: string;
  summary: string;
  key_points: string[];
  suggested_action: string;
  suggested_assignee_role: string;
  sla_hours: number;
  tags: string[];
  priority: string;
  needs_immediate_attention: boolean;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-green-100 text-green-800 border-green-300",
};

const SAMPLES = [
  "你們的夏令營老師上課完全不管秩序，我兒子被同學欺負還沒人處理！我已經繳了 18000，要求全額退費並書面道歉，否則申訴消保官！",
  "請問週末班還有名額嗎？想幫小朋友報名 7/15 那場，謝謝。",
  "上次上完課後發現繳費金額被多扣 2,000 元，已三次來電都沒回覆，麻煩盡快處理。",
];

export default function AiComplaintClassifyPage() {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [saveAsTicket, setSaveAsTicket] = useState(false);
  const [result, setResult] = useState<{ classification: Classification; createdTicket: any } | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/erp-api/ai/classify-complaint`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, saveAsTicket }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.createdTicket) toast({ title: "已建立工單", description: r.createdTicket.ticket_number });
    },
    onError: (e: Error) => toast({ title: "分類失敗", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-5xl" data-testid="page-ai-complaint">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquareWarning className="h-6 w-6 text-orange-500" /> AI 客訴自動分類
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          貼上客戶來信、訊息或客訴內容，AI 會分類、判斷嚴重度、給建議處理方式，並可一鍵建立工單。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">客訴內容</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例：上次的課程內容跟報名時的說明完全不同，我要求退費..."
            rows={6}
            maxLength={4000}
            data-testid="textarea-complaint"
          />
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>範例：</span>
              {SAMPLES.map((s, i) => (
                <button key={i} className="underline hover:text-foreground" onClick={() => setText(s)} data-testid={`sample-${i}`}>
                  範例 {i + 1}
                </button>
              ))}
              <span className="ml-auto">{text.length}/4000</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" checked={saveAsTicket} onChange={(e) => setSaveAsTicket(e.target.checked)} data-testid="check-save" />
                同時建立工單
              </label>
              <Button onClick={() => m.mutate()} disabled={!text.trim() || m.isPending} data-testid="button-classify">
                {m.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                AI 分類
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card data-testid="card-result">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> 分析結果
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            {result.classification.needs_immediate_attention && (
              <div className="bg-red-50 border border-red-200 rounded p-3 flex items-start gap-2 text-sm text-red-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div><b>需立即處理</b>：請優先指派 {result.classification.suggested_assignee_role}，SLA {result.classification.sla_hours} 小時內回覆。</div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" data-testid="badge-category">類別：{result.classification.category}</Badge>
              <Badge className={SEVERITY_COLOR[result.classification.severity]} variant="outline" data-testid="badge-severity">嚴重度：{result.classification.severity}</Badge>
              <Badge variant="outline">優先級：{result.classification.priority}</Badge>
              <Badge variant="outline">情緒：{result.classification.sentiment}</Badge>
              <Badge variant="outline">SLA：{result.classification.sla_hours}h</Badge>
              <Badge variant="outline">指派：{result.classification.suggested_assignee_role}</Badge>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">摘要</div>
              <div className="text-sm" data-testid="text-summary">{result.classification.summary}</div>
            </div>

            {result.classification.key_points?.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">關鍵要點</div>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {result.classification.key_points.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            <div className="bg-muted/30 rounded p-3">
              <div className="text-sm font-medium mb-1">建議處理方式</div>
              <div className="text-sm" data-testid="text-action">{result.classification.suggested_action}</div>
            </div>

            {result.classification.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.classification.tags.map((t, i) => <Badge key={i} variant="secondary" className="text-xs">#{t}</Badge>)}
              </div>
            )}

            {result.createdTicket && (
              <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800">
                ✓ 已建立工單：<b>{result.createdTicket.ticket_number}</b>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

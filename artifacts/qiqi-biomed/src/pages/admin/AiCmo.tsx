import { useMemo, useRef, useState, useEffect } from "react";
import {
  useListCmoGoals,
  useCreateCmoGoal,
  useUpdateCmoGoal,
  useDeleteCmoGoal,
  useRefreshCmoGoals,
  useListCmoReports,
  useGetCmoReport,
  useGenerateCmoReport,
  getGetCmoReportQueryKey,
  type CmoGoal,
  type CmoReport,
} from "@workspace/api-client-react";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Target,
  FileText,
  MessageSquareText,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Send,
  Bot,
  Sparkles,
  X,
} from "lucide-react";

const METRIC_OPTIONS = [
  { value: "daily_revenue", label: "訂單營收", unit: "元" },
  { value: "paid_revenue", label: "已付款營收", unit: "元" },
  { value: "orders_count", label: "訂單數", unit: "筆" },
  { value: "new_members", label: "新會員數", unit: "人" },
  { value: "published_posts", label: "已發布社群貼文", unit: "篇" },
  { value: "points_issued", label: "點數發放", unit: "點" },
  { value: "new_articles", label: "新上架文章", unit: "篇" },
];

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active: { label: "進行中", cls: "bg-gray-100 text-gray-600" },
  on_track: { label: "進度正常", cls: "bg-emerald-100 text-emerald-700" },
  at_risk: { label: "有風險", cls: "bg-amber-100 text-amber-700" },
  behind: { label: "落後", cls: "bg-red-100 text-red-700" },
  achieved: { label: "已達標", cls: "bg-blue-100 text-blue-700" },
};

const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };
const PERIOD_LABEL: Record<string, string> = {
  daily: "每日",
  weekly: "每週",
  monthly: "每月",
  quarterly: "每季",
};

function todayStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

type GoalForm = {
  metric: string;
  label: string;
  targetValue: string;
  unit: string;
  period: string;
  priority: string;
  startDate: string;
  endDate: string;
};

function emptyForm(): GoalForm {
  return {
    metric: "daily_revenue",
    label: "",
    targetValue: "",
    unit: "元",
    period: "monthly",
    priority: "medium",
    startDate: todayStr(),
    endDate: todayStr(29),
  };
}

// ===== KPI 分頁 =====
function GoalsTab() {
  const { toast } = useToast();
  const { data: goals, refetch } = useListCmoGoals();
  const createGoal = useCreateCmoGoal();
  const updateGoal = useUpdateCmoGoal();
  const deleteGoal = useDeleteCmoGoal();
  const refreshGoals = useRefreshCmoGoals();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalForm>(emptyForm());

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };
  const openEdit = (g: CmoGoal) => {
    setEditingId(g.id);
    setForm({
      metric: g.metric,
      label: g.label,
      targetValue: g.targetValue,
      unit: g.unit,
      period: g.period,
      priority: g.priority,
      startDate: g.startDate,
      endDate: g.endDate,
    });
    setShowForm(true);
  };

  const submit = async () => {
    const target = Number(form.targetValue);
    if (!form.label.trim() || !Number.isFinite(target) || target <= 0) {
      toast({ title: "請填寫名稱與正數目標值", variant: "destructive" });
      return;
    }
    const payload = {
      metric: form.metric,
      label: form.label.trim(),
      targetValue: target,
      unit: form.unit,
      period: form.period,
      priority: form.priority,
      startDate: form.startDate,
      endDate: form.endDate,
    };
    try {
      if (editingId) {
        await updateGoal.mutateAsync({ id: editingId, data: payload });
      } else {
        await createGoal.mutateAsync({ data: payload });
      }
      setShowForm(false);
      await refetch();
      toast({ title: editingId ? "KPI 已更新" : "KPI 已建立" });
    } catch (e: any) {
      toast({ title: "儲存失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
    }
  };

  const handleDelete = async (g: CmoGoal) => {
    if (!window.confirm(`確定刪除 KPI「${g.label}」？`)) return;
    try {
      await deleteGoal.mutateAsync({ id: g.id });
      await refetch();
      toast({ title: "KPI 已刪除" });
    } catch (e: any) {
      toast({ title: "刪除失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshGoals.mutateAsync();
      await refetch();
      toast({ title: "KPI 進度已重算" });
    } catch (e: any) {
      toast({ title: "重算失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">KPI 目標</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshGoals.isPending} data-testid="button-cmo-refresh-goals">
            {refreshGoals.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            重算進度
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="button-cmo-create-goal">
            <Plus size={14} /> 新增 KPI
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">{editingId ? "編輯 KPI" : "新增 KPI"}</p>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">指標</span>
              <select
                className="w-full h-9 rounded-md border px-2 text-sm bg-white"
                value={form.metric}
                onChange={(e) => {
                  const opt = METRIC_OPTIONS.find((o) => o.value === e.target.value);
                  setForm((f) => ({ ...f, metric: e.target.value, unit: opt?.unit ?? f.unit }));
                }}
                data-testid="select-cmo-goal-metric"
              >
                {METRIC_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">顯示名稱</span>
              <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="例：本月營收目標" data-testid="input-cmo-goal-label" />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">目標值（{form.unit}）</span>
              <Input type="number" value={form.targetValue} onChange={(e) => setForm((f) => ({ ...f, targetValue: e.target.value }))} data-testid="input-cmo-goal-target" />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">期間</span>
              <select className="w-full h-9 rounded-md border px-2 text-sm bg-white" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}>
                {Object.entries(PERIOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">優先級</span>
              <select className="w-full h-9 rounded-md border px-2 text-sm bg-white" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">開始日</span>
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} data-testid="input-cmo-goal-start" />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">結束日</span>
                <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} data-testid="input-cmo-goal-end" />
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>取消</Button>
            <Button size="sm" onClick={submit} disabled={createGoal.isPending || updateGoal.isPending} data-testid="button-cmo-save-goal">
              {(createGoal.isPending || updateGoal.isPending) && <Loader2 size={14} className="animate-spin" />}
              儲存
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {goals?.map((g) => {
          const target = Number(g.targetValue) || 0;
          const current = Number(g.currentValue) || 0;
          const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
          const st = STATUS_STYLE[g.status] ?? STATUS_STYLE.active;
          return (
            <div key={g.id} className="rounded-xl border bg-white p-4 space-y-2" data-testid={`card-cmo-goal-${g.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{g.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {METRIC_OPTIONS.find((o) => o.value === g.metric)?.label ?? g.metric} · {PERIOD_LABEL[g.period] ?? g.period} · 優先級{PRIORITY_LABEL[g.priority] ?? g.priority}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-bold">{current.toLocaleString()}{g.unit}</span>
                  <span className="text-xs text-muted-foreground">目標 {target.toLocaleString()}{g.unit}（{pct}%）</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pct >= 100 ? "bg-blue-500" : g.status === "behind" ? "bg-red-400" : g.status === "at_risk" ? "bg-amber-400" : "bg-emerald-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{g.startDate} ~ {g.endDate}</span>
                <span className="flex gap-1">
                  <button className="p-1 hover:text-foreground" onClick={() => openEdit(g)} data-testid={`button-cmo-edit-goal-${g.id}`}><Pencil size={14} /></button>
                  <button className="p-1 hover:text-red-600" onClick={() => handleDelete(g)} data-testid={`button-cmo-delete-goal-${g.id}`}><Trash2 size={14} /></button>
                </span>
              </div>
            </div>
          );
        })}
        {!goals?.length && (
          <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            尚未設定 KPI 目標，點「新增 KPI」開始。
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 報告分頁 =====
function ReportsTab() {
  const { toast } = useToast();
  const { data: reports, refetch } = useListCmoReports();
  const generate = useGenerateCmoReport();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: detail } = useGetCmoReport(activeId!, {
    query: { enabled: !!activeId, queryKey: getGetCmoReportQueryKey(activeId!) },
  });

  const handleGenerate = async () => {
    try {
      const r = await generate.mutateAsync();
      await refetch();
      setActiveId(r.id);
      toast({ title: "報告已生成" });
    } catch (e: any) {
      toast({ title: "生成失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
    }
  };

  const anomalies: Array<{ severity: string; message: string }> = useMemo(() => {
    const snap = detail?.kpiSnapshot as any;
    return Array.isArray(snap?.anomalies) ? snap.anomalies : [];
  }, [detail]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        <Button className="w-full" size="sm" onClick={handleGenerate} disabled={generate.isPending} data-testid="button-cmo-generate-report">
          {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generate.isPending ? "生成中（約需數十秒）..." : "生成即時報告（今日截至目前）"}
        </Button>
        <div className="rounded-xl border bg-white divide-y max-h-[60vh] overflow-y-auto">
          {reports?.map((r: CmoReport) => (
            <button
              key={r.id}
              onClick={() => setActiveId(r.id)}
              className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 ${activeId === r.id ? "bg-primary/5 border-l-2 border-primary" : ""}`}
              data-testid={`button-cmo-report-${r.id}`}
            >
              <p className="font-medium">{r.reportDate}</p>
              <p className="text-xs text-muted-foreground">{r.reportType === "manual" ? "即時（截至生成時）" : "每日自動（完整日）"} · {new Date(r.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</p>
            </button>
          ))}
          {!reports?.length && <div className="p-4 text-center text-xs text-muted-foreground">尚無報告</div>}
        </div>
      </div>
      <div className="rounded-xl border bg-white p-5 min-h-[300px]">
        {!activeId ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm py-16">
            <FileText size={36} className="mb-2 opacity-40" />
            選擇左側報告查看詳情
          </div>
        ) : !detail ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> 載入中...</div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="font-bold">{detail.reportDate} 營運報告</h3>
              <p className="text-xs text-muted-foreground">{detail.reportType === "manual" ? "即時報告（數據截至生成時間）" : "每日自動報告（前一日完整數據對比）"}</p>
            </div>
            {anomalies.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                {anomalies.map((a, i) => (
                  <p key={i} className={`text-xs ${a.severity === "critical" ? "text-red-700 font-medium" : "text-amber-800"}`}>⚠ {a.message}</p>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">摘要</p>
              <div className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-cmo-report-summary">{detail.summary}</div>
            </div>
            {detail.recommendations && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">AI 建議</p>
                <div className="whitespace-pre-wrap text-sm leading-relaxed rounded-lg bg-blue-50/50 border border-blue-100 p-3">{detail.recommendations}</div>
              </div>
            )}
            {Array.isArray(detail.goalProgress) && detail.goalProgress.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">KPI 進度</p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left">KPI</th>
                        <th className="px-3 py-2 text-right">目前</th>
                        <th className="px-3 py-2 text-right">目標</th>
                        <th className="px-3 py-2 text-left">狀態</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(detail.goalProgress as any[]).map((g, i) => {
                        const st = STATUS_STYLE[g.status] ?? STATUS_STYLE.active;
                        return (
                          <tr key={i}>
                            <td className="px-3 py-2">{g.label}</td>
                            <td className="px-3 py-2 text-right">{Number(g.currentValue).toLocaleString()}{g.unit}</td>
                            <td className="px-3 py-2 text-right">{Number(g.targetValue).toLocaleString()}{g.unit}</td>
                            <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] ${st.cls}`}>{st.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 策略對話分頁（SSE 串流） =====
type ChatMsg = { role: "user" | "assistant"; content: string };

function ChatTab() {
  const { toast } = useToast();
  const [messagesState, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesState]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const history = messagesState;
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const res = await fetch("/api/admin/cmo/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotError: string | null = null;
      const appendDelta = (t: string) =>
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + t };
          return copy;
        });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const eventLine = evt.split("\n").find((l) => l.startsWith("event: "));
          const dataLine = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          const type = eventLine.slice(7).trim();
          try {
            const data = JSON.parse(dataLine.slice(6));
            if (type === "delta" && typeof data.text === "string") appendDelta(data.text);
            else if (type === "error") gotError = data.error || "AI 回覆失敗";
          } catch {
            /* skip malformed */
          }
        }
      }
      if (gotError) throw new Error(gotError);
    } catch (e: any) {
      toast({ title: "對話失敗", description: e?.message || "請稍後再試", variant: "destructive" });
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.content) copy.pop();
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border bg-white h-[calc(100vh-230px)] overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {!messagesState.length && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm">
            <Bot size={40} className="mb-3 opacity-40" />
            <p>向 AI CMO 詢問行銷與營運策略</p>
            <p className="text-xs mt-1">例：「本週營收與 KPI 進度如何？該加強哪些行銷動作？」</p>
          </div>
        )}
        {messagesState.map((m, i) => (
          <div key={i} className={`flex gap-3 max-w-3xl ${m.role === "user" ? "ml-auto flex-row-reverse" : ""}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-violet-100 text-violet-600"}`}>
              {m.role === "user" ? "我" : <Bot size={16} />}
            </div>
            <div className={`px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${m.role === "user" ? "bg-primary text-white rounded-tr-sm" : "bg-gray-100 rounded-tl-sm"}`}>
              {m.content || (streaming && i === messagesState.length - 1 ? <Loader2 size={14} className="animate-spin" /> : "")}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="border-t p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="輸入策略問題，例如：新會員成長趨勢如何？"
          disabled={streaming}
          data-testid="input-cmo-chat"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || streaming} data-testid="button-cmo-chat-send">
          {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </form>
    </div>
  );
}

export default function AdminAiCmoPage() {
  const [tab, setTab] = useState<"goals" | "reports" | "chat">("goals");
  const tabs = [
    { key: "goals" as const, label: "KPI 目標", icon: Target },
    { key: "reports" as const, label: "每日報告", icon: FileText },
    { key: "chat" as const, label: "策略對話", icon: MessageSquareText },
  ];
  return (
    <AdminLayout title="AI CMO 智慧中控台">
      <div className="mb-4 flex gap-1 rounded-xl bg-muted p-1 w-fit">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-cmo-${t.key}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === "goals" && <GoalsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "chat" && <ChatTab />}
    </AdminLayout>
  );
}

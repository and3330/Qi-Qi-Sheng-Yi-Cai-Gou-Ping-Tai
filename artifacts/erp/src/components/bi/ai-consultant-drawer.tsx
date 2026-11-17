import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { askBiConsultant, BiApiError, type BiPage, type BiRange } from "@/lib/bi-api";

interface Msg { role: "user" | "assistant" | "system"; text: string }

const SUGGESTIONS: Record<BiPage, string[]> = {
  executive: ["本期損益主要由哪些項目驅動？", "營運資本天數有哪些需要注意？", "哪個 BU 的貢獻最值得檢視？"],
  sales: ["銷退率與收款狀況代表什麼？", "客戶集中度風險高嗎？", "哪些客戶屬於沉睡風險，應如何跟進？"],
  inventory: ["哪些料件有缺貨或滯銷風險？", "庫齡分布需要處理嗎？", "供應商準時率有何異常？"],
  hr: ["人事成本與營收的關係如何？", "加班與遲到集中在哪些部門？", "人均產值的變化趨勢如何解讀？"],
};

export function AIConsultantDrawer({ open, onOpenChange, page, range, pageTitle }: {
  open: boolean; onOpenChange: (o: boolean) => void; page: BiPage; range: BiRange; pageTitle: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); }, [page, range.startDate, range.endDate]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (q: string) => {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await askBiConsultant(page, range, question);
      setMessages((m) => [...m, { role: "assistant", text: res.reply }]);
    } catch (e) {
      const err = e as BiApiError;
      const text = err.code === "ai_unavailable" ? "AI 服務目前未設定，無法分析（本次未扣點）。"
        : err.code === "credits_required" || err.status === 402 ? "AI 點數不足，請至「訂閱與 AI 點數」購買後再試。"
        : err.message || "AI 服務暫時無法回應。";
      setMessages((m) => [...m, { role: "system", text }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg [&>button]:hidden">
        <SheetHeader className="border-b p-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="flex items-center gap-2 text-base"><Sparkles size={16} className="text-primary" /> AI 經營顧問 · {pageTitle}</SheetTitle>
              <SheetDescription className="mt-1 text-xs">
                伺服器依您的權限重新計算 {range.startDate} 至 {range.endDate} 的本頁指標後交給 Gemini 分析。每次提問扣 1 點 AI 點數（豁免租戶不扣）。
              </SheetDescription>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="關閉" className="rounded-md p-1 hover:bg-muted"><X size={16} /></button>
          </div>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">建議問題</p>
              {SUGGESTIONS[page].map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-lg border px-3 py-2 text-left text-xs hover:border-primary hover:bg-primary/5">{s}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" : m.role === "system" ? "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "mr-4 whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 text-sm leading-relaxed"}>
              {m.text}
            </div>
          ))}
          {busy && <div className="mr-4 animate-pulse rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">正在依最新數據分析…</div>}
          <div ref={endRef} />
        </div>
        <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} placeholder="針對本頁數據提問…" className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
          <button type="submit" disabled={busy || input.trim().length < 2} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Send size={13} /> 送出</button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

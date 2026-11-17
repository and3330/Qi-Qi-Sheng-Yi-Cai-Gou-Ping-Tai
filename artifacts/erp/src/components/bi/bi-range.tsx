import { useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";
import type { BiRange } from "@/lib/bi-api";

const KEY = "bi-range-v2";
type Preset = "month" | "lastMonth" | "q3" | "ytd" | "lastYear" | "pickMonth" | "custom";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthEnd(y: number, m0: number): Date { return new Date(y, m0 + 1, 0); }

export function presetRange(p: Exclude<Preset, "pickMonth" | "custom">, today = new Date()): BiRange {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (p) {
    case "month": return { startDate: iso(new Date(y, m, 1)), endDate: iso(today) };
    case "lastMonth": return { startDate: iso(new Date(y, m - 1, 1)), endDate: iso(monthEnd(y, m - 1)) };
    case "q3": return { startDate: iso(new Date(y, m - 2, 1)), endDate: iso(today) };
    case "ytd": return { startDate: iso(new Date(y, 0, 1)), endDate: iso(today) };
    case "lastYear": return { startDate: `${y - 1}-01-01`, endDate: `${y - 1}-12-31` };
  }
}

function load(): { preset: Preset; range: BiRange } {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v?.range?.startDate && v?.range?.endDate) return v;
    }
  } catch { /* ignore */ }
  return { preset: "ytd", range: presetRange("ytd") };
}

/** BI 共用期間：跨五頁保留在 sessionStorage，切換頁面不重設 */
export function useBiRange() {
  const [state, setState] = useState(load);
  useEffect(() => { sessionStorage.setItem(KEY, JSON.stringify(state)); }, [state]);
  return { ...state, set: (preset: Preset, range: BiRange) => setState({ preset, range }) };
}

const PRESETS: Array<{ id: Exclude<Preset, "pickMonth" | "custom">; label: string }> = [
  { id: "month", label: "本月" },
  { id: "lastMonth", label: "上月" },
  { id: "q3", label: "近三個月" },
  { id: "ytd", label: "今年迄今" },
  { id: "lastYear", label: "去年" },
];

export function BiRangeBar({ preset, range, onChange }: { preset: Preset; range: BiRange; onChange: (p: Preset, r: BiRange) => void }) {
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(range); }, [range.startDate, range.endDate]);

  const applyCustom = () => {
    if (!draft.startDate || !draft.endDate) { setError("請選擇起訖日期"); return; }
    if (draft.startDate > draft.endDate) { setError("起始日期不可晚於結束日期"); return; }
    setError(null);
    onChange("custom", draft);
  };
  const pickMonth = (v: string) => {
    if (!/^\d{4}-\d{2}$/.test(v)) return;
    const [y, m] = v.split("-").map(Number);
    onChange("pickMonth", { startDate: `${v}-01`, endDate: iso(monthEnd(y, m - 1)) });
  };

  return (
    <div className="bi-panel flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
          <CalendarRange size={15} className="text-primary" /> 分析期間
        </span>
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id, presetRange(p.id))}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${preset === p.id ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          指定月份
          <input
            type="month"
            aria-label="指定月份"
            value={preset === "pickMonth" ? range.startDate.slice(0, 7) : ""}
            onChange={(e) => pickMonth(e.target.value)}
            className={`h-8 rounded-md border bg-background px-2 text-xs ${preset === "pickMonth" ? "border-primary text-primary" : "border-input"}`}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input type="date" aria-label="起始日期" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className="h-8 rounded-md border border-input bg-background px-2" />
        <span className="text-muted-foreground">至</span>
        <input type="date" aria-label="結束日期" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className="h-8 rounded-md border border-input bg-background px-2" />
        <button type="button" onClick={applyCustom} className="h-8 rounded-md bg-primary px-3 font-semibold text-primary-foreground hover:opacity-90">
          套用自訂區間
        </button>
        {error && <span className="w-full text-destructive lg:w-auto">{error}</span>}
      </div>
    </div>
  );
}

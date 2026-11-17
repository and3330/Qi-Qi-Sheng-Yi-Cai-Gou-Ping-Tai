/** 單據列表日期快速篩選：一鍵帶入近三個月、半年、一年（到今天為止） */
const PRESETS = [
  { label: "三個月", months: 3 },
  { label: "半年", months: 6 },
  { label: "一年", months: 12 },
];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function presetRange(months: number, today = new Date()): { from: string; to: string } {
  const from = new Date(today.getFullYear(), today.getMonth() - months, today.getDate() + 1);
  return { from: ymd(from), to: ymd(today) };
}

export function DateRangePresets({ from, to, onChange }: {
  from: string; to: string; onChange: (range: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex gap-1 p-1 bg-muted rounded-lg h-10 items-center" role="group" aria-label="日期快速篩選">
      {PRESETS.map((p) => {
        const range = presetRange(p.months);
        const active = range.from === from && range.to === to;
        return (
          <button
            key={p.months}
            type="button"
            aria-pressed={active}
            className={`px-3 h-8 rounded-md text-sm font-medium transition-colors ${active ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => onChange(range)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

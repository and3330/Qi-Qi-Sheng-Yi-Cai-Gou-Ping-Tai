import type { ReactNode } from "react";
import { AlertTriangle, Info, RefreshCw, Sparkles, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { BiApiError, BiNote, Metric } from "@/lib/bi-api";

export const BI_COLORS = {
  primary: "hsl(221 83% 53%)",
  teal: "hsl(173 58% 39%)",
  amber: "hsl(35 92% 50%)",
  rose: "hsl(350 72% 52%)",
  slate: "hsl(215 16% 47%)",
  violet: "hsl(262 52% 55%)",
};

const twd = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `NT$${twd.format(Math.round(v))}`;
}
export function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(a >= 1e6 ? 0 : 1)}萬`;
  return twd.format(Math.round(v));
}
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

export function BiHeader({ title, subtitle, computedAt, fetching, onRefresh, onAi, icon }: {
  title: string; subtitle: string; computedAt?: string; fetching: boolean; onRefresh: () => void; onAi?: () => void; icon: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        {computedAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            即時查詢目前帳務資料，計算於 {new Date(computedAt).toLocaleString("zh-TW", { hour12: false })}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onRefresh} disabled={fetching} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-60">
          <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
          {fetching ? "重新計算中" : "重新計算"}
        </button>
        {onAi && (
          <button type="button" onClick={onAi} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90">
            <Sparkles size={14} /> AI 顧問
          </button>
        )}
      </div>
    </div>
  );
}

export function MetricCard({ label, metric, format, hint, tone = "default" }: {
  label: string; metric: Metric; format: (v: number) => string; hint?: string; tone?: "default" | "good" | "bad";
}) {
  const unavailable = metric.value == null;
  const color = tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "";
  return (
    <div className="bi-panel flex min-h-[112px] flex-col justify-between p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {unavailable ? (
        <div>
          <div className="text-lg font-semibold text-muted-foreground">無法計算</div>
          <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{metric.reason}</div>
        </div>
      ) : (
        <div>
          <div className={`bi-figure text-2xl font-bold ${color}`}>{format(metric.value as number)}</div>
          {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
        </div>
      )}
    </div>
  );
}

export function Panel({ title, description, children, className = "" }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`bi-panel p-4 ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function EmptyState({ reason }: { reason: string }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-6 text-center">
      <Info size={18} className="text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

export function BiSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[320px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    </div>
  );
}

export function BiError({ error, onRetry }: { error: BiApiError | null; onRetry: () => void }) {
  const forbidden = error?.status === 403;
  return (
    <div className="bi-panel flex flex-col items-center gap-3 p-10 text-center">
      {forbidden ? <ShieldAlert className="text-amber-600" /> : <AlertTriangle className="text-destructive" />}
      <div className="text-sm font-semibold">{forbidden ? "您的角色無權檢視此頁數據" : "指標計算失敗"}</div>
      <p className="max-w-md text-xs text-muted-foreground">
        {forbidden ? "財務指標與數據健康檢查限老闆、系統管理員、財務長與會計；人力指標限老闆、系統管理員、人資與財務長。" : error?.message}
      </p>
      {!forbidden && (
        <button type="button" onClick={onRetry} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">重試</button>
      )}
    </div>
  );
}

export function NotesPanel({ notes }: { notes: BiNote[] }) {
  if (!notes.length) return null;
  return (
    <details className="bi-panel p-4 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-semibold text-foreground/80">計算口徑與資料限制</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {notes.map((n, i) => <li key={i}>{n.text}</li>)}
      </ul>
    </details>
  );
}

export const tooltipStyle = {
  contentStyle: { borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: 12 },
  labelStyle: { fontWeight: 600 },
};

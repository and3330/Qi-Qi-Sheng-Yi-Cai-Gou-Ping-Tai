import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { call } from "@/lib/call";
import { cn } from "@/lib/utils";
import { DocWindow } from "@/components/shared/doc-window";
import { JournalEntryDialog } from "@/components/accounting/journal-entry-dialog";

/**
 * 點數字看明細（全系統共用，老闆 2026-11-17）：報表上任何一個從分錄算出來的數字，
 * 點下去都開這個視窗，列出算進這個數字的每一筆分錄；再點一筆就開分錄視窗，
 * 分錄視窗裡的「關聯單據」可以一路連回原單。
 *
 * 報表頁只要做兩件事：
 *   1. 數字用 <DrillAmount onClick={() => setDrill({...})}> 包起來
 *   2. 頁面最下面放一個 <AccountDrillDialog target={drill} onClose={() => setDrill(null)} />
 */
export interface DrillTarget {
  /** 視窗標題，例如「營業收入」「4111 商品收入」 */
  title: string;
  /** 看哪些科目；上層科目會自動帶出底下全部科目 */
  accountIds?: number[];
  /** 不指定科目、改用科目類別（Income、Expense、Asset、Liability、Equity） */
  accountTypes?: string[];
  startDate?: string | null;
  endDate?: string | null;
  projectId?: number | string | null;
  departmentId?: number | string | null;
  /** 部門只認分錄自己掛的部門（不含「專案屬於這個部門」） */
  exactDimension?: boolean;
  /** 不含內部轉撥 */
  excludeInternal?: boolean;
  /** 只看這個對象（客戶、供應商…） */
  party?: string | null;
  /** 補充說明，顯示在標題下面（例如「專案：某某」） */
  note?: string;
}

interface Row { date: string; entryId: number; reference: string | null; party: string | null; summary: string; debit: number; credit: number; department: string | null; project: string | null }
interface Section { account: { id: number; accountNumber: string; accountName: string; accountType: string }; openingBalance: number; closingBalance: number; totalDebit: number; totalCredit: number; rows: Row[] }

const MAX_ROWS = 400;
const fmt = (n: number) => (Math.abs(n) < 0.005 ? "" : (Math.round(n * 100) / 100).toLocaleString());
const natural = (type: string) => type === "Asset" || type === "Expense";

function queryOf(t: DrillTarget): string {
  const p = new URLSearchParams();
  if (t.accountIds?.length) p.set("accountIds", t.accountIds.join(","));
  else p.set("all", "1");
  if (t.accountTypes?.length) p.set("accountTypes", t.accountTypes.join(","));
  if (t.startDate) p.set("startDate", t.startDate);
  if (t.endDate) p.set("endDate", t.endDate);
  if (t.projectId) p.set("projectId", String(t.projectId));
  if (t.departmentId) p.set("departmentId", String(t.departmentId));
  if (t.exactDimension) p.set("exactDimension", "1");
  if (t.excludeInternal) p.set("excludeInternal", "1");
  if (t.party) p.set("party", t.party);
  return p.toString();
}

export function AccountDrillDialog({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  const [entryId, setEntryId] = useState<number | null>(null);
  const query = target ? queryOf(target) : "";
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["/reports/general-ledger/multi", query],
    queryFn: () => call<{ accounts: Section[] }>(`reports/general-ledger/multi?${query}`),
    enabled: !!target,
    staleTime: 15_000,
  });

  const sections = useMemo(() => (data?.accounts ?? []).filter(s => s.rows.length > 0 || Math.abs(s.openingBalance) > 0.005), [data]);
  const totals = useMemo(() => {
    let debit = 0, credit = 0, count = 0, net = 0, opening = 0;
    for (const s of sections) {
      debit += s.totalDebit; credit += s.totalCredit; count += s.rows.length;
      net += natural(s.account.accountType) ? s.totalDebit - s.totalCredit : s.totalCredit - s.totalDebit;
      opening += s.openingBalance;
    }
    return { debit, credit, count, net, opening };
  }, [sections]);

  // 行數很多時只列最近的幾百筆，完整的到總分類帳看
  let budget = MAX_ROWS;
  const shown = sections.map(s => {
    const rows = s.rows.slice(Math.max(0, s.rows.length - budget));
    budget = Math.max(0, budget - rows.length);
    return { ...s, shownRows: rows };
  });
  const hidden = totals.count - shown.reduce((n, s) => n + s.shownRows.length, 0);

  const period = target ? (target.startDate ? `${target.startDate} ～ ${target.endDate ?? "今天"}` : target.endDate ? `到 ${target.endDate} 為止` : "全部期間") : "";
  const ledgerHref = target && target.accountIds?.length ? `/reports/general-ledger?${new URLSearchParams({
    accountIds: target.accountIds.join(","), ...(target.startDate ? { startDate: target.startDate } : {}), ...(target.endDate ? { endDate: target.endDate } : {}),
    ...(target.projectId ? { projectId: String(target.projectId) } : {}), ...(target.departmentId ? { departmentId: String(target.departmentId) } : {}),
  })}` : null;

  return (
    <>
      <DocWindow
        open={!!target} onClose={onClose} wide name="明細" layoutKey="分錄明細" number={target?.title}
        description={target ? <>{period}{target.party ? `・對象：${target.party}` : ""}{target.note ? `・${target.note}` : ""}。點任何一筆可以看那張分錄和它的原單。</> : undefined}
        footer={<>
          {ledgerHref && <Button asChild variant="outline" className="mr-auto"><Link href={ledgerHref} onClick={onClose}>在總分類帳開啟<ExternalLink className="ml-1 h-3.5 w-3.5" /></Link></Button>}
          <Button variant="outline" onClick={onClose}>關閉</Button>
        </>}
      >
        {isLoading ? <p className="text-muted-foreground">讀取中…</p>
          : isError ? <p className="text-destructive">{error instanceof Error ? error.message : "明細讀取失敗"}</p>
          : sections.length === 0 ? <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground">這段期間沒有分錄。</p>
          : (
            <div className="space-y-4" data-testid="account-drill">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="筆數" value={`${totals.count.toLocaleString()} 筆`} />
                <Stat label="借方合計" value={fmt(totals.debit) || "0"} />
                <Stat label="貸方合計" value={fmt(totals.credit) || "0"} />
                <Stat label={target?.startDate ? "本期淨額" : "餘額"} value={(Math.round((target?.startDate ? totals.net : totals.net + totals.opening) * 100) / 100).toLocaleString()} strong />
              </div>
              {hidden > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">筆數很多，下面只列出最近的 {MAX_ROWS} 筆（上面的合計是全部 {totals.count.toLocaleString()} 筆）。{ledgerHref ? "要看完整內容請按左下角「在總分類帳開啟」。" : ""}</p>}
              {shown.map(s => (
                <div key={s.account.id}>
                  {(shown.length > 1 || !target?.startDate) && (
                    <p className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{s.account.accountNumber} {s.account.accountName}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {!target?.startDate && Math.abs(s.openingBalance) > 0.005 ? `開帳 ${fmt(s.openingBalance)}・` : ""}{s.rows.length} 筆・{target?.startDate ? "淨額" : "餘額"} {(Math.round((target?.startDate ? (natural(s.account.accountType) ? s.totalDebit - s.totalCredit : s.totalCredit - s.totalDebit) : s.closingBalance) * 100) / 100).toLocaleString()}
                      </span>
                    </p>
                  )}
                  {s.shownRows.length > 0 && (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-1.5 text-left font-medium">日期</th>
                            <th className="px-3 py-1.5 text-left font-medium">單號</th>
                            <th className="px-3 py-1.5 text-left font-medium">對象</th>
                            <th className="px-3 py-1.5 text-left font-medium">摘要</th>
                            <th className="px-3 py-1.5 text-right font-medium">借方</th>
                            <th className="px-3 py-1.5 text-right font-medium">貸方</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.shownRows.map((r, i) => (
                            <tr key={`${r.entryId}-${i}`} className="cursor-pointer border-t hover:bg-muted/50" onClick={() => setEntryId(r.entryId)} data-testid={`drill-row-${r.entryId}`}>
                              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{r.date}</td>
                              <td className="px-3 py-1.5 font-medium text-primary">{r.reference}</td>
                              <td className="px-3 py-1.5">{r.party}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{r.summary}{r.project ? <span className="ml-1 text-xs">（{r.project}）</span> : null}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.debit)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.credit)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </DocWindow>
      {entryId !== null && <JournalEntryDialog entryId={entryId} onClose={() => setEntryId(null)} />}
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums", strong ? "text-base font-semibold" : "font-medium")}>{value}</p>
    </div>
  );
}

/** 報表上可以點的數字：長得跟原本的數字一樣，滑過去有底線，點了開明細 */
export function DrillAmount({ children, onClick, className, title = "點一下看明細" }: { children: ReactNode; onClick: () => void; className?: string; title?: string }) {
  return (
    <button type="button" title={title} onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn("cursor-pointer rounded-sm tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:text-primary hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:no-underline", className)}>
      {children}
    </button>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BookOpenCheck, CalendarCheck2 } from "lucide-react";

interface Account { id: number; accountNumber: string; accountName: string; accountType: string; isGroup: boolean }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/erp-api/${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error || `HTTP ${response.status}`), { body: json });
  return json as T;
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString()}`;
const TYPE_LABEL: Record<string, string> = { Asset: "資產", Liability: "負債", Equity: "權益" };

/** 開帳：一次輸入各科目的期初餘額，系統產生一張開帳分錄 */
export function OpeningBalanceButton({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(`${new Date().getFullYear() - 1}-12-31`);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [keyword, setKeyword] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: accounts = [] } = useQuery({ queryKey: ["/accounts"], queryFn: () => call<Account[]>("accounts"), enabled: open });
  const { data: opening } = useQuery({ queryKey: ["/journal-entries/opening"], queryFn: () => call<{ entry: { entryNumber: string; entryDate: string; totalDebit: number } | null }>("journal-entries/opening"), enabled: open });

  const leaves = useMemo(() => accounts.filter(a => !a.isGroup && TYPE_LABEL[a.accountType]), [accounts]);
  const shown = leaves.filter(a => {
    const q = keyword.trim();
    return q ? (a.accountNumber + a.accountName).includes(q) : true;
  });
  const totals = useMemo(() => {
    let debit = 0, credit = 0;
    for (const a of leaves) {
      const n = Number(amounts[a.id]);
      if (!Number.isFinite(n) || n === 0) continue;
      const onDebit = a.accountType === "Asset" ? n > 0 : n < 0;
      if (onDebit) debit += Math.abs(n); else credit += Math.abs(n);
    }
    return { debit, credit, difference: Math.round((debit - credit) * 100) / 100 };
  }, [amounts, leaves]);
  const filled = leaves.filter(a => Number(amounts[a.id])).length;

  const save = async (balanceToRetainedEarnings = false) => {
    setSaving(true);
    try {
      const balances = leaves.map(a => ({ accountId: a.id, amount: Number(amounts[a.id]) || 0 })).filter(b => b.amount !== 0);
      const created = await call<{ entryNumber: string }>("journal-entries/opening", { method: "POST", body: JSON.stringify({ date, balances, balanceToRetainedEarnings }) });
      toast({ title: "開帳完成", description: `已建立開帳分錄 ${created.entryNumber}` });
      setOpen(false); setAmounts({});
      queryClient.invalidateQueries({ queryKey: ["/journal-entries/opening"] });
      queryClient.invalidateQueries({ queryKey: ["/accounts"] });
      onDone?.();
    } catch (e: any) {
      if (e?.body?.needsConfirm && window.confirm(`${e.message}\n\n要把差額 ${money(Math.abs(e.body.difference))} 記到「累積盈虧」嗎？\n（這代表開帳日以前累積下來的盈虧）`)) {
        setSaving(false);
        return save(true);
      }
      toast({ title: "開帳失敗", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><BookOpenCheck size={16} className="mr-1" />期初餘額</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>輸入期初餘額（開帳）</DialogTitle></DialogHeader>
          {opening?.entry ? (
            <div className="space-y-3 text-sm">
              <p>已經開過帳了：開帳分錄 <span className="font-mono">{opening.entry.entryNumber}</span>（{opening.entry.entryDate}，合計 {money(opening.entry.totalDebit)}）。</p>
              <p className="text-muted-foreground">要重新輸入，請先在日記帳找到這張分錄按「沖銷」，再回來這裡。</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">把開始使用系統前，各科目帳上的餘額填進來。資產填正數（備抵、累計折舊這類抵減科目填負數），負債與權益也填正數。只需要填有餘額的科目。</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>開帳日期</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /><p className="text-xs text-muted-foreground">通常是開始用系統的前一天</p></div>
                <div className="space-y-1.5"><Label>找科目</Label><Input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="輸入編號或名稱" /></div>
              </div>
              <div className="border rounded-lg max-h-[42dvh] overflow-y-auto divide-y">
                {shown.map(a => (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{a.accountNumber}</span>{a.accountName}
                      <span className="ml-2 text-xs text-muted-foreground">{TYPE_LABEL[a.accountType]}</span>
                    </div>
                    <Input type="number" inputMode="decimal" className="w-32 h-9 text-right" placeholder="0" value={amounts[a.id] ?? ""} onChange={e => setAmounts(prev => ({ ...prev, [a.id]: e.target.value }))} />
                  </div>
                ))}
                {shown.length === 0 && <div className="p-4 text-sm text-center text-muted-foreground">找不到科目</div>}
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-sm grid grid-cols-3 gap-2 text-center">
                <div><div className="text-xs text-muted-foreground">借方合計</div><div className="font-semibold">{money(totals.debit)}</div></div>
                <div><div className="text-xs text-muted-foreground">貸方合計</div><div className="font-semibold">{money(totals.credit)}</div></div>
                <div><div className="text-xs text-muted-foreground">差額</div><div className={`font-semibold ${totals.difference !== 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>{money(Math.abs(totals.difference))}</div></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{opening?.entry ? "關閉" : "取消"}</Button>
            {!opening?.entry && <Button onClick={() => save(false)} disabled={saving || filled === 0 || !date}>{saving ? "處理中…" : `建立開帳分錄（${filled} 個科目）`}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface YearSummary { year: number; entryCount: number; unbalancedCount: number; totalIncome: number; totalExpense: number; netProfit: number; lockDate: string | null; closed: boolean }

/** 年度結帳：看這一年的損益，確認後把關帳日設到年底 */
export function YearCloseButton({ onDone }: { onDone?: (lockDate: string) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [saving, setSaving] = useState(false);
  const { data, refetch, isFetching } = useQuery({ queryKey: ["/journal-entries/year-close", year], queryFn: () => call<YearSummary>(`journal-entries/year-close?year=${year}`), enabled: open });

  const close = async () => {
    if (!window.confirm(`確定要結 ${year} 年的帳嗎？\n\n結帳後 ${year}-12-31（含）以前的傳票、發票、分錄都不能再新增或修改。`)) return;
    setSaving(true);
    try {
      const result = await call<YearSummary>("journal-entries/year-close", { method: "POST", body: JSON.stringify({ year }) });
      toast({ title: `${year} 年已結帳`, description: `關帳日設為 ${result.lockDate}` });
      onDone?.(result.lockDate || "");
      refetch();
    } catch (e: any) {
      toast({ title: "結帳失敗", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><CalendarCheck2 size={16} className="mr-1" />年度結帳</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>年度結帳</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>年度</Label><Input type="number" inputMode="numeric" value={year} onChange={e => setYear(Number(e.target.value))} /></div>
            {data && (
              <div className="rounded-lg border divide-y text-sm">
                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">收入</span><span>{money(data.totalIncome)}</span></div>
                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">費用</span><span>{money(data.totalExpense)}</span></div>
                <div className="flex justify-between px-3 py-2 font-semibold"><span>本期損益</span><span className={data.netProfit < 0 ? "text-red-600 dark:text-red-400" : ""}>{money(data.netProfit)}</span></div>
                <div className="flex justify-between px-3 py-2"><span className="text-muted-foreground">分錄筆數</span><span>{data.entryCount}{data.unbalancedCount > 0 ? `（${data.unbalancedCount} 筆借貸不平）` : ""}</span></div>
              </div>
            )}
            {isFetching && !data && <p className="text-sm text-muted-foreground">計算中…</p>}
            <p className="text-xs text-muted-foreground">
              結帳會把關帳日設到 {year}-12-31，鎖住這一年的帳。這套系統的資產負債表會自動把歷年損益併入權益，所以不需要另外做結轉分錄，各年度的損益表也都還查得到。
            </p>
            {data?.closed && <p className="text-sm text-green-600 dark:text-green-400">這一年已經結帳（關帳日 {data.lockDate}）。</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>關閉</Button>
            <Button onClick={close} disabled={saving || !data || data.closed || data.unbalancedCount > 0}>{saving ? "處理中…" : "確認結帳"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus } from "lucide-react";
import { call, money, post, selectClass } from "@/lib/call";

interface Row {
  id: number; accountNumber: string; accountName: string; accountType: "Income" | "Expense";
  budget: number[]; actual: number[]; annualBudget: number; ytdBudget: number; ytdActual: number;
  variance: number; usedPercent: number | null; over: boolean; short: boolean;
}
interface Budgets { year: number; throughMonth: number; rows: Row[]; totals: Record<"income" | "expense", { annualBudget: number; ytdBudget: number; ytdActual: number }> }
interface Account { id: number; accountNumber: string; accountName: string; accountType: string }

export default function BudgetsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [editing, setEditing] = useState<{ accountId: string; months: string[]; annual: string; locked: boolean } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["/budgets", year], queryFn: () => call<Budgets>(`budgets?year=${year}`) });
  const { data: accounts = [] } = useQuery({ queryKey: ["/budgets/accounts"], queryFn: () => call<Account[]>("budgets/accounts"), enabled: !!editing, staleTime: 60_000 });

  const groups = useMemo(() => [
    { key: "Expense" as const, label: "費用", rows: (data?.rows || []).filter(r => r.accountType === "Expense"), totals: data?.totals.expense },
    { key: "Income" as const, label: "收入", rows: (data?.rows || []).filter(r => r.accountType === "Income"), totals: data?.totals.income },
  ], [data]);

  const openNew = () => setEditing({ accountId: "", months: Array.from({ length: 12 }, () => ""), annual: "", locked: false });
  const openEdit = (row: Row) => setEditing({ accountId: String(row.id), months: row.budget.map(n => n ? String(n) : ""), annual: String(row.annualBudget || ""), locked: true });
  const spread = () => {
    if (!editing) return;
    const total = Math.round((Number(editing.annual) || 0) * 100) / 100;
    const each = Math.floor((total / 12) * 100) / 100;
    const months = Array.from({ length: 12 }, () => String(each));
    months[11] = String(Math.round((total - each * 11) * 100) / 100);
    setEditing({ ...editing, months });
  };
  const monthsTotal = editing ? Math.round(editing.months.reduce((s, n) => s + (Number(n) || 0), 0) * 100) / 100 : 0;
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await post("budgets", { year, accountId: Number(editing.accountId), months: editing.months.map(n => Number(n) || 0) }, "PUT");
      toast({ title: "已儲存預算" });
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["/budgets"] });
    } catch (error) {
      toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="預算" description="替每個收入、費用科目設定每個月的預算，和實際入帳的金額比較"
        action={<Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />設定科目預算</Button>} />
      <div className="flex items-end gap-2">
        <div><Label htmlFor="budget-year" className="text-xs">年度</Label><Input id="budget-year" type="number" inputMode="numeric" className="w-28" value={year} onChange={e => setYear(Number(e.target.value) || new Date().getFullYear())} /></div>
        {data && <p className="pb-2 text-sm text-muted-foreground">累計比較到 {data.throughMonth} 月</p>}
      </div>

      {isLoading && <Card><CardContent className="p-6 text-center text-muted-foreground">載入中…</CardContent></Card>}
      {data && data.rows.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">這一年還沒有預算，也沒有收入或費用入帳。按「設定科目預算」開始。</CardContent></Card>}

      {groups.filter(g => g.rows.length > 0).map(group => (
        <Card key={group.key}>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <span className="font-semibold">{group.label}</span>
              <span className="text-sm text-muted-foreground">年度預算 {money(group.totals?.annualBudget)}・累計預算 {money(group.totals?.ytdBudget)}・累計實際 <span className="font-semibold text-foreground">{money(group.totals?.ytdActual)}</span></span>
            </div>
            <ul className="divide-y">
              {group.rows.map(row => {
                const percent = row.usedPercent === null ? null : Math.min(row.usedPercent, 100);
                const warn = row.over || row.short;
                return (
                  <li key={row.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" className="min-w-0 text-left" onClick={() => setExpanded(expanded === row.id ? null : row.id)} aria-expanded={expanded === row.id}>
                        <span className="font-medium">{row.accountName}</span><span className="ml-2 text-xs text-muted-foreground">{row.accountNumber}</span>
                      </button>
                      <span className="flex items-center gap-3 text-sm">
                        <span className={warn ? "font-semibold text-red-600 dark:text-red-400" : ""}>{money(row.ytdActual)}</span>
                        <span className="text-muted-foreground">／{row.ytdBudget > 0 ? money(row.ytdBudget) : "未設預算"}</span>
                        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`設定 ${row.accountName} 的預算`} onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button>
                      </span>
                    </div>
                    {percent !== null && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={row.usedPercent ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.accountName} 預算使用率`}>
                          <div className={`h-full rounded-full ${row.over ? "bg-red-500" : "bg-primary"}`} style={{ width: `${percent}%` }} />
                        </div>
                        <span className={`w-28 text-right text-xs ${warn ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{row.usedPercent}%{row.over ? `・超支 ${money(row.variance)}` : row.short ? `・未達 ${money(-row.variance)}` : ""}</span>
                      </div>
                    )}
                    {expanded === row.id && (
                      <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                        {row.budget.map((b, index) => (
                          <div key={index} className="rounded-md bg-muted/50 p-2">
                            <div className="text-muted-foreground">{index + 1} 月</div>
                            <div className={row.accountType === "Expense" && b > 0 && row.actual[index] > b ? "font-semibold text-red-600 dark:text-red-400" : "font-semibold"}>{money(row.actual[index])}</div>
                            <div className="text-muted-foreground">預算 {money(b)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="md:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{year} 年科目預算</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="budget-account">科目 *</Label>
                <select id="budget-account" className={selectClass} value={editing.accountId} disabled={editing.locked} onChange={e => setEditing({ ...editing, accountId: e.target.value })}>
                  <option value="">請選擇收入或費用科目</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} {a.accountName}（{a.accountType === "Income" ? "收入" : "費用"}）</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5"><Label htmlFor="budget-annual">年度預算</Label><Input id="budget-annual" type="number" inputMode="decimal" min="0" value={editing.annual} onChange={e => setEditing({ ...editing, annual: e.target.value })} /></div>
                <Button type="button" variant="outline" onClick={spread} disabled={!(Number(editing.annual) > 0)}>平均分到 12 個月</Button>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {editing.months.map((value, index) => (
                  <div key={index} className="space-y-1">
                    <Label htmlFor={`budget-m${index}`} className="text-xs">{index + 1} 月</Label>
                    <Input id={`budget-m${index}`} type="number" inputMode="decimal" min="0" value={value} onChange={e => setEditing({ ...editing, months: editing.months.map((m, i) => i === index ? e.target.value : m) })} />
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">12 個月合計 {money(monthsTotal)}。實際金額取自已過帳的分錄。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={save} disabled={saving || !editing?.accountId}>{saving ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

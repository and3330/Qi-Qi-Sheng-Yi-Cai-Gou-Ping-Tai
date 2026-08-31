import { useMemo, useState } from "react";
import {
  useGetAdminFinanceLedger,
  getGetAdminFinanceLedgerQueryKey,
  useListAdminExpenses,
  getListAdminExpensesQueryKey,
  useCreateAdminExpense,
  useDeleteAdminExpense,
  useGetAdminPnlReport,
  getGetAdminPnlReportQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";

const CATEGORY_LABEL: Record<string, string> = {
  purchase: "進貨款",
  operating: "營運費用",
  logistics: "物流",
  marketing: "行銷",
  other: "其他",
};

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function firstDayOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mutateAsync: create, isPending } = useCreateAdminExpense();

  const [category, setCategory] = useState("operating");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [spentAt, setSpentAt] = useState(today());
  const [note, setNote] = useState("");

  const submit = async () => {
    const value = Number(amount);
    if (!title.trim() || !Number.isInteger(value) || value <= 0) {
      toast({ title: "請填寫名目與正整數金額", variant: "destructive" });
      return;
    }
    try {
      await create({
        data: {
          category: category as any,
          title: title.trim(),
          amount: value,
          spentAt: spentAt || undefined,
          note: note || undefined,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListAdminExpensesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAdminFinanceLedgerQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAdminPnlReportQueryKey() });
      toast({ title: "支出已登錄" });
      onClose();
    } catch (e: any) {
      toast({ title: e?.data?.error || "登錄失敗", variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[92vw] max-w-[440px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>登錄支出</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>分類</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-expense-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>支出日期</Label>
              <Input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} data-testid="input-expense-date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>名目</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：3 月倉儲租金" data-testid="input-expense-title" />
          </div>
          <div className="space-y-1.5">
            <Label>金額 (NT$)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-expense-amount" />
          </div>
          <div className="space-y-1.5">
            <Label>備註 (選填)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="resize-none" data-testid="input-expense-note" />
          </div>
          <Button className="w-full" onClick={submit} disabled={isPending} data-testid="button-expense-submit">
            {isPending ? "儲存中..." : "儲存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminFinancePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"ledger" | "expenses" | "pnl">("ledger");
  const [fromInput, setFromInput] = useState(firstDayOfMonth());
  const [toInput, setToInput] = useState(today());
  const [range, setRange] = useState({ from: firstDayOfMonth(), to: today() });
  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [expenseDialog, setExpenseDialog] = useState(false);

  const ledgerParams = useMemo(() => {
    const p: any = {};
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
    if (kind !== "all") p.kind = kind;
    return p;
  }, [range, kind]);
  const expenseParams = useMemo(() => {
    const p: any = {};
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
    if (category !== "all") p.category = category;
    return p;
  }, [range, category]);
  const pnlParams = useMemo(() => {
    const p: any = {};
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
    return p;
  }, [range]);

  const { data: ledger, isLoading: ledgerLoading } = useGetAdminFinanceLedger(ledgerParams, {
    query: { queryKey: getGetAdminFinanceLedgerQueryKey(ledgerParams), enabled: tab === "ledger" },
  });
  const { data: expenses, isLoading: expensesLoading } = useListAdminExpenses(expenseParams, {
    query: { queryKey: getListAdminExpensesQueryKey(expenseParams), enabled: tab === "expenses" },
  });
  const { data: pnl, isLoading: pnlLoading } = useGetAdminPnlReport(pnlParams, {
    query: { queryKey: getGetAdminPnlReportQueryKey(pnlParams), enabled: tab === "pnl" },
  });

  const { mutateAsync: deleteExpense } = useDeleteAdminExpense();
  const handleDeleteExpense = async (id: number) => {
    if (!window.confirm("確定刪除此支出紀錄？")) return;
    try {
      await deleteExpense({ id });
      queryClient.invalidateQueries({ queryKey: getListAdminExpensesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAdminFinanceLedgerQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAdminPnlReportQueryKey() });
      toast({ title: "支出已刪除" });
    } catch (e: any) {
      toast({ title: e?.data?.error || "刪除失敗", variant: "destructive" });
    }
  };

  const tabs = [
    { key: "ledger" as const, label: "收支流水" },
    { key: "expenses" as const, label: "支出管理" },
    { key: "pnl" as const, label: "損益報表" },
  ];

  return (
    <AdminLayout title="財務管理">
      <div className="mb-4 flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              if (t.key === "pnl" && range.from === firstDayOfMonth()) {
                setFromInput(firstDayOfYear());
                setRange((r) => ({ ...r, from: firstDayOfYear() }));
              }
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "bg-white text-muted-foreground border hover:bg-primary/5"
            }`}
            data-testid={`tab-finance-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ from: fromInput, to: toInput });
        }}
      >
        <div className="space-y-1.5">
          <Label>開始日期</Label>
          <Input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="bg-white sm:w-44" data-testid="input-finance-from" />
        </div>
        <div className="space-y-1.5">
          <Label>結束日期</Label>
          <Input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} className="bg-white sm:w-44" data-testid="input-finance-to" />
        </div>
        {tab === "ledger" && (
          <div className="space-y-1.5">
            <Label>類型</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="bg-white sm:w-36" data-testid="select-ledger-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="income">收入</SelectItem>
                <SelectItem value="expense">支出</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {tab === "expenses" && (
          <div className="space-y-1.5">
            <Label>分類</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="bg-white sm:w-36" data-testid="select-expense-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button type="submit" data-testid="button-finance-query">查詢</Button>
        <div className="flex-1" />
        {tab === "expenses" && (
          <Button type="button" onClick={() => setExpenseDialog(true)} data-testid="button-expense-create">
            登錄支出
          </Button>
        )}
      </form>

      {tab === "ledger" &&
        (ledgerLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: "期間收入", value: ledger?.incomeTotal ?? 0, icon: TrendingUp, color: "text-green-600 bg-green-50" },
                { label: "期間支出", value: ledger?.expenseTotal ?? 0, icon: TrendingDown, color: "text-red-500 bg-red-50" },
                { label: "淨額", value: ledger?.net ?? 0, icon: Scale, color: "text-primary bg-primary/10" },
              ].map((c) => {
                const Icon = c.icon;
                return (
                  <div key={c.label} className="rounded-2xl border bg-white p-4 shadow-sm" data-testid={`card-ledger-${c.label}`}>
                    <div className="flex items-center gap-2">
                      <div className={`rounded-xl p-2 ${c.color}`}>
                        <Icon size={18} />
                      </div>
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                    </div>
                    <p className={`mt-2 text-xl font-bold ${c.label === "淨額" && c.value < 0 ? "text-red-500" : ""}`}>
                      NT${c.value.toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
            {!ledger?.entries.length ? (
              <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
                期間內沒有收支紀錄
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-3 font-medium">日期</th>
                        <th className="px-4 py-3 font-medium">類型</th>
                        <th className="px-4 py-3 font-medium">項目</th>
                        <th className="px-4 py-3 text-right font-medium">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.entries.map((e, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-ledger-${i}`}>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(e.date).toLocaleDateString("zh-TW")}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${e.kind === "income" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                              {e.kind === "income" ? "收入" : `支出｜${CATEGORY_LABEL[e.category] ?? e.category}`}
                            </span>
                          </td>
                          <td className="px-4 py-3">{e.title}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${e.kind === "income" ? "text-green-600" : "text-red-500"}`}>
                            {e.kind === "income" ? "+" : "-"}NT${e.amount.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ))}

      {tab === "expenses" &&
        (expensesLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : !expenses?.length ? (
          <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
            期間內沒有支出紀錄
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">日期</th>
                    <th className="px-4 py-3 font-medium">分類</th>
                    <th className="px-4 py-3 font-medium">名目</th>
                    <th className="px-4 py-3 text-right font-medium">金額</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-expense-${e.id}`}>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(e.spentAt).toLocaleDateString("zh-TW")}
                      </td>
                      <td className="px-4 py-3">{CATEGORY_LABEL[e.category] ?? e.category}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{e.title}</p>
                        {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">NT${e.amount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteExpense(e.id)} data-testid={`button-expense-delete-${e.id}`}>
                          <Trash2 size={16} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {tab === "pnl" &&
        (pnlLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
              {[
                { label: "營收", value: pnl?.revenue ?? 0 },
                { label: "銷貨成本", value: pnl?.cogs ?? 0 },
                { label: "毛利", value: pnl?.grossProfit ?? 0 },
                { label: "費用", value: pnl?.expenseTotal ?? 0 },
                { label: "分潤支出", value: pnl?.profitShareTotal ?? 0 },
                { label: "淨利", value: pnl?.netProfit ?? 0 },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl border bg-white p-4 shadow-sm" data-testid={`card-pnl-${c.label}`}>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className={`mt-2 text-lg font-bold ${(c.label === "淨利" || c.label === "毛利") && c.value < 0 ? "text-red-500" : ""}`}>
                    NT${c.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            {!pnl?.months.length ? (
              <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
                期間內沒有損益資料
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-3 font-medium">月份</th>
                        <th className="px-4 py-3 text-right font-medium">營收</th>
                        <th className="px-4 py-3 text-right font-medium">銷貨成本</th>
                        <th className="px-4 py-3 text-right font-medium">毛利</th>
                        <th className="px-4 py-3 text-right font-medium">費用</th>
                        <th className="px-4 py-3 text-right font-medium">分潤支出</th>
                        <th className="px-4 py-3 text-right font-medium">淨利</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pnl.months.map((m) => (
                        <tr key={m.month} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-pnl-${m.month}`}>
                          <td className="px-4 py-3 font-medium">{m.month}</td>
                          <td className="px-4 py-3 text-right">NT${m.revenue.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">NT${m.cogs.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">NT${m.grossProfit.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">NT${m.expenses.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">NT${m.profitShare.toLocaleString()}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${m.netProfit < 0 ? "text-red-500" : ""}`}>
                            NT${m.netProfit.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ))}

      {expenseDialog && <ExpenseDialog onClose={() => setExpenseDialog(false)} />}
    </AdminLayout>
  );
}

import { useMemo, useState } from "react";
import {
  useGetAdminWalletStats,
  getGetAdminWalletStatsQueryKey,
  useGetAdminMemberWallet,
  getGetAdminMemberWalletQueryKey,
  useAdjustAdminMemberWallet,
  type GetAdminWalletStatsParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Wallet, PiggyBank, ShoppingCart, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { getTierName } from "@/lib/utils";
import { AdminLayout } from "./AdminLayout";

const TX_TYPE_LABEL: Record<string, string> = {
  deposit: "儲值",
  payment: "消費",
  refund: "退款",
  profit_share: "利潤分享",
  adjust: "調整",
};

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function MemberWalletDialog({
  memberId,
  onClose,
}: {
  memberId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: wallet, isLoading } = useGetAdminMemberWallet(memberId);
  const { mutateAsync: adjust, isPending } = useAdjustAdminMemberWallet();

  const [type, setType] = useState<"deposit" | "adjust">("deposit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) {
      toast({ title: "請輸入有效金額", variant: "destructive" });
      return;
    }
    try {
      await adjust({ memberId, data: { type, amount: value, reason: reason || undefined } });
      queryClient.invalidateQueries({ queryKey: getGetAdminMemberWalletQueryKey(memberId) });
      queryClient.invalidateQueries({ queryKey: getGetAdminWalletStatsQueryKey() });
      toast({ title: type === "deposit" ? "儲值成功" : "調整成功" });
      setAmount("");
      setReason("");
    } catch (e: any) {
      toast({ title: e?.data?.error || "操作失敗", variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-[92vw] max-w-[560px] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            會員錢包{wallet ? `：${wallet.name}（${wallet.username}）` : ""}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !wallet ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-primary/5 p-4">
              <p className="text-xs text-muted-foreground">目前餘額</p>
              <p className="text-2xl font-bold" data-testid="text-member-wallet-balance">
                NT${wallet.balance.toLocaleString()}
              </p>
            </div>

            <div className="rounded-xl border p-4">
              <p className="mb-3 text-sm font-bold">儲值／調整</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>類型</Label>
                  <Select value={type} onValueChange={(v) => setType(v as any)}>
                    <SelectTrigger data-testid="select-wallet-adjust-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deposit">儲值</SelectItem>
                      <SelectItem value="adjust">調整（可負數）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>金額 (NT$)</Label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    data-testid="input-wallet-adjust-amount"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>原因附註</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="例如：匯款儲值"
                    data-testid="input-wallet-adjust-reason"
                  />
                </div>
              </div>
              <Button
                className="mt-3"
                onClick={submit}
                disabled={isPending}
                data-testid="button-wallet-adjust-submit"
              >
                {isPending ? "處理中..." : "確認送出"}
              </Button>
            </div>

            <div>
              <p className="mb-2 text-sm font-bold">交易明細</p>
              {wallet.transactions.length === 0 ? (
                <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                  尚無交易紀錄
                </p>
              ) : (
                <div className="divide-y rounded-xl border">
                  {wallet.transactions.map((t) => (
                    <div key={t.id} className="flex items-center justify-between px-3 py-2.5" data-testid={`row-admin-wallet-tx-${t.id}`}>
                      <div className="min-w-0 mr-3">
                        <p className="text-sm font-medium">
                          {TX_TYPE_LABEL[t.type] ?? t.type}
                          {t.refNo ? <span className="ml-1 text-[10px] text-muted-foreground">{t.refNo}</span> : null}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {new Date(t.createdAt).toLocaleString("zh-TW")}
                          {t.reason ? `｜${t.reason}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-bold ${t.amount >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {t.amount >= 0 ? "+" : ""}
                          {t.amount.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          餘額 {t.balanceAfter.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminWalletsPage() {
  const [fromInput, setFromInput] = useState(firstDayOfMonth());
  const [toInput, setToInput] = useState(today());
  const [range, setRange] = useState({ from: firstDayOfMonth(), to: today() });
  const [search, setSearch] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);

  const params = useMemo(() => {
    const p: GetAdminWalletStatsParams = {};
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
    return p;
  }, [range]);

  const { data: stats, isLoading } = useGetAdminWalletStats(params, {
    query: { queryKey: getGetAdminWalletStatsQueryKey(params) },
  });

  const members = (stats?.members ?? []).filter(
    (m) =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.username.toLowerCase().includes(search.toLowerCase()),
  );

  const cards = stats
    ? [
        { label: "全體錢包餘額", value: `NT$${stats.totalBalance.toLocaleString()}`, icon: Wallet, color: "text-primary bg-primary/10" },
        { label: "期間儲值", value: `NT$${stats.depositTotal.toLocaleString()}`, icon: PiggyBank, color: "text-green-600 bg-green-50" },
        { label: "期間消費", value: `NT$${stats.spendTotal.toLocaleString()}`, icon: ShoppingCart, color: "text-blue-600 bg-blue-50" },
        { label: "期間分潤發放", value: `NT$${stats.profitShareTotal.toLocaleString()}`, icon: HandCoins, color: "text-amber-600 bg-amber-50" },
      ]
    : [];

  return (
    <AdminLayout title="會員錢包">
      <form
        className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ from: fromInput, to: toInput });
        }}
      >
        <div className="space-y-1.5">
          <Label>開始日期</Label>
          <Input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="bg-white sm:w-44" data-testid="input-wallet-from" />
        </div>
        <div className="space-y-1.5">
          <Label>結束日期</Label>
          <Input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} className="bg-white sm:w-44" data-testid="input-wallet-to" />
        </div>
        <Button type="submit" data-testid="button-wallet-query">查詢</Button>
        <div className="flex-1" />
        <Input
          placeholder="搜尋會員姓名 / 帳號"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white sm:w-56"
          data-testid="input-wallet-search"
        />
      </form>

      {isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label} className="rounded-2xl border bg-white p-4 shadow-sm" data-testid={`card-wallet-${c.label}`}>
                  <div className="flex items-center gap-2">
                    <div className={`rounded-xl p-2 ${c.color}`}>
                      <Icon size={18} />
                    </div>
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                  </div>
                  <p className="mt-2 text-xl font-bold">{c.value}</p>
                </div>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">會員</th>
                    <th className="px-4 py-3 font-medium">身份</th>
                    <th className="px-4 py-3 text-right font-medium">錢包餘額</th>
                    <th className="px-4 py-3 text-right font-medium">期間儲值</th>
                    <th className="px-4 py-3 text-right font-medium">期間消費</th>
                    <th className="px-4 py-3 text-right font-medium">期間分潤</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.memberId} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-wallet-member-${m.memberId}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.username}</p>
                      </td>
                      <td className="px-4 py-3">{getTierName(m.tier)}</td>
                      <td className="px-4 py-3 text-right font-semibold">NT${m.balance.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">NT${m.depositTotal.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">NT${m.spendTotal.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">NT${m.profitShareTotal.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedMemberId(m.memberId)}
                          data-testid={`button-wallet-detail-${m.memberId}`}
                        >
                          明細／儲值
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!members.length && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        沒有符合的會員
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {selectedMemberId !== null && (
        <MemberWalletDialog memberId={selectedMemberId} onClose={() => setSelectedMemberId(null)} />
      )}
    </AdminLayout>
  );
}

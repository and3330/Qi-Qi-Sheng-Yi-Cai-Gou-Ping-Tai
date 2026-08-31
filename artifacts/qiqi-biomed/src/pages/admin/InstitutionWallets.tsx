import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminInstitutionWallets,
  useGetAdminInstitutionWallet,
  useAdjustInstitutionWallet,
  getGetAdminInstitutionWalletQueryKey,
  getListAdminInstitutionWalletsQueryKey,
  type InstitutionWalletTransaction,
} from "@workspace/api-client-react";
import { Building2, Search, ArrowUpRight, ArrowDownRight, RefreshCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { formatPrice, classNames } from "@/lib/utils";

const TX_TYPE_LABEL: Record<string, string> = {
  deposit: "儲值",
  payment: "消費",
  refund: "退款",
  profit_share: "利潤分享",
  adjust: "調整",
};

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'deposit': 
    case 'refund': 
    case 'profit_share': return <ArrowDownRight size={16} className="text-emerald-500" />;
    case 'payment': return <ArrowUpRight size={16} className="text-destructive" />;
    case 'adjust': return <RefreshCcw size={16} className="text-blue-500" />;
    default: return <Building2 size={16} className="text-gray-500" />;
  }
};

function InstitutionWalletDialog({
  institutionId,
  onClose,
}: {
  institutionId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: wallet, isLoading } = useGetAdminInstitutionWallet(institutionId);
  const { mutateAsync: adjust, isPending } = useAdjustInstitutionWallet();

  const [type, setType] = useState<"deposit" | "adjust">("deposit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) {
      toast({ title: "請輸入有效金額", variant: "destructive" });
      return;
    }
    if (type === "deposit" && value < 0) {
      toast({ title: "儲值金額必須為正數", variant: "destructive" });
      return;
    }

    try {
      await adjust({ institutionId, data: { type, amount: value, reason: reason || undefined } });
      queryClient.invalidateQueries({ queryKey: getGetAdminInstitutionWalletQueryKey(institutionId) });
      queryClient.invalidateQueries({ queryKey: getListAdminInstitutionWalletsQueryKey() });
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
            機構錢包{wallet ? `：${wallet.institutionName}` : ""}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !wallet ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-primary/5 p-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-muted-foreground mb-1">目前餘額</p>
                <p className="text-2xl font-bold">{formatPrice(wallet.balance)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground mb-1">機構類別</p>
                <Badge variant="outline">{wallet.type}</Badge>
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <p className="mb-3 text-sm font-bold">儲值／調整</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>類型</Label>
                  <Select value={type} onValueChange={(v) => setType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deposit">儲值 (+)</SelectItem>
                      <SelectItem value="adjust">餘額調整 (+/-)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>金額 (NT$)</Label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={type === "deposit" ? "如: 1000" : "如: -500"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>備註</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="選填"
                  />
                </div>
              </div>
              <Button
                className="mt-4 w-full"
                onClick={submit}
                disabled={isPending || !amount}
              >
                {isPending ? "處理中..." : "確認送出"}
              </Button>
            </div>

            <div className="rounded-xl border">
              <div className="border-b bg-muted/30 p-3">
                <p className="text-sm font-bold">交易明細</p>
              </div>
              <div className="divide-y divide-border/50">
                {!wallet.transactions.length ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    無交易紀錄
                  </p>
                ) : (
                  wallet.transactions.map((tx: InstitutionWalletTransaction) => {
                    const isPositive = tx.amount > 0;
                    return (
                      <div key={tx.id} className="p-3 text-sm flex gap-3 items-center">
                        <div className={classNames(
                          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                          isPositive ? "bg-emerald-50" : tx.amount < 0 ? "bg-red-50" : "bg-blue-50"
                        )}>
                          {getTypeIcon(tx.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{TX_TYPE_LABEL[tx.type] || tx.type}</span>
                            <span className={classNames(
                              "font-bold",
                              isPositive ? "text-emerald-600" : tx.amount < 0 ? "text-destructive" : "text-gray-900"
                            )}>
                              {isPositive ? '+' : ''}{formatPrice(tx.amount)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5 text-xs text-muted-foreground">
                            <span>
                              {tx.reason || tx.refNo || "無備註"}
                              {tx.memberName && ` (${tx.memberName})`}
                            </span>
                            <span>餘額 {formatPrice(tx.balanceAfter)}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(tx.createdAt).toLocaleString('zh-TW')}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminInstitutionWalletsPage() {
  const [search, setSearch] = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<number | null>(null);

  const { data: wallets, isLoading } = useListAdminInstitutionWallets();

  const filteredWallets = wallets?.filter(w => 
    w.institutionName.toLowerCase().includes(search.toLowerCase()) ||
    w.city.toLowerCase().includes(search.toLowerCase()) ||
    w.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminLayout title="機構錢包">
      <div className="mb-4 flex gap-3 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input 
            placeholder="搜尋機構名稱、城市、類型..." 
            className="pl-9 h-10"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium w-16">ID</th>
                  <th className="px-4 py-3 font-medium">機構名稱</th>
                  <th className="px-4 py-3 font-medium">類別</th>
                  <th className="px-4 py-3 font-medium">城市</th>
                  <th className="px-4 py-3 text-right font-medium">錢包餘額</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredWallets?.map((w) => (
                  <tr key={w.institutionId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-muted-foreground">#{w.institutionId}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">{w.institutionName}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-none font-normal">
                        {w.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{w.city}</td>
                    <td className="px-4 py-3 text-right font-bold text-primary text-base">
                      {formatPrice(w.balance)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedInstitutionId(w.institutionId)}
                      >
                        明細／儲值
                      </Button>
                    </td>
                  </tr>
                ))}
                {!filteredWallets?.length && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      沒有符合的機構錢包
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedInstitutionId !== null && (
        <InstitutionWalletDialog 
          institutionId={selectedInstitutionId} 
          onClose={() => setSelectedInstitutionId(null)} 
        />
      )}
    </AdminLayout>
  );
}
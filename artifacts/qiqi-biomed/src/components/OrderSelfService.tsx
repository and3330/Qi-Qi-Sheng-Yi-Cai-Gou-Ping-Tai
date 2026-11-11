import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetShopPaymentInfo,
  useReportOrderRemittance,
  useCancelOwnOrder,
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  getGetMeQueryKey,
  getGetCartQueryKey,
  type Order,
} from "@workspace/api-client-react";
import { Banknote, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function errorText(err: unknown, fallback: string) {
  const e = err as { data?: { error?: string }; response?: { data?: { error?: string } } };
  return e?.data?.error || e?.response?.data?.error || fallback;
}

/** 匯款訂單：顯示匯款帳號，並讓會員回報匯款帳號後五碼。只在「待付款＋銀行匯款」時出現。 */
export function RemittanceCard({ order }: { order: Order }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: info } = useGetShopPaymentInfo();
  const { mutateAsync: report, isPending } = useReportOrderRemittance();
  const [lastFive, setLastFive] = useState("");

  if (order.paymentMethod !== "bank_transfer" || order.status !== "pending") return null;

  const hasAccount = !!info?.bankAccount;
  const submit = async () => {
    if (!/^\d{5}$/.test(lastFive)) {
      toast({ title: "請輸入 5 位數字", variant: "destructive" });
      return;
    }
    try {
      await report({ id: order.id, data: { lastFive } });
      setLastFive("");
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
      toast({ title: "已收到回報，確認入帳後會安排出貨" });
    } catch (err) {
      toast({ title: errorText(err, "回報失敗，請稍後再試"), variant: "destructive" });
    }
  };

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm" data-testid="card-remittance">
      <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900">
        <Banknote size={18} className="text-amber-600" />
        匯款資訊
      </h2>
      {hasAccount ? (
        <dl className="space-y-1.5 text-sm">
          {[
            ["銀行", [info?.bankName, info?.bankBranch].filter(Boolean).join(" ")],
            ["帳號", info?.bankAccount],
            ["戶名", info?.bankHolder],
            ["應匯金額", `NT$${order.totalAmount.toLocaleString()}`],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500">{k}</dt>
                <dd className="break-all text-right font-medium text-gray-900">{v}</dd>
              </div>
            ))}
          {info?.bankNote && <p className="pt-1 text-xs text-gray-600">{info.bankNote}</p>}
        </dl>
      ) : (
        <p className="text-sm text-gray-600">匯款帳號請洽客服取得。</p>
      )}

      <div className="mt-4 border-t border-amber-200 pt-4">
        {order.remitLastFive ? (
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700" data-testid="text-remit-reported">
            <CheckCircle2 size={16} />
            已回報後五碼 {order.remitLastFive}，待確認入帳
          </p>
        ) : null}
        <label htmlFor="remit-last-five" className="mb-2 block text-xs font-bold text-gray-900">
          {order.remitLastFive ? "要更正的話，重新輸入後五碼" : "匯款後，請回報您匯款帳號的後五碼"}
        </label>
        <div className="flex gap-2">
          <Input
            id="remit-last-five"
            inputMode="numeric"
            maxLength={5}
            placeholder="例如 12345"
            value={lastFive}
            onChange={(e) => setLastFive(e.target.value.replace(/\D/g, "").slice(0, 5))}
            className="bg-white"
            data-testid="input-remit-last-five"
          />
          <Button onClick={submit} disabled={isPending || lastFive.length !== 5} data-testid="button-remit-submit">
            {isPending ? "送出中" : "回報"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** 待付款的訂單可由會員自己取消；其他狀態請客服處理。 */
export function CancelOrderButton({ order }: { order: Order }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: cancel, isPending } = useCancelOwnOrder();

  if (order.status !== "pending") return null;

  const confirm = async () => {
    try {
      await cancel({ id: order.id });
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      toast({ title: "訂單已取消" });
    } catch (err) {
      toast({ title: errorText(err, "取消失敗，請聯繫客服"), variant: "destructive" });
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="h-12 w-full rounded-2xl border-destructive/20 bg-white text-destructive hover:bg-destructive/5 hover:text-destructive"
          disabled={isPending}
          data-testid="button-cancel-order"
        >
          取消訂單
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="w-[90vw] max-w-[400px] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>確定要取消這筆訂單？</AlertDialogTitle>
          <AlertDialogDescription>
            取消後無法復原，折抵的點數會退回。如果已經匯款，請先聯繫客服，不要直接取消。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>先不要</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} data-testid="button-cancel-order-confirm">
            確定取消
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

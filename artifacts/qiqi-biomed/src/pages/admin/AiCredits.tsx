import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAiCredits,
  getGetAiCreditsQueryKey,
  useCreateAiCreditsCheckout,
  useConfirmAiCreditsCheckout,
} from "@workspace/api-client-react";
import { Coins, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { AdminLayout } from "./AdminLayout";

function errMessage(e: unknown, fallback: string) {
  const anyE = e as any;
  return anyE?.data?.error || anyE?.message || fallback;
}

const formatTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false });

/** 把最小單位的金額轉成一般寫法（例如 1000 usd → US$10.00） */
function formatPrice(amount: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat("zh-TW", { style: "currency", currency: currency.toUpperCase() });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** digits);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

const PACK_CHOICES = [1, 3, 5, 10];

export default function AiCredits() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";

  const { data, isLoading } = useGetAiCredits();
  const checkout = useCreateAiCreditsCheckout();
  const confirm = useConfirmAiCreditsCheckout();
  const [packs, setPacks] = useState(1);
  const confirmedRef = useRef(false);

  // 刷卡完成後 Stripe 會帶 session_id 回到這一頁：立即確認入帳，然後把網址清乾淨
  useEffect(() => {
    if (confirmedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const canceled = params.get("canceled");
    if (!sessionId && !canceled) return;
    confirmedRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (canceled) {
      toast({ title: "已取消儲值" });
      return;
    }
    confirm
      .mutateAsync({ data: { sessionId: sessionId! } })
      .then((result) => {
        if (result.status === "credited") toast({ title: `儲值成功，已加 ${result.points} 點` });
        else if (result.status === "already") toast({ title: "這筆儲值已入帳" });
        else if (result.status === "unpaid") toast({ title: "付款尚未完成", variant: "destructive" });
      })
      .catch((e) => toast({ title: "無法確認付款", description: errMessage(e, ""), variant: "destructive" }))
      .finally(() => queryClient.invalidateQueries({ queryKey: getGetAiCreditsQueryKey() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckout = async () => {
    try {
      const { url } = await checkout.mutateAsync({ data: { packs } });
      window.location.href = url;
    } catch (e) {
      toast({ title: "無法前往結帳", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="AI 點數">
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : (
        <div className="space-y-8">
          <section className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Coins size={22} className="text-primary" />
              <span className="text-sm text-muted-foreground">目前餘額</span>
              <span className="text-3xl font-bold" data-testid="text-ai-credit-balance">
                {data.balance.toLocaleString("zh-TW")}
              </span>
              <span className="text-sm text-muted-foreground">點</span>
              {!data.enforced && <Badge className="bg-muted text-muted-foreground">目前未啟用扣點</Badge>}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              後台「AI 助理」每送出一則訊息扣 1 點；外部 Bot 每使用一次功能扣 1 點（查詢操作狀態不扣）。
              點數用完後 AI 助理與 Bot 會暫停，儲值後立即恢復。
            </p>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <CreditCard size={18} />
              刷卡儲值
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              每包 {data.packPoints.toLocaleString("zh-TW")} 點，{formatPrice(data.packAmount, data.currency)}。
            </p>
            {!data.stripeConfigured ? (
              <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                尚未開通刷卡儲值，請聯絡系統服務商。
              </p>
            ) : !isAdmin ? (
              <p className="mt-3 text-sm text-muted-foreground">僅系統管理員可以儲值。</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {PACK_CHOICES.map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant={packs === n ? "default" : "outline"}
                      onClick={() => setPacks(n)}
                    >
                      {(n * data.packPoints).toLocaleString("zh-TW")} 點
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm">
                    應付金額 <strong>{formatPrice(packs * data.packAmount, data.currency)}</strong>
                  </span>
                  <Button onClick={handleCheckout} disabled={checkout.isPending}>
                    前往刷卡
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  付款由 Stripe 處理，本系統不會儲存卡號。付款完成後會自動回到這一頁並加點。
                </p>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold">點數紀錄（最近 100 筆）</h2>
            {data.transactions.length === 0 ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                尚無紀錄
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="p-3 font-medium">時間</th>
                      <th className="p-3 font-medium">說明</th>
                      <th className="p-3 text-right font-medium">增減</th>
                      <th className="p-3 text-right font-medium">餘額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t) => (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap p-3">{formatTime(t.createdAt)}</td>
                        <td className="p-3">{t.reason}</td>
                        <td className={`p-3 text-right font-mono ${t.delta > 0 ? "text-green-700" : ""}`}>
                          {t.delta > 0 ? `+${t.delta}` : t.delta}
                        </td>
                        <td className="p-3 text-right font-mono">{t.balanceAfter.toLocaleString("zh-TW")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </AdminLayout>
  );
}

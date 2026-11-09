import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Building2, Truck, CreditCard, Wallet } from "lucide-react";
import { useGetCart, useCreateOrder, useGetMe, getGetCartQueryKey, getListOrdersQueryKey, useGetPortalWallet, getGetPortalWalletQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function CheckoutPage() {
  const [, setLocation] = useLocation();
  const { data: cart } = useGetCart();
  const { data: me } = useGetMe();
  const { mutateAsync: createOrder } = useCreateOrder();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: wallet } = useGetPortalWallet();
  const [paymentMethod, setPaymentMethod] = useState<"bank_transfer" | "cod" | "wallet">("bank_transfer");
  const [receiverName, setReceiverName] = useState(me?.name || "");
  const [receiverPhone, setReceiverPhone] = useState(me?.phone || "");
  const [shippingAddress, setShippingAddress] = useState(me?.shippingAddress || "");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successOrderNo, setSuccessOrderNo] = useState<string | null>(null);

  const getPrice = (item: any) => {
    const target = item.variant || item.product;
    if (me?.tier === "hospital") return target.priceHospital;
    if (me?.tier === "clinic") return target.priceClinic;
    return target.priceConsumer;
  };

  const total = useMemo(() => {
    return cart?.reduce((sum, item) => sum + (getPrice(item) * item.quantity), 0) || 0;
  }, [cart, me]);

  const [pointsToUse, setPointsToUse] = useState<number>(0);

  const handlePointsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseInt(e.target.value) || 0;
    if (val < 0) val = 0;
    if (val > (me?.points || 0)) val = me?.points || 0;
    if (val > total) val = total;
    setPointsToUse(val);
  };

  const finalTotal = total - pointsToUse;

  const handleSubmit = async () => {
    if (!receiverName || !receiverPhone || !shippingAddress) {
      toast({ title: "請填寫完整收件資訊", variant: "destructive" });
      return;
    }
    
    if (!cart || cart.length === 0) return;

    setIsSubmitting(true);
    try {
      const order = await createOrder({
        data: {
          paymentMethod,
          receiverName,
          receiverPhone,
          shippingAddress,
          note,
          clearCart: true,
          pointsToUse: pointsToUse > 0 ? pointsToUse : undefined,
          items: cart.map(item => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity
          }))
        }
      });
      setSuccessOrderNo(order.orderNo);
      queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      if (paymentMethod === "wallet") {
        queryClient.invalidateQueries({ queryKey: getGetPortalWalletQueryKey() });
      }
    } catch (e: any) {
      toast({ title: e?.data?.error || "結帳失敗，請重試", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successOrderNo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 animate-in fade-in zoom-in duration-500">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 text-green-600">
          <CheckCircle2 size={40} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">訂單建立成功！</h2>
        <p className="text-gray-500 mb-6">您的訂單編號為：<span className="font-mono text-gray-900 font-bold">{successOrderNo}</span></p>
        
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button asChild className="w-full rounded-xl h-12"><Link href="/orders">查看訂單</Link></Button>
          <Button asChild variant="outline" className="w-full rounded-xl h-12"><Link href="/">返回首頁</Link></Button>
        </div>
      </div>
    );
  }

  if (!cart || cart.length === 0) {
    return <Redirect to="/cart" />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-36 animate-in fade-in">
      <div className="bg-white px-4 pt-safe pb-3 shadow-sm sticky top-0 z-30 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft size={20} />
        </Button>
        <h1 className="font-bold text-lg text-gray-900">結帳</h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Receiver Info */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="font-bold text-gray-900 mb-4 flex items-center"><Truck size={18} className="mr-2 text-primary" />收件資訊</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">收件人姓名</Label>
              <Input id="name" value={receiverName} onChange={e => setReceiverName(e.target.value)} placeholder="請輸入姓名" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">聯絡電話</Label>
              <Input id="phone" type="tel" value={receiverPhone} onChange={e => setReceiverPhone(e.target.value)} placeholder="請輸入手機號碼" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">收件地址</Label>
              <Input id="address" value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} placeholder="請輸入完整地址" />
            </div>
          </div>
        </section>

        {/* Payment Method */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="font-bold text-gray-900 mb-4 flex items-center"><CreditCard size={18} className="mr-2 text-primary" />付款方式</h2>
          <div className="space-y-3">
            <label className={`flex items-center p-3 rounded-xl border-2 transition-colors cursor-pointer ${paymentMethod === 'bank_transfer' ? 'border-primary bg-primary/5' : 'border-gray-100'}`}>
              <div className="w-5 h-5 rounded-full border border-gray-300 flex items-center justify-center mr-3">
                {paymentMethod === 'bank_transfer' && <div className="w-3 h-3 bg-primary rounded-full" />}
              </div>
              <Building2 size={20} className="text-gray-500 mr-3" />
              <div className="flex-1">
                <div className="font-bold text-sm">銀行匯款</div>
                <div className="text-xs text-gray-500 mt-0.5">匯款後請至訂單回報後五碼</div>
              </div>
              <input type="radio" className="hidden" checked={paymentMethod === 'bank_transfer'} onChange={() => setPaymentMethod('bank_transfer')} />
            </label>
            
            <label className={`flex items-center p-3 rounded-xl border-2 transition-colors cursor-pointer ${paymentMethod === 'cod' ? 'border-primary bg-primary/5' : 'border-gray-100'}`}>
              <div className="w-5 h-5 rounded-full border border-gray-300 flex items-center justify-center mr-3">
                {paymentMethod === 'cod' && <div className="w-3 h-3 bg-primary rounded-full" />}
              </div>
              <Truck size={20} className="text-gray-500 mr-3" />
              <div className="flex-1">
                <div className="font-bold text-sm">貨到付款</div>
                <div className="text-xs text-gray-500 mt-0.5">由物流人員代收現金</div>
              </div>
              <input type="radio" className="hidden" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} />
            </label>

            {(() => {
              const balance = wallet?.balance ?? 0;
              const insufficient = balance < finalTotal;
              if (insufficient) {
                return (
                  <label className="flex items-center p-3 rounded-xl border-2 border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed" data-testid="option-payment-wallet">
                    <div className="w-5 h-5 rounded-full border border-gray-300 mr-3" />
                    <Wallet size={20} className="text-gray-400 mr-3" />
                    <div className="flex-1">
                      <div className="font-bold text-sm text-gray-600 flex items-center justify-between">
                        錢包扣款
                        <span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-0.5 rounded">餘額不足</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">目前餘額 NT${balance.toLocaleString()}</div>
                    </div>
                  </label>
                );
              }
              return (
                <label
                  className={`flex items-center p-3 rounded-xl border-2 transition-colors cursor-pointer ${paymentMethod === 'wallet' ? 'border-primary bg-primary/5' : 'border-gray-100'}`}
                  data-testid="option-payment-wallet"
                >
                  <div className="w-5 h-5 rounded-full border border-gray-300 flex items-center justify-center mr-3">
                    {paymentMethod === 'wallet' && <div className="w-3 h-3 bg-primary rounded-full" />}
                  </div>
                  <Wallet size={20} className="text-gray-500 mr-3" />
                  <div className="flex-1">
                    <div className="font-bold text-sm">錢包扣款</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      目前餘額 NT${balance.toLocaleString()}，結帳時直接扣款
                    </div>
                    {wallet?.walletKind === "institution" && (
                      <div className="text-[10px] text-primary mt-1 font-medium bg-primary/10 px-2 py-0.5 rounded inline-block">
                        將自機構共用錢包扣款
                      </div>
                    )}
                  </div>
                  <input type="radio" className="hidden" checked={paymentMethod === 'wallet'} onChange={() => setPaymentMethod('wallet')} />
                </label>
              );
            })()}
          </div>
        </section>

        {/* Note */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <Label htmlFor="note" className="font-bold text-gray-900 mb-2 block">訂單備註 (選填)</Label>
          <Textarea id="note" value={note} onChange={e => setNote(e.target.value)} placeholder="有任何需要我們注意的事項嗎？" className="resize-none" />
        </section>

        {/* Order Summary Summary */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="font-bold text-gray-900 mb-3">訂單摘要 ({cart.length}件)</h2>
          <div className="space-y-2 mb-4">
            {cart.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-600 truncate mr-4">
                  {item.product.name} 
                  {item.variant && <span className="text-[10px] bg-gray-100 px-1 py-0.5 rounded ml-1">規格：{item.variant.name}</span>}
                  <span className="ml-1 text-xs">x {item.quantity}</span>
                </span>
                <span className="font-medium">{formatPrice(getPrice(item) * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 pt-4 mt-2">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900">點數折抵</span>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  可用 {me?.points || 0} 點
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">-NT$</span>
                <Input
                  type="number"
                  min="0"
                  max={Math.min(me?.points || 0, total)}
                  value={pointsToUse || ""}
                  onChange={handlePointsChange}
                  className="w-20 h-8 text-right px-2 py-1 bg-gray-50 border-gray-200"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-gray-100">
              <span className="font-bold text-gray-900">應付總額</span>
              <span className="text-xl font-bold text-destructive">{formatPrice(finalTotal)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="sticky bottom-nav-offset lg:bottom-0 z-30 w-full bg-white border-t rounded-t-3xl shadow-[0_-8px_20px_rgba(0,0,0,0.08)]">
        <div className="p-4">
          <Button 
            className="w-full h-12 text-base font-bold rounded-xl"
            onClick={handleSubmit}
            disabled={isSubmitting || !receiverName || !receiverPhone || !shippingAddress}
          >
            {isSubmitting ? "處理中..." : "確認結帳"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Inline redirect component since we don't want to import wouter's Redirect explicitly if it causes a re-render loop, but it's safe to use.
function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useState(() => { setLocation(to); });
  return null;
}

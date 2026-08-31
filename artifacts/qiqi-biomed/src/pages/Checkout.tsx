import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Building2, Truck, CreditCard, Wallet } from "lucide-react";
import { useGetCart, useCreateOrder, useGetMe, getGetCartQueryKey, getListOrdersQueryKey } from "@workspace/api-client-react";
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

  const [paymentMethod, setPaymentMethod] = useState<"bank_transfer" | "cod">("bank_transfer");
  const [receiverName, setReceiverName] = useState(me?.name || "");
  const [receiverPhone, setReceiverPhone] = useState(me?.phone || "");
  const [shippingAddress, setShippingAddress] = useState(me?.shippingAddress || "");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successOrderNo, setSuccessOrderNo] = useState<string | null>(null);

  const getPrice = (product: any) => {
    if (me?.tier === "hospital") return product.priceHospital;
    if (me?.tier === "clinic") return product.priceClinic;
    return product.priceConsumer;
  };

  const total = useMemo(() => {
    return cart?.reduce((sum, item) => sum + (getPrice(item.product) * item.quantity), 0) || 0;
  }, [cart, me]);

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
          items: cart.map(item => ({
            productId: item.productId,
            quantity: item.quantity
          }))
        }
      });
      setSuccessOrderNo(order.orderNo);
      queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    } catch (e) {
      toast({ title: "結帳失敗，請重試", variant: "destructive" });
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
    <div className="flex flex-col min-h-screen bg-gray-50 pb-32 animate-in fade-in">
      <div className="bg-white px-4 pt-safe pb-3 shadow-sm sticky top-0 z-40 flex items-center gap-3">
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

            <label className="flex items-center p-3 rounded-xl border-2 border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed">
              <div className="w-5 h-5 rounded-full border border-gray-300 mr-3" />
              <Wallet size={20} className="text-gray-400 mr-3" />
              <div className="flex-1">
                <div className="font-bold text-sm text-gray-600 flex items-center justify-between">
                  機構錢包扣款 <span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-0.5 rounded">即將推出</span>
                </div>
              </div>
            </label>
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
                <span className="text-gray-600 truncate mr-4">{item.product.name} x {item.quantity}</span>
                <span className="font-medium">{formatPrice(getPrice(item.product) * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
            <span className="font-bold text-gray-900">總金額</span>
            <span className="text-xl font-bold text-destructive">{formatPrice(total)}</span>
          </div>
        </section>
      </div>

      <div className="fixed bottom-0 z-40 w-full max-w-md bg-white border-t rounded-t-3xl shadow-[0_-8px_20px_rgba(0,0,0,0.08)] pb-safe">
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

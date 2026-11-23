import { useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Clock, CreditCard, Truck, FileText, Image as ImageIcon, X, PackageCheck, Copy, ExternalLink } from "lucide-react";
import { useGetOrder, getGetOrderQueryKey } from "@workspace/api-client-react";
import { formatPrice, getOrderStatusName, getPaymentMethodName, getCarrierTrackingUrl, classNames } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RemittanceCard, CancelOrderButton } from "@/components/OrderSelfService";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

/** 運送狀態：目前進度、貨運公司、運送單號（可複製、可連到貨運公司查件） */
function ShipmentCard({ order }: { order: { status: string; shippingCarrier?: string | null; trackingNo?: string | null; shippedAt?: string | null } }) {
  const [copied, setCopied] = useState(false);
  if (order.status === "cancelled" || order.status === "returned") return null;
  const shipped = order.status === "shipped" || order.status === "completed";
  const text = order.status === "pending"
    ? "尚未付款，付款確認後安排出貨"
    : order.status === "paid"
      ? "已收到款項，正在安排出貨"
      : order.status === "shipped"
        ? "已出貨，運送中"
        : "已送達，訂單完成";
  const trackingUrl = order.trackingNo ? getCarrierTrackingUrl(order.shippingCarrier, order.trackingNo) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.trackingNo ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 瀏覽器不給複製就算了，單號本身看得到 */
    }
  };
  return (
    <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100" data-testid="shipment-card">
      <div className="flex gap-3">
        <PackageCheck className={classNames("shrink-0 mt-0.5", shipped ? "text-primary" : "text-gray-400")} size={18} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-gray-900 mb-1">運送狀態</p>
          <p className="text-sm text-gray-600" data-testid="shipment-status-text">{text}</p>
          {order.shippedAt && (
            <p className="text-xs text-gray-400 mt-0.5">出貨時間：{new Date(order.shippedAt).toLocaleString("zh-TW", { hour12: false })}</p>
          )}
          {order.trackingNo ? (
            <div className="mt-3 rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">{order.shippingCarrier || "貨運"}　運送單號</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-base font-bold tracking-wide text-gray-900 break-all" data-testid="shipment-tracking-no">{order.trackingNo}</span>
                <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                  <Copy size={13} />{copied ? "已複製" : "複製"}
                </button>
                {trackingUrl && (
                  <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                    <ExternalLink size={13} />查詢貨件
                  </a>
                )}
              </div>
            </div>
          ) : shipped ? (
            <p className="text-xs text-gray-400 mt-1">運送單號尚未提供</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function OrderDetailPage() {
  const [, params] = useRoute("/orders/:id");
  const id = Number(params?.id);
  const { data: order, isLoading } = useGetOrder(id, { query: { enabled: !!id, queryKey: getGetOrderQueryKey(id) } });
  
  const [photoView, setPhotoView] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 pb-20 pt-4 px-4 space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
        <p className="text-gray-500 mb-4">找不到訂單</p>
        <Button asChild><Link href="/orders">返回訂單列表</Link></Button>
      </div>
    );
  }

  const timeline = ['pending', 'paid', 'shipped', 'completed'];
  const currentIndex = timeline.indexOf(order.status);
  
  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-24 animate-in fade-in">
      <div className="bg-white px-4 pt-safe pb-3 shadow-sm sticky top-[var(--sf-header-h,0px)] z-30 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2"><Link href="/orders"><ArrowLeft size={20} /></Link></Button>
        <h1 className="font-bold text-lg text-gray-900">訂單詳情</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* Status Card */}
        <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">訂單編號</p>
              <p className="font-mono font-bold text-gray-900">{order.orderNo}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 mb-1">訂購日期</p>
              <p className="font-medium text-gray-900">{new Date(order.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          {order.status !== 'cancelled' ? (
            <div className="relative mt-8 mb-4">
              <div className="absolute top-2 left-4 right-4 h-0.5 bg-gray-100 -z-10" />
              <div 
                className="absolute top-2 left-4 h-0.5 bg-primary -z-10 transition-all duration-500" 
                style={{ width: `calc(${(Math.max(0, currentIndex) / (timeline.length - 1)) * 100}% - 32px)` }}
              />
              <div className="flex justify-between relative">
                {timeline.map((step, idx) => (
                  <div key={step} className="flex flex-col items-center">
                    <div className={classNames(
                      "w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center mb-2",
                      idx <= currentIndex ? "border-primary" : "border-gray-200"
                    )}>
                      {idx <= currentIndex && <div className="w-1.5 h-1.5 bg-primary rounded-full" />}
                    </div>
                    <span className={classNames("text-[10px] font-bold", idx <= currentIndex ? "text-primary" : "text-gray-400")}>
                      {getOrderStatusName(step)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-red-50 text-red-600 font-bold p-3 rounded-xl text-center text-sm">
              此訂單已取消
            </div>
          )}
        </section>

        <RemittanceCard order={order} />

        <ShipmentCard order={order} />

        {/* Info Cards */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex gap-3">
            <Truck className="text-gray-400 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="text-xs font-bold text-gray-900 mb-1">收件資訊</p>
              <p className="text-sm text-gray-600">{order.receiverName} ({order.receiverPhone})</p>
              <p className="text-sm text-gray-600">{order.shippingAddress}</p>
            </div>
          </div>
          
          <div className="flex gap-3 pt-4 border-t border-gray-50">
            <CreditCard className="text-gray-400 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="text-xs font-bold text-gray-900 mb-1">付款方式</p>
              <p className="text-sm text-gray-600">{getPaymentMethodName(order.paymentMethod)}</p>
            </div>
          </div>

          {order.note && (
            <div className="flex gap-3 pt-4 border-t border-gray-50">
              <FileText className="text-gray-400 shrink-0 mt-0.5" size={18} />
              <div>
                <p className="text-xs font-bold text-gray-900 mb-1">訂單備註</p>
                <p className="text-sm text-gray-600">{order.note}</p>
              </div>
            </div>
          )}
        </section>

        {/* Items */}
        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="font-bold text-gray-900 mb-4">商品明細</h2>
          <div className="space-y-4 divide-y divide-gray-50">
            {order.items.map(item => (
              <div key={item.id} className="pt-4 first:pt-0">
                <div className="flex justify-between items-start mb-1">
                  <div className="font-medium text-sm text-gray-900 pr-4 line-clamp-2 leading-tight">
                    {item.productName}
                    {item.variantName && <span className="inline-block text-[10px] bg-gray-100 text-gray-600 px-1 py-0.5 rounded ml-1 mt-0.5">規格：{item.variantName}</span>}
                  </div>
                  <div className="font-bold text-gray-900 shrink-0">{formatPrice(item.unitPrice)}</div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-xs text-gray-500">#{item.productCode}</span>
                  <span className="text-sm text-gray-600">x {item.quantity}</span>
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-2">
            {order.pointsUsed ? (
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">商品總額</span>
                  <span className="font-medium">{formatPrice(order.totalAmount + order.pointsUsed)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">點數折抵</span>
                  <span className="font-medium text-destructive">-NT${order.pointsUsed}</span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between items-center pt-2">
              <span className="font-bold text-gray-900">實付金額</span>
              <span className="text-xl font-bold text-destructive">{formatPrice(order.totalAmount)}</span>
            </div>
            {order.pointsEarned ? (
              <div className="text-right mt-1">
                <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded-md font-medium">
                  獲得回饋點數 +{order.pointsEarned}
                </span>
              </div>
            ) : null}
          </div>
        </section>
        
        {order.shipmentPhotos && order.shipmentPhotos.length > 0 && (
          <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mb-6">
            <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <ImageIcon size={18} className="text-primary" />
              出貨照片存證
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {order.shipmentPhotos.map((path, idx) => (
                <button
                  key={idx}
                  className="relative aspect-square rounded-xl overflow-hidden border bg-gray-50 active:scale-95 transition-transform"
                  onClick={() => setPhotoView(path)}
                >
                  <img src={`/api/storage${path}`} alt={`出貨照片 ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </section>
        )}

        <CancelOrderButton order={order} />
      </div>

      <Dialog open={!!photoView} onOpenChange={(o) => !o && setPhotoView(null)}>
        <DialogContent className="max-w-md w-full bg-black/95 p-0 border-0 rounded-none overflow-hidden h-[100dvh] flex items-center justify-center flex-col shadow-none">
          <div className="absolute top-4 right-4 z-50">
            <button 
              onClick={() => setPhotoView(null)}
              className="bg-black/50 text-white p-2 rounded-full backdrop-blur-sm"
            >
              <X size={24} />
            </button>
          </div>
          {photoView && (
            <img 
              src={`/api/storage${photoView}`} 
              alt="出貨照片" 
              className="w-full h-auto max-h-[100dvh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

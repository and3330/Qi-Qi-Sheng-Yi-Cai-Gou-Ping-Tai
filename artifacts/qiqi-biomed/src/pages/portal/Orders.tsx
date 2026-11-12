import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Package, Search } from "lucide-react";
import { useListPortalOrders, ListPortalOrdersStatus } from "@workspace/api-client-react";
import { formatPrice, classNames } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_MAP: Record<string, ListPortalOrdersStatus | undefined> = {
  "全部": undefined,
  "待處理": "pending",
  "已付款": "paid",
  "已出貨": "shipped",
  "已完成": "completed",
  "已退貨": "returned" as ListPortalOrdersStatus,
  "已取消": "cancelled"
};
const STATUSES = Object.keys(STATUS_MAP);

export default function PortalOrders() {
  const [status, setStatus] = useState("全部");
  
  const { data: orders, isLoading } = useListPortalOrders(
    { status: STATUS_MAP[status] }
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav-offset animate-in fade-in bottom-nav-offset mb-16">
      <div className="sticky top-[var(--sf-header-h,0px)] z-40 bg-primary px-4 pt-safe pb-3 shadow-sm flex items-center justify-between">
        <Link href="/portal" className="p-2 text-white/90 hover:text-white transition-colors -ml-2 cursor-pointer">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-white font-bold text-lg tracking-wide">機構訂單</h1>
        <button className="p-2 text-white/90 hover:text-white transition-colors -mr-2">
          <Search size={22} />
        </button>
      </div>

      <div className="sticky top-[calc(var(--sf-header-h,0px)+52px)] z-30 bg-gray-50/95 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
        <div className="flex overflow-x-auto gap-2 px-4 py-3 hide-scrollbar">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={classNames(
                "whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-bold transition-all shadow-sm border",
                status === s 
                  ? "bg-primary text-white border-primary" 
                  : "bg-white text-gray-500 border-gray-100 hover:bg-gray-50"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3 relative z-10">
        {isLoading ? (
          Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
        ) : orders?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package size={48} className="text-gray-300 mb-4" />
            <p className="text-gray-500">沒有符合的訂單</p>
          </div>
        ) : (
          orders?.map(order => (
            <div key={order.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-primary/20 transition-colors">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-sm font-bold text-gray-900">{order.orderNo}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {new Date(order.createdAt).toLocaleString('zh-TW', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </div>
                </div>
                <span className={classNames(
                  "text-[10px] font-bold px-2 py-1 rounded-sm",
                  order.status === "completed" ? "bg-emerald-50 text-emerald-600" :
                  order.status === "cancelled" || (order.status as string) === "returned" ? "bg-gray-100 text-gray-500" :
                  order.status === "paid" || order.status === "shipped" ? "bg-blue-50 text-blue-600" :
                  "bg-orange-50 text-orange-600"
                )}>
                  {Object.entries(STATUS_MAP).find(([, val]) => val === order.status)?.[0] || order.status}
                </span>
              </div>
              
              <div className="flex justify-between items-end border-t border-gray-50 pt-3">
                <div className="flex flex-col gap-1 text-xs">
                  {order.memberName && (
                    <span className="text-gray-500">
                      下單人: <span className="text-gray-900 font-medium">{order.memberName} {order.boundDepartment ? `(${order.boundDepartment})` : ''}</span>
                    </span>
                  )}
                  <span className="text-gray-500">
                    付款方式: <span className="text-gray-900 font-medium">{order.paymentMethod}</span>
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-400 mb-0.5">訂單金額</div>
                  <div className="text-lg font-bold text-primary leading-none">{formatPrice(order.totalAmount)}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
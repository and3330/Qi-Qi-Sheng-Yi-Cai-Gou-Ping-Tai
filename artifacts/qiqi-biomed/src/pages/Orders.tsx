import { Link } from "wouter";
import { Package, ArrowRight } from "lucide-react";
import { useListOrders } from "@workspace/api-client-react";
import { formatPrice, getOrderStatusName } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function OrdersPage() {
  const { data: orders, isLoading } = useListOrders();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'paid': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'shipped': return 'bg-primary/10 text-primary border-primary/20';
      case 'completed': return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-20 animate-in fade-in">
      <div className="bg-white px-4 pt-safe pb-4 shadow-sm sticky top-0 z-30">
        <h1 className="font-bold text-xl text-gray-900 pt-2">訂單查詢</h1>
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))
        ) : orders?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package size={48} className="text-gray-300 mb-4" />
            <p className="text-gray-500">目前沒有訂單紀錄</p>
          </div>
        ) : (
          orders?.map(order => (
            <Link key={order.id} href={`/orders/${order.id}`} className="block bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover-elevate transition-all">
              <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-50">
                <div className="font-mono text-sm font-bold text-gray-800">#{order.orderNo}</div>
                <div className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${getStatusColor(order.status)}`}>
                  {getOrderStatusName(order.status)}
                </div>
              </div>
              
              <div className="space-y-1 mb-4">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">訂購日期</span>
                  <span className="text-gray-900 font-medium">{new Date(order.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">商品件數</span>
                  <span className="text-gray-900 font-medium">{order.items.reduce((sum, item) => sum + item.quantity, 0)} 件</span>
                </div>
                <div className="flex justify-between text-sm pt-1">
                  <span className="text-gray-500">總金額</span>
                  <span className="font-bold text-destructive">{formatPrice(order.totalAmount)}</span>
                </div>
              </div>

              <div className="text-primary text-xs font-medium flex items-center justify-center bg-primary/5 py-2 rounded-lg">
                查看詳情 <ArrowRight size={14} className="ml-1" />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

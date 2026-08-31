import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetPortalSummary, getGetPortalSummaryQueryKey } from "@workspace/api-client-react";
import { 
  Building2, Wallet, Package, ClipboardList, TrendingUp, 
  ChevronRight, AlertCircle, ShoppingBag, Zap, ArrowLeft
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function PortalDashboard() {
  const { me } = useAuth();
  const { data: summary, isLoading } = useGetPortalSummary({
    query: {
      enabled: !!me && (me.tier === 'hospital' || me.tier === 'clinic'),
      queryKey: getGetPortalSummaryQueryKey()
    }
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav-offset animate-in fade-in bottom-nav-offset mb-16">
      <div className="bg-primary px-4 pt-safe pb-4 text-white relative rounded-b-[2rem] shadow-sm mb-6">
        <div className="flex items-center justify-between mb-4">
          <Link href="/" className="p-2 -ml-2 text-white/90 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <h1 className="font-bold text-lg">機構後台</h1>
          <div className="w-8" />
        </div>
        
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-primary">
              <Building2 size={20} />
            </div>
            <div>
              {!me?.boundInstitutionId ? (
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-lg">尚未綁定院所</h2>
                  <Link href="/member" className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full hover:bg-white/30 transition-colors">去綁定</Link>
                </div>
              ) : (
                <h2 className="font-bold text-lg">{summary?.institutionName || me?.boundInstitutionName}</h2>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] bg-white text-primary px-1.5 py-0.5 rounded-sm font-bold shadow-sm">
                  {summary?.tier === 'hospital' ? '醫院會員' : '診所/藥局會員'}
                </span>
                {me?.boundInstitutionId && summary && !summary.institutionScope && (
                  <span className="text-[10px] text-white/90 bg-white/20 px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                    <AlertCircle size={10} />
                    審核中
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {me?.boundInstitutionId && summary && !summary.institutionScope && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs p-3 rounded-xl flex gap-2 shadow-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <p>院所綁定審核中：目前僅顯示您個人的訂單資料，審核通過後可查看全院所資料</p>
          </div>
        )}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <TrendingUp size={16} className="text-blue-500" />
                <span className="text-xs font-medium">本月採購金額</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{formatPrice(summary?.monthPurchaseTotal || 0)}</p>
            </div>
            
            <Link href="/portal/wallet" className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex flex-col justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-amber-500" />
                  <span className="text-xs font-medium">我的錢包</span>
                </div>
                <ChevronRight size={14} className="text-gray-300" />
              </div>
              <p className="text-xl font-bold text-gray-900">{formatPrice(summary?.walletBalance || 0)}</p>
            </Link>

            <Link href="/portal/orders" className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex flex-col justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <div className="flex items-center gap-2">
                  <Package size={16} className="text-indigo-500" />
                  <span className="text-xs font-medium">本月訂單</span>
                </div>
                <ChevronRight size={14} className="text-gray-300" />
              </div>
              <p className="text-xl font-bold text-gray-900">{summary?.monthOrderCount || 0} <span className="text-xs text-gray-400 font-normal">筆</span></p>
            </Link>

            <Link href="/portal/orders?status=pending" className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex flex-col justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <div className="flex items-center gap-2">
                  <ClipboardList size={16} className="text-orange-500" />
                  <span className="text-xs font-medium">待處理訂單</span>
                </div>
                <ChevronRight size={14} className="text-gray-300" />
              </div>
              <p className="text-xl font-bold text-gray-900">{summary?.pendingOrderCount || 0} <span className="text-xs text-gray-400 font-normal">筆</span></p>
            </Link>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mt-2">
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">快速連結</h3>
          </div>
          <div className="grid grid-cols-4 divide-x divide-gray-50 border-b border-gray-50">
            <Link href="/portal/orders" className="p-3 flex flex-col items-center gap-1.5 hover:bg-gray-50">
              <Package size={20} className="text-gray-600" />
              <span className="text-[10px] text-gray-600 font-medium">機構訂單</span>
            </Link>
            <Link href="/portal/wallet" className="p-3 flex flex-col items-center gap-1.5 hover:bg-gray-50">
              <Wallet size={20} className="text-gray-600" />
              <span className="text-[10px] text-gray-600 font-medium">我的錢包</span>
            </Link>
            <Link href="/portal/reports" className="p-3 flex flex-col items-center gap-1.5 hover:bg-gray-50">
              <TrendingUp size={20} className="text-gray-600" />
              <span className="text-[10px] text-gray-600 font-medium">採購統計</span>
            </Link>
            <Link href="/shop" className="p-3 flex flex-col items-center gap-1.5 hover:bg-gray-50">
              <ShoppingBag size={20} className="text-primary" />
              <span className="text-[10px] text-primary font-medium">前往商城</span>
            </Link>
          </div>
          <div className="p-3 flex justify-center">
            <Link href="/quick-order">
              <Button variant="outline" className="h-9 rounded-full text-xs border-primary text-primary hover:bg-primary/5 px-6">
                <Zap size={14} className="mr-1" /> 快速訂購
              </Button>
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">近期訂單</h3>
            <Link href="/portal/orders" className="text-[11px] text-primary flex items-center">
              查看全部 <ChevronRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {isLoading ? (
              Array(3).fill(0).map((_, i) => <div key={i} className="p-4 h-16 animate-pulse bg-gray-50/50" />)
            ) : summary?.recentOrders?.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">暫無近期訂單</div>
            ) : (
              summary?.recentOrders?.map(order => (
                <div key={order.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-800">{order.orderNo}</span>
                      {summary?.institutionScope && (
                        <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {order.memberName} {order.boundDepartment ? `(${order.boundDepartment})` : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {new Date(order.createdAt).toLocaleDateString('zh-TW')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm text-gray-900 mb-1">{formatPrice(order.totalAmount)}</div>
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                      {order.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
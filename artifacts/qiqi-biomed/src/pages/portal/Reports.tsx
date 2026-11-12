import { Link } from "wouter";
import { ArrowLeft, TrendingUp, AlertCircle, BarChart3, PackageOpen } from "lucide-react";
import { useGetPortalReports } from "@workspace/api-client-react";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalReports() {
  const { data: reports, isLoading } = useGetPortalReports();

  // Find max value for bar chart scaling
  const maxAmount = reports?.months?.reduce((max, m) => Math.max(max, m.purchaseTotal), 0) || 1;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav-offset animate-in fade-in bottom-nav-offset mb-16">
      <div className="sticky top-[var(--sf-header-h,0px)] z-40 bg-primary px-4 pt-safe pb-3 shadow-sm flex items-center justify-between">
        <Link href="/portal" className="p-2 text-white/90 hover:text-white transition-colors -ml-2 cursor-pointer">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-white font-bold text-lg tracking-wide">採購統計</h1>
        <div className="w-8" />
      </div>

      <div className="p-4 space-y-4">
        {reports && !reports.institutionScope && (
          <div className="bg-blue-50 text-blue-700 text-xs p-3 rounded-xl flex items-center gap-2 border border-blue-100 shadow-sm">
            <AlertCircle size={16} className="shrink-0" />
            目前的統計資料僅包含您個人的採購紀錄。若需查看全院統計，請聯繫平台申請管理員權限。
          </div>
        )}

        {/* 6-Month Chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center">
              <BarChart3 size={16} />
            </div>
            <h2 className="font-bold text-gray-900">近 6 個月採購趨勢</h2>
          </div>

          {isLoading ? (
            <div className="h-48 flex items-end justify-between gap-2">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="w-full bg-gray-100 rounded-t-md animate-pulse" style={{ height: `${20 + Math.random() * 60}%` }} />
              ))}
            </div>
          ) : reports?.months?.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-gray-400 text-sm">
              無統計資料
            </div>
          ) : (
            <div className="h-56 flex items-end justify-between gap-3 pt-6 relative">
              {reports?.months?.map((m) => {
                const heightPercent = Math.max(5, (m.purchaseTotal / maxAmount) * 100);
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-2 group relative">
                    {/* Tooltip */}
                    <div className="absolute -top-8 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {formatPrice(m.purchaseTotal)} ({m.orderCount}筆)
                    </div>
                    {/* Bar */}
                    <div className="w-full relative flex justify-center h-full items-end">
                      <div 
                        className="w-full max-w-[24px] bg-blue-100 group-hover:bg-blue-200 transition-colors rounded-t-sm"
                        style={{ height: `${heightPercent}%` }}
                      >
                        <div className="w-full h-1 bg-blue-500 rounded-t-sm absolute top-0" />
                      </div>
                    </div>
                    {/* Label */}
                    <span className="text-[9px] text-gray-500 font-medium">
                      {m.month.substring(5)}月
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-50 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center">
              <PackageOpen size={16} />
            </div>
            <h2 className="font-bold text-gray-900">常購品項 Top 10</h2>
          </div>
          
          <div className="divide-y divide-gray-50">
            {isLoading ? (
              Array(3).fill(0).map((_, i) => (
                <div key={i} className="p-4 animate-pulse flex justify-between">
                  <div className="h-4 bg-gray-100 rounded w-1/2" />
                  <div className="h-4 bg-gray-100 rounded w-1/4" />
                </div>
              ))
            ) : reports?.topProducts?.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">無常購品項資料</div>
            ) : (
              reports?.topProducts?.map((p, index) => (
                <div key={p.productCode} className="p-4 flex items-center gap-3 hover:bg-gray-50">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    index === 0 ? 'bg-amber-100 text-amber-600' :
                    index === 1 ? 'bg-gray-200 text-gray-600' :
                    index === 2 ? 'bg-orange-100 text-orange-600' :
                    'bg-gray-50 text-gray-400'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-gray-900 line-clamp-1 mb-0.5">{p.productName}</h3>
                    <p className="text-[10px] text-gray-400">{p.productCode}</p>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <div className="font-bold text-sm text-primary mb-0.5">{formatPrice(p.amount)}</div>
                    <div className="text-[10px] text-gray-500 font-medium bg-gray-100 px-1.5 py-0.5 rounded inline-block">
                      共 {p.quantity} 件
                    </div>
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
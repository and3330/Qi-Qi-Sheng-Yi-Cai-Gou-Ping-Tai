import { Link } from "wouter";
import { ArrowLeft, HandCoins, AlertCircle } from "lucide-react";
import { useGetPortalCommissions, type PortalCommissionRecord } from "@workspace/api-client-react";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalCommissions() {
  const { data: commissions, isLoading } = useGetPortalCommissions();

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav-offset animate-in fade-in bottom-nav-offset mb-16">
      <div className="sticky top-0 z-40 bg-primary px-4 pt-safe pb-3 shadow-sm flex items-center justify-between">
        <Link href="/portal" className="p-2 text-white/90 hover:text-white transition-colors -ml-2 cursor-pointer">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-white font-bold text-lg tracking-wide">佣金對帳</h1>
        <div className="w-8" />
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-32 w-full rounded-3xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </>
        ) : commissions && !commissions.institutionScope ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mb-4">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">無法查看機構佣金</h2>
            <p className="text-sm text-gray-500 max-w-[250px]">
              您的院所綁定尚在審核中，審核通過後即可查看全院所佣金明細
            </p>
          </div>
        ) : (
          <>
            {/* Total Card */}
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 opacity-10 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
                <HandCoins size={160} />
              </div>
              <div className="relative z-10">
                <p className="text-white/80 text-sm font-medium mb-1">累積佣金總額</p>
                <h2 className="text-4xl font-bold tracking-tight mb-2">
                  {formatPrice(commissions?.totalAmount || 0)}
                </h2>
                <div className="inline-block bg-white/20 px-2.5 py-1 rounded text-[10px] font-medium backdrop-blur-sm">
                  共 {commissions?.recordCount || 0} 筆紀錄
                </div>
              </div>
            </div>

            {/* List */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-50">
                <h3 className="font-bold text-gray-900">佣金明細</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {!commissions?.records?.length ? (
                  <div className="p-10 text-center text-gray-400 text-sm">無佣金紀錄</div>
                ) : (
                  commissions.records.map((record: PortalCommissionRecord) => (
                    <div key={record.id} className="p-4 hover:bg-gray-50">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-sm font-bold text-gray-900 mb-0.5">{record.orderNo}</div>
                          <div className="text-[10px] text-gray-400">
                            {new Date(record.createdAt).toLocaleString('zh-TW')}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-primary font-bold text-base leading-none mb-1">
                            +{formatPrice(record.amount)}
                          </div>
                          <div className="text-[10px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-medium inline-block">
                            {record.percentBps / 100}%
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-gray-50 rounded-lg p-2.5 text-[11px] grid grid-cols-2 gap-y-2 border border-gray-100 mt-2">
                        <div>
                          <span className="text-gray-400 block mb-0.5">經手成員</span>
                          <span className="text-gray-700 font-medium">{record.memberName}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block mb-0.5">所屬科室</span>
                          <span className="text-gray-700 font-medium">{record.department || '無'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block mb-0.5">套用規則</span>
                          <span className="text-gray-700 font-medium">{record.ruleName}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block mb-0.5">基準金額</span>
                          <span className="text-gray-700 font-medium">{formatPrice(record.baseAmount)}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
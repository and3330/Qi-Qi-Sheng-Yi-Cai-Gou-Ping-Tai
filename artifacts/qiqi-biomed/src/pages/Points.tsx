import { Link } from "wouter";
import { ArrowLeft, HandCoins } from "lucide-react";
import { useGetMe, useGetPointTransactions } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

const typeLabel: Record<string, string> = {
  earn: "消費回饋",
  redeem: "折抵",
  refund: "取消退回",
  adjust: "調整"
};

const typeColor: Record<string, string> = {
  earn: "text-emerald-600",
  redeem: "text-rose-600",
  refund: "text-emerald-600",
  adjust: "text-blue-600"
};

export default function PointsPage() {
  const { data: me } = useGetMe();
  const { data: txs, isLoading } = useGetPointTransactions();

  return (
    <div className="pb-24 bg-gray-50 min-h-[100dvh]">
      <header className="sticky top-[var(--sf-header-h,0px)] z-30 bg-white border-b flex items-center px-4 h-14">
        <Link href="/member" className="p-2 -ml-2 text-gray-500 active:text-gray-900">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="flex-1 text-center font-bold text-gray-900 pr-6">我的點數</h1>
      </header>

      <div className="p-4">
        <div className="bg-primary text-white rounded-2xl p-6 shadow-sm mb-6 flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-3">
            <HandCoins size={24} />
          </div>
          <p className="text-sm font-medium text-primary-100 mb-1">可用點數</p>
          <p className="text-4xl font-bold">{me?.points?.toLocaleString() || 0}</p>
          <p className="mt-4 text-xs text-primary-100/80 bg-black/10 px-3 py-1 rounded-full">
            每消費滿 NT$100，訂單完成後回饋 1 點
          </p>
        </div>

        <h2 className="font-bold text-gray-900 mb-3 ml-1">點數異動紀錄</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4 flex justify-between items-center">
                <div>
                  <Skeleton className="h-4 w-20 mb-1" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-12" />
              </div>
            ))
          ) : !txs?.length ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              尚無點數紀錄
            </div>
          ) : (
            txs.map((tx) => (
              <div key={tx.id} className="p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium text-sm text-gray-900 mb-0.5">
                    {typeLabel[tx.type] || tx.type}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {new Date(tx.createdAt).toLocaleString('zh-TW', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </p>
                  {(tx.orderId || tx.note) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {tx.orderId ? `訂單 #${tx.orderId}` : ''}
                      {tx.orderId && tx.note ? ' · ' : ''}
                      {tx.note}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className={`font-bold text-lg ${typeColor[tx.type] || 'text-gray-900'}`}>
                    {tx.delta > 0 ? '+' : ''}{tx.delta}
                  </p>
                  <p className="text-[10px] text-gray-400">餘額 {tx.balanceAfter}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

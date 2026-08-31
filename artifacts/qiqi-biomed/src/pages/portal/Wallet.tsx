import { Link } from "wouter";
import { ArrowLeft, Wallet as WalletIcon, ArrowUpRight, ArrowDownRight, RefreshCcw, User } from "lucide-react";
import { useGetPortalWallet } from "@workspace/api-client-react";
import { formatPrice, classNames } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'deposit': return '儲值';
    case 'payment': return '消費';
    case 'refund': return '退款';
    case 'profit_share': return '分潤';
    case 'adjust': return '調整';
    default: return type;
  }
};

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'deposit': 
    case 'refund': 
    case 'profit_share': return <ArrowDownRight size={16} className="text-emerald-500" />;
    case 'payment': return <ArrowUpRight size={16} className="text-destructive" />;
    case 'adjust': return <RefreshCcw size={16} className="text-blue-500" />;
    default: return <WalletIcon size={16} className="text-gray-500" />;
  }
};

export default function PortalWallet() {
  const { data: wallet, isLoading } = useGetPortalWallet();

  const isInstitution = wallet?.walletKind === 'institution';

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav-offset animate-in fade-in bottom-nav-offset mb-16">
      <div className="sticky top-0 z-40 bg-primary px-4 pt-safe pb-3 shadow-sm flex items-center justify-between">
        <Link href="/portal" className="p-2 text-white/90 hover:text-white transition-colors -ml-2 cursor-pointer">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-white font-bold text-lg tracking-wide">
          {isInstitution ? "機構共用錢包" : "我的錢包"}
        </h1>
        <div className="w-8" />
      </div>

      <div className="p-4">
        {/* Balance Card */}
        <div className="bg-gradient-to-br from-primary to-[#2a7a44] rounded-3xl p-6 text-white shadow-lg mb-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 opacity-10 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
            <WalletIcon size={160} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-white/80 text-sm font-medium">可用餘額</p>
              {isInstitution && wallet?.institutionName && (
                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full backdrop-blur-sm">
                  {wallet.institutionName}
                </span>
              )}
            </div>
            {isLoading ? (
              <Skeleton className="h-10 w-48 bg-white/20" />
            ) : (
              <h2 className="text-4xl font-bold tracking-tight mb-6">
                {formatPrice(wallet?.balance || 0)}
              </h2>
            )}
            
            <div className="flex gap-3">
              <Button variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20 rounded-full text-xs h-9">
                線上儲值
              </Button>
              <Button variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20 rounded-full text-xs h-9">
                提領申請
              </Button>
            </div>
          </div>
        </div>

        {!isInstitution && !isLoading && (
          <p className="text-xs text-gray-500 text-center mb-4">
            院所綁定審核通過後將顯示機構共用錢包
          </p>
        )}

        {/* Transactions */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-50">
            <h3 className="font-bold text-gray-900">交易紀錄</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {isLoading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="p-4 flex gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-100 rounded w-1/3" />
                    <div className="h-3 bg-gray-50 rounded w-1/4" />
                  </div>
                </div>
              ))
            ) : wallet?.transactions?.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">目前沒有交易紀錄</div>
            ) : (
              wallet?.transactions?.map(tx => {
                const isPositive = tx.amount > 0;
                return (
                  <div key={tx.id} className="p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                    <div className={classNames(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                      isPositive ? "bg-emerald-50" : tx.amount < 0 ? "bg-red-50" : "bg-blue-50"
                    )}>
                      {getTypeIcon(tx.type)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <span className="font-bold text-sm text-gray-900">{getTypeLabel(tx.type)}</span>
                        <span className={classNames(
                          "font-bold text-sm",
                          isPositive ? "text-emerald-600" : tx.amount < 0 ? "text-destructive" : "text-gray-900"
                        )}>
                          {isPositive ? '+' : ''}{formatPrice(tx.amount)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-400 line-clamp-1 pr-2">
                          {tx.reason || tx.refNo || '無備註'}
                        </span>
                        <span className="text-gray-500 font-medium whitespace-nowrap">
                          餘額 {formatPrice(tx.balanceAfter)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[9px] text-gray-400 mt-1">
                        <span>{new Date(tx.createdAt).toLocaleString('zh-TW')}</span>
                        {isInstitution && tx.memberName && (
                          <span className="flex items-center gap-0.5"><User size={10} /> {tx.memberName}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListAnnouncements } from "@workspace/api-client-react";
import { ArrowLeft, Search, Bell, ChevronRight, Truck, FileText, Image } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { classNames } from "@/lib/utils";
import { NEWS_CATEGORIES } from "@/lib/content-categories";

const getCategoryStyle = (cat: string) => {
  switch (cat) {
    case '平台公告': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    case '產品快報': return 'bg-blue-50 text-blue-600 border-blue-100';
    case '活動訊息': return 'bg-orange-50 text-orange-600 border-orange-100';
    case '合作醫院': return 'bg-purple-50 text-purple-600 border-purple-100';
    case '知識文章': return 'bg-teal-50 text-teal-600 border-teal-100';
    default: return 'bg-gray-50 text-gray-600 border-gray-100';
  }
};

export default function NewsPage() {
  const { data: news, isLoading } = useListAnnouncements();
  const [activeCategory, setActiveCategory] = useState("全部");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filteredNews = useMemo(() => {
    if (!news) return [];
    let filtered = news;
    if (activeCategory !== "全部") {
      filtered = news.filter(item => item.category === activeCategory);
    }
    // Assume sorted by publishedAt desc from API
    return filtered;
  }, [news, activeCategory]);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-safe animate-in fade-in bottom-nav-offset mb-16">
      
      {/* Header */}
      <div className="sticky top-0 z-30 bg-primary px-4 pt-safe pb-3 shadow-sm flex items-center justify-between">
        <Link href="/" className="p-2 text-white/90 hover:text-white transition-colors -ml-2 cursor-pointer">
          <ArrowLeft size={24} />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center p-1 shadow-sm">
            <img src="/images/brand/logo-mark.png" alt="七期生醫" className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-bold text-lg tracking-wide">最新消息</span>
        </div>
        <button className="p-2 text-white/90 hover:text-white transition-colors -mr-2">
          <Search size={22} />
        </button>
      </div>

      {/* Category Chips */}
      <div className="sticky top-[env(safe-area-inset-top,0)+60px] z-30 bg-gray-50/95 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
        <div className="flex overflow-x-auto gap-2 px-4 py-3 hide-scrollbar">
          {NEWS_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={classNames(
                "whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-bold transition-all shadow-sm border",
                activeCategory === cat 
                  ? "bg-primary text-white border-primary" 
                  : "bg-white text-gray-500 border-gray-100 hover:bg-gray-50"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4 relative z-10">
        
        {/* Banner */}
        <div className="bg-gradient-to-br from-[#eaf4ed] to-[#f4f9f6] rounded-2xl relative overflow-hidden flex min-h-[160px] shadow-sm border border-[#e0f0e5]">
          {/* Content left */}
          <div className="flex-1 p-4 z-10 relative max-w-[65%] flex flex-col justify-center">
            <span className="inline-block px-2 py-0.5 bg-white text-primary text-[9px] font-bold rounded-full mb-1.5 shadow-sm border border-gray-100 w-fit">
              平台功能再升級
            </span>
            <h2 className="text-[17px] font-bold text-primary mb-1 leading-tight">訂單追蹤全新上線</h2>
            <p className="text-[10px] text-gray-600 mb-2 leading-tight">
              即時掌握出貨進度，提醒更安心！
            </p>
            
            <div className="flex flex-col gap-1 text-[9px] text-gray-500 mb-3">
              <span className="flex items-center gap-1"><Truck size={10} className="text-primary"/> 出貨進度查詢</span>
              <span className="flex items-center gap-1"><Bell size={10} className="text-primary"/> 到貨提醒通知</span>
              <span className="flex items-center gap-1"><FileText size={10} className="text-primary"/> 訂單明細追蹤</span>
            </div>
            
            <div className="bg-primary text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-sm hover:bg-primary/90 transition-colors inline-block cursor-pointer active:scale-95 w-fit">
              了解更多 →
            </div>
          </div>
          
          {/* Illustration right */}
          <div className="absolute right-0 bottom-0 top-0 w-1/2 z-0">
            <div className="absolute inset-0 bg-gradient-to-r from-[#eaf4ed] via-[#eaf4ed]/60 to-transparent z-10 w-full"></div>
            <img src="/images/news-banner.jpg" alt="Banner" className="w-full h-full object-cover object-left opacity-90 mix-blend-multiply" />
          </div>
        </div>

        {/* List */}
        <div className="space-y-3">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))
          ) : filteredNews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell size={48} className="text-gray-300 mb-4" />
              <p className="text-gray-500">目前沒有相關公告</p>
            </div>
          ) : (
            filteredNews.map((item, index) => {
              const isExpanded = expandedId === item.id;
              const isNewest = activeCategory === "全部" && index === 0;

              return (
                <div 
                  key={item.id} 
                  className={classNames(
                    "bg-white rounded-2xl shadow-sm border transition-colors relative overflow-hidden cursor-pointer",
                    isExpanded ? "border-primary/20 bg-[#fbfdfc]" : "border-gray-100 hover:bg-gray-50 active-elevate"
                  )}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  {isNewest && (
                    <div className="absolute top-0 right-0 w-10 h-10 overflow-hidden rounded-tr-2xl z-10 pointer-events-none">
                      <div className="absolute top-2 -right-4 bg-destructive text-white text-[9px] font-bold py-0.5 px-4 rotate-45 transform origin-center text-center shadow-sm">
                        NEW
                      </div>
                    </div>
                  )}
                  
                  <div className="p-3 flex gap-3">
                    {/* Thumbnail */}
                    <div className="w-[88px] h-[88px] rounded-xl bg-[#f0f7f2] flex-shrink-0 flex items-center justify-center overflow-hidden border border-[#e0f0e5]">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <Image size={24} className="text-primary/30" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center relative">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] text-gray-400 font-medium font-mono">
                          {new Date(item.publishedAt).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                        </span>
                        <span className={classNames("text-[9px] font-bold px-1.5 py-0.5 rounded border", getCategoryStyle(item.category ?? ""))}>
                          {item.category}
                        </span>
                      </div>
                      <h3 className="font-bold text-gray-900 text-[14px] leading-snug line-clamp-1 mb-1 pr-6">
                        {item.title}
                      </h3>
                      <p className={classNames(
                        "text-[11px] text-gray-500 leading-relaxed pr-6", 
                        isExpanded ? "whitespace-pre-wrap mt-2 pb-2" : "line-clamp-2"
                      )}>
                        {item.content || "點擊查看詳情..."}
                      </p>
                      
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-300">
                        <ChevronRight size={16} className={classNames("transition-transform duration-200", isExpanded && "rotate-90 text-primary")} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
import { useListAnnouncements } from "@workspace/api-client-react";
import { Bell } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewsPage() {
  const { data: news, isLoading } = useListAnnouncements();

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-20 animate-in fade-in">
      <div className="bg-primary px-4 pt-safe pb-4 shadow-md sticky top-0 z-40">
        <h1 className="font-bold text-lg text-white text-center">最新消息</h1>
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))
        ) : news?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell size={48} className="text-gray-300 mb-4" />
            <p className="text-gray-500">目前沒有公告</p>
          </div>
        ) : (
          news?.map((item, index) => (
            <div key={item.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 relative overflow-hidden">
              {index === 0 && (
                <div className="absolute top-0 right-0 w-12 h-12 overflow-hidden">
                  <div className="absolute top-2 -right-4 bg-destructive text-white text-[10px] font-bold py-0.5 px-4 rotate-45 transform origin-center text-center">
                    NEW
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-gray-500">
                <div className={`w-2 h-2 rounded-full ${index === 0 ? 'bg-destructive' : 'bg-primary'}`} />
                {new Date(item.publishedAt).toLocaleDateString()}
              </div>
              <h3 className="font-bold text-gray-900 mb-2 leading-relaxed text-[15px]">{item.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
                {item.content || "點擊查看詳情..."}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

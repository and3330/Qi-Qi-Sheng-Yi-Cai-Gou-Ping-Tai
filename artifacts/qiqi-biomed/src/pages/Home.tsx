import { Link } from "wouter";
import { ShoppingBag, Building2, BookOpen, Bell, Search, Zap, ArrowRight, ShoppingCart, User } from "lucide-react";
import { useGetHomeSummary, useAddCartItem, getGetCartQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPrice, classNames } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function HomePage() {
  const { data: summary, isLoading } = useGetHomeSummary();
  const { mutate: addToCart } = useAddCartItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAddCart = (productId: number) => {
    addToCart({ data: { productId, quantity: 1 } }, {
      onSuccess: () => {
        toast({ title: "已加入購物車", duration: 2000 });
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      },
      onError: () => {
        toast({ title: "請先登入", variant: "destructive", duration: 2000 });
      }
    });
  };

  const features = [
    { name: "商城", desc: "私域商城採購", icon: ShoppingBag, path: "/shop", color: "bg-emerald-50 text-emerald-600" },
    { name: "合作醫院", desc: "院所清單", icon: Building2, path: "/hospitals", color: "bg-blue-50 text-blue-600" },
    { name: "知識專區", desc: "文章/常見問題", icon: BookOpen, path: "/knowledge", color: "bg-indigo-50 text-indigo-600" },
    { name: "最新消息", desc: "平台公告", icon: Bell, path: "/news", color: "bg-orange-50 text-orange-600", badge: "新" },
    { name: "訂單查詢", desc: "出貨/追蹤", icon: Search, path: "/orders", color: "bg-teal-50 text-teal-600" },
    { name: "快速訂購", desc: "批次下單", icon: Zap, path: "/quick-order", color: "bg-purple-50 text-purple-600" },
  ];

  return (
    <div className="flex flex-col animate-in fade-in duration-500 pb-8">
      {/* Hero Banner */}
      <div className="bg-primary pt-12 pb-24 px-6 text-white rounded-b-[2.5rem] relative overflow-hidden">
        <div className="absolute top-0 right-0 opacity-10 pointer-events-none transform translate-x-1/3 -translate-y-1/3">
          <svg width="200" height="200" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
        </div>
        <div className="relative z-10">
          <p className="text-primary-foreground/80 font-medium mb-2 tracking-widest text-sm">專業醫療・用心守護</p>
          <h1 className="text-3xl font-bold mb-4">一站式醫藥採購平台</h1>
          <p className="text-primary-foreground/90 text-sm mb-6 max-w-[280px]">
            醫院・診所・藥局・消費者<br/>共創健康價值
          </p>
          <div className="flex gap-4 text-xs font-medium text-primary-foreground/90">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white"/> 正品保障</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white"/> 快速出貨</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white"/> 會員專享</span>
          </div>
        </div>
      </div>

      {/* Feature Grid */}
      <div className="px-4 -mt-16 relative z-20">
        <div className="bg-white rounded-2xl shadow-xl p-4 grid grid-cols-2 gap-4">
          {features.map((f, i) => (
            <Link key={i} href={f.path} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors active-elevate">
              <div className={classNames("w-10 h-10 rounded-full flex items-center justify-center relative flex-shrink-0", f.color)}>
                <f.icon size={20} />
                {f.badge && (
                  <span className="absolute -top-1 -right-1 bg-destructive text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {f.badge}
                  </span>
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-gray-800 whitespace-nowrap">{f.name}</span>
                <span className="text-[10px] text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis">{f.desc}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* 最新消息 Announcements */}
      <div className="px-6 mt-8">
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-lg font-bold text-gray-900">最新消息</h2>
          <Link href="/news" className="text-sm text-muted-foreground flex items-center hover:text-primary transition-colors">
            查看全部 <ArrowRight size={14} className="ml-1" />
          </Link>
        </div>
        
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => (
              <div key={i} className="p-4 flex gap-3 animate-pulse">
                <div className="w-2 h-2 rounded-full bg-gray-200 mt-1.5 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
              </div>
            ))
          ) : summary?.announcements.slice(0, 3).map((ann, i) => (
            <div key={ann.id} className="p-4 flex gap-3 hover:bg-slate-50 transition-colors">
              <div className={classNames("w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0", i === 0 ? "bg-destructive" : "bg-primary")} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 line-clamp-1">{ann.title}</p>
                <p className="text-xs text-gray-400 mt-1">{new Date(ann.publishedAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 熱門商品 Hot Products */}
      <div className="px-6 mt-10 mb-6">
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-lg font-bold text-gray-900">熱門商品</h2>
          <Link href="/shop?sort=recommended" className="text-sm text-muted-foreground flex items-center hover:text-primary transition-colors">
            查看全部 <ArrowRight size={14} className="ml-1" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex flex-col h-full animate-pulse">
                <div className="aspect-square bg-gray-100 rounded-xl mb-3" />
                <div className="h-4 bg-gray-200 rounded w-full mb-2" />
                <div className="h-3 bg-gray-100 rounded w-2/3 mb-auto" />
                <div className="mt-3 pt-3 border-t border-gray-50 flex justify-between">
                  <div className="h-5 bg-gray-200 rounded w-1/2" />
                  <div className="w-6 h-6 bg-gray-200 rounded-full" />
                </div>
              </div>
            ))
          ) : summary?.hotProducts.slice(0, 4).map(product => (
            <Link key={product.id} href={`/product/${product.id}`} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex flex-col h-full hover-elevate">
              <div className="relative aspect-square rounded-xl overflow-hidden mb-3 bg-gray-50 flex items-center justify-center">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover mix-blend-multiply" />
                ) : (
                  <ShoppingBag className="text-gray-200" size={32} />
                )}
                {product.isHot && (
                  <span className="absolute top-2 left-2 bg-destructive text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm">熱銷</span>
                )}
              </div>
              
              <h3 className="text-sm font-bold text-gray-800 line-clamp-1 mb-1">{product.name}</h3>
              <p className="text-[10px] text-gray-500 line-clamp-1 mb-auto">{product.description || product.category}</p>
              
              <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 block -mb-0.5">一般售價</span>
                  <span className="text-primary font-bold text-sm">{formatPrice(product.priceConsumer)}</span>
                </div>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-7 w-7 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-white"
                  onClick={(e) => { e.preventDefault(); handleAddCart(product.id); }}
                >
                  <ShoppingCart size={14} />
                </Button>
              </div>
            </Link>
          ))}
        </div>
      </div>
      
      {/* Promise Bar */}
      <div className="px-6 mb-8">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 flex justify-between divide-x divide-gray-100">
          <div className="flex-1 flex flex-col items-center text-center px-1">
            <span className="text-xs font-bold text-gray-800 mb-1 flex items-center"><Zap size={12} className="text-amber-500 mr-1"/> 原廠授權</span>
            <span className="text-[10px] text-gray-500">合規正品保障</span>
          </div>
          <div className="flex-1 flex flex-col items-center text-center px-1">
            <span className="text-xs font-bold text-gray-800 mb-1 flex items-center"><User size={12} className="text-blue-500 mr-1"/> 會員專屬</span>
            <span className="text-[10px] text-gray-500">合約價優惠</span>
          </div>
          <div className="flex-1 flex flex-col items-center text-center px-1">
            <span className="text-xs font-bold text-gray-800 mb-1 flex items-center"><Building2 size={12} className="text-indigo-500 mr-1"/> 彈性付款</span>
            <span className="text-[10px] text-gray-500">線上/貨到付款</span>
          </div>
        </div>
      </div>
    </div>
  );
}
